// Shared LLM provider adapter for two small Vercel apps:
//   https://github.com/appleweiping/acecue     (interview practice coach)
//   https://github.com/appleweiping/ai-mirror  (model comparison playground)
// Both repos keep a byte-identical copy of this file. If you edit it, copy it
// to the other repo too; `npm run check:shared` compares the two copies.
//
// What it does: POST /api/chat takes an OpenAI-style body
//   { provider, model, messages: [{role, content}], temperature?, max_tokens? }
// forwards it to the chosen provider with streaming on, and streams back one
// small SSE format no matter which provider answered:
//   data: {"delta":"text"}                     answer text, repeated
//   data: {"thinking":"text"}                  reasoning text, if the provider streams it
//   data: {"usage":{"input":12,"output":80}}   token counts, if the provider reports them
//   data: {"error":"message"}                  the upstream stream failed midway
//   data: [DONE]
//
// Keys: the browser sends the user's own key in the X-User-Key header. It is
// used for this one upstream request and is not logged or stored. Keys found
// in environment variables are ignored unless ALLOW_OPERATOR_KEYS=1, and when
// they are used, requests are rate-limited per client IP.
//
// Abuse guard: requests must come from a page on the same host (Origin check),
// or from an origin listed in ALLOWED_ORIGINS (comma-separated).

export const PROVIDERS = {
  openai: {
    label: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    keyPattern: "^sk-(?!ant-|or-|[0-9a-f]{32}$)",
    models: ["gpt-6-luna", "gpt-6.1-sol", "gpt-4.1-mini"],
    streamUsage: true,
    maxTokensField: "max_completion_tokens",
    // Reasoning models (o-series, GPT-5 and GPT-6 families) reject a custom temperature.
    noTemperature: "^(o\\d|gpt-[56])",
  },
  anthropic: {
    label: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
    keyPattern: "^sk-ant-",
    models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5"],
    // Only older Claude models accept sampling parameters; newer ones return 400.
    noTemperature: "^claude-(?!3|haiku-4-5|sonnet-4|opus-4-[0156])",
  },
  gemini: {
    label: "Google Gemini",
    protocol: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    keyPattern: "^AIza",
    models: ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"],
  },
  deepseek: {
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    envKey: "DEEPSEEK_API_KEY",
    keyPattern: "^sk-[0-9a-f]{32}$",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    streamUsage: true,
  },
  mistral: {
    label: "Mistral",
    protocol: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    keyPattern: null, // Mistral keys have no recognisable prefix
    models: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
  },
  openrouter: {
    label: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    keyPattern: "^sk-or-",
    models: ["qwen/qwen3.7-plus", "z-ai/glm-5.3", "moonshotai/kimi-k3", "openai/gpt-oss-120b"],
  },
};

const LIMITS = {
  maxMessages: 40,
  maxChars: 60_000,
  defaultMaxTokens: 2048,
  maxMaxTokens: 16384,
};

// Guess the provider from the shape of a pasted key. Returns an id or null.
export function detectProvider(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.keyPattern && new RegExp(p.keyPattern).test(k)) return id;
  }
  return null;
}

// Pick the key for this request: the user's own key, or (only if the operator
// opted in) a key from the environment.
export function resolveAuth(providerId, userKey, env = {}) {
  const p = PROVIDERS[providerId];
  if (!p) return { error: `unknown provider: ${providerId}`, status: 400 };
  const own = String(userKey || "").trim();
  if (own) return { key: own, source: "user" };
  const envKey = env.ALLOW_OPERATOR_KEYS === "1" ? String(env[p.envKey] || "").trim() : "";
  if (envKey) return { key: envKey, source: "operator" };
  return { error: `No ${p.label} key was sent. Add your own key on the page.`, status: 401, code: "no-key" };
}

export function operatorKeyAvailable(providerId, env = {}) {
  const p = PROVIDERS[providerId];
  return Boolean(p && env.ALLOW_OPERATOR_KEYS === "1" && String(env[p.envKey] || "").trim());
}

// Accept only requests whose Origin matches the host serving this function,
// or an origin the operator listed in ALLOWED_ORIGINS.
export function checkOrigin(req, env = {}) {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: false, reason: "missing Origin header" };
  let originHost;
  try { originHost = new URL(origin).host; } catch { return { ok: false, reason: "bad Origin header" }; }
  const ownHosts = new Set(
    [req.headers.get("host"), req.headers.get("x-forwarded-host"), safeHost(req.url)].filter(Boolean)
  );
  if (ownHosts.has(originHost)) return { ok: true };
  const extra = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  if (extra.includes(origin)) return { ok: true };
  return { ok: false, reason: `origin ${origin} is not allowed` };
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return ""; }
}

