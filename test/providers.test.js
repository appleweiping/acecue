// Tests for api/_providers.js. Same file in acecue and ai-mirror.
// No network: upstream calls go to a stub fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS, detectProvider, resolveAuth, checkOrigin, rateLimit, resetRateLimit,
  validateBody, buildUpstreamRequest, handleChat, handleModels,
} from "../api/_providers.js";

const HOST = "app.example.test";

function chatRequest(body, headers = {}) {
  return new Request(`https://${HOST}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", host: HOST, origin: `https://${HOST}`, ...headers },
    body: JSON.stringify(body),
  });
}

function sseBody(lines) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      // split into odd-sized chunks to exercise line buffering
      const text = lines.map((l) => `data: ${l}\n\n`).join("");
      for (let i = 0; i < text.length; i += 7) c.enqueue(enc.encode(text.slice(i, i + 7)));
      c.close();
    },
  });
}

async function readEvents(res) {
  const text = await res.text();
  return text.split("\n\n").filter(Boolean).map((block) => {
    const data = block.replace(/^data: /, "");
    return data === "[DONE]" ? "[DONE]" : JSON.parse(data);
  });
}

const userMsg = [{ role: "user", content: "Say hi" }];

test("detectProvider recognises key shapes", () => {
  assert.equal(detectProvider("sk-ant-api03-abc"), "anthropic");
  assert.equal(detectProvider("sk-or-v1-abc"), "openrouter");
  assert.equal(detectProvider("AIzaSyD-example"), "gemini");
  assert.equal(detectProvider("sk-" + "0123456789abcdef".repeat(2)), "deepseek");
  assert.equal(detectProvider("sk-proj-" + "x".repeat(40)), "openai");
  assert.equal(detectProvider("just-some-text"), null);
  assert.equal(detectProvider(""), null);
});

test("resolveAuth prefers the user's key and ignores env keys by default", () => {
  const env = { OPENAI_API_KEY: "sk-operator" };
  assert.deepEqual(resolveAuth("openai", " sk-user ", env), { key: "sk-user", source: "user" });
  assert.equal(resolveAuth("openai", "", env).status, 401);
  assert.deepEqual(resolveAuth("openai", "", { ...env, ALLOW_OPERATOR_KEYS: "1" }), { key: "sk-operator", source: "operator" });
  assert.equal(resolveAuth("nope", "k", env).status, 400);
});

test("checkOrigin allows same host and listed origins only", () => {
  const mk = (origin) => new Request(`https://${HOST}/api/chat`, { method: "POST", headers: origin ? { origin, host: HOST } : { host: HOST } });
  assert.equal(checkOrigin(mk(`https://${HOST}`)).ok, true);
  assert.equal(checkOrigin(mk("https://evil.example")).ok, false);
  assert.equal(checkOrigin(mk(null)).ok, false);
  assert.equal(checkOrigin(mk("https://friend.example"), { ALLOWED_ORIGINS: "https://friend.example/" }).ok, true);
});

