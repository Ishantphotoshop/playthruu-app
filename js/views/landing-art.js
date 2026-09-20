import * as api from '../api.js';
import { posterFrame, avatarImg } from '../components.js';
import { esc, starRow } from '../utils.js';

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
// The games used as a full-bleed background. Not every cover survives
// being blown up to fill a phone: a 3:4 box crops hard, and a cover
// whose whole idea is a logo across the middle loses it. These are
// built around a face or a figure — and each one's text-free key art
// is fetched for exactly this use (see getKeyArt in api.js).
const COVER_STARS = ['hellblade2', 'lastofus2', 'tsushima', 'alanwake2', 'silenthill2', 'wukong', 'ff7rebirth'];

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

  // Key art for the ones used as a full-bleed background. One extra
  // request for all of them together, and a game with no artwork of
  // its own simply keeps its cover.
  try {
    const art = await api.getKeyArt(COVER_STARS.map((k) => out[k] && out[k].igdb_id));
    for (const k of COVER_STARS) {
      if (out[k] && art[out[k].igdb_id]) out[k].art_url = art[out[k].igdb_id];
    }
  } catch { /* covers still work as a background, just with their logo on */ }

  showcaseCache = out;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch { /* fine to skip persisting */ }
  return showcaseCache;
}

// A game to draw, resolved or not. The fallback keeps the real title, so
// a slot still waiting on IGDB renders the app's own titled placeholder
// instead of an empty box.
function pick(games, key) {
  return (games && games[key]) || { title: SHOWCASE[key], cover_url: null };
}

function poster(game, extraClass = '', inner = '') {
  return `<div class="lp-poster ${extraClass}">
    ${posterFrame(game.cover_url, game.title, 'lp-poster__frame')}
    ${inner}
  </div>`;
}

// ---- the entry screen's cover ---------------------------------------
// (COVER_STARS is declared above resolveShowcase, which needs it.)
// The entry screen is laid out like a magazine, so it needs one piece
// of art big enough to be the cover of one.
//
// Not every game cover survives that. A 3:4 box blown up to fill a
// phone crops hard, and a cover whose whole idea is a logo across the
// middle loses it. These are the ones built around a face or a figure,
// which is exactly what a magazine cover is built around too.
// Chosen once per load, not per paint: the entry screen remounts every
// time the bottom bar comes back to it, and re-rolling there would
// swap the cover under someone mid-read. A different issue each time
// the app opens is the point — a magazine that never changes its cover
// is a poster.
const COVER_KEY = COVER_STARS[Math.floor(Math.random() * COVER_STARS.length)];

export function magazineCoverHtml(games) {
  const g = pick(games, COVER_KEY);
  // The key art if the game has any, its cover if not. Not posterFrame:
  // that is built for thumbnails in a scrolling grid, so it lazy-loads
  // and shows a shimmer — both wrong for the one image that IS the
  // screen. This one is eager and high priority, because it is the
  // first thing anybody sees and nothing else on the page competes
  // with it for bandwidth.
  const src = g.art_url || g.cover_url;
  if (!src) return '';
  return `<img class="lp__art" src="${esc(src)}" alt="" fetchpriority="high" decoding="async">`;
}

/**
 * Tells the browser to start the cover art before the stylesheet and
 * the rest of the page have finished, which is most of the difference
 * between the art appearing with the words and a beat after them.
 */
export function preloadCover(games) {
  const g = pick(games, COVER_KEY);
  const href = g.art_url || g.cover_url;
  if (!href || document.querySelector(`link[rel="preload"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = href;
  link.fetchPriority = 'high';
  document.head.appendChild(link);
}

/** The cover line naming what this issue's art is. */
export function coverStarTitle(games) {
  return pick(games, COVER_KEY).title;
}

// ---- tour scenes ------------------------------------------------------
// Reviews written the way a real one reads: one line, said like a person
// rather than a blurb, short enough to land before anyone decides
// whether to keep swiping.
const REVIEWS = {
  lastofus2: { who: 'Aditya', rating: 5, text: 'Made me hate a character then feel awful about it.' },
  tsushima: { who: 'Ritika', rating: 4.5, text: 'Forty hours in and I still stop to look at the sky.' },
  ragnarok: { who: 'Jiyan', rating: 4, text: 'Best combat I have played. Lost me a bit in act three.' },
};

export function reviewCardHtml(games, key) {
  const g = pick(games, key);
  const r = REVIEWS[key];
  return `
    <div class="landing-review-card lp-review">
      ${posterFrame(g.cover_url, g.title, 'landing-review-card__cover')}
      <div class="landing-review-card__body">
        <div class="landing-review-card__game">${esc(g.title)}</div>
        <div class="landing-review-card__by">
          ${avatarImg({ display_name: r.who, username: r.who }, 22)}
          <span>${esc(r.who)}</span>
        </div>
        <div class="landing-review-card__stars">${starRow(r.rating, { size: 13 })}</div>
        <p class="landing-review-card__text">${esc(r.text)}</p>
      </div>
    </div>`;
}

const SCENES = {
  // Logging: a cover, stamped.
  log: (games) => `
    <div class="lp-scene lp-scene--log">
      <div class="lp-scene__row">
        ${poster(pick(games, 'eldenring'))}
        ${poster(pick(games, 'rdr2'), 'lp-poster--hero')}
      </div>
      <span class="lp-poster__caption">
        ${starRow(5, { size: 12 })}
        <span class="lp-poster__stamp">Played</span>
      </span>
    </div>`,

  // Rating: the star row at a size nobody can miss.
  rate: (games) => `
    <div class="lp-scene lp-scene--rate">
      ${poster(pick(games, 'ragnarok'), 'lp-poster--hero')}
      <div class="lp-scene__stars">${starRow(4.5, { size: 28 })}</div>
    </div>`,

  // Reviewing: the app's own review card, with real reviews in it.
  review: (games) => `
    <div class="lp-scene lp-scene--review">
      ${reviewCardHtml(games, 'lastofus2')}
      ${reviewCardHtml(games, 'tsushima')}
    </div>`,

  // Friends: faces over what they have been playing.
  people: (games) => `
    <div class="lp-scene lp-scene--people">
      <div class="lp-scene__row">
        ${['cyberpunk', 'tsushima', 'spiderman2'].map((k) => poster(pick(games, k), 'lp-poster--small')).join('')}
      </div>
      <div class="lp-scene__faces">
        ${[{ display_name: 'Ritika' }, { display_name: 'Aditya' }, { display_name: 'Jiyan' }, { display_name: 'Vishal' }]
          .map((p) => `<span class="lp-face">${avatarImg(p, 44)}</span>`).join('')}
      </div>
    </div>`,

  // Lists: a ranked stack, the same shape a real list row has.
  list: (games) => `
    <div class="lp-scene lp-scene--list">
      ${[['eldenring', 1], ['lastofus2', 2], ['wolverine', 3]].map(([k, n]) => {
        const g = pick(games, k);
        return `
          <div class="lp-listrow">
            <span class="lp-listrow__rank">${n}</span>
            ${posterFrame(g.cover_url, g.title, 'lp-listrow__cover')}
            <span class="lp-listrow__title">${esc(g.title)}</span>
          </div>`;
      }).join('')}
    </div>`,
};

export function tourSceneHtml(kind, games) {
  return (SCENES[kind] || SCENES.log)(games);
}
