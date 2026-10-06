import * as api from '../api.js';
import { state } from '../state.js';
import {
  topBar, navBar, homeTabs, feedSectionHead, activityCard, emptyState, spinner, skeletonRow, iconStamp, iconUser, iconFilter,
  trendingStrip, wireTrendingStrip, friendsPlayingCard, posterFrame, openReportSheet, iconChevronRight,
  iconDice, iconBookmark, iconBrandMark, iconCardStack, iconPlay,
} from '../components.js';
import { toast, qs, qsa, esc, timeAgo, enableSwipeToDismiss, promptSignIn, tapFeedback, pulseLogTab, igdbSized, placeholderCover } from '../utils.js';
import { buzz } from '../haptics.js';
import { openLogComposer } from './log-composer.js';
import { refreshCurrentView, navigate, markPagesStale } from '../router.js';
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

// Every article is PlayThruu's own, published on playthruu.com, and the
// card opens it there (new tab, so the app stays where it was). The meta
// line carries the story's verification status — Confirmed / Reported /
// Rumor / Leak — so a rumour never reads like settled news. A card with no
// link renders as a plain, non-clickable div, since <a href=""> would
// "navigate" to the current page on tap.
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
        <span class="news-card__meta">${esc(article.source)}${article.status ? ` · ${esc(article.status)}` : ''} · ${timeAgo(article.pubDate)}</span>
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
//
// The strip shows FORYOU_SHOWN picks; the rest of the ranked pool waits
// behind them. Whenever anything is logged, from anywhere (double-tap
// here, the hold composer, a game page), every visible pick now in the
// diary fades out and the next one from the pool takes its place. When
// the pool runs low it is rebuilt, which also folds in whatever was just
// played as a new seed.
const FORYOU_SHOWN = 12;
let forYouOnLogs = null;

