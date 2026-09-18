import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, avatarImg, emptyState, spinner, iconBell } from '../components.js';
import { esc, timeAgo, qs, qsa, toast } from '../utils.js';
import { navigate } from '../router.js';

// One hub for everything that happened to you — follows, likes,
// comments and messages in a single stream instead of four places to
// check. The three tabs are about WHO, not what: the same like from
// somebody you follow and somebody you have never heard of are very
// different events, and splitting on that is what keeps a stranger's
// activity from burying a friend's.
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'friends', label: 'Friends' },
  { id: 'incoming', label: 'Incoming' },
];

function actorName(n) {
  const a = n.actor;
  if (!a) return 'Someone';
  return a.display_name || a.username || 'Someone';
}

// What the row says, and where tapping it goes. Kept together because
// they are the same decision — a notification the app cannot open is a
// notification it should not be phrasing as a link.
function describe(n) {
  const who = esc(actorName(n));
  const game = n.log?.games?.title ? esc(n.log.games.title) : null;

  switch (n.kind) {
    case 'follow':
      return {
        text: `<b>${who}</b> started following you`,
        href: n.actor?.username ? `/profile/${n.actor.username}` : null,
      };
    case 'like':
      return {
        text: game
          ? `<b>${who}</b> liked your review of <b>${game}</b>`
          : `<b>${who}</b> liked your review`,
        href: n.log_id ? `/review/${n.log_id}` : null,
      };
    case 'comment': {
      // The comment itself is the point of the notification — showing a
      // snippet is the difference between "go and look" and "here is
      // what they said".
      const body = n.comment?.body ? esc(n.comment.body.slice(0, 90)) : '';
      return {
        text: body
          ? `<b>${who}</b> commented: <span class="notif__quote">${body}${n.comment.body.length > 90 ? '…' : ''}</span>`
          : `<b>${who}</b> commented on your review`,
        href: n.log_id ? `/review/${n.log_id}` : null,
      };
    }
    case 'message':
      return {
        text: `<b>${who}</b> sent you a message`,
        href: n.conversation_id ? `/messages/${n.conversation_id}` : null,
      };
    default:
      return { text: `<b>${who}</b> did something`, href: null };
  }
}

// A stream of "X sent you a message" is the one kind that genuinely
// repeats — five messages in a row from the same person is one thing
// that happened, not five. Collapsed to the newest per conversation,
// carrying the count so the row can say so. Every other kind is left
// alone: three different people liking the same review really is three
// events, and merging them would hide two of them.
function collapseMessages(rows) {
  const seen = new Map();
  const out = [];
  for (const n of rows) {
    if (n.kind !== 'message' || !n.conversation_id) { out.push(n); continue; }
    const prior = seen.get(n.conversation_id);
    if (prior) {
      prior.groupCount = (prior.groupCount || 1) + 1;
      // Unread-ness is a property of the group: one unread message in
      // the bundle means the bundle is unread.
      if (!n.read_at) prior.read_at = null;
      continue;
    }
    const copy = { ...n, groupCount: 1 };
    seen.set(n.conversation_id, copy);
    out.push(copy);
  }
  return out;
}

function notifRow(n) {
  const { text, href } = describe(n);
  const unread = !n.read_at;
  const count = n.groupCount > 1 ? `<span class="notif__count">${n.groupCount}</span>` : '';
  // A button, not an anchor: some rows have nowhere to go (the actor
  // deleted their account) and a dead <a href> is worse than a row that
  // simply does not respond.
  return `
    <button type="button" class="notif${unread ? ' notif--unread' : ''}" data-id="${esc(n.id)}"${href ? ` data-href="${esc(href)}"` : ''}>
      <span class="notif__avatar">${n.actor ? avatarImg(n.actor, 40) : ''}</span>
      <span class="notif__body">
        <span class="notif__text">${text}</span>
        <span class="notif__time">${esc(timeAgo(n.created_at))}</span>
      </span>
      ${count}
      ${unread ? '<span class="notif__dot" aria-label="Unread"></span>' : ''}
    </button>`;
}

export async function renderNotificationsView(root) {
  let activeTab = 'all';
  let rows = [];
  let followingIds = new Set();

  root.innerHTML = topBar('Notifications', {
    back: true,
    right: '<button type="button" class="topbar__action" id="notif-read-all">Mark all read</button>',
  }) + `
    <div class="segmented segmented--wide" id="notif-tabs">
      ${TABS.map((t) => `<button class="segmented__item${t.id === 'all' ? ' segmented__item--active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div class="view-body" id="notif-body">${spinner()}</div>` + navBar('');

  const body = qs('#notif-body', root);

  function visible() {
    if (activeTab === 'all') return rows;
    // Friends vs Incoming is decided purely by whether you follow the
    // actor. A notification with no actor left (deleted account) is
    // nobody's friend, so it lands in Incoming rather than vanishing.
    const isFriend = (n) => n.actor_id && followingIds.has(n.actor_id);
    return activeTab === 'friends' ? rows.filter(isFriend) : rows.filter((n) => !isFriend(n));
  }

  function paint() {
    const list = collapseMessages(visible());
    if (!list.length) {
      const msg = activeTab === 'friends'
        ? 'Nothing from people you follow yet.'
        : activeTab === 'incoming'
          ? 'Nothing from anyone new yet.'
          : 'No notifications yet — likes, comments, follows and messages all land here.';
      body.innerHTML = emptyState(msg, { icon: iconBell() });
      return;
    }
    body.innerHTML = `<div class="notif-list">${list.map(notifRow).join('')}</div>`;
  }

  try {
    const [fetched, following] = await Promise.all([
      api.getNotifications(state.user.id),
      api.getFollowingIdSet(state.user.id),
    ]);
    rows = fetched;
    followingIds = following;
    paint();

    // Opening the hub is the act of reading it. Marked after the first
    // paint, deliberately: the unread dots are the most useful thing on
    // screen the moment you arrive, so they are shown and THEN cleared
    // server-side, rather than the list rendering already-read.
    if (rows.some((n) => !n.read_at)) {
      api.markAllNotificationsRead(state.user.id)
        .then(() => { window.dispatchEvent(new CustomEvent('notifications:read')); })
        .catch(() => { /* the badge simply stays until the next load */ });
    }
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load notifications: ${esc(err.message)}</p>`;
    return;
  }

  qsa('#notif-tabs .segmented__item', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('#notif-tabs .segmented__item', root).forEach((b) => b.classList.remove('segmented__item--active'));
      btn.classList.add('segmented__item--active');
      activeTab = btn.dataset.tab;
      paint();
    });
  });

  body.addEventListener('click', (e) => {
    const row = e.target.closest('.notif');
    if (!row?.dataset.href) return;
    navigate(row.dataset.href);
  });

  qs('#notif-read-all', root)?.addEventListener('click', async () => {
    try {
      await api.markAllNotificationsRead(state.user.id);
      rows = rows.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
      paint();
      window.dispatchEvent(new CustomEvent('notifications:read'));
      toast('All caught up');
    } catch {
      toast("Couldn't mark those read");
    }
  });
}
