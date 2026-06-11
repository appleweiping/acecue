// AceCue — Practice mode. A legitimate mock-interview loop: the AI plays
// interviewer (asks one question at a time), then on request gives structured
// feedback on the candidate's answer, and a session summary at the end.

import { I18N } from "./i18n.js";
import { Store } from "./store.js";
import { streamChat } from "./llm.js";
import { renderMarkdown } from "./md.js";

let toast;
let session = null; // { role, type, qa: [{q, a, fb}] }
const $ = (id) => document.getElementById(id);

const LANG_NAME = { en: "English", zh: "Chinese", ja: "Japanese", ko: "Korean" };

export function initPractice(ctx) {
  toast = ctx.toast;
  $("pr-start").addEventListener("click", start);
  $("pr-feedback").addEventListener("click", giveFeedback);
  $("pr-next").addEventListener("click", nextQuestion);
  $("pr-finish").addEventListener("click", finish);
}

function chatCfg() {
  return { provider: Store.get("provider"), model: Store.get("model") };
}
function langName() { return LANG_NAME[Store.get("interviewLang") || I18N.lang] || "English"; }

async function llm(system, user, onDelta) {
  const { provider, model } = chatCfg();
  return streamChat({
    provider, model, temperature: 0.7,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    onDelta,
  });
}

async function start() {
  const role = $("pr-role").value.trim() || "the role";
  const type = $("pr-type").value;
  session = { role, type, qa: [] };
  $("practice-setup").style.display = "none";
  $("practice-run").style.display = "block";
  $("practice-thread").innerHTML = "";
  await nextQuestion();
}

function interviewerSystem() {
  return `You are a professional, friendly interviewer conducting a ${session.type} interview for "${session.role}".
Ask ONE interview question at a time, realistic for this role and type. Reply in ${langName()}.
Output only the question, no preamble, no numbering.`;
}

async function nextQuestion() {
  if (!session) return;
  const asked = session.qa.map((x) => x.q).join("\n");
  const block = addBlock(I18N.t("practice.title"), "");
  const qEl = block.querySelector(".q-text");
  let q = "";
  try {
    await llm(interviewerSystem(),
      asked ? `Questions already asked:\n${asked}\nAsk a different, follow-up-worthy next question.` : `Begin the interview with your first question.`,
      (d) => { q += d; qEl.textContent = q; });
  } catch { toast(I18N.t("errors.upstream")); qEl.textContent = "…"; return; }
  session.qa.push({ q: q.trim(), a: "", fb: "" });
  $("pr-answer").value = "";
  $("pr-answer").focus();
}

async function giveFeedback() {
  if (!session || !session.qa.length) return;
  const cur = session.qa[session.qa.length - 1];
  cur.a = $("pr-answer").value.trim();
  if (!cur.a) { toast(I18N.t("practice.answerPlaceholder")); return; }

  const block = $("practice-thread").lastElementChild;
  let fbEl = block.querySelector(".fb");
  if (!fbEl) { fbEl = document.createElement("div"); fbEl.className = "fb"; block.appendChild(fbEl); }
  fbEl.innerHTML = `<span class="cursor"></span>`;

  const sys = `You are an expert interview coach for "${session.role}". Reply in ${langName()}.
Give concise, specific, actionable feedback on the candidate's answer to the interviewer's question.
Note strengths, then 2-3 concrete improvements. For behavioral answers, check STAR coverage. Be encouraging but honest. Keep under 180 words.`;
  let fb = "";
  try {
    await llm(sys, `Question: ${cur.q}\n\nCandidate's answer: ${cur.a}`, (d) => { fb += d; fbEl.innerHTML = renderMarkdown(fb) + `<span class="cursor"></span>`; });
    fbEl.innerHTML = renderMarkdown(fb);
    cur.fb = fb;
  } catch { toast(I18N.t("errors.upstream")); }
}

async function finish() {
  if (!session || !session.qa.length) return;
  const block = addBlock(I18N.t("practice.summary"), "");
  const el = block.querySelector(".q-text"); el.style.fontWeight = "700";
  const body = document.createElement("div"); body.className = "fb"; block.appendChild(body);
  body.innerHTML = `<span class="cursor"></span>`;

  const transcript = session.qa.map((x, i) => `Q${i + 1}: ${x.q}\nA: ${x.a || "(skipped)"}`).join("\n\n");
  const sys = `You are an interview coach. Reply in ${langName()}. Give a short overall assessment of this mock interview for "${session.role}": 3 strengths, 3 priorities to improve, and one practice tip. Keep it motivating and under 220 words.`;
  let out = "";
  try {
    await llm(sys, transcript, (d) => { out += d; body.innerHTML = renderMarkdown(out) + `<span class="cursor"></span>`; });
    body.innerHTML = renderMarkdown(out);
    Store.pushHistory({ kind: "practice", role: session.role, type: session.type, count: session.qa.length });
  } catch { toast(I18N.t("errors.upstream")); }

  // reset to setup for a new run
  session = null;
  $("practice-setup").style.display = "block";
}

function addBlock(who, q) {
  const div = document.createElement("div");
  div.className = "qa-block";
  div.innerHTML = `<div class="who">${who}</div><div class="q-text">${q}</div>`;
  $("practice-thread").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "start" });
  return div;
}
