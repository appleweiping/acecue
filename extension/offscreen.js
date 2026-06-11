// AceCue extension — offscreen document.
//
// The service worker has no DOM, so audio capture + transcription run here.
// We receive a tabCapture streamId, open the stream with the legacy mandatory
// constraints, re-route it to the speakers (so the candidate still hears the
// interviewer — tabCapture mutes the tab otherwise), and transcribe.
//
// Transcription: if the user has a Deepgram key (synced from the web app's
// localStorage via chrome.storage), we stream the captured tab audio to
// Deepgram for interviewer-only, low-latency transcripts. Otherwise we fall
// back to the browser SpeechRecognition on the *captured* stream where
// supported. Detected questions are sent to the overlay, which calls the LLM.

let stream = null, audioCtx = null, recorder = null, dgWs = null;
let pending = "", silenceTimer = null;

const QUESTION_RE = /[?？]/;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OFFSCREEN_START") start(msg.streamId);
  if (msg.type === "OFFSCREEN_STOP") stop();
});

async function start(streamId) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: false,
    });
  } catch (e) {
    send({ type: "CAPTURE_ERROR", error: String(e) });
    return;
  }

  // re-route to speakers so the user still hears the interviewer
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(stream);
  src.connect(audioCtx.destination);

  const { deepgramKey, lang } = await getConfig();
  if (deepgramKey) startDeepgram(deepgramKey, lang || "en");
  else startBrowserOnStream(lang || "en");
}

function startDeepgram(apiKey, lang) {
  const params = new URLSearchParams({
    model: "nova-2", language: lang, interim_results: "true",
    smart_format: "true", punctuate: "true", endpointing: "300",
  });
  dgWs = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", apiKey]);
  dgWs.onopen = () => {
    recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => { if (e.data.size && dgWs?.readyState === 1) dgWs.send(e.data); };
    recorder.start(250);
  };
  dgWs.onmessage = (ev) => {
    try {
      const j = JSON.parse(ev.data);
      const alt = j.channel?.alternatives?.[0];
      const txt = alt?.transcript;
      if (!txt) return;
      if (j.is_final) {
        pending = (pending + " " + txt).trim();
        send({ type: "TRANSCRIPT", text: txt, final: true });
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(fireQuestion, 800);
        if (QUESTION_RE.test(txt)) fireQuestion();
      } else {
        send({ type: "TRANSCRIPT", text: txt, final: false });
      }
    } catch {}
  };
  dgWs.onerror = () => send({ type: "CAPTURE_ERROR", error: "deepgram-ws" });
}

// Fallback: browser SpeechRecognition. NOTE: standard SpeechRecognition reads
// the default mic, not our captured stream — so this fallback works best when
// the interviewer audio also plays through the speakers/mic loopback. We expose
// this honestly; Deepgram BYOK is the recommended path for clean separation.
function startBrowserOnStream(lang) {
  const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
  if (!SR) { send({ type: "CAPTURE_ERROR", error: "no-speech-api" }); return; }
  const rec = new SR();
  rec.continuous = true; rec.interimResults = true;
  rec.lang = { en: "en-US", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR" }[lang] || "en-US";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        pending = (pending + " " + r[0].transcript).trim();
        send({ type: "TRANSCRIPT", text: r[0].transcript, final: true });
        clearTimeout(silenceTimer); silenceTimer = setTimeout(fireQuestion, 900);
        if (QUESTION_RE.test(r[0].transcript)) fireQuestion();
      } else interim += r[0].transcript;
    }
    if (interim) send({ type: "TRANSCRIPT", text: interim, final: false });
  };
  rec.onend = () => { try { rec.start(); } catch {} };
  try { rec.start(); } catch {}
  self._acecueRec = rec;
}

function fireQuestion() {
  clearTimeout(silenceTimer);
  const q = pending.trim(); pending = "";
  if (q) send({ type: "QUESTION", text: q });
}

function stop() {
  try { recorder?.stop(); } catch {}
  try { dgWs?.close(); } catch {}
  try { self._acecueRec?.stop?.(); } catch {}
  try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { audioCtx?.close(); } catch {}
  stream = audioCtx = recorder = dgWs = null; pending = "";
}

async function getConfig() {
  return new Promise((res) => {
    chrome.storage.local.get(["acecue.keys", "acecue.settings"], (data) => {
      let keys = {}, settings = {};
      try { keys = JSON.parse(data["acecue.keys"] || "{}"); } catch {}
      try { settings = JSON.parse(data["acecue.settings"] || "{}"); } catch {}
      res({ deepgramKey: keys.deepgram || "", lang: settings.interviewLang || "en" });
    });
  });
}

function send(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }
