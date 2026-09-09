// PSN PROXY — server-side stand-in for PlayStation Network.
//
// Why this exists: Sony has no public API and no third-party OAuth —
// see the spike at scripts/psn-spike.mjs for how that was confirmed,
// and for the finding this whole function rests on: ONE authenticated
// PSN session (via the NPSSO token below) can look up ANY other
// player's library and playtime by their online ID, not just its own
// account's. That means users never touch PSN at all — they type an
// online ID, this function does the lookup with a single service
// account's session, and nothing belonging to the user is ever asked
// for or stored.
//
// The account behind PSN_NPSSO should be a spare/throwaway PSN
// account, not Ishant's real one — see the memory on this decision.
// This function does every lookup for every user through that one
// account, which is a very different traffic pattern from a person
// occasionally browsing PlayStation.com, and if Sony ever notices and
// restricts it, better that lands on an account nothing real is
// riding on.
//
// One-time setup:
//   1. Log into the service PSN account in a browser, then visit
//      https://ca.account.sony.com/api/v1/ssocookie — copy the
//      64-character "npsso" value. It's good for ~60 days; when it
//      expires, repeat this step and re-run step 3.
//   2. supabase functions deploy psn-proxy
//   3. supabase secrets set PSN_NPSSO=xxxx
//
// The app calls this with:
//   POST { action: "resolve", onlineId: "SomePsnId" }
//     -> { accountId, onlineId, avatarUrl } or { accountId: null }
//   POST { action: "library", accountId: "798..." }
//     -> { titles: [{ platformGameId, name, playtimeMinutes, lastPlayedAt }] }
// resolve+library are separate calls (not one combined "connect"
// action) so a later re-sync can skip straight to library once
// accountId is already stored, without re-searching by name every time.

import {
  exchangeNpssoForCode,
  exchangeCodeForAccessToken,
  makeUniversalSearch,
  getUserPlayedGames,
} from "npm:psn-api@2";

const NPSSO = Deno.env.get("PSN_NPSSO");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// PSN access tokens are short-lived (documented nowhere, observed
// ~1 hour) but the NPSSO session behind them is good for ~60 days and
// can be re-exchanged for a fresh access token any number of times in
// that window — same shape as igdb-proxy's Twitch token cache, just a
// different upstream. Refreshed 5 minutes before actual expiry.
let cachedAuth: { auth: unknown; expiresAt: number } | null = null;

async function getAuth() {
  if (cachedAuth && cachedAuth.expiresAt > Date.now()) return cachedAuth.auth;
  const accessCode = await exchangeNpssoForCode(NPSSO!);
  const auth = await exchangeCodeForAccessToken(accessCode);
  const expiresInSec = (auth as { expiresIn?: number }).expiresIn ?? 3600;
  cachedAuth = { auth, expiresAt: Date.now() + (expiresInSec - 300) * 1000 };
  return auth;
}

// ISO-8601 durations ("PT84H30M") is the shape playDuration actually
// comes back as; some entries use plain milliseconds instead. Returns
// whole minutes, since that's what imported_games.playtime_minutes
// stores — converting to hours at import time would throw away detail
// (see the migration's own reasoning for storing minutes).
function durationToMinutes(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Math.round(v / 60000);
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(String(v));
  if (!m) return 0;
  const d = Number(m[1] || 0), h = Number(m[2] || 0), min = Number(m[3] || 0);
  return d * 24 * 60 + h * 60 + min;
}

async function resolveOnlineId(onlineId: string) {
  const auth = await getAuth();
  const search = await makeUniversalSearch(auth, onlineId, "SocialAllAccounts");
  type SearchResult = { socialMetadata?: { accountId?: string }; onlineId?: string; avatarUrls?: { avatarUrl?: string }[] };
  const results = (search as { domainResponses?: { results?: SearchResult[] }[] })?.domainResponses?.[0]?.results ?? [];
  const hit = results[0];
  const accountId = hit?.socialMetadata?.accountId ?? null;
  if (!accountId) return { accountId: null };
  return {
    accountId,
    onlineId: hit?.onlineId ?? onlineId,
    avatarUrl: hit?.avatarUrls?.[0]?.avatarUrl ?? null,
  };
}

async function fetchLibrary(accountId: string) {
  const auth = await getAuth();
  const res = await getUserPlayedGames(auth, accountId);
  type PlayedGame = {
    titleId?: string; npTitleId?: string; concept?: { id?: string };
    name?: string; titleName?: string;
    playDuration?: unknown; playTime?: unknown;
    lastPlayedDateTime?: string; firstPlayedDateTime?: string;
  };
  const list = ((res as { titles?: PlayedGame[]; games?: PlayedGame[] }).titles
    ?? (res as { titles?: PlayedGame[]; games?: PlayedGame[] }).games
    ?? []);
  const titles = list.map((g) => ({
    platformGameId: g.titleId || g.npTitleId || g.concept?.id || g.name || g.titleName || crypto.randomUUID(),
    name: g.name || g.titleName || "Untitled",
    playtimeMinutes: durationToMinutes(g.playDuration ?? g.playTime),
    lastPlayedAt: g.lastPlayedDateTime || g.firstPlayedDateTime || null,
  }));
  return { titles };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  if (!NPSSO) {
    return json({ error: "PSN_NPSSO is not set as a Supabase secret yet." }, 500);
  }

  let action: string, onlineId: string | undefined, accountId: string | undefined;
  try {
    const body = await req.json();
    action = body.action;
    onlineId = body.onlineId;
    accountId = body.accountId;
    if (action !== "resolve" && action !== "library") throw new Error("bad action");
  } catch {
    return json({ error: 'Body must be { action: "resolve", onlineId } or { action: "library", accountId }' }, 400);
  }

  try {
    if (action === "resolve") {
      if (!onlineId) return json({ error: "onlineId is required" }, 400);
      return json(await resolveOnlineId(onlineId));
    }
    if (!accountId) return json({ error: "accountId is required" }, 400);
    return json(await fetchLibrary(accountId));
  } catch (err) {
    // A stale/expired NPSSO surfaces here as an auth failure on the
    // very first call after it lapses — the error message is passed
    // straight through since it's the clearest signal for whoever
    // reads the Supabase function logs that it's time to refresh it,
    // not a bug in this function.
    cachedAuth = null; // don't keep retrying with whatever just failed
    return json({ error: (err as Error).message || "PSN request failed" }, 502);
  }
});
