// AceCue — app shell: router, shared init, and view wiring.
import { I18N, mountLangSwitcher } from "./i18n.js";
import { Theme } from "./theme.js";
import { Store } from "./store.js";
import { loadCatalog } from "./providers.js";
import { initLive } from "./live.js";
import { initPractice } from "./practice.js";
import { initSettings } from "./settings.js";
import { initAccount } from "./account.js";

const VIEWS = ["live", "practice", "settings", "account"];

export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1800);
}

function route() {
  const hash = (location.hash.replace(/^#\/?/, "") || "live").split("/")[0];
  const view = VIEWS.includes(hash) ? hash : "live";
  VIEWS.forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle("active", v === view);
    document.querySelector(`.tab[data-route="${v}"]`)?.classList.toggle("active", v === view);
  });
  window.dispatchEvent(new CustomEvent("acecue:view", { detail: view }));
}

async function main() {
  Theme.init();
  await I18N.init();
  await loadCatalog();

  document.getElementById("theme-toggle")?.addEventListener("click", () => Theme.toggle());
  mountLangSwitcher(document.getElementById("lang-switch"));

  document.querySelectorAll(".tab[data-route]").forEach((t) => {
    t.addEventListener("click", () => { location.hash = `/${t.dataset.route}`; });
  });
  window.addEventListener("hashchange", route);

  // init each view module (they attach their own handlers)
  initLive({ toast });
  initPractice({ toast });
  initSettings({ toast });
  initAccount({ toast });

  route();

  // re-apply translations to anything dynamic when language changes
  I18N.onChange(() => {
    window.dispatchEvent(new CustomEvent("acecue:lang", { detail: I18N.lang }));
  });
}

main();
