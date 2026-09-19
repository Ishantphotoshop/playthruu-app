import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, avatarImg, emptyState, spinner, iconBell, iconFilter, iconBack, iconCheck } from '../components.js';
import { esc, timeAgo, starRow, qs, qsa, toast } from '../utils.js';
import { navigate } from '../router.js';

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
function describe(row, viewerId) {
  const isYou = row.actor_id === viewerId;
  const who = isYou ? 'You' : `<b>${esc(nameOf(row.actor))}</b>`;
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
        : `<b>${esc(nameOf(row.target))}</b>'s`;
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
        : `<b>${esc(nameOf(row.target))}</b>`;
      return {
        text: `${who} followed ${target}`,
        href: profileHref(isYou ? row.target : row.actor),
      };
    }

    case 'comment': {
      const whose = row.targetIsViewer || row.target?.id === viewerId
        ? 'your'
        : `<b>${esc(nameOf(row.target))}</b>'s`;
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
  const viewerId = state.user?.id;

  function activeFilterCount() {
    return (filters.includeYou ? 1 : 0) + (filters.includeIncoming ? 1 : 0);
  }

  // ---- the stream -------------------------------------------------------
  function paintShell() {
    const count = activeFilterCount();
    root.innerHTML = topBar('Notifications', { back: true, brand: true, flush: true }) + `
      <div class="act-tabs">
        <div class="segmented segmented--wide" id="act-tabs">
          ${TABS.map((t) => `<button class="segmented__item${t.id === activeTab ? ' segmented__item--active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <button type="button" class="act-filter-btn${count ? ' act-filter-btn--active' : ''}" id="act-filter" aria-label="Activity filter"${activeTab === 'friends' ? '' : ' hidden'}>
          ${iconFilter()}${count ? `<span class="act-filter-btn__count">${count}</span>` : ''}
        </button>
      </div>
      <div class="view-body" id="act-body">${spinner()}</div>` + navBar('');

    qsa('#act-tabs .segmented__item', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === activeTab) return;
        activeTab = btn.dataset.tab;
        load({ reset: true });
      });
    });

    qs('#act-filter', root)?.addEventListener('click', paintFilterScreen);

    qs('#act-body', root).addEventListener('click', (e) => {
      const more = e.target.closest('#act-more');
      if (more) { load({ reset: false }); return; }
      const rowEl = e.target.closest('.act');
      if (rowEl?.dataset.href) navigate(rowEl.dataset.href);
    });
  }

  function emptyMessage() {
    if (activeTab === 'you') return "You haven't done anything yet — log a game and it shows up here.";
    if (activeTab === 'incoming') return 'Nothing aimed at you yet. Follows, likes and comments on your reviews land here.';
    return activeFilterCount()
      ? 'Nothing here yet. Follow a few people and their activity fills this in.'
      : 'Nothing from the people you follow yet. Try the filter to fold in your own and incoming activity.';
  }

  function paintList() {
    const body = qs('#act-body', root);
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = emptyState(emptyMessage(), { icon: iconBell() });
      return;
    }
    body.innerHTML = `
      <div class="act-list">${rows.map((r) => activityRow(r, viewerId)).join('')}</div>
      ${hasMore ? '<button type="button" class="btn btn--ghost btn--block act-more" id="act-more">Load more</button>' : ''}`;
  }

  async function load({ reset }) {
    if (loading) return;
    loading = true;
    if (reset) {
      rows = [];
      cursor = null;
      hasMore = false;
      paintShell();
    } else {
      const more = qs('#act-more', root);
      if (more) { more.disabled = true; more.textContent = 'Loading…'; }
    }

    try {
      const res = await api.getActivityFeed(viewerId, {
        scope: activeTab,
        includeYou: filters.includeYou,
        includeIncoming: filters.includeIncoming,
        before: reset ? null : cursor,
      });
      rows = reset ? res.rows : rows.concat(res.rows);
      cursor = res.cursor;
      hasMore = res.hasMore;
      paintList();
      markVisibleRead();
    } catch (err) {
      const body = qs('#act-body', root);
      if (body) body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load activity: ${esc(err.message)}</p>`;
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
      load({ reset: true });
    });
  }

  load({ reset: true });
}
