// Offline answer checker. No model involved: it looks for the phrases that
// usually mark each part of a STAR answer (Situation, Task, Action, Result)
// or, for technical questions, approach / reasoning / example / limits.
// It is a rough heuristic for English answers. It cannot judge whether the
// content is good, only whether the structure is there.

const RUBRICS = {
  star: [
    {
      key: "situation",
      label: "Situation",
      // Two or more context cues count as a clear setting.
      cues: [
        /\b(when i was|while i was|while working|at (my|the|a) (internship|job|school|university|company|startup|lab|club|help desk)|during (my|our|the|a)\b|last (year|summer|semester|term|spring|fall|autumn|winter|month)|in my (first|second|third|final|last)?\s?(year|role|internship|job|team|class|course|project|lab)|back in|i was (working|interning|studying|taking)|i was (a|an|the) (teaching assistant|ta|intern|member|student|volunteer|lead|team lead|tutor|developer)|i was interning|our team|on a ([a-z]+-person |small |new )?(team|group)|in a (team|group|class|course|project|lab|club) of)/,
      ],
      missing: "Open with one or two sentences of context: where you were, when, and who was involved.",
      weak: "Context is there but thin. Name the team, course or company so the listener can picture it.",
      good: "Clear setting.",
    },
    {
      key: "task",
      label: "Task",
      // Any of these shows a goal; an explicit statement of it counts as strong.
      cues: [
        /\b(my (goal|task|job|role|responsibility|part) was|i was (responsible|asked|tasked|assigned|in charge)|asked me to|wanted me to|i needed to|we needed to|i had to|we had to|the (goal|challenge|problem|issue|deadline) was|was supposed to|our goal|i wanted to)\b/,
      ],
      strong: /\b(my (goal|task|job|role|responsibility|part) was|i was (responsible|asked|tasked|assigned|in charge)|asked me to|wanted me to|the (goal|challenge|problem) was|our goal was)\b/,
      missing: "Say what you specifically had to do or what problem needed solving.",
      weak: "The goal is implied. State it in one plain sentence.",
      good: "The goal is stated.",
    },
    {
      key: "action",
      label: "Action",
      cues: [
        /\bi (then |first |also |quickly |eventually |finally )?(built|wrote|designed|implemented|led|organi[sz]ed|created|set up|proposed|analy[sz]ed|reached out|talked|spoke|met|scheduled|split|refactored|tested|debugged|automated|trained|learned|read|studied|decided|started|asked|presented|negotiated|rewrote|measured|added|removed|reduced|fixed|coordinated|volunteered|took|made|ran|found|traced|compared|documented|prototyped|planned|broke|reviewed|wrote up|practised|practiced|used|switched|moved|changed|explained|convinced|delegated|reproduced|investigated|isolated|logged|profiled|replaced|migrated|configured|contacted|emailed|interviewed|surveyed|collected|cleaned|visuali[sz]ed|sketched|iterated|deployed|benchmarked|optimi[sz]ed|simplified|mentored|taught)\b/g,
      ],
      count: true,
      missing: "Describe the steps you took yourself, using \"I\" and concrete verbs (I wrote, I measured, I asked).",
      weak: "Some actions are there. Add one or two more specific steps and say why you chose them.",
      good: "Concrete actions in first person.",
    },
    {
      key: "result",
      label: "Result",
      cues: [
        /\b(as a result|in the end|eventually|the result|resulted in|the outcome|which (led|meant)|this (led|meant|helped|cut|saved)|so (we|i) (could|were able|was able)|reduced|increased|improved|cut|saved|shipped|launched|delivered|won|passed|finished|on time|got (an?|the)|received|i learned|lesson)\b/,
      ],
      // A number next to a unit, allowing one word in between ("40 passing tests").
      strong: /\d+(\.\d+)?\s?([a-z-]+\s)?(%|percent|x\b|times|hours?|days?|weeks?|months?|users?|customers?|ms|seconds?|minutes?|points?|people|students|requests|bugs|tests|grade)/,
      missing: "End with the outcome: what changed because of your work, ideally with a number.",
      weak: "There is an outcome. Make it measurable (time saved, users, grade, error rate).",
      good: "Measurable outcome.",
    },
  ],
  technical: [
    {
      key: "approach",
      label: "Approach",
      cues: [/\b(i would|i'd|first,? i|my approach|the approach|start by|step one|the idea is|we can|you can|i'll)\b/],
      missing: "State your approach up front in one sentence before the details.",
      weak: "The approach is there but buried. Lead with it.",
      good: "Approach stated early.",
    },
    {
      key: "reasoning",
      label: "Reasoning",
      cues: [/\b(because|since|so that|the reason|trade-?off|instead of|rather than|compared to|which means|this avoids|the downside|the benefit)\b/g],
      count: true,
      missing: "Explain why: what trade-off you are making and what the alternative would be.",
      weak: "Some reasoning. Name one alternative and why you did not pick it.",
      good: "Explains the why and the trade-offs.",
    },
    {
      key: "example",
      label: "Example",
      cues: [/\b(for example|for instance|e\.g\.|such as|say we|suppose|imagine|if the input|in my (project|internship|lab|course))\b/],
      missing: "Ground it with a small example or something you did in a project.",
      weak: "One example. Make it concrete with real numbers or names.",
      good: "Has a concrete example.",
    },
    {
      key: "limits",
      label: "Limits",
      cues: [/\b(edge case|corner case|fails? (if|when)|limitation|worst case|complexity|o\([^)]*\)|scal(e|ing)|bottleneck|would not work|doesn't work|test(ed|ing)?|verify|check that)\b/],
      missing: "Mention limits: edge cases, complexity, or how you would test it.",
      weak: "Limits touched on. Add how you would verify the solution.",
      good: "Covers limits or testing.",
    },
  ],
};

const FILLERS = /\b(um+|uh+|erm|you know|basically|kind of|sort of|like,|i mean|actually)\b/g;
const HEDGES = /\b(i think|i guess|maybe|probably|i'm not sure|kind of|sort of)\b/g;
const NUMBER = /\d/;

function countMatches(text, re) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return (text.match(g) || []).length;
}

// Score one rubric part: 0 = missing, 1 = present, 2 = strong.
function scorePart(part, text) {
  const hits = part.cues.reduce((n, re) => n + countMatches(text, re), 0);
  if (hits === 0) return { score: 0, hits };
  if (part.count) return { score: hits >= 3 ? 2 : 1, hits };
  if (part.strong) return { score: part.strong.test(text) ? 2 : 1, hits };
  return { score: hits >= 2 ? 2 : 1, hits };
}

function listWords(items, word = "or") {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}
const joinAnd = (items) => listWords(items, "and");

export function wordCount(text) {
  return (String(text || "").trim().match(/\S+/g) || []).length;
}

// Analyse an answer. `kind` is "star" (behavioral) or "technical".
export function checkAnswer(answer, kind = "star") {
  const raw = String(answer || "");
  const text = raw.toLowerCase().replace(/[’‘]/g, "'");
  const rubric = RUBRICS[kind] || RUBRICS.star;
  const words = wordCount(raw);

  const parts = rubric.map((part) => {
    const { score } = scorePart(part, text);
    const note = score === 0 ? part.missing : score === 1 ? part.weak : part.good;
    return { key: part.key, label: part.label, score, note };
  });

  // The per-part notes are shown in the table; this list is the short
  // "fix these first" summary.
  const strong = parts.filter((p) => p.score === 2).map((p) => p.label);
  const strengths = strong.length
    ? [`${joinAnd(strong)} ${strong.length === 1 ? "is" : "are"} clear${strong.length === parts.length ? ": the structure is all there" : ""}.`]
    : [];
  const improvements = [];

  const weakest = [...parts].sort((a, b) => a.score - b.score)[0];
  const missing = parts.filter((p) => p.score === 0);
  if (missing.length >= 2) {
    improvements.push(`Structure: no clear ${listWords(missing.map((p) => p.label))}. ` +
      (kind === "star"
        ? "Try one sentence of context, one sentence on your goal, three or four sentences on what you did, and one on the result."
        : "Lead with your approach, say why, give a small example, then say where it breaks."));
  } else if (weakest.score < 2) {
    improvements.push(`${weakest.label} first: ${weakest.note}`);
  }

  let lengthOk = true;
  if (words < 80) {
    lengthOk = false;
    improvements.push(`Length: ${words} words is short. Aim for roughly 150-300 words, about one to two minutes spoken.`);
  } else if (words > 420) {
    lengthOk = false;
    improvements.push(`Length: ${words} words is long for a spoken answer. Cut the setup and keep the actions and result.`);
  } else {
    strengths.push(`Length: ${words} words, about one to two minutes spoken.`);
  }

  const iCount = countMatches(text, /\bi\b/);
  const weCount = countMatches(text, /\bwe\b/);
  if (kind === "star" && weCount > iCount && weCount >= 3) {
    improvements.push(`Ownership: you said "we" ${weCount} times and "I" ${iCount} times. Interviewers want your part.`);
  }

  const fillers = countMatches(text, FILLERS);
  if (fillers >= 3) improvements.push(`Filler words: ${fillers} (um, basically, kind of...). Pausing reads better than filling.`);
  const hedges = countMatches(text, HEDGES);
  if (hedges >= 2) improvements.push(`Hedging: ${hedges} phrases like "I think" or "maybe". State what you did plainly.`);

  const quantified = NUMBER.test(text);
  if (!quantified && kind === "star") improvements.push("Numbers: none yet. One figure (hours saved, users, grade, error rate) makes the result believable.");
  else if (quantified) strengths.push("Uses concrete numbers.");

  const partScore = parts.reduce((n, p) => n + p.score, 0); // 0..8
  const score = Math.min(10, partScore + (lengthOk ? 1 : 0) + (quantified ? 1 : 0));

  return {
    engine: "offline",
    kind,
    words,
    parts,
    score,
    strengths: strengths.slice(0, 4),
    improvements: improvements.slice(0, 5),
    followUp: followUpFor(kind, weakest.score < 2 ? weakest.key : null),
  };
}

const FOLLOW_UPS = {
  star: {
    situation: "Can you set the scene for me: where was this, and who else was involved?",
    task: "What exactly were you responsible for in that situation?",
    action: "Walk me through what you personally did, step by step.",
    result: "What was the outcome, and how did you know it had worked?",
    none: "Looking back, what would you do differently next time?",
  },
  technical: {
    approach: "Before the details, what is your overall approach in one sentence?",
    reasoning: "Why that approach rather than an obvious alternative?",
    example: "Can you walk me through a small concrete example?",
    limits: "Where would this break down, and how would you test it?",
    none: "How would your answer change if the input were a hundred times larger?",
  },
};

export function followUpFor(kind, weakestKey) {
  const set = FOLLOW_UPS[kind] || FOLLOW_UPS.star;
  return set[weakestKey] || set.none;
}

export const RUBRIC_LABELS = {
  star: RUBRICS.star.map((p) => p.label),
  technical: RUBRICS.technical.map((p) => p.label),
};
