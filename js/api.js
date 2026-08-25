import { supabase } from './supabase-client.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, RAWG_API_KEY, GIPHY_API_KEY } from './config.js';

// All IGDB traffic goes through a Supabase Edge Function (see
// supabase/functions/igdb-proxy) rather than straight to api.igdb.com —
// IGDB blocks direct browser requests and needs a Twitch Client Secret
// that can never live in client-side code like this file. The Edge
// Function holds that secret and proxies whatever query is sent here.
const IGDB_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/igdb-proxy`;

// Every outbound call in this file goes through here.
//
// Without a timeout, a source that is DOWN doesn't fail — it hangs. A
// hanging fetch never rejects, so any Promise.all/allSettled waiting on
// it waits forever, and anything awaiting it in sequence never continues.
// That is exactly what a RAWG outage did: search appeared to only find
// games already in the local catalogue (the combined search never
// resolved), and the cast tab always hit its "taking too long" cutoff
// (the RAWG call ran before Wikidata was ever asked). A dead source must
// fail fast so the sources that are alive can still answer.
const FETCH_TIMEOUT_MS = 3500;

async function fetchWithTimeout(url, options = {}, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function igdb(endpoint, query) {
  try {
    const res = await fetchWithTimeout(IGDB_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ endpoint, query }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------
// PROFILES
// ------------------------------------------------------------
export async function getProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

export async function getProfileByUsername(username) {
  const { data, error } = await supabase.from('profiles').select('*').eq('username', username).single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase.from('profiles').update(updates).eq('id', userId).select().single();
  if (error) throw error;
  return data;
}

export async function usernameAvailable(username) {
  const { data, error } = await supabase.from('profiles').select('id').eq('username', username).maybeSingle();
  if (error) throw error;
  return !data;
}

export async function searchUsers(query, limit = 15) {
  if (!query?.trim()) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
    .limit(limit);
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------
// GAMES (shared catalog)
// ------------------------------------------------------------
export async function searchGames(query, limit = 20) {
  if (!query?.trim()) return [];
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .ilike('title', `%${query}%`)
    .order('title')
    .limit(limit);
  if (error) throw error;
  // Catches editions that got saved to the database BEFORE this filter
  // existed — those rows are still sitting there, and until now nothing
  // ever stopped them from resurfacing every time someone searched,
  // even after the IGDB-side fetch itself got fixed.
  return filterOutEditions(data);
}

function igdbImageUrl(imageId, size = 'cover_big') {
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : null;
}

// Picks one random screenshot/artwork as the backdrop behind a game's
// title — mirroring how Letterboxd shows a still behind a film's
// poster. Random (not "always the first one") so the same game doesn't
// look identical on every visit.
function pickBackgroundUrl(g) {
  const pool = [...(g.artworks || []), ...(g.screenshots || [])];
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return igdbImageUrl(pick.image_id, '1080p');
}

// Escapes a free-typed string for safe use inside an Apicalypse
// `search "...";` clause — otherwise a stray quote in someone's search
// would break the query sent to IGDB.
function escapeApicalypse(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Single shared shape for any IGDB game object, whether it came from
// search, trending, or browse. igdb_id lets us re-fetch the full detail
// record later (description, studio credit) without re-searching.
// IGDB/RAWG give verbose official platform names (e.g. "PC (Microsoft
// Windows)") — this trims the well-known ones down to what people
// actually call them.
const PLATFORM_NAME_OVERRIDES = {
  'PC (Microsoft Windows)': 'PC',
  'Microsoft Windows': 'PC',
};
function simplifyPlatformName(name) {
  return PLATFORM_NAME_OVERRIDES[name] || name;
}

function mapIgdbGame(g) {
  const companies = g.involved_companies || [];
  const devs = companies.filter((c) => c.developer).map((c) => c.company?.name).filter(Boolean);
  const pubs = companies.filter((c) => c.publisher).map((c) => c.company?.name).filter(Boolean);
  return {
    igdb_id: g.id,
    title: g.name,
    cover_url: igdbImageUrl(g.cover?.image_id, 'cover_big'),
    background_url: pickBackgroundUrl(g),
    release_year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
    release_date: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
    platform: (g.platforms || []).slice(0, 3).map((p) => simplifyPlatformName(p.name)).join(', '),
    genre: (g.genres || []).slice(0, 2).map((gg) => gg.name).join(', '),
    developer: devs.slice(0, 2).join(', '),
    publisher: pubs.slice(0, 2).join(', '),
    igdb_rating: g.total_rating || null,
    igdb_added: g.total_rating_count || 0,
  };
}

const IGDB_LIST_FIELDS = 'name,category,cover.image_id,first_release_date,platforms.name,genres.name,'
  + 'involved_companies.company.name,involved_companies.developer,involved_companies.publisher,'
  + 'total_rating,total_rating_count,artworks.image_id,screenshots.image_id';

// Trimmed field set for the search box specifically. A search result row
// only ever shows a cover + one line of text — it never renders the
// backdrop art — so requesting artworks/screenshots on every single
// keystroke was extra payload nothing on screen used. The game's own
// page backfills background_url lazily via enrichGameDetails() the first
// time someone actually opens it, so dropping these here costs nothing
// and makes every search response smaller and faster.
const IGDB_SEARCH_FIELDS = 'name,category,cover.image_id,first_release_date,platforms.name,genres.name,'
  + 'involved_companies.company.name,involved_companies.developer,involved_companies.publisher,'
  + 'total_rating,total_rating_count';

// search finds games nobody in your app has added yet — this is what
// makes typing "Zelda" actually surface it, the way Letterboxd finds a
// film on first search. Fails silently (returns []) if the Edge
// Function/Twitch keys aren't set up yet, or the request fails for any
// reason — local search still works.
// Strips casing/punctuation/accents down to bare words for comparison
// purposes ONLY (never used for display) — turns "Alan Wake II:
// Remastered" and "alan wake 2 remastered" into a comparable shape
// without merging unrelated words together (punctuation becomes a
// space, not nothing, so "Wake:Remastered" doesn't collapse into
// "wakeremastered").
function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accent marks so "é" -> "e" (merged), not "e" + a stray space
    .replace(/[\u2019\u2018'`\u00b4]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Lowercases and strips punctuation but KEEPS accents, so "Désiré" and
// "Desire" stay distinguishable. normalizeTitle() deliberately folds
// accents away for fuzzy comparison, which is right for matching but
// wrong for picking a winner: it made an accented title score
// identically to its unaccented namesake, and the popularity
// tie-breaker then handed the top spot to whichever was better known.
// Typing the accented name exactly could therefore fail to surface it.
function looseTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’‘'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Lower tier = better match, and tier ALWAYS beats popularity, so an
// obscure exact match can't be pushed under a famous loose one.
//
// The word-boundary tiers (1 and 3) are what make a short query behave
// the way people expect: searching "don" should lead with titles whose
// first WORD is "don", not with every title that merely happens to begin
// with those three letters ("Don't ...", "Donkey ..."). Those still
// appear, just below the ones that actually match the word typed.
const MATCH_TIER_WORST = 7;

function titleMatchTier(query, title) {
  const qExact = looseTitle(query);
  const tExact = looseTitle(title);
  if (qExact && tExact === qExact) return 0; // exact, accents and all

  const q = normalizeTitle(query);
  const t = normalizeTitle(title);
  if (!q || !t) return MATCH_TIER_WORST;

  if (t === q) return 1;                                    // exact ignoring accents
  const tWords = t.split(' ');
  if (tWords[0] === q) return 2;                            // first word is the query
  if (t.startsWith(q + ' ')) return 3;                      // query is a whole leading phrase
  if (tWords.includes(q)) return 4;                         // query is a whole word somewhere
  if (t.startsWith(q)) return 5;                            // begins with the letters, mid-word
  if (t.includes(q)) return 6;                              // letters appear somewhere
  const qWords = q.split(' ');
  const tWordSet = new Set(tWords);
  if (qWords.every((w) => tWordSet.has(w))) return 6;
  return MATCH_TIER_WORST;
}

function rankSearchResults(query, results) {
  return [...results].sort((a, b) => {
    const tierDiff = titleMatchTier(query, a.title) - titleMatchTier(query, b.title);
    if (tierDiff !== 0) return tierDiff;
    return (b.igdb_added || 0) - (a.igdb_added || 0); // tie-breaker only, never overrides tier
  });
}

// Drops results that don't contain what was typed at all. IGDB's own
// search is fuzzy and happily returns loosely-associated titles, which
// is what made a search for one thing come back full of unrelated games.
function dropIrrelevant(query, results) {
  if (!normalizeTitle(query)) return results;
  return results.filter((g) => titleMatchTier(query, g.title) < MATCH_TIER_WORST);
}

// Edition/version titles IGDB's own version_parent field sometimes
// fails to tag correctly (real gap in their data, not something we can
// query around) — this is a narrow secondary safeguard, checked only
// as a last resort, and only matches a clear suffix at the END of a
// title, so it won't false-positive on a game that just happens to
// have one of these words somewhere in a legitimate name.
// Edition / upgrade / bundle phrasing that marks a store SKU rather than
// a distinct game. Matched ANYWHERE in the title now (not just as a
// suffix), because IGDB lists things like "Alan Wake II: Deluxe Upgrade"
// and "Alan Wake Origins Bundle" that clutter results with the same game
// under a store label.
const EDITION_PHRASES = [
  'deluxe edition', 'deluxe upgrade', 'digital deluxe', 'gold edition',
  'ultimate edition', 'complete edition', 'definitive edition',
  "collector's edition", 'collectors edition', 'goty edition',
  'game of the year edition', 'premium edition', 'standard edition',
  'anniversary edition', 'legendary edition', 'enhanced edition', 'season pass',
];
function looksLikeEditionTitle(title) {
  const t = normalizeTitle(title); // lowercased, punctuation -> spaces
  if (!t) return false;
  // Bundles and the HyperScan-style "... FX Mod: ..." mod entries.
  if (/\bbundle\b/.test(t)) return true;
  if (t.includes('fx mod')) return true;
  if (EDITION_PHRASES.some((p) => t.includes(normalizeTitle(p)))) return true;
  // A bare trailing "... Deluxe" or "... Upgrade" (no "edition" word).
  if (/\bdeluxe$/.test(t) || /\bupgrade$/.test(t)) return true;
  return false;
}
// Applied everywhere games get listed — search, trending, discover —
// not just the search box. Editions were only being filtered out of
// search results before, which is why "Lies of P: Complete Edition"
// could still show up in Trending Now.
function filterOutEditions(games) {
  return games.filter((g) => !looksLikeEditionTitle(g.title));
}

// There was a per-query in-memory cache here. It has been removed on
// purpose: search must reflect the catalogue as it is right now, so a
// repeated query re-runs rather than replaying an earlier result set.

export async function searchIgdb(query, limit = 12, page = 1) {
  if (!query?.trim()) return [];
  // Wider than what we show, since ranking happens client-side — but
  // not TOO wide, since a bigger request is a slower one.
  const fetchLimit = Math.max(limit * 3, 60);
  // Deliberately minimal WHERE clause — only version_parent, which
  // drops true editions (Deluxe/Gold/Collector's) per IGDB's own docs.
  // Two other filters used to live here and both silently ate results:
  //   - `category != 3 & category != 13` excluded every game whose
  //     category IGDB simply hasn't set, which is a lot of them.
  //   - `first_release_date <= now` hid unreleased games entirely, so
  //     announced-but-not-out titles could never be found at all.
  // Bundles/packs are now filtered in JS below (where an unset value is
  // treated as "keep"), and unreleased games are allowed to surface in
  // SEARCH — browse/trending still exclude them.
  const offset = (page - 1) * limit;
  const q = `search "${escapeApicalypse(query)}"; fields ${IGDB_SEARCH_FIELDS}; where version_parent = null; limit ${fetchLimit}; offset ${offset};`;
  const results = await igdb('games', q);
  // IGDB category: 3 = bundle, 13 = pack. Anything else — including an
  // absent category — is kept, so a missing field never costs a result.
  const noBundles = results.filter((g) => g.category !== 3 && g.category !== 13);
  const mapped = filterOutEditions(noBundles.map(mapIgdbGame));
  return rankSearchResults(query, mapped).slice(0, limit);
}

// Same shared shape as mapIgdbGame, but for a RAWG search result. RAWG
// calls straight to rawg.io (no proxy needed — unlike IGDB it allows
// direct browser requests), and it exists purely as a fallback: IGDB is
// the primary source everywhere, but has real gaps on smaller/indie
// titles that RAWG's larger catalog often still has.
function mapRawgGame(g) {
  const shot = (g.short_screenshots || []).find((s) => s.image && !s.image.includes('no_screenshot'));
  return {
    rawg_id: g.id,
    title: g.name,
    cover_url: g.background_image || null,
    background_url: shot ? shot.image : g.background_image || null,
    release_year: g.released ? new Date(g.released).getFullYear() : null,
    release_date: g.released || null,
    platform: (g.platforms || []).slice(0, 3).map((p) => simplifyPlatformName(p.platform?.name)).filter(Boolean).join(', '),
    genre: (g.genres || []).slice(0, 2).map((gg) => gg.name).join(', '),
    developer: null,
    publisher: null,
    igdb_rating: g.rating ? g.rating * 20 : null, // RAWG uses a 0-5 scale, normalized to match IGDB's 0-100
    igdb_added: g.added || 0,
  };
}

// Only called when IGDB's results are thin — RAWG is the fallback, not
// the primary source. Returns [] quietly on any failure (missing key,
// rate limit, network) so it never breaks a search, it just means the
// fallback didn't add anything this time.
async function searchRawg(query, limit = 10) {
  if (!query?.trim() || !RAWG_API_KEY) return [];
  try {
    // RAWG's back up as of 2026-08-18 (confirmed live: 9/9 test queries
    // succeeded, typical latency 0.7-1.2s, occasional cold start ~2.8s).
    // 900ms was deliberately tight while it was down/flaky for weeks —
    // that value would now clip perfectly healthy responses. 2.5s covers
    // its normal range with room to spare, while still failing fast (not
    // the old 3.5s default) if it ever goes down again.
    const url = `https://api.rawg.io/api/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(query)}&page_size=${limit}`;
    const res = await fetchWithTimeout(url, {}, 2500);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(mapRawgGame);
  } catch {
    return [];
  }
}

// The search everything actually uses: your own catalog (so ratings
// land on the same shared game everyone else is using), PLUS IGDB for
// anything not added yet, PLUS RAWG as a fallback when IGDB's results
// look thin — catches indie/smaller titles IGDB doesn't have. Both
// remote sources are de-duped against local AND against each other, so
// nothing shows up twice.
// Deliberately NOT cached. Search results are meant to be live: every
// keystroke re-runs the query against every source. Caching them meant a
// result set could be served from a previous run of the same query, so
// newly-added games didn't appear and a search that had been run before
// showed stale results instead of re-fetching.
export async function searchGamesEverywhere(query, limit = 20, page = 1) {
  // allSettled, NOT all. With Promise.all a single failing source
  // rejected the whole search — so one transient IGDB error wiped out
  // every remote result and left only the local catalog showing, which
  // looked exactly like "search only finds games people already logged".
  const settled = await Promise.allSettled([
    page === 1 ? searchGames(query, limit) : Promise.resolve([]),
    searchIgdb(query, limit, page),
    page === 1 ? searchRawg(query, limit) : Promise.resolve([]),
  ]);
  const [local, igdbRemote, rawgRemote] = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));

  const localTitles = new Set(local.map((g) => g.title.trim().toLowerCase()));
  let remote = igdbRemote.filter((g) => !localTitles.has(g.title.trim().toLowerCase()));

  const seenTitles = new Set([...localTitles, ...remote.map((g) => g.title.trim().toLowerCase())]);
  const rawgFiltered = rawgRemote
    .filter((g) => !seenTitles.has(g.title.trim().toLowerCase()))
    .filter((g) => isRelevantMatch(query, g.title));
  remote = [...remote, ...rawgFiltered];

  // Clean each source, tag it, then merge into ONE list ranked purely by
  // how well the title matches what was typed. Previously local and
  // remote came back as two separate blocks and the UI drew every local
  // (already-in-catalogue) game ABOVE every remote one — so a game you'd
  // already saved outranked a much closer match just because it existed,
  // which read as "search keeps showing old games instead of what I
  // typed". Now source only breaks a tie (a game already in the app is
  // preferred over re-adding an identical one); relevance decides order.
  const cleanLocal = dropIrrelevant(query, filterOutEditions(local)).map((g) => ({ ...g, _source: 'local' }));
  const cleanRemote = dropIrrelevant(query, filterOutEditions(remote)).map((g) => ({ ...g, _source: 'remote' }));
  const results = mergeDuplicateTitles(mergeRankSearch(query, [...cleanLocal, ...cleanRemote]));

  return {
    results,
    // A full page back means there's probably more behind it.
    hasMore: igdbRemote.length >= limit,
  };
}

// Ranks local + remote together: closest title match first (tier always
// wins), then local before remote on a tie, then popularity.
function mergeRankSearch(query, items) {
  return [...items].sort((a, b) => {
    const tierDiff = titleMatchTier(query, a.title) - titleMatchTier(query, b.title);
    if (tierDiff !== 0) return tierDiff;
    if (a._source !== b._source) return a._source === 'local' ? -1 : 1;
    return (b.igdb_added || 0) - (a.igdb_added || 0);
  });
}

