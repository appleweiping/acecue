// AceCue — Settings view. Single-key paste auto-detect, résumé/JD context,
// STT engine choice, answer tone. All stored locally via Store.

import { I18N } from "./i18n.js";
import { Store } from "./store.js";
import { detectProvider, findProvider, getCatalog } from "./providers.js";

let toast;
const $ = (id) => document.getElementById(id);

export function initSettings(ctx) {
  toast = ctx.toast;

  // hydrate fields
  $("set-resume").value = Store.get("resume");
  $("set-jd").value = Store.get("jd");
  $("set-stt").value = Store.get("stt");
  $("set-tone").value = Store.get("tone");

  // single-key paste → live detect
  $("key-input").addEventListener("input", onKeyInput);
  $("key-save").addEventListener("click", saveKey);
  $("settings-save").addEventListener("click", saveAll);

  // inline provider picker (fallback when auto-detect fails)
  $("provider-pick-confirm").addEventListener("click", confirmProviderPick);
  $("provider-pick-cancel").addEventListener("click", hideProviderPick);
  $("provider-pick").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); hideProviderPick(); }
  });

  renderSavedKeys();
  window.addEventListener("acecue:view", (e) => { if (e.detail === "settings") renderSavedKeys(); });
}

let detectedProvider = null;

function onKeyInput(e) {
  const key = e.target.value.trim();
  const tag = $("key-detected");
  if (!key) { tag.textContent = "—"; tag.className = "detected-tag"; detectedProvider = null; return; }
  detectedProvider = detectProvider(key);
  if (detectedProvider) {
    const p = findProvider(detectedProvider);
    tag.textContent = `${I18N.t("settings.detected")}: ${p?.label || detectedProvider}`;
    tag.className = "detected-tag ok";
  } else {
    tag.textContent = I18N.t("settings.notDetected");
    tag.className = "detected-tag";
  }
}

function saveKey() {
  const key = $("key-input").value.trim();
  if (!key) return;
  if (!detectedProvider) {
    // detection failed → show the accessible inline picker instead
    showProviderPick();
    return;
  }
  commitKey(detectedProvider, key);
}

function commitKey(provider, key) {
  Store.setKey(provider, key);
  $("key-input").value = "";
  $("key-detected").textContent = "—"; $("key-detected").className = "detected-tag";
  detectedProvider = null;
  hideProviderPick();
  renderSavedKeys();
  toast(I18N.t("settings.saved"));
}

// When detection fails, reveal an inline <select> of known providers with an
// explicit confirm — keyboard- and screen-reader-friendly (label/for + focus).
// Static fallback if /api/models hasn't loaded — mirrors detectProvider().
const FALLBACK_PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "groq", label: "Groq" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "openrouter", label: "OpenRouter" },
];

function showProviderPick() {
  const sel = $("provider-pick-select");
  sel.innerHTML = "";
  const catalog = getCatalog();
  (catalog.length ? catalog : FALLBACK_PROVIDERS).forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label || p.id;
    sel.appendChild(opt);
  });
  $("provider-pick").hidden = false;
  sel.focus();
}

function hideProviderPick() {
  $("provider-pick").hidden = true;
}

function confirmProviderPick() {
  const key = $("key-input").value.trim();
  const provider = $("provider-pick-select").value;
  if (!key || !provider) { hideProviderPick(); return; }
  commitKey(provider, key);
}

function renderSavedKeys() {
  const box = $("saved-keys");
  box.innerHTML = "";
  Object.entries(Store.keys).forEach(([provider, key]) => {
    const p = findProvider(provider);
    const row = document.createElement("div");
    row.className = "saved-key";
    row.innerHTML = `<span class="label">${p?.label || provider}</span>
      <span class="masked">${maskKey(key)}</span>
      <button class="btn outline sm" data-rm="${provider}">${I18N.t("settings.removeKey")}</button>`;
    box.appendChild(row);
  });
  box.querySelectorAll("[data-rm]").forEach((b) =>
    b.addEventListener("click", () => { Store.removeKey(b.dataset.rm); renderSavedKeys(); }));
}

function maskKey(k) { return k.length <= 10 ? "••••" : k.slice(0, 5) + "•••••" + k.slice(-3); }

function saveAll() {
  Store.saveSettings({
    resume: $("set-resume").value,
    jd: $("set-jd").value,
    stt: $("set-stt").value,
    tone: $("set-tone").value,
  });
  toast(I18N.t("settings.saved"));
}