async function paintForYou(slot) {
  if (!slot || !state.user) return;
  const userId = state.user.id;
  let pool = [];
  try {
    pool = await api.getRecommendations(userId);
  } catch {
    slot.innerHTML = '';
    return;
  }
  if (!pool.length) { slot.innerHTML = ''; return; }

  const shown = pool.splice(0, FORYOU_SHOWN);
  const seen = new Set(shown.map((p) => p.game.igdb_id));
  pool.forEach((p) => seen.add(p.game.igdb_id));

  // feedSectionHead (with no see-more), not a bare <h2>: every other
  // section on this page is built from it, and one section using a
  // different wrapper is exactly why the gap above this one was 8px
  // tighter than the gap above all the others.
  slot.innerHTML = `
    ${feedSectionHead('Picked for you')}
    <div class="foryou-strip" id="foryou-strip">${shown.map(cardHtml).join('')}</div>`;
  const strip = qs('#foryou-strip', slot);
  qsa('.foryou-card', strip).forEach((btn, i) => wireCard(btn, shown[i]));

  function cardHtml(p) {
    return `
      <button type="button" class="foryou-card" data-igdb-id="${esc(String(p.game.igdb_id ?? ''))}" data-year="${esc(String(p.game.release_year ?? ''))}" aria-label="${esc(p.game.title)}">
        ${posterFrame(p.game.cover_url, p.game.title, 'foryou-card__cover')}
        <span class="discovery-tile__saved" aria-hidden="true">${iconBookmarkFilled()}</span>
      </button>`;
  }

  // Tap opens the game; double-tap saves it to the backlog. The single
  // tap waits out the double-tap window first, otherwise the first tap
  // of a double would already be navigating away.
  function wireCard(btn, pick) {
    let timer = null;
    btn.addEventListener('click', () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        quickSave(btn, pick);
        return;
      }
      timer = setTimeout(() => { timer = null; open(btn, pick); }, 260);
    });
  }

  async function open(btn, pick) {
    btn.disabled = true;
    try {
      const saved = await api.addGame(pick.game, userId);
      navigate(`/game/${saved.id}`);
    } catch (err) {
      toast(err.message || 'Could not open that game.', 'error');
      btn.disabled = false;
    }
  }

  async function quickSave(btn, pick) {
    if (btn.dataset.saving) return;
    btn.dataset.saving = '1';
    const badge = qs('.discovery-tile__saved', btn);
    badge.classList.remove('is-popping'); void badge.offsetWidth; badge.classList.add('is-popping');
    tapFeedback();
    try {
      const saved = await api.addGame(pick.game, userId);
      await api.createLog({ game_id: saved.id, user_id: userId, status: 'backlog', is_public: true });
      markPagesStale();
      pulseLogTab();
      toast(`Saved ${saved.title} to your backlog.`, 'success');
      // createLog fires logs:changed, which swaps this card out.
    } catch (err) {
      toast(err.message || 'Could not save that game.', 'error');
      delete btn.dataset.saving;
    }
  }

  async function nextPick(diary) {
    for (;;) {
      if (pool.length < 4 && !nextPick.refilling) {
        nextPick.refilling = api.getRecommendations(userId).then((fresh) => {
          fresh.forEach((p) => { if (!seen.has(p.game.igdb_id)) { seen.add(p.game.igdb_id); pool.push(p); } });
        }).catch(() => {}).finally(() => { nextPick.refilling = null; });
      }
      if (!pool.length && nextPick.refilling) await nextPick.refilling;
      const p = pool.shift();
      if (!p) return null;
      if (!diary.igdb.has(p.game.igdb_id)) return p;
    }
  }

  async function onLogs() {
    if (!strip.isConnected) { window.removeEventListener('logs:changed', onLogs); return; }
    let diary;
    try { diary = await api.getDiaryGameKeys(userId); } catch { return; }
    const gone = qsa('.foryou-card', strip).filter((btn) => diary.igdb.has(Number(btn.dataset.igdbId)));
    for (const btn of gone) {
      const next = await nextPick(diary);
      btn.classList.add('is-leaving');
      await new Promise((r) => setTimeout(r, 380)); // past the save badge pop
      if (!next) { btn.remove(); continue; }
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(next).trim();
      const card = tmp.firstElementChild;
      card.classList.add('is-entering');
      btn.replaceWith(card);
      wireCard(card, next);
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('is-entering')));
    }
    if (!qs('.foryou-card', strip)) slot.innerHTML = '';
    setCached(FEED_CACHE_KEY, qs('#feed-sections')?.innerHTML || '');
  }

  if (forYouOnLogs) window.removeEventListener('logs:changed', forYouOnLogs);
  forYouOnLogs = onLogs;
  window.addEventListener('logs:changed', onLogs);
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
  // Posters go on screen 12 at a time (four full rows of 3); games
  // fetched beyond that wait in `games` until the next scroll. A page of
  // results is 20 minus whatever has no cover, so appending pages as
  // they came left ragged rows (8, then 1-3-3-2).
  const BATCH = 12;
  // The next page is fetched in the background as soon as a block is on
  // screen, so scrolling to the end rarely waits on the network.
  let prefetching = null;
  let shown = Math.min(games.length, cached?.shown ?? (Math.floor(games.length / BATCH) * BATCH || games.length));
  const more = () => games.length > shown || hasMore;
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
        <div class="feed-section-head__actions">
          <button type="button" class="filter-btn filter-btn--sm random-btn" id="discovery-random" aria-label="Pick a random game">
            ${iconDice()}
          </button>
          <button type="button" class="filter-btn filter-btn--sm" id="discovery-filter" aria-label="Change collection">
            ${iconFilter()}
          </button>
        </div>
      </div>
      <div class="discovery-grid" id="discovery-list">${shown ? rowsHtml(games.slice(0, shown), 0) : skeletonTiles(BATCH)}</div>
      <div id="discovery-sentinel" aria-hidden="true"></div>
      <div id="discovery-more"></div>`;
    qs('#discovery-filter', slot).addEventListener('click', openPicker);
    qs('#discovery-random', slot).addEventListener('click', openDraw);
    if (games.length) wireRows(qs('#discovery-list', slot));
    observeSentinel();
  }

  // Posters only, no titles or metadata — the artwork is the hook here,
  // and stripping the text is what lets four fit per row without the
  // grid turning into a wall of clipped labels. Tap through for detail;
  // double-tap (Instagram/Letterboxd-style) quick-saves it to the
  // backlog without leaving the grid — see wireRows below.
  function rowsHtml(batch, offset) {
    return batch.map((g, i) => `
      <button type="button" class="discovery-tile" data-idx="${offset + i}" data-igdb-id="${esc(String(g.igdb_id ?? ''))}" data-year="${esc(String(g.release_year ?? g.year ?? ''))}" aria-label="${esc(g.title)}${g.gotyYear ? ` — ${g.gotyYear} Game of the Year` : ''}">
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
            markPagesStale();
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

  // Infinite scroll, no button. One observer on a sentinel that sits
  // right under the grid and never moves or gets rebuilt; it fires about
  // a screen and a half early, so the next posters are usually in place
  // before you get there. The scroll container is .view-body, not the
  // window.
  function observeSentinel() {
    if (observer) observer.disconnect();
    const sentinel = qs('#discovery-sentinel', slot);
    if (!sentinel || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root: slot.closest('.view-body') || null, rootMargin: '0px 0px 1200px 0px' });
    observer.observe(sentinel);
  }
  // Still in range after a block went in (a fast fling): observing again
  // reports the current state, which carries straight on to the next.
  function recheckSentinel() {
    const sentinel = qs('#discovery-sentinel', slot);
    if (observer && sentinel) { observer.unobserve(sentinel); observer.observe(sentinel); }
  }

  // Only ever the end-of-list or empty message. Loading is shown inside
  // the grid itself (see loadMore), so nothing down here changes height
  // while you scroll, which is what made the grid jump and flicker.
  function paintFooter() {
    const moreEl = qs('#discovery-more', slot);
    if (!moreEl) return;
    moreEl.innerHTML = more() || loading ? ''
      : games.length ? `<p class="discovery-end">That's everything in this collection.</p>`
        : `<p class="muted">Nothing here right now — try another mood.</p>`;
  }

  // Warm the image cache for posters that are fetched but not shown yet,
  // so a new block paints its covers at once instead of popping in.
  function preload(list) {
    list.forEach((g) => { if (g.cover_url) { const im = new Image(); im.decoding = 'async'; im.src = igdbSized(g.cover_url, 'cover_big'); } });
  }

  async function fetchPage() {
    // GOTY is a fixed, finite curated list (see resolveGotyWinners in
    // api.js), not a browseGames() filter like every other collection
    // here — one full page, then hasMore is simply false.
    const collection = activeCollection();
    const forId = activeId;
    const isGoty = collection.id === 'goty';
    // A rotating collection starts further into its own ranking
    // depending on the fortnight (see rotationPage in api.js), so the
    // row genuinely turns over. Scrolling for more walks forward from
    // wherever that landed.
    const startPage = collection.rotates ? api.rotationPage() : 1;
    const res = isGoty
      ? { games: page === 1 ? await api.resolveGotyWinners() : [], hasMore: false }
      : await api.browseGames({ ...collection.params, page: page + startPage - 1 });
    if (forId !== activeId) return; // switched collection mid-fetch
    // Only games WITH cover art — the grid is poster-only.
    games = [...games, ...res.games.filter((g) => g.cover_url)];
    hasMore = res.hasMore;
    page += 1;
  }

  async function loadMore() {
    if (loading || !more()) return;
    loading = true;
    const startActive = activeId;
    const listEl = qs('#discovery-list', slot);
    // Placeholders go INTO the grid, the same size as posters, and are
    // swapped for them in place, so the page never grows then shrinks.
    // Skipped when the next block is already fetched.
    if (listEl && shown) {
      listEl.insertAdjacentHTML('beforeend', Array.from({ length: BATCH }, () => `<div class="skeleton skeleton--tile" data-ph></div>`).join(''));
    }
    try {
      if (prefetching) await prefetching;
      while (games.length - shown < BATCH && hasMore) await fetchPage();
    } catch {
      hasMore = false;
    }
    if (startActive !== activeId) return; // the collection changed meanwhile
    const batch = games.slice(shown, shown + BATCH);
    // The frames go in straight away (their shimmer is the loading
    // state) and each cover fades up inside its own frame as it arrives;
    // see .poster-frame__img. Covers are usually already cached by the
    // prefetch, so most fade in almost at once.
    if (listEl) {
      if (shown === 0) listEl.innerHTML = '';
      else qsa('[data-ph]', listEl).forEach((ph) => ph.remove());
      if (batch.length) {
        listEl.insertAdjacentHTML('beforeend', rowsHtml(batch, shown));
        wireRows(listEl);
      }
    }
    shown += batch.length;
    setCached(DISCOVERY_CACHE_KEY, { activeId, page, hasMore, games, shown });
    if (drawPool.id !== activeId || drawPool.games.length < 3) setTimeout(() => refillDrawPool().catch(() => {}), 1500);
    loading = false;
    // Fetch the next block now and warm its images, while this one is
    // being looked at.
    if (games.length - shown < BATCH && hasMore && !prefetching) {
      prefetching = fetchPage().catch(() => {}).finally(() => { prefetching = null; preload(games.slice(shown, shown + BATCH)); });
    } else {
      preload(games.slice(shown, shown + BATCH));
    }
    if (!batch.length && !games.length) {
      const moreEl = qs('#discovery-more', slot);
      if (moreEl) moreEl.innerHTML = `<p class="muted">Couldn't load this right now.</p>`;
      return;
    }
    paintFooter();
    if (more()) recheckSentinel();
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

  // Random pick as a card draw. The collection being viewed becomes a
  // deck: it riffles twice, the top card lifts to show genre and year on
  // its back (a beat of anticipation before the game itself), then flips.
  // Three action cards deal out underneath: Draw another, Open, Want to
  // play. Picks don't repeat within a collection until every loaded game
  // has come up once. Tapping the dark area mid-draw skips to the result.
  const drawn = { collection: null, keys: new Set() };
  // Random-pick candidates, filled from random pages of the collection a
  // page at a time. Warmed in the background once the grid is up, so the
  // first card of a draw doesn't wait on the network either.
  const drawPool = { id: null, games: [] };
  const drawKey = (g) => g.igdb_id ?? g.id ?? g.title;
  async function refillDrawPool() {
    const collection = activeCollection();
    if (drawPool.id !== collection.id) { drawPool.id = collection.id; drawPool.games = []; }
    if (collection.id === 'goty') return;
    const pg = 1 + Math.floor(Math.random() * 40);
    const res = await Promise.race([
      api.browseGames({ ...collection.params, page: pg }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 3500)),
    ]);
    if (drawPool.id !== activeCollection().id) return;
    const pool = drawPool.games;
    (res.games || []).forEach((g) => {
      if (g.cover_url && !drawn.keys.has(drawKey(g)) && !pool.some((x) => drawKey(x) === drawKey(g))) pool.push(g);
    });
  }
  function openDraw() {
    if (!games.length) { toast('Still loading this collection. Try again in a second.'); return; }
    const collection = activeCollection();
    if (drawn.collection !== collection.id) { drawn.collection = collection.id; drawn.keys.clear(); }
    const overlay = document.createElement('div');
    overlay.className = 'draw-overlay';
    overlay.innerHTML = `
      <button type="button" class="modal__close draw-close" data-close aria-label="Close">&times;</button>
      <div class="draw" role="dialog" aria-label="Random pick from ${esc(collection.label)}">
        <div class="draw-scene">
          <div class="draw-stage"></div>
        </div>
        <div class="draw-info" aria-live="polite">
          <h2 class="draw-title"><span></span></h2>
          <i class="draw-rule"></i>
          <p class="draw-meta"></p>
          <div class="draw-crew"></div>
        </div>
        <div class="draw-actions">
          <button type="button" class="draw-act draw-act--go" data-open><span>Open<br>the game</span></button>
          <button type="button" class="draw-act" data-save><span>Want<br>to play</span></button>
          <button type="button" class="draw-act" data-draw><span>Draw<br>again</span></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const drawEl = qs('.draw', overlay);
    const stage = qs('.draw-stage', overlay);
    const infoEl = qs('.draw-info', overlay);
    const titleEl = qs('.draw-title span', overlay);
    const ruleEl = qs('.draw-rule', overlay);
    const metaEl = qs('.draw-meta', overlay);
    const crewEl = qs('.draw-crew', overlay);
    const acts = qsa('.draw-act', overlay);
    // People you follow, fetched once per draw session; each pick's friend
    // activity is looked up alongside its art, so it's there on reveal.
    const followingP = state.user ? api.getFollowingIdSet(state.user.id).catch(() => new Set()) : Promise.resolve(new Set());
    let crew = [];
    const btnDraw = qs('[data-draw]', overlay);
    const btnOpen = qs('[data-open]', overlay);
    const btnSave = qs('[data-save]', overlay);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const keyOf = (g) => g.igdb_id ?? g.id ?? g.title;
    const anims = [];
    let token = 0;
    let busy = false;
    let skip = false;
    let pick = null;
    let current = null;   // the case that is out of the shelf
    let lastSlot = -1;

    // One tween helper for everything on this screen. The element's inline
    // style is the source of truth: every animation ends by writing its
    // final values there and cancelling itself, so nothing is left holding
    // a fill, a resize can re-lay-out cleanly, and Skip is just "finish
    // whatever is running".
    const dur = (ms) => (reduce ? 1 : ms);
    function tween(el, keyframes, opt, final) {
      const a = el.animate(keyframes, { fill: 'both', ...opt, duration: dur(opt.duration), delay: reduce ? 0 : (opt.delay || 0) });
      anims.push(a);
      return a.finished.then(() => {
        if (final) Object.assign(el.style, final);
        a.cancel();
      }, () => { /* cancelled by close() */ }).then(() => {
        const k = anims.indexOf(a);
        if (k >= 0) anims.splice(k, 1);
      });
    }
    const pause = (ms) => (skip || reduce ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() {
      token++;
      anims.forEach((a) => { try { a.cancel(); } catch { /* already gone */ } });
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', close);
      window.removeEventListener('resize', onResize);
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', close);
    overlay.__dismiss = () => close();
    qs('[data-close]', overlay).addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (busy) { skip = true; anims.forEach((a) => { try { a.finish(); } catch { /* already gone */ } }); return; }
      if (e.target === overlay || e.target === drawEl || e.target.classList.contains('draw-scene') || e.target === stage) close();
    });

    const genreOf = (g) => (g.genre || '').split(',')[0].replace('Role-playing (RPG)', 'RPG').trim();

    // Fully random: a random page deep into the collection's own ranking
    // (not just what is loaded on screen), falling back to the loaded
    // games if the request fails or comes back empty. The seen-set covers
    // both sources so nothing repeats within a session.
    const seen = drawn.keys;
    const localPick = () => {
      let fresh = games.filter((g) => !seen.has(keyOf(g)));
      if (!fresh.length) fresh = games.slice();
      return fresh[Math.floor(Math.random() * fresh.length)];
    };
    if (drawPool.id !== collection.id) { drawPool.id = collection.id; drawPool.games = []; }
    const pool = drawPool.games;
    const refill = refillDrawPool;
    async function choose() {
      if (pool.length < 3) {
        const filling = refill().catch(() => {});
        if (!pool.length) await filling; // otherwise it tops up in the background
      }
      const g = pool.length ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : localPick();
      seen.add(keyOf(g));
      return g;
    }
    // The NEXT pick is chosen and its art downloaded and decoded while the
    // current one is on screen, so Draw only has to play the animation.
    const artOf = (g) => (g.cover_url ? igdbSized(g.cover_url, '720p') : placeholderCover(g.title));
    function prepare() {
      return choose().then((g) => {
        const art = artOf(g);
        const im = new Image();
        im.decoding = 'async';
        im.src = art;
        const ready = im.decode().catch(() => {});
        const friends = followingP.then((ids) => api.getFriendActivityForGame(g, ids)).catch(() => []);
        return { g, art, ready, friends };
      });
    }
    let nextUp = prepare(); // starts while the shelf is still coming in

    // ------------------------------------------------------------ layout
    // A shelf of game cases standing side by side, drawn in real 3D: each
    // case is a box (cover, two edges, a back) so it has true thickness
    // when it is angled, and the whole row is turned a little toward the
    // middle. Each case is built at the size it will be when pulled out
    // and scaled DOWN to stand on the shelf, never the other way round:
    // scaling a small layer up leaves the artwork soft, and a cover that
    // arrives blurry is the opposite of the moment.
    const RATIO = 0.72; // width / height of a game case
    let M = null;
    function measure() {
      const vw = overlay.clientWidth || window.innerWidth;
      const vh = overlay.clientHeight || window.innerHeight;
      const wide = vw >= 700;
      // Four on a phone so each case has presence, five on a large
      // phone or small tablet, seven on a desktop.
      const n = wide ? 7 : vw >= 480 ? 5 : 4;
      const gap = wide ? 12 : 8;
      // What is left for the shelf once the title block, the three buttons
      // and the screen's own padding are taken out.
      const availH = Math.max(200, vh - 56 - 24 - 56 - 108 - 24);
      const fw = Math.min(214, vw * 0.54, availH * 0.8 * RATIO);
      const fh = fw / RATIO;
      const cw = Math.min(110, (Math.min(vw, 720) - 32 - gap * (n - 1)) / n);
      const s = cw / fw;
      const ch = fh * s;
      const sh = fh + 28;
      const restBottom = sh / 2 + ch / 2;
      return { n, gap, fw, fh, fd: Math.max(12, fw * 0.13), cw, s, ch, sh, restBottom, restY: restBottom - fh, featY: (sh - fh) / 2 };
    }
    const mid = () => (M.n - 1) / 2;
    const slotX = (i) => (i - mid()) * (M.cw + M.gap);
    // Turned in toward the middle, a few degrees more at each end.
    const slotA = (i) => ((i - mid()) / mid()) * -20;
    const slotZ = (i) => -Math.abs(i - mid()) * 3;
    const restT = (i, lift = 0) => `translate3d(${slotX(i)}px, ${M.restY - lift}px, ${slotZ(i)}px) rotateY(${slotA(i)}deg) scale(${M.s})`;
    const pullT = (i) => `translate3d(${slotX(i)}px, ${M.restY - 16}px, 80px) rotateY(${slotA(i) * 0.6}deg) scale(${M.s * 1.08})`;
    const featT = () => `translate3d(0px, ${M.featY}px, 70px) rotateY(0deg) scale(1)`;
    const casesEl = () => qsa('.draw-case', stage);

    function applyLayout() {
      M = measure();
      stage.style.setProperty('--sh', `${M.sh}px`);
      stage.style.setProperty('--fw', `${M.fw}px`);
      stage.style.setProperty('--fh', `${M.fh}px`);
      stage.style.setProperty('--fd', `${M.fd}px`);
      const span = (M.n * (M.cw + M.gap) + 28) * 1.04; // the wall sits back in depth, so it is drawn a little smaller
      const wall = qs('.draw-wall', stage);
      const board = qs('.draw-board', stage);
      if (wall) Object.assign(wall.style, { width: `${span}px`, height: `${M.ch + 30}px`, top: `${M.restBottom - M.ch - 16}px` });
      if (board) Object.assign(board.style, { width: `${span + 12}px`, top: `${M.restBottom}px` });
      casesEl().forEach((c, i) => {
        c.style.transform = c === current ? featT() : restT(i);
      });
    }
    let resizeRaf = 0;
    function onResize() {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => { if (!busy) applyLayout(); });
    }
    window.addEventListener('resize', onResize);

    const caseHTML = (i, g) => `
      <div class="draw-case" data-i="${i}">
        <div class="draw-case__face draw-case__front"><img alt="" decoding="async" src="${esc(g.cover_url ? igdbSized(g.cover_url, 'cover_big') : placeholderCover(g.title))}"><i class="draw-case__hinge"></i><i class="draw-case__sheen"></i><i class="draw-case__glint"></i></div>
        <div class="draw-case__face draw-case__side draw-case__side--l"></div>
        <div class="draw-case__face draw-case__side draw-case__side--r"></div>
        <div class="draw-case__face draw-case__back"></div>
        <i class="draw-case__cast"></i>
      </div>`;

    function buildShelf() {
      M = measure();
      // Real covers from the collection already on screen, so the shelf is
      // full of the same games the grid below is showing.
      const filler = games.filter((g) => g.cover_url);
      const order = filler.slice().sort(() => Math.random() - 0.5);
      const covers = Array.from({ length: M.n }, (_, i) => order[i % Math.max(1, order.length)] || { title: '' });
      stage.innerHTML = `<i class="draw-wall"></i><i class="draw-board"></i>${covers.map((g, i) => caseHTML(i, g)).join('')}`;
      current = null;
      applyLayout();
    }

    // ------------------------------------------------------------ result
    function hideResult() {
      drawEl.classList.remove('is-landed');
      acts.forEach((b) => { b.disabled = true; });
      crewEl.innerHTML = '';
      infoEl.style.opacity = '0';
      // Back to the pre-reveal state, so the next title wipes in from
      // nothing instead of appearing already written.
      titleEl.style.opacity = '0';
      ruleEl.style.transform = 'scaleX(0)';
      metaEl.style.opacity = '0';
      crewEl.style.opacity = '0';
    }

    // Friends who played, are playing or want this game: a small chip each
    // under the title. Nothing at all when nobody has.
    const crewLabel = (c) => (c.status === 'played' ? (c.rating ? `Played ★${Number(c.rating)}` : 'Played') : c.status === 'playing' ? 'Playing now' : 'Wants to play');
    function crewHTML() {
      return crew.slice(0, 3).map((c) => {
        const name = c.profile.display_name || c.profile.username || 'Friend';
        const face = c.profile.avatar_url
          ? `<img src="${esc(c.profile.avatar_url)}" alt="" decoding="async">`
          : `<b>${esc(name[0].toUpperCase())}</b>`;
        return `<button type="button" class="draw-friend" data-user="${esc(c.profile.username || '')}"><span class="draw-friend__face">${face}</span><span>${esc(name)} · ${crewLabel(c)}</span></button>`;
      }).join('');
    }

    // The title is the last thing to arrive. It wipes in from the left
    // while the letters pull together from wide spacing, with a short
    // accent rule drawing under it; the details follow a beat behind.
    async function revealInfo(my) {
      titleEl.textContent = pick.title;
      metaEl.textContent = [pick.release_year, genreOf(pick)].filter(Boolean).join(' · ');
      crewEl.innerHTML = crewHTML();
      infoEl.style.opacity = '1';
      const wipe = tween(titleEl, [
        { opacity: 0, clipPath: 'inset(0 100% 0 0)', letterSpacing: '0.28em', transform: 'translateY(8px)' },
        { opacity: 1, clipPath: 'inset(0 0% 0 0)', letterSpacing: '0.01em', transform: 'translateY(0)' },
      ], { duration: 760, easing: 'cubic-bezier(.2,.8,.2,1)' }, { opacity: '1', clipPath: 'none', letterSpacing: '0.01em', transform: 'none' });
      tween(ruleEl, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 520, delay: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }, { transform: 'scaleX(1)' });
      [metaEl, crewEl].forEach((el, i) => tween(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, delay: 380 + i * 90, easing: 'ease-out' }, { opacity: '1', transform: 'none' }));
      await wipe;
      if (my !== token) return;
    }

    function showResult() {
      setSaved(false);
      saved = null;
      drawEl.classList.add('is-landed');
      acts.forEach((b) => { b.disabled = false; });
      // The three buttons are fixed: they do not move, and they are there
      // from the moment the cover lands.
      tween(qs('.draw-actions', overlay), [{ opacity: 0 }, { opacity: 1 }], { duration: 260 }, { opacity: '1' });
    }

    // ------------------------------------------------------------- deal
    // The scan: a lift passes along the shelf, left to right and back,
    // slowing as it goes, and settles on the case that is about to come out.
    async function scan(my, target) {
      const n = M.n;
      const path = [];
      for (let i = 0; i < n; i++) path.push(i);
      for (let i = n - 2; i >= target; i--) path.push(i);
      if (path[path.length - 1] !== target) path.push(target);
      const cs = casesEl();
      for (let k = 0; k < path.length && !skip; k++) {
        const i = path[k];
        const last = k === path.length - 1;
        const el = cs[i];
        const ms = 70 + k * 9;
        if (last) {
          await tween(el, [{ transform: restT(i) }, { transform: restT(i, 12) }], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' }, { transform: restT(i, 12) });
        } else {
          tween(el, [{ transform: restT(i) }, { transform: restT(i, 9) }, { transform: restT(i) }], { duration: ms * 2, easing: 'ease-in-out' }, { transform: restT(i) });
          await pause(ms);
        }
        if (my !== token) return;
      }
      if (skip) { cs[target].style.transform = restT(target, 12); }
    }

    async function deal({ shuffle }) {
      const my = ++token;
      busy = true; skip = false;
      hideResult();
      pick = null;
      const picking = nextUp || prepare();
      nextUp = null;

      let entrance = Promise.resolve();
      if (shuffle) {
        buildShelf();
        const cs = casesEl();
        cs.forEach((c) => { c.style.opacity = '0'; });
        // The shelf comes in from the middle outward: each case rises a
        // little as it fades up, so it reads as stocked rather than shown.
        entrance = Promise.all(cs.map((c, i) => tween(c, [
          { opacity: 0, transform: restT(i).replace(/translate3d\(([-\d.]+)px, ([-\d.]+)px/, (_, x, y) => `translate3d(${x}px, ${Number(y) + 34}px`) },
          { opacity: 1, transform: restT(i) },
        ], { duration: 460, delay: Math.abs(i - mid()) * 55, easing: 'cubic-bezier(.2,.8,.2,1)' }, { opacity: '1', transform: restT(i) })));
        tween(qs('.draw-wall', stage), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 }, { opacity: '1' });
        tween(qs('.draw-board', stage), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 }, { opacity: '1' });
      }

      const item = await Promise.race([picking, new Promise((r) => setTimeout(r, 4000))]).catch(() => null);
      if (my !== token) return;
      let art;
      let artReady;
      let friendsP = Promise.resolve([]);
      if (item) { pick = item.g; art = item.art; artReady = item.ready; friendsP = item.friends; }
      else { pick = localPick(); seen.add(keyOf(pick)); art = artOf(pick); artReady = Promise.resolve(); }
      nextUp = prepare(); // the one after this, while this one is being looked at

      // Which slot it comes out of: random, and never the same one twice
      // running, with the pick's own artwork put on that case.
      let slot = Math.floor(Math.random() * M.n);
      if (slot === lastSlot) slot = (slot + 1 + Math.floor(Math.random() * (M.n - 1))) % M.n;
      lastSlot = slot;
      const cs = casesEl();
      const chosen = cs[slot];
      const img = qs('.draw-case__front img', chosen);
      img.src = art;
      await Promise.all([entrance, Promise.race([artReady.then(() => img.decode()).catch(() => {}), new Promise((r) => setTimeout(r, 900))])]);
      if (my !== token) return;

      await scan(my, slot);
      if (my !== token) return;
      buzz(10);

      // Everything else steps back while the chosen case slides out of its
      // place - forward first, off the shelf - and then comes up and across
      // to the middle, turning to face you.
      cs.forEach((c, i) => { if (c !== chosen) tween(c, [{ opacity: 1 }, { opacity: 0.32 }], { duration: 520, easing: 'ease-out' }, { opacity: '0.32' }); });
      tween(qs('.draw-case__cast', chosen), [{ opacity: 1 }, { opacity: 0 }], { duration: 300 }, { opacity: '0' });
      chosen.style.zIndex = '5';
      await tween(chosen, [
        { transform: restT(slot, 12), offset: 0 },
        { transform: pullT(slot), offset: 0.34, easing: 'cubic-bezier(.2,.8,.2,1)' },
        { transform: featT(), offset: 1 },
      ], { duration: 820, easing: 'cubic-bezier(.3,.1,.2,1)' }, { transform: featT() });
      if (my !== token) return;
      current = chosen;
      // One pass of light across the cover as it arrives.
      tween(qs('.draw-case__glint', chosen), [{ transform: 'translateX(-130%) skewX(-18deg)', opacity: 0.9 }, { transform: 'translateX(230%) skewX(-18deg)', opacity: 0.9 }], { duration: 900, easing: 'ease-in-out' }, { opacity: '0' });

      crew = await Promise.race([friendsP, new Promise((r) => setTimeout(() => r([]), 700))]);
      if (my !== token) return;
      busy = false;
      showResult();
      await revealInfo(my);
    }

    btnDraw.addEventListener('click', async () => {
      if (busy || !current) return;
      busy = true;
      const my = ++token;
      skip = false;
      hideResult();
      buzz(6);
      // The cover goes back into its place on the shelf, and the shelf
      // fills back in around it, before the next one is chosen.
      const back = current;
      const i = Number(back.dataset.i);
      current = null;
      back.style.zIndex = '';
      qsa('.draw-case', stage).forEach((c) => { if (c !== back) tween(c, [{ opacity: 0.32 }, { opacity: 1 }], { duration: 380 }, { opacity: '1' }); });
      tween(qs('.draw-case__cast', back), [{ opacity: 0 }, { opacity: 1 }], { duration: 380 }, { opacity: '1' });
      await tween(back, [{ transform: featT() }, { transform: pullT(i) }, { transform: restT(i) }], { duration: 480, easing: 'cubic-bezier(.4,0,.2,1)' }, { transform: restT(i) });
      if (my !== token) return;
      deal({ shuffle: false });
    });
    crewEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.draw-friend');
      if (!chip?.dataset.user || busy) return;
      close();
      navigate(`/profile/${encodeURIComponent(chip.dataset.user)}`);
    });
    btnOpen.addEventListener('click', async () => {
      if (busy || !pick) return;
      if (!state.user) { promptSignIn('Sign in to open games.'); return; }
      buzz(8);
      btnOpen.disabled = true;
      try {
        const saved = await api.addGame(pick, state.user.id);
        close();
        navigate(`/game/${saved.id}`);
      } catch (err) {
        toast(err.message || 'Could not open that game.', 'error');
        btnOpen.disabled = false;
      }
    });
    // Want to play is a toggle. The button turns green the moment you tap
    // it and the backlog entry is written behind it; tap again and the
    // entry this made is removed. Nothing reloads, and a failure puts the
    // button back. A game you had already logged (played, playing) is
    // left exactly as it was.
    let saved = null;     // { logId, pickKey } once in the backlog
    let saving = false;
    const setSaved = (on) => {
      btnSave.classList.toggle('draw-act--saved', on);
      btnSave.setAttribute('aria-pressed', on ? 'true' : 'false');
      qs('span', btnSave).innerHTML = on ? 'On your<br>list ✓' : 'Want<br>to play';
    };
    btnSave.addEventListener('click', async () => {
      if (busy || !pick || saving) return;
      if (!state.user) { promptSignIn('Sign in to save games.'); return; }
      const g = pick;
      saving = true;
      if (saved && saved.pickKey === keyOf(g)) {
        const was = saved;
        saved = null;
        setSaved(false);
        buzz(6);
        try {
          await api.deleteLog(was.logId);
          markPagesStale();
        } catch (err) {
          if (pick === g) { saved = was; setSaved(true); }
          toast(err.message || 'Could not remove that.', 'error');
        }
        saving = false;
        return;
      }
      setSaved(true);
      buzz([10, 40, 14]);
      try {
        const game = await api.addGame(g, state.user.id);
        const had = await api.getOwnLogForGame(state.user.id, game.id);
        if (had && had.status !== 'backlog') {
          if (pick === g) setSaved(false);
          toast(`${game.title} is already in your diary.`);
        } else {
          const log = had || await api.createLog({ game_id: game.id, user_id: state.user.id, status: 'backlog', is_public: true });
          if (pick === g) saved = { logId: log.id, pickKey: keyOf(g) };
          markPagesStale();
          pulseLogTab();
        }
      } catch (err) {
        if (pick === g) setSaved(false);
        toast(err.message || 'Could not save that game.', 'error');
      }
      saving = false;
    });

    deal({ shuffle: true });
  }

  // Full reset whenever the collection changes — without clearing page
  // and games here, switching mood would append the new collection onto
  // the old one and paginate from wherever the last one left off.
  function reset() {
    if (observer) observer.disconnect();
    page = 1; hasMore = true; loading = false; games = []; shown = 0; prefetching = null;
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
    setTimeout(() => refillDrawPool().catch(() => {}), 1500);
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
      try { await refreshCurrentView({ dataChanged: false }); } catch { /* the view's own error state handles this */ }
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
