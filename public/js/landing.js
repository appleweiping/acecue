// AceCue — landing page wiring.
import { I18N, mountLangSwitcher } from "./i18n.js";
import { Theme } from "./theme.js";

const MAKER = {
  name: "Weiping",
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
  const gh = document.getElementById("maker-github"); if (gh) gh.href = MAKER.github;

  // scroll-reveal: fade/slide sections in; also triggers SVG line-draw (.draw)
  initReveal();

  // 3D hero — lazy, optional, never blocks the page.
  initHeroLazy();

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

function initReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("in-view"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in-view");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -40px 0px" }
  );
  els.forEach((el) => io.observe(el));

  // line-draw containers (steps flow) reveal as a unit
  const flow = document.querySelector(".steps-flow");
  if (flow) {
    const io2 = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          flow.classList.add("in-view");
          io2.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io2.observe(flow);
  }
}

function initHeroLazy() {
  const canvas = document.getElementById("hero-canvas");
  if (!canvas) return;
  // Defer the heavy import until the browser is idle so first paint stays fast.
  const boot = () =>
    import("./hero-3d.js")
      .then((m) => m.initHero(canvas))
      .catch(() => { /* fallback: CSS gradient hero stays */ });
  if ("requestIdleCallback" in window) {
    requestIdleCallback(boot, { timeout: 2000 });
  } else {
    setTimeout(boot, 300);
  }
}

main();
