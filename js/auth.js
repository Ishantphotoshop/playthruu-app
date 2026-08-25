import { supabase, configured } from './supabase-client.js';
import { usernameAvailable } from './api.js';

function assertConfigured() {
  if (!configured) {
    throw new Error("Playthruu isn't connected to a database yet — add your Supabase URL and key to js/config.js first.");
  }
}

export async function signUp(email, password, username) {
  assertConfigured();
  const clean = username.trim().toLowerCase();
  if (!/^(?!.*\.\.)[a-z0-9._]{1,20}(?<!\.)$/.test(clean) || clean.startsWith('.')) {
    throw new Error('Usernames can be up to 20 characters: letters, numbers, periods, underscores. No leading/double periods.');
  }
  const available = await usernameAvailable(clean);
  if (!available) throw new Error('That username is taken. Try another.');

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username: clean } },
  });
  if (error) throw error;
  return data;
}

// Accepts either an email or a username. Usernames aren't stored in
// Supabase Auth (only email is), so a username has to be resolved to an
// email before sign-in.
//
// That resolution deliberately happens SERVER-SIDE now, in the
// `username-login` Edge Function. It used to call the Postgres function
// get_email_for_username() straight from here, which handed the caller
// a real email address and was callable without logging in — combined
// with publicly-readable usernames, that let anyone dump every user's
// email. The function returns only a session; the email never reaches
// the browser.
export async function signIn(identifier, password) {
  assertConfigured();
  const clean = identifier.trim();

  if (clean.includes('@')) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: clean, password });
    if (error) throw error;
    return data;
  }

  let result = null;
  let fnUnavailable = false;
  try {
    const { data, error } = await supabase.functions.invoke('username-login', {
      body: { username: clean.toLowerCase(), password },
    });
    if (error) fnUnavailable = true;
    else result = data;
  } catch {
    fnUnavailable = true;
  }

  if (!fnUnavailable && result?.session) {
    // Hand the returned tokens to the client so it behaves exactly as if
    // signInWithPassword had run here.
    const { data, error } = await supabase.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token,
    });
    if (error) throw error;
    return data;
  }

  // The function answered and rejected the credentials — identical
  // message for "no such user" and "wrong password" on purpose, so this
  // can't be used to test which usernames have accounts.
  if (!fnUnavailable) throw new Error(result?.error || 'Incorrect username or password.');

  // The Edge Function isn't deployed (or is unreachable), so fall back to
  // the older client-side lookup. This path is the one with the email
  // -harvesting weakness described in migrations/2026-08-14_security_hardening.sql,
  // and it stops working the moment that migration is run, because the
  // migration revokes this RPC from anon — which is the intended end
  // state. It exists only so login keeps working in the window between
  // deploying this code and deploying the function; without it, updating
  // the app locked everyone out until the function was live.
  const { data: resolvedEmail, error: lookupErr } = await supabase.rpc('get_email_for_username', { uname: clean.toLowerCase() });
  if (lookupErr || !resolvedEmail) {
    throw new Error('Incorrect username or password.');
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: resolvedEmail, password });
  if (error) throw error;
  return data;
}

// Sends the "reset your password" email. The link inside it brings the
// person back to this same app with a recovery token in the URL —
// Supabase's client picks that up automatically and fires a
// PASSWORD_RECOVERY event (see onAuthChange's caller in app.js), which
// is what actually prompts for the new password, not this function.
export async function sendPasswordReset(email) {
  assertConfigured();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${location.origin}${location.pathname}`,
  });
  if (error) throw error;
}

// Only valid right after a PASSWORD_RECOVERY event — that's what proves
// this is really the person from the email link, so (unlike
// changePassword above) there's no current password to re-check here.
export async function updatePasswordAfterReset(newPassword) {
  assertConfigured();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Where the packaged app is told to send people back to after signing in
// with a provider — see the native branch of signInWithProvider() below.
// Registered as an Android intent-filter in native_shell's
// AndroidManifest.xml, and must ALSO be added to Supabase's own allowed
// redirect URLs (Authentication -> URL Configuration) or Supabase will
// refuse to redirect here at all.
const NATIVE_AUTH_REDIRECT = 'playthruu://auth-callback';

// Sign in through an external provider (twitch | google | discord).
//
// On the web, this hands the browser off to the provider and comes back
// to redirectTo, so nothing after the call runs — the session is picked
// up by the SIGNED_IN listener in app.js on return. redirectTo is built
// from the current location rather than hardcoded so the same code works
// on localhost and on the deployed site, which have different origins.
//
// Inside the packaged app this can't work the same way: the WebView has
// no real hostname (it's served from https://localhost — see
// capacitor.config.json), so redirecting there sends people to a URL
// that resolves to nothing on their phone. They'd complete the Google
// login (Supabase would even show them as signed in on the dashboard)
// but the app itself would never see it — exactly the bug a friend hit
// testing this on his own phone. Native instead opens the provider in an
// in-app browser tab and asks it to come back to a custom-scheme link
// Android can route straight back into the app; app.js's appUrlOpen
// listener finishes the sign-in from there.
export async function signInWithProvider(provider) {
  assertConfigured();
  const isNative = !!window.Capacitor?.Plugins?.Browser;
  if (isNative) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
    });
    if (error) throw error;
    await window.Capacitor.Plugins.Browser.open({ url: data.url });
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${location.origin}${location.pathname}` },
  });
  if (error) throw error;
}

// Supabase requires a recent sign-in for this to succeed; if it's been a
// while, it'll ask the person to log in again rather than silently fail.
export async function changePassword(currentPassword, newPassword) {
  assertConfigured();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) throw new Error('Could not verify your current session.');
  // Re-authenticate first so a stolen/leftover session can't change the
  // password without knowing the current one.
  const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (reauthErr) throw new Error('Current password is incorrect.');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// Changing email sends a confirmation link to the NEW address — the
// address only updates once that link is clicked.
export async function changeEmail(newEmail) {
  assertConfigured();
  const { error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(event, session));
}
