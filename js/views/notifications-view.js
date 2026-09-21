import * as api from '../api.js';
import { state } from '../state.js';
import { navBar, avatarImg, emptyState, spinner, iconBell, iconFilter, iconBack, iconCheck } from '../components.js';
import { esc, timeAgo, starRow, qs, qsa } from '../utils.js';
import { navigate } from '../router.js';
import { wirePullToRefresh } from './feed-view.js';
import { getCached, setCached, CACHE_KEYS } from '../cache.js';

// One screen for everything happening in the app: what the people you
// follow have logged, liked and followed, what you have done yourself,
// and what has been aimed at you. Messages are the deliberate exception
// — a DM belongs in the messenger with its own unread state, not in a
// public-shaped activity list.
//
// The three tabs are about WHOSE activity it is, which is the split that
// actually matters. Friends is the default because it is the only one
// that is genuinely a feed; You is a diary of your own actions; Incoming
// is the narrow "somebody did something to me" inbox.
const TABS = [
  { id: 'friends', label: 'Friends' },
  { id: 'you', label: 'You' },
  { id: 'incoming', label: 'Incoming' },
];

// The two filters live on the Friends tab only, because they are both
// about what ELSE to fold into that stream — neither means anything on a
// tab that is already defined as exactly one of those things.
const FILTER_KEY = 'playthruu:activity-filters';
const FILTER_DEFAULTS = { includeYou: false, includeIncoming: false };

function loadFilters() {
  try {
    return { ...FILTER_DEFAULTS, ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}') };
  } catch {
    return { ...FILTER_DEFAULTS };
  }
}

function saveFilters(f) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* private mode */ }
}

function nameOf(profile, fallback = 'Someone') {
  if (!profile) return fallback;
  return profile.display_name || profile.username || fallback;
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
  const who = isYou ? 'You' : esc(nameOf(row.actor));
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
        : `${esc(nameOf(row.target))}'s`;
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
        : esc(nameOf(row.target));
      return {
        text: `${who} followed ${target}`,
        href: profileHref(isYou ? row.target : row.actor),
      };
    }

    case 'comment': {
      const whose = row.targetIsViewer || row.target?.id === viewerId
        ? 'your'
        : `${esc(nameOf(row.target))}'s`;
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
  const clipped = quote && quote.length > 120 ? `${quote.slice(0, 120)}…` : quote;
  // A button rather than an anchor: plenty of rows have nowhere to go
  // (a deleted log, an account since removed) and a dead href is worse
  // than a row that simply does not respond to a tap.
  return `
    <button type="button" class="act${unread ? ' act--unread' : ''}"${href ? ` data-href="${esc(href)}"` : ''}>
      <span class="act__avatar">${avatar}</span>
      <span class="act__body">
        <span class="act__text">${text}</span>
        ${clipped ? `<span class="act__quote">${esc(clipped)}</span>` : ''}
      </span>
      <span class="act__time">${esc(timeAgo(row.created_at))}</span>
      ${unread ? '<span class="act__dot" aria-label="New"></span>' : ''}
    </button>`;
}

