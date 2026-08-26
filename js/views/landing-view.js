import * as api from '../api.js';
import { posterFrame, avatarImg, spinner, emptyState, iconSearch } from '../components.js';
import { esc, starRow, qs, qsa, toast } from '../utils.js';
import { renderAuthView } from './auth-view.js';
import { navigate } from '../router.js';
import { getTheme } from '../theme.js';
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
const TOUR_SLIDES = [
  { icon: 'gamepad', title: 'Log everything you play', body: 'Every game, the moment you finish it — or the moment you start.' },
  { icon: 'star', title: 'Rate it, half-stars and all', body: 'From a rough 2½ to a perfect 5 — say exactly what you thought.' },
  { icon: 'review', title: 'Write reviews, read theirs', body: 'Short thoughts or a full write-up — whatever the game deserves.' },
  { icon: 'people', title: "Follow friends, see what they're playing", body: 'Your feed, built from the people you actually care about.' },
  { icon: 'list', title: 'Build lists & a want-to-play queue', body: 'Rank your favourites, queue up what\'s next.' },
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
          ${landingNavHtml(screen)}
        </div>`;
      wireNav();
    }
    paintScreen();
  }

  function wireNav() {
    qsa('.landing-nav .tabbar__item', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.screen;
        if (next === 'discover') { navigate('/discover'); return; }
        if (next === screen) return;
        screen = next;
        paint();
      });
    });
  }

  function paintScreen() {
    const stage = qs('#landing-stage', root);
    if (screen === 'entry') { stage.innerHTML = entryHtml(); wireEntry(stage); }
    else if (screen === 'search') { stage.innerHTML = searchHtml(); wireSearch(stage); }
    else if (screen === 'tour') { stage.innerHTML = tourHtml(); wireTour(stage); }
    else { stage.innerHTML = browseHtml(); wireBrowse(stage); }
  }

  // ---- entry: brand + one clear action (Get Started, into the tour),
  // with sign-in and anonymous browsing as small secondary links rather
  // than competing top-level buttons. Deliberately no cover-art
  // backdrop (an earlier version scrolled a live wall of real game
  // covers behind this) — the brief was to lean on the brand itself
  // rather than borrowed game art, so this is just the mark, wordmark
  // and tagline, centred on a plain dark field. ----
  function entryHtml() {
    return `
      <div class="landing-entry">
        <div class="landing-entry__content">
          <div class="landing-entry__brand">
            <img src="icons/${getTheme() === 'light' ? 'mark-orange' : 'mark-blue'}.svg" alt="" class="landing-entry__mark">
            <span class="landing-entry__word">PlayThruu</span>
          </div>
          <p class="landing-entry__tagline">The diary for everything you play.</p>
          <button type="button" class="landing-entry__row" id="entry-tour">Get Started</button>
          <div class="landing-entry__links">
            <p class="landing-entry__link landing-entry__link--strong">Already have an account? <button type="button" class="landing-entry__link-inline" id="entry-signin">Log in</button></p>
          </div>
        </div>
      </div>`;
  }
  function wireEntry(stage) {
    // "Take a look around" as its own line is gone — the bottom nav's
    // own grid/browse icon already goes to the exact same screen, so it
    // was a second path to a place one tap away either way. Standalone
    // "Sign Up" is gone too, for the same reason: Get Started already
    // leads into the tour, which ends at (or can be skipped straight
    // to) the exact same sign-up screen — a second button for the same
    // destination sitting right underneath the first was the redundancy
    // that made this stack feel cluttered.
    qs('#entry-signin', stage).addEventListener('click', () => goToAuth('signin'));
    qs('#entry-tour', stage).addEventListener('click', () => { screen = 'tour'; tourIndex = 0; paint(); });
  }

  // ---- browse: a real poster wall + real reviews ---------------------
  function browseHtml() {
    return `
      <div class="landing-browse">
        <div class="landing-browse__head">
          <div class="landing-browse__brand">
            <img src="icons/${getTheme() === 'light' ? 'mark-orange' : 'mark-blue'}.svg" alt="" class="landing-browse__mark">
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

  // ---- search: a REAL search bar + REAL Discover filters -------------
  function searchHtml() {
    const categories = [
      'Genre', 'Platform', 'Most Popular', 'Highest Rated',
      'Most Anticipated', 'All-Time Top Rated', 'Newest Releases',
    ];
    const features = [
      { id: 'new', label: 'New here?' },
      { id: 'track', label: 'Track everything you play' },
      { id: 'rate', label: 'Rate it and write reviews' },
      { id: 'friends', label: "Follow friends, see what they're playing" },
      { id: 'lists', label: 'Build lists and a want-to-play queue' },
    ];
    return `
      <div class="landing-search-screen">
        <button type="button" class="landing-search" id="landing-search-bar" aria-label="Search for a game">
          ${iconSearch()}
          <span>Search</span>
        </button>
        <p class="landing-browseby__heading">Browse by</p>
        <div class="landing-browseby">
          ${categories.map((c) => `
            <button type="button" class="landing-browseby__row" data-cat="${esc(c)}">
              <span>${esc(c)}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
            </button>`).join('')}
        </div>
        <p class="landing-browseby__heading">Playthruu</p>
        <div class="landing-browseby">
          ${features.map((f) => `
            <button type="button" class="landing-browseby__row" data-feature="${f.id}">
              <span>${esc(f.label)}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
            </button>`).join('')}
        </div>
      </div>`;
  }
  function wireSearch(stage) {
    // Both real now: the search bar opens the actual search screen, and
    // every Browse-by row opens the real, working Discover screen —
    // where the actual genre/platform/sort controls live. Genre and
    // Platform don't map to one single value, so rather than build a
    // preset for each, all seven rows just land on the same real screen
    // and the person picks from there — the point was that tapping one
    // of these used to force a login wall no matter what; now it never
    // does.
    qs('#landing-search-bar', stage).addEventListener('click', () => navigate('/search'));
    qsa('.landing-browseby__row[data-cat]', stage).forEach((el) => el.addEventListener('click', () => navigate('/discover')));
    // The feature-highlight rows genuinely do need an account.
    qsa('.landing-browseby__row[data-feature]', stage).forEach((el) => el.addEventListener('click', () => goToAuth('signup')));
  }

  // ---- tour: a short feature carousel, ending on sign-up --------------
  function tourHtml() {
    const slide = TOUR_SLIDES[tourIndex];
    return `
      <div class="tour">
        <button type="button" class="tour__skip" id="tour-skip">Skip</button>
        <div class="tour__content" id="tour-slide">
          <div class="tour__art">${tourMockupHtml(slide.icon)}</div>
          <h2 class="tour__title">${esc(slide.title)}</h2>
          <p class="tour__body">${esc(slide.body)}</p>
        </div>
        <div class="tour__dots">
          ${TOUR_SLIDES.map((_, i) => `<span class="tour__dot${i === tourIndex ? ' tour__dot--active' : ''}"></span>`).join('')}
        </div>
      </div>`;
  }
  // No Continue button — this is swipe-only now (see wireTourSwipe
  // below): swipe left to advance, right to go back, and swiping past
  // the last slide lands on sign-up the same way Skip does.
  function wireTour(stage) {
    qs('#tour-skip', stage).addEventListener('click', () => goToAuth('signup'));
    wireTourSwipe(stage);
  }

  // Swipe left/right between slides — a carousel that only advances via
  // a Continue tap doesn't feel like a real carousel. Left = forward
  // (finishes into sign-up on the last slide, matching Continue's own
  // behaviour there), right = back a slide, disabled on the first one.
  function wireTourSwipe(stage) {
    const slide = qs('#tour-slide', stage);
    if (!slide) return;
    const SWIPE_THRESHOLD = 50;
    let startX = 0, dx = 0, dragging = false;

    slide.addEventListener('pointerdown', (e) => {
      startX = e.clientX; dx = 0; dragging = true;
      try { slide.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
    });
    slide.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      slide.style.transform = `translateX(${dx}px)`;
      slide.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / 260));
    });
    const endSwipe = (e) => {
      if (!dragging) return;
      dragging = false;
      try { slide.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      slide.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
      slide.style.transform = ''; slide.style.opacity = '';
      setTimeout(() => { slide.style.transition = ''; }, 260);
      if (dx <= -SWIPE_THRESHOLD) {
        if (tourIndex === TOUR_SLIDES.length - 1) goToAuth('signup');
        else { tourIndex += 1; paintScreen(); }
      } else if (dx >= SWIPE_THRESHOLD && tourIndex > 0) {
        tourIndex -= 1;
        paintScreen();
      }
    };
    slide.addEventListener('pointerup', endSwipe);
    slide.addEventListener('pointercancel', endSwipe);
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

// The 4-icon bottom nav, styled with the exact same classes the real
// app's tabbar uses (.tabbar/.tabbar__item) so it's the same piece of
// glass, not a lookalike. Icons only now — the icons plus the screens
// they open are self-explanatory, and dropping the labels frees up
// visual weight to make the icons themselves bigger. Discover is the
// one item here that isn't a local screen inside this shell — it hands
// off to the real, already-public /discover route (see wireNav), the
// same way tapping a poster anywhere on this screen already hands off
// to the real /game/:id page with its own real nav.
function landingNavHtml(active) {
  const items = [
    { id: 'entry', icon: iconAccountLocked(), label: 'Account' },
    { id: 'browse', icon: iconGridBrowse(), label: 'Browse' },
    { id: 'discover', icon: iconCompass(), label: 'Discover' },
    { id: 'search', icon: iconSearch(), label: 'Search' },
  ];
  return `
    <nav class="tabbar landing-nav">
      ${items.map((it) => `
        <button type="button" class="tabbar__item${active === it.id ? ' tabbar__item--active' : ''}" data-screen="${it.id}" aria-label="${it.label}">
          ${it.icon}
        </button>`).join('')}
    </nav>`;
}

function iconAccountLocked() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="8" r="3.7" stroke="currentColor" stroke-width="2.3"/>
    <path d="M4.3 20c1.3-3.6 3.7-5.7 6.6-6.2" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
    <rect x="14" y="14" width="7.5" height="6.5" rx="1.4" stroke="currentColor" stroke-width="2.1"/>
    <path d="M15.8 14v-1.6a1.95 1.95 0 0 1 3.9 0V14" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
  </svg>`;
}
function iconGridBrowse() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="7.7" height="7.7" rx="1.6" stroke="currentColor" stroke-width="2.3"/>
    <rect x="13.3" y="3" width="7.7" height="7.7" rx="1.6" stroke="currentColor" stroke-width="2.3"/>
    <rect x="3" y="13.3" width="7.7" height="7.7" rx="1.6" stroke="currentColor" stroke-width="2.3"/>
    <rect x="13.3" y="13.3" width="7.7" height="7.7" rx="1.6" stroke="currentColor" stroke-width="2.3"/>
  </svg>`;
}
function iconCompass() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="2.3"/>
    <path d="m15.3 8.7-4.2 2.8-2.1 4.1 4.2-2.8 2.1-4.1z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
  </svg>`;
}

// Small mockups for the tour slides, built from the app's own real
// component classes/CSS (.stamp, starRow's .stars, the card/avatar
// radii and shadow tokens) rather than abstract icon glyphs — no real
// screenshots exist to embed here (this carousel runs before anyone's
// signed in or any data has loaded), so the "cover art" underneath is a
// flat gradient placeholder in the app's own palette, not a fetched
// image, but everything drawn on top of it is genuine app UI at a
// smaller scale.
function tourMockupHtml(name) {
  const mockups = {
    gamepad: `
      <div class="tour-mock tour-mock--log">
        <div class="tour-mock__poster"><span class="tour-mock__stamp stamp stamp--played">PLAYED</span></div>
        <div class="tour-mock__card">
          <span class="tour-mock__label">Elden Ring</span>
          <div class="tour-mock__lines"><div class="tour-mock__line tour-mock__line--short"></div></div>
        </div>
      </div>`,
    star: `
      <div class="tour-mock tour-mock--rate">
        <div class="tour-mock__poster"></div>
        <div class="tour-mock__card">
          <span class="tour-mock__label">Hades II</span>
          ${starRow(4.5, { size: 20 })}
        </div>
      </div>`,
    review: `
      <div class="tour-mock tour-mock--review">
        <div class="tour-mock__poster"></div>
        <div class="tour-mock__lines">
          <div class="tour-mock__line"></div>
          <div class="tour-mock__line"></div>
          <div class="tour-mock__line tour-mock__line--short"></div>
        </div>
      </div>`,
    people: `
      <div class="tour-mock tour-mock--people">
        <div class="tour-mock__stack">
          <span class="tour-mock__avatar"></span>
          <span class="tour-mock__avatar"></span>
          <span class="tour-mock__avatar"></span>
        </div>
      </div>`,
    list: `
      <div class="tour-mock tour-mock--list">
        <div class="tour-mock__stack">
          <span class="tour-mock__poster"></span>
          <span class="tour-mock__poster"></span>
          <span class="tour-mock__poster"></span>
        </div>
      </div>`,
  };
  return mockups[name] || mockups.star;
}
