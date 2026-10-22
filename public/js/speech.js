// Microphone dictation with the browser's Web Speech API (Chrome, Edge,
// Safari). In Chrome the audio is sent to Google's speech service; nothing
// goes through this app's server. Firefox does not support it.

const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export const speechSupported = Boolean(SR);

export class Dictation {
  // onUpdate(finalText, interimText) is called as words arrive.
  // onStateChange(listening, errorCode) when it starts or stops.
  constructor({ lang = "en-US", onUpdate, onStateChange }) {
    this.lang = lang;
    this.onUpdate = onUpdate;
    this.onStateChange = onStateChange;
    this.listening = false;
    this.finalText = "";
  }

  start() {
    if (!SR || this.listening) return;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    this.finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript.trim() + " ";
        else interim += r[0].transcript;
      }
      this.onUpdate?.(this.finalText, interim);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") return;
      this.stop(e.error);
    };
    // Chrome ends recognition after a pause; restart until the user stops.
    rec.onend = () => {
      if (this.listening) {
        try { rec.start(); } catch { this.stop(); }
      }
    };
    this.rec = rec;
    this.listening = true;
    try {
      rec.start();
      this.onStateChange?.(true);
    } catch (e) {
      this.stop("start-failed");
    }
  }

  stop(errorCode) {
    const was = this.listening;
    this.listening = false;
    try { this.rec?.stop(); } catch { /* already stopped */ }
    if (was || errorCode) this.onStateChange?.(false, errorCode);
  }
}

export function speechLang(lang) {
  return lang === "zh" ? "zh-CN" : "en-US";
}
