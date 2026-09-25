import { supabase } from './supabase-client.js';
import { invalidateLogViews } from './cache.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, RAWG_API_KEY, GIPHY_API_KEY } from './config.js';

// All IGDB traffic goes through a Supabase Edge Function (see
// supabase/functions/igdb-proxy) rather than straight to api.igdb.com —
// IGDB blocks direct browser requests and needs a Twitch Client Secret
// that can never live in client-side code like this file. The Edge
// Function holds that secret and proxies whatever query is sent here.
const IGDB_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/igdb-proxy`;

// A transparent-background title-logo PNG for the game page, sourced
// from SteamGridDB via its own Edge Function (see
// supabase/functions/steamgriddb-proxy) — same secret-holding reasoning
// as IGDB above.
const STEAMGRIDDB_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/steamgriddb-proxy`;

// A user's PlayStation library and playtime, via the one service PSN
// account behind supabase/functions/psn-proxy — see that function's own
// header comment for the full reasoning: no official PSN API exists, so
// this holds one account's session server-side and looks up whichever
// online ID a user types in, the same way scripts/psn-spike.mjs proved
// works. Nothing belonging to the user (a password, their own PSN
// session) is ever asked for or stored — only the online ID they type.
const PSN_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/psn-proxy`;

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

async function igdb(endpoint, query, { timeout = FETCH_TIMEOUT_MS, retry = true } = {}) {
  try {
    const res = await fetchWithTimeout(IGDB_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ endpoint, query }),
    }, timeout);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    // A cold-started edge function routinely takes longer than the
    // normal 3.5s budget, and the first Discover load of a session is
    // exactly when that happens — which showed up as an empty browse
    // screen with no error and no way to tell it apart from "nothing
    // matched". One retry with real headroom instead.
    if (retry) return igdb(endpoint, query, { timeout: 9000, retry: false });
    return [];
  }
}

// All game-news traffic goes through a Supabase Edge Function (see
// supabase/functions/news-proxy) rather than fetching RSS feeds straight
// from the browser — none of those publishers send CORS headers, so a
// direct fetch from a live domain gets silently blocked. Unlike IGDB,
// no secret is involved; the proxy just merges public RSS server-side.
const NEWS_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/news-proxy`;

// Longer than the default 3.5s timeout — a cold-started function pulling
// 5 outlets' RSS feeds genuinely needs more headroom than a single IGDB
// query does, and this only ever runs once per News tab visit (results
// are cached server-side for 10 minutes after that).
async function fetchRssNews() {
  try {
    const res = await fetchWithTimeout(NEWS_FUNCTION_URL, {
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    }, 8000);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.articles) ? data.articles : [];
  } catch {
    return [];
  }
}

// Posts written in the admin build, shaped into exactly what an RSS
// article looks like so the News tab doesn't need to know the
// difference. Empty (never throwing) if the admin migration hasn't run.
async function fetchCustomNews() {
  try {
    const { data, error } = await supabase
      .from('custom_news')
      .select('id, title, summary, image_url, source, link, published_at, pinned')
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .limit(30);
    if (error) return [];
    return (data || []).map((p) => ({
      title: p.title,
      summary: p.summary || '',
      image: p.image_url || '',
      source: p.source || 'PlayThruu',
      link: p.link || '',
      pubDate: p.published_at,
      pinned: !!p.pinned,
      isCustom: true,
    }));
  } catch {
    return [];
  }
}

