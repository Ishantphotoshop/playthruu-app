import * as api from '../api.js';
import { state } from '../state.js';
import {
  topBar, navBar, homeTabs, feedSectionHead, activityCard, emptyState, spinner, skeletonRow, iconStamp, iconUser, iconFilter,
  trendingStrip, wireTrendingStrip, friendsPlayingCard, posterFrame, openReportSheet, iconChevronRight,
} from '../components.js';
import { toast, qs, qsa, esc, timeAgo, enableSwipeToDismiss, promptSignIn, tapFeedback, pulseLogTab } from '../utils.js';
import { openLogComposer } from './log-composer.js';
import { refreshCurrentView, navigate } from '../router.js';
import { paintStoryRail } from './stories.js';
import { getCached, setCached } from '../cache.js';

const FEED_CACHE_KEY = 'feed';
const NEWS_CACHE_KEY = 'news';

// Feed and News behave as one segmented pair now, exactly like Search's
// Games/Players tabs — a plain client-side swap of what's painted into
// the same body, not two destinations you navigate between. /news is
// still a real route (still deep-linkable/bookmarkable), it just lands
// here with News pre-selected instead of rendering its own separate page.
export async function renderFeedView(root, { initialTab = 'feed' } = {}) {
  let activeTab = initialTab;
  // No bell up here any more — while the messenger is archived (see
  // MESSENGER_ARCHIVED, config.js) its old nav-bar slot is itself a
  // notification bell, so having a second one in the header was just a
  // duplicate of the same destination.
  root.innerHTML = topBar('', { home: true }) + homeTabs(activeTab) + `<div class="view-body" id="feed-body"></div>` + navBar('/feed');
  wireStamp(root);
  const body = qs('#feed-body', root);
  wirePullToRefresh(body);

  qsa('.home-tabs__item', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === activeTab) return;
      activeTab = tab;
      qsa('.home-tabs__item', root).forEach((b) => b.classList.toggle('home-tabs__item--active', b === btn));
      paintActiveTab();
    });
  });

  function paintActiveTab() {
    return activeTab === 'news' ? paintNewsTab(body) : paintFeedTab(body);
  }

  await paintActiveTab();
}

async function paintFeedTab(body) {
  // Reopening the feed after a visit earlier this session paints
  // whatever was on screen last time immediately (fully visible, not
  // hidden behind feed-body--loading) instead of an empty skeleton —
  // that gap, however brief, is what read as "reloading every time I
  // switch tabs". The four sections below still refetch and repaint
  // themselves in place right after, exactly as before; the cache only
  // fills the wait with the last known-good content instead of nothing.
  const cachedSections = getCached(FEED_CACHE_KEY);

  // The loading spinner is a SIBLING of the section wrapper below, not
  // nested inside it — feed-body--loading hides that wrapper via
  // opacity:0, and anything inside an invisible element is invisible
  // too, so the spinner would disappear right along with everything
  // else it's there to stand in for.
  body.innerHTML = `
    <div id="announce-slot"></div>
    <div id="story-slot"></div>
    <div class="view-loading" id="feed-loading" hidden>${spinner()}</div>
    <div id="feed-sections" class="${cachedSections ? '' : 'feed-body--loading'}">
      ${cachedSections || `
        <div id="trending-section"></div>
        <div id="friends-section"></div>
        <div id="activity-section"><h2 class="section-heading">Currently playing</h2>${skeletonRow()}</div>
        <div id="foryou-section"></div>
        <div id="discovery-section"></div>
      `}
    </div>
  `;

  // Deliberately OUTSIDE #feed-sections, which is what gets cached and
  // replayed on the next visit — a banner that had since been switched
  // off would otherwise keep reappearing from that cache. This slot is
  // always painted from a live read instead.
  paintAnnouncement(qs('#announce-slot', body));
  // Also outside #feed-sections, and for the same reason: stories expire
  // after 24 hours, so a cached-and-replayed rail would show rings for
  // things that are already gone.
  paintStoryRail(qs('#story-slot', body));

  // The sections used to be painted independently and each one revealed
  // itself the moment its own request came back, so opening the feed
  // showed rows popping in one after another and the page reflowing
  // under the reader — it looked like the app reloading every visit.
  // The whole section list is now hidden until every section has
  // settled, then revealed in a single step. The spinner itself only
  // shows up if that wait actually runs long — most opens settle in
  // well under 200ms, and flashing a spinner for a fraction of a second
  // reads as jankier than showing nothing at all. allSettled: one slow
  // or failing section must not hold the rest hostage, since each
  // already renders its own empty/error state. Skipped entirely when a
  // cached feed is already fully visible — there's nothing to hide.
  const loadingEl = qs('#feed-loading', body);
  const showLoadingTimer = cachedSections ? null : setTimeout(() => { loadingEl.hidden = false; }, 200);
  await Promise.allSettled([
    paintTrending(qs('#trending-section', body)),
    paintFriendsPlaying(qs('#friends-section', body)),
    paintCurrentlyPlaying(qs('#activity-section', body)),
    paintForYou(qs('#foryou-section', body)),
    paintDiscovery(qs('#discovery-section', body)),
  ]);
  if (showLoadingTimer) clearTimeout(showLoadingTimer);
  qs('#feed-sections', body)?.classList.remove('feed-body--loading');
  loadingEl?.remove();
  setCached(FEED_CACHE_KEY, qs('#feed-sections', body)?.innerHTML || '');
}

// A banner pushed from the admin build. Renders nothing at all in the
// normal case (no active announcement), so the feed is untouched unless
// there's genuinely something to say.
async function paintAnnouncement(slot) {
  if (!slot) return;
  let announcement = null;
  try {
    announcement = await api.getActiveAnnouncement();
  } catch {
    return;
  }
  if (!announcement) return;

  const body = `
    <span class="announce__dot"></span>
    <span class="announce__text">${esc(announcement.message)}</span>
    ${announcement.link ? `<span class="announce__chev">${iconChevronRight()}</span>` : ''}`;

  slot.innerHTML = announcement.link
    ? `<a class="announce" href="${esc(announcement.link)}" target="_blank" rel="noopener noreferrer">${body}</a>`
    : `<div class="announce">${body}</div>`;
}

// Articles link straight out to the publisher (target="_blank") rather
// than opening in-app — this is an aggregator, not a reader, and these
// outlets' own pages are where the ads/analytics that fund them live.
// A post written in the admin build may have no link at all, though, and
// an <a href=""> would "navigate" to the current page on tap — so those
// render as a plain, non-clickable card instead.
function newsCard(article) {
  const tag = article.link ? 'a' : 'div';
  const linkAttrs = article.link
    ? ` href="${esc(article.link)}" target="_blank" rel="noopener noreferrer"`
    : '';
  return `
    <${tag} class="news-card${article.isCustom ? ' news-card--own' : ''}"${linkAttrs}>
      <span class="news-card__cover" style="${article.image ? `background-image:url('${esc(article.image)}')` : ''}"></span>
      <span class="news-card__info">
        <span class="news-card__title">${esc(article.title)}</span>
        ${article.summary ? `<span class="news-card__summary">${esc(article.summary)}</span>` : ''}
        <span class="news-card__meta">${esc(article.source)} · ${timeAgo(article.pubDate)}</span>
      </span>
    </${tag}>`;
}

async function paintNewsTab(body) {
  // Same reasoning as paintFeedTab's cache above — the news-proxy Edge
  // Function already caches merged articles for 10 minutes server-side,
  // but that still costs a round trip and a spinner on every tab switch.
  const cachedList = getCached(NEWS_CACHE_KEY);
  body.innerHTML = `<div id="news-list">${cachedList || spinner()}</div>`;

  const listEl = qs('#news-list', body);
  const articles = await api.getGameNews();
  if (!listEl.isConnected) return; // switched tabs again before this landed

  if (articles.length) {
    const html = `<div class="news-list">${articles.map(newsCard).join('')}</div>`;
    listEl.innerHTML = html;
    setCached(NEWS_CACHE_KEY, html);
  } else if (!cachedList) {
    // Only replace the screen with an error when there's nothing already
    // showing — a background refetch hiccup shouldn't yank away
    // headlines that were displaying just fine a moment ago.
    listEl.innerHTML = emptyState("Couldn't load news right now. Try again in a bit.");
  }
}

