// AceCue — streaming chat proxy (Vercel edge function).
//
// Frontend always sends an OpenAI-shaped body: { provider, model, messages[] }.
// We resolve auth (BYOK header → operator env → relay), forward upstream with
// streaming on, and pipe a normalized SSE stream of {delta} chunks back. For
// Anthropic we translate request + stream to/from the OpenAI shape so the
// browser only ever parses one format.
//
// The user's BYOK key arrives in the `X-User-Key` header and is used ONLY to
// authenticate this single upstream call. It is never logged or stored.

import { PROVIDERS, resolveAuth } from "./_providers.js";

export const config = { runtime: "edge" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-user-key",
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const { provider, model, messages, temperature, max_tokens } = body || {};
  const p = PROVIDERS[provider];
  if (!p) return json({ error: `unknown provider: ${provider}` }, 400);
  if (!Array.isArray(messages) || !messages.length) return json({ error: "missing messages" }, 400);

  const byok = req.headers.get("x-user-key") || "";
  const auth = resolveAuth(provider, byok, process.env);
  if (auth.error) {
    if (auth.needsByok) {
      return json({ error: "no-key", message: `No key available for ${p.label}. Add your own key in Settings.` }, 401);
    }
    return json({ error: auth.error }, 400);
  }

  const mdl = model || p.models[0];

  try {
    if (auth.protocol === "anthropic") {
      return await streamAnthropic(auth, mdl, messages, temperature, max_tokens);
    }
    return await streamOpenAI(auth, mdl, messages, temperature, max_tokens);
  } catch (e) {
    return json({ error: "upstream failed", message: redact(String(e?.message || e), auth.key) }, 502);
  }
}

// ---- OpenAI-compatible streaming (covers ~all providers + relay) ----
async function streamOpenAI(auth, model, messages, temperature, max_tokens) {
  const upstream = await fetch(`${auth.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${auth.key}`,
      // OpenRouter likes these but they're harmless elsewhere
      "http-referer": "https://acecue.app",
      "x-title": "AceCue",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: temperature ?? 0.5,
      max_tokens: max_tokens ?? 1024,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = redact(await safeText(upstream), auth.key);
    return json({ error: "upstream error", status: upstream.status, detail }, upstream.status || 502);
  }

  // Re-emit upstream OpenAI SSE as our own normalized {delta} SSE.
  const stream = transformSSE(upstream.body, (data) => {
    if (data === "[DONE]") return null;
    try {
      const j = JSON.parse(data);
      const delta = j?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length) return { delta };
    } catch { /* ignore keepalives / partials */ }
    return null;
  });
  return sseResponse(stream);
}

// ---- Anthropic streaming, translated to the OpenAI {delta} shape ----
async function streamAnthropic(auth, model, messages, temperature, max_tokens) {
  // split system message out (Anthropic takes it as a top-level field)
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || undefined;
  const conv = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const upstream = await fetch(`${auth.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": auth.key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system,
      messages: conv,
      max_tokens: max_tokens ?? 1024,
      temperature: temperature ?? 0.5,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = redact(await safeText(upstream), auth.key);
    return json({ error: "upstream error", status: upstream.status, detail }, upstream.status || 502);
  }

  const stream = transformSSE(upstream.body, (data) => {
    try {
      const j = JSON.parse(data);
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
        return { delta: j.delta.text };
      }
    } catch { /* ignore */ }
    return null;
  });
  return sseResponse(stream);
}

// Generic SSE re-encoder: parse upstream `data:` lines, map via `pick`, emit ours.
function transformSSE(upstreamBody, pick) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
        return;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (!data) continue;
        const out = pick(data);
        if (out) controller.enqueue(encoder.encode(`data: ${JSON.stringify(out)}\n\n`));
      }
    },
    cancel() { reader.cancel(); },
  });
}

function sseResponse(stream) {
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      ...CORS,
    },
  });
}

async function safeText(r) {
  try { return (await r.text()).slice(0, 500); } catch { return ""; }
}

// Upstream error bodies sometimes echo the request's auth header back —
// never let a BYOK/operator key reach the browser.
function redact(text, secret) {
  if (!secret) return text;
  return String(text).split(secret).join("[redacted]");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}
