// AceCue page logic: setup, asking questions, collecting answers, feedback.

import { ROLES, nextQuestion, looksTechnical } from "./questions.js";
import { checkAnswer, wordCount } from "./star-check.js";
import { questionMessages, feedbackMessages, parseFeedback, sessionMarkdown } from "./coach.js";
import { streamChat } from "./stream-client.js";
import { Dictation, speechSupported, speechLang } from "./speech.js";
import { SAMPLE_RESUME, SAMPLE_JD, SAMPLE_QUESTION, SAMPLE_ANSWER } from "./sample.js";

const $ = (id) => document.getElementById(id);
const PREFS_KEY = "acecue.prefs";
const SESSION_KEY = "acecue.session";

let catalog = [];          // providers from /api/models
let session = null;        // { roleLabel, type, engineLabel, startedAt, items: [] }
let current = null;        // { question, kind, source, recorded, feedback }
let timer = { start: 0, id: 0 };
let busy = false;
let dictation = null;

// ---------- storage helpers (localStorage can be unavailable) ----------
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const keyStore = {
  name: (p) => `acecue.key.${p}`,
  get(p) {
    try { return localStorage.getItem(this.name(p)) || sessionStorage.getItem(this.name(p)) || ""; } catch { return ""; }
  },
  set(p, key, remember) {
    try {
      localStorage.removeItem(this.name(p));
      sessionStorage.removeItem(this.name(p));
      if (key) (remember ? localStorage : sessionStorage).setItem(this.name(p), key);
    } catch { /* ignore */ }
  },
  remembered(p) { try { return Boolean(localStorage.getItem(this.name(p))); } catch { return false; } },
};

// ---------- small DOM helper ----------
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 3200);
}

// ---------- setup ----------
function readSetup() {
  const role = $("role").value;
  return {
    role,
    roleLabel: ROLES[role]?.label || role,
    type: $("qtype").value,
    lang: $("lang").value,
    resume: $("resume").value,
    jd: $("jd").value,
    engine: document.querySelector('input[name="engine"]:checked').value,
    provider: $("provider").value,
    model: $("model").value.trim(),
    key: $("key").value.trim(),
  };
}

function savePrefs() {
  const s = readSetup();
  store.set(PREFS_KEY, { role: s.role, type: s.type, lang: s.lang, resume: s.resume, jd: s.jd, engine: s.engine, provider: s.provider, model: s.model });
}

function engineLabel(s) {
  if (s.engine !== "ai") return "Offline checker (rule-based, no AI)";
  const p = catalog.find((x) => x.id === s.provider);
  return `${s.model || p?.models[0]} via ${p?.label || s.provider}`;
}

function fillProviders(selected) {
  const sel = $("provider");
  sel.innerHTML = "";
  for (const p of catalog) sel.append(el("option", { value: p.id }, p.label));
  if (selected && catalog.some((p) => p.id === selected)) sel.value = selected;
}

function onProviderChange(keepModel) {
  const p = catalog.find((x) => x.id === $("provider").value);
  const list = $("model-list");
  list.innerHTML = "";
  for (const m of p?.models || []) list.append(el("option", { value: m }));
  if (!keepModel || !$("model").value) $("model").value = p?.models[0] || "";
  $("key").value = keyStore.get($("provider").value);
  $("remember").checked = keyStore.remembered($("provider").value);
  updateKeyNote();
}

function updateKeyNote() {
  const p = catalog.find((x) => x.id === $("provider").value);
  const note = $("key-note");
  if (!catalog.length) {
    note.textContent = "The /api/models endpoint is not reachable, so AI mode is unavailable here. Run the app with npm run dev or on Vercel.";
  } else if (p?.operatorKey && !$("key").value) {
    note.textContent = "This deployment has its own key for this provider, so you can leave this empty (rate-limited).";
  } else {
    note.textContent = "Sent with each request to this site's /api/chat, which passes it to the provider and does not store it.";
  }
}

function detectFromKey() {
  const key = $("key").value.trim();
  if (!key) return;
  const match = catalog.find((p) => p.keyPattern && new RegExp(p.keyPattern).test(key));
  if (match && match.id !== $("provider").value) {
    $("provider").value = match.id;
    onProviderChange(false);
    $("key").value = key;
    toast(`That key looks like it is for ${match.label}, so the provider was switched.`);
  }
}

