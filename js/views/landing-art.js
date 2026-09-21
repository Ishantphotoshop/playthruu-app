import * as api from '../api.js';
import { esc } from '../utils.js';

// The artwork for the signed-out screens: real game covers, shown in the
// same poster frames, stamps, star rows and review cards the rest of the
// app uses.
//
// An earlier version drew all of this by hand as abstract SVG "cases" —
// coloured rounded rectangles. It held together on its own and was wrong
// in context: an app whose entire subject is games, showing invented art
// instead of the real covers it is already full of, in a visual language
// that existed nowhere else in the product. Everything here is built
// from components that appear on real screens, so the front door is made
// of the same material as the rooms behind it.

// Story-driven, big-budget titles — the kind of game someone opens a
// diary app to write about.
const SHOWCASE = {
  wolverine: "Marvel's Wolverine",
  lastofus2: 'The Last of Us Part II Remastered',
  ragnarok: 'God of War Ragnarök',
  spiderman2: "Marvel's Spider-Man 2",
  tsushima: 'Ghost of Tsushima',
  rdr2: 'Red Dead Redemption 2',
  eldenring: 'Elden Ring',
  cyberpunk: 'Cyberpunk 2077',
  // The rest exist for the wall on the entry screen, which needs enough
  // covers to read as a library rather than as a handful of examples.
  hellblade2: "Senua's Saga: Hellblade II",
  deathstranding2: 'Death Stranding 2: On the Beach',
  silenthill2: 'Silent Hill 2',
  re4: 'Resident Evil 4',
  alanwake2: 'Alan Wake II',
  baldursgate3: "Baldur's Gate 3",
  horizonfw: 'Horizon Forbidden West',
  expedition33: 'Clair Obscur: Expedition 33',
  wukong: 'Black Myth: Wukong',
  ff7rebirth: 'Final Fantasy VII Rebirth',
};

// v2, and read back defensively. v1 was written when this list held
// eight games; growing it to eighteen left every browser that had
// already visited holding a cache that was missing the ten new ones —
// and five of the seven cover stars were among them, so most loads
// resolved to nothing and rendered the app's titled placeholder
// instead of a poster. Bumping the key fixes the browsers that exist
// now; the completeness check below is what stops it happening again
// the next time a title is added.
const STORAGE_KEY = 'playthruu:showcase-games:v2';
let showcaseCache = null;

/**
 * Resolve every showcase title to a real game, keyed the same way as
 * SHOWCASE so a scene can ask for `games.wolverine` and get a cover.
 *
 * Cached in localStorage because this is eight separate IGDB searches,
 * and IGDB rate-limits at roughly four requests a second — the same trap
 * the pinned Games wall already hit (see resolvePinnedGames in
 * landing-view.js). The list is fixed, so resolving it once per browser
 * is plenty.
 *
 * Never rejects: a title that cannot be resolved simply comes back
 * missing and its slot renders a titled placeholder frame. A front door
 * that breaks because a third-party search was slow is worse than one
 * showing a plain frame for a moment.
 */
export async function resolveShowcase() {
  if (showcaseCache) return showcaseCache;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // Every key, not just "some entries" — a cache written before a
    // title was added is worse than no cache, because it answers.
    const complete = stored && typeof stored === 'object'
      && Object.keys(SHOWCASE).every((k) => stored[k] && stored[k].cover_url);
    if (complete) {
      showcaseCache = stored;
      return showcaseCache;
    }
  } catch { /* unavailable or corrupt storage — resolve live instead */ }

  // Four at a time, not eighteen at once. IGDB rate-limits at roughly
  // four requests a second and answers the rest with 429s, which would
  // leave most of the wall as blank frames on a first visit.
  const keys = Object.keys(SHOWCASE);
  const found = [];
  for (let i = 0; i < keys.length; i += 4) {
    const batch = keys.slice(i, i + 4);
    // eslint-disable-next-line no-await-in-loop
    found.push(...await Promise.all(batch.map((k) =>
      api.searchIgdb(SHOWCASE[k], 1).then((r) => r[0] || null).catch(() => null))));
    if (i + 4 < keys.length) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 220));
    }
  }

  const out = {};
  keys.forEach((k, i) => {
    const g = found[i];
    if (g && g.cover_url) out[k] = { igdb_id: g.igdb_id, title: g.title, cover_url: g.cover_url };
  });

  showcaseCache = out;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch { /* fine to skip persisting */ }
  return showcaseCache;
}

