# AceCue — Handoff to GPT-5.5 Codex

This document hands off the AceCue project. The web app + Chrome extension are **built and working**; deployment requires an interactive Vercel login (which the building agent can't do). Below: what's done, what's verified, what's open, and concrete next tasks.

## TL;DR
- **Status:** Feature-complete v1 for both web app and MV3 extension. All JS syntax-checks pass; build runs; locales have full key parity; extension zips cleanly. Not yet deployed, not yet on GitHub remote (push step pending).
- **Stack:** Static `public/` + Vercel edge functions (`api/`). Vanilla JS ESM, no framework, no runtime deps. i18n in 4 languages (en/zh/ja/ko). Guest-first; optional Supabase sync.
- **The core trick:** capture the *meeting tab's* audio (not the mic) → the interviewer's voice is isolated from the candidate for free. Web app uses `getDisplayMedia`; extension uses `chrome.tabCapture` + offscreen document.

## Architecture map

```
api/_providers.js   Provider registry (12 providers, OpenAI-shape + Anthropic). resolveAuth(), detectProvider().
api/chat.js         Edge: streaming SSE proxy {provider,model,messages} → {delta}. BYOK via X-User-Key header.
api/models.js       Edge: provider catalog + availability badges.
api/detect.js       Edge: key-shape → provider id (mirror of client detect).
build.js            Writes public/js/env.js (Supabase public cfg) + packages public/extension.zip.

public/index.html   Landing (brand, live-vs-practice, download CTA, maker contact, ethics).
public/app.html     SPA shell: #/live #/practice #/settings #/account.
public/privacy.html Privacy & ethics page.
public/js/
  i18n.js           Locale loader + [data-i18n] swapper + lang switcher.
  theme.js          Light/dark toggle.
  store.js          localStorage state. exportSyncable() EXCLUDES keys by design.
  providers.js      Client catalog cache + detectProvider() mirror + recommendedFast().
  stt.js            BrowserSTT (Web Speech, free) + DeepgramSTT (BYOK WS) + captureTabAudio() + question detection.
  llm.js            buildLiveSystem() prompt (résumé/JD/tone) + streamChat() (cancellable SSE).
  md.js             Tiny safe markdown renderer.
  live.js           Live Assistant: capture→STT→question→speculative answer, glance/full, opacity/font, hotkeys.
  practice.js       Mock interview: AI interviewer + STAR feedback + summary.
  settings.js       Single-key paste auto-detect, résumé/JD, STT engine, tone.
  account.js        Supabase guest-first auth + sync (lazy-loaded; no-op if unconfigured).
public/locales/     en/zh/ja/ko.json — full key parity (verified).

extension/          MV3: manifest, background.js (tabCapture + offscreen + overlay window),
                    offscreen.{html,js} (getUserMedia from streamId, re-route to speakers, Deepgram/Web Speech STT),
                    popup.{html,js} (user-gesture start), overlay.{html,js} (floating answer window),
                    bridge.js (content script: mirror localStorage keys → chrome.storage on acecue.vercel.app),
                    icons/ (generated PNGs).
```

## What's verified
- `node --check` passes on all 14 public JS + 4 api JS + build.js + gen-icons.mjs.
- `node build.js` runs: writes env.js, packages a valid 12-file extension.zip (unzip -l confirms).
- All 4 locale JSON parse; **key parity is exact** across zh/ja/ko vs en (checked programmatically).
- Icons are valid PNGs at 16/48/128.

## What is NOT verified (do this)
1. **Runtime browser test.** No browser run yet. Load `public/` via `vercel dev` (for the api/) and click through: Settings → paste a key (try a Groq `gsk_...` key — free + fast), Live → type a question (the typed path avoids needing audio), confirm streaming answer. Then Practice → start mock → feedback.
2. **Live audio path.** Test `getDisplayMedia` tab-audio capture in Chrome on a real Meet/Zoom tab. Web Speech listens to the *mic*, so the free path relies on hearing the question aloud; the clean path is Deepgram BYOK. Validate both, and the "no tab audio ticked" error.
3. **Extension load.** `chrome://extensions` → Load unpacked → `extension/`. Test: popup "Start on this tab" → offscreen capture → overlay window opens → speak a question → answer streams. Verify the tab still plays audio (the re-route in offscreen.js). Verify `bridge.js` copies keys after visiting the deployed app.
4. **Deepgram WS auth.** offscreen.js + stt.js use the `["token", key]` subprotocol. Confirm against current Deepgram docs; if they changed auth, fix both places.

## Open tasks / next steps (priority order)
1. **Deploy to Vercel** (see DEPLOY.md). Then **rename project to `acecue`** so the URL is `https://acecue.vercel.app` — the extension hard-codes that origin in manifest.json + background.js + overlay.js + popup.js. If the URL differs, update those 4 spots, re-run build, re-zip.
2. **Push to GitHub** `appleweiping/acecue` (local git is initialized; remote/push pending — the building agent stopped before pushing).
3. **Maker contact:** real email/links are placeholders (`appleweiping@example.com`, `Weiping`). Update in `public/js/landing.js` (MAKER object) and README.
4. **AssemblyAI STT** is offered in the Settings dropdown but only Deepgram is implemented. Either implement the AssemblyAI streaming path in stt.js + offscreen.js, or remove the option until done.
5. **Hotkey "panic-hide"** in the web app toggles answer visibility; the extension command minimizes the overlay window. Consider `chrome.windows` alwaysOnTop alternatives (Chrome popup windows aren't reliably always-on-top — a known limitation; a future native/Electron companion is the real fix for full-screen-share stealth).
6. **Speculative LLM fire:** currently we answer on the *finalized* detected question. To shave latency further, fire on the partial transcript when a "?" appears and cancel/re-fire if the transcript changes (abort plumbing already exists in llm.js/live.js).
7. **OG image** (`public/assets/og.png`) referenced in index.html meta is not created — add one or remove the meta tag.

## Design rationale (from the 4-agent discussion)
- **Stealth is honest:** a pure extension cannot hide from full-screen capture (only native apps can via OS content-protection). The separate popup window is private only under single-tab share. This is stated plainly in the UI, README, and landing page — do not over-promise.
- **BYOK free-first** is the deliberate wedge vs $89–$299/mo competitors.
- **Practice Mode** is the unambiguously-legitimate anchor and the larger TAM.

## Conventions to keep
- No build framework; keep it vanilla ESM + edge functions.
- `detectProvider()` exists in BOTH api/_providers.js and public/js/providers.js — keep them in sync.
- BYOK keys must NEVER be sent anywhere except the provider call (and never synced). Preserve this in any new feature.
- Any new UI string goes into all 4 locale files (keep parity; there's a parity check snippet in the build history).
