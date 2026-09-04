// STEAMGRIDDB PROXY — server-side stand-in for the SteamGridDB API.
//
// Why this exists: fetching a transparent-background title-logo PNG for
// a game's page needs an API key that must never ship in client-side JS
// (same reasoning as igdb-proxy's Twitch secret). This function holds
// that key as a Supabase secret, searches SteamGridDB for the game by
// name, and returns the single best "Logo" asset it finds (a
// transparent PNG game-title graphic) — or null if SteamGridDB has
// nothing for that title.
//
// One-time setup:
//   1. Create a free account at https://www.steamgriddb.com, then
//      generate an API key at https://www.steamgriddb.com/profile/preferences
//      (the "API" tab).
//   2. supabase functions deploy steamgriddb-proxy
//   3. supabase secrets set STEAMGRIDDB_API_KEY=xxxx
//
// The app calls this with: POST { title: "Hollow Knight" }
// and gets back: { logo_url: "https://..." } or { logo_url: null }.

const API_KEY = Deno.env.get("STEAMGRIDDB_API_KEY");
const BASE = "https://www.steamgriddb.com/api/v2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  if (!API_KEY) {
    return json({ error: "STEAMGRIDDB_API_KEY is not set as a Supabase secret yet." }, 500);
  }

  let title: string;
  try {
    const body = await req.json();
    title = (body.title || "").trim();
    if (!title) throw new Error("bad shape");
  } catch {
    return json({ error: 'Body must be { title: string }' }, 400);
  }

  const auth = { Authorization: `Bearer ${API_KEY}` };

  try {
    // 1) Find SteamGridDB's own game id for this title.
    const searchRes = await fetch(`${BASE}/search/autocomplete/${encodeURIComponent(title)}`, { headers: auth });
    if (!searchRes.ok) return json({ logo_url: null }); // no match, not an error — most obscure/indie titles just won't be in SGDB
    const searchData = await searchRes.json();
    const gameId = searchData?.data?.[0]?.id;
    if (!gameId) return json({ logo_url: null });

    // 2) Fetch its logos — transparent-background title art, as opposed
    // to grids/heroes/icons which are full rectangular images.
    const logoRes = await fetch(`${BASE}/logos/game/${gameId}?limit=1`, { headers: auth });
    if (!logoRes.ok) return json({ logo_url: null });
    const logoData = await logoRes.json();
    const url = logoData?.data?.[0]?.url || null;
    return json({ logo_url: url });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "SteamGridDB proxy error" }, 502);
  }
});
