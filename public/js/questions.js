// Built-in question bank, used in offline mode (and as a fallback if the AI
// call fails). Behavioral questions are shared; each role adds its own.

export const ROLES = {
  general: { label: "Any role (general)" },
  swe: { label: "Software engineering intern" },
  data: { label: "Data analyst" },
  pm: { label: "Product manager" },
  hardware: { label: "Hardware / chip design intern" },
};

const BEHAVIORAL = [
  "Tell me about a time you had to learn something new quickly.",
  "Describe a project that did not go as planned. What did you do?",
  "Tell me about a disagreement with a teammate and how you handled it.",
  "Give an example of a goal you set and how you reached it.",
  "Tell me about a time you received critical feedback. How did you respond?",
  "Describe a situation where you had to juggle several deadlines.",
  "Tell me about a time you took the lead without being asked.",
  "Describe a mistake you made and what you changed afterwards.",
];

const BY_ROLE = {
  swe: {
    behavioral: [
      "Tell me about a bug that took you a long time to find. How did you track it down?",
      "Describe a piece of code you are proud of and why.",
    ],
    technical: [
      "How would you find duplicate entries in a list of a million email addresses? What is the complexity?",
      "Explain the difference between a process and a thread to a new teammate.",
      "Walk me through what happens when you type a URL into the browser and press Enter.",
      "How would you design a rate limiter for a public API?",
    ],
  },
  data: {
    behavioral: [
      "Tell me about a time your analysis changed someone's decision.",
      "Describe a dataset that turned out to be messier than expected. What did you do?",
    ],
    technical: [
      "How would you check whether a new checkout page increased conversions?",
      "Explain the difference between correlation and causation with an example from your own work.",
      "A dashboard metric dropped 20% overnight. How do you investigate?",
      "When would you use a median instead of a mean?",
    ],
  },
  pm: {
    behavioral: [
      "Tell me about a time you had to say no to a stakeholder.",
      "Describe a product decision you made with incomplete data.",
    ],
    technical: [
      "How would you decide what to build next for a campus food-ordering app?",
      "Pick an app you use daily. What one feature would you change and how would you measure it?",
      "How would you prioritise three feature requests with one engineer for a month?",
      "What metrics would you track for a student study-group app?",
    ],
  },
  hardware: {
    behavioral: [
      "Tell me about a lab or project where the hardware did not behave like the simulation.",
      "Describe a time you had to debug a problem across hardware and software.",
    ],
    technical: [
      "Explain setup and hold time, and what happens when they are violated.",
      "How would you design a circuit that detects a rising edge on a noisy input?",
      "What is the difference between blocking and non-blocking assignments in Verilog?",
      "Walk me through how you would verify a small FIFO design.",
    ],
  },
  general: {
    behavioral: [
      "Why are you interested in this role?",
      "What is something you taught yourself recently, and how?",
    ],
    technical: [
      "Explain a technical concept from your field to someone outside it.",
      "Describe how you would approach a problem you have never seen before.",
      "What tool or method do you rely on most in your work, and why?",
      "How do you check that your own work is correct before handing it in?",
    ],
  },
};

// Questions for a role and type ("behavioral", "technical" or "mixed").
export function questionPool(role, type) {
  const r = BY_ROLE[role] || BY_ROLE.general;
  const behavioral = [...r.behavioral, ...BEHAVIORAL];
  if (type === "behavioral") return behavioral;
  if (type === "technical") return [...r.technical];
  const mixed = [];
  const n = Math.max(behavioral.length, r.technical.length);
  for (let i = 0; i < n; i++) {
    if (behavioral[i]) mixed.push(behavioral[i]);
    if (r.technical[i]) mixed.push(r.technical[i]);
  }
  return mixed;
}

// Next unasked question from the pool; wraps around when all have been asked.
export function nextQuestion(role, type, asked = []) {
  const pool = questionPool(role, type);
  return pool.find((q) => !asked.includes(q)) || pool[asked.length % pool.length];
}

// Rough guess at whether a question is technical, so the offline checker can
// pick the right rubric for questions typed in or produced by a model.
export function looksTechnical(question) {
  const q = String(question || "").toLowerCase();
  if (/^(tell me about a time|describe a (time|situation|project|mistake)|give an example|why are you)/.test(q)) return false;
  return Object.values(BY_ROLE).some((r) => r.technical.some((t) => t.toLowerCase() === q)) ||
    /\b(how would you|explain|design|difference between|complexity|walk me through how|what happens when|verify|metric)\b/.test(q);
}
