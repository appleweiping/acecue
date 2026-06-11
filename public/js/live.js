// AceCue — Live Assistant view. Wires capture → STT → question detection →
// streaming answer, plus glance/full, opacity/font, hotkeys, onboarding.

import { I18N } from "./i18n.js";
import { Store } from "./store.js";
import { getCatalog, findProvider, recommendedFast } from "./providers.js";
import { BrowserSTT, DeepgramSTT, sttLangTag, captureTabAudio } from "./stt.js";
import { buildLiveSystem, streamChat } from "./llm.js";
import { renderMarkdown } from "./md.js";

let toast, stt = null, capture = null, abortCtrl = null;
let listening = false, mode = "full";
let lastQuestion = "";

const $ = (id) => document.getElementById(id);

export function initLive(ctx) {
  toast = ctx.toast;

  populateModels();
  applyAnswerStyle();

  $("btn-listen").addEventListener("click", toggleListen);
  $("btn-clear").addEventListener("click", clearAll);
  $("btn-regen").addEventListener("click", () => { if (lastQuestion) answer(lastQuestion); });
  $("btn-copy").addEventListener("click", copyAnswer);
  $("ask-send").addEventListener("click", submitTyped);
  $("ask-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submitTyped(); });

  $("seg-mode").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode)));

  $("font-range").value = Store.get("fontSize");
  $("opacity-range").value = Store.get("opacity");
  $("font-range").addEventListener("input", (e) => { Store.saveSettings({ fontSize: +e.target.value }); applyAnswerStyle(); });
  $("opacity-range").addEventListener("input", (e) => { Store.saveSettings({ opacity: +e.target.value }); applyAnswerStyle(); });

  $("live-model").addEventListener("change", (e) => {
    const [provider, model] = e.target.value.split("::");
    Store.saveSettings({ provider, model: model || "" });
  });

  // onboarding modal buttons
  $("ob-start").addEventListener("click", () => startCapture("tab"));
  $("ob-mic").addEventListener("click", () => startCapture("mic"));
  $("ob-type").addEventListener("click", () => { closeModal(); beginListening("type"); });

  // hotkeys
  document.addEventListener("keydown", onHotkey);

  window.addEventListener("acecue:lang", () => { populateModels(); if (stt) stt.setLang?.(sttLangTag(interviewLang())); });
}

function interviewLang() { return Store.get("interviewLang") || I18N.lang; }

function populateModels() {
  const sel = $("live-model");
  const cur = `${Store.get("provider")}::${Store.get("model") || ""}`;
  sel.innerHTML = "";
  getCatalog().forEach((p) => {
    p.models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = `${p.id}::${m}`;
      const tag = p.fast ? " ⚡" : "";
      opt.textContent = `${p.label} · ${m}${tag}`;
      sel.appendChild(opt);
    });
  });
  // select stored, else recommend a fast one
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  else { const r = recommendedFast(); sel.value = [...sel.options].find((o) => o.value.startsWith(r + "::"))?.value || sel.options[0]?.value; const [pr, md] = sel.value.split("::"); Store.saveSettings({ provider: pr, model: md || "" }); }
}

function applyAnswerStyle() {
  document.documentElement.style.setProperty("--answer-font", Store.get("fontSize") + "px");
  $("answer-body").style.opacity = Store.get("opacity") / 100;
}

function setMode(m) {
  mode = m;
  $("seg-mode").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  $("answer-body").classList.toggle("glance", m === "glance");
}

// ---- listening lifecycle ----
function toggleListen() {
  if (listening) return stopListening();
  // Inside the extension overlay, audio is provided by the service worker, so
  // skip the picker. In the web app, open onboarding to capture tab audio.
  if (window.ACECUE_EXT) beginListening("ext");
  else openModal();
}

function openModal() { $("onboard-modal").classList.add("open"); }
function closeModal() { $("onboard-modal").classList.remove("open"); }

async function startCapture(kind) {
  closeModal();
  try {
    if (kind === "tab") {
      capture = await captureTabAudio();
      beginListening("tab", capture.stream);
    } else if (kind === "mic") {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      capture = { stream };
      beginListening("mic", stream);
    }
  } catch (e) {
    if (String(e.message).includes("no-tab-audio")) toast(I18N.t("onboard.step3"));
    else toast(I18N.t("errors.captureFailed"));
  }
}