// Collapses entries that are really the same game listed more than once
// (the same title across platforms, or re-released across eras) into a
// single row, so searching "Spider-Man" shows ONE Spider-Man carrying all
// its platforms instead of five near-identical rows. The kept row is the
// most useful of the group — a local (already-added) entry first, then
// whichever has cover art and the widest reach — and every duplicate's
// platforms are merged onto it. First-occurrence order is preserved, so
// the relevance ranking above still holds.
function mergeDuplicateTitles(games) {
  const groups = new Map();
  const order = [];
  games.forEach((g, i) => {
    const key = normalizeTitle(g.title) || `__${i}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(g);
  });
  return order.map((key) => {
    const group = groups.get(key);
    if (group.length === 1) return group[0];
    const rep = [...group].sort((a, b) => {
      if ((a._source === 'local') !== (b._source === 'local')) return a._source === 'local' ? -1 : 1;
      const cover = (b.cover_url ? 1 : 0) - (a.cover_url ? 1 : 0);
      if (cover !== 0) return cover;
      return (b.igdb_added || 0) - (a.igdb_added || 0);
    })[0];
    const platforms = [];
    const seen = new Set();
    for (const g of group) {
      for (const p of String(g.platform || '').split(',').map((s) => s.trim()).filter(Boolean)) {
        const lower = p.toLowerCase();
        if (!seen.has(lower)) { seen.add(lower); platforms.push(p); }
      }
    }
    return { ...rep, platform: platforms.slice(0, 6).join(', ') };
  });
}

// Local-catalog-only search, for painting something on screen the
// instant a key is pressed while the network calls are still in the
// air. Supabase is milliseconds away; IGDB/RAWG are not.
// Uncached for the same reason as searchGamesEverywhere above.
export async function searchLocalFast(query, limit = 20) {
  const local = await searchGames(query, limit);
  return rankSearchResults(query, dropIrrelevant(query, filterOutEditions(local)));
}

function isRelevantMatch(query, title) {
  const q = query.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  if (!q || !t) return false;
  if (t.includes(q) || q.includes(t)) return true;
  const qWords = q.split(/\s+/).filter((w) => w.length >= 3);
  const tWords = new Set(t.split(/\s+/).filter((w) => w.length >= 3));
  return qWords.some((w) => tWords.has(w));
}

// ------------------------------------------------------------
// LOGIN SCREEN BACKDROP
// ------------------------------------------------------------
// Local files, each one real official art from a specific game — every
// entry here needs a `title` so the screen can credit it and link back
// to that game's own page in-app (see openCreditedGame below). The
// files themselves live in images/backdrops/, named to match.
// `gameId` is baked in from a one-time run of seedLoginBackdropGames() —
// with it, opening a credit is a plain navigate(), no search step at
// tap time at all, same speed as a normal poster (see openCredit() in
// auth-view.js). Only entries missing a gameId fall back to the live
// search-and-add path in resolveCreditedGame below.
const LOGIN_BACKDROP_POOL = [
  { file: 'Alan Wake 2.jpg', title: 'Alan Wake 2', gameId: 'e1c25699-4eef-43be-b887-c26c1f57f960' },
  { file: "Assasin's Creed Black Flag resync.jpg", title: "Assassin's Creed IV: Black Flag", gameId: 'b2fca819-762b-4ead-94c1-4648744302e9' },
  { file: 'Claire Obscure Expedition 33.jpg', title: 'Clair Obscur: Expedition 33', gameId: '5f1b072c-1c60-4584-af46-3724d1669363' },
  { file: 'Cuphead.jpg', title: 'Cuphead', gameId: 'c5e3f147-c385-459d-a63b-d4acb4825cdb' },
  { file: 'Dark Souls 3.jpg', title: 'Dark Souls III', gameId: '38e86f19-a190-4aeb-88f2-90708707d614' },
  // Accented on purpose: "Désiré" (Sylvain Seccia, 2016) is a distinct
  // game from the unrelated 1997 title "Desire" — dropping the accent
  // collided the two, since IGDB's own title differs only by it.
  { file: 'Desire 2016.jpg', title: 'Désiré', year: 2016, gameId: '1ddfd033-24dd-4742-a428-c1d82f4016b4' },
  { file: 'Doki Doki Literature Club.jpg', title: 'Doki Doki Literature Club', gameId: 'db123dd8-cfda-46e0-b74b-ecb083294f7d' },
  { file: 'Elden Ring Shadow Of The Erdtree.jpg', title: 'Elden Ring: Shadow of the Erdtree', gameId: '409ac760-da1d-487c-8158-d2d270e20d16' },
  { file: 'Elden Ring.jpg', title: 'Elden Ring', gameId: 'fa6f2b07-f33a-44a1-a21f-72c51576a217' },
  { file: "Elder's scroll Skyrim 5.jpg", title: 'The Elder Scrolls V: Skyrim', gameId: 'b78ecb1e-68a2-4d20-bae9-27695dae07bb' },
  { file: 'Ghost of Yotei.jpg', title: 'Ghost of Yōtei', gameId: 'c12852be-b440-44d6-95c7-39baa606254f' },
  { file: 'God Of War 4.jpg', title: 'God of War', gameId: 'd1d00809-815a-412a-ba7c-5106783139ea' },
  { file: 'Grand Theft Auto VI.jpg', title: 'Grand Theft Auto VI', gameId: '5e55463d-fb98-4651-bb0b-c2ae531ef73d' },
  { file: 'Halo ps5.jpg', title: 'Halo: Campaign Evolved', gameId: '3e7a7a0f-edeb-464a-9d26-9b8ee266038d' },
  { file: 'Hollow Knight Silksong.jpg', title: 'Hollow Knight: Silksong', gameId: 'caf472e5-e738-42b2-bffd-e7af6f818179' },
  { file: 'Hollow Knight.jpg', title: 'Hollow Knight', gameId: '49001bc5-ac3c-49e2-84d2-6532a4fb04e3' },
  { file: 'Indika.jpg', title: 'Indika', gameId: '21adccfc-842c-4d70-981e-d35986290942' },
  { file: 'Life Is Strange 2.jpg', title: 'Life is Strange 2', gameId: '2afdf12f-1f7a-49dc-8b50-7f9b2effe8cb' },
  { file: 'Lost Record Bloom & Rage.jpg', title: 'Lost Records: Bloom & Rage', gameId: '02efcc7c-eb2b-4e8e-82a9-de87c5612a9d' },
  { file: 'Lost Records Bloom & Rage.jpg', title: 'Lost Records: Bloom & Rage', gameId: '02efcc7c-eb2b-4e8e-82a9-de87c5612a9d' },
  { file: 'Night In The Woods.jpg', title: 'Night in the Woods', gameId: '0e5f60d7-c62f-4b6a-805f-ed09a984053d' },
  { file: 'Persona 5 royal.jpg', title: 'Persona 5 Royal', gameId: 'bc926d9f-a2b9-4d4a-b03c-5d03ea58df75' },
  { file: 'Red Dead Redemption 2.jpg', title: 'Red Dead Redemption 2', gameId: '9e967756-38ad-4a34-8f9e-e1bc93725753' },
  // "Resident Evil 4" alone is ambiguous — the 2005 original and the 2023
  // remake share the exact same title on IGDB, and popularity (the usual
  // tiebreaker) favours the older one purely on rating-count seniority.
  // `year` disambiguates the fallback path if this ever needs re-resolving.
  { file: 'Resident Evil 4 Remake.jpg', title: 'Resident Evil 4', year: 2023, gameId: '1f4882c5-01cb-443f-b3d0-5c782da06163' },
  { file: 'Spider Man 2.jpg', title: "Marvel's Spider-Man 2", gameId: 'f6639449-193c-4a75-bda8-d10cce10cb98' },
  { file: 'Super Mario Bros.jpg', title: 'Super Mario Bros.', gameId: '165891ad-5c09-4437-a1df-a5e3c476fdd7' },
  { file: 'The last of us part 1 remake.jpg', title: 'The Last of Us Part I', gameId: '707dd72d-197c-451c-82a1-aef84acb7d31' },
  { file: 'The Last Of Us Part 2 Remastered.jpg', title: 'The Last of Us Part II Remastered', gameId: '2ff721f1-cfa7-420f-b15c-090822bac561' },
  { file: 'The Last Of Us Part 2.jpg', title: 'The Last of Us Part II', gameId: 'd1eb7395-8126-45fc-8b17-2ddf1792ccf4' },
  { file: 'Undertale.jpg', title: 'Undertale', gameId: '33473bad-ada7-42dd-86e9-4d228daaf56c' },
  { file: 'What Remain Of Edith Finch.jpg', title: 'What Remains of Edith Finch', gameId: 'd32f02f4-8a6f-48b9-b48f-bc66b544b009' },
];

// Plain Math.random() picks can repeat the same image several times in
// a short span, or bring it right back after a couple others — with 31
// images that's noticeable, not just bad luck. A shuffle-bag fixes it:
// shuffle the whole pool once, hand images out one at a time in that
// order (guaranteeing every image plays before any repeats), reshuffle
// only once the bag is empty — and even then, swap away from the image
// that just played if it would land first again, so there's no case
// where the same image can show twice back-to-back.
let backdropBag = [];
let lastBackdropFile = null;

function drawBackdrop() {
  if (backdropBag.length === 0) {
    const shuffled = [...LOGIN_BACKDROP_POOL];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.length > 1 && shuffled[0].file === lastBackdropFile) {
      [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    }
    backdropBag = shuffled;
  }
  const next = backdropBag.shift();
  lastBackdropFile = next.file;
  return next;
}

export async function getLoginBackground() {
  const entry = drawBackdrop();
  return { url: `images/backdrops/${encodeURIComponent(entry.file)}`, title: entry.title, gameId: entry.gameId || null };
}

// Title -> disambiguation year, for the rare credit whose title alone
// isn't unique on IGDB (see the `year` note on the pool entry above).
const LOGIN_BACKDROP_YEAR_HINT = new Map(
  LOGIN_BACKDROP_POOL.filter((e) => e.year).map((e) => [e.title, e.year])
);

// title -> in-flight/resolved Promise<gameId>, used only as a fallback
// for a credit that hasn't been through seedLoginBackdropGames() yet
// (see the `gameId` note on the pool above — openCreditedGame below
// returns that baked-in id straight away, no search, for every credit
// that already has one). auth-view.js still prefetches on display for
// whichever entries land here, so even an un-seeded tap usually lands
// on an already-resolved promise rather than a cold one.
const creditedGameCache = new Map();

export function openCreditedGame(title) {
  const seeded = LOGIN_BACKDROP_POOL.find((e) => e.title === title)?.gameId;
  if (seeded) return Promise.resolve(seeded);
  if (!creditedGameCache.has(title)) {
    const p = resolveCreditedGame(title).catch((err) => {
      creditedGameCache.delete(title);
      throw err;
    });
    creditedGameCache.set(title, p);
  }
  return creditedGameCache.get(title);
}

// Resolves a login-backdrop credit ("Art from X") to a real in-app game
// page — same lookup landing-view.js's poster wall uses when someone
// taps a cover: search the catalogue/IGDB for the title, ensure it's
// saved locally (addGame just returns the existing row for anything
// already in the catalogue, which every game credited here is), and
// hand back its local id for navigate(`/game/${id}`).
async function resolveCreditedGame(title) {
  const year = LOGIN_BACKDROP_YEAR_HINT.get(title);
  let candidates;
  if (year) {
    // searchGamesEverywhere's mergeDuplicateTitles collapses same-titled
    // games into one row (right for "same game, different platform" —
    // wrong here, since e.g. Resident Evil 4's 2005 original and 2023
    // remake are genuinely different igdb entries sharing one title, and
    // merging would silently keep whichever the general-purpose tiebreak
    // prefers, discarding the one this credit actually needs). Querying
    // local + IGDB directly, unmerged, keeps both candidates in play.
    const [local, remote] = await Promise.all([
      searchGames(title, 10).catch(() => []),
      searchIgdb(title, 10).catch(() => []),
    ]);
    candidates = rankSearchResults(title, [...local, ...remote]);
  } else {
    candidates = (await searchGamesEverywhere(title, 5)).results;
  }
  if (!candidates[0]) throw new Error(`No catalogue match for "${title}"`);
  // Only ever prefer a same-tier alternate — never let a weaker-matching
  // result outrank the actual best title match just for having the
  // "right" year.
  const topTier = titleMatchTier(title, candidates[0].title);
  const match = (year && candidates.find((g) => g.release_year === year && titleMatchTier(title, g.title) === topTier))
    || candidates[0];
  // added_by must be the caller's own id or the insert is rejected outright
  // (games_authenticated_insert requires added_by = auth.uid(), not just
  // "someone is logged in" — see migrations/2026-08-14_security_hardening.sql).
  // Every other addGame() call site already passes state.user.id for this
  // reason; null only works for rows that already exist (the pre-check
  // SELECT short-circuits before the insert), which is why 17 of these 31
  // "succeeded" earlier while every genuinely new one got a 403.
  const { data: { session } } = await supabase.auth.getSession();
  const saved = await addGame(match, session?.user?.id ?? null);
  return saved.id;
}

// One-time catalogue seeding: run this ONCE, signed in, to add every
// login-backdrop credit to the shared catalogue so the credit link
// works for everyone afterward — including signed-out visitors — since
// addGame's insert (the only step RLS actually blocks for anonymous
// users; reads are public) only ever needs to happen once per game.
// Call from the browser console: `import('./js/api.js').then(m => m.seedLoginBackdropGames())`
// — or just `await api.seedLoginBackdropGames()` wherever `api` is already
// in scope. Safe to re-run any time: existing rows are just looked up,
// not duplicated.
export async function seedLoginBackdropGames() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    console.log('[seedLoginBackdropGames] No active session — every insert will be rejected. Sign in on this tab first, then re-run this.');
  } else {
    console.log('[seedLoginBackdropGames] Signed in as', session.user.email || session.user.id, '— proceeding.');
  }
  const results = [];
  const ids = {};
  for (const { title } of LOGIN_BACKDROP_POOL) {
    try {
      const id = await resolveCreditedGame(title);
      creditedGameCache.delete(title); // don't leave a stale success cached from before seeding
      // Pays the one-time "full details" fetch (description, cast,
      // screenshots) here, up front, instead of leaving it for whoever
      // opens this game's page first — that's the 3-4s a freshly-added
      // row otherwise costs its first visitor (see enrichGameDetails).
      const row = await getGame(id);
      await enrichGameDetails(row).catch(() => {});
      results.push({ title, ok: true });
      ids[title] = id;
    } catch (err) {
      results.push({ title, ok: false, error: err.message });
    }
  }
  console.log('[seedLoginBackdropGames] resolved ids (send this back so it can be baked in — no search needed at tap time):');
  console.log(JSON.stringify(ids, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`[seedLoginBackdropGames] ${results.length - failed.length}/${results.length} added.`);
  failed.forEach((f) => console.log(`  ✗ ${f.title}: ${f.error}`));
  return results;
}

// Verified against IGDB's own genre/platform reference tables. IGDB has
// no "Action" genre (it's filed under themes instead), so that one chip
// filters on themes rather than genres — the "genre:"/"theme:" prefix
// tells browseGames() which field to filter on.
export const BROWSE_GENRES = [
  { label: 'Action', value: 'theme:1' }, { label: 'Adventure', value: 'genre:31' },
  { label: 'RPG', value: 'genre:12' }, { label: 'Strategy', value: 'genre:15' },
  { label: 'Shooter', value: 'genre:5' }, { label: 'Puzzle', value: 'genre:9' },
  { label: 'Platformer', value: 'genre:8' }, { label: 'Racing', value: 'genre:10' },
  { label: 'Sports', value: 'genre:14' }, { label: 'Simulation', value: 'genre:13' },
  { label: 'Indie', value: 'genre:32' }, { label: 'Fighting', value: 'genre:4' },
  { label: 'Real-Time Strategy', value: 'genre:11' }, { label: 'Turn-Based Strategy', value: 'genre:16' },
  { label: 'Tactical', value: 'genre:24' }, { label: 'Hack and Slash', value: 'genre:25' },
  { label: 'Arcade', value: 'genre:33' }, { label: 'Visual Novel', value: 'genre:34' },
  { label: 'Card & Board Game', value: 'genre:35' }, { label: 'MOBA', value: 'genre:36' },
  { label: 'Point-and-Click', value: 'genre:2' }, { label: 'Music', value: 'genre:7' },
  { label: 'Quiz/Trivia', value: 'genre:26' }, { label: 'Pinball', value: 'genre:30' },
];
export const BROWSE_PLATFORMS = [
  { label: 'PC', value: '6' }, { label: 'PlayStation 5', value: '167' },
  { label: 'PlayStation 4', value: '48' }, { label: 'Xbox Series X/S', value: '169' },
  { label: 'Xbox One', value: '49' }, { label: 'Switch', value: '130' },
  { label: 'iOS', value: '39' }, { label: 'Android', value: '34' },
];
// Curated "Bored? Try these" collections for the feed. Each one is
// just a preset bundle of browseGames() params, so this adds no new
// API surface — it's the Discover screen's own filtering, packaged as
// one-tap moods. All genre/theme ids are the verified ones above.
export const DISCOVERY_COLLECTIONS = [
  // Default: acclaimed single-player story games — the masterpiece,
  // "sit down and get lost in it" kind, filtered away from online titles.
  { id: 'masterpieces', label: 'Story masterpieces', params: { genre: 'genre:31', multiplayer: 'singleplayer', minRating: 80, sort: 'top_rated' } },
  { id: 'indie', label: 'Indie darlings', params: { genre: 'genre:32', multiplayer: 'singleplayer', sort: 'popular' } },
  { id: 'popular', label: 'Hot right now', params: { sort: 'popular' } },
  { id: 'all_time', label: 'All-time greats', params: { sort: 'all_time' } },
  { id: 'story', label: 'For the story', params: { genre: 'genre:31', sort: 'top_rated' } },
  { id: 'underrated', label: 'Hidden gems', params: { genre: 'genre:32', sort: 'top_rated' } },
  { id: 'rpg', label: 'Deep RPGs', params: { genre: 'genre:12', sort: 'top_rated' } },
  { id: 'short', label: 'Short & sweet', params: { genre: 'genre:9', sort: 'top_rated' } },
  { id: 'chaos', label: 'Pure chaos', params: { genre: 'genre:5', sort: 'popular' } },
  { id: 'couch', label: 'Grab a friend', params: { multiplayer: 'multiplayer', sort: 'popular' } },
  { id: 'online', label: 'Online multiplayer', params: { multiplayer: 'multiplayer', sort: 'all_time' } },
  { id: 'classics', label: 'Retro classics', params: { sort: 'all_time', dateTo: '2012-12-31' } },
  // No `params` — this one isn't a browseGames() filter at all, it's a
  // fixed curated list (see GOTY_WINNERS/resolveGotyWinners below).
  // feed-view.js's paintDiscovery special-cases id === 'goty' to use
  // that instead of calling browseGames.
  { id: 'goty', label: 'Game of the Year winners', params: null },
];
// Deliberately no "Coming soon" collection: browseGames() now excludes
// unreleased games app-wide (so people can't log games that aren't out
// yet), which directly contradicts the 'anticipated' sort's
// future-date requirement — that section could only ever render empty.

// Every Game of the Year winner, the actual award — real recognition,
// not an algorithmic "high rating" sort. Verified against Wikipedia's
// Spike Video Game Awards coverage and The Game Awards' own results
// (not pulled from memory) before writing this list; two names changed
// over the years but it's the same lineage — Spike's VGAs/VGX
// (2003–2013) is the direct predecessor The Game Awards (2014–) itself
// traces back to. Extend this each December once that year's winner is
// announced.
const GOTY_WINNERS = [
  { title: 'Madden NFL 2004', year: 2003 },
  { title: 'Grand Theft Auto: San Andreas', year: 2004 },
  { title: 'Resident Evil 4', year: 2005 },
  { title: 'The Elder Scrolls IV: Oblivion', year: 2006 },
  { title: 'BioShock', year: 2007 },
  { title: 'Grand Theft Auto IV', year: 2008 },
  { title: 'Uncharted 2: Among Thieves', year: 2009 },
  { title: 'Red Dead Redemption', year: 2010 },
  { title: 'The Elder Scrolls V: Skyrim', year: 2011 },
  { title: 'The Walking Dead', year: 2012 },
  { title: 'Grand Theft Auto V', year: 2013 },
  { title: 'Dragon Age: Inquisition', year: 2014 },
  { title: 'The Witcher 3: Wild Hunt', year: 2015 },
  { title: 'Overwatch', year: 2016 },
  { title: 'The Legend of Zelda: Breath of the Wild', year: 2017 },
  { title: 'God of War', year: 2018 },
  { title: 'Sekiro: Shadows Die Twice', year: 2019 },
  { title: 'The Last of Us Part II', year: 2020 },
  { title: 'It Takes Two', year: 2021 },
  { title: 'Elden Ring', year: 2022 },
  { title: "Baldur's Gate 3", year: 2023 },
  { title: 'Astro Bot', year: 2024 },
  { title: 'Clair Obscur: Expedition 33', year: 2025 },
];

let gotyCache = null;

// A handful of these titles are ambiguous on their own — "God of War"
// (2018) and "Resident Evil 4" (2005, the actual GOTY-winning original —
// not its own 2023 remake, credited separately on the login screen)
// both share their exact name with an unrelated release. Fetches a few
// candidates per title and prefers whichever matches the award's own
// year, same fix already used for Resident Evil 4's OTHER credit (see
// LOGIN_BACKDROP_POOL's `year` note above).
const GOTY_STORAGE_KEY = 'pt_goty_winners_v1';

export async function resolveGotyWinners() {
  if (gotyCache) return gotyCache;
  // 23 parallel IGDB searches — same rate-limit hazard as
  // resolvePinnedGames() in landing-view.js (that comment has the full
  // story). The winners list only changes once a year, so persist it
  // instead of re-resolving on every hard refresh.
  try {
    const stored = JSON.parse(localStorage.getItem(GOTY_STORAGE_KEY) || 'null');
    if (Array.isArray(stored) && stored.length) { gotyCache = stored; return gotyCache; }
  } catch { /* corrupt/unavailable storage — fall through and resolve live */ }
  const results = await Promise.all(
    GOTY_WINNERS.map(({ title, year }) => searchIgdb(title, 5).then((candidates) => {
      if (!candidates.length) return null;
      return candidates.find((g) => g.release_year === year) || candidates[0];
    }).catch(() => null))
  );
  const seen = new Set();
  gotyCache = results
    .map((g, i) => g ? { ...g, gotyYear: GOTY_WINNERS[i].year } : null)
    .filter((g) => g && g.cover_url && !seen.has(g.igdb_id) && seen.add(g.igdb_id));
  try { localStorage.setItem(GOTY_STORAGE_KEY, JSON.stringify(gotyCache)); } catch { /* storage full/unavailable, fine to skip persisting */ }
  return gotyCache;
}

export const BROWSE_SORTS = [
  { label: 'Most Popular', value: 'popular' }, { label: 'Highest Rated', value: 'top_rated' },
  { label: 'Most Anticipated', value: 'anticipated' }, { label: 'All-Time Top Rated', value: 'all_time' },
  { label: 'Newest Releases', value: 'newest' }, { label: 'A–Z', value: 'az' },
];

// "What's the World Playing" — roughly the 10 games with the most
// rating activity on IGDB over the last month. This is real-world
// popularity, not just this app's own (still-small) activity.
export async function getWorldTrending(limit = 10, days = 30) {
  // Match IGDB's own "Popular Right Now" (their PopScore) instead of raw
  // rating counts. The old query sorted recently-released games by
  // total_rating_count, which surfaced obscure just-out titles with a
  // handful of ratings — nothing like IGDB's actual popular list. The
  // popularity_primitives endpoint is the signal IGDB's site uses; type 1
  // is "IGDB Visits" (what people are looking at right now).
  try {
    const pop = await igdb('popularity_primitives',
      `fields game_id,value; where popularity_type = 1; sort value desc; limit ${limit * 3};`);
    const ids = [...new Set((pop || []).map((p) => p.game_id).filter(Boolean))];
    if (ids.length) {
      const games = await igdb('games',
        `fields ${IGDB_LIST_FIELDS}; where id = (${ids.join(',')}) & version_parent = null; limit ${ids.length};`);
      const order = new Map(ids.map((id, i) => [id, i]));
      const mapped = filterOutEditions(
        games.map(mapIgdbGame).sort((a, b) => (order.get(a.igdb_id) ?? 1e9) - (order.get(b.igdb_id) ?? 1e9)),
      );
      if (mapped.length) return mapped.slice(0, limit);
    }
  } catch { /* popularity endpoint unavailable — fall back below */ }

  // Fallback: recent, most-rated (the previous behaviour).
  const now = Math.floor(Date.now() / 1000);
  const start = now - days * 86400;
  const fetchLimit = Math.ceil(limit * 1.5) + 5;
  const q = `fields ${IGDB_LIST_FIELDS}; where first_release_date >= ${start} & first_release_date <= ${now} & total_rating_count > 0 & version_parent = null; sort total_rating_count desc; limit ${fetchLimit};`;
  const results = await igdb('games', q);
  return filterOutEditions(results.map(mapIgdbGame)).slice(0, limit);
}

// Home screen's "Friends Are Playing" strip — real data (not a mock):
// the most recent "playing" or "played" logs from people you follow,
// grouped by game so a game two friends are both on shows both avatars.
export async function getFriendsPlaying(userId, limit = 12) {
  const { data: followRows, error: fErr } = await supabase.from('follows').select('following_id').eq('follower_id', userId);
  if (fErr) throw fErr;
  const followingIds = (followRows || []).map((r) => r.following_id);
  if (!followingIds.length) return [];

  // One entry per completion (not grouped by game) so each card can show
  // WHO completed it, their rating, and whether they wrote a review —
  // that's the social hook the feed is built around.
  const { data, error } = await supabase
    .from('logs')
    .select('id, game_id, status, rating, review, contains_spoilers, created_at, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)')
    .in('user_id', followingIds)
    .eq('status', 'played') // NOT 'playing' too — that's what "Currently Playing" shows, kept separate on purpose
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data || []).map((row) => ({
    logId: row.id,
    game: row.games,
    friend: row.profiles,
    rating: row.rating,
    hasReview: !!row.review,
    containsSpoilers: row.contains_spoilers,
  }));
}

// A single log (review) by its id, with its game and author — backs the
// dedicated review page opened from the "friends completed" strip.
export async function getLogById(logId) {
  const { data, error } = await supabase
    .from('logs')
    .select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)')
    .eq('id', logId)
    .single();
  if (error) throw error;
  return data;
}

// Resolves a free-typed developer/publisher name to the IGDB company id
// its filter clause actually needs — the games endpoint won't accept
// plain text for this, only ids.
async function resolveIgdbCompanyId(name) {
  if (!name?.trim()) return null;
  try {
    const q = `search "${escapeApicalypse(name)}"; fields id; limit 1;`;
    const results = await igdb('companies', q);
    return results[0]?.id || null;
  } catch {
    return null;
  }
}

// Filterable/sortable browse, backing the Discover screen.
export async function browseGames({ genre, platform, dateFrom, dateTo, sort = 'popular', minRating, multiplayer, developer, publisher, page = 1 } = {}) {
  try {
    const limit = 20;
    const offset = (page - 1) * limit;
    const now = Math.floor(Date.now() / 1000);
    const clauses = ['version_parent = null', `(first_release_date <= ${now} | first_release_date = null)`];

    if (genre) {
      const [kind, id] = genre.split(':');
      clauses.push(kind === 'theme' ? `themes = (${id})` : `genres = (${id})`);
    }
    if (platform) clauses.push(`platforms = (${platform})`);
    // "newest" sort leads with games that often haven't accumulated
    // enough reviews for total_rating to exist yet — requiring a hard
    // minimum there excludes most brand-new releases outright, which
    // shrinks the pool to almost nothing a couple pages in. Every other
    // sort keeps the strict floor (a rated-but-mediocre game shouldn't
    // sneak into "top rated"), but newest also allows the not-yet-rated.
    if (minRating) clauses.push(sort === 'newest' ? `(total_rating >= ${Number(minRating)} | total_rating = null)` : `total_rating >= ${Number(minRating)}`);
    if (multiplayer === 'singleplayer') clauses.push('game_modes = (1)');
    if (multiplayer === 'multiplayer') clauses.push('game_modes = (2)');

    const [devId, pubId] = await Promise.all([resolveIgdbCompanyId(developer), resolveIgdbCompanyId(publisher)]);
    if (devId) clauses.push(`involved_companies.company = (${devId}) & involved_companies.developer = true`);
    if (pubId) clauses.push(`involved_companies.company = (${pubId}) & involved_companies.publisher = true`);

    const nowSec = Math.floor(Date.now() / 1000);
    if (sort === 'anticipated') {
      clauses.push(`first_release_date >= ${nowSec} & first_release_date <= ${nowSec + 9 * 30 * 86400}`);
    } else if (dateFrom || dateTo) {
      const fromSec = dateFrom ? Math.floor(new Date(dateFrom).getTime() / 1000) : 0;
      const toSec = dateTo ? Math.floor(new Date(dateTo).getTime() / 1000) : nowSec;
      clauses.push(`first_release_date >= ${fromSec} & first_release_date <= ${toSec}`);
    }

    let sortClause = 'total_rating_count desc';
    if (sort === 'top_rated') sortClause = 'total_rating desc';
    else if (sort === 'all_time') sortClause = 'aggregated_rating desc';
    else if (sort === 'anticipated') sortClause = 'hypes desc';
    else if (sort === 'newest') sortClause = 'first_release_date desc';
    else if (sort === 'az') sortClause = 'name asc';

    const where = clauses.length ? `where ${clauses.join(' & ')}; ` : '';
    const q = `fields ${IGDB_LIST_FIELDS}; ${where}sort ${sortClause}; limit ${limit}; offset ${offset};`;
    const results = await igdb('games', q);
    const games = filterOutEditions(results.map(mapIgdbGame));
    return { games, hasMore: results.length === limit };
  } catch {
    return { games: [], hasMore: false };
  }
}

export const BROWSE_RATINGS = [
  { label: 'Any rating', value: '' }, { label: '90+ (Universal acclaim)', value: '90' },
  { label: '75+ (Generally favorable)', value: '75' }, { label: '50+ (Mixed or better)', value: '50' },
];
export const BROWSE_PLAYER_MODES = [
  { label: 'Any', value: '' }, { label: 'Singleplayer', value: 'singleplayer' }, { label: 'Multiplayer', value: 'multiplayer' },
];

// Truncates IGDB's often-long, sometimes spoiler-heavy summary down to
// roughly its opening premise — IGDB doesn't provide a separate
// "spoiler-free blurb" field, so this is a best-effort approximation:
// most game summaries lead with setup before plot specifics.
function summarizeDescription(raw) {
  if (!raw) return null;
  const firstParagraph = raw.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  const sentences = firstParagraph.match(/[^.!?]+[.!?]+/g) || [firstParagraph];
  let summary = '';
  for (const s of sentences) {
    if ((summary + s).length > 320 && summary) break;
    summary += s;
    if (summary.length > 200) break;
  }
  return summary.trim() || firstParagraph.slice(0, 300);
}

const IGDB_DETAIL_FIELDS = 'name,summary,storyline,cover.image_id,artworks.image_id,screenshots.image_id,'
  + 'videos.video_id,total_rating,total_rating_count,involved_companies.company.id,'
  + 'involved_companies.company.name,involved_companies.company.logo.image_id,'
  + 'involved_companies.developer,involved_companies.publisher';

// Fetches (once) a game's full description, credited studio, trailer,
// and a real portrait cover from IGDB — caching the result on the local
// row so this only ever runs one time per game, not on every visit to
// its page. `igdb_enriched` is the flag that distinguishes "checked,
// found nothing" from "never checked".
// Free fallback for a description when IGDB has nothing for a game —
// no API key, no cost, just Wikipedia's public REST summary endpoint.
// Only ever reached when IGDB's own summary/storyline both came back
// empty (the obscure/very-new titles this whole feature is for), since
// IGDB's own copy is more game-specific when it exists.
async function getWikipediaSummary(title) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.type === 'disambiguation') return null; // no real content to show
    return data.extract ? summarizeDescription(data.extract) : null;
  } catch {
    return null;
  }
}

export async function enrichGameDetails(game) {
  if (!game.igdb_id || game.igdb_enriched) return game;
  const updates = { igdb_enriched: true };
  try {
    const q = `fields ${IGDB_DETAIL_FIELDS}; where id = ${game.igdb_id};`;
    const [detail] = await igdb('games', q);
    if (detail) {
      updates.description = summarizeDescription(detail.summary || detail.storyline);
      const companies = detail.involved_companies || [];
      const dev = companies.find((c) => c.developer);
      if (dev?.company) {
        updates.studio_id = dev.company.id;
        updates.studio_name = dev.company.name;
        updates.studio_logo_url = igdbImageUrl(dev.company.logo?.image_id, 'logo_med');
      }
      if (!game.publisher) {
        const pubs = companies.filter((c) => c.publisher).map((c) => c.company?.name).filter(Boolean);
        if (pubs.length) updates.publisher = pubs.slice(0, 2).join(', ');
      }
      const video = (detail.videos || [])[0];
      if (video?.video_id) updates.trailer_url = `https://www.youtube.com/embed/${video.video_id}`;
      if (!game.background_url) {
        const bg = pickBackgroundUrl(detail);
        if (bg) updates.background_url = bg;
      }
      if (!game.cover_url && detail.cover?.image_id) updates.cover_url = igdbImageUrl(detail.cover.image_id, 'cover_big');
    }
    if (!updates.description) {
      updates.description = await getWikipediaSummary(game.title);
    }
  } catch {
    // Leave whatever fields we didn't reach empty — igdb_enriched=true
    // still gets saved below so a flaky request doesn't retry forever.
  }
  try {
    const { data, error } = await supabase.from('games').update(updates).eq('id', game.id).select().single();
    if (!error) return data;
  } catch { /* fall through to returning the un-enriched game */ }
  return { ...game, ...updates };
}

