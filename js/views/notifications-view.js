import * as api from '../api.js';
import { state } from '../state.js';
import { navBar, avatarImg, emptyState, spinner, iconBell } from '../components.js';
import { esc, timeAgo, starRow, qs, qsa, keepLoading } from '../utils.js';
import { navigate } from '../router.js';
import { wirePullToRefresh, pullRefreshing } from './feed-view.js';
import { getCached, setCached, CACHE_KEYS } from '../cache.js';

// One screen for everything happening in the app: what the people you
// follow have logged, liked and followed, what you have done yourself,
// and what has been aimed at you. Messages are the deliberate exception
// — a DM belongs in the messenger with its own unread state, not in a
// public-shaped activity list.
//
// The three tabs are about WHOSE activity it is. All is everything that
// concerns you except what you did yourself (the people you follow, plus
// follows, likes and comments aimed at you); Friends is only the people you
// follow; You is a diary of your own actions.
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'friends', label: 'Friends' },
  { id: 'you', label: 'You' },
];

function nameOf(profile, fallback = 'Someone') {
  if (!profile) return fallback;
  const n = profile.display_name || profile.username || fallback;
  return n.charAt(0).toUpperCase() + n.slice(1); // first letter always a capital
}

function profileHref(profile) {
  return profile?.username ? `/profile/${profile.username}` : null;
}

// A rating rendered inline next to the game, the way a diary line reads:
// "watched Hades ★★★★½". Small enough to sit on the text baseline
// without turning the row into two lines.
function inlineStars(rating) {
  return rating ? ` ${starRow(rating, { size: 11 })}` : '';
}

const PAST_TENSE = {
  played: 'played',
  playing: 'started playing',
  backlog: 'added',
  dropped: 'dropped',
};

// What the row says and where tapping it goes, decided together: a row
// the app cannot open should not be phrased as something to open.
// Only the GAME is bold. People's names used to be bold too, which put
// two competing emphases in a one-line sentence and made the list read
// as heavier than it is — the row is scanned for which game it is
// about, and the name is context.
function describe(row, viewerId) {
  const isYou = row.actor_id === viewerId;
  const who = isYou ? 'You' : `<span class="act__who">${esc(nameOf(row.actor))}</span>`;
  const game = row.game
    ? `<b>${esc(row.game.title)}</b>`
    : null;
  const gameHref = row.game ? `/game/${row.game.id}` : null;

  switch (row.kind) {
    case 'log': {
      const status = row.log?.status || 'played';
      const verb = PAST_TENSE[status] || 'played';
      if (!game) return { text: `${who} logged a game`, href: null };
      // "added X to their backlog" needs the possessive the other three
      // statuses don't, so it is built rather than templated.
      const tail = status === 'backlog'
        ? `${game} to ${isYou ? 'your' : 'their'} backlog`
        : `${game}${inlineStars(row.log?.rating)}`;
      return {
        text: `${who} ${verb} ${tail}`,
        quote: row.log?.review ? row.log.review : null,
        href: row.log?.id ? `/review/${row.log.id}` : gameHref,
      };
    }

    case 'like': {
      // Incoming rows are phrased in the second person because the
      // review is yours — "liked your review" reads as the event, where
      // "liked Ishant's review" reads as news about a stranger.
      const whose = row.targetIsViewer || row.target?.id === viewerId
        ? 'your'
        : `<span class="act__who">${esc(nameOf(row.target))}</span>'s`;
      return {
        text: game
          ? `${who} liked ${whose} review of ${game}`
          : `${who} liked ${whose} review`,
        href: row.log?.id ? `/review/${row.log.id}` : null,
      };
    }

    case 'follow': {
      const target = row.targetIsViewer || row.target?.id === viewerId
        ? 'you'
        : `<span class="act__who">${esc(nameOf(row.target))}</span>`;
      return {
        text: `${who} followed ${target}`,
        href: profileHref(isYou ? row.target : row.actor),
      };
    }

    case 'comment': {
      const whose = row.targetIsViewer || row.target?.id === viewerId
        ? 'your'
        : `<span class="act__who">${esc(nameOf(row.target))}</span>'s`;
      return {
        text: game
          ? `${who} commented on ${whose} review of ${game}`
          : `${who} commented on ${whose} review`,
        quote: row.comment?.body || null,
        href: row.log?.id ? `/review/${row.log.id}` : null,
      };
    }

    default:
      return { text: `${who} did something`, href: null };
  }
}

function activityRow(row, viewerId) {
  const { text, quote, href } = describe(row, viewerId);
  const unread = !!row.unread;
  const avatar = row.actor ? avatarImg(row.actor, 36) : '';
  // A button rather than an anchor: plenty of rows have nowhere to go
  // (a deleted log, an account since removed) and a dead href is worse
  // than a row that simply does not respond to a tap.
  return `
    <button type="button" class="act${unread ? ' act--unread' : ''}"${href ? ` data-href="${esc(href)}"` : ''}>
      <span class="act__avatar">${avatar}</span>
      <span class="act__body">
        <span class="act__text">${text}</span>
        ${quote ? `<span class="act__quote"><span class="act__quote-text">${esc(quote)}</span></span>` : ''}
      </span>
      <span class="act__time">${esc(timeAgo(row.created_at))}</span>
      ${unread ? '<span class="act__dot" aria-label="New"></span>' : ''}
    </button>`;
}