function beginListening(kind, stream) {
  const lang = interviewLang();
  const sttMode = Store.get("stt");
  const handlers = {
    onInterim: (t) => renderTranscript(t, true),
    onFinal: (t) => renderTranscript(t, false),
    onQuestion: (q) => onQuestion(q),
  };

  if (sttMode === "deepgram" && Store.getKey("deepgram") && stream) {
    stt = new DeepgramSTT({ apiKey: Store.getKey("deepgram"), lang, ...handlers });
    stt.start(stream);
  } else {
    // Browser Web Speech (free). Listens to the mic; for tab-audio the question
    // is heard aloud through the speakers we routed it to.
    stt = new BrowserSTT({ lang: sttLangTag(lang), ...handlers });
    if (stt.unsupported) { toast(I18N.t("errors.speechUnsupported")); return; }
    stt.start();
  }

  listening = true;
  $("status-dot").classList.add("live");
  $("btn-listen").textContent = I18N.t("app.stop");
  $("btn-listen").classList.remove("primary"); $("btn-listen").classList.add("outline");
}

function stopListening() {
  listening = false;
  try { stt?.stop(); } catch {}
  try { capture?.stream?.getTracks().forEach((t) => t.stop()); capture?.ctx?.close(); } catch {}
  stt = null; capture = null;
  $("status-dot").classList.remove("live");
  $("btn-listen").textContent = I18N.t("app.listen");
  $("btn-listen").classList.add("primary"); $("btn-listen").classList.remove("outline");
}

// ---- transcript + answering ----
let interimEl = null;
function renderTranscript(text, isInterim) {
  const box = $("transcript");
  if (isInterim) {
    if (!interimEl) { interimEl = document.createElement("div"); interimEl.className = "transcript-line interim"; box.appendChild(interimEl); }
    interimEl.textContent = text;
  } else {
    if (interimEl) { interimEl.remove(); interimEl = null; }
    const line = document.createElement("div");
    line.className = "transcript-line";
    line.textContent = text;
    box.appendChild(line);
  }
  box.scrollTop = box.scrollHeight;
}

function onQuestion(q) {
  // mark the question in the transcript
  const lines = $("transcript").querySelectorAll(".transcript-line:not(.interim)");
  if (lines.length) lines[lines.length - 1].classList.add("q");
  if (Store.get("autoAnswer")) answer(q);
}

async function answer(question) {
  lastQuestion = question;
  abortCtrl?.abort();
  abortCtrl = new AbortController();

  const body = $("answer-body");
  body.classList.remove("answer-empty");
  body.innerHTML = `<span class="cursor"></span>`;

  const provider = Store.get("provider");
  const model = Store.get("model");
  const system = buildLiveSystem(I18N.lang);
  const userMsg = mode === "glance"
    ? `Interviewer asked: "${question}"\n\nAnswer as 3 short bullet cue points I can glance at and expand while speaking.`
    : `Interviewer asked: "${question}"`;

  let full = "";
  try {
    await streamChat({
      provider, model,
      messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
      temperature: 0.4,
      signal: abortCtrl.signal,
      onDelta: (d) => { full += d; body.innerHTML = renderMarkdown(full) + `<span class="cursor"></span>`; body.parentElement.scrollTop = body.parentElement.scrollHeight; },
    });
    body.innerHTML = renderMarkdown(full);
  } catch (e) {
    if (e.name === "AbortError") return;
    if (e.status === 401) toast(I18N.t("errors.noKey"));
    else toast(I18N.t("errors.upstream"));
    body.innerHTML = `<div class="answer-empty">${I18N.t("errors.upstream")}</div>`;
  }
}

function submitTyped() {
  const v = $("ask-input").value.trim();
  if (!v) return;
  renderTranscript(v, false);
  const lines = $("transcript").querySelectorAll(".transcript-line:not(.interim)");
  if (lines.length) lines[lines.length - 1].classList.add("q");
  $("ask-input").value = "";
  answer(v);
}

function clearAll() {
  $("transcript").innerHTML = "";
  $("answer-body").innerHTML = `<div class="answer-empty">${I18N.t("app.waitingQuestion")}</div>`;
  lastQuestion = ""; interimEl = null;
}

function copyAnswer() {
  navigator.clipboard.writeText($("answer-body").innerText).then(() => toast(I18N.t("app.copied")));
}

// ---- hotkeys: Space=listen, G=glance, Enter=regen, Esc=panic-hide ----
function onHotkey(e) {
  if (!document.getElementById("view-live").classList.contains("active")) return;
  const typing = ["INPUT", "TEXTAREA"].includes(e.target.tagName);
  if (typing) return;
  if (e.code === "Space") { e.preventDefault(); toggleListen(); }
  else if (e.key.toLowerCase() === "g") { setMode(mode === "glance" ? "full" : "glance"); }
  else if (e.key === "Enter") { if (lastQuestion) answer(lastQuestion); }
  else if (e.key === "Escape") { document.body.classList.toggle("hidden-panic"); $("answer-body").style.visibility = $("answer-body").style.visibility === "hidden" ? "visible" : "hidden"; }
}