const DISCOVERY_CACHE_KEY = 'discovery';

// "Bored? Try these" — an endless vertical list that changes with the
// picked collection. Sits last on the feed on purpose: social content
// first, then something to fall into when there's nothing new from
// friends. Auto-loads the next page as you approach the bottom, with a
// manual button as a fallback for browsers without IntersectionObserver.
//
// Posters only — no title, no "because you..." line. The reason line
// used to be here on the argument that a suggestion which cannot say
// why is indistinguishable from a list of popular games. In practice it
// turned a row of artwork into a row of small print, and the section
// already earns its place by WHAT it contains: games like the ones you
// have actually been playing lately (see getRecommendations), none of
// which are already in your diary.
//
// Renders nothing at all when there is nothing personal to say, rather
// than falling back to something generic under a "picked for you"
// heading, which would be a lie about where it came from.
async function paintForYou(slot) {
  if (!slot || !state.user) return;
  let picks = [];
  try {
    picks = await api.getRecommendations(state.user.id, { limit: 12 });
  } catch {
    slot.innerHTML = '';
    return;
  }
  if (!picks.length) { slot.innerHTML = ''; return; }

  // feedSectionHead (with no see-more), not a bare <h2>: every other
  // section on this page is built from it, and one section using a
  // different wrapper is exactly why the gap above this one was 8px
  // tighter than the gap above all the others.
  slot.innerHTML = `
    ${feedSectionHead('Picked for you')}
    <div class="foryou-strip" id="foryou-strip">
      ${picks.map((p, i) => `
        <button type="button" class="foryou-card" data-idx="${i}" aria-label="${esc(p.game.title)}">
          ${posterFrame(p.game.cover_url, p.game.title, 'foryou-card__cover')}
        </button>`).join('')}
    </div>`;

  qsa('.foryou-card', slot).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pick = picks[Number(btn.dataset.idx)];
      if (!pick) return;
      // A friend's recommendation already points at a real row; an IGDB
      // one has to be added before there is a page to open.
      if (pick.local) { navigate(`/game/${pick.game.id}`); return; }
      btn.disabled = true;
      try {
        const saved = await api.addGame(pick.game, state.user.id);
        navigate(`/game/${saved.id}`);
      } catch (err) {
        toast(err.message || 'Could not open that game.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// stateful (page, scroll position through a paginated list, which mood
// is active) — the outer feed-level cache only ever snapshotted its
// rendered HTML, so switching tabs and back always threw that state
// away and restarted from page 1. Caches {activeId, page, hasMore,
// games} here instead, so a revisit resumes exactly where it left off
// with no refetch at all, not just a faster-looking one.
async function paintDiscovery(slot) {
  const cached = getCached(DISCOVERY_CACHE_KEY);
  let activeId = cached?.activeId || api.DISCOVERY_COLLECTIONS[0].id;
  let page = cached?.page || 1;
  let hasMore = cached?.hasMore ?? true;
  let loading = false;
  let games = cached?.games || [];
  let observer = null;

  function activeCollection() {
    return api.DISCOVERY_COLLECTIONS.find((c) => c.id === activeId);
  }

  function skeletonTiles(n) {
    return Array.from({ length: n }, () => `<div class="skeleton skeleton--tile"></div>`).join('');
  }

  function shell() {
    slot.innerHTML = `
      <div class="feed-section-head">
        <h2 class="section-heading">Bored? Try these</h2>
        <button type="button" class="filter-btn filter-btn--sm" id="discovery-filter" aria-label="Change collection">
          ${iconFilter()}
        </button>
      </div>
      <div class="discovery-grid" id="discovery-list">${games.length ? rowsHtml(games, 0) : skeletonTiles(9)}</div>
      <div id="discovery-more"></div>`;
    qs('#discovery-filter', slot).addEventListener('click', openPicker);
    if (games.length) wireRows(qs('#discovery-list', slot));
  }

  // Posters only, no titles or metadata — the artwork is the hook here,
  // and stripping the text is what lets four fit per row without the
  // grid turning into a wall of clipped labels. Tap through for detail;
  // double-tap (Instagram/Letterboxd-style) quick-saves it to the
  // backlog without leaving the grid — see wireRows below.
  function rowsHtml(batch, offset) {
    return batch.map((g, i) => `
      <button type="button" class="discovery-tile" data-idx="${offset + i}" aria-label="${esc(g.title)}${g.gotyYear ? ` — ${g.gotyYear} Game of the Year` : ''}">
        ${posterFrame(g.cover_url, g.title, 'discovery-tile__cover')}
        ${g.gotyYear ? `<span class="discovery-goty-badge">${g.gotyYear}</span>` : ''}
        <span class="discovery-tile__saved" aria-hidden="true">${iconBookmarkFilled()}</span>
      </button>`).join('');
  }

  function wireRows(container) {
    qsa('.discovery-tile', container).forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      let lastTap = 0;
      btn.addEventListener('click', async () => {
        const g = games[Number(btn.dataset.idx)];
        if (!g) return;
        const now = Date.now();
        const isDoubleTap = now - lastTap < 320;
        lastTap = now;

        if (isDoubleTap) {
          if (!state.user) { promptSignIn('Sign in to save games.'); return; }
          if (btn.dataset.saving) return;
          btn.dataset.saving = '1';
          try {
            const saved = await api.addGame(g, state.user.id);
            await api.createLog({ game_id: saved.id, user_id: state.user.id, status: 'backlog', is_public: true });
            pulseLogTab();
            tapFeedback();
            const badge = qs('.discovery-tile__saved', btn);
            badge.classList.remove('is-popping'); void badge.offsetWidth; badge.classList.add('is-popping');
            toast(`Saved ${saved.title} to your backlog.`, 'success');
          } catch (err) {
            toast(err.message || 'Could not save that game.', 'error');
          } finally {
            delete btn.dataset.saving;
          }
          return;
        }

        btn.disabled = true;
        try {
          const saved = await api.addGame(g, state.user.id);
          navigate(`/game/${saved.id}`);
        } catch (err) {
          toast(err.message || 'Could not open that game.', 'error');
          btn.disabled = false;
        }
      });
    });
  }

  // The scroll container is .view-body (it owns overflow-y), not the
  // window — so the observer has to watch inside it or it would fire
  // immediately and load every page at once.
  function observeSentinel() {
    if (observer) observer.disconnect();
    const sentinel = qs('#discovery-sentinel', slot);
    if (!sentinel || !('IntersectionObserver' in window)) return;
    const scrollRoot = slot.closest('.view-body') || null;
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root: scrollRoot, rootMargin: '400px' });
    observer.observe(sentinel);
  }

  function paintFooter() {
    const moreEl = qs('#discovery-more', slot);
    if (!moreEl) return;
    if (loading) {
      moreEl.innerHTML = `<div class="discovery-grid">${Array.from({length:8},()=>`<div class="skeleton skeleton--tile"></div>`).join("")}</div>`;
      return;
    }
    if (!hasMore) {
      moreEl.innerHTML = games.length
        ? `<p class="discovery-end">That's everything in this collection.</p>`
        : `<p class="muted">Nothing here right now — try another mood.</p>`;
      return;
    }
    // Sentinel drives auto-loading; the button is a visible fallback and
    // an escape hatch if the observer never fires.
    moreEl.innerHTML = `
      <div id="discovery-sentinel" aria-hidden="true"></div>
      <button class="btn btn--ghost btn--block" id="discovery-load-more">Load more</button>`;
    qs('#discovery-load-more', moreEl).addEventListener('click', loadMore);
    observeSentinel();
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    paintFooter();
    try {
      // GOTY is a fixed, finite curated list (see resolveGotyWinners in
      // api.js), not a browseGames() filter like every other collection
      // here — one full page, then hasMore is simply false, no real
      // pagination needed.
      const isGoty = activeCollection().id === 'goty';
      const collection = activeCollection();
      // A rotating collection starts further into its own ranking
      // depending on the fortnight (see rotationPage in api.js), so the
      // row genuinely turns over instead of showing the same twelve
      // games until the end of time. Scrolling for more still walks
      // forward from wherever that landed.
      const startPage = collection.rotates ? api.rotationPage() : 1;
      const res = isGoty
        ? { games: page === 1 ? await api.resolveGotyWinners() : [], hasMore: false }
        : await api.browseGames({ ...collection.params, page: page + startPage - 1 });
      const listEl = qs('#discovery-list', slot);
      const offset = games.length;
      // Only games WITH cover art — the grid is poster-only, so a
      // cover-less game just renders as an empty box, which is what made
      // the grid look like it was loading unevenly.
      const withCovers = res.games.filter((g) => g.cover_url);
      games = [...games, ...withCovers];
      hasMore = res.hasMore;
      page += 1;
      if (listEl) {
        // First page replaces the skeleton tiles shell() painted rather
        // than appending after them — every later page still appends.
        if (offset === 0) listEl.innerHTML = rowsHtml(withCovers, 0);
        else listEl.insertAdjacentHTML('beforeend', rowsHtml(withCovers, offset));
        wireRows(listEl);
      }
      setCached(DISCOVERY_CACHE_KEY, { activeId, page, hasMore, games });
    } catch {
      hasMore = false;
      const moreEl = qs('#discovery-more', slot);
      if (moreEl) moreEl.innerHTML = `<p class="muted">Couldn't load more right now.</p>`;
      loading = false;
      return;
    }
    loading = false;
    paintFooter();
  }

  function openPicker() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal mood-sheet">
        <header class="modal__header"><h2>What are you into?</h2><button class="modal__close" data-close aria-label="Close">&times;</button></header>
        <div class="modal__body">
          <div class="mood-list">
            ${api.DISCOVERY_COLLECTIONS.map((c, i) => `
              <button type="button" class="mood-row${c.id === activeId ? ' mood-row--active' : ''}" data-id="${c.id}">
                <span class="mood-row__index">${String(i + 1).padStart(2, '0')}</span>
                <span class="mood-row__label">${esc(c.label)}</span>
                <span class="mood-row__arrow" aria-hidden="true">→</span>
              </button>`).join('')}
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    const close = () => { overlay.remove(); document.body.style.overflow = ''; };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    qs('[data-close]', overlay).addEventListener('click', close);
    enableSwipeToDismiss(qs('.modal', overlay), close);
    qsa('.mood-row', overlay).forEach((btn) => {
      btn.addEventListener('click', () => {
        activeId = btn.dataset.id;
        close();
        reset();
      });
    });
  }

  // Full reset whenever the collection changes — without clearing page
  // and games here, switching mood would append the new collection onto
  // the old one and paginate from wherever the last one left off.
  function reset() {
    if (observer) observer.disconnect();
    page = 1; hasMore = true; loading = false; games = [];
    shell();
    loadMore();
  }

  // A cache hit means there's already at least one real page of games
  // restored above — paint those and wire the "load more"/sentinel
  // footer against the real hasMore, with no fetch at all. Only a
  // genuinely first-ever visit (or a manually picked new mood, via
  // reset() above) actually hits the network.
  if (games.length) {
    shell();
    paintFooter();
  } else {
    reset();
  }
}