function syncEngineUi() {
  const ai = document.querySelector('input[name="engine"]:checked').value === "ai";
  $("ai-settings").hidden = !ai;
}

// ---------- session ----------
function persistSession() {
  if (session) store.set(SESSION_KEY, session);
}

function renderHistory() {
  const box = $("session");
  const list = $("history");
  list.innerHTML = "";
  if (!session || !session.items.length) { box.hidden = true; return; }
  box.hidden = false;
  for (const it of session.items) {
    list.append(el("li", {},
      it.question,
      it.feedback ? el("span", { class: "s" }, `${it.feedback.score}/10`) : el("span", { class: "muted" }, " (skipped)")));
  }
}

function newSession(s) {
  session = { roleLabel: s.roleLabel, type: s.type, engineLabel: engineLabel(s), startedAt: Date.now(), items: [] };
  persistSession();
  renderHistory();
}

function recordCurrent(answer, feedback) {
  if (!current || !session) return;
  const item = { question: current.question, answer, feedback };
  if (current.recorded != null) session.items[current.recorded] = item;
  else { session.items.push(item); current.recorded = session.items.length - 1; }
  persistSession();
  renderHistory();
}

// ---------- asking ----------
function kindFor(type, question) {
  if (type === "technical") return "technical";
  if (type === "behavioral") return "star";
  return looksTechnical(question) ? "technical" : "star";
}

function showQuestion(text, source) {
  current = { question: text, kind: kindFor(readSetup().type, text), source, recorded: null, feedback: null };
  $("intro").hidden = true;
  $("run").hidden = false;
  $("question").textContent = text;
  $("qnum").textContent = `Question ${session ? session.items.length + 1 : 1}`;
  $("qkind").textContent = current.kind === "technical" ? "technical" : "behavioral - STAR";
  $("qsource").textContent = source;
  $("answer").value = "";
  $("feedback").hidden = true;
  $("feedback").innerHTML = "";
  updateWordCount();
  startTimer();
}

