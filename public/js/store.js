// AceCue — client state store. Single source of truth in the browser.
//
// Persisted in localStorage. BYOK keys live under acecue.keys and NEVER sync to
// the cloud (account.js explicitly excludes them). Everything else (settings,
// résumé, JD, history) MAY sync if the user signs in.

const LS = {
  keys: "acecue.keys",        // { providerId: "sk-..." }
  settings: "acecue.settings",
  history: "acecue.history",
};

const DEFAULT_SETTINGS = {
  provider: "groq",
  model: "",            // "" → provider default
  stt: "browser",       // browser | deepgram | assembly
  tone: "balanced",     // concise | balanced | detailed
  autoAnswer: true,     // fire on detected question vs manual hotkey only
  opacity: 100,
  fontSize: 16,
  resume: "",
  jd: "",
  interviewLang: "",    // "" → follow UI language
};

function read(key, fallback) {
  try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key)) || {}) }; }
  catch { return { ...fallback }; }
}
function write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

export const Store = {
  settings: read(LS.settings, DEFAULT_SETTINGS),
  keys: read(LS.keys, {}),

  saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    write(LS.settings, this.settings);
  },
  get(k) { return this.settings[k]; },

  setKey(provider, key) {
    if (!key) delete this.keys[provider];
    else this.keys[provider] = key.trim();
    write(LS.keys, this.keys);
  },
  getKey(provider) { return this.keys[provider] || ""; },
  removeKey(provider) { delete this.keys[provider]; write(LS.keys, this.keys); },
  hasAnyKey() { return Object.keys(this.keys).length > 0; },

  // practice history (local; synced if logged in)
  history: JSON.parse(localStorage.getItem(LS.history) || "[]"),
  pushHistory(entry) {
    this.history.unshift({ ...entry, at: Date.now() });
    this.history = this.history.slice(0, 100);
    write(LS.history, this.history);
  },

  // export/import for cloud sync (keys excluded by design)
  exportSyncable() {
    const { resume, jd, tone, interviewLang, provider, model, stt } = this.settings;
    return { settings: { resume, jd, tone, interviewLang, provider, model, stt }, history: this.history };
  },
  importSyncable(data) {
    if (data?.settings) this.saveSettings(data.settings);
    if (Array.isArray(data?.history)) { this.history = data.history.slice(0, 100); write(LS.history, this.history); }
  },
};
