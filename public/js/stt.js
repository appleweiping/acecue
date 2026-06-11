// AceCue — speech-to-text + question-boundary detection.
//
// PRIMARY (free, client-side): browser Web Speech API (Chrome/Edge). It streams
// interim + final transcripts with no key. We auto-re-arm on its auto-stop.
//
// AUDIO SOURCE: in the web app we capture the *meeting tab's* audio via
// getDisplayMedia({audio:true}) so the interviewer's voice is isolated from the
// candidate's mic (the key architectural trick). Web Speech itself listens to
// the mic, so for the tab-audio path we either (a) route tab audio so the user
// hears it and rely on the question being asked aloud, or (b) on premium STT
// (Deepgram/AssemblyAI) we feed the captured tab stream directly. The mic path
// is the simplest fallback. See captureTabAudio() / startBrowserSTT().
//
// QUESTION-END DETECTION combines: a "?" in the text, interrogative leading
// words, and a silence timer after the last final result. onQuestion(text) fires
// once per detected question; callers debounce/​cancel speculative LLM calls.

const QUESTION_LEAD = /^(what|why|how|when|where|who|which|can|could|would|will|do|did|does|are|is|tell me|describe|explain|walk me|give me|have you|说说|请|为什么|如何|怎么|什么|介绍|谈谈|教えて|なぜ|どう|どの|何|왜|어떻게|무엇|설명|말씀)/i;

export function isLikelyQuestion(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (/[?？]/.test(t)) return true;
  if (t.length > 12 && QUESTION_LEAD.test(t)) return true;
  return false;
}

// ---- Web Speech API recognizer (free) ----
export class BrowserSTT {
  constructor({ lang = "en-US", onInterim, onFinal, onQuestion, silenceMs = 900 }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this.unsupported = true; return; }
    this.rec = new SR();
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.lang = lang;
    this.onInterim = onInterim; this.onFinal = onFinal; this.onQuestion = onQuestion;
    this.silenceMs = silenceMs;
    this.running = false;
    this.pending = "";       // accumulates finals until a question boundary
    this.silenceTimer = null;

    this.rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0].transcript;
        if (r.isFinal) {
          this.pending = (this.pending + " " + txt).trim();
          this.onFinal?.(txt.trim());
          this._armSilence();
          if (isLikelyQuestion(txt)) this._fireQuestion();
        } else {
          interim += txt;
        }
      }
      if (interim) this.onInterim?.(interim.trim());
    };
    this.rec.onend = () => { if (this.running) { try { this.rec.start(); } catch {} } };
    this.rec.onerror = (e) => { if (e.error === "no-speech" || e.error === "aborted") return; };
  }

  _armSilence() {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => { if (this.pending.trim()) this._fireQuestion(); }, this.silenceMs);
  }
  _fireQuestion() {
    clearTimeout(this.silenceTimer);
    const q = this.pending.trim();
    this.pending = "";
    if (q) this.onQuestion?.(q);
  }
  setLang(lang) { if (this.rec) this.rec.lang = lang; }
  start() { if (this.unsupported || this.running) return; this.running = true; try { this.rec.start(); } catch {} }
  stop() { this.running = false; clearTimeout(this.silenceTimer); try { this.rec?.stop(); } catch {} }
}

// Map a UI/interview lang code to a Web Speech BCP-47 tag.
export function sttLangTag(lang) {
  return { en: "en-US", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR" }[lang] || "en-US";
}

// ---- Tab/display audio capture (isolates the interviewer's voice) ----
// Returns a MediaStream containing the chosen tab's audio, and routes it to the
// speakers so the candidate still hears the interviewer. Web app path only;
// the extension captures silently via chrome.tabCapture (see extension/).
export async function captureTabAudio() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,            // Chrome requires a video track to offer tab audio
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // bias the picker toward the call tab and drop our own page's audio
    systemAudio: "include",
    selfBrowserSurface: "exclude",
  });
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("no-tab-audio"); // user forgot to tick "Share tab audio"
  }
  // we don't need the video — stop it to save resources
  stream.getVideoTracks().forEach((t) => t.stop());

  // route audio to speakers so the user still hears the interviewer
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(new MediaStream(audioTracks));
  src.connect(ctx.destination);

  return { stream: new MediaStream(audioTracks), ctx };
}

// ---- Premium streaming STT via Deepgram (BYOK) over WebSocket ----
// Feeds a captured MediaStream (e.g. tab audio) straight to Deepgram Nova for
// low-latency, accurate transcripts with the candidate's voice excluded.
export class DeepgramSTT {
  constructor({ apiKey, lang = "en", onInterim, onFinal, onQuestion, silenceMs = 800 }) {
    this.apiKey = apiKey; this.lang = lang;
    this.onInterim = onInterim; this.onFinal = onFinal; this.onQuestion = onQuestion;
    this.silenceMs = silenceMs; this.pending = ""; this.silenceTimer = null;
  }
  async start(stream) {
    const params = new URLSearchParams({
      model: "nova-2", language: this.lang, interim_results: "true",
      smart_format: "true", punctuate: "true", endpointing: "300",
    });
    // Deepgram accepts the key via the WS subprotocol ["token", <key>]
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", this.apiKey]);
    this.ws.onopen = () => {
      this.mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      this.mr.ondataavailable = (e) => { if (e.data.size && this.ws?.readyState === 1) this.ws.send(e.data); };
      this.mr.start(250);
    };
    this.ws.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data);
        const alt = j.channel?.alternatives?.[0];
        if (!alt) return;
        const txt = alt.transcript;
        if (!txt) return;
        if (j.is_final) {
          this.pending = (this.pending + " " + txt).trim();
          this.onFinal?.(txt);
          clearTimeout(this.silenceTimer);
          this.silenceTimer = setTimeout(() => this._fire(), this.silenceMs);
          if (isLikelyQuestion(txt)) this._fire();
        } else {
          this.onInterim?.(txt);
        }
      } catch {}
    };
  }
  _fire() { clearTimeout(this.silenceTimer); const q = this.pending.trim(); this.pending = ""; if (q) this.onQuestion?.(q); }
  setLang(l) { this.lang = l; }
  stop() { clearTimeout(this.silenceTimer); try { this.mr?.stop(); } catch {} try { this.ws?.close(); } catch {} }
}