async function paintTrending(slot) {
  // Only blank the section to a skeleton when it's actually empty — when
  // a cached feed already painted real content into it (see
  // renderFeedView), overwriting that synchronously here would erase the
  // instant paint the cache exists to provide, replacing it with a
  // loading skeleton for the entire time this fetch is in flight.
  if (!slot.innerHTML.trim()) slot.innerHTML = `<h2 class="section-heading">Trending now</h2>${skeletonRow()}`;
  try {
    // Was limit 5 — bumped to 15 so there's enough here for the "see
    // more" icon's >12 threshold to ever actually trigger; still just
    // one horizontally-scrollable strip either way.
    const games = await api.getWorldTrending(15, 10);
    if (!games.length) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      ${feedSectionHead('Trending now', { seeMoreHref: '/trending', count: games.length })}
      ${trendingStrip(games)}`;
    wireTrendingStrip(slot, games, {
      onSelect: async (g) => {
        try {
          const saved = await api.addGame(g, state.user.id);
          navigate(`/game/${saved.id}`);
        } catch (err) {
          toast(err.message || 'Could not open that game.', 'error');
        }
      },
    });
  } catch {
    slot.innerHTML = '';
  }
}

async function paintFriendsPlaying(slot) {
  // Same reasoning as paintTrending above.
  if (!slot.innerHTML.trim()) slot.innerHTML = `<h2 class="section-heading">Friend's recent activity</h2>${skeletonRow()}`;
  try {
    // Was limit 12 — bumped to 15, same reasoning as Trending above.
    const entries = await api.getFriendsPlaying(state.user.id, 15);
    if (!entries.length) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      ${feedSectionHead("Friend's recent activity", { seeMoreHref: '/friends-playing', count: entries.length })}
      <div class="trending-strip">${entries.map((e, i) => friendsPlayingCard(e, i)).join('')}</div>`;
  } catch {
    slot.innerHTML = '';
  }
}

// Distinct on purpose from "Friends Recently Played" (which includes
// anything logged recently, playing OR played) — this is specifically
// what people you follow have marked as in-progress right now.
async function paintCurrentlyPlaying(slot) {
  // Same reasoning as paintTrending/paintFriendsPlaying above — this
  // heading used to live as a static sibling outside this function
  // entirely, which was the one section not owning its own heading the
  // way the other two do, so it couldn't carry a "see more" icon either.
  if (!slot.innerHTML.trim()) slot.innerHTML = `<h2 class="section-heading">Currently playing</h2>${skeletonRow()}`;
  try {
    // Was 30 — the only one of the three feed strips fetching more than
    // Trending/Friends' shared 15, which just meant an unbounded-feeling
    // strip as more people marked games "playing" instead of the same
    // capped single-scroll every other row keeps to.
    const { logs, isFallback } = await api.getFeed(state.user.id, 15, 'playing');

    if (!logs.length) {
      slot.innerHTML = `
        <h2 class="section-heading">Currently playing</h2>
        ${isFallback
          ? emptyState('Nobody\'s currently playing anything yet. Be the first to log one.', { icon: iconStamp(), actionLabel: 'Log your first game', actionRoute: '/log' })
          : emptyState('The people you follow aren\'t currently playing anything.', { icon: iconUser(), actionLabel: 'Find people to follow', actionRoute: '/people' })}`;
      return;
    }

    // The strip itself shows at most 12 — logs.length (up to 15) still
    // goes to feedSectionHead's count so "see more" still shows up
    // correctly whenever there's more than the 12 on display.
    slot.innerHTML = `
      ${feedSectionHead('Currently playing', { seeMoreHref: '/currently-playing', count: logs.length })}
      ${isFallback ? `<div class="banner">You're not following anyone yet — here's what's happening across Playthruu. <a href="#/people">Find people to follow</a></div>` : ''}
      <div class="trending-strip">
        ${logs.slice(0, 12).map((l) => activityCard(l)).join('')}
      </div>`;
  } catch (err) {
    slot.innerHTML = `
      <h2 class="section-heading">Currently playing</h2>
      <p class="muted" style="padding:24px">Couldn't load current activity: ${err.message}</p>`;
  }
}

// Filled variant just for the double-tap "saved" badge — the outline
// iconBookmark() in components.js is for buttons that toggle state;
// this one only ever flashes on briefly, so it reads better solid.
function iconBookmarkFilled() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3.8h12a1 1 0 0 1 1 1V20.5l-7-4.1-7 4.1V4.8a1 1 0 0 1 1-1z"/></svg>`;
}

