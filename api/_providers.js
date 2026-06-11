// AceCue — provider registry (server-side, ESM, used by edge functions).
//
// Architecture: nearly every model speaks an OpenAI-compatible protocol, so we
// keep ONE registry mapping each provider to its base URL + model IDs + the env
// var holding the operator key. Only Anthropic uses its own /v1/messages shape;
// we translate to/from OpenAI shape so the frontend always speaks one language.
//
// Auth resolution order (per request): user BYOK key (header) → operator env
// key → optional relay. A provider is "usable" if any of these is present.
//
// For an interview copilot, FIRST-TOKEN LATENCY matters more than anything.
// `fast: true` flags providers/models that stream first tokens quickly (Groq,
// Gemini Flash, Haiku, deepseek-chat) — the UI recommends these for live mode.

export const PROVIDERS = {
  groq: {
    label: "Groq",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    relayCapable: false,
    freeTier: true, // generous free tier; fastest first-token in the market
    fast: true,
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"],
  },
  openai: {
    label: "ChatGPT",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    relayCapable: true,
    models: ["gpt-4o-mini", "gpt-4o", "o4-mini"],
    fast: true,
  },
  gemini: {
    label: "Gemini",
    protocol: "openai", // Google's OpenAI-compatible endpoint
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    relayCapable: false,
    freeTier: true, // Google AI Studio offers a genuine free tier
    fast: true,
    models: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-pro"],
  },
  claude: {
    label: "Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
    relayCapable: true,
    fast: true,
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8"],
  },
  deepseek: {
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    relayCapable: true,
    fast: true,
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  openrouter: {
    label: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    relayCapable: false,
    freeTier: true, // many ":free" models
    models: ["google/gemini-2.0-flash-exp:free", "meta-llama/llama-3.3-70b-instruct", "anthropic/claude-3.5-sonnet"],
  },
  qwen: {
    label: "Qwen",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envKey: "DASHSCOPE_API_KEY",
    relayCapable: true,
    freeTier: true, // DashScope grants free quota to new accounts
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
  },
  glm: {
    label: "GLM",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    envKey: "ZHIPU_API_KEY",
    relayCapable: true,
    freeTier: true, // glm-4-flash is free
    models: ["glm-4-flash", "glm-4-air", "glm-4-plus"],
  },
  kimi: {
    label: "Kimi",
    protocol: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    envKey: "MOONSHOT_API_KEY",
    relayCapable: true,
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  minimax: {
    label: "MiniMax",
    protocol: "openai",
    baseUrl: "https://api.minimaxi.com/v1",
    envKey: "MINIMAX_API_KEY",
    relayCapable: true,
    models: ["MiniMax-Text-01", "abab6.5s-chat"],
  },
  doubao: {
    label: "Doubao",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    envKey: "ARK_API_KEY",
    relayCapable: true,
    // Volcano Ark uses endpoint IDs; users may override the model id in Settings.
    models: ["doubao-pro-32k", "doubao-lite-32k"],
  },
  ernie: {
    label: "ERNIE",
    protocol: "openai",
    baseUrl: "https://qianfan.baidubce.com/v2",
    envKey: "QIANFAN_API_KEY",
    relayCapable: true,
    freeTier: true, // ernie-speed / ernie-lite are free
    models: ["ernie-speed-128k", "ernie-lite-8k", "ernie-4.0-turbo-8k"],
  },
};

// Resolve which key + base URL + protocol to use for a request.
// byokKey: key the user pasted in their browser (forwarded via X-User-Key).
export function resolveAuth(providerId, byokKey, env) {
  const p = PROVIDERS[providerId];
  if (!p) return { error: `unknown provider: ${providerId}` };

  // 1) user's own key wins (BYOK) — always hits the official upstream
  if (byokKey && byokKey.trim()) {
    return { key: byokKey.trim(), baseUrl: p.baseUrl, protocol: p.protocol, source: "byok" };
  }
  // 2) operator's official key from env
  const envVal = env[p.envKey];
  if (envVal && envVal.trim()) {
    return { key: envVal.trim(), baseUrl: p.baseUrl, protocol: p.protocol, source: "operator" };
  }
  // 3) optional relay (OpenAI-compatible) for providers that allow it
  if (p.relayCapable && env.RELAY_BASE_URL && env.RELAY_API_KEY) {
    return {
      key: env.RELAY_API_KEY.trim(),
      baseUrl: env.RELAY_BASE_URL.replace(/\/$/, ""),
      protocol: "openai", // relay normalizes everything to OpenAI shape
      source: "relay",
    };
  }
  return { error: "no-auth", needsByok: true };
}

// Which providers are usable without the user typing a key (for the UI badge).
export function serverUsable(providerId, env) {
  const p = PROVIDERS[providerId];
  if (!p) return false;
  if (env[p.envKey] && env[p.envKey].trim()) return true;
  if (p.relayCapable && env.RELAY_BASE_URL && env.RELAY_API_KEY) return true;
  return false;
}

// Heuristic: infer a provider id from the shape of an API key the user pasted.
// Used by api/detect.js and the client so a user can paste ONE key and we
// figure out which provider it belongs to. Returns a provider id or null.
export function detectProvider(key) {
  if (!key || typeof key !== "string") return null;
  const k = key.trim();
  if (/^sk-ant-/.test(k)) return "claude";
  if (/^sk-or-/.test(k)) return "openrouter";
  if (/^gsk_/.test(k)) return "groq";
  if (/^AIza/.test(k)) return "gemini";
  if (/^sk-[0-9a-f]{32,}$/i.test(k) && k.length < 45) return "deepseek"; // deepseek keys are sk-<32 hex>
  if (/^sk-/.test(k)) return "openai"; // generic OpenAI-style (after more specific checks)
  return null; // unknown → let the user pick the provider manually
}