test("rateLimit blocks after the limit and resets after the window", () => {
  resetRateLimit();
  const opts = { limit: 2, windowMs: 1000 };
  assert.equal(rateLimit("1.2.3.4", { ...opts, now: 0 }).ok, true);
  assert.equal(rateLimit("1.2.3.4", { ...opts, now: 10 }).ok, true);
  const blocked = rateLimit("1.2.3.4", { ...opts, now: 20 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfter, 1);
  assert.equal(rateLimit("5.6.7.8", { ...opts, now: 20 }).ok, true);
  assert.equal(rateLimit("1.2.3.4", { ...opts, now: 1001 }).ok, true);
});

test("validateBody fills defaults and rejects bad input", () => {
  const ok = validateBody({ provider: "deepseek", messages: userMsg });
  assert.equal(ok.value.model, PROVIDERS.deepseek.models[0]);
  assert.equal(ok.value.maxTokens, 2048);
  assert.equal(ok.value.temperature, undefined);
  assert.match(validateBody({ provider: "x", messages: userMsg }).error, /unknown provider/);
  assert.match(validateBody({ provider: "openai", messages: [] }).error, /non-empty/);
  assert.match(validateBody({ provider: "openai", messages: [{ role: "tool", content: "x" }] }).error, /role/);
  assert.match(validateBody({ provider: "openai", messages: userMsg, temperature: 5 }).error, /temperature/);
  assert.match(validateBody({ provider: "openai", messages: userMsg, model: "a b" }).error, /model id/);
  assert.match(validateBody({ provider: "openai", messages: [{ role: "user", content: "x".repeat(70000) }] }).error, /too long/);
});

test("buildUpstreamRequest shapes OpenAI-style and Anthropic requests", () => {
  const sys = [{ role: "system", content: "Be brief." }, ...userMsg];

  const o = buildUpstreamRequest({ provider: "openai", model: "gpt-6-luna", messages: sys, maxTokens: 300, temperature: 0.2 }, "k1");
  const ob = JSON.parse(o.init.body);
  assert.equal(o.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(o.init.headers.authorization, "Bearer k1");
  assert.equal(ob.max_completion_tokens, 300);
  assert.equal(ob.temperature, undefined, "reasoning models get no temperature");
  assert.deepEqual(ob.stream_options, { include_usage: true });

  const g = JSON.parse(buildUpstreamRequest({ provider: "gemini", model: "gemini-3.8-flash", messages: sys, maxTokens: 300, temperature: 0.2 }, "k").init.body);
  assert.equal(g.max_tokens, 300);
  assert.equal(g.temperature, 0.2);
  assert.equal(g.stream_options, undefined);

  const a = buildUpstreamRequest({ provider: "anthropic", model: "claude-haiku-5-5", messages: sys, maxTokens: 300, temperature: 0.2 }, "k2");
  const ab = JSON.parse(a.init.body);
  assert.equal(a.url, "https://api.anthropic.com/v1/messages");
  assert.equal(a.init.headers["x-api-key"], "k2");
  assert.equal(ab.system, "Be brief.");
  assert.deepEqual(ab.messages, userMsg);
  assert.equal(ab.temperature, undefined, "newer Claude models get no temperature");
  const old = JSON.parse(buildUpstreamRequest({ provider: "anthropic", model: "claude-haiku-4-5", messages: sys, maxTokens: 300, temperature: 0.2 }, "k").init.body);
  assert.equal(old.temperature, 0.2);
});

test("handleChat streams an OpenAI-compatible reply with usage", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response(sseBody([
      JSON.stringify({ choices: [{ delta: { reasoning_content: "hmm" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } }),
      "[DONE]",
    ]), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const res = await handleChat(chatRequest({ provider: "deepseek", messages: userMsg }, { "x-user-key": "sk-user" }), {}, { fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-key-source"), "user");
  assert.equal(seen.url, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(await readEvents(res), [
    { thinking: "hmm" }, { delta: "Hel" }, { delta: "lo" }, { usage: { input: 9, output: 4 } }, "[DONE]",
  ]);
});

test("handleChat translates an Anthropic stream", async () => {
  const fetchImpl = async () => new Response(sseBody([
    JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 1 } } }),
    JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }),
    JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } }),
    JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }),
    JSON.stringify({ type: "message_stop" }),
  ]), { status: 200 });
  const res = await handleChat(chatRequest({ provider: "anthropic", messages: userMsg }, { "x-user-key": "sk-ant-x" }), {}, { fetchImpl });
  assert.deepEqual(await readEvents(res), [
    { delta: "Hi" }, { delta: " there" }, { usage: { input: 12, output: 5 } }, "[DONE]",
  ]);
});

test("handleChat refuses cross-origin requests and missing keys", async () => {
  const fetchImpl = async () => { throw new Error("should not be called"); };
  const cross = await handleChat(chatRequest({ provider: "openai", messages: userMsg }, { origin: "https://evil.example", "x-user-key": "k" }), {}, { fetchImpl });
  assert.equal(cross.status, 403);
  const noKey = await handleChat(chatRequest({ provider: "openai", messages: userMsg }), { OPENAI_API_KEY: "sk-op" }, { fetchImpl });
  assert.equal(noKey.status, 401);
  assert.equal((await noKey.json()).error, "no-key");
  const get = await handleChat(new Request(`https://${HOST}/api/chat`), {}, { fetchImpl });
  assert.equal(get.status, 405);
});

test("handleChat redacts the key from upstream errors", async () => {
  const fetchImpl = async () => new Response('{"error":"invalid key sk-secret-123"}', { status: 401 });
  const res = await handleChat(chatRequest({ provider: "openai", messages: userMsg }, { "x-user-key": "sk-secret-123" }), {}, { fetchImpl });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "upstream-error");
  assert.ok(!body.message.includes("sk-secret-123"));
  assert.match(body.message, /\[redacted\]/);
});

test("operator keys are rate-limited per IP", async () => {
  resetRateLimit();
  const env = { ALLOW_OPERATOR_KEYS: "1", DEEPSEEK_API_KEY: "sk-op", RATE_LIMIT_PER_MINUTE: "2" };
  const fetchImpl = async () => new Response(sseBody(["[DONE]"]), { status: 200 });
  const call = () => handleChat(chatRequest({ provider: "deepseek", messages: userMsg }, { "x-forwarded-for": "9.9.9.9" }), env, { fetchImpl });
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  const third = await call();
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("retry-after")) > 0);
});

test("handleModels lists providers without secrets", async () => {
  const res = handleModels({ ALLOW_OPERATOR_KEYS: "1", GEMINI_API_KEY: "AIza-secret" });
  const text = await res.text();
  assert.ok(!text.includes("AIza-secret"));
  const { providers } = JSON.parse(text);
  assert.deepEqual(providers.map((p) => p.id), Object.keys(PROVIDERS));
  assert.equal(providers.find((p) => p.id === "gemini").operatorKey, true);
  assert.equal(providers.find((p) => p.id === "openai").operatorKey, false);
});
