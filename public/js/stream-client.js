// Browser side of /api/chat (see api/_providers.js for the event format).
// Same file in appleweiping/acecue and appleweiping/ai-mirror.

// Split buffered SSE text into parsed events plus the unfinished remainder.
export function parseSSE(buffer) {
  const events = [];
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop();
  for (const block of blocks) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") { events.push({ done: true }); continue; }
      try { events.push(JSON.parse(data)); } catch { /* ignore partial or junk lines */ }
    }
  }
  return { events, rest };
}

// Call /api/chat and stream the reply. onEvent receives each event
// ({delta}, {thinking}, {usage}, {error}). Resolves to
// { text, thinking, usage, error } when the stream ends.
// Throws an Error with .status and .code if the request itself fails.
export async function streamChat({ provider, model, key, messages, temperature, maxTokens, signal, onEvent }) {
  const headers = { "content-type": "application/json" };
  if (key) headers["x-user-key"] = key;
  const body = { provider, model, messages };
  if (temperature !== undefined && temperature !== null && temperature !== "") body.temperature = temperature;
  if (maxTokens) body.max_tokens = maxTokens;

  const res = await fetch("/api/chat", { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    let info = {};
    try { info = await res.json(); } catch { /* not JSON */ }
    const err = new Error(info.message || info.error || `request failed (HTTP ${res.status})`);
    err.status = res.status;
    err.code = info.error;
    throw err;
  }

  const out = { text: "", thinking: "", usage: null, error: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parsed = parseSSE(buf);
    buf = parsed.rest;
    for (const ev of parsed.events) {
      if (ev.done) continue;
      if (typeof ev.delta === "string") out.text += ev.delta;
      if (typeof ev.thinking === "string") out.thinking += ev.thinking;
      if (ev.usage) out.usage = ev.usage;
      if (ev.error) out.error = ev.error;
      onEvent?.(ev);
    }
  }
  return out;
}
