// AceCue — provider auto-detect endpoint (Vercel edge function).
//
// The user pastes ONE key in Settings; we infer which provider it belongs to
// from the key's shape. This runs the SAME heuristic client-side too (in
// public/js/providers.js) — this endpoint is a convenience/parity mirror so
// non-extension clients can confirm detection without bundling the logic.
//
// We never store the key. We only echo back the inferred provider id.

import { detectProvider, PROVIDERS } from "./_providers.js";

export const config = { runtime: "edge" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const id = detectProvider(body?.key || "");
  const p = id ? PROVIDERS[id] : null;
  return json({
    provider: id,
    label: p?.label || null,
    models: p?.models || [],
    detected: !!id,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}
