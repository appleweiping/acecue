// AceCue extension — service worker (MV3, module).
//
// Orchestrates: user clicks "Listen" → we grab a tabCapture stream ID for the
// active tab (must originate from a user gesture), spin up the offscreen
// document (which can call getUserMedia + run the audio pipeline), and open the
// floating overlay window. The offscreen doc transcribes and talks to the
// Vercel API; this worker just coordinates and forwards messages.
//
// Honest constraint baked in: the overlay is a separate popup window so it is
// NOT captured when the candidate shares a single tab — but a full-screen share
// will still show it. We surface that in the overlay UI itself.

const API_BASE = "https://acecue.vercel.app";
let overlayWindowId = null;

chrome.action.onClicked?.addListener?.(async (tab) => { /* popup handles UI */ });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "START_CAPTURE": {
        const ok = await startCapture(msg.tabId);
        sendResponse({ ok });
        break;
      }
      case "STOP_CAPTURE": {
        await stopCapture();
        sendResponse({ ok: true });
        break;
      }
      case "OPEN_OVERLAY": {
        await openOverlay();
        sendResponse({ ok: true });
        break;
      }
      case "TRANSCRIPT":
      case "QUESTION":
      case "ANSWER_DELTA":
      case "ANSWER_DONE":
        // relay offscreen → overlay window
        chrome.runtime.sendMessage(msg).catch(() => {});
        break;
    }
  })();
  return true; // async
});

chrome.commands?.onCommand.addListener(async (command) => {
  if (command === "toggle-overlay") await openOverlay();
  if (command === "panic-hide" && overlayWindowId != null) {
    chrome.windows.update(overlayWindowId, { state: "minimized" }).catch(() => {});
  }
});

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capture and transcribe interview tab audio for the candidate.",
  });
}

async function startCapture(tabId) {
  try {
    const targetTabId = tabId ?? (await activeTabId());
    // must be called after a user gesture (popup button click satisfies this)
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId });
    await ensureOffscreen();
    await openOverlay();
    chrome.runtime.sendMessage({ type: "OFFSCREEN_START", streamId }).catch(() => {});
    return true;
  } catch (e) {
    console.error("startCapture failed", e);
    return false;
  }
}

async function stopCapture() {
  chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" }).catch(() => {});
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function openOverlay() {
  if (overlayWindowId != null) {
    try { await chrome.windows.update(overlayWindowId, { focused: true, state: "normal" }); return; }
    catch { overlayWindowId = null; }
  }
  const win = await chrome.windows.create({
    url: "overlay.html",
    type: "popup",
    width: 440,
    height: 620,
    top: 80,
    left: 80,
  });
  overlayWindowId = win.id;
}

chrome.windows?.onRemoved.addListener((id) => { if (id === overlayWindowId) overlayWindowId = null; });
