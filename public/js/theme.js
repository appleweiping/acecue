// AceCue — shared theme toggle (light/dark), persisted.
export const Theme = {
  init() {
    const saved = localStorage.getItem("acecue.theme");
    const sys = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    this.set(saved || sys, true);
  },
  set(mode, silent) {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("acecue.theme", mode);
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = mode === "dark" ? "☀️" : "🌙";
  },
  toggle() {
    const cur = document.documentElement.getAttribute("data-theme");
    this.set(cur === "dark" ? "light" : "dark");
  },
};
