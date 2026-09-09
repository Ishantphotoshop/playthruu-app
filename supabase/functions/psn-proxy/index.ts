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
  getUserTitles,
  getTitleTrophies,
  getUserTrophiesEarnedForTitle,
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

type PlayedGame = {
  titleId?: string; npTitleId?: string; concept?: { id?: string };
  name?: string; titleName?: string;
  playDuration?: unknown; playTime?: unknown;
  lastPlayedDateTime?: string; firstPlayedDateTime?: string;
};

// getUserPlayedGames pages at 200 titles per call (its own server-side
// cap, unrelated to our own imported_games limit) and reports how many
// titles exist in total via totalItemCount — so a library bigger than
// one page needs this loop, or only the most-recently-played 200 games
// would ever show up.
const PAGE_SIZE = 200;

async function fetchLibrary(accountId: string) {
  const auth = await getAuth();
  const titles: PlayedGame[] = [];
  let offset = 0;
  for (;;) {
    const res = await getUserPlayedGames(auth, accountId, { limit: PAGE_SIZE, offset });
    const page = ((res as { titles?: PlayedGame[]; games?: PlayedGame[] }).titles
      ?? (res as { titles?: PlayedGame[]; games?: PlayedGame[] }).games
      ?? []);
    titles.push(...page);
    const total = (res as { totalItemCount?: number }).totalItemCount ?? titles.length;
    offset += page.length;
    if (page.length === 0 || offset >= total) break;
  }
  return {
    titles: titles.map((g) => ({
      platformGameId: g.titleId || g.npTitleId || g.concept?.id || g.name || g.titleName || crypto.randomUUID(),
      name: g.name || g.titleName || "Untitled",
      playtimeMinutes: durationToMinutes(g.playDuration ?? g.playTime),
      lastPlayedAt: g.lastPlayedDateTime || g.firstPlayedDateTime || null,
    })),
  };
}

// ------------------------------------------------------------
// DID THEY FINISH IT?
// ------------------------------------------------------------
// PSN has no "completed" flag, so this reads it out of trophies. Three
// signals, in order of certainty:
//   1. platinum earned          — unambiguous
//   2. 100% progress            — every trophy, so also unambiguous
//   3. a "finished the story" trophy — needs the heuristic below
//
// The heuristic was written against a real 74-title account and checked
// title by title. The rule that makes it work: a completion verb has to
// directly govern the WHOLE game. Modifiers trailing after that don't
// weaken the signal — "complete the story on Grounded", "finish the game
// in under 2 hours", "complete the game without using the radio" all
// still required finishing it. What breaks the signal is a different
// OBJECT: "complete a game in an Arena" (one match of Rocket League),
// "complete 30 street races", "complete all optional Honor story
// missions". Hence a permissive tail and a strict head.
const VERB = String.raw`(?:complete[ds]?|finish(?:ed)?|beat(?:en)?)`;
const COMPLETION = new RegExp(
  String.raw`\b${VERB}\s+(?:the\s+)?(?:(?:main|full|entire|whole|base)\s+)?(?:story|game|campaign|adventure|epilogue)\b`,
  "i",
);
// "Completed the final mission." (GTA V) names the last beat of the
// story rather than calling it "the story".
const FINAL_BEAT = new RegExp(
  String.raw`\b${VERB}\s+the\s+(?:final|last)\s+(?:mission|chapter|episode|level|act|battle|boss)\b`,
  "i",
);
const NOT_THE_WHOLE_GAME = [
  new RegExp(String.raw`\b${VERB}\s+(?:a|an|one|another|\d+|all|each|every)\b`, "i"),
  /\ba\s+complete\s+game\b/i,
  /\b(co-?op|online|multiplayer|versus|legends mode|arena|mini-?game|side\s*quest|optional)\b/i,
];

