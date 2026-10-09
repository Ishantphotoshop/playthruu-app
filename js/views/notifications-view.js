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
  const avatar = row.actor ? avatarImg(row.actor, 30) : '';
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
  let ticket = 0; // newest load wins; an older answer is dropped
  let rows = [];
  let cursor = null;
  let hasMore = false;
  let loading = false;
  let actGuard = null;
  let sentinelObserver = null;
  const viewerId = state.user?.id;

  // ---- the shell -------------------------------------------------------
  // Painted ONCE. The head is the same shape as Messages' and Search's —
  // a large title in the scrolling body with the segmented control
  // directly beneath — so the Friends/You/Incoming bar lands at the same
  // height on screen as Chats/Requests, Games/Players and Feed/News. It
  // used to be a topbar plus a separate sticky tab strip, which sat the
  // pill at a different height from every other tabbed screen.
  //
  // No back chevron: this is one of the five destinations in the tab
  // bar, and none of the others has one — there is nothing consistent
  // for "back" to mean from a tab you reached by tapping its own icon.
  // The filter sits where Messages puts its compose button.
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
        <div id="act-slot">${spinner()}</div>
      </div>` + navBar('');

    qsa('#act-tabs .home-tabs__item', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === activeTab) return;
        activeTab = btn.dataset.tab;
        lastTab = activeTab;
        // The other tab's rows must not sit under this tab's name while it loads.
        if (slot()) slot().innerHTML = spinner();
        qs('#act-tabs', root).style.setProperty('--i', String(TABS.findIndex((t) => t.id === activeTab)));
        qsa('#act-tabs .home-tabs__item', root).forEach((b) =>
          b.classList.toggle('home-tabs__item--active', b.dataset.tab === activeTab));
        load({ reset: true });
      });
    });

    qs('#act-slot', root).addEventListener('click', (e) => {
      const rowEl = e.target.closest('.act');
      if (rowEl?.dataset.href) navigate(rowEl.dataset.href);
    });

    // Pull down at the top of the list to reload it — the same gesture
    // the Feed, Messages and Profile already carry.
    wirePullToRefresh(qs('#act-body', root));
  }

  const slot = () => qs('#act-slot', root);

  function emptyMessage() {
    if (activeTab === 'you') return "You haven't done anything yet — log a game and it shows up here.";
    if (activeTab === 'friends') return 'Nothing from the people you follow yet. Follow a few people and their activity fills this in.';
    return 'Nothing yet. Follow a few people, and what they do (and what happens to you) shows up here.';
  }

  function paintList() {
    const body = slot();
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = emptyState(emptyMessage(), { icon: iconBell() });
      return;
    }
    // Reaching the bottom loads the next page by itself. The button that
    // used to be here is kept only for browsers with no
    // IntersectionObserver, where nothing would otherwise trigger the
    // load and the spinner would spin for ever.
    body.innerHTML = `
      <div class="act-list">${rows.map((r) => activityRow(r, viewerId)).join('')}</div>
      ${hasMore ? `<div id="act-sentinel" aria-hidden="true"></div>
         <div class="act-more" id="act-more">${spinner()}</div>` : ''}`;
    observeSentinel();
  }

  function observeSentinel() {
    if (sentinelObserver) { sentinelObserver.disconnect(); sentinelObserver = null; }
    const sentinel = qs('#act-sentinel', root);
    if (!sentinel) return;
    if (!('IntersectionObserver' in window)) {
      const more = qs('#act-more', root);
      if (more) {
        more.innerHTML = `<button type="button" class="btn btn--ghost btn--block" id="act-more-btn">Load more</button>`;
        qs('#act-more-btn', more).addEventListener('click', () => load({ reset: false }));
      }
      return;
    }
    sentinelObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) load({ reset: false });
    }, { root: qs('#act-body', root), rootMargin: '1200px' });
    sentinelObserver.observe(sentinel);
    if (actGuard) actGuard.stop();
    actGuard = keepLoading({ sentinel: () => qs('#act-sentinel', root), scroller: () => qs('#act-body', root), trigger: () => load({ reset: false }), margin: 1200 });
  }

  async function load({ reset }) {
    if (!reset && (loading || !hasMore)) return;
    const my = ++ticket;
    loading = true;
    if (reset) {
      rows = [];
      cursor = null;
      hasMore = false;
      if (sentinelObserver) { sentinelObserver.disconnect(); sentinelObserver = null; }
      // A spinner ONLY when there is nothing to show yet. Warmed rows
      // are already on screen by the time the refetch runs, and
      // replacing them with a spinner to fetch the same thing again is
      // the flash the warming exists to avoid.
      if (slot() && !slot().querySelector('.act')) slot().innerHTML = spinner();
    }

    // The default view — All, first page — is what
    // warmOtherTabs() fetches in the background while you are still on
    // the feed. Painting it before the network answers is the whole
    // reason for warming it.
    const isDefaultView = reset && activeTab === 'all';
    if (isDefaultView) {
      const warm = getCached(CACHE_KEYS.notifications);
      if (warm?.rows?.length) {
        rows = warm.rows; cursor = warm.cursor; hasMore = warm.hasMore;
        paintList();
      }
    }

    try {
      // All = the people you follow plus what is aimed at you, never your
      // own doings; Friends = only the people you follow; You = yours.
      const res = await api.getActivityFeed(viewerId, {
        scope: activeTab === 'you' ? 'you' : 'friends',
        includeYou: false,
        includeIncoming: activeTab === 'all',
        before: reset ? null : cursor,
      });
      if (my !== ticket) return; // another tab or refresh started meanwhile
      if (isDefaultView) setCached(CACHE_KEYS.notifications, res);
      rows = reset ? res.rows : rows.concat(res.rows);
      cursor = res.cursor;
      hasMore = res.hasMore;
      paintList();
      markVisibleRead();
    } catch (err) {
      if (my !== ticket) return;
      if (slot()) slot().innerHTML = `<p class="muted" style="padding:24px">Couldn't load activity: ${esc(err.message)}</p>`;
    } finally {
      if (my === ticket) loading = false;
    }
  }

  // Opening the screen is the act of reading it — but only the incoming
  // rows have a read state at all, and only they clear the bell. Done
  // AFTER the paint on purpose: the unread dots are the most useful
  // thing on screen the moment you arrive, so they are shown and then
  // cleared server-side rather than the list rendering already-read.
  function markVisibleRead() {
    const ids = rows.filter((r) => r.unread && r.notification_id).map((r) => r.notification_id);
    if (!ids.length) return;
    api.markNotificationsRead(ids)
      .then(() => { window.dispatchEvent(new CustomEvent('notifications:read')); })
      .catch(() => { /* the badge simply stays until the next load */ });
  }

  // Something new lands while this screen is open: it appears in the list now,
  // already read, instead of only bumping the bell. (The You tab is your own
  // doings, which a notification is never about.)
  const onIncoming = () => {
    if (!root.isConnected || activeTab === 'you' || loading) return;
    load({ reset: true });
  };
  window.addEventListener('notifications:incoming', onIncoming);
  paintShell();
  load({ reset: true });
}
