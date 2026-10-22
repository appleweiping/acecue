// Prompts for AI mode, parsing of the model's feedback, and Markdown export.
// Pure functions so they can be tested in Node.

import { RUBRIC_LABELS } from "./star-check.js";

const LANGS = { en: "English", zh: "Simplified Chinese" };

function context(setup) {
  let s = "";
  if (setup.resume?.trim()) s += `\n\nCandidate résumé:\n${setup.resume.trim().slice(0, 4000)}`;
  if (setup.jd?.trim()) s += `\n\nJob description:\n${setup.jd.trim().slice(0, 3000)}`;
  return s;
}

export function questionMessages(setup, asked = []) {
  const kind = setup.type === "mixed" ? "behavioral or technical (alternate)" : setup.type;
  const system = `You are an interviewer running a mock ${kind} interview for the role "${setup.roleLabel}". ` +
    `Ask exactly one realistic question, the kind a real interviewer for this role would ask. ` +
    `Where it helps, refer to something specific in the résumé or job description. ` +
    `Write the question in ${LANGS[setup.lang] || "English"}. Output only the question, with no preamble or numbering.` +
    context(setup);
  const user = asked.length
    ? `Questions already asked in this session:\n${asked.map((q) => `- ${q}`).join("\n")}\n\nAsk a different question.`
    : "Ask the first question.";
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export function feedbackMessages(setup, question, answer, kind) {
  const labels = RUBRIC_LABELS[kind] || RUBRIC_LABELS.star;
  const rubricName = kind === "technical" ? "approach / reasoning / example / limits" : "STAR (Situation, Task, Action, Result)";
  const schema = `{
  "parts": [${labels.map((l) => `{"label": "${l}", "score": 0, "note": "..."}`).join(", ")}],
  "score": 0,
  "strengths": ["..."],
  "improvements": ["..."],
  "better_opening": "...",
  "follow_up": "..."
}`;
  const system = `You are an interview coach helping a student practise for "${setup.roleLabel}". ` +
    `Judge the candidate's answer against the ${rubricName} structure. ` +
    `For each part give score 0 (missing), 1 (present but weak) or 2 (clear and specific) and a one-sentence note. ` +
    `"score" is an overall mark out of 10. Give at most 3 strengths and at most 4 improvements, each one sentence and specific to this answer. ` +
    `"better_opening" is an improved first sentence for the answer. "follow_up" is the next question a real interviewer would ask. ` +
    `Be honest; do not praise weak answers. Write the notes in ${LANGS[setup.lang] || "English"}. ` +
    `Reply with JSON only, exactly this shape:\n${schema}` + context(setup);
  const user = `Question: ${question}\n\nCandidate's answer:\n${answer}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

// Pull the JSON object out of a model reply (which may be wrapped in code
// fences or have a sentence before it) and clean it up. Returns null if the
// reply does not contain usable JSON.
export function parseFeedback(text, kind) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let j;
  try { j = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  const labels = RUBRIC_LABELS[kind] || RUBRIC_LABELS.star;
  const parts = labels.map((label, i) => {
    const p = (Array.isArray(j.parts) ? j.parts : []).find((x) => String(x?.label || "").toLowerCase() === label.toLowerCase()) ||
      (Array.isArray(j.parts) ? j.parts[i] : null) || {};
    return { key: label.toLowerCase(), label, score: clamp(Math.round(Number(p.score) || 0), 0, 2), note: String(p.note || "").trim() };
  });
  const list = (v, n) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, n);
  return {
    engine: "ai",
    kind,
    parts,
    score: clamp(Math.round(Number(j.score) || 0), 0, 10),
    strengths: list(j.strengths, 3),
    improvements: list(j.improvements, 4),
    betterOpening: String(j.better_opening || "").trim(),
    followUp: String(j.follow_up || "").trim(),
  };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Markdown summary of a practice session, for download.
export function sessionMarkdown(session) {
  const date = new Date(session.startedAt || Date.now()).toISOString().slice(0, 10);
  const lines = [
    `# Interview practice - ${session.roleLabel}`,
    "",
    `Date: ${date}  `,
    `Question type: ${session.type}  `,
    `Feedback from: ${session.engineLabel}`,
    "",
  ];
  session.items.forEach((it, i) => {
    lines.push(`## Q${i + 1}. ${it.question}`, "");
    if (it.answer) lines.push("**My answer**", "", it.answer.trim(), "");
    else lines.push("_Skipped._", "");
    const fb = it.feedback;
    if (fb) {
      lines.push(`**Score:** ${fb.score}/10`, "");
      lines.push("| Part | Score | Note |", "| --- | --- | --- |");
      for (const p of fb.parts) lines.push(`| ${p.label} | ${p.score}/2 | ${p.note.replace(/\|/g, "\\|")} |`);
      lines.push("");
      if (fb.strengths.length) lines.push("**Strengths**", "", ...fb.strengths.map((s) => `- ${s}`), "");
      if (fb.improvements.length) lines.push("**To improve**", "", ...fb.improvements.map((s) => `- ${s}`), "");
      if (fb.betterOpening) lines.push(`**Stronger opening:** ${fb.betterOpening}`, "");
      if (fb.followUp) lines.push(`**Follow-up:** ${fb.followUp}`, "");
    }
  });
  return lines.join("\n");
}
