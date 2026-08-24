// IGDB PROXY — server-side stand-in for the IGDB API.
//
// Why this exists: IGDB blocks requests made directly from a browser (no
// CORS), and authenticating against it needs a Twitch Client Secret that
// must never be shipped in client-side JS. This function holds that
// secret as a Supabase secret, exchanges it for a short-lived Twitch
// "app access token" (cached in memory, refreshed automatically before
// it expires), and forwards whatever Apicalypse query the app sends
// along to the real IGDB endpoint.
//
// One-time setup:
//   1. Create a free app at https://dev.twitch.tv/console/apps
//      (category "Other" or "Application Integration", OAuth Redirect
//      URL can just be http://localhost — it's not used for this flow).
//      This gives you a Client ID + Client Secret.
//   2. supabase functions deploy igdb-proxy
//   3. supabase secrets set TWITCH_CLIENT_ID=xxxx TWITCH_CLIENT_SECRET=xxxx
//
// The app calls this with: POST { endpoint: "games", query: "fields ...;" }
// and gets back exactly what IGDB would have returned.

const CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Twitch app access tokens last ~60 days. Cached in memory so a burst of
// searches doesn't re-authenticate on every single request — refreshed
// 5 minutes before actual expiry to stay safely ahead of it.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const url = `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`Twitch auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return cachedToken.token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return new Response(
      JSON.stringify({ error: "TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set as Supabase secrets yet." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  let endpoint: string, query: string;
  try {
    const body = await req.json();
    endpoint = body.endpoint;
    query = body.query;
    if (!endpoint || typeof query !== "string") throw new Error("bad shape");
  } catch {
    return new Response(JSON.stringify({ error: 'Body must be { endpoint: string, query: string }' }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const token = await getAccessToken();
    const igdbRes = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: "POST",
      headers: { "Client-ID": CLIENT_ID, Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: query,
    });
    const text = await igdbRes.text();
    return new Response(text, {
      status: igdbRes.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "IGDB proxy error" }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
