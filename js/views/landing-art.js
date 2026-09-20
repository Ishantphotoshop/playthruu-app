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

const STORAGE_KEY = 'playthruu:showcase-games:v1';
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
    if (stored && typeof stored === 'object' && Object.keys(stored).length) {
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

// ---- the entry screen's wall ----------------------------------------
// Four columns of covers running off every edge, the middle two pushed
// down so the rows never line up into a grid. A grid reads as a
// spreadsheet of games; an offset wall reads as a shelf someone filled.
//
// The columns are deliberately taller than the screen. Nothing here is
// meant to be seen whole — it is the surface the screen is printed on.
const WALL_COLUMNS = [
  ['lastofus2', 'tsushima', 'eldenring', 'alanwake2', 'rdr2'],
  ['wolverine', 'ragnarok', 'silenthill2', 'baldursgate3', 'cyberpunk'],
  ['spiderman2', 'hellblade2', 'wukong', 'horizonfw', 're4'],
  ['deathstranding2', 'expedition33', 'ff7rebirth', 'lastofus2', 'ragnarok'],
];

export function wallHtml(games) {
  return WALL_COLUMNS.map((col, i) => `
    <div class="lp-wall__col lp-wall__col--${i + 1}" aria-hidden="true">
      ${col.map((key) => {
        const g = pick(games, key);
        return `<span class="lp-wall__tile">${posterFrame(g.cover_url, g.title, 'lp-wall__frame')}</span>`;
      }).join('')}
    </div>`).join('');
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
