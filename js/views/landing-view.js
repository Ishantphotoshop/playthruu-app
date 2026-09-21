import * as api from '../api.js';
import {
  posterFrame, avatarImg, spinner, emptyState, iconSearch,
  iconUserFilled, iconBrowseNavFilled, iconCompassNavFilled, iconSearchFilled,
} from '../components.js';
import { backdropHtml, tourArtHtml, artCreditHtml, drawTourArt, preloadTourArt, resolveShowcase } from './landing-art.js';
import { esc, starRow, qs, qsa, toast } from '../utils.js';
import { renderAuthView } from './auth-view.js';
import { navigate } from '../router.js';
import { navBar } from '../components.js';
import { state } from '../state.js';

// The funnel shown to anyone who opens the app signed out. Structured to
// feel like being genuinely inside Playthruu — a real poster wall, real
// public reviews, working search and Discover filters, all tied
// together with the same bottom-nav pattern the real app uses — rather
// than reading as a separate "marketing page" bolted in front of it.
//
// Browsing is genuinely real: the Games wall, search, and Discover's
// filters all open the actual pages (registered as public routes in
// app.js), the same way anyone can browse Letterboxd without an
// account. Only the things that actually need an account are gated —
// logging a game, liking, following, adding to a list — each of those
// prompts sign-up at the exact point someone tries to do it (see the
// guards in game-view.js, search-view.js, discover-view.js and
// feed-view.js). The Reviews tab and the feature-highlight rows are
// left funnelling straight to sign-up, since those genuinely do need an
// account (or aren't real navigation targets).
// Dropped from 6 to 5: "Find your next favourite game" was cut since
// browsing/search/Discover are already open to anyone without an account
// (see the routing changes above) — it didn't fit a carousel whose whole
// point is "here's what having an account actually gets you."
// Five slides built the same way the entry screen is: one piece of real
// key art bleeding off the top and dissolving into the ground, then a
// short headline set large with a single word carried in the accent.
//
// `head` is the only field here that is not escaped on the way out — it
// carries one <em> and nothing else, and it is a constant in this file,
// never anything a person typed.
//
// `glow` moves the warm bloom to a different corner on every slide, so
// swiping changes the light on the page and not only the words. `art`
// names an entry in landing-art's hand-checked set.
const TOUR_SLIDES = [
  {
    glow: '72% 10%',
    head: 'Log every<br>game you<br><em>finish.</em>',
    body: 'The moment you put it down — or the moment you pick it up.',
  },
  {
    glow: '24% 16%',
    head: 'Rate it,<br><em>half-stars</em><br>and all.',
    // The one slide whose line is worth SHOWING rather than saying. It
    // is the app's own star row, at the size it renders everywhere
    // else, so the half-star this slide is about is the actual glyph a
    // person will tap rather than a description of one.
    bodyHtml: `From a rough ${starRow(2.5, { size: 15 })} to a perfect ${starRow(5, { size: 15 })}.`,
  },
  {
    glow: '80% 24%',
    head: 'Say what<br>you <em>actually</em><br>thought.',
    body: 'One line or a full write-up — whatever the game deserves.',
  },
  {
    glow: '18% 8%',
    head: 'See what<br>your friends<br>are <em>playing.</em>',
    body: 'A feed built from the people you actually care about.',
  },
  {
    glow: '62% 18%',
    head: 'Line up<br>what you<br>play <em>next.</em>',
    body: 'Rank your favourites. Queue the rest.',
  },
];