// The tab you were on, kept only for a pull-to-refresh (which rebuilds the
// screen); opening Notifications fresh always starts on All.
let lastTab = 'all';

export async function renderNotificationsView(root) {
  let activeTab = pullRefreshing ? lastTab : 'all';
  const viewerId = state.user?.id;

  // One pane per tab, all kept. Switching tabs shows the other pane instead of
  // loading it again, so a tab stays loaded, exactly as you left it (rows, how
  // far you had scrolled, and its own place in the list). Each tab has its own
  // state and its own "newest load wins" ticket, so a slow answer for one tab
  // can never land in another.
  const STALE_MS = 45_000; // a tab you come back to after this long refreshes quietly
  const T = Object.fromEntries(TABS.map((t) => [t.id, {
    id: t.id, rows: [], cursor: null, hasMore: false, loading: false, ticket: 0,
    loadedAt: 0, scroll: 0, observer: null, guard: null, pane: null,
  }]));
  const cur = () => T[activeTab];

  function paintShell() {
    const idx = TABS.findIndex((t) => t.id === activeTab);
    root.innerHTML = `
      <header class="topbar topbar--home"><span class="topbar__logo search-title">Notifications</span></header>
      <div class="home-tabs">
        <nav class="home-tabs__pill home-tabs__pill--three" id="act-tabs" style="--i:${idx}">
          ${TABS.map((t) => `<button type="button" class="home-tabs__item${t.id === activeTab ? ' home-tabs__item--active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </nav>
      </div>
      <div class="view-body view-body--search" id="act-body">
        <div id="act-slot">
          ${TABS.map((t) => `<div class="act-pane" data-pane="${t.id}"${t.id === activeTab ? '' : ' hidden'}>${spinner()}</div>`).join('')}
        </div>
      </div>` + navBar('');
    TABS.forEach((t) => { T[t.id].pane = qs(`.act-pane[data-pane="${t.id}"]`, root); });

    qsa('#act-tabs .home-tabs__item', root).forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    qs('#act-slot', root).addEventListener('click', (e) => {
      const rowEl = e.target.closest('.act');
      if (rowEl?.dataset.href) navigate(rowEl.dataset.href);
    });

    // Pull down at the top of the list to reload it — the same gesture
    // the Feed, Messages and Profile already carry.
    wirePullToRefresh(qs('#act-body', root));
  }

  const body = () => qs('#act-body', root);

  function switchTab(id) {
    if (id === activeTab || !T[id]) return;
    const from = cur();
    from.scroll = body().scrollTop;
    activeTab = id;
    lastTab = id;
    const to = cur();
    qs('#act-tabs', root).style.setProperty('--i', String(TABS.findIndex((t) => t.id === id)));
    qsa('#act-tabs .home-tabs__item', root).forEach((b) =>
      b.classList.toggle('home-tabs__item--active', b.dataset.tab === id));
    TABS.forEach((t) => { T[t.id].pane.hidden = t.id !== id; });
    if (to.loadedAt) {
      // Already loaded: just show it where it was left. Quietly refresh it if
      // it has been a while.
      body().scrollTop = to.scroll;
      watchEnd(to);
      if (Date.now() - to.loadedAt > STALE_MS) load(to, { reset: true });
    } else {
      body().scrollTop = 0;
      load(to, { reset: true });
    }
  }

  function emptyMessage(id) {
    if (id === 'you') return "You haven't done anything yet — log a game and it shows up here.";
    if (id === 'friends') return 'Nothing from the people you follow yet. Follow a few people and their activity fills this in.';
    return 'Nothing yet. Follow a few people, and what they do (and what happens to you) shows up here.';
  }

  function paintList(t) {
    if (!t.pane) return;
    if (!t.rows.length) {
      t.pane.innerHTML = emptyState(emptyMessage(t.id), { icon: iconBell() });
      return;
    }
    t.pane.innerHTML = `
      <div class="act-list">${t.rows.map((r) => activityRow(r, viewerId)).join('')}</div>
      ${t.hasMore ? `<div class="act-sentinel" aria-hidden="true"></div>
         <div class="act-more">${spinner()}</div>` : ''}`;
    if (t.id === activeTab) watchEnd(t);
  }

  // Loads the next page as the end of THIS tab's list comes near.
  function watchEnd(t) {
    if (t.observer) { t.observer.disconnect(); t.observer = null; }
    if (t.guard) { t.guard.stop(); t.guard = null; }
    const sentinel = qs('.act-sentinel', t.pane);
    if (!sentinel) return;
    if (!('IntersectionObserver' in window)) {
      const more = qs('.act-more', t.pane);
      if (more) {
        more.innerHTML = `<button type="button" class="btn btn--ghost btn--block">Load more</button>`;
        qs('button', more).addEventListener('click', () => load(t, { reset: false }));
      }
      return;
    }
    t.observer = new IntersectionObserver((entries) => {
      if (t.id === activeTab && entries.some((e) => e.isIntersecting)) load(t, { reset: false });
    }, { root: body(), rootMargin: '1200px' });
    t.observer.observe(sentinel);
    t.guard = keepLoading({
      sentinel: () => qs('.act-sentinel', t.pane),
      scroller: () => body(),
      trigger: () => { if (t.id === activeTab) load(t, { reset: false }); },
      margin: 1200,
    });
  }

  async function load(t, { reset }) {
    if (!reset && (t.loading || !t.hasMore)) return;
    const my = ++t.ticket;
    t.loading = true;
    if (reset) {
      t.cursor = null;
      // A spinner only while this tab has nothing to show; a refresh of a tab
      // that is already on screen happens quietly behind its rows.
      if (!t.loadedAt && !t.pane.querySelector('.act')) t.pane.innerHTML = spinner();
    }

    // The default view (All, first page) is fetched in the background by
    // warmOtherTabs() while you are still on the feed, so it can be on
    // screen before the network answers.
    const isDefaultView = reset && t.id === 'all' && !t.loadedAt;
    if (isDefaultView) {
      const warm = getCached(CACHE_KEYS.notifications);
      if (warm?.rows?.length) {
        t.rows = warm.rows; t.cursor = warm.cursor; t.hasMore = warm.hasMore;
        paintList(t);
      }
    }

    try {
      // All = the people you follow plus what is aimed at you, never your
      // own doings; Friends = only the people you follow; You = yours.
      const ask = (limit) => api.getActivityFeed(viewerId, {
        scope: t.id === 'you' ? 'you' : 'friends',
        includeYou: false,
        includeIncoming: t.id === 'all',
        before: reset ? null : t.cursor,
        limit,
      });
      let res = await ask(40);
      // Many things can share one second (an import logs dozens of games at
      // once). Paging then asks again from that same second and gets the same
      // rows back, so the list stopped growing with the spinner still turning.
      // When a page brings nothing new, ask for more at once until it does.
      if (!reset) {
        const seenKeys = new Set(t.rows.map((r) => r.key));
        let limit = 40;
        for (let i = 0; i < 6 && res.hasMore && !res.rows.some((r) => !seenKeys.has(r.key)); i++) {
          limit *= 2;
          res = await ask(limit);
          if (my !== t.ticket) return;
        }
        // Still nothing new after all that: this is the end of the list.
        if (!res.rows.some((r) => !seenKeys.has(r.key))) res = { ...res, hasMore: false };
      }
      if (my !== t.ticket) return; // a newer load of this same tab started meanwhile
      if (isDefaultView) setCached(CACHE_KEYS.notifications, res);
      if (reset) t.rows = res.rows;
      else { const seen = new Set(t.rows.map((r) => r.key)); t.rows = t.rows.concat(res.rows.filter((r) => !seen.has(r.key))); }
      t.cursor = res.cursor;
      t.hasMore = res.hasMore;
      t.loadedAt = Date.now();
      // Painting replaces the list, so a quiet refresh must not throw the
      // reader back to the top: put the scroll back where it was.
      const keep = t.id === activeTab ? body().scrollTop : null;
      paintList(t);
      if (keep != null) body().scrollTop = keep;
      if (t.id === 'all') markVisibleRead();
    } catch (err) {
      if (my !== t.ticket) return;
      t.pane.innerHTML = `<p class="muted" style="padding:24px">Couldn't load activity: ${esc(err.message)}</p>`;
    } finally {
      if (my === t.ticket) t.loading = false;
    }
  }

  // Opening Notifications reads everything, the way Instagram's does: the
  // dots stay on screen for this visit, so you can see what was new, and the
  // bell clears.
  function markVisibleRead() {
    if (!viewerId) return;
    api.markAllNotificationsRead(viewerId)
      .then(() => { window.dispatchEvent(new CustomEvent('notifications:read')); })
      .catch(() => { /* the badge simply stays until the next load */ });
  }

  // Something new lands while this screen is open: it appears now, already
  // read, instead of only bumping the bell. All and Friends are stale; the one
  // on screen reloads at once and the other quietly the next time it is opened.
  // (The You tab is your own doings, which a notification is never about.)
  const onIncoming = () => {
    if (!root.isConnected) return;
    if (T.all.loadedAt) T.all.loadedAt = 1; // 1 = loaded, but long ago: refreshes when next opened
    if (T.friends.loadedAt) T.friends.loadedAt = 1;
    if (activeTab !== 'you' && !cur().loading) load(cur(), { reset: true });
  };
  window.addEventListener('notifications:incoming', onIncoming);
  // The kept page is shown again (you came back to this tab): opening it
  // reads everything, and a tab that has been away a while refreshes quietly.
  window.addEventListener('page:shown', (e) => {
    if (!e.detail?.restored || !root.isConnected) return;
    markVisibleRead();
    const t = cur();
    if (t.loadedAt && Date.now() - t.loadedAt > STALE_MS) load(t, { reset: true });
  });

  paintShell();
  load(cur(), { reset: true });
}