function normalizeTrophyText(s: string) {
  return String(s).toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/\b(trophy set|trophies)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

// Plenty of games name themselves instead of saying "the game" —
// "Complete Marvel's Guardians of the Galaxy." — so the title counts as
// the object too. One-word titles are skipped: they match far too loosely.
function titleIsTheObject(text: string, trophyTitleName: string) {
  const title = normalizeTrophyText(trophyTitleName);
  if (title.split(" ").length < 2) return false;
  const norm = normalizeTrophyText(text);
  const m = new RegExp(String.raw`\b${VERB}\s+(?:the\s+)?`, "i").exec(norm);
  if (!m) return false;
  const after = norm.slice(m.index + m[0].length);
  // Either the trophy names the whole title, or the title is a longer
  // edition name ("The Stanley Parable: Ultra Deluxe") that starts with
  // exactly what the trophy said.
  const head = after.split(" ").slice(0, title.split(" ").length).join(" ");
  return after.startsWith(title) || (head.split(" ").length >= 2 && title.startsWith(head));
}

type Trophy = { trophyId: number; trophyName?: string; trophyDetail?: string; trophyType?: string };
type EarnedTrophy = { trophyId: number; earned?: boolean; earnedDateTime?: string };

function findCompletionTrophy(defs: Trophy[], earned: EarnedTrophy[], trophyTitleName: string) {
  const earnedById = new Map(earned.map((e) => [e.trophyId, e]));
  const hits = defs
    .map((d) => ({ def: d, got: earnedById.get(d.trophyId) }))
    .filter(({ def, got }) => {
      if (!got?.earned) return false;
      const text = `${def.trophyName ?? ""} ${def.trophyDetail ?? ""}`;
      const looksDone = COMPLETION.test(text) || FINAL_BEAT.test(text) || titleIsTheObject(text, trophyTitleName);
      return looksDone && !NOT_THE_WHOLE_GAME.some((re) => re.test(text));
    })
    .filter((h) => h.got?.earnedDateTime);
  if (!hits.length) return null;
  // Earliest wins: if they later finished it again on a harder
  // difficulty, the diary should date the FIRST time they finished it.
  hits.sort((a, b) => String(a.got!.earnedDateTime).localeCompare(String(b.got!.earnedDateTime)));
  return { at: hits[0].got!.earnedDateTime!, label: hits[0].def.trophyName ?? "" };
}

type TrophyTitle = {
  npCommunicationId: string; npServiceName: string; trophyTitleName: string;
  trophyTitlePlatform?: string; progress?: number;
  earnedTrophies?: { platinum?: number }; lastUpdatedDateTime?: string;
};

async function fetchCompletions(accountId: string) {
  const auth = await getAuth();

  const titles: TrophyTitle[] = [];
  let offset = 0;
  for (;;) {
    const res = await getUserTitles(auth, accountId, { limit: 100, offset });
    const page = (res as { trophyTitles?: TrophyTitle[] }).trophyTitles ?? [];
    titles.push(...page);
    offset += page.length;
    if (!page.length || offset >= ((res as { totalItemCount?: number }).totalItemCount ?? offset)) break;
  }

  const results: Record<string, unknown>[] = [];

  // A title with no trophies at all was never really played — skip it and
  // spend the requests on the rest.
  const queue = titles.filter((t) => (t.progress ?? 0) > 0);
  for (const t of titles) {
    if ((t.progress ?? 0) === 0) {
      results.push({ name: t.trophyTitleName, platform: t.trophyTitlePlatform, progress: t.progress, completed: false });
    }
  }

  // Every played title gets its trophy list pulled, even the platinumed
  // ones. The cheap shortcut — dating a platinum from the title's
  // lastUpdatedDateTime — is wrong whenever DLC trophies were earned
  // after the platinum: Ghost of Tsushima platinumed in June 2024 but
  // last updated in Feb 2025, and the diary would have been eight months
  // off. Trophy names live only in the definitions call and earned state
  // only in the other, so each title costs two requests; bounded
  // concurrency keeps a big library quick without hammering PSN through
  // the one shared service account.
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const base = { name: t.trophyTitleName, platform: t.trophyTitlePlatform, progress: t.progress };
      const opts = { npServiceName: t.npServiceName };
      try {
        const [defsRes, earnedRes] = await Promise.all([
          getTitleTrophies(auth, t.npCommunicationId, "all", opts),
          getUserTrophiesEarnedForTitle(auth, accountId, t.npCommunicationId, "all", opts),
        ]);
        const defs = (defsRes as { trophies?: Trophy[] }).trophies ?? [];
        const earned = (earnedRes as { trophies?: EarnedTrophy[] }).trophies ?? [];

        const platinumId = defs.find((d) => d.trophyType === "platinum")?.trophyId;
        const platinum = earned.find((e) => e.trophyId === platinumId && e.earned && e.earnedDateTime);
        if (platinum) {
          results.push({ ...base, completed: true, completedAt: platinum.earnedDateTime, reason: "platinum", label: null });
          continue;
        }
        if (t.progress === 100) {
          const last = earned.filter((e) => e.earned && e.earnedDateTime)
            .map((e) => e.earnedDateTime!).sort().pop();
          if (last) {
            results.push({ ...base, completed: true, completedAt: last, reason: "every trophy", label: null });
            continue;
          }
        }
        const hit = findCompletionTrophy(defs, earned, t.trophyTitleName);
        results.push({
          ...base, completed: !!hit, completedAt: hit?.at ?? null,
          reason: hit ? "story trophy" : null, label: hit?.label ?? null,
        });
      } catch {
        // One unreadable title (privacy, a delisted set) must not sink
        // the whole sync — report it as undetermined and move on.
        results.push({ ...base, completed: false });
      }
    }
  }));

  return { titles: results };
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
    if (action !== "resolve" && action !== "library" && action !== "completions") throw new Error("bad action");
  } catch {
    return json({ error: 'Body must be { action: "resolve", onlineId } or { action: "library" | "completions", accountId }' }, 400);
  }

  try {
    if (action === "resolve") {
      if (!onlineId) return json({ error: "onlineId is required" }, 400);
      return json(await resolveOnlineId(onlineId));
    }
    if (!accountId) return json({ error: "accountId is required" }, 400);
    if (action === "completions") return json(await fetchCompletions(accountId));
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