async function ask(followUp) {
  if (busy) return;
  const s = readSetup();
  if (followUp) return showQuestion(followUp, "follow-up");
  const asked = session ? session.items.map((i) => i.question) : [];

  if (s.engine !== "ai") return showQuestion(nextQuestion(s.role, s.type, asked), "from the built-in question bank");

  setBusy(true);
  $("intro").hidden = true;
  $("run").hidden = false;
  $("question").textContent = "Thinking of a question...";
  $("qsource").textContent = "";
  try {
    let text = "";
    const res = await streamChat({
      provider: s.provider, model: s.model, key: s.key, maxTokens: 2048,
      messages: questionMessages(s, asked),
      onEvent: (ev) => { if (ev.delta) { text += ev.delta; $("question").textContent = text; } },
    });
    if (res.error) throw new Error(res.error);
    const q = res.text.trim().replace(/^["'“]|["'”]$/g, "");
    if (!q) throw new Error("the model returned an empty question");
    showQuestion(q, `asked by ${s.model}`);
  } catch (e) {
    toast(`AI question failed: ${e.message}. Using the built-in bank instead.`);
    showQuestion(nextQuestion(s.role, s.type, asked), "from the built-in question bank");
  } finally {
    setBusy(false);
  }
}

// ---------- feedback ----------
async function giveFeedback() {
  if (busy || !current) return;
  const answer = $("answer").value.trim();
  if (wordCount(answer) < 5) { toast("Write or dictate an answer first."); return; }
  dictation?.stop();
  stopTimer();
  const s = readSetup();

  if (s.engine !== "ai") {
    const fb = checkAnswer(answer, current.kind);
    current.feedback = fb;
    renderFeedback(fb, "Offline checker (rule-based, no AI)");
    recordCurrent(answer, fb);
    return;
  }

  setBusy(true);
  const box = $("feedback");
  box.hidden = false;
  box.innerHTML = "";
  const status = el("p", { class: "working" }, "Reviewing your answer...");
  box.append(status);
  try {
    let n = 0;
    const res = await streamChat({
      provider: s.provider, model: s.model, key: s.key, maxTokens: 4096, temperature: 0.3,
      messages: feedbackMessages(s, current.question, answer, current.kind),
      onEvent: (ev) => {
        if (ev.thinking) status.textContent = "The model is thinking...";
        if (ev.delta) { n += ev.delta.length; status.textContent = `Reviewing your answer... (${n} characters received)`; }
      },
    });
    if (res.error) throw new Error(res.error);
    const fb = parseFeedback(res.text, current.kind);
    if (!fb) {
      box.innerHTML = "";
      box.append(el("p", {}, "The model did not return the expected JSON, so here is its reply as text:"), el("div", { class: "raw" }, res.text || "(empty reply)"));
      recordCurrent(answer, null);
      return;
    }
    current.feedback = fb;
    renderFeedback(fb, engineLabel(s));
    recordCurrent(answer, fb);
  } catch (e) {
    box.innerHTML = "";
    box.append(el("p", {}, `AI feedback failed: ${e.message}`),
      el("button", { class: "btn small", type: "button", onclick: () => switchToOfflineAndCheck() }, "Check with the offline checker instead"));
  } finally {
    setBusy(false);
  }
}

function switchToOfflineAndCheck() {
  document.querySelector('input[name="engine"][value="offline"]').checked = true;
  syncEngineUi();
  savePrefs();
  giveFeedback();
}

const MARK = ["missing", "weak", "strong"];

function renderFeedback(fb, label) {
  const box = $("feedback");
  box.hidden = false;
  box.innerHTML = "";
  box.append(
    el("div", { class: "fb-head" },
      el("div", { class: "score" }, String(fb.score), el("small", {}, "/10")),
      el("div", {},
        el("strong", {}, fb.kind === "technical" ? "Structure: approach, reasoning, example, limits" : "Structure: STAR"),
        el("br"),
        el("span", { class: "engine-tag" }, label),
        fb.words != null ? el("span", { class: "muted" }, `  ${fb.words} words`) : null)),
    el("table", { class: "parts" },
      ...fb.parts.map((p) => el("tr", {},
        el("th", {}, p.label),
        el("td", {}, el("span", { class: `mark s${p.score}` }, MARK[p.score]), p.note)))),
    el("div", { class: "cols" },
      el("div", {}, el("h4", {}, "Working"),
        fb.strengths.length ? el("ul", {}, ...fb.strengths.map((x) => el("li", {}, x))) : el("p", { class: "muted" }, "Nothing stands out yet.")),
      el("div", {}, el("h4", {}, "To improve"),
        fb.improvements.length ? el("ul", {}, ...fb.improvements.map((x) => el("li", {}, x))) : el("p", { class: "muted" }, "No obvious gaps."))),
  );
  if (fb.betterOpening) box.append(el("p", { class: "opening" }, el("strong", {}, "Stronger opening: "), fb.betterOpening));
  if (fb.followUp) {
    box.append(el("div", { class: "follow" },
      el("div", { class: "label" }, "Likely follow-up"),
      el("p", {}, fb.followUp),
      el("button", { class: "btn small", type: "button", onclick: () => ask(fb.followUp) }, "Answer this follow-up")));
  }
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------- answer box: timer, word count, dictation ----------
function startTimer() {
  stopTimer();
  timer.start = Date.now();
  $("timer").textContent = "0:00";
  timer.id = setInterval(() => {
    const s = Math.floor((Date.now() - timer.start) / 1000);
    $("timer").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
}
function stopTimer() { clearInterval(timer.id); }

function updateWordCount() {
  const n = wordCount($("answer").value);
  $("wc").textContent = `${n} word${n === 1 ? "" : "s"}`;
}

function setupDictation() {
  const mic = $("mic");
  if (!speechSupported) {
    mic.disabled = true;
    $("mic-note").textContent = "Dictation needs Chrome, Edge or Safari.";
    return;
  }
  let base = "";
  mic.addEventListener("click", () => {
    if (dictation?.listening) { dictation.stop(); return; }
    base = $("answer").value.trim();
    dictation = new Dictation({
      lang: speechLang(readSetup().lang),
      onUpdate: (finalText, interim) => {
        $("answer").value = [base, finalText + interim].filter(Boolean).join(base ? " " : "");
        updateWordCount();
      },
      onStateChange: (listening, err) => {
        mic.classList.toggle("listening", listening);
        mic.textContent = listening ? "Stop" : "Dictate";
        $("mic-note").textContent = listening ? "Listening..." : err ? `Dictation stopped (${err}).` : "";
      },
    });
    dictation.start();
  });
}

function setBusy(on) {
  busy = on;
  for (const id of ["start", "demo", "get-feedback", "next"]) $(id).disabled = on;
}

// ---------- actions ----------
function start() {
  const s = readSetup();
  if (s.engine === "ai" && !catalog.length) { toast("AI mode needs the /api endpoints. Use the offline checker here."); return; }
  if (s.engine === "ai" && !s.key && !catalog.find((p) => p.id === s.provider)?.operatorKey) {
    toast("Paste an API key for AI mode, or pick the offline checker."); $("key").focus(); return;
  }
  keyStore.set(s.provider, s.key, $("remember").checked);
  savePrefs();
  newSession(s);
  ask();
}

function next() {
  if (current && current.recorded == null) recordCurrent($("answer").value.trim(), null);
  ask();
}

function loadSample() {
  $("resume").value = SAMPLE_RESUME;
  $("jd").value = SAMPLE_JD;
  $("context").open = true;
  savePrefs();
}

function demo() {
  $("role").value = "swe";
  $("qtype").value = "behavioral";
  document.querySelector('input[name="engine"][value="offline"]').checked = true;
  syncEngineUi();
  loadSample();
  newSession(readSetup());
  showQuestion(SAMPLE_QUESTION, "demo question");
  $("answer").value = SAMPLE_ANSWER;
  updateWordCount();
  giveFeedback();
}

function exportMarkdown() {
  if (!session?.items.length) return;
  const blob = new Blob([sessionMarkdown(session)], { type: "text/markdown" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `interview-practice-${new Date().toISOString().slice(0, 10)}.md` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function clearSession() {
  session = null;
  store.del(SESSION_KEY);
  renderHistory();
}

// ---------- init ----------
async function loadCatalog() {
  try {
    const r = await fetch("/api/models");
    if (!r.ok) throw new Error(String(r.status));
    catalog = (await r.json()).providers || [];
  } catch {
    catalog = [];
  }
}

async function init() {
  const roleSel = $("role");
  for (const [id, r] of Object.entries(ROLES)) roleSel.append(el("option", { value: id }, r.label));

  const prefs = store.get(PREFS_KEY, {});
  if (prefs.role && ROLES[prefs.role]) roleSel.value = prefs.role;
  if (prefs.type) $("qtype").value = prefs.type;
  if (prefs.lang) $("lang").value = prefs.lang;
  $("resume").value = prefs.resume || "";
  $("jd").value = prefs.jd || "";
  if (prefs.engine === "ai") document.querySelector('input[name="engine"][value="ai"]').checked = true;

  await loadCatalog();
  fillProviders(prefs.provider);
  if (prefs.model) $("model").value = prefs.model;
  onProviderChange(true);
  syncEngineUi();

  session = store.get(SESSION_KEY, null);
  renderHistory();

  document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener("change", () => { syncEngineUi(); savePrefs(); }));
  $("provider").addEventListener("change", () => { onProviderChange(false); savePrefs(); });
  $("key").addEventListener("input", updateKeyNote);
  $("key").addEventListener("change", detectFromKey);
  for (const id of ["role", "qtype", "lang", "resume", "jd", "model"]) $(id).addEventListener("change", savePrefs);
  $("load-sample").addEventListener("click", loadSample);
  $("start").addEventListener("click", start);
  $("demo").addEventListener("click", demo);
  $("get-feedback").addEventListener("click", giveFeedback);
  $("next").addEventListener("click", next);
  $("answer").addEventListener("input", updateWordCount);
  $("export").addEventListener("click", exportMarkdown);
  $("clear").addEventListener("click", clearSession);
  setupDictation();
}

init();
