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
    // activity is looked up while its case is being pulled out.
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
    let pick = null;      // the game showing
    let current = null;   // the case that is out of the shelf

    // One tween helper. The element's inline style is the source of truth:
    // every animation writes its final values there and cancels itself, so
    // nothing is left holding a fill and the live tilt below can take over
    // the same transform without fighting it.
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
      stopTilt();
      offTilt();
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
      if (e.target.closest('button') || e.target.closest('.draw-case')) return;
      if (busy) { skip = true; anims.forEach((a) => { try { a.finish(); } catch { /* already gone */ } }); return; }
      if (e.target === overlay || e.target === drawEl || e.target.classList.contains('draw-scene') || e.target === stage) close();
    });

    const genreOf = (g) => (g.genre || '').split(',')[0].replace('Role-playing (RPG)', 'RPG').trim();
    const artOf = (g) => (g.cover_url ? igdbSized(g.cover_url, 'cover_big') : placeholderCover(g.title));

    // Games for the shelf. The ones already on screen first - their covers
    // are decoded and in cache, so the shelf is instant - topped up from
    // the same deep random pool the old draw used, so a long session keeps
    // turning up things the grid never showed.
    const seen = drawn.keys;
    const localPick = () => {
      let fresh = games.filter((g) => !seen.has(keyOf(g)));
      if (!fresh.length) fresh = games.slice();
      return fresh[Math.floor(Math.random() * fresh.length)];
    };
    if (drawPool.id !== collection.id) { drawPool.id = collection.id; drawPool.games = []; }
    const pool = drawPool.games;
    function freshGame() {
      if (pool.length < 3) refillDrawPool().catch(() => {});
      const g = pool.length ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : localPick();
      seen.add(keyOf(g));
      return g;
    }
    const friendsFor = (g) => followingP.then((ids) => api.getFriendActivityForGame(g, ids)).catch(() => []);

    // ------------------------------------------------------------ layout
    // Cases stand edge on, like books: each is a real box and the face
    // turned to you is its SPINE. Every case is built at the size it will
    // be when it is out and scaled down on the shelf, never the other way
    // round - a cover scaled up from thumbnail size arrives soft, which is
    // the one thing this moment cannot afford.
    // 3:4, which is what IGDB serves every cover at. The case was 0.72
    // before - close to a real DVD case, but a hair narrower than the art,
    // so every cover was being cropped a few percent at the sides and read
    // as squashed. Matching the artwork exactly means nothing is cut and
    // nothing is stretched.
    const RATIO = 0.75;   // width / height of a game case
    const TURN = 87;      // deg: edge on, with a sliver of cover showing
    const N = 12;         // cases on the shelf
    const PERSP = 1100;   // matches the scene's perspective, in css
    // The shelf is set back and the cover is held forward, and the gap
    // between the two is what stops the shelf passing through the cover
    // when it turns: a cover turning end over end sweeps half its own
    // height in Z, and at this size that is about 130px either way.
    const SHELF_Z = -90;
    // Looked down on, slightly. The cases tip back on their heels and the
    // plank opens its top surface toward you, which is what makes a row of
    // spines read as standing ON something rather than floating in front of
    // it. It is done here rather than by moving the camera on purpose: the
    // camera belongs to the whole scene, and the one case that is out has
    // to stay square on to be looked at.
    const PITCH = 9;
    const FEAT_Z = 120;
    let M = null;
    function measure() {
      const vw = overlay.clientWidth || window.innerWidth;
      const vh = overlay.clientHeight || window.innerHeight;
      // What is left once the title block, the buttons and the padding are out.
      const availH = Math.max(190, vh - 56 - 24 - 56 - 108 - 24);
      const fw = Math.min(224, vw * 0.56, availH * 0.8 * RATIO);
      const fh = fw / RATIO;
      const fd = Math.max(13, Math.round(fw * 0.115));
      // The row is laid out to run PAST both edges of the screen, so the
      // shelf reads as part of a longer one rather than a tray with both
      // ends in view. The twelve cases fill that width, and their scale
      // falls out of the spacing: from the side a case is its spine plus
      // the sliver of cover the few degrees of turn leave showing, and
      // that has to come to just under one step - any more and each cover
      // stacks over the next case's spine and the spines disappear.
      // Set back, the shelf is drawn smaller, so the spacing is worked out
      // where it is actually seen - on screen - and converted back.
      const back = PERSP / (PERSP - SHELF_Z);
      const step = Math.max(24, (vw * 1.08) / N / back);
      const sliver = Math.cos(TURN * Math.PI / 180);
      const s = Math.max(0.28, Math.min(0.56, (step - 3 / back) / (fd + fw * sliver)));
      const sh = fh + 26;
      const restBottom = sh - 26;
      return { n: N, fw, fh, fd, s, step, sh, restBottom, restY: restBottom - fh, featY: (sh - fh) / 2 - 10, vw };
    }
    const mid = () => (M.n - 1) / 2;
    const slotX = (i) => (i - mid()) * M.step;
    // Each case is turned to face the camera rather than the screen. A row
    // of parallel cases does not read as spines: the camera sits in the
    // middle, so the ones out at the ends are seen at an angle and the
    // perspective gives back several degrees of cover - enough that a
    // shelf of spines looked like a shelf of covers. Taking the viewing
    // angle out of each case's own turn makes every spine equally square
    // on, and the 90 - TURN that is left is the sliver of cover you see
    // down the near edge of all of them.
    const slotA = (i) => TURN - Math.atan(slotX(i) / (PERSP - SHELF_Z)) * 180 / Math.PI;
    const restT = (i, lift = 0) => `translate3d(${slotX(i)}px, ${M.restY - lift}px, ${SHELF_Z}px) rotateX(${PITCH}deg) rotateY(${slotA(i)}deg) scale(${M.s})`;
    const tipT = (i) => `translate3d(${slotX(i)}px, ${M.restY - 10}px, ${SHELF_Z + 16}px) rotateX(${PITCH - 11}deg) rotateY(${slotA(i) - 4}deg) scale(${M.s})`;
    const outT = (i) => `translate3d(${slotX(i)}px, ${M.restY - 6}px, ${SHELF_Z + 120}px) rotateX(${Math.round(PITCH / 3) - 6}deg) rotateY(${slotA(i) - 14}deg) scale(${M.s * 1.06})`;
    // Held forward, and scaled back by exactly what being that much nearer
    // magnifies it, so the cover arrives the size it was designed to be
    // instead of swelling into the title underneath it.
    const featT = () => `translate3d(0px, ${M.featY}px, ${FEAT_Z}px) rotateY(0deg) scale(${((PERSP - FEAT_Z) / PERSP).toFixed(4)})`;
    const casesEl = () => qsa('.draw-case', stage);

    function applyLayout() {
      M = measure();
      stage.style.setProperty('--sh', `${M.sh}px`);
      stage.style.setProperty('--fw', `${M.fw}px`);
      stage.style.setProperty('--fh', `${M.fh}px`);
      stage.style.setProperty('--fd', `${M.fd}px`);
      // The plank is exactly as long as the row of cases, so it never
      // shows a bare end with nothing standing on it. Both run past the
      // edges of the screen together.
      const span = M.n * M.step * 1.02;
      const board = qs('.draw-board', stage);
      // Big enough to put the whole shelf in shadow, small enough that its
      // edges never reach the title or the buttons below.
      const dim = qs('.draw-dim', stage);
      if (dim) Object.assign(dim.style, { width: `${span}px`, height: `${M.sh * 1.18}px`, top: `${-M.sh * 0.09}px`, marginLeft: `${span * -0.5}px` });
      // The cases stand ON the shelf, not in front of it: it starts a few
      // pixels under their feet, so there is no hairline of nothing
      // between the two - which is what made them look like they were
      // floating half in the air.
      if (board) Object.assign(board.style, { width: `${span}px`, marginLeft: `${span * -0.5}px`, top: `${M.restBottom - 5}px` });
      // Hinged along its back edge, so the pitch opens the top surface
      // toward you instead of sinking the whole plank.
      if (board) {
        board.style.transformOrigin = '50% 0';
        board.style.transform = `translateZ(${SHELF_Z - 2}px) rotateX(${PITCH}deg)`;
      }
      if (dim) dim.style.transform = `translateZ(${SHELF_Z + 40}px)`;
      casesEl().forEach((c, i) => {
        if (c === current) { c.style.transform = featT(); baseT = featT(); } else c.style.transform = restT(i);
      });
    }
    let resizeRaf = 0;
    function onResize() {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => { if (!busy) applyLayout(); });
    }
    window.addEventListener('resize', onResize);

    // ------------------------------------------------------------- shelf
    const caseHTML = (i) => `
      <button type="button" class="draw-case" data-i="${i}" aria-label="Pick this one">
        <span class="draw-case__face draw-case__front"><img alt="" decoding="async"><i class="draw-case__hinge"></i><i class="draw-case__sheen"></i></span>
        <span class="draw-case__face draw-case__spine">${iconBrandMark()}</span>
        <span class="draw-case__face draw-case__edge"></span>
        <span class="draw-case__face draw-case__back"></span>
      </button>`;

    const gameOf = new WeakMap();
    function fill(el, g) {
      gameOf.set(el, g);
      const img = qs('.draw-case__front img', el);
      if (img.dataset.src !== artOf(g)) { img.dataset.src = artOf(g); img.src = artOf(g); }
      el.setAttribute('aria-label', `Pick ${g.title}`);
    }

    function buildShelf() {
      M = measure();
      const onScreen = games.filter((g) => g.cover_url).sort(() => Math.random() - 0.5);
      stage.innerHTML = `${Array.from({ length: M.n }, (_, i) => caseHTML(i)).join('')}<i class="draw-dim"></i><i class="draw-board"></i>`;
      const cs = casesEl();
      cs.forEach((el, i) => fill(el, onScreen[i % Math.max(1, onScreen.length)] || localPick()));
      current = null;
      applyLayout();
    }

    // ------------------------------------------------------------ result
    function hideResult() {
      drawEl.classList.remove('is-landed');
      acts.forEach((b) => { b.disabled = true; });
      crewEl.innerHTML = '';
      infoEl.style.opacity = '0';
      titleEl.style.opacity = '0';
      ruleEl.style.transform = 'scaleX(0)';
      metaEl.style.opacity = '0';
      crewEl.style.opacity = '0';
    }

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

    // The title is the last thing to arrive: it wipes in from the left
    // while the letters pull together, a short rule draws under it, and
    // the details follow a beat behind.
    function revealInfo() {
      titleEl.textContent = pick.title;
      metaEl.textContent = [pick.release_year, genreOf(pick)].filter(Boolean).join(' · ');
      crewEl.innerHTML = crewHTML();
      infoEl.style.opacity = '1';
      const wipe = tween(titleEl, [
        { opacity: 0, clipPath: 'inset(0 100% 0 0)', letterSpacing: '0.26em', transform: 'translateY(8px)' },
        { opacity: 1, clipPath: 'inset(0 0% 0 0)', letterSpacing: '0.01em', transform: 'translateY(0)' },
      ], { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)' }, { opacity: '1', clipPath: 'none', letterSpacing: '0.01em', transform: 'none' });
      tween(ruleEl, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 500, delay: 280, easing: 'cubic-bezier(.2,.8,.2,1)' }, { transform: 'scaleX(1)' });
      [metaEl, crewEl].forEach((el, i) => tween(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 400, delay: 360 + i * 90, easing: 'ease-out' }, { opacity: '1', transform: 'none' }));
      return wipe;
    }

    // --------------------------------------------------------- the pull
    // One element, one unbroken move, the way a case actually comes off a
    // shelf: a finger hooks the top edge and tips it toward you, it slides
    // forward out of the row, hangs there a moment, and only then turns to
    // show its cover. No swap, no second card - the spine you touched is
    // the cover you end up looking at.
    async function pullOut(el, my) {
      const i = Number(el.dataset.i);
      pick = gameOf.get(el);
      const friendsP = friendsFor(pick);
      // The shelf runs on small art; the one being held gets the big file,
      // swapped in only once it has decoded so the cover never visibly
      // jumps from one resolution to the other while it is turning.
      if (pick.cover_url) {
        const big = igdbSized(pick.cover_url, '1080p');
        const im = new Image();
        im.decoding = 'async';
        im.src = big;
        im.decode().then(() => {
          if (gameOf.get(el) === pick) qs('.draw-case__front img', el).src = big;
        }).catch(() => {});
      }
      busy = true;
      hideResult();
      stopTilt();
      el.style.zIndex = '6';
      stage.classList.add('is-picking');

      // The shelf falls into shadow while this one is handled. This is a
      // scrim set just in front of the row, NOT opacity on the cases: an
      // opacity below 1 flattens a preserve-3d subtree, which collapses a
      // case's spine to nothing and turns the shelf into paper slivers.
      tween(qs('.draw-dim', stage), [{ opacity: 0 }, { opacity: 1 }], { duration: 440, easing: 'ease-out' }, { opacity: '1' });

      // One unbroken move: a finger hooks the top edge and tips it toward
      // you, it comes out of the row, and it turns to face you on the way
      // in. No stop between taking it and seeing what it is.
      buzz(8);
      await tween(el, [
        { transform: restT(i), offset: 0 },
        { transform: tipT(i), offset: 0.22, easing: 'cubic-bezier(.3,.9,.4,1)' },
        { transform: outT(i), offset: 0.48, easing: 'cubic-bezier(.3,.6,.4,1)' },
        { transform: featT(), offset: 1 },
      ], { duration: 1020, easing: 'cubic-bezier(.3,.08,.2,1)' }, { transform: featT() });
      if (my !== token) return false;

      current = el;
      baseT = featT();
      crew = await Promise.race([friendsP, new Promise((r) => setTimeout(() => r([]), 700))]);
      if (my !== token) return false;
      busy = false;
      stage.classList.remove('is-picking');
      drawEl.classList.add('is-landed');
      acts.forEach((b) => { b.disabled = false; });
      setSaved(false);
      saved = null;
      tween(qs('.draw-actions', overlay), [{ opacity: 0 }, { opacity: 1 }], { duration: 240 }, { opacity: '1' });
      startTilt(el);
      revealInfo();
      return true;
    }

    // Back into its place, and a different game put on it, so the shelf
    // never shows the same thing twice in a session.
    async function putBack(el, my) {
      const i = Number(el.dataset.i);
      stopTilt();
      current = null;
      el.style.zIndex = '';
      tween(qs('.draw-dim', stage), [{ opacity: 1 }, { opacity: 0 }], { duration: 340 }, { opacity: '0' });
      await tween(el, [{ transform: featT() }, { transform: outT(i) }, { transform: restT(i) }], { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)' }, { transform: restT(i) });
      if (my !== token) return;
      fill(el, freshGame());
    }

    async function open(shuffle) {
      const my = ++token;
      busy = true; skip = false;
      hideResult();
      if (shuffle) {
        buildShelf();
        const cs = casesEl();
        // Stocked from the middle outward, each case dropping into place.
        // Transform only, for the same reason the dimming above is a scrim:
        // a case that fades in is a case with no thickness while it fades.
        await Promise.all(cs.map((c, i) => tween(c, [
          { transform: restT(i, -34) },
          { transform: restT(i) },
        ], { duration: 420, delay: Math.abs(i - mid()) * 34, easing: 'cubic-bezier(.2,.8,.2,1)' }, { transform: restT(i) })));
        if (my !== token) return;
      }
      const cs = casesEl();
      await pullOut(cs[Math.floor(Math.random() * cs.length)], my);
    }

    // Tap any spine to take that one instead of waiting for the shuffle.
    stage.addEventListener('click', async (e) => {
      const el = e.target.closest('.draw-case');
      if (!el || busy) return;
      if (el === current) return;
      const my = ++token;
      // Clear the old title before the old case goes back, not after: the
      // name of the game you have just moved on from should not sit under
      // the shelf while the next one is being pulled.
      busy = true;
      hideResult();
      if (current) { await putBack(current, my); if (my !== token) return; }
      await pullOut(el, my);
    });

    btnDraw.addEventListener('click', async () => {
      if (busy || !current) return;
      const my = ++token;
      busy = true; skip = false;
      hideResult();
      buzz(6);
      const back = current;
      stage.classList.add('is-picking');
      await putBack(back, my);
      if (my !== token) return;
      stage.classList.remove('is-picking');
      const cs = casesEl().filter((c) => c !== back);
      await pullOut(cs[Math.floor(Math.random() * cs.length)], my);
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
    // button back. A game you had already logged is left exactly as it was.
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

    // ------------------------------------------------------------- live
    // Once a cover is out it is a thing in your hand: it holds its place in
    // the air and the phone moves around it, all the way round if you turn
    // far enough - turn the phone over and you are looking at the back of
    // the case. The pose it starts from is whatever grip you were in when
    // it arrived, so there is no "correct" way to be holding the phone.
    //
    // The reading goes through a quaternion and is applied as a matrix
    // rather than two Euler angles: pulled apart into rotateX/rotateY the
    // turn fights itself past a quarter turn and the cover flips instead of
    // carrying on round. One rAF loop, one element, and it stops the moment
    // the motion settles.
    const EASE = 0.045;   // s of smoothing between readings
    const D2R = Math.PI / 180;
    let baseT = '';
    let tiltEl = null;
    let rest = null;      // the pose the phone was in when the cover arrived
    let qt = [1, 0, 0, 0];
    let qc = [1, 0, 0, 0];
    let raf = 0; let lastFrame = 0;
    const mul = (a, b) => [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
    // deviceorientation angles (Z-X'-Y'') as a quaternion, per the spec
    const quat = (alpha, beta, gamma) => {
      const x = (beta * D2R) / 2; const y = (gamma * D2R) / 2; const z = (alpha * D2R) / 2;
      const cX = Math.cos(x); const cY = Math.cos(y); const cZ = Math.cos(z);
      const sX = Math.sin(x); const sY = Math.sin(y); const sZ = Math.sin(z);
      return [cX * cY * cZ - sX * sY * sZ, sX * cY * cZ - cX * sY * sZ, cX * sY * cZ + sX * cY * sZ, cX * cY * sZ + sX * sY * cZ];
    };
    const norm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };
    const mat = (q) => {
      const [w, x, y, z] = q;
      const m = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
      ];
      return `matrix3d(${m.map((v) => v.toFixed(5)).join(',')})`;
    };
    const frame = (t) => {
      raf = 0;
      const dt = lastFrame ? Math.min(0.05, (t - lastFrame) / 1000) : 1 / 60;
      lastFrame = t;
      const k = 1 - Math.exp(-dt / EASE);
      // Shortest way round, so a turn past the back never unwinds the long way.
      const dot = qc[0] * qt[0] + qc[1] * qt[1] + qc[2] * qt[2] + qc[3] * qt[3];
      const sgn = dot < 0 ? -1 : 1;
      qc = norm(qc.map((v, i) => v + (qt[i] * sgn - v) * k));
      const still = Math.abs(Math.abs(dot) - 1) < 1e-6;
      if (still) { qc = qt.slice(); lastFrame = 0; }
      if (tiltEl) tiltEl.style.transform = Math.abs(qc[0]) > 0.99999 ? baseT : `${baseT} ${mat(qc)}`;
      if (!still) raf = requestAnimationFrame(frame);
    };
    const aimQ = (q) => { qt = norm(q); if (!raf) raf = requestAnimationFrame(frame); };
    const onOrient = (e) => {
      if (!tiltEl || e.beta == null) return;
      const q = quat(e.alpha || 0, e.beta, e.gamma || 0);
      if (!rest) { rest = q; return; }
      aimQ(mul([rest[0], -rest[1], -rest[2], -rest[3]], q));
    };
    // Desktop: the pointer stands in for the phone, a half turn corner to
    // corner, so the same cover can be looked around with a mouse.
    const onMouse = (e) => {
      if (!tiltEl || e.pointerType === 'touch') return;
      const ax = -(e.clientY / innerHeight - 0.5) * 180 * D2R;
      const ay = (e.clientX / innerWidth - 0.5) * 180 * D2R;
      aimQ(mul([Math.cos(ax / 2), Math.sin(ax / 2), 0, 0], [Math.cos(ay / 2), 0, Math.sin(ay / 2), 0]));
    };
    function startTilt(el) {
      if (reduce) return;
      tiltEl = el; rest = null;
    }
    function stopTilt() {
      tiltEl = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0; qt = [1, 0, 0, 0]; qc = [1, 0, 0, 0]; lastFrame = 0;
    }
    const offTilt = () => {
      window.removeEventListener('pointermove', onMouse);
      window.removeEventListener('deviceorientation', onOrient);
    };
    if (!reduce) {
      window.addEventListener('pointermove', onMouse, { passive: true });
      const DOE = window.DeviceOrientationEvent;
      if (typeof DOE?.requestPermission === 'function') {
        // iOS asks once, and only from a tap: this one.
        DOE.requestPermission().then((r) => { if (r === 'granted') window.addEventListener('deviceorientation', onOrient); }).catch(() => {});
      } else if (DOE) {
        window.addEventListener('deviceorientation', onOrient);
      }
    }

    open(true);
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