// Fixed-window counter per client IP, kept in memory. On Vercel each function
// instance has its own memory, so this is a speed bump, not a hard quota.
const hits = new Map();
export function rateLimit(ip, { limit = 10, windowMs = 60_000, now = Date.now() } = {}) {
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
  }
  const entry = hits.get(ip);
  if (!entry || now - entry.start >= windowMs) {
    hits.set(ip, { start: now, count: 1 });
    return { ok: true, remaining: limit - 1 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { ok: false, retryAfter: Math.ceil((entry.start + windowMs - now) / 1000) };
  }
  return { ok: true, remaining: limit - entry.count };
}
export function resetRateLimit() { hits.clear(); }

function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// Validate and normalise the request body. Returns { value } or { error }.
export function validateBody(body) {
  if (!body || typeof body !== "object") return { error: "body must be a JSON object" };
  const { provider, model, messages, temperature, max_tokens } = body;
  const p = PROVIDERS[provider];
  if (!p) return { error: `unknown provider: ${provider}` };
  if (!Array.isArray(messages) || messages.length === 0) return { error: "messages must be a non-empty array" };
  if (messages.length > LIMITS.maxMessages) return { error: `at most ${LIMITS.maxMessages} messages` };
  let chars = 0;
  for (const m of messages) {
    if (!m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string") {
      return { error: "each message needs a role (system/user/assistant) and string content" };
    }
    chars += m.content.length;
  }
  if (chars > LIMITS.maxChars) return { error: `messages are too long (${chars} > ${LIMITS.maxChars} characters)` };
  const mdl = typeof model === "string" && model.trim() ? model.trim() : p.models[0];
  if (!/^[\w./:@-]{1,120}$/.test(mdl)) return { error: "model id contains unexpected characters" };
  const out = { provider, model: mdl, messages: messages.map((m) => ({ role: m.role, content: m.content })) };
  const mt = Number(max_tokens);
  out.maxTokens = Number.isFinite(mt) && mt > 0 ? Math.min(Math.round(mt), LIMITS.maxMaxTokens) : LIMITS.defaultMaxTokens;
  if (temperature !== undefined && temperature !== null && temperature !== "") {
    const t = Number(temperature);
    if (!Number.isFinite(t) || t < 0 || t > 2) return { error: "temperature must be between 0 and 2" };
    out.temperature = t;
  }
  return { value: out };
}

