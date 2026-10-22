// Canned provider replies for `MOCK_UPSTREAM=1 npm run dev`, so AI mode can be
// clicked through without a key. Every reply is fixed text marked "(mock)";
// nothing here is real model output.

import { PROVIDERS } from "../api/_providers.js";

const HOSTS = new Set(Object.values(PROVIDERS).map((p) => new URL(p.baseUrl).host));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function replyFor(system) {
  if (/Reply with JSON only/.test(system)) {
    const labels = [...system.matchAll(/"label": "([^"]+)"/g)].map((m) => m[1]);
    return JSON.stringify({
      parts: labels.map((label, i) => ({ label, score: i === labels.length - 1 ? 1 : 2, note: `(mock) Note about ${label.toLowerCase()}.` })),
      score: 7,
      strengths: ["(mock) The answer has a clear setting.", "(mock) Actions are in first person."],
      improvements: ["(mock) Put a number on the result.", "(mock) Cut the last sentence."],
      better_opening: "(mock) Last summer at the campus help desk, I had two weeks to learn Flask.",
      follow_up: "(mock) How did you decide which ticket topics to group together?",
    });
  }
  if (/Ask exactly one realistic question/.test(system)) {
    return "(mock) Tell me about a time you had to explain a technical decision to someone outside engineering.";
  }
  return "(mock) This is a canned reply from scripts/mock-upstream.mjs.";
}

function stream(protocol, text) {
  const enc = new TextEncoder();
  const pieces = text.match(/.{1,14}/gs) || [""];
  return new ReadableStream({
    async start(c) {
      const send = (obj) => c.enqueue(enc.encode(`data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`));
      await sleep(250);
      if (protocol === "anthropic") send({ type: "message_start", message: { usage: { input_tokens: 420, output_tokens: 1 } } });
      for (const p of pieces) {
        if (protocol === "anthropic") send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: p } });
        else send({ choices: [{ delta: { content: p } }] });
        await sleep(20);
      }
      const out = Math.ceil(text.length / 4);
      if (protocol === "anthropic") {
        send({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: out } });
        send({ type: "message_stop" });
      } else {
        send({ choices: [], usage: { prompt_tokens: 420, completion_tokens: out } });
        send("[DONE]");
      }
      c.close();
    },
  });
}

export function installMock() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (!HOSTS.has(u.host)) return realFetch(url, init);
    const body = JSON.parse(init.body || "{}");
    const system = body.system || (body.messages || []).filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const protocol = u.pathname.endsWith("/messages") ? "anthropic" : "openai";
    return new Response(stream(protocol, replyFor(system)), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}
