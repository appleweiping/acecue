// AceCue extension — popup. The click here is the user gesture that authorizes
// tabCapture. We grab the active tab id and hand off to the service worker.

const API_BASE = "https://acecue.vercel.app";

document.getElementById("start").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const btn = document.getElementById("start");
  btn.textContent = "Starting…"; btn.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: "START_CAPTURE", tabId: tab.id });
  if (res?.ok) { window.close(); }
  else { btn.textContent = "Couldn't capture — try again"; btn.disabled = false; }
});

document.getElementById("open-app").addEventListener("click", () => {
  chrome.tabs.create({ url: `${API_BASE}/app` });
});
