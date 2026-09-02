import * as api from '../api.js';
import { state } from '../state.js';
import { navBar, combinedGameResultsList, wireCombinedGameResults, profileRow, wireFollowButtons, spinner, skeletonList, emptyState, iconSearch, iconFilter, posterFrame } from '../components.js';
import { qs, qsa, esc, toast, promptSignIn, getRecentlyViewed, recordRecentSearch, getRecentSearches, removeRecentSearch, clearRecentSearches } from '../utils.js';
import { navigate } from '../router.js';

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

export function renderSearchView(root) {
  let tab = 'games';

  root.innerHTML = `
    <div class="view-body view-body--no-topbar view-body--search">
      <div class="segmented segmented--wide" id="search-tabs">
        <button class="segmented__item segmented__item--active" data-tab="games">Games</button>
        <button class="segmented__item" data-tab="people">Players</button>
      </div>
      <form class="search-bar-row" id="search-form">
        <input type="search" id="search-input" class="search-input" placeholder="Search games…" autocomplete="off" enterkeyhint="search">
        <a href="#/discover" class="filter-btn" id="filter-btn" aria-label="Browse and filter all games">${iconFilter()}</a>
      </form>
      <div id="search-results" class="search-results"></div>
    </div>` + navBar('/search');

  const input = qs('#search-input', root);
  const results = qs('#search-results', root);
  const filterBtn = qs('#filter-btn', root);
  const form = qs('#search-form', root);

  // The actual typed terms — Games and Players keep separate histories
  // (see recordRecentSearch in utils.js), since a game title showing up
  // while searching for players was just confusing. Separate from
  // getRecentlyViewed's list of games actually opened.
  function recentSearchesBlock() {
    const terms = getRecentSearches(tab);
    if (!terms.length) return '';
    return `
      <div class="search-recent__row">
        <p class="search-recent__heading">Recent searches</p>
        <button type="button" class="link-btn" id="clear-recent-searches">Clear</button>
      </div>
      <div class="recent-search-list">
        ${terms.map((t) => `
          <div class="recent-search-row">
            <button type="button" class="recent-search-row__delete" data-delete-term="${esc(t)}">Delete</button>
            <button type="button" class="recent-search-row__content" data-term="${esc(t)}">
              ${iconSearch()}<span>${esc(t)}</span>
            </button>
          </div>`).join('')}
      </div>`;
  }

  const showPrompt = async () => {
    filterBtn.style.display = tab === 'games' ? '' : 'none';
    const recentSearches = recentSearchesBlock();
    if (tab === 'people') {
      results.innerHTML = recentSearches || emptyState('Search for players to follow and see what they\'re playing.', { icon: iconSearch() });
      wireRecentSearches();
      return;
    }
    // A quick trail back to games you've actually looked at recently —
    // kept on-device (see recordRecentlyViewed in utils.js), so it works
    // even before signing in. Only shown on the blank prompt, never
    // mixed into real search results.
    const recent = getRecentlyViewed();
    results.innerHTML = recentSearches + (recent.length
      ? `
        <p class="search-recent__heading">Recently viewed</p>
        <div class="discovery-grid">
          ${recent.map((g) => `
            <a href="#/game/${g.id}" class="discovery-tile" aria-label="${esc(g.title)}">
              ${posterFrame(g.cover_url, g.title, 'discovery-tile__cover')}
            </a>`).join('')}
        </div>`
      : (recentSearches ? '' : emptyState('Search for a game to log, rate, or review.', { icon: iconSearch() })));
    wireRecentSearches();
    return;
  };

  function wireRecentSearches() {
    qsa('.recent-search-row__content', results).forEach((btn) => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.term;
        // Tapping a past search re-runs it AND bumps it back to the top of
        // the history (recordRecentSearch de-dupes then unshifts).
        recordRecentSearch(btn.dataset.term, tab);
        doSearch();
      });
    });
    qsa('.recent-search-row__delete', results).forEach((btn) => {
      btn.addEventListener('click', () => {
        removeRecentSearch(btn.dataset.deleteTerm, tab);
        showPrompt();
      });
    });
    qsa('.recent-search-row', results).forEach(wireSwipeToReveal);
    const clearBtn = qs('#clear-recent-searches', results);
    if (clearBtn) clearBtn.addEventListener('click', () => { clearRecentSearches(tab); showPrompt(); });
  }

  // Left-swipe-to-delete, the same gesture a phone's call log uses: drag
  // the row's visible content left and the red Delete button underneath
  // is revealed by exactly as much as it's dragged — not a fixed reveal
  // amount. Past the threshold, releasing snaps it fully open (delete is
  // still a deliberate tap, never an accidental full-swipe delete);
  // short of it, it springs back closed.
  function wireSwipeToReveal(row) {
    const content = qs('.recent-search-row__content', row);
    const REVEAL = 84; // px of Delete button width to expose when open
    let startX = 0, dx = 0, candidate = false, dragging = false, open = false;

    content.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return; // touch affordance only
      startX = e.clientX; dx = 0; candidate = true; dragging = false;
    });
    content.addEventListener('pointermove', (e) => {
      if (!candidate) return;
      dx = e.clientX - startX + (open ? -REVEAL : 0);
      if (!dragging) {
        if (Math.abs(dx) > 6) { dragging = true; try { content.setPointerCapture(e.pointerId); } catch { /* fine */ } }
        else return;
      }
      const clamped = Math.min(0, Math.max(-REVEAL, dx));
      content.style.transition = 'none';
      content.style.transform = `translateX(${clamped}px)`;
    });
    const settle = (e) => {
      if (!candidate) return;
      const wasDragging = dragging;
      candidate = false; dragging = false;
      try { content.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (!wasDragging) { if (open) closeRow(); return; } // a tap while open just closes it back up
      if (dx < -REVEAL / 2) {
        content.style.transition = 'transform 0.18s ease';
        content.style.transform = `translateX(-${REVEAL}px)`;
        open = true;
      } else closeRow();
    };
    function closeRow() {
      content.style.transition = 'transform 0.18s ease';
      content.style.transform = 'translateX(0)';
      open = false;
    }
    content.addEventListener('pointerup', settle);
    content.addEventListener('pointercancel', settle);
  }

  showPrompt();

  qsa('.segmented__item', root).forEach(btn => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      qsa('.segmented__item', root).forEach(b => b.classList.toggle('segmented__item--active', b === btn));
      input.placeholder = tab === 'games' ? 'Search games…' : 'Search players…';
      // Keep what was typed. Wiping it meant switching Games -> People
      // to check the same term made you retype it every single time.
      if (input.value.trim()) doSearch();
      else showPrompt();
      input.focus();
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
  let searchPage = 1;
  let searchHasMore = false;
  let searchLoading = false;
  let searchObserver = null;

  function paintGameResults(items) {
    allResults = items;
    // Infinite scroll: the sentinel below the list triggers the next page
    // as it comes into view, so there's a spinner instead of a "Load
    // more" button to press. The button is kept only as the no-JS-observer
    // fallback (see observeSearchSentinel), hidden unless it's needed.
    results.innerHTML = combinedGameResultsList(items)
      + (searchHasMore ? `<div id="search-sentinel" aria-hidden="true"></div>
           <div class="search-more" id="search-more">${spinner()}</div>` : '');
    wireCombinedGameResults(results, items, {
      // Opening a result is the clearest signal the search was real, so
      // that's where the query gets written into history.
      onLocal: (g) => { recordRecentSearch(input.value.trim(), tab); navigate(`/game/${g.id}`); },
      onRemote: (g) => { recordRecentSearch(input.value.trim(), tab); importAndOpen(g); },
    });
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
    }, { root: results.closest('.view-body') || null, rootMargin: '400px' });
    searchObserver.observe(sentinel);
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
      paintGameResults([...allResults, ...fresh]);
    } catch {
      searchHasMore = false;
    } finally {
      searchLoading = false;
    }
  }

  // Runs live as you type (debounced from the input handler below) as
  // well as on Enter. It does NOT write to the recent-search history —
  // if it did, every partial keystroke ("g", "go", "god"…) would pile up
  // there. History is recorded only on a deliberate act: submitting, re-
  // tapping a past search, or opening a result (see the handlers below).
  async function doSearch() {
    const q = input.value.trim();
    if (!q) { showPrompt(); return; }
    const ticket = ++searchTicket;
    // Fresh state per query — otherwise page counters and accumulated
    // results leak from the previous search into the new one.
    searchPage = 1; searchHasMore = false; searchLoading = false;
    allResults = [];
    if (searchObserver) searchObserver.disconnect();
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
      } else {
        results.innerHTML = skeletonList(4);
        const people = await api.searchUsers(q);
        if (ticket !== searchTicket) return;
        if (!people.length) {
          results.innerHTML = emptyState(`No one found for "${q}".`, { icon: iconSearch() });
        } else {
          const followingSet = await api.getFollowingIdSet(state.user?.id);
          results.innerHTML = `<div class="profile-list">${people.map(p =>
            profileRow(p, p.id === state.user?.id ? {} : { following: followingSet.has(p.id) })
          ).join('')}</div>`;
          // Opening a player's profile, or following them, both mean the
          // player search mattered — record it into history at that point
          // (not on every keystroke).
          qsa('.profile-row__link', results).forEach((a) =>
            a.addEventListener('click', () => recordRecentSearch(input.value.trim(), tab)));
          wireFollowButtons(results, {
            onToggle: async (userId, wasFollowing) => {
              recordRecentSearch(input.value.trim(), tab);
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
      }
    } catch (err) {
      results.innerHTML = `<p class="muted">Search failed: ${esc(err.message)}</p>`;
    }
  }

  // Enter (or the keyboard's search key) is a deliberate search, so it
  // records into history and runs immediately.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    recordRecentSearch(input.value.trim(), tab);
    doSearch();
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
    if (!q) { showPrompt(); return; }
    if (q.length < 2) return; // wait for a real query before hitting the network
    typeTimer = setTimeout(() => doSearch(), 300);
  });
}
