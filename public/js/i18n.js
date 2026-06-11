// AceCue — lightweight i18n. No framework: load locales/<lang>.json, swap
// [data-i18n] text/placeholders, persist choice, auto-detect navigator.language.
//
// Usage in HTML:
//   <h1 data-i18n="hero.title"></h1>
//   <input data-i18n-ph="settings.pasteKey">          (placeholder)
//   <a data-i18n-title="app.copy"></a>                (title attr)
// Then call: await I18N.init();  and I18N.set('zh') to switch.

const SUPPORTED = ["en", "zh", "ja", "ko"];
const FONT_STACK_KO = '"Apple SD Gothic Neo","Malgun Gothic",';

export const I18N = {
  lang: "en",
  dict: {},
  listeners: [],

  detect() {
    const saved = localStorage.getItem("acecue.lang");
    if (saved && SUPPORTED.includes(saved)) return saved;
    const nav = (navigator.language || "en").toLowerCase();
    if (nav.startsWith("zh")) return "zh";
    if (nav.startsWith("ja")) return "ja";
    if (nav.startsWith("ko")) return "ko";
    return "en";
  },

  async load(lang) {
    const res = await fetch(`/locales/${lang}.json`);
    if (!res.ok) throw new Error(`locale ${lang} failed`);
    return res.json();
  },

  // dot-path getter: t("hero.title")
  t(key) {
    return key.split(".").reduce((o, k) => (o == null ? o : o[k]), this.dict) ?? key;
  },

  apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = this.t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", this.t(el.getAttribute("data-i18n-ph")));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", this.t(el.getAttribute("data-i18n-title")));
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = this.t(el.getAttribute("data-i18n-html"));
    });
  },

  async init() {
    this.lang = this.detect();
    await this.set(this.lang, true);
    return this.lang;
  },

  async set(lang, silent = false) {
    if (!SUPPORTED.includes(lang)) lang = "en";
    this.dict = await this.load(lang);
    this.lang = lang;
    localStorage.setItem("acecue.lang", lang);
    document.documentElement.lang = lang;
    // Korean needs its font added to the front of the stack for clean rendering.
    if (lang === "ko") {
      document.documentElement.style.setProperty("--font-prefix", FONT_STACK_KO);
    } else {
      document.documentElement.style.removeProperty("--font-prefix");
    }
    this.apply();
    if (!silent) this.listeners.forEach((fn) => fn(lang));
  },

  onChange(fn) {
    this.listeners.push(fn);
  },

  supported: SUPPORTED,
};

// Build a compact language switcher into a container element.
export function mountLangSwitcher(container) {
  const names = { en: "EN", zh: "中", ja: "日", ko: "한" };
  container.innerHTML = "";
  container.classList.add("lang-switch");
  I18N.supported.forEach((l) => {
    const b = document.createElement("button");
    b.className = "lang-btn" + (l === I18N.lang ? " active" : "");
    b.textContent = names[l];
    b.setAttribute("aria-label", l);
    b.onclick = async () => {
      await I18N.set(l);
      container.querySelectorAll(".lang-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    };
    container.appendChild(b);
  });
}
