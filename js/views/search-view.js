import * as api from '../api.js';
import { state } from '../state.js';
import { navBar, combinedGameResultsList, wireCombinedGameResults, wireResultDirectors, profileRow, wireFollowButtons, spinner, skeletonList, emptyState, iconSearch, iconFilter, iconUser, iconGamepad, iconList, iconClose, iconChevronRight, posterFrame, confirmSheet, gameHref,
} from '../components.js';
import { qs, qsa, esc, toast, promptSignIn, getRecentlyViewed, recordRecentSearch, getRecentSearches, removeRecentSearch, clearRecentSearches, revealTogether, igdbSized, keepLoading } from '../utils.js';
import { navigate } from '../router.js';
import { getCached, setCached, CACHE_KEYS } from '../cache.js';

const IDLE_TRENDING_CACHE_KEY = CACHE_KEYS.searchTrending;

// What can be searched. `id` is what a recent search remembers (so tapping
// one jumps to the right tab); `tag` is the small word under its name in the
// recent list.
const STUDIO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V6l8-3v17M12 9l8 3v8M2.5 20h19M8 8h.01M8 12h.01M8 16h.01M16 15h.01M16 18h.01"/></svg>';
const ARTIST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const ALL_TABS = [
  { id: 'games', label: 'Games', tag: 'Game', placeholder: 'Search games…', hint: 'Search for a game to log, rate, or review.', icon: iconGamepad() },
  { id: 'people', label: 'People', tag: 'Person', placeholder: 'Search people…', hint: 'Search for players to follow.', icon: iconUser() },
  { id: 'all', label: 'All', tag: 'All', placeholder: 'Search everything…', hint: 'Search games, players, lists, studios and artists at once.', icon: iconSearch() },
  { id: 'lists', label: 'Lists', tag: 'List', placeholder: 'Search lists…', hint: 'Search for lists other players have made.', icon: iconList() },
  { id: 'studios', label: 'Studios', tag: 'Studio', placeholder: 'Search studios…', hint: 'Look up a developer or publisher.', icon: STUDIO_ICON },
  { id: 'artists', label: 'Artists', tag: 'Artist', placeholder: 'Search artists…', hint: 'Find voice actors, directors and writers.', icon: ARTIST_ICON },
];
// Only these three show in the tab bar; the rest stay defined so the All
// tab can reuse their icons and old recent searches still resolve.
const TABS = ALL_TABS.filter((t) => ['games', 'people', 'all'].includes(t.id));
const TAB = Object.fromEntries(ALL_TABS.map((t) => [t.id, t]));

async function importAndOpen(g) {
  // Not-yet-catalogued: viewing is free (opens live from IGDB, see
  // renderGameView's igdbId mode in game-view.js), same as everywhere
  // else browsing works in this app — signing in only comes up if this
  // person actually tries to log/rate/save it, from that page itself.
  // Signed-in users skip straight to actually saving it, same as before.
  if (!state.user) {
    if (g.igdb_id) navigate(`/game/igdb/${g.igdb_id}`);
    else toast("Couldn't open that game.", 'error');
    return;
  }
  try {
    const saved = await api.addGame(g, state.user.id);
    navigate(`/game/${saved.id}`);
  } catch (err) {
    toast(err.message || 'Could not open that game.', 'error');
  }
}

// A cover small enough for a recent-search thumbnail.
const smallCover = (url) => (url ? igdbSized(url, 'cover_small') : null);