// ---- the ground everything signed-out stands on ----------------------
// Three layers over a near-black navy, which together are the whole
// look: a long diagonal wash from the palette's mid blue down into the
// dark, film grain across all of it, and one warm bloom of the accent
// sitting off-centre near the top.
//
// The grain is what stops this reading as a stock gradient. Large, soft
// fields of colour band visibly on a phone screen; the noise breaks the
// steps up and gives the whole thing a printed surface rather than a
// rendered one. It is a data-URI of SVG fractalNoise rather than an
// image file, so it costs nothing to load and cannot fail to arrive.
//
// `glow` moves the bloom per screen. That is what makes swiping the
// tour feel like a carousel: the light on the page moves with the
// slide, not just the words.
const GRAIN = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E";

export function backdropHtml({ glow = '70% 12%', extraClass = '' } = {}) {
  return `
    <div class="lp-bg ${extraClass}" aria-hidden="true">
      <span class="lp-bg__wash"></span>
      <span class="lp-bg__grain" style="background-image:url(&quot;${GRAIN}&quot;)"></span>
      <span class="lp-bg__glow" style="--glow: ${glow}"></span>
    </div>`;
}

// ---- the tour's artwork ----------------------------------------------
// Drawn from the same shelf the login screen rotates through: thirty-odd
// pieces of game art sitting in images/backdrops/, each already paired
// with the game's title and its id in our own catalogue.
//
// It used to be five IGDB image ids hardcoded here — the same five games
// in the same order on every single open, and every one of them a
// cross-origin fetch off IGDB's CDN. The shelf fixes both: it is local,
// so it is on screen in a frame rather than after a round trip, and
// api.drawBackdrops shuffles it, so a person who opens the tour twice
// does not see the same five games twice.
//
// Nothing here has to be hand-checked for burnt-in text or cinematic
// bars any more either — that shelf was curated by hand for exactly
// this kind of use.
export function drawTourArt(count) {
  return api.drawBackdrops(count);
}

/**
 * The full-bleed panel at the top of a tour slide.
 *
 * Grainy noir rather than a straight duotone. The image is pushed most
 * of the way to black-and-white and its contrast lifted, a layer of the
 * same film grain the ground carries is laid over it, and only a little
 * of the navy remains — enough to keep the screen one colour, not
 * enough to make every game the same colour.
 *
 * `eager` on the slide that is already on screen; the rest are a swipe
 * away at best.
 */
export function tourArtHtml({ url, eager = false } = {}) {
  if (!url) return '';
  return `
    <div class="tour-art" aria-hidden="true">
      <img class="tour-art__img" src="${esc(url)}" alt=""
           ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      <span class="tour-art__duo"></span>
      <span class="tour-art__warm"></span>
      <span class="tour-art__grain" style="background-image:url(&quot;${GRAIN}&quot;)"></span>
      <span class="tour-art__scrim"></span>
      <span class="tour-art__fade"></span>
    </div>`;
}

// The credit under each slide's artwork. Deliberately not a link: the
// whole slide is a swipe target, and a tappable strip inside it either
// swallows the gesture or fires on the end of one.
export function artCreditHtml(title) {
  if (!title) return '';
  return `<p class="tour-art__credit">Art from <b>${esc(title)}</b></p>`;
}

// Every image the tour will show, fetched while someone is still reading
// the entry screen. They are local files, so this is the browser cache
// doing the work rather than a network trip.
export function preloadTourArt(shots) {
  for (const s of shots || []) {
    if (!s?.url) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = s.url;
  }
}
