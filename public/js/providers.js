// AceCue — client-side provider registry mirror + key auto-detect.
//
// The authoritative registry lives server-side (api/_providers.js); the client
// fetches /api/models for availability. detectProvider() mirrors the server
// heuristic so a pasted key resolves to a provider instantly, with no round trip.

let CATALOG = null; // cached /api/models result

export async function loadCatalog() {
  if (CATALOG) return CATALOG;
  try {
    const r = await fetch("/api/models");
    CATALOG = (await r.json()).providers || [];
  } catch {
    CATALOG = [];
  }
  return CATALOG;
}

export function getCatalog() { return CATALOG || []; }
export function findProvider(id) { return (CATALOG || []).find((p) => p.id === id) || null; }

// Mirror of api/_providers.js detectProvider — keep in sync.
export function detectProvider(key) {
  if (!key || typeof key !== "string") return null;
  const k = key.trim();
  if (/^sk-ant-/.test(k)) return "claude";
  if (/^sk-or-/.test(k)) return "openrouter";
  if (/^gsk_/.test(k)) return "groq";
  if (/^AIza/.test(k)) return "gemini";
  if (/^sk-[0-9a-f]{32,}$/i.test(k) && k.length < 45) return "deepseek";
  if (/^sk-/.test(k)) return "openai";
  return null;
}

// Recommend a fast, free-tier-friendly default if the user has no key yet.
export function recommendedFast() {
  const cat = CATALOG || [];
  const fastFree = cat.find((p) => p.fast && (p.freeTier || p.serverReady));
  return (fastFree || cat.find((p) => p.fast) || cat[0])?.id || "groq";
}