function wireStamp(root) {
  // the center "Log" nav button opens the modal directly instead of routing
  const logTab = qs('.tabbar__item--primary', root);
  if (logTab) {
    logTab.addEventListener('click', (e) => {
      e.preventDefault();
      openLogComposer({ onSaved: () => refreshCurrentView() });
    });
  }
}

// Pull-down-to-refresh, touch only. Only engages when the feed is
// already scrolled to the very top — pulling from mid-scroll is just a
// normal scroll, not a refresh gesture. refreshCurrentView() re-runs
// this whole function fresh, which tears down the indicator along with
// everything else, so there's nothing to clean up on success.
export function wirePullToRefresh(body) {
  const THRESHOLD = 64;
  const indicator = document.createElement('div');
  indicator.className = 'pull-refresh';
  indicator.innerHTML = `<span class="pull-refresh__spinner"></span>`;
  body.prepend(indicator);

  let startY = 0, tracking = false, dragging = false, refreshing = false;

  body.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || refreshing || body.scrollTop > 0) return;
    // Re-attach if the view has repainted its own body since this was
    // wired. The Feed does exactly that — the indicator is prepended
    // when the shell is built, and then every section paint replaces
    // body.innerHTML, taking the indicator with it. The listeners here
    // survive (they are on the body itself), so the gesture still ran,
    // silently, against a detached element: no arrow, no spinner, no
    // sign the pull had registered at all.
    if (!indicator.isConnected) body.prepend(indicator);
    startY = e.clientY; tracking = true; dragging = false;
  });

  body.addEventListener('pointermove', (e) => {
    if (!tracking || refreshing) return;
    const dy = e.clientY - startY;
    if (dy <= 0 || body.scrollTop > 0) { tracking = false; return; }
    dragging = true;
    e.preventDefault();
    const pull = Math.min(dy * 0.5, 90);
    indicator.style.transform = `translateY(${pull}px)`;
    indicator.style.opacity = String(Math.min(1, pull / THRESHOLD));
    indicator.classList.toggle('pull-refresh--ready', pull >= THRESHOLD);
  }, { passive: false });

  const end = async () => {
    if (!tracking || !dragging) { tracking = false; dragging = false; return; }
    tracking = false; dragging = false;
    const pulled = parseFloat((indicator.style.transform.match(/[\d.]+/) || ['0'])[0]);
    if (pulled >= THRESHOLD && !refreshing) {
      refreshing = true;
      indicator.classList.add('pull-refresh--spinning');
      indicator.style.transform = `translateY(${THRESHOLD}px)`;
      indicator.style.opacity = '1';
      try { await refreshCurrentView(); } catch { /* the view's own error state handles this */ }
    } else {
      indicator.style.transform = ''; indicator.style.opacity = '0';
      indicator.classList.remove('pull-refresh--ready');
    }
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
}

