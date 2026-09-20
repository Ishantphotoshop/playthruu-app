import * as api from '../api.js';
import { state } from '../state.js';
import { navBar, avatarImg, emptyState, spinner, iconBell, iconBack } from '../components.js';
import { esc, timeAgo, starRow, qs, qsa } from '../utils.js';
import { navigate } from '../router.js';
import { wirePullToRefresh } from './feed-view.js';

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

// There used to be a funnel here, opening an "Activity filter" page with
// two switches for folding your own and incoming activity into the
// Friends stream. It is gone: the three tabs ALREADY split activity by
// whose it is, so the switches offered a second, overlapping way to
// answer the same question, and a filter icon on a notifications screen
// mostly reads as something being hidden from you.

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
  let rows = [];
  let cursor = null;
  let hasMore = false;
  let loading = false;
  let sentinelObserver = null;
  const viewerId = state.user?.id;

  // ---- the shell -------------------------------------------------------
  // Painted ONCE. The head is deliberately the same shape as the Search
  // tab's — a back chevron and a large title in the scrolling body, with
  // the segmented control directly beneath — so the Friends/You/Incoming
  // bar lands at the same height on screen as Games/Players does on
  // Search and Feed/News does on Home. It used to be a topbar plus a
  // separate sticky tab strip, which sat the pill at a different height
  // from every other tabbed screen in the app.
  function paintShell() {
    root.innerHTML = `
      <div class="view-body view-body--search" id="act-body">
        <div class="msg-inbox-head">
          <button type="button" class="inbox-back" data-action="back" aria-label="Back">${iconBack()}</button>
          <h1 class="msg-inbox-title">Notifications</h1>
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
    if (activeTab === 'incoming') return 'Nothing aimed at you yet. Follows, likes and comments on your reviews land here.';
    return 'Nothing from the people you follow yet.';
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
      if (slot()) slot().innerHTML = spinner();
    }

    try {
      const res = await api.getActivityFeed(viewerId, {
        scope: activeTab,
        includeYou: false,
        includeIncoming: false,
        before: reset ? null : cursor,
      });
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

  paintShell();
  load({ reset: true });
}