// Full detail for a game that ISN'T in the local catalogue yet — one
// live IGDB query returning everything a game page needs to actually
// render (same shape mapIgdbGame produces, plus the extra description/
// trailer/studio fields enrichGameDetails normally adds), with `id: null`
// since there's no local row. This is what makes viewing genuinely free:
// the game page can render straight from this, with no write to our
// database at all — only actually logging/rating it needs an account,
// same as the rest of the app already works. See renderGameView's
// `igdbId` mode in game-view.js.
export async function getIgdbGameDetail(igdbId) {
  const q = `fields ${IGDB_LIST_FIELDS},summary,storyline,videos.video_id,involved_companies.company.id; where id = ${igdbId};`;
  const [g] = await igdb('games', q);
  if (!g) return null;
  const base = mapIgdbGame(g);
  const companies = g.involved_companies || [];
  const dev = companies.find((c) => c.developer);
  const video = (g.videos || [])[0];
  const description = summarizeDescription(g.summary || g.storyline) || await getWikipediaSummary(base.title);
  return {
    ...base,
    id: null,
    description,
    trailer_url: video?.video_id ? `https://www.youtube.com/embed/${video.video_id}` : null,
    studio_id: dev?.company?.id || null,
    studio_name: dev?.company?.name || null,
    igdb_enriched: true, // already has everything enrichGameDetails would have added — skip it
    credits_fetched: false,
  };
}