export function wireLogCards(container, logs) {
  // Spoiler reviews stay blurred until deliberately revealed. One-way
  // on purpose — once you've read it, re-hiding it is pointless.
  qsa('[data-spoiler]', container).forEach((el) => {
    el.addEventListener('click', () => el.classList.add('is-revealed'));
  });

  qsa('[data-action="toggle-like"]', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      // Game pages are now reachable while signed out (see
      // landing-view.js) — without this guard, tapping like here would
      // throw trying to read state.user.id on null.
      if (!state.user) { promptSignIn('Sign in to like this.'); return; }
      const logId = btn.dataset.logId;
      const liked = btn.classList.contains('like-btn--liked');
      btn.disabled = true;
      try {
        await api.toggleLike(state.user.id, logId, liked);
        if (!liked) tapFeedback(); // only on liking, not un-liking — matches the log sheet's love/save pattern
        btn.classList.toggle('like-btn--liked');
        const span = qs('span', btn);
        let n = parseInt(span.textContent || '0', 10) || 0;
        n += liked ? -1 : 1;
        span.textContent = n > 0 ? n : '';
      } catch (err) {
        toast(err.message || 'Could not update like.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  qsa('[data-action="report-log"]', container).forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.user) { promptSignIn('Sign in to report content.'); return; }
      const log = logs.find(l => l.id === btn.dataset.logId);
      openReportSheet({
        targetType: 'log',
        targetId: btn.dataset.logId,
        subject: log?.games?.title ? `Review of ${log.games.title}` : '',
        onSubmit: api.reportContent,
      });
    });
  });

  qsa('[data-action="edit-log"]', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const log = logs.find(l => l.id === btn.dataset.logId);
      if (!log) return;
      openLogComposer({
        existingLog: log,
        onSaved: () => refreshCurrentView(),
      });
    });
  });
}
