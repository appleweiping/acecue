// AceCue extension — overlay window logic. Receives QUESTION/TRANSCRIPT from the
// offscreen doc (via the service worker relay), calls the Vercel chat API with
// the user's stored BYOK key, and streams the answer. Self-contained (no module
// imports — extension pages load plain scripts).

const API_BASE = "https://acecue.vercel.app";
let mode = "full", lastQuestion = "", abort = null;

const $ = (id) => document.getElementById(id);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TRANSCRIPT") { $("question").textContent = msg.text || "…"; }
  if (msg.type === "QUESTION") { $("question").textContent = msg.text; answer(msg.text); }
  if (msg.type === "CAPTURE_ERROR") { $("dot").classList.remove("live"); $("question").textContent = "Audio error — reopen from the popup."; }
});

$("stop").addEventListener("click", () => { chrome.runtime.sendMessage({ type: "STOP_CAPTURE" }); window.close(); });
$("mode-full").addEventListener("click", () => setMode("full"));
$("mode-glance").addEventListener("click", () => setMode("glance"));
$("regen").addEventListener("click", () => { if (lastQuestion) answer(lastQuestion); });
$("copy").addEventListener("click", () => navigator.clipboard.writeText($("answer").innerText));
$("fs").addEventListener("input", (e) => document.documentElement.style.setProperty("--fs", e.target.value + "px"));
$("op").addEventListener("input", (e) => $("answer").style.opacity = e.target.value / 100);

function setMode(m) {
  mode = m;
  $("mode-full").classList.toggle("active", m === "full");
  $("mode-glance").classList.toggle("active", m === "glance");
}

async function getCfg() {
  return new Promise((res) => {
    chrome.storage.local.get(["acecue.keys", "acecue.settings"], (data) => {
      let keys = {}, settings = {};
      try { keys = JSON.parse(data["acecue.keys"] || "{}"); } catch {}
      try { settings = JSON.parse(data["acecue.settings"] || "{}"); } catch {}
      res({ keys, settings });
    });
  });
}

const LANG_NAME = { en: "English", zh: "Chinese", ja: "Japanese", ko: "Korean" };
const TONE = {
  concise: "Answer in 2-4 tight sentences. Lead with the point.",
  balanced: "Answer in a focused short paragraph, then 1-3 bullets if useful.",
  detailed: "Give a thorough, structured answer with brief examples.",
};

function buildSystem(settings) {
  const lang = LANG_NAME[settings.interviewLang || "en"] || "English";
  let p = `You are AceCue, a real-time interview copilot speaking as the candidate in a live interview.
Produce the answer the candidate should SAY, first person, ready to read aloud. Reply in ${lang}.
${TONE[settings.tone] || TONE.balanced}
Be specific and confident, no filler, never mention you are an AI. For coding questions, give a correct solution in a code block plus a one-line explanation.`;
  if (settings.resume) p += `\n\n--- Résumé ---\n${String(settings.resume).slice(0, 4000)}`;
  if (settings.jd) p += `\n\n--- Job ---\n${String(settings.jd).slice(0, 2500)}`;
  return p;
}

async function answer(question) {
  lastQuestion = question;
  abort?.abort(); abort = new AbortController();
  const { keys, settings } = await getCfg();
  const provider = settings.provider || "groq";
  const model = settings.model || "";
  const key = keys[provider] || "";

  const ans = $("answer");
  ans.innerHTML = `<span class="cursor"></span>`;

  const userMsg = mode === "glance"
    ? `Interviewer asked: "${question}"\n\nGive 3 short bullet cue points I can glance at and expand while speaking.`
    : `Interviewer asked: "${question}"`;

  const headers = { "content-type": "application/json" };
  if (key) headers["x-user-key"] = key;

  let full = "";
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST", headers, signal: abort.signal,
      body: JSON.stringify({
        provider, model, temperature: 0.4,
        messages: [{ role: "system", content: buildSystem(settings) }, { role: "user", content: userMsg }],
      }),
    });
    if (!res.ok) { ans.innerHTML = `<div class="empty">Model error (${res.status}). Check your key in the app.</div>`; return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const d = t.slice(5).trim();
        if (d === "[DONE]") break;
        try { const j = JSON.parse(d); if (j.delta) { full += j.delta; ans.innerHTML = md(full) + `<span class="cursor"></span>`; ans.scrollTop = ans.scrollHeight; } } catch {}
      }
    }
    ans.innerHTML = md(full);
  } catch (e) {
    if (e.name !== "AbortError") ans.innerHTML = `<div class="empty">Network error.</div>`;
  }
}

// tiny markdown (mirror of public/js/md.js, inlined)
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function md(src){
  if(!src)return"";
  const b=[];
  let s=src.replace(/```(\w+)?\n?([\s\S]*?)```/g,(_,l,c)=>{const i=b.length;b.push(`<pre><code>${esc(c.replace(/\n$/,""))}</code></pre>`);return` BLK${i} `;});
  s=esc(s).replace(/`([^`\n]+)`/g,(_,c)=>`<code>${c}</code>`).replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/^[\s]*[-*]\s+(.*)$/gm,"• $1");
  return s.replace(/ BLK(\d+) /g,(_,i)=>b[+i]);
}