// Curated titles mixed into the front of the Games tab's newest-first
// wall (most of them upcoming/announced, not out yet — the tab is meant
// to feel like "what's actually happening in games," and these are
// exactly that). Resolved via a live IGDB search each, same as any
// other title lookup in the app — some are early enough announcements
// that IGDB may not have final cover art for them yet, in which case
// that one is silently skipped, same as any other cover-less result the
// rest of this wall already filters out.
const PINNED_GAME_TITLES = [
  'Mortal Shell II', 'The Sinking City 2', 'Beast of Reincarnation', 'Marvel Tōkon: Fighting Souls',
  'Big Walk', 'Madden NFL 27', 'Hell Let Loose: Vietnam', 'Duskfade',
  "Assassin's Creed Black Flag Resynced", 'Palworld', 'College Football 27', 'Digimon Story: Time Stranger',
  'Halo: Campaign Evolved', 'Mistfall Hunter', 'Avatar Legends: The Fighting Game', 'Wuthering Waves',
  'Gothic 1 Remake', '33 Immortals', 'NBA The Run', 'The Adventures of Elliot: The Millennium Tales',
  'R-Type Tactics I • II Cosmos', 'The 7th Guest Remake', '007 First Light', 'Forza Horizon 6',
  'Subnautica 2', 'LEGO Batman: Legacy of the Dark Knight', 'Mina the Hollower', 'Warhammer 40,000: Mechanicus 2',
  'Mixtape', 'Starbites', 'PRAGMATA', 'Saros',
  'Diablo IV: Lord of Hatred', 'Tomodachi Life: Living the Dream', 'Replaced', 'Mouse: P.I. For Hire',
  'Crimson Desert', 'Marathon', 'Pokémon Pokopia', 'Slay the Spire 2',
  'Monster Hunter Stories 3: Twisted Reflection', 'FATAL FRAME II: Crimson Butterfly REMAKE', 'World of Warcraft: Midnight', 'Planet of Lana II: Children of the Leaf',
  'Resident Evil Requiem', 'Nioh 3', 'Dragon Quest VII Reimagined', 'High on Life 2',
  'CODE VEIN II', 'Pathologic 3',
];

// Module-level, not inside renderLandingView — Account/Browse on the
// real app's nav (see navBar() in components.js) call renderLandingView
// again every time, and Discover/a game page's own back button lands
// back here too, each one a fresh call. Caching these inside the
// function meant every one of those was a brand new closure with these
// reset to null, so the poster wall visibly reloaded (blank, then
// re-fetched, then faded back in) every single time someone came back
// from Discover — even though the actual games returned were identical.
// Living out here, the cache instead survives across every one of those
// remounts for as long as the page itself stays loaded.
let gamesCache = null;     // the browse screen's Games tab — grows as more pages load (infinite scroll)
let gamesPage = 1;
let gamesHasMore = true;
let gamesLoading = false;
let pinnedGamesCache = null; // PINNED_GAME_TITLES, resolved to real game objects once and reused
let reviewsCache = null;   // the browse screen's Reviews tab

// Spreads the pinned titles across the first `total` slots proportional
// to how many of them there are, instead of dumping them all in an
// unbroken block up front — e.g. 48 pinned games across a 50-slot
// window means almost every early slot is pinned with just a couple of
// organic ones breaking it up, which is the "mixed in" look asked for
// rather than "pinned block, then the real list starts."
function interleaveGames(pinned, organic, total) {
  const result = [];
  let pi = 0, oi = 0;
  const ratio = pinned.length / Math.max(total, 1);
  while (result.length < total && (pi < pinned.length || oi < organic.length)) {
    const wantPinnedSoFar = Math.round((result.length + 1) * ratio);
    if (pi < wantPinnedSoFar && pi < pinned.length) result.push(pinned[pi++]);
    else if (oi < organic.length) result.push(organic[oi++]);
    else if (pi < pinned.length) result.push(pinned[pi++]);
  }
  while (pi < pinned.length) result.push(pinned[pi++]);
  while (oi < organic.length) result.push(organic[oi++]);
  return result;
}

const PINNED_GAMES_STORAGE_KEY = 'pt_pinned_games_v1';

async function resolvePinnedGames() {
  if (pinnedGamesCache) return pinnedGamesCache;
  // This is 48 separate IGDB searches — firing all of them again on
  // every hard refresh is what was blowing through IGDB's rate limit
  // (~4 req/s) and causing the 429 storm that broke the Games tab. The
  // list barely changes, so resolve it once per browser and reuse that
  // from then on instead of re-hitting IGDB every reload.
  try {
    const stored = JSON.parse(localStorage.getItem(PINNED_GAMES_STORAGE_KEY) || 'null');
    if (Array.isArray(stored) && stored.length) { pinnedGamesCache = stored; return pinnedGamesCache; }
  } catch { /* corrupt/unavailable storage — fall through and resolve live */ }
  const results = await Promise.all(
    PINNED_GAME_TITLES.map((title) => api.searchIgdb(title, 1).then((r) => r[0]).catch(() => null))
  );
  const seen = new Set();
  pinnedGamesCache = results.filter((g) => g && g.cover_url && !seen.has(g.igdb_id) && seen.add(g.igdb_id));
  try { localStorage.setItem(PINNED_GAMES_STORAGE_KEY, JSON.stringify(pinnedGamesCache)); } catch { /* storage full/unavailable, fine to skip persisting */ }
  return pinnedGamesCache;
}

