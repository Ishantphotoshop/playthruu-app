// STEAMGRIDDB PROXY — server-side stand-in for the SteamGridDB API.
//
// Why this exists: fetching game art (a transparent-background title
// logo, and a high-resolution portrait cover) needs an API key that
// must never ship in client-side JS (same reasoning as igdb-proxy's
// Twitch secret). This function holds that key as a Supabase secret,
// searches SteamGridDB for the game by name ONCE, then fetches both
// asset types off that one match — a "Logo" (transparent PNG title
// art) and the highest-resolution portrait "Grid" (a library-style
// cover, often noticeably higher-res than IGDB's own cover art) — or
// null for either/both if SteamGridDB has nothing for that title.
//
// One-time setup:
//   1. Create a free account at https://www.steamgriddb.com, then
//      generate an API key at https://www.steamgriddb.com/profile/preferences
//      (the "API" tab).
//   2. supabase functions deploy steamgriddb-proxy
//   3. supabase secrets set STEAMGRIDDB_API_KEY=xxxx
//
// The app calls this with: POST { title: "Hollow Knight" }
// and gets back: { logo_url: "https://..."|null, grid_url: "https://..."|null }.

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

type GridAsset = { url?: string; width?: number; height?: number; style?: string; type?: string };

// The highest-resolution genuinely PORTRAIT cover in the results — the
// grids endpoint also serves landscape 460x215-style banners (a
// different Steam UI element entirely), so height>width is a real
// correctness filter here, not just a preference. "Highest quality
// possible" is interpreted literally: no dimensions filter is sent to
// SteamGridDB at all, so whatever the largest community upload is (often
// well beyond IGDB's own capped cover_big size) wins, static images only
// (an animated grid is a poor fit for a still poster).
function pickBestGrid(list: GridAsset[]): string | null {
  const portraits = list.filter((g) => g.url && g.type !== "animated" && (g.height ?? 0) > (g.width ?? 0));
  if (!portraits.length) return null;
  portraits.sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!));
  return portraits[0].url ?? null;
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
  const empty = { logo_url: null, grid_url: null };

  try {
    // 1) Find SteamGridDB's own game id for this title — one lookup,
    // shared by both asset fetches below.
    const searchRes = await fetch(`${BASE}/search/autocomplete/${encodeURIComponent(title)}`, { headers: auth });
    if (!searchRes.ok) return json(empty); // no match, not an error — most obscure/indie titles just won't be in SGDB
    const searchData = await searchRes.json();
    const gameId = searchData?.data?.[0]?.id;
    if (!gameId) return json(empty);

    // 2) Logos and grids side by side — independent asset types, no
    // reason to wait on one before starting the other.
    const [logoRes, gridRes] = await Promise.all([
      fetch(`${BASE}/logos/game/${gameId}?limit=1`, { headers: auth }),
      fetch(`${BASE}/grids/game/${gameId}`, { headers: auth }),
    ]);

    const logo_url = logoRes.ok ? ((await logoRes.json())?.data?.[0]?.url || null) : null;
    const grid_url = gridRes.ok ? pickBestGrid(((await gridRes.json())?.data || [])) : null;

    return json({ logo_url, grid_url });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "SteamGridDB proxy error" }, 502);
  }
});