export async function renderNotificationsView(root) {
  let activeTab = 'friends';
  let filters = loadFilters();
  let rows = [];
  let cursor = null;
  let hasMore = false;
  let loading = false;
  let sentinelObserver = null;
  const viewerId = state.user?.id;

  function activeFilterCount() {
    return (filters.includeYou ? 1 : 0) + (filters.includeIncoming ? 1 : 0);
  }

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
    const count = activeFilterCount();
    root.innerHTML = `
      <div class="view-body view-body--search" id="act-body">
        <div class="msg-inbox-head">
          <h1 class="msg-inbox-title">Notifications</h1>
          <button type="button" class="act-filter-btn${count ? ' act-filter-btn--active' : ''}" id="act-filter" aria-label="Activity filter"${activeTab === 'friends' ? '' : ' hidden'}>
            ${iconFilter()}${count ? `<span class="act-filter-btn__count">${count}</span>` : ''}
          </button>
        </div>
        <div class="segmented segmented--wide" id="act-tabs">
          ${TABS.map((t) => `<button class="segmented__item${t.id === activeTab ? ' segmented__item--active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div id="act-slot">${spinner()}</div>
      </div>` + navBar('');

    qsa('#act-tabs .segmented__item', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === activeTab) return;
        activeTab = btn.dataset.tab;
        qsa('#act-tabs .segmented__item', root).forEach((b) =>
          b.classList.toggle('segmented__item--active', b.dataset.tab === activeTab));
        // The two switches only mean anything on Friends (see above), so
        // the chip goes away on the other two rather than sitting there
        // doing nothing.
        const chip = qs('#act-filter', root);
        if (chip) chip.hidden = activeTab !== 'friends';
        load({ reset: true });
      });
    });

    qs('#act-filter', root)?.addEventListener('click', paintFilterScreen);

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
    if (activeTab === 'incoming') return 'Nothing aimed at you yet. Follows, likes and comments on your reviews land here.';
    return activeFilterCount()
      ? 'Nothing here yet. Follow a few people and their activity fills this in.'
      : 'Nothing from the people you follow yet. Try the filter to fold in your own and incoming activity.';
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
    }, { root: qs('#act-body', root), rootMargin: '300px' });
    sentinelObserver.observe(sentinel);
  }

  async function load({ reset }) {
    if (loading) return;
    if (!reset && !hasMore) return;
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

    // The default view — Friends, filters off, first page — is what
    // warmOtherTabs() fetches in the background while you are still on
    // the feed. Painting it before the network answers is the whole
    // reason for warming it.
    const isDefaultView = reset && activeTab === 'friends'
      && !filters.includeYou && !filters.includeIncoming;
    if (isDefaultView) {
      const warm = getCached(CACHE_KEYS.notifications);
      if (warm?.rows?.length) {
        rows = warm.rows; cursor = warm.cursor; hasMore = warm.hasMore;
        paintList();
      }
    }

    try {
      const res = await api.getActivityFeed(viewerId, {
        scope: activeTab,
        includeYou: filters.includeYou,
        includeIncoming: filters.includeIncoming,
        before: reset ? null : cursor,
      });
      if (isDefaultView) setCached(CACHE_KEYS.notifications, res);
      rows = reset ? res.rows : rows.concat(res.rows);
      cursor = res.cursor;
      hasMore = res.hasMore;
      paintList();
      markVisibleRead();
    } catch (err) {
      if (slot()) slot().innerHTML = `<p class="muted" style="padding:24px">Couldn't load activity: ${esc(err.message)}</p>`;
    } finally {
      loading = false;
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

  // ---- the filter screen ------------------------------------------------
  // A real page rather than a sheet, matching the Discover filters: the
  // back arrow discards, the tick applies. Edits land on a draft so
  // nothing takes effect until it is actually confirmed.
  function paintFilterScreen() {
    const draft = { ...filters };

    root.innerHTML = `
      <header class="topbar">
        <button type="button" class="topbar__back" id="act-filters-cancel" aria-label="Back">${iconBack()}</button>
        <h1 class="topbar__title">Activity filter</h1>
        <div class="topbar__right">
          <button type="button" class="topbar__back" id="act-filters-apply" aria-label="Apply filter">${iconCheck()}</button>
        </div>
      </header>
      <div class="view-body">
        <div class="set-card">
          <div class="set-toggle">
            <span class="set-toggle__label"><b>Include your activity</b><span>Your own logs, likes and follows, mixed into the Friends stream</span></span>
            <label class="set-switch"><input type="checkbox" data-filter="includeYou"${draft.includeYou ? ' checked' : ''}><span class="set-switch__track"></span></label>
          </div>
          <div class="set-toggle">
            <span class="set-toggle__label"><b>Include incoming activity</b><span>Follows, likes and comments aimed at you, from anyone</span></span>
            <label class="set-switch"><input type="checkbox" data-filter="includeIncoming"${draft.includeIncoming ? ' checked' : ''}><span class="set-switch__track"></span></label>
          </div>
        </div>
        <p class="set-hint">Both off is the pure Friends feed — only the people you follow.</p>
      </div>`;

    qsa('input[data-filter]', root).forEach((input) => {
      input.addEventListener('change', () => { draft[input.dataset.filter] = input.checked; });
    });
    qs('#act-filters-cancel', root).addEventListener('click', () => {
      paintShell();
      paintList();
    });
    qs('#act-filters-apply', root).addEventListener('click', () => {
      filters = draft;
      saveFilters(filters);
      paintShell();
      load({ reset: true });
    });
  }

  paintShell();
  load({ reset: true });
}
