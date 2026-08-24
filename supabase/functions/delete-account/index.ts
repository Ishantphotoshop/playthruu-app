// DELETE ACCOUNT — permanently removes the caller's account.
//
// Why this needs to be server-side: deleting the `profiles` row can be
// done from the browser (RLS allows the owner to), and it cascades to
// their logs, lists, follows, likes and favourites. But the underlying
// auth.users record can only be removed with the service-role key, and
// that key must never reach client code. Leaving the auth record behind
// would be worse than not deleting at all — the address would be stuck
// in limbo, unable to sign up again because it already exists, yet with
// no profile attached.
//
// The caller is identified from their own JWT, never from the request
// body, so this can only ever delete the account making the request.
//
// Setup:
//   supabase functions deploy delete-account
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the
// platform; there are no secrets to set by hand.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in." }, 401);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Identity comes from the token itself. Taking a user id from the
    // request body would let anyone delete anyone.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Not signed in." }, 401);

    // Profile first: this is what cascades the user's content away.
    // If it fails there's no point deleting the auth record, so the
    // account is left intact and the caller sees an error.
    const { error: profileErr } = await admin.from("profiles").delete().eq("id", user.id);
    if (profileErr) return json({ error: "Could not remove your data." }, 500);

    const { error: authErr } = await admin.auth.admin.deleteUser(user.id);
    if (authErr) {
      // The content is already gone at this point, so report it rather
      // than pretending the whole thing succeeded.
      return json({ error: "Your data was removed but the login record could not be deleted. Contact support." }, 500);
    }

    return json({ ok: true });
  } catch {
    return json({ error: "Could not delete your account right now." }, 500);
  }
});
