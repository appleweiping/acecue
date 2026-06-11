// AceCue — model catalog endpoint (Vercel edge function).
//
// Returns the provider list with per-provider availability so the UI can show
// whether a model works out-of-the-box (operator key / relay) or needs the
// user to paste their own key (BYOK). No secrets are ever returned.

import { PROVIDERS, serverUsable } from "./_providers.js";

export const config = { runtime: "edge" };

export default async function handler() {
  const out = Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    models: p.models,
    freeTier: !!p.freeTier,
    fast: !!p.fast,
    relayCapable: !!p.relayCapable,
    // true => usable without the user typing a key
    serverReady: serverUsable(id, process.env),
  }));
  return new Response(JSON.stringify({ providers: out }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "s-maxage=60",
      "access-control-allow-origin": "*",
    },
  });
}
