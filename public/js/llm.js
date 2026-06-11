// AceCue — LLM client. Talks to /api/chat (SSE of {delta}). Builds the
// interview-tailored system prompt from the user's résumé + JD + tone, and
// exposes a cancellable streaming call so we can speculatively fire on a partial
// question and abort if the transcript changes.

import { Store } from "./store.js";

const TONE_GUIDE = {
  concise: "Answer in 2-4 tight sentences. Lead with the point. No preamble.",
  balanced: "Answer in a focused short paragraph, then 1-3 bullet supporting points if useful.",
  detailed: "Give a thorough, structured answer with brief examples. Still skimmable.",
};

const LANG_NAME = { en: "English", zh: "Chinese", ja: "Japanese", ko: "Korean" };

// Build the system prompt for live interview answering.
export function buildLiveSystem(uiLang) {
  const s = Store.settings;
  const lang = s.interviewLang || uiLang || "en";
  const langName = LANG_NAME[lang] || "the interviewer's language";
  const tone = TONE_GUIDE[s.tone] || TONE_GUIDE.balanced;

  let p = `You are AceCue, a real-time interview copilot speaking *as the candidate*.
The user is in a live job interview. You will receive the interviewer's question (auto-transcribed, may contain small errors — infer intent).
Produce the answer the candidate should SAY, in first person ("I"), ready to read aloud naturally.
Reply in ${langName}. ${tone}
Be specific and confident; avoid filler and disclaimers. If it's a coding/technical question, give a correct, idiomatic solution in a code block plus a one-line explanation.
Never mention that you are an AI or that this is generated. Output only the answer.`;

  if (s.resume?.trim()) p += `\n\n--- Candidate résumé / background ---\n${s.resume.trim().slice(0, 4000)}`;
  if (s.jd?.trim()) p += `\n\n--- Target job description ---\n${s.jd.trim().slice(0, 2500)}`;
  return p;
}

// Stream a chat completion. onDelta(text) called per chunk. Returns a promise
// resolving to the full text. Pass an AbortSignal to cancel (speculative re-fire).
export async function streamChat({ provider, model, messages, temperature, signal, onDelta }) {
  const key = Store.getKey(provider);
  const headers = { "content-type": "application/json" };
  if (key) headers["x-user-key"] = key;

  const res = await fetch("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ provider, model, messages, temperature }),
    signal,
  });

  if (!res.ok) {
    let detail = "";
    try { detail = JSON.stringify(await res.json()); } catch {}
    const err = new Error(detail || `chat failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const j = JSON.parse(data);
        if (j.delta) { full += j.delta; onDelta?.(j.delta); }
      } catch { /* ignore */ }
    }
  }
  return full;
}

// One-shot (non-streaming consumer convenience) — collects the full answer.
export async function ask({ provider, model, system, user, temperature, signal, onDelta }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });
  return streamChat({ provider, model, messages, temperature, signal, onDelta });
}