// A studio's mini profile page: logo, description, and their other
// developed games. Replaces the old per-person "Director" page — IGDB
// (unlike RAWG) doesn't expose individual crew credits, only which
// companies were involved and in what capacity, so the studio is the
// most specific credit IGDB can actually back up.
export async function getStudioProfile(companyId) {
  if (!companyId) return null;
  try {
    const companyQ = `fields name,description,logo.image_id,start_date; where id = ${companyId};`;
    // Was hardcapped at 30 — any studio with a bigger catalogue (Ubisoft,
    // EA, any long-running developer) silently lost everything past the
    // first 30 titles. 500 is IGDB's own documented ceiling per request,
    // so this now returns a studio's ENTIRE catalogue in the one call —
    // no realistic developer has more games than that to list.
    const gamesQ = `fields name,cover.image_id,first_release_date,total_rating; where involved_companies.company = ${companyId} & involved_companies.developer = true; sort total_rating_count desc; limit 500;`;
    const [companyResults, games] = await Promise.all([igdb('companies', companyQ), igdb('games', gamesQ)]);
    const company = companyResults[0];
    if (!company) return null;
    return {
      name: company.name,
      logo: igdbImageUrl(company.logo?.image_id, 'logo_med'),
      bio: company.description ? company.description.replace(/\s+/g, ' ').trim() : null,
      foundedYear: company.start_date ? new Date(company.start_date * 1000).getFullYear() : null,
      games: (games || []).map((g) => ({
        igdb_id: g.id, title: g.name, cover_url: igdbImageUrl(g.cover?.image_id, 'cover_big'),
        year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
        rating: g.total_rating || null,
      })),
    };
  } catch {
    return null;
  }
}

// Every company credited on a game's Studios tab — developer, publisher,
// porting, and support studios, each with their role(s). Not cached
// (fetched live when the tab is opened) since it's only needed if
// someone actually taps into Studios.
// ------------------------------------------------------------
// CAST / DIRECTOR — Wikidata
// ------------------------------------------------------------
// No API key needed anywhere in here — query.wikidata.org and
// www.wikidata.org's search API are both fully public, Wikimedia
// Foundation-run endpoints. Coverage is realistic, not guaranteed:
// this is community-maintained data like IGDB's own, so major/popular
// games are usually well covered, obscure ones may have nothing at
// all — that's not a bug, it's just what actually exists.
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

