// AceCue — Account view. GUEST-FIRST: the app is fully usable with no account.
// Optional Supabase email/password sync of settings/résumé/history. BYOK keys
// NEVER sync (Store.exportSyncable excludes them by design).
//
// If SUPABASE_URL/ANON_KEY aren't injected by build.js, this view shows a
// "cloud sync not configured" note and everything stays local.

import { I18N } from "./i18n.js";
import { Store } from "./store.js";

let toast, sb = null, user = null;
const $ = (id) => document.getElementById(id);
const ENV = window.ACECUE_ENV || {};
const ENABLED = !!(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY);

export function initAccount(ctx) {
  toast = ctx.toast;

  if (!ENABLED) {
    $("acc-form").style.display = "none";
    $("acc-disabled").style.display = "block";
    return;
  }

  $("acc-signin").addEventListener("click", () => auth("in"));
  $("acc-signup").addEventListener("click", () => auth("up"));
  $("acc-signout").addEventListener("click", signOut);

  // lazy-load supabase only when account view is first used
  window.addEventListener("acecue:view", (e) => { if (e.detail === "account") ensureClient(); }, { once: false });
}

async function ensureClient() {
  if (sb || !ENABLED) return sb;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getSession();
  if (data?.session) { user = data.session.user; await afterLogin(); }
  return sb;
}

async function auth(kind) {
  await ensureClient();
  const email = $("acc-email").value.trim();
  const password = $("acc-pass").value;
  if (!email || !password) return;
  const fn = kind === "in" ? sb.auth.signInWithPassword({ email, password })
                           : sb.auth.signUp({ email, password });
  const { data, error } = await fn;
  if (error) { toast(error.message); return; }
  user = data.user;
  await afterLogin();
}

async function afterLogin() {
  $("acc-form").style.display = "none";
  $("acc-signed").style.display = "block";
  $("acc-email-label").textContent = user?.email || "";
  await pullSync();
  toast(I18N.t("account.syncing"));
}

async function signOut() {
  await sb?.auth.signOut();
  user = null;
  $("acc-signed").style.display = "none";
  $("acc-form").style.display = "block";
}

// pull cloud row → merge into local (keys never touched)
async function pullSync() {
  if (!user) return;
  const { data } = await sb.from("acecue_sync").select("payload").eq("user_id", user.id).maybeSingle();
  if (data?.payload) Store.importSyncable(data.payload);
  await pushSync(); // write back merged state
}

// push local syncable state → cloud
export async function pushSync() {
  if (!sb || !user) return;
  await sb.from("acecue_sync").upsert({ user_id: user.id, payload: Store.exportSyncable(), updated_at: new Date().toISOString() });
}