// Most of PINNED_GAME_TITLES are upcoming/just-announced, so almost none
// of them are in the catalogue yet — tapping one from the signed-out
// Games tab hits the exact same wall as an uncatalogued credit on the
// login screen: adding a genuinely new game needs an account, so it
// prompts sign-up instead of opening. Same fix as
// seedLoginBackdropGames() in api.js: add them to the catalogue once,
// signed in, and every tap after that (from anyone, signed in or not)
// just opens the existing row instead of trying to insert a new one.
// Run from the browser console: `await seedPinnedGames()`.
export async function seedPinnedGames() {
  if (!state.user) {
    console.log('[seedPinnedGames] No active session — every insert will be rejected. Sign in on this tab first, then re-run this.');
    return;
  }
  console.log('[seedPinnedGames] Signed in as', state.user.email || state.user.id, '— proceeding.');
  const games = await resolvePinnedGames();
  const results = [];
  for (const g of games) {
    try {
      await api.addGame(g, state.user.id);
      results.push({ title: g.title, ok: true });
    } catch (err) {
      results.push({ title: g.title, ok: false, error: err.message });
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`[seedPinnedGames] ${results.length - failed.length}/${results.length} added.`);
  failed.forEach((f) => console.log(`  ✗ ${f.title}: ${f.error}`));
  return results;
}

export function renderLandingView(root, { startScreen = 'entry' } = {}) {
  let screen = startScreen;   // 'entry' | 'browse' | 'search' | 'tour'
  let browseTab = 'games';    // 'games' | 'reviews', only used on the browse screen
  let tourIndex = 0;
  // One draw per opening of the tour, five distinct games off the local
  // shelf. Held here rather than recomputed per paint, or every repaint
  // (which happens on every slide) would reshuffle the artwork under
  // the person mid-swipe.
  let tourShots = [];
  let tourDirection = null;   // 'forward' | 'backward' | null — which way the next tourHtml() paint should glide in from

  const goToAuth = (startMode = 'signin') => renderAuthView(root, { startMode });

  // A poster is a raw IGDB result (no local id) until someone actually
  // opens it. addGame() is cheap for the common case — nearly every
  // popular title is already in the catalogue, so this just looks it up
  // and returns the existing row and opens it directly, instantly.
  // A genuinely uncatalogued game (common in this screen specifically —
  // the Games tab leads with newest releases nobody's opened yet) used
  // to hit the write anonymous RLS blocks and fall back to a sign-up
  // prompt just to VIEW it — wrong, since browsing is supposed to be
  // free everywhere else in this app. It opens live from IGDB instead
  // now (see renderGameView's igdbId mode); an account is only ever
  // asked for once someone actually tries to log/rate/save it, same as
  // every other screen already works.
  async function openGame(g) {
    try {
      const saved = await api.addGame(g, null);
      navigate(`/game/${saved.id}`);
    } catch (err) {
      if (g.igdb_id) navigate(`/game/igdb/${g.igdb_id}`);
      else { toast("Couldn't open that game.", 'error'); }
    }
  }

  function paint() {
    if (screen === 'tour') {
      root.innerHTML = `<div class="landing landing--tour"><div class="landing-stage landing-stage--tour" id="landing-stage"></div></div>`;
    } else {
      root.innerHTML = `
        <div class="landing">
          <div class="landing-stage" id="landing-stage"></div>
          ${navBar(screen === 'entry' ? '/me' : '/feed')}
        </div>`;
    }
    paintScreen();
  }


  function paintScreen() {
    const stage = qs('#landing-stage', root);
    if (screen === 'entry') { stage.innerHTML = entryHtml(); wireEntry(stage); }
    else if (screen === 'tour') { stage.innerHTML = tourHtml(); wireTour(stage); }
    else { stage.innerHTML = browseHtml(); wireBrowse(stage); }
  }

  // ---- entry: the front door ---------------------------------------
  // Full-bleed and bottom-anchored over its own lit world (see the
  // "ember arcade" block in styles.css and the SVG kit in
  // landing-art.js). The previous version centred a wordmark and one
  // button in an empty black screen; everything here is arranged so the
  // illustration, the light and the words read as one composition with
  // no leftover space at either end.
  //
  // Two real buttons rather than a button and a text link: signing in
  // is not a footnote. It is what every returning person on a new
  // device needs, and it was previously the smallest thing on screen.
  // The covers behind both the entry screen and the tour. Held at this
  // level, not inside either screen, so switching between them (or
  // coming back from Browse) does not re-resolve or re-request anything.
  let showcase = null;
  let showcaseWanted = false;

  // Kicked off the first time a screen needs covers. The screen paints
  // immediately with the app's own titled placeholder frames and swaps
  // in real art when IGDB answers — the entry screen must never sit
  // blank waiting on a third-party search.
  function loadShowcase() {
    if (showcase || showcaseWanted) return;
    showcaseWanted = true;
    resolveShowcase().then((games) => {
      showcase = games;
      if (screen === 'tour') {
        const slot = qs('#tour-art', root);
        // Nothing on a tour slide waits on the IGDB lookup any more:
        // the artwork is a local file and its credit came with it.
        void slot;
      }
    }).catch(() => { /* placeholders stay; nothing to recover from */ });
  }

  // ---- entry: one sentence on a duotone ground ----------------------
  // No imagery and nothing moving. Everything the screen has to say is
  // said in type, which is why the type runs four lines deep at nearly
  // the full width with the last line in the accent — and why the
  // ground it sits on has to be worth looking at on its own. That is
  // the grain's job (see backdropHtml): a gradient this large bands on
  // a phone, and noise over it reads as a printed surface instead.
  function entryHtml() {
    return `
      <div class="lp">
        ${backdropHtml()}
        <div class="lp__content">
          <div class="lp__brand">
            <img src="icons/mark-blue.svg" alt="" class="lp__mark">
            <span class="lp__name">PlayThruu</span>
          </div>
          <h1 class="lp__word">Every<br>game<br>you ever<br><em>played.</em></h1>
          <p class="lp__sub">One diary. Every rating, every review, and the ones you never finished.</p>
          <div class="lp__actions">
            <button type="button" class="lp__cta" id="entry-tour">Get started</button>
            <button type="button" class="lp__ghost" id="entry-signin">I already have an account</button>
          </div>
        </div>
      </div>`;
  }
  function wireEntry(stage) {
    loadShowcase();
    // Warm the images the tour will use while someone is still reading
    // the front door. Drawn here rather than on the tap so the fetch has
    // already started by the time Get started is pressed — and drawn
    // again on that tap only if this one went stale.
    tourShots = drawTourArt(TOUR_SLIDES.length);
    preloadTourArt(tourShots);
    qs('#entry-signin', stage).addEventListener('click', () => goToAuth('signin'));
    qs('#entry-tour', stage).addEventListener('click', () => {
    screen = 'tour';
    tourIndex = 0;
    tourShots = drawTourArt(TOUR_SLIDES.length);
    paint();
  });
  }

  // ---- browse: a real poster wall + real reviews ---------------------
  function browseHtml() {
    return `
      <div class="landing-browse">
        <div class="landing-browse__head">
          <div class="landing-browse__brand">
            <img src="icons/mark-blue.svg" alt="" class="landing-browse__mark">
            <span class="landing-header__logo">PlayThruu</span>
          </div>
        </div>
        <div class="segmented segmented--wide landing-browse__tabs">
          <button type="button" class="segmented__item${browseTab === 'games' ? ' segmented__item--active' : ''}" data-tab="games">Games</button>
          <button type="button" class="segmented__item${browseTab === 'reviews' ? ' segmented__item--active' : ''}" data-tab="reviews">Reviews</button>
        </div>
        <div id="landing-browse-content">${spinner()}</div>
      </div>`;
  }
  function wireBrowse(stage) {
    qsa('.landing-browse__tabs .segmented__item', stage).forEach((btn) => {
      btn.addEventListener('click', () => {
        browseTab = btn.dataset.tab;
        paintScreen();
      });
    });
    if (browseTab === 'games') loadGamesWall(stage);
    else loadReviewsWall(stage);
  }

  // Newest-first, not all-time-best: sort:'popular' (rating-count order)
  // surfaced the same dozen genuine classics every visit regardless of
  // when they came out — GTA V, Witcher 3, the usual canon — which reads
  // as "our one hall-of-fame list," not a living wall of what's actually
  // been happening in games lately. sort:'newest' plus the same
  // minRating floor keeps it to genuinely notable titles, just ordered
  // by release date instead of all-time acclaim — latest big games
  // first, tapering back through the last few months as you scroll.
  // Genuinely infinite: pages keep loading as long as the API still has
  // more, same pattern as the feed's "Bored? Try these" (see
  // paintDiscovery in feed-view.js) — page/hasMore live at module scope
  // alongside gamesCache so scroll position and everything loaded so
  // far survives leaving this screen and coming back, not just a
  // reload-from-page-1 every time.
  let gamesObserver = null;
  async function loadGamesWall(stage) {
    const slot = qs('#landing-browse-content', stage);
    slot.innerHTML = `<div class="discovery-grid" id="landing-games-list"></div><div id="landing-games-more"></div>`;
    if (gamesCache?.length) {
      paintGamesTiles(stage, gamesCache, 0);
    }
    paintGamesFooter(stage);
    if (!gamesCache) await loadMoreGames(stage);
  }

  function paintGamesTiles(stage, batch, offset) {
    const list = qs('#landing-games-list', stage);
    if (!list) return;
    qsa('[data-skeleton]', list).forEach((el) => el.remove());
    list.insertAdjacentHTML('beforeend', batch.map((g, i) => `
      <button type="button" class="discovery-tile" data-idx="${offset + i}" aria-label="${esc(g.title)}">
        ${posterFrame(g.cover_url, g.title, 'discovery-tile__cover')}
      </button>`).join(''));
    qsa('.discovery-tile', list).forEach((el) => {
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', async () => {
        el.disabled = true;
        await openGame(gamesCache[Number(el.dataset.idx)]);
        el.disabled = false;
      });
    });
  }

  function paintGamesFooter(stage) {
    const moreEl = qs('#landing-games-more', stage);
    const list = qs('#landing-games-list', stage);
    if (!moreEl) return;
    if (gamesLoading) {
      // Placeholders for the next batch go INTO the same grid the real
      // tiles live in (not a separate grid below it) — otherwise the
      // last, partially-filled row of real tiles leaves blank gaps next
      // to a whole new grid of placeholders starting fresh at column 1,
      // which reads as a broken, misaligned layout.
      moreEl.innerHTML = '';
      if (list && !qs('[data-skeleton]', list)) {
        list.insertAdjacentHTML('beforeend', Array.from({ length: 20 }, () => '<div class="skeleton skeleton--tile" data-skeleton></div>').join(''));
      }
      return;
    }
    if (list) qsa('[data-skeleton]', list).forEach((el) => el.remove());
    if (!gamesCache?.length) { moreEl.innerHTML = emptyState('Nothing to show right now.'); return; }
    if (!gamesHasMore) { moreEl.innerHTML = `<p class="discovery-end">That's everything for now.</p>`; return; }
    moreEl.innerHTML = `<div id="landing-games-sentinel" aria-hidden="true"></div><button class="btn btn--ghost btn--block" id="landing-games-load-more">Load more</button>`;
    qs('#landing-games-load-more', moreEl).addEventListener('click', () => loadMoreGames(stage));
    if (gamesObserver) gamesObserver.disconnect();
    const sentinel = qs('#landing-games-sentinel', moreEl);
    const scrollRoot = moreEl.closest('.landing-stage') || null;
    if (sentinel && 'IntersectionObserver' in window) {
      gamesObserver = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreGames(stage);
      }, { root: scrollRoot, rootMargin: '400px' });
      gamesObserver.observe(sentinel);
    }
  }

  async function loadMoreGames(stage) {
    if (gamesLoading || !gamesHasMore) return;
    gamesLoading = true;
    paintGamesFooter(stage);
    const isFirstPage = gamesPage === 1;
    try {
      const params = { minRating: 65, sort: 'newest', page: gamesPage };
      const [res, pinned] = await Promise.all([
        api.browseGames(params),
        isFirstPage ? resolvePinnedGames() : Promise.resolve([]),
      ]);
      // Pinned titles get first claim on a shared igdb_id — deduped
      // before the organic results, not after, so a pinned game that
      // also happens to be a genuine newest-release match keeps its
      // mixed-in slot instead of losing it to its own organic copy.
      const seen = new Set((gamesCache || []).map((g) => g.igdb_id));
      const freshPinned = isFirstPage ? pinned.filter((g) => !seen.has(g.igdb_id) && seen.add(g.igdb_id)) : [];
      const organic = res.games.filter((g) => g.cover_url && !seen.has(g.igdb_id) && seen.add(g.igdb_id));
      const fresh = isFirstPage ? interleaveGames(freshPinned, organic, 50) : organic;
      const offset = gamesCache?.length || 0;
      gamesCache = [...(gamesCache || []), ...fresh];
      gamesHasMore = res.hasMore;
      gamesPage += 1;
      if (!qs('#landing-browse-content', root)) return; // torn down mid-fetch
      paintGamesTiles(stage, fresh, offset);
    } catch {
      // A transient failure (rate limit, network blip) shouldn't
      // permanently end the list — gamesHasMore lives at module scope so
      // it survives remounts, so setting it false here would kill
      // infinite scroll for the rest of the session over one bad request.
      // Leave it true and offer a retry instead.
      const moreEl = qs('#landing-games-more', stage);
      if (moreEl) moreEl.innerHTML = `<p class="muted">Couldn't load more right now. <button type="button" class="link-btn" id="landing-games-retry">Retry</button></p>`;
      const retryBtn = qs('#landing-games-retry', stage);
      if (retryBtn) retryBtn.addEventListener('click', () => loadMoreGames(stage));
      gamesLoading = false;
      return;
    }
    gamesLoading = false;
    paintGamesFooter(stage);
  }

  async function loadReviewsWall(stage) {
    const slot = qs('#landing-browse-content', stage);
    try {
      if (!reviewsCache) reviewsCache = await api.getPublicShowcase(20);
      if (!qs('#landing-browse-content', root)) return;
      if (!reviewsCache.length) {
        slot.innerHTML = emptyState('No public reviews yet — be the first.', { icon: iconSearch() });
        return;
      }
      slot.innerHTML = `<div class="landing-review-list">${reviewsCache.map(reviewTeaserHtml).join('')}</div>`;
      qsa('.landing-review-card', slot).forEach((el) => el.addEventListener('click', () => goToAuth('signup')));
    } catch {
      slot.innerHTML = '';
    }
  }


  // ---- tour: illustrated feature slides, ending on sign-up ----------
  // Progress is a segmented bar rather than dots, and there is a real
  // Continue button again. The carousel was swipe-only, which is a fine
  // gesture on a phone and a dead end everywhere else: this app gets
  // driven with a mouse as often as a thumb, and a screen whose only
  // way forward is an undiscoverable drag strands those people on slide
  // one. Swipe still works exactly as it did (see wireTourSwipe).
  function tourHtml() {
    const slide = TOUR_SLIDES[tourIndex];
    const last = tourIndex === TOUR_SLIDES.length - 1;
    // Glides the new slide in from the direction it was swiped from
    // instead of cutting to it — the drag-follow during the gesture is
    // wiped the instant this re-renders, so this entrance is what
    // actually reads as sliding. Consumed once, so a later plain
    // re-paint does not replay it.
    const enterDir = tourDirection;
    const enterClass = enterDir ? ` tour__content--enter-${enterDir}` : '';
    tourDirection = null;
    // The artwork and the ground change together with the words. Keyed
    // on the index so the browser treats each slide's panel as a new
    // element and replays the entrance, rather than reusing the last
    // one and cross-fading a src swap.
    const shot = tourShots[tourIndex] || {};
    return `
      <div class="tour">
        ${backdropHtml({ glow: slide.glow })}
        <div class="tour__plate${enterClass ? ` tour__plate--enter-${enterDir}` : ''}" data-slide="${tourIndex}">
          ${tourArtHtml({ url: shot.url, eager: tourIndex === 0 })}
        </div>
        <div class="tour__progress">
          ${TOUR_SLIDES.map((_, i) => `<span class="tour__seg${i < tourIndex ? ' tour__seg--done' : ''}${i === tourIndex ? ' tour__seg--active' : ''}"></span>`).join('')}
        </div>
        <div class="tour__top">
          <button type="button" class="tour__skip" id="tour-skip">Skip</button>
        </div>
        <div class="tour__stage">
          <div class="tour__content${enterClass}" id="tour-slide">
            <h2 class="tour__title">${slide.head}</h2>
            <p class="tour__body">${slide.bodyHtml || esc(slide.body)}</p>
            ${artCreditHtml(shot.title)}
          </div>
        </div>
        <div class="tour__foot">
          <button type="button" class="lp__cta tour__next" id="tour-next">${last ? 'Create account' : 'Continue'}</button>
          ${last ? '<p class="tour__hint">Takes about a minute</p>' : ''}
        </div>
      </div>`;
  }
  function advanceTour() {
    if (tourIndex === TOUR_SLIDES.length - 1) { goToAuth('signup'); return; }
    tourDirection = 'forward';
    tourIndex += 1;
    paintScreen();
  }
  // Pulled out of the swipe handler so the left stick can step back the
  // same way a right-swipe does, rather than the two growing apart.
  function goBackTour() {
    if (tourIndex === 0) return;
    tourDirection = 'backward';
    tourIndex -= 1;
    paintScreen();
  }
  function wireTour(stage) {
    loadShowcase();
    qs('#tour-skip', stage).addEventListener('click', () => goToAuth('signup'));
    qs('#tour-next', stage).addEventListener('click', advanceTour);
    wireTourSwipe(stage);
  }

  // Swipe left/right between slides — a carousel that only advances via
  // a Continue tap doesn't feel like a real carousel. Left = forward
  // (finishes into sign-up on the last slide, matching Continue's own
  // behaviour there), right = back a slide, disabled on the first one.
  //
  // Listeners live on .tour (the full min-height:100dvh screen), not on
  // #tour-slide (.tour__content) — .tour__content only fills the space
  // left over AFTER .tour's own top/bottom padding, and that padding
  // strip is exactly where the Skip button and the dots row sit, plus a
  // fair bit of surrounding blank space. Binding to #tour-slide alone
  // meant a swipe started anywhere in that top or bottom margin — most
  // of the screen outside the title/body text itself — was silently
  // ignored. The drag-follow visuals still only move #tour-slide, since
  // Skip and the dots are meant to stay put while the slide underneath
  // them glides.
  function wireTourSwipe(stage) {
    const container = qs('.tour', stage);
    const slide = qs('#tour-slide', stage);
    if (!container || !slide) return;
    const SWIPE_THRESHOLD = 50;
    let startX = 0, dx = 0, dragging = false;

    container.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tour__skip') || e.target.closest('.tour__next')) return; // let those buttons' own clicks through untouched
      startX = e.clientX; dx = 0; dragging = true;
      try { container.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
    });
    container.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      slide.style.transform = `translateX(${dx}px)`;
      slide.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / 260));
    });
    const endSwipe = (e) => {
      if (!dragging) return;
      dragging = false;
      try { container.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (dx <= -SWIPE_THRESHOLD) {
        advanceTour();
      } else if (dx >= SWIPE_THRESHOLD && tourIndex > 0) {
        goBackTour();
      } else {
        // Didn't cross the threshold — spring the same slide back to
        // rest instead of advancing. paintScreen() isn't called on this
        // path, so (unlike the two branches above, which replace the
        // element outright) this transition actually gets to play.
        slide.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        slide.style.transform = ''; slide.style.opacity = '';
        setTimeout(() => { slide.style.transition = ''; }, 260);
      }
    };
    container.addEventListener('pointerup', endSwipe);
    container.addEventListener('pointercancel', endSwipe);
  }

  paint();
}

function reviewTeaserHtml(log) {
  const g = log.games || {};
  const a = log.profiles || {};
  return `
    <button type="button" class="landing-review-card">
      ${posterFrame(g.cover_url, g.title, 'landing-review-card__cover')}
      <div class="landing-review-card__body">
        <div class="landing-review-card__game">${esc(g.title)}</div>
        <div class="landing-review-card__by">
          ${avatarImg(a, 22)}
          <span>${esc(a.display_name || a.username)}</span>
        </div>
        ${log.rating ? `<div class="landing-review-card__stars">${starRow(log.rating, { size: 13 })}</div>` : ''}
        ${log.review ? `<p class="landing-review-card__text">${esc(log.review)}</p>` : ''}
      </div>
    </button>`;
}