// Turns a Wikidata P18 value into a usable thumbnail URL.
//
// P18 comes back as a Commons Special:FilePath link, which resolves to
// the original upload — often a multi-megabyte portrait, far too heavy
// to drop into a list of cast members. Special:FilePath accepts a width
// parameter and serves a scaled copy instead. The value also arrives on
// plain http, which a page served over https will refuse to load, so
// the scheme is upgraded here rather than silently failing as a broken
// image.
function commonsThumb(url, width = 160) {
  if (!url) return null;
  const secure = url.replace(/^http:\/\//i, 'https://');
  return `${secure}${secure.includes('?') ? '&' : '?'}width=${width}`;
}

async function wikidataQuery(sparql) {
  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error('Wikidata query failed');
  return res.json();
}

// Finds the Wikidata item for a game.
//
// This previously ran a SPARQL query that joined every video game
// against every English label and then FILTERed on a lowercased string
// match. That's a well-known slow pattern — it asks the query service
// to scan the entire video-game graph, which routinely blows past
// WDQS's 60-second timeout and comes back empty. That, not missing
// data, is why cast/director appeared to "not work" at all.
//
// The search API below is indexed and answers in milliseconds. Note
// origin=* — the MediaWiki API requires it to send CORS headers for
// unauthenticated browser requests.
// Remasters/re-releases routinely get their OWN Wikidata item — so the
// lookup below "succeeds" — but it's often a bare stub with none of the
// P57/P725 credit statements filled in, while the original release's
// item has years of community-added credits. "The Last of Us Part II
// Remastered" is exactly this case: it has a real Wikidata item, just an
// empty one. Checking "was an item found" isn't enough to catch that —
// the retry (see fetchCastAndDirectorLive below) has to check "did that
// item actually have any credits", and only then fall back to the
// stripped, original-release title.
const EDITION_SUFFIX = /\s*[:\-–—]\s*(remastered|remake|definitive edition|game of the year edition|goty edition|enhanced edition|anniversary edition|complete edition|director'?s cut|complete collection|redux)$|\s+(remastered|remake|redux)$/i;

async function findWikidataGameIdOnce(title) {
  const searchUrl = `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(title)}&language=en&uselang=en&format=json&origin=*&type=item&limit=10`;
  const res = await fetchWithTimeout(searchUrl);
  if (!res.ok) return null;
  const data = await res.json();
  const candidates = (data.search || []).map((s) => s.id);
  if (!candidates.length) return null;

  // Narrow the candidates to the ones that are actually video games (so
  // a same-named film or book can't win), then pick the one the search
  // API itself ranked highest.
  //
  // This previously ended in `LIMIT 1` and returned whichever row the
  // query engine happened to emit first, which is NOT the most relevant
  // one — SPARQL results are unordered unless you order them. In
  // practice that meant a title routinely resolved to some peripheral
  // entity: "The Last of Us Part II" landed on its Digital Deluxe
  // Edition page and "Elden Ring" on an unrelated stub. Those pages
  // exist but carry no credits, so the cast tab correctly reported
  // "nothing found" for games that do in fact have full cast data.
  // Asking for every game match and re-selecting in the search API's
  // own relevance order fixes both the cast and the director.
  const valuesClause = candidates.map((id) => `wd:${id}`).join(' ');
  const check = await wikidataQuery(`
    SELECT ?item WHERE {
      VALUES ?item { ${valuesClause} }
      ?item wdt:P31/wdt:P279* wd:Q7889.
    }`);
  const gameQids = new Set(
    check.results.bindings.map((b) => b.item.value.split('/').pop())
  );
  return candidates.find((id) => gameQids.has(id)) || null;
}

// Same search-then-narrow pattern as findWikidataGameIdOnce above, but for
// a person by name instead of a game by title — narrows to actual
// humans (Q5) so a same-named company, character, or anything else
// can't win. RAWG's development-team credits (see getRawgDirector
// below) only ever give a name, no Wikidata id, which is exactly why
// a director sourced from RAWG couldn't open a person page before this
// existed — there was nothing to link to.
async function findWikidataPersonId(name) {
  const searchUrl = `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&format=json&origin=*&type=item&limit=10`;
  const res = await fetchWithTimeout(searchUrl);
  if (!res.ok) return null;
  const data = await res.json();
  const candidates = (data.search || []).map((s) => s.id);
  if (!candidates.length) return null;

  const valuesClause = candidates.map((id) => `wd:${id}`).join(' ');
  const check = await wikidataQuery(`
    SELECT ?item WHERE {
      VALUES ?item { ${valuesClause} }
      ?item wdt:P31 wd:Q5.
    }`);
  const personQids = new Set(
    check.results.bindings.map((b) => b.item.value.split('/').pop())
  );
  return candidates.find((id) => personQids.has(id)) || null;
}

// Director (P57) + voice cast (P725, with character role P453 as a
// qualifier) for a game, by title. Returns { director, cast } — cast
// is [{ qid, name, characters: [...] }], deduped per person even if
// they voiced multiple characters.
// RAWG's /games/{id}/development-team has real individual-person
// credits with actual job roles (writer, director, composer, artist,
// producer, designer, programmer — confirmed via their creator-roles
// list). No "voice actor" role exists there at all, so this is ONLY
// used for Director, never for cast.
async function getRawgDirector(title) {
  const found = await getRawgDirectorOnce(title);
  if (found) return found;
  const stripped = title.replace(EDITION_SUFFIX, '').trim();
  if (stripped && stripped.toLowerCase() !== title.toLowerCase()) {
    return getRawgDirectorOnce(stripped);
  }
  return null;
}

async function getRawgDirectorOnce(title) {
  if (!RAWG_API_KEY) return null;
  try {
    const searchUrl = `https://api.rawg.io/api/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(title)}&page_size=1`;
    const searchRes = await fetchWithTimeout(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const rawgId = searchData.results?.[0]?.id;
    if (!rawgId) return null;

    // Each crew member's entry embeds their own full games list, so this
    // response runs well over 100KB even for a single page of results —
    // the default 3.5s budget genuinely wasn't enough for it on a real
    // connection, silently dropping a correct RAWG director (who has an
    // explicit "director" job role) in favor of Wikidata's P57, which
    // has no equivalent way to tell a lead director from a co-director
    // when a game credits more than one.
    const teamUrl = `https://api.rawg.io/api/games/${rawgId}/development-team?key=${RAWG_API_KEY}`;
    const teamRes = await fetchWithTimeout(teamUrl, {}, 9000);
    if (!teamRes.ok) return null;
    const teamData = await teamRes.json();
    const directorEntry = (teamData.results || []).find((person) =>
      (person.positions || []).some((pos) => pos.slug === 'director')
    );
    return directorEntry ? { qid: null, name: directorEntry.name, rawgSlug: directorEntry.slug } : null;
  } catch {
    return null;
  }
}

// Cast/director for a game, cached on its row after the first real
// fetch (credits_fetched/credits_json — see migrations/2026-08-21_
// credits_cache.sql for the story: this chain is a genuinely slow,
// uncached external lookup, confirmed by direct measurement to take
// 2-3+ seconds on EVERY visit, including repeat visits to the same
// game, before this cache existed). Takes the game row itself (not just
// its title) so it can check/write that cache; falls back to the plain
// title-only fetch below if it's never been checked before.
//
// The write is best-effort exactly like enrichGameDetails: it only
// succeeds when signed in (RLS), so a signed-out visitor still gets a
// correct, fully-live answer this one time, it just doesn't persist it
// for the next person — same tradeoff already accepted for IGDB
// enrichment, not a new one.
export async function getGameCastAndDirector(game) {
  if (typeof game === 'string') game = { title: game }; // legacy call shape, no row to cache against
  if (game.credits_fetched) return game.credits_json || { director: null, cast: [] };
  const result = await fetchCastAndDirectorLive(game.title);
  // A totally empty result (no director, no cast) almost always means the
  // lookup missed rather than that the game genuinely has neither — RAWG
  // or Wikidata being briefly unreachable, a title not matching yet, etc.
  // Caching that as final locked it in as "no cast" forever, even after a
  // later fix would've found it, since nothing ever asked again. Only a
  // result with something in it is worth freezing.
  if (game.id && (result.director || result.cast.length)) {
    // Fire-and-forget: a failed save (signed out) just means no
    // persistence this time, same tradeoff already accepted for IGDB
    // enrichment — the live result above is still returned either way.
    supabase.from('games').update({ credits_json: result, credits_fetched: true }).eq('id', game.id)
      .then(() => {}, () => {});
  }
  return result;
}

async function fetchCastAndDirectorLive(title) {
  // RAWG only ever contributes the director; the whole cast comes from
  // Wikidata. Running RAWG first and awaiting it therefore meant that
  // when RAWG was unavailable, the cast — which never needed RAWG at
  // all — was never even requested before the caller's timeout fired.
  // They're independent lookups, so they run side by side and a failure
  // in one no longer costs the other.
  const [rawgSettled, qidSettled] = await Promise.allSettled([
    getRawgDirector(title),
    findWikidataGameIdOnce(title),
  ]);
  const rawgDirector = rawgSettled.status === 'fulfilled' ? rawgSettled.value : null;
  const qid = qidSettled.status === 'fulfilled' ? qidSettled.value : null;

  // RAWG gives a name only, no Wikidata id — without one, the director
  // chip renders with no href at all (see directorChipHtml/gd-director
  // in game-view.js), so it just sits there looking clickable but doing
  // nothing. One quick name lookup gets it a working /person/:qid link
  // like every Wikidata-sourced director already has.
  if (rawgDirector && !rawgDirector.qid) {
    rawgDirector.qid = await findWikidataPersonId(rawgDirector.name).catch(() => null);
  }

  let credits = qid ? await fetchWikidataCredits(qid).catch(() => null) : null;

  // The qid lookup can "succeed" on a remaster/remake's own bare stub
  // item (see EDITION_SUFFIX above) — that's not the same as it having
  // any actual credits. Only retry against the original release once we
  // know this specific item came back empty.
  if (!credits || (!credits.director && !credits.cast.length)) {
    const stripped = title.replace(EDITION_SUFFIX, '').trim();
    if (stripped && stripped.toLowerCase() !== title.toLowerCase()) {
      const originalQid = await findWikidataGameIdOnce(stripped).catch(() => null);
      if (originalQid && originalQid !== qid) {
        const retry = await fetchWikidataCredits(originalQid).catch(() => null);
        if (retry && (retry.director || retry.cast.length)) credits = retry;
      }
    }
  }

  if (!credits) return { director: rawgDirector, cast: [] };
  // RAWG's director wins when both have one — it comes from an
  // explicit "director" job role, more reliable than Wikidata's P57
  // which is sometimes populated from a film-style single "director"
  // field that doesn't always fit how games credit that role.
  return { director: rawgDirector || credits.director, cast: credits.cast };
}

// P18 is the item's image. Wikidata hands it back as a Commons
// Special:FilePath URL, which redirects to the real file — usable
// directly as an <img src>, and it accepts a width parameter so we pull
// a thumbnail rather than the full-size original (those are routinely
// several megabytes, which would be unusable in a list).
async function fetchWikidataCredits(qid) {
  const data = await wikidataQuery(`
    SELECT ?director ?directorLabel ?directorImage ?directorDesc
           ?person ?personLabel ?personImage ?characterLabel WHERE {
      OPTIONAL {
        wd:${qid} wdt:P57 ?director.
        OPTIONAL { ?director wdt:P18 ?directorImage. }
        OPTIONAL { ?director schema:description ?directorDesc. FILTER(LANG(?directorDesc) = "en") }
      }
      OPTIONAL {
        wd:${qid} p:P725 ?voiceStatement.
        ?voiceStatement ps:P725 ?person.
        OPTIONAL { ?person wdt:P18 ?personImage. }
        OPTIONAL { ?voiceStatement pq:P453 ?character. }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 120`);

  let director = null;
  const castMap = new Map();
  for (const row of data.results.bindings) {
    if (row.director && !director) {
      director = {
        qid: row.director.value.split('/').pop(),
        name: row.directorLabel?.value || 'Unknown',
        photo: commonsThumb(row.directorImage?.value),
        description: row.directorDesc?.value || null,
      };
    }
    if (row.person) {
      const personQid = row.person.value.split('/').pop();
      if (!castMap.has(personQid)) {
        castMap.set(personQid, {
          qid: personQid,
          name: row.personLabel?.value || 'Unknown',
          photo: commonsThumb(row.personImage?.value),
          characters: new Set(),
        });
      }
      // A person can appear across several rows (one per character); the
      // photo only comes back on some of them, so take the first
      // non-empty one rather than letting a later blank row clear it.
      const entry = castMap.get(personQid);
      if (!entry.photo) entry.photo = commonsThumb(row.personImage?.value);
      if (row.characterLabel) entry.characters.add(row.characterLabel.value);
    }
  }
  const cast = [...castMap.values()].map((c) => ({ ...c, characters: [...c.characters] }));
  return { director, cast };
}

// A cast member's own mini bio page: description + every other game
// they're credited as a voice actor on, via the same P725 property in
// reverse.
// Fetches BOTH voice-acting credits (P725) and directing credits (P57).
// This used to only ever query P725 — harmless for a cast member's own
// page, but it meant a DIRECTOR'S page always came back with zero
// credits, since a director has no voice-actor statements to find. The
// two are UNIONed inside one OPTIONAL so a person with neither still
// gets their bio back rather than the whole query coming up empty, and
// each row is tagged with which kind of credit it is so the caller can
// label "Directed" separately from a voice role instead of guessing.
export async function getWikidataPersonProfile(qid) {
  const data = await wikidataQuery(`
    SELECT ?personLabel ?descriptionText ?game ?gameLabel ?characterLabel ?role WHERE {
      OPTIONAL { wd:${qid} schema:description ?descriptionText. FILTER(LANG(?descriptionText) = "en") }
      OPTIONAL {
        {
          ?game p:P725 ?voiceStatement.
          ?voiceStatement ps:P725 wd:${qid}.
          OPTIONAL { ?voiceStatement pq:P453 ?character. }
          BIND("voice" AS ?role)
        } UNION {
          ?game wdt:P57 wd:${qid}.
          BIND("director" AS ?role)
        }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      BIND(wd:${qid} AS ?person)
    } LIMIT 120`);

  const rows = data.results.bindings;
  const name = rows[0]?.personLabel?.value || 'Unknown';
  const description = rows.find((r) => r.descriptionText)?.descriptionText.value || null;
  const gameMap = new Map();
  for (const row of rows) {
    if (!row.game) continue;
    const gameQid = row.game.value.split('/').pop();
    if (!gameMap.has(gameQid)) {
      gameMap.set(gameQid, { qid: gameQid, title: row.gameLabel?.value, characters: new Set(), roles: new Set() });
    }
    const entry = gameMap.get(gameQid);
    entry.roles.add(row.role?.value || 'voice');
    if (row.characterLabel) entry.characters.add(row.characterLabel.value);
  }
  // When an item has no label in any language, Wikidata's label service
  // falls back to handing back its bare QID (e.g. "Q27950674") as the
  // "label" instead of leaving it blank — that's not a real title, just
  // an artifact of missing data, so it's filtered out rather than shown.
  const games = [...gameMap.values()]
    .filter((g) => g.title && !/^Q\d+$/.test(g.title))
    .map((g) => ({ ...g, characters: [...g.characters], roles: [...g.roles] }));
  return { qid, name, description, games };
}

// Strips RAWG's bio HTML (real markup — <p>, <h3>, the occasional <br>,
// not just escaped text) down to plain paragraphs, since rendering it
// raw would mean either literal "<p>" text on screen (via esc()) or an
// XSS-shaped hole (via innerHTML on unsanitized third-party HTML).
// Heading/paragraph boundaries become paragraph breaks before every
// remaining tag is dropped, so a bio like Neil Druckmann's — an intro
// paragraph, then "Career", then "Style" — still reads as distinct
// paragraphs instead of one run-on block.
function stripRawgBio(html) {
  if (!html) return [];
  const text = html
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return text.split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// A director's full profile sourced from RAWG instead of Wikidata — a
// real photo, a real written bio, and their actual filmography with
// cover art, all things Wikidata routinely doesn't have (see the "Q"
// numbers and missing photo fixed earlier the same session). Only
// reachable for directors RAWG has a creators entry for; person-view.js
// (Wikidata-based) remains the fallback for everyone else.
export async function getRawgPersonProfile(slug) {
  if (!RAWG_API_KEY || !slug) return null;
  const [detailRes, gamesRes] = await Promise.all([
    fetchWithTimeout(`https://api.rawg.io/api/creators/${encodeURIComponent(slug)}?key=${RAWG_API_KEY}`, {}, 8000),
    fetchWithTimeout(`https://api.rawg.io/api/games?key=${RAWG_API_KEY}&creators=${encodeURIComponent(slug)}&page_size=20`, {}, 8000),
  ]);
  if (!detailRes.ok) return null;
  const detail = await detailRes.json();
  const gamesData = gamesRes.ok ? await gamesRes.json() : { results: [] };
  return {
    name: detail.name,
    photo: detail.image || null,
    bio: stripRawgBio(detail.description),
    positions: (detail.positions || []).map((p) => p.name),
    games: (gamesData.results || []).map((g) => ({
      slug: g.slug,
      title: g.name,
      cover_url: g.background_image || null,
      year: g.released ? new Date(g.released).getFullYear() : null,
      rating: g.rating ? Math.round(g.rating * 20) : null, // RAWG's 0-5 -> the app's 0-100 scale (see starRow callers, which divide by 20)
    })),
  };
}

export async function getGameStudios(igdbId) {
  if (!igdbId) return [];
  try {
    const q = `fields involved_companies.company.id,involved_companies.company.name,involved_companies.company.logo.image_id,involved_companies.developer,involved_companies.publisher,involved_companies.porting,involved_companies.supporting; where id = ${igdbId};`;
    const [detail] = await igdb('games', q);
    const companies = detail?.involved_companies || [];
    return companies.filter((c) => c.company).map((c) => ({
      igdb_id: c.company.id,
      name: c.company.name,
      logo: igdbImageUrl(c.company.logo?.image_id, 'logo_med'),
      roles: [
        c.developer && 'Developer', c.publisher && 'Publisher',
        c.porting && 'Porting', c.supporting && 'Support',
      ].filter(Boolean),
    }));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------
// FAVORITES (Top 5, shown on the profile)
// ------------------------------------------------------------
export async function getFavorites(userId) {
  const { data, error } = await supabase
    .from('favorite_games').select('*, games(*)').eq('user_id', userId).order('position');
  if (error) throw error;
  return data;
}

// Replaces the whole Top 5 in one call — simplest reliable way to persist
// a drag-reordered list without juggling partial inserts/deletes.
export async function setFavorites(userId, gameIdsInOrder) {
  const { error: delErr } = await supabase.from('favorite_games').delete().eq('user_id', userId);
  if (delErr) throw delErr;
  if (!gameIdsInOrder.length) return [];
  const rows = gameIdsInOrder.slice(0, 5).map((game_id, position) => ({ user_id: userId, game_id, position }));
  const { data, error } = await supabase.from('favorite_games').insert(rows).select('*, games(*)');
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------
// ACTIVITY (the "More activity" page)
// ------------------------------------------------------------
export async function getUserActivity(userId, limit = 40) {
  const { data, error } = await supabase
    .from('logs')
    .select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)')
    .eq('user_id', userId)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getLikesGiven(userId, limit = 20) {
  const { data, error } = await supabase
    .from('log_likes')
    .select('created_at, logs!inner(*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((r) => r.logs);
}

// ------------------------------------------------------------
// AVATAR UPLOAD (Supabase Storage — requires the storage migration
// block at the bottom of schema.sql to have been run once)
// ------------------------------------------------------------
export async function uploadAvatar(userId, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/avatar.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the new photo replaces the old one immediately instead
  // of showing a stale cached copy at the same URL.
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function getGame(gameId) {
  const { data, error } = await supabase.from('games').select('*').eq('id', gameId).single();
  if (error) throw error;
  return data;
}

export async function addGame({ title, cover_url, background_url, platform, release_year, release_date, genre, developer, publisher, igdb_id, rawg_id }, addedBy) {
  if (igdb_id) {
    const { data: existing, error: findErr } = await supabase.from('games').select('*').eq('igdb_id', igdb_id).maybeSingle();
    if (findErr) throw findErr;
    if (existing) return existing;
  } else if (rawg_id) {
    // Legacy path — a game added back when the app ran on RAWG.
    const { data: existing, error: findErr } = await supabase.from('games').select('*').eq('rawg_id', rawg_id).maybeSingle();
    if (findErr) throw findErr;
    if (existing) return existing;
  }
  const { data, error } = await supabase
    .from('games')
    .insert({
      title, cover_url: cover_url || null, background_url: background_url || null, platform: platform || null,
      release_year: release_year || null, release_date: release_date || null, genre: genre || null,
      developer: developer || null, publisher: publisher || null, igdb_id: igdb_id || null,
      rawg_id: rawg_id || null, added_by: addedBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function recentGames(limit = 20) {
  const { data, error } = await supabase.from('games').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------
// LOGS (diary entries / reviews)
// ------------------------------------------------------------
export async function createLog(log) {
  const { data, error } = await supabase.from('logs').insert(log).select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)').single();
  if (error) throw error;
  return data;
}

export async function updateLog(logId, updates) {
  const { data, error } = await supabase.from('logs').update(updates).eq('id', logId).select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)').single();
  if (error) throw error;
  return data;
}

export async function deleteLog(logId) {
  const { error } = await supabase.from('logs').delete().eq('id', logId);
  if (error) throw error;
}

export async function getLog(logId) {
  const { data, error } = await supabase.from('logs').select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)').eq('id', logId).single();
  if (error) throw error;
  return data;
}

export async function getLogsForUser(userId, { statuses, reviewsOnly = false, limit = 100 } = {}) {
  let q = supabase.from('logs').select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)').eq('user_id', userId);
  if (statuses?.length) q = q.in('status', statuses);
  if (reviewsOnly) q = q.not('review', 'is', null);
  q = q.order('played_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function getLogsForGame(gameId, limit = 50) {
  const { data, error } = await supabase
    .from('logs')
    .select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)')
    .eq('game_id', gameId)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Reviews by blocked users are dropped here too — blocking someone
  // has to work everywhere their writing appears, not just in the feed.
  return filterBlocked(data || []);
}

// How many public lists this game appears on — feeds the "Lists" stat
// card on the game detail page.
export async function getListsCountForGame(gameId) {
  const { count, error } = await supabase
    .from('list_items')
    .select('list_id, lists!inner(is_public)', { count: 'exact', head: true })
    .eq('game_id', gameId)
    .eq('lists.is_public', true);
  if (error) throw error;
  return count || 0;
}

// Activity feed: recent public logs from people you follow.
// Falls back to global recent public activity if you don't follow anyone yet.
export async function getFeed(userId, limit = 30, statusFilter = null) {
  const { data: followRows, error: fErr } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId);
  if (fErr) throw fErr;
  const followingIds = (followRows || []).map(r => r.following_id);

  if (followingIds.length === 0) {
    let q = supabase
      .from('logs')
      .select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)')
      .eq('is_public', true);
    if (statusFilter) q = q.eq('status', statusFilter);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    // The blocklist is per-viewer, so it can't be a SQL filter — the same
    // row stays visible to everyone else. This matters most on the
    // fallback feed, which shows the whole app rather than just people
    // you follow.
    return { logs: await filterBlocked(data || []), isFallback: true };
  }

  let q = supabase
    .from('logs')
    .select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)')
    .in('user_id', followingIds)
    .eq('is_public', true);
  if (statusFilter) q = q.eq('status', statusFilter);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return { logs: await filterBlocked(data || []), isFallback: false };
}

// Real, live reviews for the logged-out landing page — recent public
// entries that actually have a rating or a written review, so a new
// visitor sees the real community instead of a mockup. No userId is
// needed: public logs (is_public = true) are readable by the anon key
// with no session at all, same as everywhere else in the app.
export async function getPublicShowcase(limit = 8) {
  const { data, error } = await supabase
    .from('logs')
    .select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)')
    .eq('is_public', true)
    .or('rating.not.is.null,review.not.is.null')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return filterBlocked(data || []);
}

export async function getUserStats(userId) {
  // `review` was missing from this select entirely — the Reviews count
  // below has been silently showing 0 on every profile regardless of how
  // many reviews someone actually wrote, since `r.review` was always
  // undefined. Found while adding the streak/hours stats; fixed here too.
  const { data, error } = await supabase
    .from('logs')
    .select('rating, status, played_date, hours_played, review, created_at')
    .eq('user_id', userId);
  if (error) throw error;
  const rows = data || [];
  const played = rows.filter(r => r.status === 'played' || r.status === 'dropped');
  const thisYear = played.filter(r => r.played_date && new Date(r.played_date).getFullYear() === new Date().getFullYear());
  const rated = rows.filter(r => r.rating !== null);
  const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : null;
  const totalHours = rows.reduce((s, r) => s + (Number(r.hours_played) || 0), 0);
  return {
    totalPlayed: played.length,
    thisYear: thisYear.length,
    backlog: rows.filter(r => r.status === 'backlog').length,
    logged: rows.length,
    reviews: rows.filter(r => r.review).length,
    avgRating: avg,
    totalHours: Math.round(totalHours),
    streak: computeLogStreak(rows),
  };
}

// Current consecutive-day logging streak, counting back from today (with
// a one-day grace period — hasn't logged YET today still counts if
// yesterday's unbroken). Uses played_date when it's set, falling back to
// created_at for backlog/wishlist entries which have no played_date at
// all — the point is "days you touched your log," not just "days you
// finished something."
function computeLogStreak(rows) {
  const days = new Set(rows.map((r) => (r.played_date || r.created_at || '').slice(0, 10)).filter(Boolean));
  if (!days.size) return 0;
  const iso = (d) => d.toISOString().slice(0, 10);
  const oneDay = 86400000;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(iso(cursor))) cursor = new Date(cursor.getTime() - oneDay);
  let streak = 0;
  while (days.has(iso(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - oneDay);
  }
  return streak;
}

// Count of logs at each half-star value, 0.5..5.0 — feeds the vertical
// bar-per-score breakdown on the profile page.
export async function getRatingBreakdown(userId) {
  const { data, error } = await supabase.from('logs').select('rating').eq('user_id', userId).not('rating', 'is', null);
  if (error) throw error;
  const counts = {};
  for (let v = 0.5; v <= 5; v += 0.5) counts[v.toFixed(1)] = 0;
  for (const row of data || []) {
    const key = Number(row.rating).toFixed(1);
    if (key in counts) counts[key] += 1;
  }
  return counts;
}

// Same shape as getRatingBreakdown, but for "everyone's ratings of this
// one game" instead of "one user's ratings of everything" — feeds the
// chart on the game detail page.
export async function getGameRatingBreakdown(gameId) {
  const { data, error } = await supabase.from('logs').select('rating').eq('game_id', gameId).eq('is_public', true).not('rating', 'is', null);
  if (error) throw error;
  const counts = {};
  for (let v = 0.5; v <= 5; v += 0.5) counts[v.toFixed(1)] = 0;
  for (const row of data || []) {
    const key = Number(row.rating).toFixed(1);
    if (key in counts) counts[key] += 1;
  }
  return counts;
}

// ------------------------------------------------------------
// FOLLOWS
// ------------------------------------------------------------
export async function follow(followerId, followingId) {
  const { error } = await supabase.from('follows').insert({ follower_id: followerId, following_id: followingId });
  if (error) throw error;
}

export async function unfollow(followerId, followingId) {
  const { error } = await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId);
  if (error) throw error;
}

export async function isFollowing(followerId, followingId) {
  const { data, error } = await supabase
    .from('follows').select('follower_id')
    .eq('follower_id', followerId).eq('following_id', followingId).maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function getFollowingIdSet(userId) {
  if (!userId) return new Set();
  const { data, error } = await supabase.from('follows').select('following_id').eq('follower_id', userId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.following_id));
}

export async function getFollowCounts(userId) {
  const [{ count: followers }, { count: following }] = await Promise.all([
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', userId),
    supabase.from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  return { followers: followers || 0, following: following || 0 };
}

export async function getFollowers(userId) {
  const { data, error } = await supabase.from('follows').select('follower_id').eq('following_id', userId);
  if (error) throw error;
  const ids = data.map(r => r.follower_id);
  if (!ids.length) return [];
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('*').in('id', ids);
  if (pErr) throw pErr;
  return profiles;
}

export async function getFollowing(userId) {
  const { data, error } = await supabase.from('follows').select('following_id').eq('follower_id', userId);
  if (error) throw error;
  const ids = data.map(r => r.following_id);
  if (!ids.length) return [];
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('*').in('id', ids);
  if (pErr) throw pErr;
  return profiles;
}

// ------------------------------------------------------------
// LISTS
// ------------------------------------------------------------
export async function createList(userId, { name, description, is_public = true }) {
  const { data, error } = await supabase.from('lists').insert({ user_id: userId, name, description, is_public }).select().single();
  if (error) throw error;
  return data;
}

export async function getListsForUser(userId) {
  // Pulls each list's items with just their cover art + position, so the
  // list cards can show a poster collage and a real count (derived from
  // the array length) without a second round of queries.
  const { data, error } = await supabase
    .from('lists')
    .select('*, list_items(position, games!list_items_game_id_fkey(cover_url, title))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getList(listId) {
  const { data, error } = await supabase.from('lists').select('*, profiles!lists_user_id_fkey(*)').eq('id', listId).single();
  if (error) throw error;
  return data;
}

export async function getListItems(listId) {
  const { data, error } = await supabase
    .from('list_items')
    .select('*, games!list_items_game_id_fkey(*)')
    .eq('list_id', listId)
    .order('position');
  if (error) throw error;
  return data;
}

// `position` used to silently default to 0 for every item added — since
// nothing ever set it, every item in every list has technically been
// tied for first place, and .order('position') was really just
// returning whatever order Postgres felt like. Now takes the intended
// position explicitly (caller passes the list's current length so new
// items land at the end).
export async function addGameToList(listId, gameId, position = 0, note = '') {
  const { error } = await supabase.from('list_items').insert({ list_id: listId, game_id: gameId, position, note });
  if (error) throw error;
}

// Persists a full reorder: pass the game ids in the exact order they
// should now appear in. Updates every row's position to match its new
// index — list_items has no separate id column (list_id+game_id is the
// primary key), so each update is addressed by that pair.
export async function reorderListItems(listId, orderedGameIds) {
  await Promise.all(orderedGameIds.map((gameId, i) =>
    supabase.from('list_items').update({ position: i }).eq('list_id', listId).eq('game_id', gameId)
  ));
}

export async function removeGameFromList(listId, gameId) {
  const { error } = await supabase.from('list_items').delete().eq('list_id', listId).eq('game_id', gameId);
  if (error) throw error;
}

export async function deleteList(listId) {
  const { error } = await supabase.from('lists').delete().eq('id', listId);
  if (error) throw error;
}

// ------------------------------------------------------------
// LIKES
// ------------------------------------------------------------
export async function toggleLike(userId, logId, currentlyLiked) {
  if (currentlyLiked) {
    const { error } = await supabase.from('log_likes').delete().eq('user_id', userId).eq('log_id', logId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('log_likes').insert({ user_id: userId, log_id: logId });
    if (error) throw error;
  }
}

// Batch version — one query for a whole page of logs instead of N queries.
export async function getLikesForLogs(logIds, userId) {
  const map = {};
  logIds.forEach(id => (map[id] = { count: 0, liked: false }));
  if (!logIds.length) return map;
  const { data, error } = await supabase.from('log_likes').select('log_id, user_id').in('log_id', logIds);
  if (error) throw error;
  for (const row of data) {
    map[row.log_id].count += 1;
    if (userId && row.user_id === userId) map[row.log_id].liked = true;
  }
  return map;
}

export async function getLikeInfo(logId, userId) {
  const { count } = await supabase.from('log_likes').select('*', { count: 'exact', head: true }).eq('log_id', logId);
  let liked = false;
  if (userId) {
    const { data } = await supabase.from('log_likes').select('user_id').eq('log_id', logId).eq('user_id', userId).maybeSingle();
    liked = !!data;
  }
  return { count: count || 0, liked };
}

// ---- comments on a review (a log) --------------------------
// Backed by the `comments` table (migrations/2026-08-17_comments.sql).
export async function getComments(logId) {
  const { data, error } = await supabase
    .from('comments')
    .select('*, profiles!comments_user_id_fkey(*)')
    .eq('log_id', logId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return filterBlocked(data || []); // hide comments from people you've blocked
}

export async function addComment(logId, userId, body) {
  const { data, error } = await supabase
    .from('comments')
    .insert({ log_id: logId, user_id: userId, body })
    .select('*, profiles!comments_user_id_fkey(*)')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteComment(id) {
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) throw error;
}

// ------------------------------------------------------------
// MODERATION — reports, blocks, account deletion
// ------------------------------------------------------------
// Backed by the `reports` and `blocks` tables and the account-deletion
// Edge Function (see migrations/2026-08-14_security_hardening.sql).

// A report is write-only from the app's point of view: RLS lets the
// reporter insert one and read their own back, but nobody can browse
// other people's reports, so a harasser can't see who reported them.
export async function reportContent({ targetType, targetId, reason }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to report content.');
  const { error } = await supabase.from('reports').insert({
    reporter_id: user.id,
    target_type: targetType,
    target_id: targetId,
    reason: (reason || '').trim().slice(0, 500),
  });
  if (error) throw error;
}

export async function blockUser(blockedId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to block someone.');
  if (user.id === blockedId) throw new Error("You can't block yourself.");
  const { error } = await supabase.from('blocks').insert({ blocker_id: user.id, blocked_id: blockedId });
  if (error && error.code !== '23505') throw error; // 23505 = already blocked, which is fine
}

export async function unblockUser(blockedId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('blocks').delete()
    .eq('blocker_id', user.id).eq('blocked_id', blockedId);
  if (error) throw error;
}

// Cached for the lifetime of the page: this is consulted every time a
// list of other people's content is rendered, and it changes only when
// the user themselves blocks or unblocks someone.
let blockedIdCache = null;
export function invalidateBlockedCache() { blockedIdCache = null; }

export async function getBlockedIds() {
  if (blockedIdCache) return blockedIdCache;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data, error } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', user.id);
  if (error) return new Set(); // never let a blocklist failure blank the feed
  blockedIdCache = new Set((data || []).map((r) => r.blocked_id));
  return blockedIdCache;
}

export async function isBlocked(userId) {
  return (await getBlockedIds()).has(userId);
}

// Removes rows authored by anyone the signed-in user has blocked.
// Applied at render time rather than in SQL because the blocklist is
// per-viewer — the same row is visible to everyone else.
export async function filterBlocked(rows, getUserId = (r) => r.user_id) {
  const blocked = await getBlockedIds();
  if (!blocked.size) return rows;
  return rows.filter((r) => !blocked.has(getUserId(r)));
}

// Deleting the profile row cascades to logs, lists, follows and likes,
// but the auth.users record can only be removed with the service-role
// key — which is why this goes through an Edge Function instead of
// being done straight from the client. Leaving the auth record behind
// would strand the address: signing up with it again would collide
// with a user that has no profile.
export async function deleteAccount() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You are not signed in.');
  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: { confirm: true },
  });
  if (error || data?.error) throw new Error(data?.error || 'Could not delete your account.');
  await supabase.auth.signOut();
}

// ------------------------------------------------------------
// MESSAGING — see migrations/2026-08-19_messaging.sql. A conversation
// is 'accepted' when the pair mutually follow each other, 'pending' (a
// request) otherwise — decided server-side by a trigger, not here, so
// this file never has to compute or trust that itself.
// ------------------------------------------------------------

const CONVO_SELECT = `
  id, user_one_id, user_two_id, status, requested_by,
  last_message_at, last_message_body, last_message_kind, last_message_sender_id,
  user_one_last_read_at, user_two_last_read_at, created_at,
  user_one:profiles!conversations_user_one_id_fkey(id, username, display_name, avatar_url),
  user_two:profiles!conversations_user_two_id_fkey(id, username, display_name, avatar_url)
`;

// Shapes a raw conversation row (which has both participants) into one
// with `.other` (whichever of the two isn't me) and `.unread` already
// worked out, so every view that lists conversations does this exactly
// the same way instead of repeating the same three-way ternary each time.
function shapeConversation(row, userId) {
  const iAmOne = row.user_one_id === userId;
  const myLastRead = iAmOne ? row.user_one_last_read_at : row.user_two_last_read_at;
  const unread = !!row.last_message_sender_id
    && row.last_message_sender_id !== userId
    && (!myLastRead || new Date(row.last_message_at) > new Date(myLastRead));
  return { ...row, other: iAmOne ? row.user_two : row.user_one, unread };
}

// Every conversation the signed-in user is part of, newest activity
// first. One query powers both the inbox and the Requests tab — the
// caller splits on `.status`/`.requested_by`, since a conversation with
// no messages yet (last_message_at is null) still needs to sort
// somewhere and "newest first, nulls last" is what nullsFirst:false does.
export async function getConversations(userId) {
  const { data, error } = await supabase
    .from('conversations')
    .select(CONVO_SELECT)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data.map((row) => shapeConversation(row, userId));
}

// Looks for an existing thread with this person WITHOUT creating one —
// used when someone taps "Message" on a profile, so that just opening
// the composer and backing out doesn't leave a conversation row (and,
// worse, a "request" in the other person's inbox) behind for a chat
// that never actually happened. See getOrCreateConversation below,
// which is the version that's allowed to create one, called only once
// there's a real first message to send.
export async function getConversationBetween(myId, otherId) {
  const [user_one_id, user_two_id] = myId < otherId ? [myId, otherId] : [otherId, myId];
  const { data, error } = await supabase
    .from('conversations')
    .select(CONVO_SELECT)
    .eq('user_one_id', user_one_id).eq('user_two_id', user_two_id)
    .maybeSingle();
  if (error) throw error;
  return data ? shapeConversation(data, myId) : null;
}

// Finds the existing thread with this person, or starts one. Canonical
// ordering (smaller id first) is enforced here AND by a check constraint
// on the table — this is what makes messaging someone who already
// messaged you land in the SAME thread rather than a second one.
export async function getOrCreateConversation(myId, otherId) {
  const existing = await getConversationBetween(myId, otherId);
  if (existing) return existing;
  const [user_one_id, user_two_id] = myId < otherId ? [myId, otherId] : [otherId, myId];
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_one_id, user_two_id, requested_by: myId })
    .select(CONVO_SELECT)
    .single();
  if (error) throw error;
  return shapeConversation(data, myId);
}

export async function getConversation(conversationId, userId) {
  const { data, error } = await supabase
    .from('conversations')
    .select(CONVO_SELECT)
    .eq('id', conversationId)
    .single();
  if (error) throw error;
  return shapeConversation(data, userId);
}

export async function getMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

// `kind`: 'text' (default) | 'gif' | 'sticker'. For a gif, `body` is the
// image URL; for a sticker, `body` is the single emoji character — one
// column carries all three so the schema doesn't need a separate
// nullable url column that's only ever set for two of the three kinds.
export async function sendMessage(conversationId, senderId, body, { kind = 'text', replyToId = null } = {}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, body, kind, reply_to_id: replyToId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Your own message only (see messages_owner_delete in
// migrations/2026-08-19_message-reactions-replies.sql) — a reply
// pointing at it just loses its quote (reply_to_id references it
// ON DELETE SET NULL), it isn't deleted along with it.
export async function deleteMessage(messageId) {
  const { error } = await supabase.from('messages').delete().eq('id', messageId);
  if (error) throw error;
}

export async function markConversationRead(conversationId) {
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
  if (error) throw error;
}

// Either side leaving a thread, or declining a request without opening
// it — same action either way, the row is just gone for both of them.
export async function deleteConversation(conversationId) {
  const { error } = await supabase.from('conversations').delete().eq('id', conversationId);
  if (error) throw error;
}

// ---- reactions ----------------------------------------------------
// One reaction per person per message (the table's primary key IS this
// rule — see the migration). Tapping the same emoji you already used
// removes it; tapping a different one replaces it; this function
// figures out which of insert/update/delete that is rather than making
// every caller work it out themselves.
export async function toggleReaction(messageId, userId, emoji) {
  const { data: existing, error: findErr } = await supabase
    .from('message_reactions').select('emoji')
    .eq('message_id', messageId).eq('user_id', userId).maybeSingle();
  if (findErr) throw findErr;
  if (existing?.emoji === emoji) {
    const { error } = await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', userId);
    if (error) throw error;
    return null;
  }
  const { error } = await supabase.from('message_reactions').upsert({ message_id: messageId, user_id: userId, emoji });
  if (error) throw error;
  return emoji;
}

// Batched — one query for a whole thread's worth of reactions rather
// than one per message, same reasoning as getLikesForLogs.
export async function getReactionsForMessages(messageIds) {
  const map = {};
  messageIds.forEach((id) => (map[id] = []));
  if (!messageIds.length) return map;
  const { data, error } = await supabase.from('message_reactions').select('*').in('message_id', messageIds);
  if (error) throw error;
  for (const row of data) map[row.message_id].push(row);
  return map;
}

// ---- GIF search (GIPHY) --------------------------------------------
// A direct browser call with the public client key, same pattern as
// RAWG — GIPHY's client keys are meant to be used this way, unlike
// IGDB's which needs the server-side proxy.
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

async function giphy(endpoint, params) {
  const url = `${GIPHY_BASE}/${endpoint}?api_key=${GIPHY_API_KEY}&rating=g&limit=24&${params}`;
  try {
    const res = await fetchWithTimeout(url, {}, 4000);
    if (!res.ok) return [];
    const { data } = await res.json();
    return (data || []).map((g) => ({
      id: g.id,
      preview: g.images.fixed_width_small?.url || g.images.fixed_width?.url,
      full: g.images.fixed_width?.url || g.images.original?.url,
    }));
  } catch {
    return []; // GIPHY being slow/down shouldn't break the composer — just shows no results
  }
}

export async function searchGifs(query) {
  if (!query?.trim()) return getTrendingGifs();
  return giphy('search', `q=${encodeURIComponent(query)}`);
}

export async function getTrendingGifs() {
  return giphy('trending', '');
}

// Live new/deleted messages inside an open thread. Returns an
// unsubscribe function — callers must call it when the thread view is
// torn down, or the channel (and its socket) leaks for the rest of the
// session.
export function subscribeToMessages(conversationId, { onInsert, onDelete }) {
  // The suffix makes every call's channel name unique, not just per
  // conversation — supabase-js silently corrupts two concurrent
  // subscriptions that share one channel name (no error, just a channel
  // that stops delivering), and this file can't rule out two live at
  // once: navigating straight from one thread to another briefly
  // overlaps the old one's teardown with the new one's subscribe.
  const channel = supabase
    .channel(`messages:${conversationId}:${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, (payload) => onInsert(payload.new))
    .on('postgres_changes', {
      event: 'DELETE', schema: 'public', table: 'messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, (payload) => onDelete?.(payload.old))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// Live reactions for every message currently in view — one channel per
// open thread (not per message), filtered client-side against the
// visible message ids since postgres_changes can't filter on "id is in
// this list" server-side. `getMessageIds` is a FUNCTION, not an array —
// called fresh on every incoming event, so a message that arrived after
// this subscription started (the whole point of an open, live thread)
// is still covered. A plain array snapshot here would silently miss
// reactions on anything sent after the subscription was first opened.
export function subscribeToReactions(conversationId, getMessageIds, onChange) {
  const channel = supabase
    .channel(`reactions:${conversationId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
      const row = payload.new?.message_id ? payload.new : payload.old;
      if (row && getMessageIds().includes(row.message_id)) onChange();
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// Uploads into a folder named after the conversation — the storage RLS
// (see migrations/2026-08-19_message-media.sql) checks exactly that
// folder name against who's actually a participant, so the conversation
// has to already exist (see ensureThread() in message-thread-view.js;
// image/video sends go through the same lazy-create-on-first-message
// path as everything else, never uploading before there's somewhere
// real to put it). Returns { url, kind } — kind is read off the file's
// MIME type so the caller doesn't have to guess.
export async function uploadMessageMedia(conversationId, file) {
  const kind = file.type.startsWith('video/') ? 'video' : 'image';
  const ext = (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase();
  const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('message-media').upload(path, file, { cacheControl: '3600' });
  if (error) throw error;
  const { data } = supabase.storage.from('message-media').getPublicUrl(path);
  return { url: data.publicUrl, kind };
}

// Live inbox: fires on anything that changes one of MY conversations
// (a new request landing, a reply, a read marker moving) so the list —
// and its unread/request badges — update themselves with no polling.
// Two filtered bindings on one channel (rather than one unfiltered one)
// so Postgres does the "is this actually my row" filtering, not the
// client. The callback re-fetches rather than trying to patch the one
// changed row in place — simpler, and inbox-sized lists are cheap to
// refetch outright.
export function subscribeToConversations(userId, onChange) {
  // Unique per call, not just per user — app.js keeps one of these alive
  // for the whole session (the nav badge) while messages-view.js opens
  // its own for as long as the inbox is on screen. Two subscriptions
  // sharing a channel name is a real, silent failure mode in
  // supabase-js (no error, the channel just stops delivering), not a
  // theoretical one — hence the same fix as subscribeToMessages above.
  const channel = supabase
    .channel(`conversations:${userId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `user_one_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `user_two_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
