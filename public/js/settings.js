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
  let provider = detectedProvider;
  if (!provider) {
    // ask the user to pick from a quick prompt of known providers
    provider = pickProviderFallback();
    if (!provider) return;
  }
  Store.setKey(provider, key);
  $("key-input").value = "";
  $("key-detected").textContent = "—"; $("key-detected").className = "detected-tag";
  detectedProvider = null;
  renderSavedKeys();
  toast(I18N.t("settings.saved"));
}

// If detection fails, build a tiny inline <select> the user can choose from.
function pickProviderFallback() {
  const ids = getCatalog().map((p) => p.id);
  const labels = getCatalog().map((p) => p.label).join(", ");
  const choice = window.prompt(`${I18N.t("settings.notDetected")}\n(${labels})`, ids[0] || "");
  return ids.includes(choice) ? choice : null;
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
