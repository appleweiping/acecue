// AceCue — landing page wiring.
import { I18N, mountLangSwitcher } from "./i18n.js";
import { Theme } from "./theme.js";

const MAKER = {
  name: "Weiping",
  email: "appleweiping@example.com",
  github: "https://github.com/appleweiping",
};

async function main() {
  Theme.init();
  await I18N.init();

  document.getElementById("theme-toggle")?.addEventListener("click", () => Theme.toggle());
  mountLangSwitcher(document.getElementById("lang-switch"));
  const ls2 = document.getElementById("lang-switch-2");
  if (ls2) mountLangSwitcher(ls2);

  document.getElementById("year").textContent = new Date().getFullYear();

  // maker contact (single source — edit MAKER above)
  const name = document.getElementById("maker-name"); if (name) name.textContent = MAKER.name;
  const em = document.getElementById("maker-email"); if (em) em.href = `mailto:${MAKER.email}`;
  const gh = document.getElementById("maker-github"); if (gh) gh.href = MAKER.github;

  // download button → extension zip (built/published later); falls back to install guide
  document.getElementById("download-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "/extension.zip";
  });

  // models strip from the live registry
  try {
    const r = await fetch("/api/models");
    const { providers } = await r.json();
    const strip = document.getElementById("models-strip");
    providers.forEach((p) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const tag = p.serverReady ? "ready" : p.freeTier ? "free" : "byok";
      chip.innerHTML = `<span class="dot"></span>${p.label} <span class="badge ${tag}" data-i18n="models.${tag}"></span>`;
      strip.appendChild(chip);
    });
    I18N.apply(strip);
  } catch { /* models endpoint optional on first paint */ }

  // re-render dynamic bits on language change
  I18N.onChange(() => {
    const strip = document.getElementById("models-strip");
    if (strip) I18N.apply(strip);
  });
}

main();
