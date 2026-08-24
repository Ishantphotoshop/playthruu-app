// USERNAME LOGIN — signs a user in by username without ever telling the
// browser what their email address is.
//
// Why this exists: the previous approach called a Postgres function,
// get_email_for_username(), straight from the browser to turn a username
// into an email, then signed in with that email. That function was
// granted to `anon`, so it needed no login to call — and because every
// username is publicly readable from `profiles`, anyone could list all
// usernames and then resolve each one to its real email address. That is
// a full dump of every user's email: a privacy breach, a spam list, and
// a ready-made target list for credential stuffing.
//
// The lookup now happens here instead, using the service-role key, which
// never leaves the server. The browser sends a username and password and
// gets back a session (or a generic failure). The email is used
// internally and is never part of the response.
//
// Setup:
//   supabase functions deploy username-login
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
// by the platform, so there are no secrets to set by hand.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Deliberately identical for "no such username" and "wrong password".
// Distinguishing them would confirm which usernames have accounts, which
// is exactly the enumeration this function exists to stop.
const GENERIC_FAILURE = { error: "Incorrect username or password." };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let username: string, password: string;
  try {
    const body = await req.json();
    username = String(body.username ?? "").trim().toLowerCase();
    password = String(body.password ?? "");
    if (!username || !password) throw new Error("missing fields");
  } catch {
    return json({ error: "Body must be { username: string, password: string }" }, 400);
  }

  try {
    // Service-role client: bypasses RLS, so it can read the auth user's
    // email. This client is server-only and must never be constructed
    // in the browser.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();

    if (!profile) return json(GENERIC_FAILURE, 400);

    const { data: userRes } = await admin.auth.admin.getUserById(profile.id);
    const email = userRes?.user?.email;
    if (!email) return json(GENERIC_FAILURE, 400);

    // Sign in with the ANON key, not the service role — this has to go
    // through the normal auth path so the returned session is a real
    // user session with the correct claims, rate limits and expiry.
    const publicClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) return json(GENERIC_FAILURE, 400);

    // Only the session goes back. The email stays server-side.
    return json({ session: data.session });
  } catch {
    return json({ error: "Could not sign in right now. Try again." }, 500);
  }
});