// Own posts first (the pinned ones), then everything else — custom and
// RSS together — newest first. Both sources are fetched at once rather
// than in sequence so adding this can't make the News tab slower than
// the RSS call it already waited on.
export async function getGameNews() {
  const [custom, rss] = await Promise.all([fetchCustomNews(), fetchRssNews()]);
  if (!custom.length) return rss;

  const pinned = custom.filter((a) => a.pinned);
  const mixed = [...custom.filter((a) => !a.pinned), ...rss]
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  return [...pinned, ...mixed];
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

/**
 * People worth following: the most-followed accounts on the app that
 * you are not already following, shuffled.
 *
 * Ranked by follower count rather than "newest" or "most games logged"
 * — the whole point of a suggestion is that it is somebody other people
 * already found worth reading, and the other two measures reward
 * whoever signed up most recently or logs most compulsively instead.
 *
 * Shuffled within that ranking so the list is not the same five faces
 * every single time, which is what makes a suggestions row feel dead.
 * Deliberately NOT a "random user" — a genuinely random account is
 * usually an empty one, and following it teaches you the feature is
 * useless.
 *
 * Counted client-side over the follows table because Postgres cannot
 * GROUP BY through PostgREST without an RPC, and this is one small
 * query against a table that is tiny at this scale.
 */
export async function getSuggestedPeople(userId, limit = 20) {
  const [{ data: follows }, alreadyFollowing] = await Promise.all([
    supabase.from('follows').select('following_id'),
    userId ? getFollowingIdSet(userId) : Promise.resolve(new Set()),
  ]);

  const counts = new Map();
  for (const row of (follows || [])) {
    counts.set(row.following_id, (counts.get(row.following_id) || 0) + 1);
  }

  const blocked = await getBlockedIds().catch(() => new Set());
  const ranked = [...counts.entries()]
    .filter(([id]) => id !== userId && !alreadyFollowing.has(id) && !blocked.has(id))
    .sort((a, b) => b[1] - a[1]);

  // Take a generous slice of the top, then shuffle THAT — so every
  // suggestion is still a well-followed account, but which of them you
  // see changes between visits.
  const pool = ranked.slice(0, Math.max(limit * 3, 30)).map(([id]) => id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const ids = pool.slice(0, limit);

  // Nobody has any followers yet (a young app) — fall back to real
  // accounts that have actually logged something, so this never comes
  // back empty just because the follow graph is still bare.
  if (!ids.length) {
    const { data: active } = await supabase
      .from('logs')
      .select('user_id, profiles!logs_user_id_fkey(*)')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(120);
    const seen = new Set();
    const people = [];
    for (const row of (active || [])) {
      const p = row.profiles;
      if (!p || p.id === userId || seen.has(p.id)) continue;
      if (alreadyFollowing.has(p.id) || blocked.has(p.id)) continue;
      seen.add(p.id);
      people.push(p);
      if (people.length >= limit) break;
    }
    return people;
  }

  const { data: profiles, error } = await supabase
    .from('profiles').select('*').in('id', ids);
  if (error) throw error;
  // .in() comes back in whatever order Postgres likes; restore the
  // shuffled ranking the work above actually produced.
  const byId = new Map((profiles || []).map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
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
    // is_hidden is what the admin build sets to pull a game out of the
    // app without deleting the row (and everyone's logs of it). "not is
    // true" rather than "eq false" on purpose: rows predating the column
    // have it NULL, and eq(false) would quietly hide every one of them.
    .not('is_hidden', 'is', true)
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
    cover_url: igdbImageUrl(g.cover?.image_id, '1080p'),
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

// ------------------------------------------------------------
// ABBREVIATIONS
// ------------------------------------------------------------
// Nobody types "Grand Theft Auto". They type GTA, and IGDB's own search
// returns nothing useful for it, because the string "gta" appears in
// none of those titles. Same for every other series people only ever
// say as initials.
//
// Two halves make this work, and it needs both: the query is EXPANDED
// before it goes to IGDB (so the right games come back at all), and
// titleMatchTier below scores a result against the expansions as well
// as the raw query (so the relevance filter does not immediately throw
// them away again for not containing the letters that were typed).
//
// An abbreviation may legitimately mean more than one series — "ds" is
// Dark Souls and Death Stranding, "re" is Resident Evil — so every
// entry is a list and all of them are tried.
const TITLE_ALIASES = {
  gta: ['grand theft auto'],
  cod: ['call of duty'],
  mw: ['modern warfare'],
  rdr: ['red dead redemption'],
  tlou: ['the last of us'],
  gow: ['god of war'],
  ac: ["assassin's creed"],
  botw: ['the legend of zelda breath of the wild', 'breath of the wild'],
  totk: ['the legend of zelda tears of the kingdom', 'tears of the kingdom'],
  ds: ['dark souls', 'death stranding'],
  re: ['resident evil'],
  mgs: ['metal gear solid'],
  ff: ['final fantasy'],
  ffvii: ['final fantasy vii'],
  nfs: ['need for speed'],
  csgo: ['counter-strike global offensive'],
  cs: ['counter-strike'],
  dmc: ['devil may cry'],
  kh: ['kingdom hearts'],
  sotc: ['shadow of the colossus'],
  bg3: ["baldur's gate 3"],
  bg: ["baldur's gate"],
  cp2077: ['cyberpunk 2077'],
  cp: ['cyberpunk'],
  hzd: ['horizon zero dawn'],
  hfw: ['horizon forbidden west'],
  tw3: ['the witcher 3 wild hunt'],
  tw: ['the witcher'],
  pubg: ["playerunknown's battlegrounds"],
  ow: ['overwatch'],
  lol: ['league of legends'],
  wow: ['world of warcraft'],
  gtav: ['grand theft auto v'],
  sm2: ["marvel's spider-man 2"],
  mh: ['monster hunter'],
  mhw: ['monster hunter world'],
  er: ['elden ring'],
  bo6: ['call of duty black ops 6'],
  nba2k: ['nba 2k'],
  ffxiv: ['final fantasy xiv'],
  ffxvi: ['final fantasy xvi'],
  poe: ['path of exile'],
  dbd: ['dead by daylight'],
  tes: ['the elder scrolls'],
  oot: ['the legend of zelda ocarina of time'],
  ww: ['the legend of zelda the wind waker'],
  sm64: ['super mario 64'],
  ssbu: ['super smash bros ultimate'],
  ssb: ['super smash bros'],
  gt7: ['gran turismo 7'],
  fh: ['forza horizon'],
  fm: ['forza motorsport'],
  kcd: ['kingdom come deliverance'],
  sf6: ['street fighter 6'],
  sf: ['street fighter'],
  mk: ['mortal kombat'],
  tekken: ['tekken'],
  hl: ['half-life'],
  hla: ['half-life alyx'],
  p5: ['persona 5'],
  p4: ['persona 4'],
  p3: ['persona 3'],
  smt: ['shin megami tensei'],
  xc: ['xenoblade chronicles'],
  alttp: ['the legend of zelda a link to the past'],
  sotn: ['castlevania symphony of the night'],
  nier: ['nier automata'],
  ac6: ['armored core vi'],
  ttt: ['tekken tag tournament'],
};

// Roman numerals are how sequels are actually titled — "Grand Theft
// Auto V", "Final Fantasy VII" — while people type the digit. Only the
// low numbers matter; nobody searches for part XVIII.
const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi'];

function swapNumberForms(q) {
  const out = [];
  // "gta 5" -> "gta v"
  const digits = q.replace(/\b(\d{1,2})\b/g, (m, d) => (ROMAN[Number(d)] ? ROMAN[Number(d)] : m));
  if (digits !== q) out.push(digits);
  // "final fantasy vii" -> "final fantasy 7"
  const romans = q.replace(/\b([ivx]{1,5})\b/g, (m) => {
    const i = ROMAN.indexOf(m.toLowerCase());
    return i > 0 ? String(i) : m;
  });
  if (romans !== q) out.push(romans);
  return out;
}

/**
 * Every spelling of a query worth searching for, most literal first.
 *
 * "gta 5" comes back as ["gta 5", "grand theft auto 5", "gta v",
 * "grand theft auto v"], which between them find the game whichever way
 * IGDB happens to have titled it.
 */
export function expandQuery(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const out = [raw];
  const norm = normalizeTitle(raw);
  if (!norm) return out;

  const words = norm.split(' ');
  const head = words[0];
  const rest = words.slice(1).join(' ');

  // The whole query is an abbreviation ("gta"), or it leads with one
  // ("gta 5", "re 4") — the common shapes by far.
  for (const expansion of TITLE_ALIASES[norm] || []) out.push(expansion);
  if (rest && TITLE_ALIASES[head]) {
    for (const expansion of TITLE_ALIASES[head]) out.push(`${expansion} ${rest}`);
  }
  // "rdr2", "gta5", "re4" — the sequel number written straight onto the
  // abbreviation with no space, which is how people actually type it.
  const glued = /^([a-z]+)(\d{1,2})$/.exec(head);
  if (glued && TITLE_ALIASES[glued[1]]) {
    const tail = [glued[2], rest].filter(Boolean).join(' ');
    for (const expansion of TITLE_ALIASES[glued[1]]) out.push(`${expansion} ${tail}`);
  }

  for (const form of [...out]) out.push(...swapNumberForms(form));

  // De-duplicated on the normalised form, so "GTA" and "gta" are one.
  const seen = new Set();
  return out.filter((q) => {
    const k = normalizeTitle(q);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function titleMatchTierExact(query, title) {
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

// The tier actually used everywhere: the best score across every
// spelling of the query (see expandQuery). Without this, expanding the
// query would find "Grand Theft Auto V" and then dropIrrelevant would
// throw it straight back out for not containing the letters "gta".
// Expansions score one tier worse than a literal hit, so a game that
// really is called what you typed still outranks one that only matches
// through an abbreviation.
function titleMatchTier(query, title) {
  const direct = titleMatchTierExact(query, title);
  if (direct === 0 || direct === 1) return direct;
  let best = direct;
  const forms = expandQuery(query);
  for (let i = 1; i < forms.length; i++) {
    const tier = titleMatchTierExact(forms[i], title);
    if (tier >= MATCH_TIER_WORST) continue;
    best = Math.min(best, Math.min(tier + 1, MATCH_TIER_WORST - 1));
  }
  return best;
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

// `includeEditions` exists for ONE caller: matching an imported console
// library. Everywhere else, hiding "…: Definitive Edition" is right —
// nobody searching "Lies of P" wants four store SKUs back. But when PSN
// says the played title IS "Grand Theft Auto III – The Definitive
// Edition", filtering that away leaves only the 2001 original to match
// against, and the import silently records the wrong game. Same for
// `version_parent`, which is exactly what IGDB hangs editions off.
export async function searchIgdb(query, limit = 12, page = 1, { includeEditions = false } = {}) {
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
  const where = includeEditions ? '' : ' where version_parent = null;';
  const q = `search "${escapeApicalypse(query)}"; fields ${IGDB_SEARCH_FIELDS};${where} limit ${fetchLimit}; offset ${offset};`;
  const results = await igdb('games', q);
  // IGDB category: 3 = bundle, 13 = pack. Anything else — including an
  // absent category — is kept, so a missing field never costs a result.
  const noBundles = results.filter((g) => g.category !== 3 && g.category !== 13);
  const asGames = noBundles.map(mapIgdbGame);
  const mapped = includeEditions ? asGames : filterOutEditions(asGames);
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
  // An abbreviated query is also searched in full ("gta" -> "grand
  // theft auto"), because IGDB matches on the title text and none of
  // those games contain the letters people actually type. One extra
  // request, and only when the query really is an abbreviation we know.
  const [, expanded] = expandQuery(query);
  const settled = await Promise.allSettled([
    page === 1 ? searchGames(query, limit) : Promise.resolve([]),
    searchIgdb(query, limit, page),
    page === 1 ? searchRawg(query, limit) : Promise.resolve([]),
    expanded ? searchIgdb(expanded, limit, page) : Promise.resolve([]),
  ]);
  const [local, igdbDirect, rawgRemote, igdbExpanded] = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));
  // dedupeKey, not a raw lowercase of the title: a remote "Alan Wake II"
  // is the local "Alan Wake 2" and has to be recognised as such HERE,
  // before ranking, or both spellings take up a slot apiece.
  const igdbSeen = new Set(igdbDirect.map((g) => dedupeKey(g.title)));
  const igdbRemote = [...igdbDirect, ...igdbExpanded.filter((g) => !igdbSeen.has(dedupeKey(g.title)))];

  const localTitles = new Set(local.map((g) => dedupeKey(g.title)));
  let remote = igdbRemote.filter((g) => !localTitles.has(dedupeKey(g.title)));

  const seenTitles = new Set([...localTitles, ...remote.map((g) => dedupeKey(g.title))]);
  const rawgFiltered = rawgRemote
    .filter((g) => !seenTitles.has(dedupeKey(g.title)))
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
    hasMore: igdbDirect.length >= limit,
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
// The key two rows have to share to count as the same game. Plain
// normalisation is not enough on its own: IGDB and our own catalogue
// disagree about how to write a sequel number, so "Alan Wake 2" and
// "Alan Wake II" came back as two rows for one game, with the same
// cover, the same year and the same director under them.
//
// Only numerals of TWO OR MORE characters are folded. A bare trailing
// "X" is the tempting case to include and exactly the one that must
// not be: Mega Man X and Mega Man 10 are different games in different
// series, and folding single letters also turns "V Rising" into
// "5 Rising" and "I Am Fish" into "1 Am Fish".
// A trailing "(1997)" is IGDB disambiguating one same-named game from
// another, and it is also how the same game ends up listed twice —
// "Final Fantasy VII" alongside "Final Fantasy VII (1997)". Stripped
// from the key, with the year kept separately so explicitYear below can
// stop the strip from merging Prey (2006) into Prey (2017).
const TRAILING_YEAR = /\s*\(\s*(19|20)\d{2}\s*\)\s*$/;

function explicitYear(title) {
  const m = String(title || '').match(TRAILING_YEAR);
  return m ? m[0].replace(/[^0-9]/g, '') : null;
}

function dedupeKey(title) {
  const t = normalizeTitle(String(title || '').replace(TRAILING_YEAR, ''));
  if (!t) return '';
  return t.split(' ').map((w) => {
    if (w.length < 2) return w;
    const i = ROMAN.indexOf(w);
    return i > 0 ? String(i) : w;
  }).join(' ');
}

// How much this row actually tells you about the game. Used to pick
// which of a duplicate pair survives — the ask was to keep "the main
// one with more information", and cover-art-plus-recency did not
// capture that on its own.
function infoScore(g) {
  const fields = [g.release_year, g.platform, g.genre, g.developer, g.publisher,
    g.summary, g.cover_url, g.igdb_id];
  return fields.reduce((n, v) => n + (v ? 1 : 0), 0);
}

function mergeDuplicateTitles(games) {
  const groups = new Map();
  const order = [];
  games.forEach((g, i) => {
    const key = dedupeKey(g.title) || `__${i}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(g);
  });
  return order.flatMap((key) => {
    const group = groups.get(key);
    if (group.length === 1) return group[0];
    // Two or more DIFFERENT years spelled out in the titles means IGDB
    // is telling us these are distinct games that happen to share a
    // name — Prey (2006) and Prey (2017). Collapsing those would delete
    // a real game from the results, so the group is left alone.
    const years = new Set(group.map((g) => explicitYear(g.title)).filter(Boolean));
    if (years.size > 1) return group;
    const rep = [...group].sort((a, b) => {
      if ((a._source === 'local') !== (b._source === 'local')) return a._source === 'local' ? -1 : 1;
      const info = infoScore(b) - infoScore(a);
      if (info !== 0) return info;
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
    // Prefer the clean spelling for the row that survives: with the
    // duplicate gone there is nothing left for "(1997)" to distinguish
    // it from, and it just reads as clutter.
    const plain = group.find((g) => !explicitYear(g.title));
    return { ...rep, title: plain ? plain.title : rep.title, platform: platforms.slice(0, 6).join(', ') };
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
  { file: 'Alan Wake 2.webp', title: 'Alan Wake 2', gameId: 'e1c25699-4eef-43be-b887-c26c1f57f960' },
  { file: "Assasin's Creed Black Flag resync.webp", title: "Assassin's Creed IV: Black Flag", gameId: 'b2fca819-762b-4ead-94c1-4648744302e9' },
  { file: 'Claire Obscure Expedition 33.webp', title: 'Clair Obscur: Expedition 33', gameId: '5f1b072c-1c60-4584-af46-3724d1669363' },
  { file: 'Cuphead.webp', title: 'Cuphead', gameId: 'c5e3f147-c385-459d-a63b-d4acb4825cdb' },
  { file: 'Dark Souls 3.webp', title: 'Dark Souls III', gameId: '38e86f19-a190-4aeb-88f2-90708707d614' },
  // Accented on purpose: "Désiré" (Sylvain Seccia, 2016) is a distinct
  // game from the unrelated 1997 title "Desire" — dropping the accent
  // collided the two, since IGDB's own title differs only by it.
  { file: 'Desire 2016.webp', title: 'Désiré', year: 2016, gameId: '1ddfd033-24dd-4742-a428-c1d82f4016b4' },
  { file: 'Doki Doki Literature Club.webp', title: 'Doki Doki Literature Club', gameId: 'db123dd8-cfda-46e0-b74b-ecb083294f7d' },
  { file: 'Elden Ring Shadow Of The Erdtree.webp', title: 'Elden Ring: Shadow of the Erdtree', gameId: '409ac760-da1d-487c-8158-d2d270e20d16' },
  { file: 'Elden Ring.webp', title: 'Elden Ring', gameId: 'fa6f2b07-f33a-44a1-a21f-72c51576a217' },
  { file: "Elder's scroll Skyrim 5.webp", title: 'The Elder Scrolls V: Skyrim', gameId: 'b78ecb1e-68a2-4d20-bae9-27695dae07bb' },
  { file: 'Ghost of Yotei.webp', title: 'Ghost of Yōtei', gameId: 'c12852be-b440-44d6-95c7-39baa606254f' },
  { file: 'God Of War 4.webp', title: 'God of War', gameId: 'd1d00809-815a-412a-ba7c-5106783139ea' },
  { file: 'Grand Theft Auto VI.webp', title: 'Grand Theft Auto VI', gameId: '5e55463d-fb98-4651-bb0b-c2ae531ef73d' },
  { file: 'Halo ps5.webp', title: 'Halo: Campaign Evolved', gameId: '3e7a7a0f-edeb-464a-9d26-9b8ee266038d' },
  { file: 'Hollow Knight Silksong.webp', title: 'Hollow Knight: Silksong', gameId: 'caf472e5-e738-42b2-bffd-e7af6f818179' },
  { file: 'Hollow Knight.webp', title: 'Hollow Knight', gameId: '49001bc5-ac3c-49e2-84d2-6532a4fb04e3' },
  { file: 'Indika.webp', title: 'Indika', gameId: '21adccfc-842c-4d70-981e-d35986290942' },
  { file: 'Life Is Strange 2.webp', title: 'Life is Strange 2', gameId: '2afdf12f-1f7a-49dc-8b50-7f9b2effe8cb' },
  { file: 'Lost Record Bloom & Rage.webp', title: 'Lost Records: Bloom & Rage', gameId: '02efcc7c-eb2b-4e8e-82a9-de87c5612a9d' },
  { file: 'Lost Records Bloom & Rage.webp', title: 'Lost Records: Bloom & Rage', gameId: '02efcc7c-eb2b-4e8e-82a9-de87c5612a9d' },
  { file: 'Night In The Woods.webp', title: 'Night in the Woods', gameId: '0e5f60d7-c62f-4b6a-805f-ed09a984053d' },
  { file: 'Persona 5 royal.webp', title: 'Persona 5 Royal', gameId: 'bc926d9f-a2b9-4d4a-b03c-5d03ea58df75' },
  { file: 'Red Dead Redemption 2.webp', title: 'Red Dead Redemption 2', gameId: '9e967756-38ad-4a34-8f9e-e1bc93725753' },
  // "Resident Evil 4" alone is ambiguous — the 2005 original and the 2023
  // remake share the exact same title on IGDB, and popularity (the usual
  // tiebreaker) favours the older one purely on rating-count seniority.
  // `year` disambiguates the fallback path if this ever needs re-resolving.
  { file: 'Resident Evil 4 Remake.webp', title: 'Resident Evil 4', year: 2023, gameId: '1f4882c5-01cb-443f-b3d0-5c782da06163' },
  { file: 'Spider Man 2.webp', title: "Marvel's Spider-Man 2", gameId: 'f6639449-193c-4a75-bda8-d10cce10cb98' },
  { file: 'Super Mario Bros.webp', title: 'Super Mario Bros.', gameId: '165891ad-5c09-4437-a1df-a5e3c476fdd7' },
  { file: 'The last of us part 1 remake.webp', title: 'The Last of Us Part I', gameId: '707dd72d-197c-451c-82a1-aef84acb7d31' },
  { file: 'The Last Of Us Part 2 Remastered.webp', title: 'The Last of Us Part II Remastered', gameId: '2ff721f1-cfa7-420f-b15c-090822bac561' },
  { file: 'The Last Of Us Part 2.webp', title: 'The Last of Us Part II', gameId: 'd1eb7395-8126-45fc-8b17-2ddf1792ccf4' },
  { file: 'Undertale.webp', title: 'Undertale', gameId: '33473bad-ada7-42dd-86e9-4d228daaf56c' },
  { file: 'What Remain Of Edith Finch.webp', title: 'What Remains of Edith Finch', gameId: 'd32f02f4-8a6f-48b9-b48f-bc66b544b009' },
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

// `count` distinct entries off the same shuffle bag, for a screen that
// shows several at once (the tour's five slides) rather than one at a
// time. Distinct within the call: drawBackdrop only guarantees it does
// not repeat back-to-back, which is not the same thing when five are
// drawn in a row.
export function drawBackdrops(count) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < count * 4 && out.length < count; i++) {
    const e = drawBackdrop();
    if (seen.has(e.file)) continue;
    seen.add(e.file);
    out.push({ url: `images/backdrops/${encodeURIComponent(e.file)}`, title: e.title, gameId: e.gameId || null });
  }
  return out;
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
// Vote-count bands, shared by the collections below so the numbers are
// defined once and mean the same thing everywhere.
//
// CREDIBLE is the floor under anything sorted by rating. IGDB's
// total_rating carries no vote threshold, so "top rated" without this
// is a list of games three people scored 100 — which is exactly what
// the Story masterpieces row used to be: Ghost Town, Shipwrecked 64,
// Dawnfolk, nobody-games above every actual masterpiece.
//
// FAMOUS is the ceiling that makes "underrated" mean something. A game
// everyone has already played cannot be a hidden gem, so the rows that
// are about discovery cut off above this — it is what keeps Red Dead 2,
// The Witcher 3 and GTA V out of them.
const CREDIBLE_VOTES = 60;
const FAMOUS_VOTES = 900;

/**
 * Which slice of a rotating collection to show right now.
 *
 * A "hidden gems" row that shows the same twelve games forever stops
 * being worth opening after the first look. This walks deeper into the
 * same ranked result set as time passes, so the row genuinely turns
 * over — while every game in it is still one the filters already
 * vouched for, rather than a random pick.
 *
 * Derived from the date rather than stored anywhere: no cron job, no
 * table, no "last rotated" column to go stale, and every device shows
 * the same set on the same day. A fortnight is the period — long
 * enough that something you meant to come back to is still there, short
 * enough that the row is new again by your next proper browse.
 */
const ROTATION_DAYS = 14;
const ROTATION_SLICES = 5; // how deep into the ranking it will walk before wrapping

export function rotationPage(date = new Date()) {
  const fortnights = Math.floor(date.getTime() / (ROTATION_DAYS * 86400000));
  return (fortnights % ROTATION_SLICES) + 1;
}

export const DISCOVERY_COLLECTIONS = [
  // Default: acclaimed single-player story games that are NOT the same
  // handful everyone has finished. Highly rated, rated by enough people
  // to trust the score, but short of household-name recognition.
  { id: 'masterpieces', label: 'Story masterpieces', rotates: true, params: { genre: 'genre:31', multiplayer: 'singleplayer', minRating: 80, minVotes: CREDIBLE_VOTES, maxVotes: FAMOUS_VOTES, sort: 'top_rated' } },
  { id: 'indie', label: 'Indie darlings', rotates: true, params: { genre: 'genre:32', multiplayer: 'singleplayer', minRating: 75, minVotes: CREDIBLE_VOTES, maxVotes: FAMOUS_VOTES, sort: 'top_rated' } },
  { id: 'popular', label: 'Hot right now', params: { sort: 'popular' } },
  { id: 'all_time', label: 'All-time greats', params: { sort: 'all_time', minVotes: CREDIBLE_VOTES } },
  { id: 'story', label: 'For the story', rotates: true, params: { genre: 'genre:31', minRating: 78, minVotes: CREDIBLE_VOTES, sort: 'top_rated' } },
  { id: 'underrated', label: 'Hidden gems', rotates: true, params: { minRating: 80, minVotes: CREDIBLE_VOTES, maxVotes: 300, sort: 'top_rated' } },
  { id: 'rpg', label: 'Deep RPGs', rotates: true, params: { genre: 'genre:12', minRating: 78, minVotes: CREDIBLE_VOTES, sort: 'top_rated' } },
  { id: 'short', label: 'Short & sweet', rotates: true, params: { genre: 'genre:9', minRating: 75, minVotes: CREDIBLE_VOTES, sort: 'top_rated' } },
  { id: 'chaos', label: 'Pure chaos', params: { genre: 'genre:5', sort: 'popular' } },
  { id: 'couch', label: 'Grab a friend', params: { multiplayer: 'multiplayer', sort: 'popular' } },
  { id: 'online', label: 'Online multiplayer', params: { multiplayer: 'multiplayer', sort: 'all_time', minVotes: CREDIBLE_VOTES } },
  { id: 'classics', label: 'Retro classics', rotates: true, params: { sort: 'all_time', dateTo: '2012-12-31', minVotes: CREDIBLE_VOTES } },
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

// ------------------------------------------------------------
// CURATED TRENDING (admin build)
// ------------------------------------------------------------
// Everything below degrades to "behave exactly as before" if the admin
// migration hasn't been run or the tables are empty — the whole point is
// that shipping this can't change what anyone sees until a real pick is
// made in the admin app. So every failure path returns a neutral value
// instead of throwing: a missing table is a normal state here, not an
// error worth surfacing to somebody scrolling their feed.
async function getCuratedTrending() {
  try {
    const { data, error } = await supabase
      .from('curated_trending')
      .select('position, games(*)')
      .order('position', { ascending: true });
    if (error) return [];
    return (data || []).map((r) => r.games).filter(Boolean);
  } catch {
    return [];
  }
}

async function getAppSetting(key, fallbackValue) {
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) return fallbackValue;
    return data?.value ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
}

// ------------------------------------------------------------
// PRESENCE
// ------------------------------------------------------------
// Writes are fire-and-forget on purpose. Nothing in the app depends on
// a heartbeat landing, and a failed one (offline, or the migration not
// run yet) must never surface as an error to somebody just using the
// app — so this swallows everything and returns quietly.
export async function touchPresence(userId) {
  if (!userId) return;
  try {
    await supabase.from('user_presence').upsert(
      { user_id: userId, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  } catch {
    /* presence is best-effort */
  }
}

// Admin-only in practice: the RLS policy on user_presence only returns
// your own row unless you're an admin.
export async function getPresenceFor(userIds) {
  if (!userIds?.length) return {};
  try {
    const { data, error } = await supabase
      .from('user_presence')
      .select('user_id, last_seen_at')
      .in('user_id', userIds);
    if (error) return {};
    return Object.fromEntries((data || []).map((r) => [r.user_id, r.last_seen_at]));
  } catch {
    return {};
  }
}

// ------------------------------------------------------------
// USAGE TIME
// ------------------------------------------------------------
// Same fire-and-forget contract as touchPresence just above: a failed
// bump is nothing anyone using the app should ever see, so this
// swallows everything. The actual add happens server-side, inside
// bump_usage (see migrations/2026-09-25_usage_time.sql) — this just
// hands over how many seconds of foreground time to bank.
export async function bumpUsage(seconds) {
  const n = Math.round(seconds);
  if (!n || n <= 0) return;
  try {
    await supabase.rpc('bump_usage', { p_seconds: n });
  } catch {
    /* usage tracking is best-effort */
  }
}

// Admin-only in practice: the RLS policy on user_usage only returns
// your own row unless you're an admin.
export async function getUsageFor(userIds) {
  if (!userIds?.length) return {};
  try {
    const { data, error } = await supabase
      .from('user_usage')
      .select('user_id, total_seconds')
      .in('user_id', userIds);
    if (error) return {};
    return Object.fromEntries((data || []).map((r) => [r.user_id, r.total_seconds]));
  } catch {
    return {};
  }
}

// Hydrates game cards sent in a conversation (kind='game', body=game id)
// — one query for every game referenced in the open thread.
export async function getGamesByIds(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return {};
  try {
    const { data, error } = await supabase
      .from('games')
      .select('id, title, cover_url, background_url, release_year, genre, platform')
      .in('id', list);
    if (error) return {};
    return Object.fromEntries((data || []).map((g) => [g.id, g]));
  } catch {
    return {};
  }
}

// The most recent public "playing" game for each of the given users, as
// { userId: { id, title, cover_url } }. Powers the "Playing X" context in
// the Messenger inbox rows and conversation header — read straight from
// public logs (no presence table / privacy policy involved). One query
// for the whole inbox; newest 'playing' log per user wins.
export async function getPlayingByUsers(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return {};
  try {
    const { data, error } = await supabase
      .from('logs')
      .select('user_id, updated_at, games!logs_game_id_fkey(id, title, cover_url)')
      .in('user_id', ids)
      .eq('status', 'playing')
      .eq('is_public', true)
      .order('updated_at', { ascending: false });
    if (error) return {};
    const out = {};
    (data || []).forEach((r) => { if (!out[r.user_id] && r.games) out[r.user_id] = r.games; });
    return out;
  } catch {
    return {};
  }
}

// A banner the admin build can push across the top of everyone's feed.
// Returns null when there isn't one, which is the overwhelmingly common
// case — the feed only renders anything when this is non-null.
export async function getActiveAnnouncement() {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('id, message, link, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

// "What's the World Playing" — roughly the 10 games with the most
// rating activity on IGDB over the last month. This is real-world
// popularity, not just this app's own (still-small) activity.
//
// Hand-picked games from the admin build lead the list (or replace it
// outright, depending on the trending_mode setting). With no picks
// saved, this is a straight passthrough to the live IGDB list below.
export async function getWorldTrending(limit = 10, days = 30) {
  const curated = await getCuratedTrending();
  if (!curated.length) return fetchLiveTrending(limit, days);

  const mode = await getAppSetting('trending_mode', 'lead');
  if (mode === 'replace' && curated.length >= limit) return curated.slice(0, limit);

  let live = [];
  try {
    live = await fetchLiveTrending(limit, days);
  } catch {
    live = [];
  }

  // A curated game is very often already in IGDB's popular list, and
  // showing it twice would look broken. Matching on igdb_id first (the
  // stable identity) and falling back to a normalised title covers both
  // catalog rows that came from IGDB and ones that didn't.
  const pickedIgdb = new Set(curated.map((g) => g.igdb_id).filter(Boolean));
  const pickedTitles = new Set(curated.map((g) => (g.title || '').trim().toLowerCase()));
  const rest = live.filter((g) =>
    !(g.igdb_id && pickedIgdb.has(g.igdb_id)) &&
    !pickedTitles.has((g.title || '').trim().toLowerCase()));

  return [...curated, ...rest].slice(0, Math.max(limit, curated.length));
}

async function fetchLiveTrending(limit = 10, days = 30) {
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
    .select('id, game_id, status, rating, loved, review, contains_spoilers, created_at, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)')
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
    loved: row.loved,
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
// IGDB's `search` verb stopped returning anything on the companies
// endpoint, which is what silently disabled the Developer and Publisher
// filters completely: this returned null every time, the clause was
// dropped, and the results came back identical to no filter at all —
// the filter looked applied and did nothing. Matched on the name field
// instead: exact first, so "Nintendo" doesn't lose to "Nintendo R&D4",
// then a contains match so a partial name still finds something.
async function resolveIgdbCompanyId(name) {
  const term = name?.trim();
  if (!term) return null;
  try {
    const safe = escapeApicalypse(term);
    const exact = await igdb('companies', `fields id,name; where name = "${safe}"; limit 1;`);
    if (exact[0]?.id) return exact[0].id;
    const like = await igdb('companies', `fields id,name; where name ~ *"${safe}"*; limit 25;`);
    if (!like.length) return null;
    // Shortest name wins as the closest thing to what was typed — a
    // search for "Rockstar" should land on Rockstar Games, not
    // Rockstar Leeds.
    like.sort((a, b) => (a.name?.length || 999) - (b.name?.length || 999));
    return like[0].id;
  } catch {
    return null;
  }
}

// The games a company worked on, as an explicit id list.
//
// The obvious `where involved_companies.company = (X) & involved_companies.developer = true`
// does not mean what it reads like and returns nothing at all, so the
// relationship is resolved on its own endpoint and the games are then
// fetched by id. Returns [] for "this company has nothing matching",
// which is a real answer and must not be confused with "no filter".
async function gameIdsForCompany(companyId, role) {
  if (!companyId) return [];
  const rows = await igdb(
    'involved_companies',
    `fields game; where company = ${companyId} & ${role} = true; limit 500;`,
  );
  return [...new Set(rows.map((r) => r.game).filter(Boolean))];
}

// Filterable/sortable browse, backing the Discover screen.
export async function browseGames({
  genre, platform, dateFrom, dateTo, sort = 'popular', minRating, multiplayer,
  developer, publisher, page = 1,
  // How many people rated it, as a floor and a ceiling.
  //
  // The floor is what stops "top rated" meaning "one person gave this a
  // 100": IGDB's total_rating has no vote threshold of its own, so
  // sorting by it alone surfaces games with three ratings above games
  // everyone agrees are great. The ceiling is the opposite end — it is
  // how a "hidden gem" is expressible at all, since the thing that
  // makes Red Dead 2 not a hidden gem is precisely that a hundred
  // thousand people have already rated it.
  minVotes, maxVotes,
} = {}) {
  try {
    const limit = 20;
    const offset = (page - 1) * limit;
    const now = Math.floor(Date.now() / 1000);
    const clauses = ['version_parent = null'];
    // "Anticipated" is the one sort that is ABOUT unreleased games, so
    // the released-only floor every other sort wants directly
    // contradicts it: together they asked for a release date that is
    // both before and after right now, which nothing satisfies, and the
    // tab came back permanently empty.
    if (sort !== 'anticipated') {
      clauses.push(`(first_release_date <= ${now} | first_release_date = null)`);
    }

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
    if (minVotes) clauses.push(`total_rating_count >= ${Number(minVotes)}`);
    if (maxVotes) clauses.push(`total_rating_count <= ${Number(maxVotes)}`);
    if (multiplayer === 'singleplayer') clauses.push('game_modes = (1)');
    if (multiplayer === 'multiplayer') clauses.push('game_modes = (2)');

    const wantsDev = !!developer?.trim();
    const wantsPub = !!publisher?.trim();
    if (wantsDev || wantsPub) {
      const [devId, pubId] = await Promise.all([
        wantsDev ? resolveIgdbCompanyId(developer) : null,
        wantsPub ? resolveIgdbCompanyId(publisher) : null,
      ]);
      // A name that matches no company is not the same as no filter —
      // showing the unfiltered top 20 instead would quietly answer a
      // question nobody asked.
      if ((wantsDev && !devId) || (wantsPub && !pubId)) return { games: [], hasMore: false };

      const [devGames, pubGames] = await Promise.all([
        wantsDev ? gameIdsForCompany(devId, 'developer') : null,
        wantsPub ? gameIdsForCompany(pubId, 'publisher') : null,
      ]);
      let pool = devGames;
      if (pubGames) {
        const pubSet = new Set(pubGames);
        pool = pool ? pool.filter((id) => pubSet.has(id)) : pubGames;
      }
      if (!pool.length) return { games: [], hasMore: false };
      // Apicalypse caps how much a single where-clause can carry, and
      // the list is already ordered by IGDB's own relevance, so the head
      // of it is the right thing to keep when a studio is prolific.
      clauses.push(`id = (${pool.slice(0, 400).join(',')})`);
    }

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
      if (!game.cover_url && detail.cover?.image_id) updates.cover_url = igdbImageUrl(detail.cover.image_id, '1080p');
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
        igdb_id: g.id, title: g.name, cover_url: igdbImageUrl(g.cover?.image_id, '1080p'),
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
  if (game.credits_fetched) {
    const cached = { director: null, cast: [], crew: [], ...(game.credits_json || {}) };
    // A row cached before Crew existed has credits_json with no `crew`
    // key at all — distinct from a game that was actually checked and
    // has none (that's `crew: []`, a real empty array). Without this,
    // every game credits-cached before this feature shipped would show
    // "no crew" forever, even for well-documented games that genuinely
    // have some (verified: God of War 2018's own cache was exactly this
    // — Bear McCreary as composer, sitting right there on Wikidata,
    // never asked for because credits_fetched short-circuited above it).
    // One extra Wikidata query, only ever once per game, only for rows
    // that predate this feature.
    if (!('crew' in (game.credits_json || {})) && game.id) {
      backfillCrew(game, cached).catch(() => {});
    }
    return cached;
  }
  const result = await fetchCastAndDirectorLive(game.title);
  // A totally empty result (no director, no cast, no crew) almost always
  // means the lookup missed rather than that the game genuinely has none
  // of it — RAWG or Wikidata being briefly unreachable, a title not
  // matching yet, etc. Caching that as final locked it in forever, even
  // after a later fix would've found it, since nothing ever asked again.
  // Only a result with something in it is worth freezing.
  if (game.id && (result.director || result.cast.length || result.crew.length)) {
    // Fire-and-forget: a failed save (signed out) just means no
    // persistence this time, same tradeoff already accepted for IGDB
    // enrichment — the live result above is still returned either way.
    supabase.from('games').update({ credits_json: result, credits_fetched: true }).eq('id', game.id)
      .then(() => {}, () => {});
  }
  return result;
}

// A transparent-background title-logo PNG (shown in place of the plain
// text title — see gd-head__logo in game-view.js) from SteamGridDB,
// looked up the first time this game's page is opened and cached on the
// row after that (same shape as credits_fetched above). `game` needs at
// least { id, title, logo_url, logo_fetched }.
//
// SteamGridDB's "grids" (the other asset this same lookup can return)
// used to also overwrite the game's own cover_url as a quality upgrade —
// reverted: SteamGridDB grids are predominantly fan-made/alternate cover
// art (verified against real API responses — most carry notes like
// "removed watermark, added logo", explicit fan-edit attribution), not
// official box art, and that's not an acceptable substitute for a game's
// real cover. grid_url is still fetched and stored (harmless, may be
// useful later) but is no longer read anywhere as a cover_url source —
// IGDB/RAWG remain the only sources for the actual poster everywhere in
// the app.
export async function getGameArt(game) {
  if (!game || !game.title) return { logo_url: null, grid_url: null };
  if (game.logo_fetched) return { logo_url: game.logo_url || null, grid_url: game.grid_url || null };
  let logo_url = null, grid_url = null;
  try {
    const res = await fetchWithTimeout(STEAMGRIDDB_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ title: game.title }),
    });
    if (res.ok) { const data = await res.json(); logo_url = data.logo_url || null; grid_url = data.grid_url || null; }
  } catch { /* no art this time — existing text title / cover still work fine as a fallback */ }
  if (game.id) {
    // Fire-and-forget, same tradeoff as credits/enrichment caching above —
    // records the attempt (logo_fetched:true) even on a miss, so a game
    // with no SteamGridDB art isn't re-queried on every future visit.
    // cover_url is deliberately NOT touched here — see the note above.
    supabase.from('games').update({ logo_url, grid_url, logo_fetched: true }).eq('id', game.id)
      .then(() => {}, () => {});
  }
  return { logo_url, grid_url };
}

// One-time backfill for a game whose credits were cached before Crew
// existed (see the `'crew' in ...` check in getGameCastAndDirector
// above). Re-resolves the same Wikidata item the original cast/director
// lookup would have used and asks it for crew alone — no need to redo
// the RAWG director lookup or the cast query, both already sitting in
// credits_json. Mutates `cached` in place (harmless even if nothing
// reads it again this session) and persists the merged result so the
// NEXT visit has it without this backfill running again.
async function backfillCrew(game, cached) {
  const qid = await findWikidataGameIdOnce(game.title).catch(() => null);
  const crew = qid ? await fetchWikidataCrew(qid).catch(() => []) : [];
  cached.crew = crew;
  const merged = { ...(game.credits_json || {}), crew };
  await supabase.from('games').update({ credits_json: merged }).eq('id', game.id);
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
  let usedQid = qid;

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
        if (retry && (retry.director || retry.cast.length)) { credits = retry; usedQid = originalQid; }
      }
    }
  }

  if (!credits) return { director: rawgDirector, cast: [], crew: [] };
  // Same qid the (possibly retried) cast/director credits came from, so
  // Crew isn't asked against a stub item that was already rejected above.
  const crew = usedQid ? await fetchWikidataCrew(usedQid).catch(() => []) : [];
  // RAWG's director wins when both have one — it comes from an
  // explicit "director" job role, more reliable than Wikidata's P57
  // which is sometimes populated from a film-style single "director"
  // field that doesn't always fit how games credit that role.
  return { director: rawgDirector || credits.director, cast: credits.cast, crew };
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

// The properties that make up the Crew tab (writers, composer,
// designers), each tagged with the plain-English role this app shows
// rather than Wikidata's own property label ("designed by" reads as a
// verb phrase, not a job title). Director (P57) is deliberately NOT
// here — it already has its own line in the header, so repeating it in
// Crew would just be the same fact twice under a different tab.
const CREW_PROPS = { P58: 'Writer', P86: 'Composer', P287: 'Designer', P162: 'Producer' };

// One row per (person, role) via UNION rather than piling more OPTIONALs
// onto fetchWikidataCredits above — OPTIONALs at the same level
// cross-multiply when more than one is multi-valued (a game with 2
// writers and 2 designers would come back as 4 rows of nonsense
// combinations), UNION doesn't have that problem.
async function fetchWikidataCrew(qid) {
  const clauses = Object.keys(CREW_PROPS)
    .map((p) => `{ wd:${qid} wdt:${p} ?person . BIND(wd:${p} as ?role) }`)
    .join(' UNION ');
  const data = await wikidataQuery(`
    SELECT ?person ?personLabel ?personImage ?role WHERE {
      ${clauses}
      OPTIONAL { ?person wdt:P18 ?personImage. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 60`);

  const crewMap = new Map();
  for (const row of data.results.bindings) {
    if (!row.person || !row.personLabel) continue;
    // An item with no English label at all comes back with the raw QID
    // as its own "label" — not a name worth showing.
    if (/^Q\d+$/.test(row.personLabel.value)) continue;
    const personQid = row.person.value.split('/').pop();
    const propId = row.role.value.split('/').pop();
    if (!crewMap.has(personQid)) {
      crewMap.set(personQid, {
        qid: personQid,
        name: row.personLabel.value,
        photo: commonsThumb(row.personImage?.value),
        roles: new Set(),
      });
    }
    const entry = crewMap.get(personQid);
    if (!entry.photo) entry.photo = commonsThumb(row.personImage?.value);
    entry.roles.add(CREW_PROPS[propId] || 'Crew');
  }
  return [...crewMap.values()].map((c) => ({ qid: c.qid, name: c.name, photo: c.photo, role: [...c.roles].join(', ') }));
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

// The "Similar games" rail. IGDB's own `similar_games` field is a bare
// list of ids curated by IGDB itself (shared genre/theme/tags) — two
// calls: the id list off this game, then one batch fetch for their
// titles/covers/years. Neither call is cached on the row (unlike
// Studios/credits) since the whole point is that it can change as IGDB's
// own graph is edited; it's cheap enough to just ask fresh each visit.
export async function getSimilarGames(igdbId, limit = 10) {
  if (!igdbId) return [];
  try {
    const [detail] = await igdb('games', `fields similar_games; where id = ${igdbId};`);
    const ids = (detail?.similar_games || []).slice(0, limit);
    if (!ids.length) return [];
    const games = await igdb('games', `fields name,cover.image_id,first_release_date; where id = (${ids.join(',')}) & cover != null;`);
    // IGDB doesn't promise the batch comes back in id order — reorder to
    // match similar_games, which IS meaningfully ordered (most-similar
    // first), so the rail isn't shuffled every load.
    const byId = new Map(games.map((g) => [g.id, g]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map((g) => ({
      igdb_id: g.id, title: g.name, cover_url: igdbImageUrl(g.cover?.image_id, '1080p'),
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
    }));
  } catch {
    return [];
  }
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
  const { data, error } = await supabase.from('games').select('*')
    .not('is_hidden', 'is', true)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------
// LOGS (diary entries / reviews)
// ------------------------------------------------------------
// One entry per game per person — except replays, which are the whole
// reason the schema allows more than one.
//
// This used to be a bare insert, and that was the bug behind a game
// showing up in two places at once: adding Alan Wake to the backlog and
// later marking it played wrote a SECOND row, so the profile listed it
// under Backlog and under Diary simultaneously, the game page's own
// status bar picked whichever row it happened to read first, and
// "currently playing" never cleared when you finally logged the thing.
// Every screen was reporting honestly; there really were two rows.
//
// Fixed here rather than at each call site on purpose. There are five
// places that create a log (the log sheet, the game page's status and
// rating controls, the feed's double-tap-to-backlog, the profile's
// "start playing"), and a rule enforced in five places is a rule that
// holds in four of them a month from now.
// Fired after anything that changes a diary entry. Two listeners, for
// two different kinds of staleness: the view cache holds rendered
// markup with a game's status baked into it, and profile-view keeps its
// own bundle of fetched rows. An event rather than a direct call for
// the second one — api.js importing a view would be a circular import,
// since every view already imports api.js.
function noteLogChanged() {
  invalidateLogViews();
  try { window.dispatchEvent(new CustomEvent('logs:changed')); } catch { /* not in a browser */ }
}

export async function createLog(log) {
  // A replay is explicitly a new row: playing something a second time
  // is a separate entry in the diary, which is what is_replay means.
  if (!log.is_replay && log.user_id && log.game_id) {
    const { data: existing } = await supabase
      .from('logs')
      .select('id')
      .eq('user_id', log.user_id)
      .eq('game_id', log.game_id)
      // is_replay is nullable, and PostgREST's neq drops NULLs the way
      // SQL does (NULL != true is NULL, not true) — which would miss
      // exactly the older rows most likely to be duplicated.
      .or('is_replay.is.null,is_replay.eq.false')
      .order('created_at', { ascending: true })
      .limit(1);
    const prior = existing?.[0];
    // Update the row that is already there, so the game MOVES between
    // backlog / playing / played instead of accumulating.
    if (prior) return updateLog(prior.id, log);
  }
  const { data, error } = await supabase.from('logs').insert(log).select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)').single();
  if (error) throw error;
  noteLogChanged();
  return data;
}

export async function updateLog(logId, updates) {
  const { data, error } = await supabase.from('logs').update(updates).eq('id', logId).select('*, games!logs_game_id_fkey(*), profiles!logs_user_id_fkey(*)').single();
  if (error) throw error;
  noteLogChanged();
  return data;
}

export async function deleteLog(logId) {
  const { error } = await supabase.from('logs').delete().eq('id', logId);
  if (error) throw error;
  noteLogChanged();
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
    // updated_at, not created_at: marking an existing log as "playing"
    // is an UPDATE on a row that may have been created long ago (e.g. a
    // backlog entry someone finally started), so created_at wouldn't
    // move — updated_at does (there's a DB trigger keeping it current
    // on every row change), which is what actually reflects "just
    // started playing this" for the getFeed(..., 'playing') callers.
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(limit);
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
  // updated_at — see the same ordering note in the fallback branch above.
  const { data, error } = await q.order('updated_at', { ascending: false }).limit(limit);
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
// Bulk reply counts for a list of logs — the same shape/tradeoff as
// getLikesForLogs above, one query instead of one per card.
export async function getCommentCountsForLogs(logIds) {
  const counts = {};
  logIds.forEach((id) => (counts[id] = 0));
  if (!logIds.length) return counts;
  const { data, error } = await supabase.from('comments').select('log_id').in('log_id', logIds);
  if (error) throw error;
  for (const row of data) counts[row.log_id] = (counts[row.log_id] || 0) + 1;
  return counts;
}

/**
 * Every comment on a review, oldest first, with the pinned one lifted to
 * the top.
 *
 * `ownerId` is the person whose review it is, and it decides who sees a
 * RESTRICTED comment: its author (so they never learn they were
 * restricted — the whole point of the feature) and the review's owner
 * (who did the restricting), nobody else.
 *
 * A DELETED comment is still returned. It renders as a tombstone rather
 * than disappearing, because a comment that simply vanishes leaves the
 * replies under it reading as non-sequiturs.
 */
export async function getComments(logId, { ownerId = null } = {}) {
  const { data, error } = await supabase
    .from('comments')
    .select('*, profiles!comments_user_id_fkey(*)')
    .eq('log_id', logId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const { data: { user } } = await supabase.auth.getUser();
  const me = user?.id || null;
  const rows = (data || []).filter((c) => {
    if (!c.restricted_at) return true;
    return me && (me === c.user_id || me === ownerId);
  });

  const visible = await filterBlocked(rows); // hide comments from people you've blocked
  // Pinned first, and the rest left in the order they were written.
  return visible.sort((x, y) => (y.pinned_at ? 1 : 0) - (x.pinned_at ? 1 : 0));
}

/**
 * Take a comment back. An UPDATE, not a DELETE — see the tombstone note
 * on getComments.
 *
 * Falls back to a real delete if the column is not there yet, so the app
 * keeps working on a database that has not had
 * migrations/2026-09-21_comment_moderation.sql run against it.
 */
export async function deleteComment(id) {
  const { error } = await supabase
    .from('comments')
    .update({ deleted_at: new Date().toISOString(), body: '[deleted]' })
    .eq('id', id);
  if (!error) return;
  if (!isMissingColumn(error)) throw error;
  const { error: hardErr } = await supabase.from('comments').delete().eq('id', id);
  if (hardErr) throw hardErr;
}

// Both of these are the review owner's to use, enforced by the update
// policy in that same migration rather than by asking nicely here.
export async function pinComment(id, logId, on) {
  if (on) {
    // One pin per review — clear the old one first, since the unique
    // index would otherwise reject the new one.
    await supabase.from('comments').update({ pinned_at: null }).eq('log_id', logId).not('pinned_at', 'is', null);
  }
  const { error } = await supabase
    .from('comments')
    .update({ pinned_at: on ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw needsMigration(error);
}

export async function restrictComment(id, on) {
  const { error } = await supabase
    .from('comments')
    .update({ restricted_at: on ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw needsMigration(error);
}

// PostgREST says PGRST204 for a column it does not know about, and
// Postgres says 42703. Either one here means the migration has not been
// run, which is worth saying plainly rather than showing the raw error.
function isMissingColumn(error) {
  return error?.code === 'PGRST204' || error?.code === '42703'
    || /column .* does not exist/i.test(error?.message || '');
}
function needsMigration(error) {
  return isMissingColumn(error)
    ? new Error('Run migrations/2026-09-21_comment_moderation.sql in Supabase first.')
    : error;
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
  is_group, title, created_by, avatar_url, description,
  last_message_at, last_message_body, last_message_kind, last_message_sender_id,
  user_one_last_read_at, user_two_last_read_at, created_at,
  user_one:profiles!conversations_user_one_id_fkey(id, username, display_name, avatar_url),
  user_two:profiles!conversations_user_two_id_fkey(id, username, display_name, avatar_url),
  participants:conversation_participants(user_id, profile:profiles(id, username, display_name, avatar_url))
`;

// Shapes a raw conversation row (which has both participants) into one
// with `.other` (whichever of the two isn't me) and `.unread` already
// worked out, so every view that lists conversations does this exactly
// the same way instead of repeating the same three-way ternary each time.
function shapeConversation(row, userId, groupLastRead) {
  // A group: members come from conversation_participants; there's no single
  // "other" person, so `.members`/`.others` carry the roster and `.other`
  // is just the first non-me member (handy for a fallback avatar). My read
  // marker is my participant row's last_read_at, passed in from the caller.
  if (row.is_group) {
    const members = (row.participants || []).map((p) => p.profile).filter(Boolean);
    const others = members.filter((m) => m.id !== userId);
    const unread = !!row.last_message_sender_id
      && row.last_message_sender_id !== userId
      && (!groupLastRead || new Date(row.last_message_at) > new Date(groupLastRead));
    return { ...row, isGroup: true, members, others, other: others[0] || null, unread };
  }
  const iAmOne = row.user_one_id === userId;
  const myLastRead = iAmOne ? row.user_one_last_read_at : row.user_two_last_read_at;
  const unread = !!row.last_message_sender_id
    && row.last_message_sender_id !== userId
    && (!myLastRead || new Date(row.last_message_at) > new Date(myLastRead));
  return { ...row, isGroup: false, other: iAmOne ? row.user_two : row.user_one, unread };
}

// Every conversation the signed-in user is part of, newest activity
// first. One query powers both the inbox and the Requests tab — the
// caller splits on `.status`/`.requested_by`, since a conversation with
// no messages yet (last_message_at is null) still needs to sort
// somewhere and "newest first, nulls last" is what nullsFirst:false does.
export async function getConversations(userId) {
  // DMs are found by the pair columns; groups by my membership row (which
  // also carries my own read marker). Two queries, merged + de-duped, since
  // PostgREST can't OR a pair-column match with an id-in-subquery in one go.
  const { data: parts, error: pErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', userId);
  if (pErr) throw pErr;
  const groupRead = {};
  const groupIds = [];
  for (const p of parts || []) { groupIds.push(p.conversation_id); groupRead[p.conversation_id] = p.last_read_at; }

  const queries = [
    supabase.from('conversations').select(CONVO_SELECT).or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`),
  ];
  if (groupIds.length) queries.push(supabase.from('conversations').select(CONVO_SELECT).in('id', groupIds));
  const results = await Promise.all(queries);
  for (const r of results) if (r.error) throw r.error;

  const seen = new Set();
  const rows = [];
  for (const r of results) for (const row of r.data || []) {
    if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
  }
  rows.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
  return rows.map((row) => shapeConversation(row, userId, groupRead[row.id]));
}

// Create a group chat: an is_group conversation whose members (creator +
// the picked people) go into conversation_participants. Returns the id.
export async function createGroup(creatorId, memberIds, title) {
  // Generate the id on the client and insert WITHOUT a returning `.select()`:
  // a fresh group has no members yet and no user_one/two, so `INSERT ...
  // RETURNING` would fail the SELECT policy (Postgres requires the returned
  // row to be SELECT-able) and surface as an RLS violation. No read-back =
  // no such problem; the WITH CHECK on the insert itself passes fine.
  const convoId = crypto.randomUUID();
  const { error } = await supabase
    .from('conversations')
    .insert({ id: convoId, is_group: true, title: (title || '').trim() || null, created_by: creatorId, requested_by: creatorId });
  if (error) throw error;
  const ids = Array.from(new Set([creatorId, ...memberIds]));
  const { error: pErr } = await supabase
    .from('conversation_participants')
    .insert(ids.map((uid) => ({ conversation_id: convoId, user_id: uid })));
  if (pErr) throw pErr;
  return convoId;
}

// Add people to an existing group. RLS only lets the group's creator do
// this (or a user add themselves); upsert so re-adding an existing member
// is a no-op rather than an error.
export async function addGroupMembers(conversationId, memberIds) {
  if (!memberIds || !memberIds.length) return;
  const { error } = await supabase
    .from('conversation_participants')
    .upsert(memberIds.map((uid) => ({ conversation_id: conversationId, user_id: uid })), { onConflict: 'conversation_id,user_id' });
  if (error) throw error;
}

// Leave a group (just removes your own membership row).
export async function leaveGroup(conversationId, userId) {
  const { error } = await supabase
    .from('conversation_participants')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
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

// ---- per-chat prefs (pin / mute / nickname) --------------------------
// Backed by conversation_prefs in 2026-09-03_messenger_prefs_moderation.sql.
// (Blocking + reporting already exist above — blockUser / getBlockedIds /
// reportContent — so the inbox menu reuses those, not new copies.)

// { conversationId: { pinned, muted, nickname } } for the whole inbox.
export async function getConversationPrefs(userId) {
  const { data, error } = await supabase
    .from('conversation_prefs')
    .select('conversation_id, pinned, muted, nickname, unread, restricted')
    .eq('user_id', userId);
  if (error) throw error;
  const out = {};
  for (const r of data) out[r.conversation_id] = { pinned: r.pinned, muted: r.muted, nickname: r.nickname, unread: r.unread, restricted: r.restricted };
  return out;
}

// Profiles for a set of ids, in one query — used by the Settings block/
// restrict lists.
export async function getProfilesByIds(ids) {
  if (!ids || !ids.length) return [];
  const { data, error } = await supabase.from('profiles')
    .select('id, username, display_name, avatar_url').in('id', ids);
  if (error) throw error;
  return data || [];
}

// The people you've restricted, each with the other participant shaped in —
// for the Settings "Restricted accounts" list.
export async function getRestrictedUsers(userId) {
  const { data: prefRows, error } = await supabase
    .from('conversation_prefs').select('conversation_id')
    .eq('user_id', userId).eq('restricted', true);
  if (error) throw error;
  const ids = (prefRows || []).map((r) => r.conversation_id);
  if (!ids.length) return [];
  const { data: convos, error: cErr } = await supabase
    .from('conversations').select(CONVO_SELECT).in('id', ids);
  if (cErr) throw cErr;
  return (convos || []).map((c) => ({ conversationId: c.id, other: shapeConversation(c, userId).other }));
}

// Upsert a subset of one chat's prefs — patch is any of {pinned, muted, nickname}.
export async function setConversationPref(userId, conversationId, patch) {
  const { error } = await supabase
    .from('conversation_prefs')
    .upsert({ user_id: userId, conversation_id: conversationId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,conversation_id' });
  if (error) throw error;
}

// The mirror of markConversationRead — bumps this chat back to unread.
export async function markConversationUnread(conversationId) {
  const { error } = await supabase.rpc('mark_conversation_unread', { p_conversation_id: conversationId });
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
    // Group membership: fires when I'm added to (or removed from) a group,
    // so a brand-new group shows up in the inbox without a manual refresh.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ------------------------------------------------------------
// CONNECTED ACCOUNTS (Steam, PSN, Xbox libraries — see
// migrations/2026-09-09_connected_accounts.sql)
// ------------------------------------------------------------

export async function getConnectedAccounts(userId) {
  const { data, error } = await supabase.from('connected_accounts').select('*').eq('user_id', userId);
  if (error) throw error;
  return data;
}

// Newest-played first — the same ordering a real "recently played"
// shelf would use, and the one people actually scan for when they open
// their own imported library.
export async function getImportedGames(userId, { limit = 200 } = {}) {
  const { data, error } = await supabase
    .from('imported_games')
    .select('*, games(*)')
    .eq('user_id', userId)
    .order('playtime_minutes', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function psnProxy(body, timeout = 40000) {
  // Nothing like the file's usual 3.5s default — a cold PSN proxy call
  // is a real multi-hop OAuth exchange (NPSSO -> code -> access token,
  // THEN the actual search/library request) on top of a cold Supabase
  // Edge Function start, not one simple query the way IGDB calls here
  // are. This was 12s and a cold start blew straight through it, which
  // failed the connect AFTER the account row had been written — leaving
  // a linked account with an empty library. The completions action needs
  // longer still: it reads the trophy list of every played title, two
  // requests apiece.
  const res = await fetchWithTimeout(PSN_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  }, timeout);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'PlayStation lookup failed.');
  return data;
}

// Best-effort match against the local catalogue: an exact (case-
// insensitive) title hit first, since that's free and instant; failing
// that, one IGDB search, but only trusted when a result's title matches
// closely enough to actually be confident — PSN's own titles carry
// trademark symbols and edition suffixes IGDB's don't, so this compares
// through the same normalizeTitle() search ranking already uses above,
// not the raw strings. A plausible-but-not-confident IGDB result is
// worse than no match: it would silently mislabel someone's playtime
// as the wrong game.
// PSN names carry platform and edition baggage the catalogue doesn't:
// "Grand Theft Auto V (PlayStation®5)", "My Friend Peppa Pig: Complete
// Edition", "The Stanley Parable: Ultra Deluxe". Each of those failed to
// match anything and so never made it into a diary, despite being
// finished games. Dropping the suffix is only ever a SECOND attempt —
// the full name is always tried first, so a game genuinely called
// "…Remastered" still wins its own exact match.
function buildTitleAttempts(name) {
  const out = [];
  const push = (v) => {
    const t = String(v || '').replace(/\s{2,}/g, ' ').replace(/[\s:\-–—&]+$/, '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  // The full name always goes first, so a game that genuinely owns a
  // word this strips ("Alan Wake Remastered") still wins its own match
  // before any of the loosened shapes get a turn.
  push(name);

  // ™ ® © become SPACES, never nothing: PSN writes "FAR CRY®6", and
  // deleting the symbol leaves "FAR CRY6", which matches nothing.
  const noMarks = String(name).replace(/[\u2122\u00ae\u00a9]/g, ' ');
  push(noMarks);

  // Console names PSN bakes into the title itself — "(PlayStation®5)",
  // "PS4 & PS5", "MotoGP™23 PS4 & PS5".
  const noPlatform = noMarks
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(ps4|ps5|playstation\s*[45]?)\b(\s*(&|and|\/)\s*\b(ps4|ps5|playstation\s*[45]?)\b)*/gi, ' ')
    .replace(/\bfor\s+(ps4|ps5)\b/gi, ' ');
  push(noPlatform);

  // PSN's own trophy-set naming: "Copycat Trophy Set", "MultiVersus Trophies".
  const noTrophySet = noPlatform.replace(/\b(trophy\s*set|trophies)\b\s*$/i, ' ');
  push(noTrophySet);

  // Publisher labels the catalogue doesn't carry: "EA SPORTS™ NHL® 24".
  const noPublisher = noTrophySet
    .replace(/^\s*(ea\s+sports|ea\s+originals|2k|wb\s+games|square\s+enix|bandai\s+namco|nis\s+america)\b[\s:\-–—]*/i, ' ');
  push(noPublisher);

  // Storefront noise that isn't part of the name.
  const noShelf = noPublisher.replace(/[\s:\-–—]*\b(early access(?: version)?|standard|bundle)\b\s*$/i, ' ');
  push(noShelf);

  // A licensing prefix is not the title: "Disney•Pixar Wall-E" is filed
  // as "WALL-E". Only these studio names, and only at the very front, so
  // a game that genuinely owns its brand ("Marvel's Spider-Man") keeps it.
  const noBrand = noShelf.replace(/^\s*(?:(?:disney|pixar|dreamworks|lucasfilm|nickelodeon|hasbro|mattel)[\s\u2022:\-]+)+/i, '');
  push(noBrand);

  // Edition / remaster words go LAST of all, since dropping them is the
  // loosest thing here and must never pre-empt an exact hit.
  const noEdition = noBrand
    .replace(/[:\-–—]\s*(?:the\s+)?(?:\S+\s+){0,2}edition\b/gi, ' ')
    .replace(/[:\-–—]?\s*\b(remastered|remake|reforged|redux|director'?s cut|ultra deluxe|game of the year|goty)\b/gi, ' ');
  push(noEdition);

  return out;
}

// Matching used to fire every title's IGDB search at once. On a
// 141-game library that's a stampede of hundreds of parallel requests:
// the proxy throttles, individual searches time out, and each timeout is
// swallowed as "no match" — so games as ordinary as The Last of Us Part I
// and Far Cry 6 silently ended up with no game page and never reached a
// diary. Six at a time is slower in name only; nothing is being dropped
// on the floor and retried any more. Ten is the sweet spot found by
// testing: fast, and still nowhere near the level that made the proxy
// start shedding requests.
async function mapWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ---- picking the RIGHT game, not just a same-named one ----
//
// Three real failures drove this, all from taking the first title that
// happened to match:
//   "Grand Theft Auto III – The Definitive Edition" -> the 2001 original
//   "Demon's Souls" on PS5                          -> the 2009 PS3 game
//   "Destroy All Humans!" on PS4                    -> the 2005 original
// So candidates are gathered and scored rather than raced, using the two
// signals PSN hands over for free: which console the title is for, and
// when it was first played.

// Edition/remaster words as a comparable SET, so "GTA III – The
// Definitive Edition" and "Grand Theft Auto III: The Definitive Edition"
// agree while the plain 2001 original does not.
const EDITION_MARKERS = [
  'definitive', 'remastered', 'remaster', 'remake', 'redux', 'reforged',
  'anniversary', 'enhanced', 'complete', 'deluxe', 'ultimate', 'legendary',
  'goty', 'game of the year', 'directors cut', 'ultra deluxe', 'hd',
];
function editionSignature(title) {
  const t = normalizeTitle(title);
  return EDITION_MARKERS.filter((m) => t.includes(m)).sort().join('|');
}

// A console can't play a game that didn't exist yet, so a title's
// platform puts a floor under which release years are plausible. This is
// only ever a TIE-BREAKER between same-named candidates — never a filter
// — because PS4 and PS5 both happily run re-releases of much older games
// (Sly 2 on PS4 really is the 2004 game, and should stay that way).
const PLATFORM_FLOOR = { ps5: 2020, ps4: 2013, ps3: 2006, psvita: 2011 };
function platformFloor(entry) {
  const hay = `${entry.category || ''} ${entry.platform || ''}`.toLowerCase();
  if (hay.includes('ps5')) return PLATFORM_FLOOR.ps5;
  if (hay.includes('ps4')) return PLATFORM_FLOOR.ps4;
  if (hay.includes('vita')) return PLATFORM_FLOOR.psvita;
  if (hay.includes('ps3')) return PLATFORM_FLOOR.ps3;
  return 0;
}

function candidateYear(g) {
  return Number(g.release_year) || (g.release_date ? new Date(g.release_date).getFullYear() : 0);
}

function scoreCandidate(game, entry, searchedTitle) {
  const wantEdition = editionSignature(entry.name);
  const gotEdition = editionSignature(game.title);
  const year = candidateYear(game);

  // Nobody played a game before it came out. A year of slack absorbs
  // regional release dates and PSN's own coarse timestamps.
  const playedYear = entry.firstPlayedAt ? new Date(entry.firstPlayedAt).getFullYear() : 0;
  if (playedYear && year && year > playedYear + 1) return null;

  let score = 0;
  if (normalizeTitle(game.title) === normalizeTitle(entry.name)) score += 100;
  else if (normalizeTitle(game.title) === normalizeTitle(searchedTitle)) score += 60;
  // Getting the edition right matters more than anything below it: the
  // Definitive Edition and the original are genuinely different entries.
  if (wantEdition === gotEdition) score += 50;
  else if (wantEdition && !gotEdition) score -= 40;
  else if (!wantEdition && gotEdition) score -= 25;
  if (year >= platformFloor(entry)) score += 20;
  return { game, score, year };
}

function bestCandidate(games, entry, searchedTitle) {
  const scored = games.map((g) => scoreCandidate(g, entry, searchedTitle)).filter(Boolean);
  if (!scored.length) return null;
  // Newest wins ties, so a remake beats the original it's named after
  // once both are equally plausible for the console in hand.
  scored.sort((a, b) => (b.score - a.score) || (b.year - a.year));
  return scored[0].score > 0 ? scored[0].game : null;
}

// PSN ships a separate entry per console SKU, so one game can arrive two
// or three times under the exact same name — "The Last of Us™ Part II"
// appeared three times on one real account, and the library showed it
// three times. Once they've resolved to the same game page they're the
// same game, so they're folded into one: hours added together (you did
// play it on both), earliest first-played, latest last-played. Entries
// that matched nothing can't be compared this way and are folded by name
// instead. The surviving platform_game_id is the lowest one, so a
// re-sync keeps landing on the same row rather than making a new one.
function collapseDuplicateImports(entries, matches) {
  const groups = new Map();
  entries.forEach((entry, i) => {
    const game = matches[i] || null;
    const key = game ? `game:${game.id}` : `name:${normalizeTitle(entry.name)}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...entry, game });
      return;
    }
    existing.playtimeMinutes += entry.playtimeMinutes || 0;
    // Played on both consoles — the shelf should say so rather than
    // silently keeping whichever import happened to land first.
    if (entry.platform && existing.platform !== entry.platform) {
      const both = new Set([...(existing.platform || '').split(' · '), ...entry.platform.split(' · ')]);
      existing.platform = [...both].filter(Boolean).sort().join(' · ');
    } else if (entry.platform && !existing.platform) {
      existing.platform = entry.platform;
    }
    if (entry.platformGameId < existing.platformGameId) {
      existing.platformGameId = entry.platformGameId;
      existing.name = entry.name;
    }
    if (entry.lastPlayedAt && (!existing.lastPlayedAt || entry.lastPlayedAt > existing.lastPlayedAt)) {
      existing.lastPlayedAt = entry.lastPlayedAt;
    }
    if (entry.firstPlayedAt && (!existing.firstPlayedAt || entry.firstPlayedAt < existing.firstPlayedAt)) {
      existing.firstPlayedAt = entry.firstPlayedAt;
    }
  });
  return [...groups.values()];
}

// How many of the title shapes above are worth an IGDB search. The
// catalogue is checked for ALL of them first — that's a cheap indexed
// query — but IGDB is a shared proxy, and searching every shape of every
// title turned a 90-game import into hundreds of requests, which the
// proxy throttled until the whole connect stalled. First shape plus the
// last few covers essentially every real recovery.
const IGDB_ATTEMPT_LIMIT = 4;

async function matchImportedTitle(entry, addedBy) {
  const attempts = buildTitleAttempts(entry.name);

  // Catalogue first, in order, most specific shape to loosest — so a
  // game already known by its full name never gets resolved by a
  // stripped-down one. Every same-named row is fetched, not just the
  // first the database hands back: that arbitrary pick is what chose
  // 2009's Demon's Souls over the 2020 remake.
  for (const title of attempts) {
    const { data: local } = await supabase.from('games').select('*').ilike('title', title).limit(10);
    const localHit = local?.length ? bestCandidate(local, entry, title) : null;
    if (localHit) return localHit;
  }

  const searchable = attempts.length > IGDB_ATTEMPT_LIMIT
    ? [attempts[0], ...attempts.slice(-(IGDB_ATTEMPT_LIMIT - 1))]
    : attempts;
  for (const title of searchable) {
    try {
      const results = await searchIgdb(title, 10, 1, { includeEditions: true });
      const hit = bestCandidate(results, entry, title);
      if (hit) return await addGame(hit, addedBy);
    } catch { /* IGDB down or no match — try the next shape, then give up */ }
  }
  return null;
}

// The whole "Connect PlayStation" action: resolve the typed online ID
// to an account, fetch its library, upsert the link and every title.
// Returns a small summary the UI can show directly rather than the raw
// rows — how many titles came in and how many actually matched a game
// in the catalogue, since "matched" is the number someone actually
// cares about seeing after they connect.
export async function connectPsnAccount(userId, onlineId) {
  const resolved = await psnProxy({ action: 'resolve', onlineId });
  if (!resolved.accountId) {
    throw new Error(`Couldn't find a PSN account called "${onlineId}" — check the exact online ID and try again.`);
  }

  const { data: account, error: acctErr } = await supabase
    .from('connected_accounts')
    .upsert({
      user_id: userId, platform: 'psn', platform_id: resolved.accountId,
      handle: resolved.onlineId || onlineId, avatar_url: resolved.avatarUrl || null,
      library_visibility: 'public', last_synced_at: new Date().toISOString(), last_sync_error: null,
    }, { onConflict: 'user_id,platform' })
    .select().single();
  if (acctErr) throw acctErr;

  // PSN answers "what have you played?" two different ways and NEITHER
  // is complete on its own. The played-games list carries real playtime
  // but only reaches back so far — for one real account it was missing
  // 22 games the player had demonstrably finished, Uncharted 2/3/4 and
  // Jak II/3 among them. The trophy list reaches much further back but
  // has no playtime at all. So both are read and merged: playtime where
  // PSN knows it, and nothing left out because only one list mentioned
  // it.
  const [libraryRes, trophyRes] = await Promise.all([
    psnProxy({ action: 'library', accountId: resolved.accountId }),
    psnProxy({ action: 'completions', accountId: resolved.accountId }, 120000)
      .catch(() => ({ titles: [] })), // library still imports if trophies are unhappy
  ]);
  const played = libraryRes.titles || [];
  const trophyTitles = trophyRes.titles || [];

  const entries = played.map((t) => ({
    platformGameId: t.platformGameId, name: t.name,
    playtimeMinutes: t.playtimeMinutes, lastPlayedAt: t.lastPlayedAt,
    category: t.category || null, firstPlayedAt: t.firstPlayedAt || null,
    platform: t.platform || null,
  }));
  const known = buildTitleIndex(entries, (e) => e.name);
  for (const t of trophyTitles) {
    if (known.find(t.name)) continue;
    // A trophy set PSN's played list never mentioned. There's no
    // playtime to report for these, which is honest — PSN doesn't know
    // it either — but the game was unquestionably played.
    entries.push({
      platformGameId: `trophy:${t.id}`, name: t.name,
      playtimeMinutes: 0, lastPlayedAt: t.completedAt || null,
      category: null, platform: t.platform || null, firstPlayedAt: null,
    });
  }

  const matches = await mapWithLimit(entries, 8, (e) => matchImportedTitle(e, userId).catch(() => null));

  const rows = collapseDuplicateImports(entries, matches).map((t) => ({
    account_id: account.id, user_id: userId,
    platform_game_id: t.platformGameId, name: t.name,
    playtime_minutes: t.playtimeMinutes, last_played_at: t.lastPlayedAt,
    platform_label: t.platform || null,
    game_id: t.game?.id || null, match_state: t.game ? 'matched' : 'unmatched',
  }));
  if (rows.length) {
    const { error: rowsErr } = await supabase.from('imported_games').upsert(rows, { onConflict: 'account_id,platform_game_id' });
    if (rowsErr) throw rowsErr;

    // A sync should leave the library mirroring PSN, so anything that
    // didn't come back this time is dropped. Without this, the duplicate
    // console SKUs that are now folded together would sit there forever
    // on accounts that synced before the folding existed — upserting new
    // rows never removes the old ones.
    const keep = new Set(rows.map((r) => r.platform_game_id));
    const { data: present } = await supabase
      .from('imported_games').select('id, platform_game_id').eq('account_id', account.id);
    const stale = (present || []).filter((r) => !keep.has(r.platform_game_id)).map((r) => r.id);
    if (stale.length) await supabase.from('imported_games').delete().in('id', stale);
  }

  // Working out what to put in the diary is a bonus pass, not part of
  // the import: if it fails, the library still connected and that
  // shouldn't read as a failure. Nothing is written here — the caller
  // shows these for approval first.
  let candidates = [];
  try {
    candidates = await psnDiaryCandidates(userId, trophyTitles);
  } catch { /* library is in; the next sync can offer them again */ }

  // Counted off the collapsed rows, not the raw entries. Counting
  // matches before the duplicate-fold and the total after it produced
  // "91 of 89 games matched".
  return { total: rows.length, matched: rows.filter((r) => r.game_id).length, candidates };
}

// Trophy sets and the played-games list name the same game differently:
// "Marvel's Spider-Man Remastered" in trophies is "Marvel's Spider-Man"
// in the library, "Grand Theft Auto V" is "Grand Theft Auto V
// (PlayStation®5)", and trophy sets for service games get a literal
// "Trophies" suffix. So matching goes exact-first and only falls back to
// this looser key, which drops platform parentheticals and edition
// words. Looseness cuts both ways, so a key two different games share
// ("Little Nightmares" and "Little Nightmares II" both reduce to the
// same thing once "II" survives but the edition words don't) is thrown
// away rather than guessed at.
function looseTitleKey(name) {
  return normalizeTitle(String(name || '').replace(/\([^)]*\)/g, ' '))
    .replace(/\b(trophy set|trophies|remastered|remake|reforged|definitive|complete|deluxe|ultimate|standard|game of the year|goty|directors cut|edition)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTitleIndex(rows, nameOf) {
  const exact = new Map();
  const loose = new Map();
  for (const row of rows) {
    const name = nameOf(row);
    if (!exact.has(normalizeTitle(name))) exact.set(normalizeTitle(name), row);
    const key = looseTitleKey(name);
    if (!key) continue;
    loose.set(key, loose.has(key) ? null : row); // null = ambiguous, never used
  }
  return {
    find(name) {
      return exact.get(normalizeTitle(name)) || loose.get(looseTitleKey(name)) || null;
    },
  };
}

// Reads the trophy data for a connected account and writes a diary
// entry for every game it can tell was actually FINISHED — platinum,
// every trophy, or a "complete the story" trophy (the proxy does that
// detection; see its comments for how). Dated by when the trophy was
// earned, with the hours PSN recorded, because that's the whole point:
// a shelf of games you finished years ago shouldn't need re-logging by
// hand.
//
// Two things it will never do: touch a game you have already logged
// yourself, and log the same import twice — imported_games.auto_logged_at
// records that a row has had its turn, so deleting an auto-created entry
// makes it stay deleted through the next re-sync.
// Everything the trophy pass thinks is worth putting in the diary,
// handed back for the person to approve rather than written behind
// their back. Only games that matched a game page can be offered (there
// is nothing to link a diary entry to otherwise), and only ones they
// haven't already logged themselves or previously decided about.
//
// A game that ISN'T finished is never suggested as "played" — claiming
// a completion the player didn't earn is the one thing this must never
// do. It's offered as Playing or Backlog instead, and left unticked.
// Nothing is guessed at any more. The import used to decide a status for
// you — played, playing, or backlog — and got it wrong often enough to be
// worse than useless: it filled "Currently playing" with games nobody had
// touched in years. Every pick is now simply `played`, and the sheet says
// plainly that you should only tick what you actually finished. The app
// stops guessing; the person decides.

export async function psnDiaryCandidates(userId, trophyTitles) {
  const { data: rows, error } = await supabase
    .from('imported_games')
    .select('id, name, game_id, playtime_minutes, last_played_at, platform_label, games(id, title, cover_url)')
    .eq('user_id', userId)
    .not('game_id', 'is', null)
    .is('auto_logged_at', null);
  if (error) throw error;
  if (!rows?.length) return [];

  const completedByRow = new Map();
  const index = buildTitleIndex(rows, (r) => r.name);
  for (const t of (trophyTitles || [])) {
    if (!t.completed || !t.completedAt) continue;
    const row = index.find(t.name);
    if (row && !completedByRow.has(row.id)) completedByRow.set(row.id, t);
  }

  // Anything already in the diary is left exactly as it is — an import
  // must never overwrite or duplicate what someone wrote themselves.
  const { data: existing, error: exErr } = await supabase
    .from('logs').select('game_id').eq('user_id', userId)
    .in('game_id', rows.map((r) => r.game_id));
  if (exErr) throw exErr;
  const alreadyLogged = new Set((existing || []).map((l) => l.game_id));

  return rows
    .filter((r) => r.games && !alreadyLogged.has(r.game_id))
    .map((r) => {
      const done = completedByRow.get(r.id);
      return {
        importedGameId: r.id,
        gameId: r.game_id,
        title: r.games.title,
        coverUrl: r.games.cover_url,
        completed: !!done,
        // logs.hours_played is numeric(6,1) capped at 20000 by a check
        // constraint — a stray huge value would fail the whole insert.
        hours: r.playtime_minutes > 0 ? Math.min(20000, Math.round(r.playtime_minutes / 6) / 10) : null,
        platform: r.platform_label || null,
        // A finished game is dated by the trophy that proves it; anything
        // else by when PSN last saw it played.
        playedDate: done ? String(done.completedAt).slice(0, 10)
          : (r.last_played_at ? String(r.last_played_at).slice(0, 10) : null),
      };
    })
    // Finished games first, then most played within each group — the
    // useful question in both lists is how much of your life a game
    // actually took, so the biggest sits at the top and it tails off
    // from there. Dates only break ties and, compared as '' when absent,
    // sort last rather than first (the raw values put the string "null"
    // above every real date, which floated the emptiest entries to the
    // top of the list).
    .sort((a, b) => (b.completed - a.completed)
      || ((b.hours || 0) - (a.hours || 0))
      || (b.playedDate || '').localeCompare(a.playedDate || ''));
}

// Writes the picks, then marks which imports have been dealt with.
// Finished games are marked either way — ticked or deliberately left
// out, the person has decided about them and shouldn't be asked again.
// Unfinished ones are NOT marked: they may well be finished later, and
// that's exactly when they become worth offering.
export async function applyPsnDiaryPicks(userId, chosen, offered) {
  if (chosen.length) {
    const { error } = await supabase.from('logs').insert(chosen.map((c) => ({
      game_id: c.gameId,
      user_id: userId,
      status: 'played',
      played_date: c.playedDate,
      hours_played: c.hours,
      is_public: true,
    })));
    if (error) throw error;
  }

  const chosenIds = new Set(chosen.map((c) => c.importedGameId));
  const settled = offered
    .filter((c) => c.completed || chosenIds.has(c.importedGameId))
    .map((c) => c.importedGameId);
  if (settled.length) {
    const { error } = await supabase
      .from('imported_games')
      .update({ auto_logged_at: new Date().toISOString() })
      .in('id', settled);
    if (error) throw error;
  }
  return { logged: chosen.length };
}

export async function disconnectPsnAccount(userId) {
  const { error } = await supabase.from('connected_accounts').delete().eq('user_id', userId).eq('platform', 'psn');
  if (error) throw error;
}

// ------------------------------------------------------------
// NOTIFICATIONS (see migrations/2026-09-18_notifications.sql)
// ------------------------------------------------------------

// Everything that happened TO you, newest first, with the actor and (for
// likes and comments) the thing it happened to already joined on — the
// hub renders a row per notification and would otherwise need a second
// round trip per row to learn whose review was liked.
export async function getNotifications(userId, { limit = 60 } = {}) {
  const { data, error } = await supabase
    .from('notifications')
    .select(`
      id, kind, read_at, created_at, actor_id, log_id, comment_id, conversation_id,
      actor:profiles!notifications_actor_id_fkey(id, username, display_name, avatar_url),
      log:logs!notifications_log_id_fkey(id, rating, review, game_id, games!logs_game_id_fkey(id, title, cover_url)),
      comment:comments!notifications_comment_id_fkey(id, body)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  // Blocking is enforced at read time rather than in the trigger. A block
  // can happen long after the notification was written, and the person
  // doing the blocking expects that to hide what is already sitting in
  // their hub too — not just anything new.
  let blocked = new Set();
  try { blocked = await getBlockedIds(); } catch { /* a failed block list must not empty the hub */ }
  return (data || []).filter((n) => !n.actor_id || !blocked.has(n.actor_id));
}

export async function getUnreadNotificationCount(userId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
  return count || 0;
}

// Marks the whole inbox read. Scoped by user_id as well as the null
// check even though RLS already pins it — a policy is the backstop, not
// the place to express what the query means.
export async function markAllNotificationsRead(userId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

export async function markNotificationsRead(ids) {
  if (!ids?.length) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null);
  if (error) throw error;
}

export async function clearNotifications(userId) {
  const { error } = await supabase.from('notifications').delete().eq('user_id', userId);
  if (error) throw error;
}

// Live badge + sound. Insert-only: an update here is something being
// marked read, which the client that did it already knows about, and
// waking every other tab for it would just cost a re-render.
export function subscribeToNotifications(userId, onInsert) {
  const channel = supabase
    // Unique per call for the same reason subscribeToConversations is —
    // two subscriptions sharing a channel name silently stop delivering.
    .channel(`notifications:${userId}:${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}`,
    }, (payload) => onInsert(payload.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ---- preferences ----

// Anything absent from the stored object falls back to on (except push,
// which is an explicit opt-in), so a profile row written before a switch
// existed still behaves the way someone would expect.
export const NOTIFICATION_PREF_DEFAULTS = {
  follow: true, like: true, comment: true, message: true, sound: true, push: false,
};

export async function getNotificationPrefs(userId) {
  const { data, error } = await supabase
    .from('profiles').select('notification_prefs').eq('id', userId).single();
  if (error) throw error;
  return { ...NOTIFICATION_PREF_DEFAULTS, ...(data?.notification_prefs || {}) };
}

export async function saveNotificationPrefs(userId, prefs) {
  const merged = { ...NOTIFICATION_PREF_DEFAULTS, ...prefs };
  const { error } = await supabase
    .from('profiles').update({ notification_prefs: merged }).eq('id', userId);
  if (error) throw error;
  return merged;
}

// ---- web push ----

export async function savePushSubscription(userId, sub) {
  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: json.endpoint,
    user_id: userId,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    user_agent: navigator.userAgent.slice(0, 300),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function deletePushSubscription(endpoint) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}

// ============================================================
// ACTIVITY FEED
// ============================================================
// The hub is an activity stream, not only an inbox. Letterboxd's
// activity page is the model: one chronological list of what the people
// you follow have been doing — logged a game, liked a review, followed
// somebody — with the things aimed at you (new followers, likes on your
// own reviews) mixed in on request.
//
// Four sources merged newest-first in the client rather than one SQL
// view. Each of logs/log_likes/follows/comments already carries its own
// RLS policy, and a view would have to restate all four correctly to
// stay as safe; this way the database keeps one answer for who may read
// what, and the merge is only presentation. The cost is fetching a page
// from each instead of one — cheap at these limits.
//
// Messages are deliberately absent. A DM is a conversation, not
// something that belongs in a public-shaped activity list, and it has
// its own screen with its own unread state.

const ACT_ACTOR = 'id, username, display_name, avatar_url';
const ACT_GAME = 'id, title, cover_url';

// Every row carries a `key` that identifies the EVENT rather than the
// table it came from, because the same event legitimately arrives twice:
// somebody you follow liking your review is both friend activity and
// incoming. Same key, one row.
function actKeyFollow(actorId, targetId) { return `follow:${actorId}:${targetId}`; }
function actKeyLike(actorId, logId) { return `like:${actorId}:${logId}`; }
function actKeyComment(commentId) { return `comment:${commentId}`; }

async function actLogs(actorIds, limit, before) {
  if (!actorIds.length) return [];
  let q = supabase
    .from('logs')
    .select(`id, rating, review, status, played_date, created_at, user_id,
      actor:profiles!logs_user_id_fkey(${ACT_ACTOR}),
      games!logs_game_id_fkey(${ACT_GAME})`)
    .in('user_id', actorIds)
    .eq('is_public', true);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).filter((l) => l.games).map((l) => ({
    key: `log:${l.id}`,
    kind: 'log',
    created_at: l.created_at,
    actor_id: l.user_id,
    actor: l.actor,
    game: l.games,
    log: l,
  }));
}

async function actLikes(actorIds, limit, before) {
  if (!actorIds.length) return [];
  let q = supabase
    .from('log_likes')
    .select(`user_id, log_id, created_at,
      actor:profiles!log_likes_user_id_fkey(${ACT_ACTOR}),
      log:logs!log_likes_log_id_fkey(id, rating, review, user_id, is_public,
        games!logs_game_id_fkey(${ACT_GAME}),
        owner:profiles!logs_user_id_fkey(${ACT_ACTOR}))`)
    .in('user_id', actorIds);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  // A like on a log that has since been made private stays hidden: the
  // embed still returns the row, so the visibility check happens here.
  return (data || []).filter((r) => r.log?.is_public && r.log.games).map((r) => ({
    key: actKeyLike(r.user_id, r.log_id),
    kind: 'like',
    created_at: r.created_at,
    actor_id: r.user_id,
    actor: r.actor,
    game: r.log.games,
    log: r.log,
    target: r.log.owner,
  }));
}

async function actFollows(actorIds, limit, before) {
  if (!actorIds.length) return [];
  let q = supabase
    .from('follows')
    .select(`follower_id, following_id, created_at,
      actor:profiles!follows_follower_id_fkey(${ACT_ACTOR}),
      target:profiles!follows_following_id_fkey(${ACT_ACTOR})`)
    .in('follower_id', actorIds);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map((r) => ({
    key: actKeyFollow(r.follower_id, r.following_id),
    kind: 'follow',
    created_at: r.created_at,
    actor_id: r.follower_id,
    actor: r.actor,
    target: r.target,
  }));
}

async function actComments(actorIds, limit, before) {
  if (!actorIds.length) return [];
  let q = supabase
    .from('comments')
    .select(`id, body, created_at, user_id, log_id,
      actor:profiles!comments_user_id_fkey(${ACT_ACTOR}),
      log:logs!comments_log_id_fkey(id, user_id, is_public,
        games!logs_game_id_fkey(${ACT_GAME}),
        owner:profiles!logs_user_id_fkey(${ACT_ACTOR}))`)
    .in('user_id', actorIds);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).filter((r) => r.log?.is_public && r.log.games).map((r) => ({
    key: actKeyComment(r.id),
    kind: 'comment',
    created_at: r.created_at,
    actor_id: r.user_id,
    actor: r.actor,
    game: r.log.games,
    log: r.log,
    target: r.log.owner,
    comment: { id: r.id, body: r.body },
  }));
}

// Incoming reuses the notifications table rather than re-querying the
// four sources with the viewer as the target. That table already holds
// exactly "things that happened to you", already honours the per-kind
// mute switches, and — the part worth keeping — already tracks what has
// been read, which nothing reconstructed from logs/likes/follows could.
async function actIncoming(userId, limit, before) {
  let q = supabase
    .from('notifications')
    .select(`
      id, kind, read_at, created_at, actor_id, log_id, comment_id,
      actor:profiles!notifications_actor_id_fkey(${ACT_ACTOR}),
      log:logs!notifications_log_id_fkey(id, rating, review, games!logs_game_id_fkey(${ACT_GAME})),
      comment:comments!notifications_comment_id_fkey(id, body)`)
    .eq('user_id', userId)
    .neq('kind', 'message');
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map((n) => {
    const key = n.kind === 'follow' ? actKeyFollow(n.actor_id, userId)
      : n.kind === 'like' ? actKeyLike(n.actor_id, n.log_id)
        : actKeyComment(n.comment_id);
    return {
      key,
      kind: n.kind,
      created_at: n.created_at,
      actor_id: n.actor_id,
      actor: n.actor,
      game: n.log?.games || null,
      log: n.log || null,
      comment: n.comment || null,
      incoming: true,
      notification_id: n.id,
      unread: !n.read_at,
      // "followed you" / "liked YOUR review" — the target is always the
      // viewer here, which is what lets the row phrase itself in the
      // second person instead of naming them.
      targetIsViewer: true,
    };
  });
}

// scope: 'friends' | 'you' | 'incoming'
export async function getActivityFeed(userId, {
  scope = 'friends', includeYou = false, includeIncoming = false, limit = 40, before = null,
} = {}) {
  let actorIds = [];
  if (scope === 'you') {
    actorIds = [userId];
  } else if (scope === 'friends') {
    actorIds = [...(await getFollowingIdSet(userId))];
    // Your own actions are not news to you, so they stay out of the
    // friends stream unless the filter asks for them.
    if (includeYou) actorIds.push(userId);
  }

  const wantIncoming = scope === 'incoming' || (scope === 'friends' && includeIncoming);

  const jobs = [];
  if (actorIds.length) {
    jobs.push(
      actLogs(actorIds, limit, before),
      actLikes(actorIds, limit, before),
      actFollows(actorIds, limit, before),
      actComments(actorIds, limit, before),
    );
  }
  if (wantIncoming) jobs.push(actIncoming(userId, limit, before));

  // One source failing should thin the stream, never empty it — a
  // dropped likes query still leaves a usable list of everything else.
  const chunks = await Promise.all(jobs.map((p) => p.catch(() => [])));

  const byKey = new Map();
  for (const row of chunks.flat()) {
    const prior = byKey.get(row.key);
    // The incoming copy wins on a tie because it is the one carrying
    // unread state; everything else about the two rows is the same event.
    if (!prior) byKey.set(row.key, row);
    else if (row.incoming && !prior.incoming) byKey.set(row.key, { ...prior, ...row });
  }

  let rows = [...byKey.values()];
  const blocked = await getBlockedIds().catch(() => new Set());
  if (blocked.size) rows = rows.filter((r) => !blocked.has(r.actor_id));
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const page = rows.slice(0, limit);
  return {
    rows: page,
    // Only claim there is more when more than a page came back —
    // otherwise every source was exhausted and the cursor would spin.
    hasMore: rows.length > limit,
    cursor: page.length ? page[page.length - 1].created_at : null,
  };
}

// ============================================================
// GROUP ADMIN
// ============================================================

// Title and photo go through an RPC rather than a plain update, because
// an UPDATE policy on conversations is all-or-nothing about columns and
// would also hand the creator the read markers and the participant ids.
// See migrations/2026-09-18_chat_upgrades.sql.
export async function updateGroupDetails(conversationId, { title, avatarUrl, clearAvatar, description } = {}) {
  const { error } = await supabase.rpc('update_group_details', {
    p_conversation_id: conversationId,
    p_title: title ?? null,
    p_avatar_url: avatarUrl ?? null,
    p_clear_avatar: !!clearAvatar,
    // null means "leave it alone"; an empty string is how an admin
    // clears the rules again, so it has to survive the round trip.
    p_description: description ?? null,
  });
  if (error) throw error;
}

// The group photo lives in the same bucket as everything else sent in
// the thread, under the conversation's own folder — which is exactly
// what the existing storage policy already grants participants.
export async function uploadGroupPhoto(conversationId, file) {
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
  const path = `${conversationId}/group-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('message-media').upload(path, file, { cacheControl: '3600' });
  if (error) throw error;
  const { data } = supabase.storage.from('message-media').getPublicUrl(path);
  return data.publicUrl;
}

// Removing somebody and leaving are the same delete — RLS is what tells
// them apart (you may always delete your own row; the creator may delete
// anyone's), so there is no separate permission check to make here.
export async function removeGroupMember(conversationId, userId) {
  const { error } = await supabase
    .from('conversation_participants')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function getGroupMembers(conversationId) {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select(`user_id, joined_at, last_read_at,
      profile:profiles!conversation_participants_user_id_fkey(id, username, display_name, avatar_url)`)
    .eq('conversation_id', conversationId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data || []).filter((r) => r.profile);
}

// ============================================================
// READ RECEIPTS
// ============================================================

// Who has read up to when. Groups keep a marker per participant; a DM
// keeps two columns on the conversation itself. Both are already written
// by mark_conversation_read() on every open, so this is only a question
// of reading them back in one shape.
//
// Returns [{ user_id, last_read_at, profile }] for everyone EXCEPT the
// viewer — your own read marker is not a receipt, it is just where you
// are.
export async function getConversationReadState(conversationId, viewerId) {
  const { data: convo, error } = await supabase
    .from('conversations')
    .select(`id, is_group, user_one_id, user_two_id, user_one_last_read_at, user_two_last_read_at,
      one:profiles!conversations_user_one_id_fkey(id, username, display_name, avatar_url),
      two:profiles!conversations_user_two_id_fkey(id, username, display_name, avatar_url)`)
    .eq('id', conversationId)
    .single();
  if (error) throw error;

  if (convo.is_group) {
    const members = await getGroupMembers(conversationId);
    return members
      .filter((m) => m.user_id !== viewerId)
      .map((m) => ({ user_id: m.user_id, last_read_at: m.last_read_at, profile: m.profile }));
  }

  const other = convo.user_one_id === viewerId
    ? { user_id: convo.user_two_id, last_read_at: convo.user_two_last_read_at, profile: convo.two }
    : { user_id: convo.user_one_id, last_read_at: convo.user_one_last_read_at, profile: convo.one };
  return other.user_id ? [other] : [];
}

// ============================================================
// TYPING INDICATORS
// ============================================================

// Broadcast, not rows. A keystroke is worthless three seconds later, so
// writing one to a table would be a durable record of something
// inherently disposable — and a write per keystroke per person besides.
//
// Both ends have to agree on the channel NAME for broadcast to reach
// anyone, so unlike subscribeToMessages this one cannot be made unique
// per call. The caller must therefore close the previous thread's
// channel before opening the next one; every view here does that in its
// own teardown.
const TYPING_TTL_MS = 4500;
const TYPING_THROTTLE_MS = 2000;

export function openTypingChannel(conversationId, me, onChange) {
  const typers = new Map();
  let lastSent = 0;
  let sweep = null;

  const emit = () => {
    const now = Date.now();
    let changed = false;
    for (const [id, entry] of typers) {
      if (entry.expires <= now) { typers.delete(id); changed = true; }
    }
    onChange([...typers.values()].map((t) => t.name));
    return changed;
  };

  const channel = supabase.channel(`typing:${conversationId}`, {
    // No echo: you already know you are typing.
    config: { broadcast: { self: false } },
  });

  channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
    if (!payload?.id || payload.id === me?.id) return;
    if (payload.stopped) typers.delete(payload.id);
    else typers.set(payload.id, { name: payload.name || 'Someone', expires: Date.now() + TYPING_TTL_MS });
    emit();
  });
  channel.subscribe();

  // Nobody sends a "stopped" when they close the tab or lose signal, so
  // the indicator has to be able to time out on its own rather than
  // relying on a message that may never arrive.
  sweep = setInterval(emit, 1000);

  return {
    typing() {
      const now = Date.now();
      if (now - lastSent < TYPING_THROTTLE_MS) return;
      lastSent = now;
      channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { id: me?.id, name: me?.display_name || me?.username || 'Someone' },
      });
    },
    stopped() {
      lastSent = 0;
      channel.send({ type: 'broadcast', event: 'typing', payload: { id: me?.id, stopped: true } });
    },
    close() {
      clearInterval(sweep);
      typers.clear();
      supabase.removeChannel(channel);
    },
  };
}

// ============================================================
// SEARCH INSIDE A CONVERSATION
// ============================================================

// Plain ilike rather than the tsvector index the migration adds, and
// deliberately: full-text search matches whole words after stemming, so
// "sil" would not find "Silent Hill" and neither would "hill f". People
// searching their own chat are looking for a fragment they half
// remember. The index still earns its keep on the long threads because
// Postgres can use it to narrow before the ilike runs.
export async function searchMessagesInConversation(conversationId, term, { limit = 60 } = {}) {
  const q = (term || '').trim();
  if (q.length < 2) return [];
  // % and _ are wildcards in LIKE; someone searching for a literal one
  // should get the literal one.
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await supabase
    .from('messages')
    .select(`id, body, kind, created_at, sender_id,
      sender:profiles!messages_sender_id_fkey(id, username, display_name, avatar_url)`)
    .eq('conversation_id', conversationId)
    .eq('kind', 'text')
    .ilike('body', `%${escaped}%`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ============================================================
// VOICE NOTES
// ============================================================

// A recording arrives as a Blob with no filename, so this cannot go
// through uploadMessageMedia (which reads file.name for the extension
// and infers the kind from the MIME type).
export async function uploadVoiceNote(conversationId, blob) {
  // MediaRecorder's mimeType carries codec parameters — "audio/webm;
  // codecs=opus" — and only the subtype is useful as a file extension.
  const subtype = (blob.type.split('/')[1] || 'webm').split(';')[0];
  const path = `${conversationId}/voice-${crypto.randomUUID()}.${subtype}`;
  const { error } = await supabase.storage
    .from('message-media')
    .upload(path, blob, { cacheControl: '3600', contentType: blob.type || 'audio/webm' });
  if (error) throw error;
  const { data } = supabase.storage.from('message-media').getPublicUrl(path);
  return data.publicUrl;
}

export async function sendVoiceNote(conversationId, senderId, url, durationMs, { replyToId = null } = {}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      body: url,
      kind: 'voice',
      reply_to_id: replyToId,
      duration_ms: Math.min(Math.max(Math.round(durationMs || 0), 0), 600000),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// STORIES
// ============================================================
// Short-lived "what I'm playing right now" posts, built on the games
// people are already logging rather than as a free-form photo feed —
// this is a gaming diary, and "20 hours into Silent Hill f" is the thing
// worth surfacing for a day.
//
// Expiry is a read filter rather than a scheduled delete: no cron job to
// own, no window where a late job leaves stale stories visible, and the
// row survives long enough for its author to see who watched after it
// has stopped being public.

const STORY_SELECT = `
  id, user_id, game_id, log_id, caption, image_url, created_at, expires_at,
  author:profiles!stories_user_id_fkey(id, username, display_name, avatar_url),
  game:games!stories_game_id_fkey(id, title, cover_url, genre)
`;

export async function createStory(userId, { gameId = null, logId = null, caption = null, imageUrl = null } = {}) {
  if (!gameId && !imageUrl) throw new Error('A story needs a game or a picture.');
  const { data, error } = await supabase
    .from('stories')
    .insert({
      user_id: userId,
      game_id: gameId,
      log_id: logId,
      caption: caption?.trim()?.slice(0, 200) || null,
      image_url: imageUrl,
    })
    .select(STORY_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteStory(storyId) {
  const { error } = await supabase.from('stories').delete().eq('id', storyId);
  if (error) throw error;
}

// The rail at the top of the feed: you first, then everyone you follow
// who has something live, most recently posted first.
//
// Returns [{ author, stories, unseen }] — grouped, because a rail shows
// one ring per PERSON and a person may have posted three times.
export async function getStoryRail(userId) {
  const followingIds = [...(await getFollowingIdSet(userId))];
  const authorIds = [userId, ...followingIds];

  const { data, error } = await supabase
    .from('stories')
    .select(STORY_SELECT)
    .in('user_id', authorIds)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });
  if (error) throw error;

  let rows = data || [];
  const blocked = await getBlockedIds().catch(() => new Set());
  if (blocked.size) rows = rows.filter((s) => !blocked.has(s.user_id));
  if (!rows.length) return [];

  // Which of these you have already watched, so the ring can say whether
  // there is anything new behind it.
  let seen = new Set();
  try {
    const { data: views } = await supabase
      .from('story_views')
      .select('story_id')
      .eq('viewer_id', userId)
      .in('story_id', rows.map((s) => s.id));
    seen = new Set((views || []).map((v) => v.story_id));
  } catch {
    // Everything reads as unseen, which is the harmless direction to be
    // wrong in — it shows a ring rather than hiding one.
  }

  const byAuthor = new Map();
  for (const s of rows) {
    if (!byAuthor.has(s.user_id)) {
      byAuthor.set(s.user_id, { author: s.author, stories: [], unseen: 0, latest: s.created_at });
    }
    const group = byAuthor.get(s.user_id);
    group.stories.push({ ...s, seen: seen.has(s.id) });
    if (!seen.has(s.id)) group.unseen += 1;
    if (s.created_at > group.latest) group.latest = s.created_at;
  }

  // Your own ring is never "new": you wrote it. RLS refuses a self-view
  // row on purpose, so without this your own story counts as unwatched
  // forever and the rail keeps an accent ring lit for nothing.
  const own = byAuthor.get(userId);
  if (own) own.unseen = 0;

  const groups = [...byAuthor.values()].filter((g) => g.author);
  // You always sit first — your own story is the one you want to check
  // the views on, and it is never "new" to you.
  groups.sort((a, b) => {
    if (a.author.id === userId) return -1;
    if (b.author.id === userId) return 1;
    // Then anyone with something unwatched, newest first within each half.
    if ((a.unseen > 0) !== (b.unseen > 0)) return a.unseen > 0 ? -1 : 1;
    return new Date(b.latest) - new Date(a.latest);
  });
  return groups;
}

export async function markStoryViewed(storyId, viewerId) {
  // Ignore the conflict rather than checking first: re-watching is
  // normal, and the first view's timestamp is the interesting one.
  const { error } = await supabase
    .from('story_views')
    .upsert({ story_id: storyId, viewer_id: viewerId }, { onConflict: 'story_id,viewer_id', ignoreDuplicates: true });
  // RLS refuses a view on your own story on purpose (see the migration),
  // and that refusal is not something the viewer should ever be told.
  if (error && error.code !== '42501') throw error;
}

export async function getStoryViewers(storyId) {
  const { data, error } = await supabase
    .from('story_views')
    .select(`viewed_at, viewer:profiles!story_views_viewer_id_fkey(id, username, display_name, avatar_url)`)
    .eq('story_id', storyId)
    .order('viewed_at', { ascending: false });
  if (error) throw error;
  return (data || []).filter((v) => v.viewer);
}

// ============================================================
// RECOMMENDATIONS
// ============================================================
// Personalised, and able to say WHY — a recommendation with no reason
// attached is indistinguishable from a list of popular games, which is
// what Discover already has plenty of.
//
// Two signals, in order of how much they are worth:
//
//   1. What the people you follow rated highly and you have not played.
//      This is far and away the strongest one: it is a real person's
//      opinion, from someone you chose to follow.
//   2. More of what you already rate highly yourself, by genre, pulled
//      from IGDB so the pool is not limited to games somebody here has
//      already added.
//
// Anything already in your diary — played, playing, backlog or dropped —
// is excluded from both. Recommending a game somebody has already
// finished is the fastest way to look like you are not paying attention.

function tasteProfile(myLogs) {
  const genres = new Map();
  for (const log of myLogs) {
    const rating = Number(log.rating);
    if (!rating || rating < 3.5) continue;
    const raw = log.games?.genre;
    if (!raw) continue;
    // games.genre is a comma-separated label list from IGDB.
    for (const g of String(raw).split(',').map((s) => s.trim()).filter(Boolean)) {
      // A 5 counts for more than a 3.5, so a genre someone loves beats
      // one they merely tolerate even if they have played fewer of them.
      genres.set(g, (genres.get(g) || 0) + (rating - 3));
    }
  }
  return [...genres.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
}

// Games IGDB itself considers similar to a batch of seed games, in ONE
// pair of requests rather than one pair per seed. Returns a Map of
// igdb_id -> { game, seeds, best, rating } so the caller can rank by
// how many seeds pointed at the same title.
async function similarToMany(seedIgdbIds, perSeed = 14) {
  const out = new Map();
  if (!seedIgdbIds.length) return out;
  const details = await igdb('games', `fields similar_games; where id = (${seedIgdbIds.join(',')});`);

  // Which seeds pointed at each candidate, and how near the top of that
  // seed's list it sat — IGDB orders similar_games most-similar first,
  // so position is real signal and worth keeping.
  const hits = new Map(); // candidateId -> { seeds:Set, best:number }
  for (const d of details) {
    const ids = (d.similar_games || []).slice(0, perSeed);
    ids.forEach((id, rank) => {
      if (!hits.has(id)) hits.set(id, { seeds: new Set(), best: rank });
      const h = hits.get(id);
      h.seeds.add(d.id);
      if (rank < h.best) h.best = rank;
    });
  }
  if (!hits.size) return out;

  // Apicalypse caps a single where-clause, and the ranking below only
  // ever uses the head of the list anyway.
  const ids = [...hits.keys()].slice(0, 300);
  const games = await igdb('games',
    `fields name,cover.image_id,first_release_date,total_rating,genres.name; where id = (${ids.join(',')}) & cover != null; limit 300;`);
  for (const g of games) {
    const h = hits.get(g.id);
    if (!h) continue;
    out.set(g.id, {
      game: {
        igdb_id: g.id,
        title: g.name,
        cover_url: igdbImageUrl(g.cover?.image_id, '1080p'),
        release_year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
        genre: g.genres?.[0]?.name || null,
      },
      seeds: h.seeds,
      best: h.best,
      rating: g.total_rating || 0,
    });
  }
  return out;
}

// "Picked for you": games like the ones this person has actually been
// playing lately.
//
// This used to lead with what the people you follow rated highly, which
// is a fine signal but is not personal to YOUR taste — on an account
// following a handful of people it mostly reproduced their diary. It is
// now seeded from your OWN most recent logs and answered with IGDB's
// similarity graph, so the strip tracks what you are into right now and
// moves as you log things.
//
// Nothing already in the diary can come back: every candidate is checked
// against both the local row ids and the igdb ids of everything logged,
// in any status — played, playing, backlog or dropped. Recommending a
// game you have already finished is the one mistake this section
// cannot make.
export async function getRecommendations(userId, { limit = 18 } = {}) {
  const [{ data: myLogs }, followingSet] = await Promise.all([
    supabase
      .from('logs')
      .select('game_id, rating, status, created_at, games!logs_game_id_fkey(id, title, genre, igdb_id)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    getFollowingIdSet(userId),
  ]);

  const mine = myLogs || [];
  const out = [];
  const taken = new Set();

  // Two sets, because the two sources identify a game differently: a
  // friend's log carries the LOCAL row (a uuid), while an IGDB browse
  // result has only an igdb_id and no local row at all until somebody
  // adds it. Checking just one of them would let a game already sitting
  // in the diary come back as a recommendation through the other path.
  const playedLocal = new Set(mine.map((l) => l.game_id).filter(Boolean));
  const playedIgdb = new Set(mine.map((l) => l.games?.igdb_id).filter(Boolean));

  const push = (game, reason) => {
    if (!game) return;
    const local = !!game.id;
    if (local && (playedLocal.has(game.id) || taken.has(game.id))) return;
    if (!local) {
      if (!game.igdb_id) return;
      const key = `igdb:${game.igdb_id}`;
      if (playedIgdb.has(game.igdb_id) || taken.has(key)) return;
      taken.add(key);
    } else {
      taken.add(game.id);
    }
    // `local` tells the caller whether tapping through can navigate
    // straight to a game page or has to add the row first.
    out.push({ game, reason, local });
  };

  // ---- 1. more like what you have been playing lately ----
  // Seeds are the most recent logs, but a game you disliked is a bad
  // thing to ask for more of — anything rated below 3 is skipped, while
  // an unrated log still counts (most logs never get a rating, and
  // bothering to log it at all is signal enough).
  const seeds = [];
  const seenSeed = new Set();
  for (const l of mine) {
    const id = l.games?.igdb_id;
    if (!id || seenSeed.has(id)) continue;
    if (l.rating && Number(l.rating) < 3) continue;
    seenSeed.add(id);
    seeds.push(id);
    if (seeds.length >= 8) break;
  }

  if (seeds.length) {
    try {
      const cands = [...(await similarToMany(seeds)).values()]
        .filter((c) => !playedIgdb.has(c.game.igdb_id))
        // Agreeing seeds first (a game three of your recent titles all
        // point at is a far better bet than one only a single title
        // does), then how near the top of those lists it sat, then
        // IGDB's own rating as the tie-break.
        .sort((a, b) => (b.seeds.size - a.seeds.size) || (a.best - b.best) || (b.rating - a.rating));
      for (const c of cands) {
        if (out.length >= limit) break;
        push(c.game, 'Like what you have been playing');
      }
    } catch { /* fall through to the passes below rather than returning nothing */ }
  }

  // ---- 2. what your people rated highly ----
  // A backstop now rather than the lead: it only gets a look in when
  // your own recent play has not filled the strip.
  const followingIds = [...followingSet];
  if (out.length < limit && followingIds.length) {
    try {
      const { data: theirs } = await supabase
        .from('logs')
        .select(`game_id, rating, user_id,
          games!logs_game_id_fkey(id, title, cover_url, genre, release_year),
          profiles!logs_user_id_fkey(id, username, display_name)`)
        .in('user_id', followingIds)
        .gte('rating', 4)
        .eq('is_public', true)
        .order('rating', { ascending: false })
        .limit(200);

      // Several friends rating the same game is a much stronger signal
      // than one, so they are grouped and the count goes in the reason.
      const byGame = new Map();
      for (const row of (theirs || [])) {
        if (!row.games || playedLocal.has(row.game_id)) continue;
        if (!byGame.has(row.game_id)) byGame.set(row.game_id, { game: row.games, fans: [], total: 0 });
        const entry = byGame.get(row.game_id);
        entry.fans.push(row.profiles?.display_name || row.profiles?.username || 'someone');
        entry.total += Number(row.rating);
      }
      const ranked = [...byGame.values()].sort((a, b) => {
        if (b.fans.length !== a.fans.length) return b.fans.length - a.fans.length;
        return (b.total / b.fans.length) - (a.total / a.fans.length);
      });
      for (const entry of ranked) {
        if (out.length >= limit) break;
        const avg = (entry.total / entry.fans.length).toFixed(1);
        const reason = entry.fans.length === 1
          ? `${entry.fans[0]} rated this ${avg}`
          : `${entry.fans.length} people you follow rated this ${avg}`;
        push(entry.game, reason);
      }
    } catch {
      // Fall through to the genre pass rather than returning nothing.
    }
  }

  // ---- 3. more of what you already like ----
  const topGenres = tasteProfile(mine);
  for (const label of topGenres.slice(0, 3)) {
    if (out.length >= limit) break;
    const match = BROWSE_GENRES.find((g) => g.label.toLowerCase() === label.toLowerCase()
      || label.toLowerCase().includes(g.label.toLowerCase()));
    if (!match) continue;
    try {
      const { games } = await browseGames({ genre: match.value, sort: 'top_rated', minRating: '75' });
      for (const g of games) {
        if (out.length >= limit) break;
        push(g, `Because you rate ${label} highly`);
      }
    } catch { /* one genre failing should not empty the list */ }
  }

  // ---- 4. nothing to go on yet ----
  if (!out.length) {
    try {
      const { games } = await browseGames({ sort: 'top_rated', minRating: '85' });
      for (const g of games.slice(0, limit)) push(g, 'Highly rated right now');
    } catch { /* an empty list is handled by the caller */ }
  }

  return out.slice(0, limit);
}
