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
// One piece of real key art per slide, each named by an exact IGDB
// image id rather than "whatever that game's first artwork is".
//
// Hand-picked, because neither of IGDB's two image sources is safe to
// take blind: `artworks` is very often the marketing key art complete
// with the logo and a tagline burnt into it, and `screenshots` are
// usually mid-combat with the HUD up. Every id below was checked by
// eye against two rules — no text anywhere in the frame, and a face or
// a figure near the middle, which is what survives being cropped to a
// phone and faded out at the bottom.
// A third rule joined the two above after the first build: no
// CINEMATIC BARS. Ghost of Tsushima's shot was from a cutscene, which
// the game renders letterboxed, so the black stripes were pixels in
// the JPEG — they read exactly like a broken CSS fade across the top
// and bottom of the panel, and no amount of object-fit can crop what
// is part of the picture.
const ART = {
  hellblade2: 'ar2cjv',   // Senua, hands to her face
  lastofus2: 'scpkht',    // Joel, close, lit from one side
  ff7rebirth: 'scmwdg',   // Aerith, in profile
  alanwake2: 'ar3nui',    // the red forest
  wukong: 'sc8i9c',       // the Monkey King, armoured
};

// t_1080p, not t_original. The transform keeps the source's aspect
// ratio (it does not pad), and it is the difference between a 296 KB
// image and a 5 MB one for Alan Wake's artwork alone — measured, for
// all five.
const artUrl = (id) => `https://images.igdb.com/igdb/image/upload/t_1080p/${id}.jpg`;

/**
 * The full-bleed panel at the top of a tour slide.
 *
 * The art is desaturated and re-tinted rather than shown as-is: five
 * slides of five games' own colour grading would be five different
 * looking screens, and the point of this sequence is that it is one
 * place. `mix-blend-mode: color` takes hue and saturation from the
 * navy gradient above it and luminosity from the photograph below, so
 * what comes out is a real duotone of the original image, not a navy
 * sheet laid over it.
 *
 * `eager` on the first slide only: that image is on screen the instant
 * the tour opens, and the other four are a swipe away at best.
 */
export function tourArtHtml(key, { eager = false } = {}) {
  const id = ART[key];
  if (!id) return '';
  return `
    <div class="tour-art" aria-hidden="true">
      <img class="tour-art__img" src="${artUrl(id)}" alt=""
           ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      <span class="tour-art__duo"></span>
      <span class="tour-art__warm"></span>
      <span class="tour-art__scrim"></span>
      <span class="tour-art__fade"></span>
    </div>`;
}

// The credit under each slide's artwork. Deliberately not a link: the
// whole slide is a swipe target, and a tappable strip inside it either
// swallows the gesture or fires on the end of one.
export function artCreditHtml(key, games) {
  const g = (games || {})[key];
  if (!g?.title) return '';
  return `<p class="tour-art__credit">Art from ${esc(g.title)}</p>`;
}

// ---- the analog sticks ------------------------------------------------
// Two thumbsticks flanking Continue, which turns the bottom of the slide
// into the shape of a controller — the one object every person looking
// at this app already knows the feel of.
//
// The LEFT one is pushed off-centre, toward the middle of the screen.
// That is the swipe cue, and it replaces the words "or swipe": a stick
// held over means "this is the direction things move", which is the
// same instruction without asking anyone to read it. The right one sits
// neutral, so the pair reads as a resting controller rather than as two
// identical ornaments.
//
// Drawn rather than animated. The app's chrome does not move on its own
// (see the entry screen and the tour, which are deliberately still), and
// a stick that wobbles would be the only thing on the screen doing so.
//
// `push` is how far the cap leans, in the SVG's own 64-unit box.
function analogStick({ push = 0, extraClass = '' } = {}) {
  const cap = 32 + push;
  return `
    <span class="tour-stick ${extraClass}" aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="29" fill="rgba(0,8,20,0.34)" stroke="rgba(255,255,255,0.14)" stroke-width="1.4"/>
        <circle cx="32" cy="32" r="22" fill="rgba(0,8,20,0.42)" stroke="rgba(255,255,255,0.09)" stroke-width="1"/>
        <circle cx="${cap}" cy="32" r="15.5" fill="rgba(255,255,255,0.09)" stroke="rgba(255,255,255,0.26)" stroke-width="1.6"/>
        <circle cx="${cap}" cy="32" r="8" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
      </svg>
    </span>`;
}

// The pair, as one row the Continue button sits inside.
export function stickHtml(side) {
  return side === 'left'
    ? analogStick({ push: 7, extraClass: 'tour-stick--left' })
    : analogStick({ push: 0, extraClass: 'tour-stick--right' });
}

export function preloadTourArt() {
  for (const id of Object.values(ART)) {
    const img = new Image();
    img.decoding = 'async';
    img.src = artUrl(id);
  }
}