// Build the upstream fetch() arguments for a validated request.
export function buildUpstreamRequest(req, key) {
  const p = PROVIDERS[req.provider];
  const sendTemp = req.temperature !== undefined && !(p.noTemperature && new RegExp(p.noTemperature).test(req.model));

  if (p.protocol === "anthropic") {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const body = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages.filter((m) => m.role !== "system"),
      stream: true,
    };
    if (system) body.system = system;
    if (sendTemp) body.temperature = req.temperature;
    return {
      url: `${p.baseUrl}/messages`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
      },
    };
  }

  const body = { model: req.model, messages: req.messages, stream: true };
  body[p.maxTokensField || "max_tokens"] = req.maxTokens;
  if (sendTemp) body.temperature = req.temperature;
  if (p.streamUsage) body.stream_options = { include_usage: true };
  return {
    url: `${p.baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    },
  };
}

// Turn one upstream SSE `data:` payload into our events. `state` collects
// token usage across the stream; it is emitted once at the end.
export function parseUpstreamEvent(protocol, data, state) {
  if (data === "[DONE]") return [];
  let j;
  try { j = JSON.parse(data); } catch { return []; }
  const out = [];
  if (protocol === "anthropic") {
    if (j.type === "message_start") {
      const u = j.message?.usage || {};
      state.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (u.output_tokens) state.output = u.output_tokens;
    } else if (j.type === "content_block_delta") {
      if (j.delta?.type === "text_delta" && j.delta.text) out.push({ delta: j.delta.text });
      else if (j.delta?.type === "thinking_delta" && j.delta.thinking) out.push({ thinking: j.delta.thinking });
    } else if (j.type === "message_delta" && j.usage) {
      if (j.usage.output_tokens != null) state.output = j.usage.output_tokens;
      if (j.usage.input_tokens) state.input = j.usage.input_tokens;
    } else if (j.type === "error") {
      out.push({ error: j.error?.message || "upstream error" });
    }
    return out;
  }
  if (j.error) {
    out.push({ error: j.error.message || String(j.error) });
    return out;
  }
  const d = j.choices?.[0]?.delta;
  if (d) {
    const thinking = d.reasoning_content || d.reasoning;
    if (typeof thinking === "string" && thinking) out.push({ thinking });
    if (typeof d.content === "string" && d.content) out.push({ delta: d.content });
  }
  const u = j.usage || j.choices?.[0]?.usage;
  if (u && (u.prompt_tokens != null || u.completion_tokens != null)) {
    state.input = u.prompt_tokens ?? state.input;
    state.output = u.completion_tokens ?? state.output;
  }
  return out;
}

const encoder = new TextEncoder();
const sse = (obj) => encoder.encode(`data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`);

export function normalizeStream(upstreamBody, protocol) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  const state = {};
  let buf = "";
  let finished = false;

  const finish = (controller) => {
    if (finished) return;
    finished = true;
    if (state.input != null || state.output != null) {
      controller.enqueue(sse({ usage: { input: state.input ?? null, output: state.output ?? null } }));
    }
    controller.enqueue(sse("[DONE]"));
    controller.close();
  };

  return new ReadableStream({
    // pull() must enqueue something (or close) before returning, otherwise the
    // stream stalls, so keep reading until at least one event is produced.
    async pull(controller) {
      for (;;) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (e) {
          controller.enqueue(sse({ error: `stream interrupted: ${e?.message || e}` }));
          return finish(controller);
        }
        if (chunk.done) {
          buf += decoder.decode();
          if (buf.trim()) handleLines(buf + "\n", controller);
          return finish(controller);
        }
        buf += decoder.decode(chunk.value, { stream: true });
        const cut = buf.lastIndexOf("\n");
        if (cut === -1) continue;
        const produced = handleLines(buf.slice(0, cut + 1), controller);
        buf = buf.slice(cut + 1);
        if (produced) return;
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });

  function handleLines(text, controller) {
    let n = 0;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (!data) continue;
      for (const ev of parseUpstreamEvent(protocol, data, state)) { controller.enqueue(sse(ev)); n += 1; }
    }
    return n;
  }
}

function redact(text, secret) {
  const s = String(text ?? "");
  return secret ? s.split(secret).join("[redacted]") : s;
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

// The whole /api/chat endpoint. `fetchImpl` is injectable for tests.
export async function handleChat(req, env = {}, { fetchImpl = fetch } = {}) {
  if (req.method !== "POST") return json({ error: "use POST" }, 405, { allow: "POST" });

  const origin = checkOrigin(req, env);
  if (!origin.ok) return json({ error: "forbidden", message: origin.reason }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: "body is not valid JSON" }, 400); }
  const checked = validateBody(body);
  if (checked.error) return json({ error: checked.error }, 400);
  const request = checked.value;

  const auth = resolveAuth(request.provider, req.headers.get("x-user-key"), env);
  if (auth.error) return json({ error: auth.code || "bad-request", message: auth.error }, auth.status);

  if (auth.source === "operator") {
    const limit = Number(env.RATE_LIMIT_PER_MINUTE) || 10;
    const rl = rateLimit(clientIp(req), { limit });
    if (!rl.ok) {
      return json({ error: "rate-limited", message: `Too many requests. Try again in ${rl.retryAfter}s, or use your own key.` },
        429, { "retry-after": String(rl.retryAfter) });
    }
  }

  const { url, init } = buildUpstreamRequest(request, auth.key);
  let upstream;
  try {
    upstream = await fetchImpl(url, { ...init, signal: req.signal });
  } catch (e) {
    return json({ error: "upstream-unreachable", message: redact(e?.message || e, auth.key) }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try { detail = (await upstream.text()).slice(0, 600); } catch { /* ignore */ }
    const status = [400, 401, 402, 403, 404, 422, 429].includes(upstream.status) ? upstream.status : 502;
    return json({ error: "upstream-error", status: upstream.status, message: redact(detail, auth.key) }, status);
  }

  const protocol = PROVIDERS[request.provider].protocol;
  return new Response(normalizeStream(upstream.body, protocol), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-key-source": auth.source,
    },
  });
}

// The /api/models endpoint: provider list for the UI. Never returns secrets.
export function handleModels(env = {}) {
  const providers = Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    models: p.models,
    keyPattern: p.keyPattern,
    operatorKey: operatorKeyAvailable(id, env),
  }));
  return json({ providers }, 200, { "cache-control": "public, max-age=60" });
}
