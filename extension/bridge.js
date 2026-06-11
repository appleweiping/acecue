// AceCue extension — content bridge. Runs on the AceCue web origin and mirrors
// the app's localStorage config (keys, settings) into chrome.storage.local so
// the offscreen doc + overlay can use the same BYOK keys the user configured in
// the web app. Keys stay on-device; this is a local browser→extension copy only.

function syncToExtension() {
  const out = {};
  for (const k of ["acecue.keys", "acecue.settings"]) {
    const v = localStorage.getItem(k);
    if (v != null) out[k] = v;
  }
  if (Object.keys(out).length) chrome.storage.local.set(out);
}

// initial sync + on focus + whenever the app updates storage
syncToExtension();
window.addEventListener("focus", syncToExtension);
window.addEventListener("storage", syncToExtension);
setInterval(syncToExtension, 4000);