export function renderSearchView(root, { initialTab = 'games' } = {}) {
  let tab = TABS.some((t) => t.id === initialTab) ? initialTab : 'games';
  // Bumped by every state change (idle browse / search history / a real
  // search). renderIdleBrowse's trending fetch is the one async render in
  // this file that can resolve AFTER the user has already moved on (tapped
  // in, typed, switched tabs) — without this it can land late and clobber
  // whatever's on screen by then with stale trending results.
  let promptTicket = 0;

  // Header and tab pill are Home's own (same elements, same CSS), so the two
  // screens line up to the pixel and the header stays put while you scroll.
  root.innerHTML = `
    <header class="topbar topbar--home"><span class="topbar__logo search-title">Search</span></header>
    <div class="home-tabs">
      <nav class="home-tabs__pill search-tabs" id="search-tabs" data-active="${tab}">
        ${TABS.map((t) => `<button type="button" class="home-tabs__item${t.id === tab ? ' home-tabs__item--active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </nav>
    </div>
    <div class="view-body view-body--search">
      <form class="search-bar-row" id="search-form">
        <input type="search" id="search-input" class="search-input" placeholder="${TAB[tab].placeholder}" autocomplete="off" enterkeyhint="search">
        <a href="#/discover" class="filter-btn" id="filter-btn" aria-label="Browse and filter games">${iconFilter()}</a>
      </form>
      <div id="search-results" class="search-results">${TABS.map((t) => `<div class="search-pane" data-pane="${t.id}"${t.id === tab ? '' : ' hidden'}></div>`).join('')}</div>
    </div>` + navBar('/search');

  const input = qs('#search-input', root);
  // One pane per tab, all kept: switching tabs shows the other pane instead
  // of rebuilding it, so a tab keeps what it loaded and where it was
  // scrolled. `results` always points at the pane on screen.
  const panes = Object.fromEntries(qsa('.search-pane', root).map((el) => [el.dataset.pane, el]));
  let results = panes[tab];
  const scrollAt = {};
  let prevPane = null; // the pane a tab switch just left
  let gamesSnap = null;
  const filterBtn = qs('#filter-btn', root);
  const form = qs('#search-form', root);
  const tabsEl = qs('#search-tabs', root);

  // ONE combined history for every tab (see recordRecentSearch in
  // utils.js) — games, players, lists, studios and artists in the same
  // list, newest first, each carrying the tab it belongs to. Shown the
  // same on every tab, so switching tabs never moves or changes it. Each
  // row has a picture of what the search found (the game's poster, the
  // player's photo...), the word, and a small tag saying what kind of
  // thing it is. Separate from getRecentlyViewed's list of games actually
  // opened.
  function recentThumb(e) {
    const img = '';
    // Games (and anything showing a game cover) get a rounded square, not
    // the circle that people, studios and artists use.
    return `<span class="recent-thumb recent-thumb--${e.tab}"><span class="recent-thumb__icon">${iconSearch()}</span>${img}</span>`;
  }
  function recentSearchesBlock() {
    const entries = getRecentSearches().filter((e) => TABS.some((t) => t.id === e.tab));
    if (!entries.length) return '';
    return `
      <div class="search-recent__row">
        <p class="search-recent__heading">Recent searches</p>
        <button type="button" class="link-btn" id="clear-recent-searches">Clear</button>
      </div>
      <div class="recent-list">
        ${entries.map((e) => `
          <div class="recent-row">
            <button type="button" class="recent-row__main" data-term="${esc(e.term)}" data-tab="${esc(e.tab)}">
              ${recentThumb(e)}
              <span class="recent-row__text">
                <span class="recent-row__term">${esc(e.term)}</span>
                <span class="recent-row__tag">${TAB[e.tab].tag}</span>
              </span>
            </button>
            <button type="button" class="recent-row__x" data-delete-term="${esc(e.term)}" data-delete-tab="${esc(e.tab)}" aria-label="Remove ${esc(e.term)}">${iconClose()}</button>
          </div>`).join('')}
      </div>`;
  }

  // ---- two distinct blank-input states -------------------------------
  // IDLE (landing on the tab, box not focused yet): on Games, a poster grid
  // to browse — games you've recently looked at, or, failing that, what's
  // trending — with NO search history in it. Tapping the box is what
  // reveals your search history; just arriving on this screen isn't the
  // same as expressing intent to search. The other tabs have nothing to
  // browse, so their idle state IS the history (or a one-line hint).
  // FOCUSED (box tapped, still empty): your recent searches — the
  // history list — with no posters mixed in.
  // Paints a poster grid (or the empty-state prompt if there's nothing to
  // browse yet). Pulled out so both the instant cached paint and the
  // fresh-data repaint below can share it.
  function paintIdleGames(games, heading) {
    delete results.dataset.q; results.dataset.mode = 'idle';
    results.innerHTML = games.length
      ? `
        <p class="search-recent__heading search-idle-heading">${esc(heading)}</p>
        <div class="discovery-grid">
          ${games.map((g) => `
            <a href="${gameHref(g)}" class="discovery-tile" aria-label="${esc(g.title)}">
              ${posterFrame(g.cover_url, g.title, 'discovery-tile__cover')}
            </a>`).join('')}
        </div>`
      : emptyState(TAB.games.hint, { icon: iconSearch() });
    revealTogether(qsa('.discovery-tile', results));
  }

  const renderIdleBrowse = async (ticket) => {
    filterBtn.style.display = tab === 'games' ? '' : 'none';
    if (tab !== 'games') { renderSearchHistory(); return; }
    const viewed = getRecentlyViewed();
    if (viewed.length) { paintIdleGames(viewed, 'Recently viewed'); return; }

    // Nothing looked at yet (new user/device) — browse what's trending
    // instead of landing on an empty screen. The live trending fetch is
    // genuinely slow (an IGDB round-trip, several seconds) — same
    // paint-from-cache-then-refresh pattern the Feed/Messages tabs use,
    // so repeat visits this session are instant instead of re-eating that
    // wait every single time you tap into an empty search box.
    const cached = getCached(IDLE_TRENDING_CACHE_KEY);
    if (cached?.length) {
      paintIdleGames(cached, 'Trending now');
      try {
        const fresh = await api.getWorldTrending(12);
        setCached(IDLE_TRENDING_CACHE_KEY, fresh);
        if (ticket === promptTicket) paintIdleGames(fresh, 'Trending now');
      } catch { /* keep the cached paint already on screen */ }
      return;
    }
    // No cache yet this session — a spinner beats a blank screen for
    // however long that first fetch takes.
    results.innerHTML = spinner();
    let fresh = [];
    try { fresh = await api.getWorldTrending(12); setCached(IDLE_TRENDING_CACHE_KEY, fresh); } catch { fresh = []; }
    // The fetch above can resolve after the user has already tapped in,
    // typed, or switched tabs — a stale ticket means don't paint it.
    if (ticket !== promptTicket) return;
    paintIdleGames(fresh, 'Trending now');
  };

  const renderSearchHistory = () => {
    filterBtn.style.display = tab === 'games' ? '' : 'none';
    delete results.dataset.q; results.dataset.mode = 'history';
    results.innerHTML = recentSearchesBlock() || emptyState(TAB[tab].hint, { icon: iconSearch() });
    wireRecentSearches();
  };

  // Whichever of the two blank-input states is currently on screen —
  // used by delete/clear so they re-render the same view they're acting
  // on rather than always assuming the history one.
  let showingHistory = false;
  // Set while a sheet of our own is covering the screen. Opening one
  // blurs the search box, and the blur handler below reverts the history
  // list back to the idle poster grid — so without this, tapping "Clear"
  // visibly reset the whole screen behind the confirmation, as if the
  // Search tab had just been opened fresh.
  let overlayOpen = false;
  const showPrompt = () => { showingHistory = true; promptTicket++; renderSearchHistory(); };
  const showIdle = () => { showingHistory = false; renderIdleBrowse(++promptTicket); };

  function wireRecentSearches() {
    qsa('.recent-row__main', results).forEach((btn) => {
      btn.addEventListener('click', () => {
        // Each recent search remembers its tab — jump there first, then
        // run it (switchTab is a no-op if already on that tab). Re-running
        // also bumps it back to the top (recordRecentSearch de-dupes).
        switchTab(btn.dataset.tab);
        input.value = btn.dataset.term;
        recordRecentSearch(btn.dataset.term, btn.dataset.tab);
        doSearch();
      });
    });
    qsa('.recent-row__x', results).forEach((btn) => {
      btn.addEventListener('click', () => {
        removeRecentSearch(btn.dataset.deleteTerm, btn.dataset.deleteTab);
        // Same view, one row shorter, without losing the keyboard.
        if (showingHistory) showPrompt(); else showIdle();
      });
    });
    const clearBtn = qs('#clear-recent-searches', results);
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      // Title and two buttons, nothing else — this is a one-second
      // decision about a list of search terms, and a paragraph of
      // consequences made it read like something serious was at stake.
      overlayOpen = true;
      const ok = await confirmSheet({ title: 'Clear search history?', confirmLabel: 'Clear', danger: true });
      overlayOpen = false;
      // Either way we stay on the history view rather than falling back
      // to the idle grid: cleared, it becomes the empty state, which is
      // the honest picture of what just happened.
      if (ok) clearRecentSearches();
      showPrompt();
    });
  }

  // Landing on the tab shows the poster browse, not your search history —
  // tapping the box is what surfaces history; blurring back out of an
  // empty box returns to the poster browse.
  showIdle();
  input.addEventListener('focus', () => {
    if (!input.value.trim()) showPrompt();
  });
  // Deferred, not synchronous: tapping a recent-search row (or a poster
  // tile) blurs the input BEFORE that row's own click handler runs — a
  // synchronous revert here would tear the row's button out of the DOM
  // mid-tap, so the click never fires and nothing happens (this is
  // exactly the bug that made tapping a recent search look like it did
  // nothing / "closed the page"). Waiting lets the click complete first;
  // by then either the search ran (input.value is no longer empty) or a
  // poster navigated away entirely, so the revert becomes a no-op.
  //
  // It must also check the box didn't get focus BACK in the meantime: a
  // tab button blurs it, the tab handler refocuses it, and without this
  // check the timer then fired anyway and replaced the history list with
  // the idle screen, which is why recent searches vanished after
  // switching tabs.
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (overlayOpen || document.activeElement === input) return; // a sheet of ours took focus, or it came back
      if (!input.value.trim() && showingHistory) showIdle();
    }, 200);
  });

  // Switch the active tab and sync everything that depends on it — the
  // segmented highlight, the placeholder, and the (games-only) filter
  // button. Used both by the tab buttons and by tapping a recent search
  // that belongs to another tab.
  function switchTab(newTab) {
    if (!TABS.some((t) => t.id === newTab) || newTab === tab) return;
    const body = qs('.view-body', root);
    scrollAt[tab] = body.scrollTop;
    if (tab === 'games') gamesSnap = { allResults, renderedCount, searchPage, searchHasMore };
    // Anything still loading for the tab being left is dropped; that pane
    // is simply searched again next time it's opened.
    searchTicket++; promptTicket++; searchLoading = false;
    if (searchObserver) searchObserver.disconnect();
    prevPane = results;
    tab = newTab;
    results = panes[tab];
    Object.entries(panes).forEach(([id, el]) => { el.hidden = id !== tab; });
    body.scrollTop = scrollAt[tab] || 0;
    if (tab === 'games' && gamesSnap && results.dataset.q) {
      ({ allResults, renderedCount, searchPage, searchHasMore } = gamesSnap);
      observeSearchSentinel();
    }
    tabsEl.dataset.active = tab;
    qsa('.home-tabs__item', root).forEach(b => b.classList.toggle('home-tabs__item--active', b.dataset.tab === tab));
    input.placeholder = TAB[tab].placeholder;
    filterBtn.style.display = tab === 'games' ? '' : 'none';
    // The active tab can be off to the side of a row that scrolls.
    
  }

  // Remember whether the box had focus at the moment a tab was touched:
  // by the time the click arrives the tab button has already taken focus
  // from it.
  let hadFocus = false;
  tabsEl.addEventListener('pointerdown', () => { hadFocus = document.activeElement === input; });
  qsa('.home-tabs__item', root).forEach(btn => {
    btn.addEventListener('click', () => {
      const keepFocus = hadFocus || document.activeElement === input;
      hadFocus = false;
      switchTab(btn.dataset.tab);
      // Keep what was typed. Wiping it meant switching Games -> People
      // to check the same term made you retype it every single time.
      const q = input.value.trim();
      if (q) {
        // A tab that already has this query's results just shows them.
        if (results.dataset.q !== q) doSearch();
        input.focus();
      }
      // Box was open: the recent searches stay open, in the same place
      // (it's the same list on every tab). Box wasn't: each tab's own
      // resting screen, and no keyboard popping up just for changing tab.
      else if (keepFocus) {
        if (results.dataset.mode !== 'history') {
          if (prevPane?.dataset.mode === 'history') {
            // Same history on every tab: hand over the very same rows instead
            // of drawing them again, so nothing redraws or flickers.
            results.replaceChildren(...prevPane.childNodes);
            results.dataset.mode = 'history'; delete results.dataset.q;
            prevPane.dataset.mode = '';
          } else showPrompt();
        }
        showingHistory = true; input.focus();
      }
      else { if (results.dataset.mode !== 'idle') showIdle(); showingHistory = false; }
    });
  });

  // Bumped every keystroke. Any response whose ticket is stale by the
  // time it lands gets dropped — without this, a slow early request can
  // resolve after a newer one and overwrite fresh results with old ones.
  let searchTicket = 0;

  // Accumulated across pages so scrolling keeps extending the same list
  // rather than replacing it. One merged, relevance-ranked list now
  // (local + remote interleaved), not two separate blocks.
  let allResults = [];
  let renderedCount = 0;
  let searchPage = 1;
  let searchHasMore = false;
  let searchLoading = false;
  let searchObserver = null;
  let directorObserver = null;
  let searchGuard = null;

  const gameCallbacks = () => ({
    // Opening a result is the clearest signal the search was real, so
    // that's where the query gets written into history.
    onLocal: (g) => { recordRecentSearch(input.value.trim(), tab, smallCover(g.cover_url)); navigate(`/game/${g.id}`); },
    onRemote: (g) => { recordRecentSearch(input.value.trim(), tab, smallCover(g.cover_url)); return importAndOpen(g); },
  });

  // Draws the first page of results, or — with `append` — only the rows
  // that weren't on screen yet, under the ones that were. Redrawing the
  // whole list for every page made every poster flash and fade in again
  // each time more results arrived.
  function paintGameResults(items, { append = false } = {}) {
    allResults = items;
    const list = qs('.result-list', results);
    let added;
    if (append && list) {
      list.insertAdjacentHTML('beforeend', combinedGameResultsList(items.slice(renderedCount), { offset: renderedCount, rowsOnly: true }));
      added = [...list.children].slice(renderedCount);
      qs('#search-sentinel', results)?.remove();
      qs('#search-more', results)?.remove();
    } else {
      results.innerHTML = combinedGameResultsList(items);
      added = qsa('.result-row', results);
    }
    renderedCount = items.length;
    // Infinite scroll: the sentinel below the list triggers the next page
    // as it comes into view, so there's a spinner instead of a "Load
    // more" button to press. The button is kept only as the no-JS-observer
    // fallback (see observeSearchSentinel), hidden unless it's needed.
    if (searchHasMore) {
      results.insertAdjacentHTML('beforeend', `<div id="search-sentinel" aria-hidden="true"></div>
           <div class="search-more" id="search-more">${spinner()}</div>`);
    }
    wireCombinedGameResults(results, items, gameCallbacks());
    revealTogether(added);
    if (directorObserver) directorObserver.disconnect();
    directorObserver = wireResultDirectors(results, items, api);
    observeSearchSentinel();
  }

  function observeSearchSentinel() {
    if (searchObserver) searchObserver.disconnect();
    const sentinel = qs('#search-sentinel', results);
    if (!sentinel) return;
    // Without IntersectionObserver there's nothing to trigger auto-load,
    // so the spinner would spin forever — fall back to a real button.
    if (!('IntersectionObserver' in window)) {
      const more = qs('#search-more', results);
      if (more) {
        more.innerHTML = `<button class="btn btn--ghost btn--block" id="search-load-more">Load more</button>`;
        qs('#search-load-more', more).addEventListener('click', loadMoreResults);
      }
      return;
    }
    searchObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMoreResults();
    }, { root: results.closest('.view-body') || null, rootMargin: '1200px' });
    searchObserver.observe(sentinel);
    // The scroll itself is watched too, so a fast fling that arrives while
    // a page is still loading is picked up as soon as that page lands.
    if (searchGuard) searchGuard.stop();
    searchGuard = keepLoading({ sentinel: () => qs('#search-sentinel', results), scroller: () => results.closest('.view-body'), trigger: () => loadMoreResults(), margin: 1200 });
  }

  async function loadMoreResults() {
    if (searchLoading || !searchHasMore) return;
    searchLoading = true;
    const q = input.value.trim();
    const ticket = searchTicket;
    try {
      searchPage += 1;
      const res = await api.searchGamesEverywhere(q, 40, searchPage);
      if (ticket !== searchTicket) return; // a newer search started mid-flight
      // Dedupe against what's already listed — IGDB paging can repeat
      // entries near page boundaries.
      const seen = new Set(allResults.map((g) => g.title.trim().toLowerCase()));
      const fresh = res.results.filter((g) => !seen.has(g.title.trim().toLowerCase()));
      searchHasMore = res.hasMore && fresh.length > 0;
      paintGameResults([...allResults, ...fresh], { append: true });
    } catch {
      searchHasMore = false;
    } finally {
      searchLoading = false;
    }
  }

  // ---- results for the tabs that aren't games --------------------------
  // One row shape for players aside (those keep profileRow): picture on the
  // left (round for people, square for logos, poster-shaped for a list),
  // name, one line of detail, chevron. `term` is what gets written into
  // history when the row is opened.
  function entityRow({ href, shape, img, fallbackIcon, title, meta, thumb }) {
    return `
      <a href="${esc(href)}" class="entity-row" data-record-thumb="${esc(thumb || '')}">
        <span class="entity-row__pic entity-row__pic--${shape}">
          <span class="entity-row__icon">${fallbackIcon}</span>
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
        </span>
        <span class="entity-row__info">
          <span class="entity-row__title">${esc(title)}</span>
          ${meta ? `<span class="entity-row__meta">${esc(meta)}</span>` : ''}
        </span>
        <span class="entity-row__chev">${iconChevronRight()}</span>
      </a>`;
  }
  const paintEntityRows = (rows, emptyMsg) => {
    if (!rows.length) { results.innerHTML = emptyState(emptyMsg, { icon: iconSearch() }); return; }
    results.innerHTML = `<div class="entity-list">${rows.join('')}</div>`;
    // Opening any row means the search mattered: write it into history,
    // with the row's picture beside it.
    qsa('.entity-row', results).forEach((a) =>
      a.addEventListener('click', () => recordRecentSearch(input.value.trim(), tab, a.dataset.recordThumb || null)));
  };

  // Runs live as you type (debounced 300ms from the input handler below,
  // so this only ever fires once typing has genuinely paused — not on
  // every keystroke) as well as on Enter. A query that comes back with
  // real results is recorded into history right here, for every tab
  // equally. A query with no results doesn't get saved either way;
  // there's nothing useful to revisit.
  async function doSearch() {
    const q = input.value.trim();
    if (!q) { showPrompt(); return; }
    promptTicket++; // invalidate any in-flight idle-browse fetch
    const ticket = ++searchTicket;
    // Fresh state per query — otherwise page counters and accumulated
    // results leak from the previous search into the new one.
    searchPage = 1; searchHasMore = false; searchLoading = false;
    allResults = []; renderedCount = 0;
    if (searchObserver) searchObserver.disconnect();
    delete results.dataset.q; delete results.dataset.mode;
    const paneAtStart = results;
    try {
      if (tab === 'games') {
        // Clear the previous query's results IMMEDIATELY. The old code
        // only replaced them when the new query had local matches, so
        // searching something with no local hits left the last search's
        // results sitting on screen — which is exactly why typing
        // "winter" could still show Alan Wake and Elden Ring.
        results.innerHTML = skeletonList(5);

        // Deliberately a SINGLE paint, once every source has answered.
        // There used to be an extra early paint of local-catalogue-only
        // hits here, on the theory that showing something instantly beats
        // showing a skeleton. In practice it read as a bug: a search
        // would display a short list of already-logged games, sit there,
        // and then visibly rewrite itself with the full results a moment
        // later — which looked like the app had served a stale or cached
        // answer first. The skeleton now stays up until the real results
        // are ready, so the list only ever appears once, complete.
        const { results: found, hasMore } = await api.searchGamesEverywhere(q, 40, 1);
        if (ticket !== searchTicket) return;
        searchPage = 1; searchHasMore = !!hasMore; searchLoading = false;
        paintGameResults(found);
        if (found.length) recordRecentSearch(q, tab, smallCover(found[0].cover_url), { guess: true });
      } else if (tab === 'people') {
        results.innerHTML = skeletonList(4);
        const people = await api.searchUsers(q);
        if (ticket !== searchTicket) return;
        if (!people.length) {
          results.innerHTML = emptyState(`No one found for "${q}".`, { icon: iconSearch() });
        } else {
          recordRecentSearch(q, tab, people[0].avatar_url, { guess: true });
          const followingSet = await api.getFollowingIdSet(state.user?.id);
          if (ticket !== searchTicket) return;
          results.innerHTML = `<div class="profile-list">${people.map(p =>
            profileRow(p, p.id === state.user?.id ? {} : { following: followingSet.has(p.id) })
          ).join('')}</div>`;
          // Opening a player's profile, or following them, both mean the
          // player search mattered — record it into history at that point
          // (not on every keystroke).
          qsa('.profile-row__link', results).forEach((a) =>
            a.addEventListener('click', () => recordRecentSearch(input.value.trim(), tab, a.querySelector('img')?.getAttribute('src') || people[0].avatar_url)));
          wireFollowButtons(results, {
            onToggle: async (userId, wasFollowing) => {
              recordRecentSearch(input.value.trim(), tab, people[0].avatar_url);
              if (!state.user) { promptSignIn('Sign in to follow players.'); throw new Error('not signed in'); }
              try {
                if (wasFollowing) await api.unfollow(state.user.id, userId);
                else await api.follow(state.user.id, userId);
              } catch (err) {
                toast(err.message || 'Could not update follow status.', 'error');
                throw err;
              }
            },
          });
        }
      } else if (tab === 'all') {
        results.innerHTML = skeletonList(6);
        // Everything at once; a source that fails or drags (artists and
        // studios hit outside services) just leaves its section out.
        const soft = (p, ms = 5000) => Promise.race([p.catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
        const [g, pe, li, st, ar] = await Promise.all([
          soft(api.searchGamesEverywhere(q, 12, 1), 8000), soft(api.searchUsers(q)), soft(api.searchLists(q, 6)),
          soft(api.searchStudios(q, 6)), soft(api.searchArtists(q, 6)),
        ]);
        if (ticket !== searchTicket) return;
        const games = g?.results || [], people = pe || [], lists = li || [], studios = st || [], artists = ar || [];
        const sections = [];
        const section = (label, tabId, total, shown, rows) => {
          if (!rows.length) return;
          sections.push(`<div class="all-head"><span class="all-head__label">${label}</span>${total > shown && (tabId === 'games' || tabId === 'people') ? `<button type="button" class="all-head__more" data-see-all="${tabId}">See all</button>` : ''}</div><div class="entity-list">${rows.join('')}</div>`);
        };
        const gShown = games.slice(0, 3);
        section('Games', 'games', games.length, gShown.length, gShown.map((x) => entityRow({
          href: gameHref(x), shape: 'round', img: null, fallbackIcon: iconSearch(), thumb: '',
          title: x.title, meta: x.release_year || x.year || '',
        })));
        section('People', 'people', people.length, 2, people.slice(0, 2).map((x) => entityRow({
          href: `#/profile/${x.username}`, shape: 'round', img: null, fallbackIcon: iconSearch(), thumb: '',
          title: x.display_name || x.username, meta: `@${x.username}`,
        })));
        section('Lists', 'lists', lists.length, 2, lists.slice(0, 2).map((l) => entityRow({
          href: `#/list/${l.id}`, shape: 'round', img: null, fallbackIcon: iconSearch(), thumb: '',
          title: l.name, meta: [l.owner ? `by ${l.owner.display_name || l.owner.username}` : '', `${l.count} game${l.count === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
        })));
        section('Studios', 'studios', studios.length, 2, studios.slice(0, 2).map((x) => entityRow({
          href: `#/studio/${x.id}`, shape: 'round', img: null, fallbackIcon: iconSearch(), thumb: '',
          title: x.name, meta: [x.year ? `Founded ${x.year}` : '', x.games ? `${x.games} game${x.games === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '),
        })));
        section('Artists', 'artists', artists.length, 2, artists.slice(0, 2).map((x) => entityRow({
          href: `#/person/${x.qid}`, shape: 'round', img: null, fallbackIcon: iconSearch(), thumb: '',
          title: x.name, meta: x.description,
        })));
        if (!sections.length) { results.innerHTML = emptyState(`Nothing found for "${q}".`, { icon: iconSearch() }); return; }
        results.innerHTML = sections.join('');
        // Recent searches show no pictures any more, so nothing to keep.
        recordRecentSearch(q, tab);
        qsa('.entity-row', results).forEach((a) =>
          a.addEventListener('click', () => recordRecentSearch(input.value.trim(), tab)));
        // "See all" jumps to that kind's own tab and runs the same search.
        qsa('[data-see-all]', results).forEach((b) => b.addEventListener('click', () => { switchTab(b.dataset.seeAll); doSearch(); }));
      } else if (tab === 'lists') {
        results.innerHTML = skeletonList(4);
        const lists = await api.searchLists(q);
        if (ticket !== searchTicket) return;
        paintEntityRows(lists.map((l) => entityRow({
          href: `#/list/${l.id}`, shape: 'poster', img: smallCover(l.cover_url), fallbackIcon: TAB.lists.icon, thumb: smallCover(l.cover_url),
          title: l.name,
          meta: [l.owner ? `by ${l.owner.display_name || l.owner.username}` : '', `${l.count} game${l.count === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
        })), `No lists found for "${q}".`);
        if (lists.length) recordRecentSearch(q, tab, smallCover(lists[0].cover_url), { guess: true });
      } else if (tab === 'studios') {
        results.innerHTML = skeletonList(4);
        const studios = await api.searchStudios(q);
        if (ticket !== searchTicket) return;
        paintEntityRows(studios.map((s) => entityRow({
          href: `#/studio/${s.id}`, shape: 'logo', img: s.logo, fallbackIcon: TAB.studios.icon, thumb: s.logo,
          title: s.name, meta: [s.year ? `Founded ${s.year}` : '', s.games ? `${s.games} game${s.games === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '),
        })), `No studios found for "${q}".`);
        if (studios.length) recordRecentSearch(q, tab, studios[0].logo, { guess: true });
      } else {
        results.innerHTML = skeletonList(4);
        const artists = await api.searchArtists(q);
        if (ticket !== searchTicket) return;
        paintEntityRows(artists.map((a) => entityRow({
          href: `#/person/${a.qid}`, shape: 'round', img: a.photo, fallbackIcon: TAB.artists.icon, thumb: a.photo,
          title: a.name, meta: a.description,
        })), `No artists found for "${q}".`);
        if (artists.length) recordRecentSearch(q, tab, artists[0].photo, { guess: true });
      }
      if (ticket === searchTicket && results === paneAtStart && results.children.length) results.dataset.q = q;
    } catch (err) {
      if (ticket !== searchTicket) return;
      results.innerHTML = `<p class="muted">Search failed: ${esc(err.message)}</p>`;
    }
  }

  // Enter (or the keyboard's search key) is a deliberate search, so it
  // records into history and runs immediately.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    recordRecentSearch(input.value.trim(), tab);
    doSearch();
    // Submitting is the point at which you want to LOOK at the results,
    // and on a phone the keyboard is covering half of them. Dropping
    // focus is what dismisses it; the blur handler above is a no-op
    // here because the box is not empty.
    input.blur();
  });

  // Search-as-you-type: run the search a short beat after typing stops,
  // so results appear live with no need to press Enter. Debounced to one
  // request per pause rather than one per keystroke, and it does NOT
  // touch history (only submit / re-tapping a past search / opening a
  // result do), so partial words never pile up in the recent list.
  // Clearing the box drops straight back to the prompt.
  let typeTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(typeTimer);
    const q = input.value.trim();
    // Anything shorter than a real query drops the results, it does not
    // merely decline to fetch new ones. Returning early here left the
    // PREVIOUS query's list sitting on screen: backspacing "Alan Wake"
    // down to "A" still showed Alan Wake, which reads as the app
    // ignoring the search box.
    if (q.length < 2) {
      searchTicket++; // any in-flight search is now for a query that no longer exists
      if (searchObserver) searchObserver.disconnect();
      if (directorObserver) directorObserver.disconnect();
      allResults = []; renderedCount = 0; searchHasMore = false; searchLoading = false;
      showPrompt();
      return;
    }
    typeTimer = setTimeout(() => doSearch(), 300);
  });

}
