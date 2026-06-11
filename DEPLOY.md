# Deploying AceCue

AceCue is a static site (`public/`) plus Vercel **edge functions** (`api/`). It needs **zero** environment variables to work — guests use their own model keys (BYOK). Everything below is optional polish.

---

## Option A — One-click via GitHub + Vercel dashboard (recommended)

1. **Push this repo to GitHub** (already done if you're reading this on GitHub):
   ```bash
   git remote add origin https://github.com/appleweiping/acecue.git
   git push -u origin master
   ```
2. Go to **https://vercel.com/new** and **Import** the `acecue` repo.
3. Vercel auto-detects the config from `vercel.json`. Leave the defaults:
   - Framework preset: **Other**
   - Build command: `node build.js`
   - Output directory: `public`
4. Click **Deploy**. Done — you get a `https://acecue-xxxx.vercel.app` URL in ~30s.
5. (Optional) In **Settings → Domains**, add `acecue.app` or rename the project to `acecue` so the URL becomes `https://acecue.vercel.app` (this is the URL the Chrome extension is hard-coded to call — see note below).

> **Extension URL note:** the extension's `manifest.json` `host_permissions` and the API base in `background.js`/`overlay.js`/`popup.js` point to `https://acecue.vercel.app`. If your deployment URL differs, edit those three files + the manifest, re-run `node build.js`, and re-zip.

---

## Option B — Vercel CLI (if you have a token)

```bash
npm i -g vercel
vercel --prod        # follow the prompts; or:
vercel --prod --token YOUR_TOKEN --yes
```

---

## Optional environment variables

Set these in **Vercel → Project → Settings → Environment Variables** only if you want them. None are required.

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, … | Operator keys: let visitors try a model **without** pasting their own key (you pay). See `.env.example` for the full list. |
| `RELAY_BASE_URL`, `RELAY_API_KEY` | Optional OpenAI-compatible relay (one endpoint, many models). |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Enable optional cloud account sync. **Both are public-safe** (the anon key is meant to be exposed). Without them, the app runs guest-only. |

### Enabling cloud sync (optional)
1. Create a free project at **https://supabase.com**.
2. In the SQL editor, create the sync table:
   ```sql
   create table acecue_sync (
     user_id uuid primary key references auth.users(id),
     payload jsonb,
     updated_at timestamptz default now()
   );
   alter table acecue_sync enable row level security;
   create policy "own row" on acecue_sync
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```
3. In **Authentication → Providers**, enable **Email** (password).
4. Copy the project **URL** and **anon key** into the Vercel env vars above and redeploy.

API keys (BYOK) **never** sync — only settings, résumé, and practice history.

---

## Publishing the Chrome extension

The build packages `public/extension.zip` automatically (the landing-page "Download Plugin" button serves it). To distribute:

- **Side-load (instant, no review):** users unzip, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the folder. The download button + a short guide cover this.
- **Chrome Web Store (slower, review required):** zip the `extension/` folder and submit at the [developer dashboard](https://chrome.google.com/webstore/devconsole). Position AceCue as an **interview-practice / accessibility** tool to reduce review friction.

---

## Local development

```bash
npm run dev          # serves public/ at http://localhost:3000
```
Edge functions (`api/`) only run on Vercel. For full local testing of the API, use `vercel dev`.
