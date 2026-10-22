import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswer, wordCount, followUpFor } from "../public/js/star-check.js";
import { questionPool, nextQuestion, looksTechnical, ROLES } from "../public/js/questions.js";
import { parseFeedback, feedbackMessages, questionMessages, sessionMarkdown } from "../public/js/coach.js";
import { parseSSE } from "../public/js/stream-client.js";
import { SAMPLE_ANSWER } from "../public/js/sample.js";

const STRONG = `Last semester I was a teaching assistant for the intro programming course, in a lab of 25 students.
My task was to cut the time students waited for help during labs, which was often over 20 minutes.
I wrote a simple queue page in Flask, I tested it with two other TAs, and I presented it to the instructor.
I also measured wait times for three weeks before and after the change and I documented the setup for next term.
As a result, the average wait dropped from 22 minutes to 8 minutes, and the course kept using the queue the next semester.
I learned that measuring first made it much easier to convince the instructor to try something new.`;

test("a complete STAR answer scores high", () => {
  const r = checkAnswer(STRONG, "star");
  assert.equal(r.engine, "offline");
  assert.deepEqual(r.parts.map((p) => p.score), [2, 2, 2, 2]);
  assert.ok(r.score >= 9, `score ${r.score}`);
  assert.match(r.followUp, /differently/);
  assert.equal(r.strengths[0], "Situation, Task, Action and Result are clear: the structure is all there.");
  assert.ok(r.strengths.includes("Uses concrete numbers."));
});

test("a vague team answer is flagged for missing parts and 'we'", () => {
  const r = checkAnswer("We had a project and we worked hard on it. We talked a lot and we fixed things and it was fine.", "star");
  const byKey = Object.fromEntries(r.parts.map((p) => [p.key, p.score]));
  assert.equal(byKey.action, 0);
  assert.ok(r.score <= 3, `score ${r.score}`);
  assert.ok(r.improvements.some((s) => s.startsWith("Length")));
  assert.ok(r.improvements.some((s) => s.startsWith("Ownership")));
  assert.ok(r.improvements.some((s) => s.startsWith("Numbers")));
});

test("results with a word between number and unit still count as measurable", () => {
  const ans = `Last spring I was on a four-person team building a bus arrival app for a course.
I was responsible for the backend, and our arrival times were sometimes off by one hour.
I first reproduced it with a test, then I traced the data through our parser and I switched the backend to UTC.
As a result the times matched the official app again, and we demoed on time with 40 passing tests.`;
  const byKey = Object.fromEntries(checkAnswer(ans, "star").parts.map((p) => [p.key, p.score]));
  assert.deepEqual(byKey, { situation: 2, task: 2, action: 2, result: 2 });
});

test("the sample answer gets useful, not perfect, feedback", () => {
  const r = checkAnswer(SAMPLE_ANSWER, "star");
  assert.ok(r.score >= 5 && r.score <= 9, `score ${r.score}`);
  assert.ok(r.improvements.length > 0);
});

test("technical rubric looks for approach, reasoning, example and limits", () => {
  const ans = `I would put every address in a hash set and check membership as I go, because lookups are O(1) on average.
For example, if the input has a@x.com twice, the second insert finds it already present.
The trade-off is memory: a million addresses fit easily, but at a billion I would sort on disk instead of keeping a set.
I would test it with an empty list and with addresses that differ only in case, which is an edge case worth normalising first.`;
  const r = checkAnswer(ans, "technical");
  assert.deepEqual(r.parts.map((p) => p.label), ["Approach", "Reasoning", "Example", "Limits"]);
  assert.ok(r.parts.every((p) => p.score >= 1));
});

test("wordCount and follow-ups", () => {
  assert.equal(wordCount("  one two\nthree "), 3);
  assert.equal(wordCount(""), 0);
  assert.match(followUpFor("star", "result"), /outcome/);
  assert.match(followUpFor("technical", null), /larger/);
});

test("question bank covers every role and type without repeats until exhausted", () => {
  for (const role of Object.keys(ROLES)) {
    for (const type of ["behavioral", "technical", "mixed"]) {
      const pool = questionPool(role, type);
      assert.ok(pool.length >= 4, `${role}/${type}`);
      assert.equal(new Set(pool).size, pool.length, `duplicates in ${role}/${type}`);
    }
  }
  const asked = [];
  for (let i = 0; i < 4; i++) asked.push(nextQuestion("swe", "technical", asked));
  assert.equal(new Set(asked).size, 4);
  assert.equal(looksTechnical("Explain setup and hold time, and what happens when they are violated."), true);
  assert.equal(looksTechnical("Tell me about a time you had to learn something new quickly."), false);
});

test("parseFeedback reads fenced JSON and clamps values", () => {
  const reply = "Here you go:\n```json\n" + JSON.stringify({
    parts: [
      { label: "Situation", score: 2, note: "Clear." },
      { label: "Task", score: 5, note: "Stated." },
      { label: "Action", score: -1, note: "Vague." },
      { label: "Result", score: 1, note: "No number." },
    ],
    score: 14,
    strengths: ["a", "b", "c", "d"],
    improvements: ["x"],
    better_opening: "In my second year...",
    follow_up: "How did you measure it?",
  }) + "\n```";
  const fb = parseFeedback(reply, "star");
  assert.deepEqual(fb.parts.map((p) => p.score), [2, 2, 0, 1]);
  assert.equal(fb.score, 10);
  assert.equal(fb.strengths.length, 3);
  assert.equal(fb.followUp, "How did you measure it?");
  assert.equal(parseFeedback("no json here", "star"), null);
  assert.equal(parseFeedback("{not: valid}", "star"), null);
});

test("prompts include the résumé, the job and the rubric", () => {
  const setup = { roleLabel: "Data analyst", type: "behavioral", lang: "en", resume: "Alex, SQL", jd: "Northwind analyst" };
  const q = questionMessages(setup, ["Q1"]);
  assert.match(q[0].content, /Alex, SQL/);
  assert.match(q[0].content, /Northwind analyst/);
  assert.match(q[1].content, /- Q1/);
  const f = feedbackMessages(setup, "Why data?", "Because...", "star");
  assert.match(f[0].content, /"label": "Situation"/);
  assert.match(f[1].content, /Why data\?/);
});

test("sessionMarkdown lists questions, answers and scores", () => {
  const fb = checkAnswer(STRONG, "star");
  const md = sessionMarkdown({
    roleLabel: "Software engineering intern", type: "behavioral", engineLabel: "Offline checker", startedAt: Date.UTC(2026, 9, 21),
    items: [{ question: "Q one?", answer: STRONG, feedback: fb }, { question: "Q two?", answer: "", feedback: null }],
  });
  assert.match(md, /^# Interview practice - Software engineering intern/);
  assert.match(md, /Date: 2026-10-21/);
  assert.match(md, /## Q1\. Q one\?/);
  assert.match(md, /\| Situation \| 2\/2 \|/);
  assert.match(md, /## Q2\. Q two\?\n\n_Skipped\._/);
});

test("parseSSE keeps incomplete events for the next chunk", () => {
  const a = parseSSE('data: {"delta":"Hi"}\n\ndata: {"del');
  assert.deepEqual(a.events, [{ delta: "Hi" }]);
  const b = parseSSE(a.rest + 'ta":" there"}\n\ndata: [DONE]\n\n');
  assert.deepEqual(b.events, [{ delta: " there" }, { done: true }]);
  assert.equal(b.rest, "");
});
