import * as api from '../api.js';
import { state } from '../state.js';
import { navBar, spinner, emptyState, avatarImg, iconCompose, iconClose, iconMessage, iconTrash, iconSearch, iconDotsMenu, profileRow } from '../components.js';
import { esc, qs, qsa, toast, timeAgo, debounce, enableSwipeToDismiss } from '../utils.js';
import { navigate } from '../router.js';
import { wirePullToRefresh } from './feed-view.js';
import { getCached, setCached, CACHE_KEYS } from '../cache.js';

const MESSAGES_CACHE_KEY = CACHE_KEYS.messages;

// The inbox: two tabs sharing one fetch (see api.getConversations) —
// "Messages" is every thread that's either accepted, or one you started
// yourself and are still waiting on (shown as "Requested" rather than
// hidden, same as Instagram keeps your own outbound requests visible to
// you). "Requests" is everyone else's pending threads: people who
// aren't mutual follows yet, messaging you for the first time.
export async function renderMessagesView(root) {
  let tab = 'messages';
  // Painting from last visit's conversation list immediately (instead of
  // a spinner) is what removes the "reloads every time" feeling — load()
  // below still runs unconditionally right after, same as always, so a
  // new message that landed while you were away still shows up promptly.
  let all = getCached(MESSAGES_CACHE_KEY) || [];
  let playingBy = {};   // { userId: game } — "Playing X" context per row
  let presenceBy = {};  // { userId: lastSeenAt } — online dots
  let search = '';
  let unsubscribe = null;

  // Per-chat prefs (pin / mute / nickname) and blocks — loaded from the
  // server (see api.getConversationPrefs) so they follow you across
  // devices. prefs is keyed by conversation id.
  let prefs = {};              // { conversationId: { pinned, muted, nickname } }
  let blockedIds = new Set();  // people you've blocked — their chats are hidden
  const prefOf = (id) => prefs[id] || {};
  // A group's name: its title, else the members' names joined; a DM's name:
  // your nickname for them, else their display name / @handle.
  const groupName = (c) => c.title || (c.others || []).map((m) => m.display_name || m.username).slice(0, 3).join(', ') || 'Group';
  const nameOf = (c) => c.isGroup ? groupName(c) : (prefOf(c.id).nickname || c.other?.display_name || c.other?.username || 'Someone');
  const GROUP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M2.5 20c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6"/><circle cx="17.5" cy="8.7" r="2.3"/><path d="M17.5 14.2c2.9.1 4.8 2.3 4.8 5.1"/></svg>`;
  // A group's avatar is the two member faces stacked (Messenger-style), so
  // you recognise a group by who's in it; falls back to a group glyph if
  // there aren't two members to show yet.
  const groupStack = (members, size) => {
    const two = (members || []).slice(0, 2);
    if (two.length < 2) return `<span class="avatar avatar--group" style="width:${size}px;height:${size}px">${GROUP_ICON}</span>`;
    const inner = Math.round(size * 0.64);
    return `<span class="convo-stack" style="width:${size}px;height:${size}px">
      <span class="convo-stack__a convo-stack__a--back" style="width:${inner}px;height:${inner}px">${avatarImg(two[1], inner)}</span>
      <span class="convo-stack__a convo-stack__a--front" style="width:${inner}px;height:${inner}px">${avatarImg(two[0], inner)}</span>
    </span>`;
  };
  const avatarFor = (c, size) => c.isGroup ? groupStack(c.others && c.others.length ? c.others : c.members, size) : avatarImg(c.other, size);
  const PIN_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.6 2.6a1 1 0 0 0-1.5.1l-4.3 5.1-3.7 1.1a1 1 0 0 0-.4 1.7l3 3-4.4 4.4a1 1 0 1 0 1.4 1.4l4.4-4.4 3 3a1 1 0 0 0 1.7-.4l1.1-3.7 5.1-4.3a1 1 0 0 0 .1-1.5z"/></svg>`;
  const MUTE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>`;
  const UNREAD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z"/><circle cx="18" cy="6" r="3.2" fill="currentColor" stroke="none"/></svg>`;
  const TAG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><path d="M20.6 13.4 12 22l-8-8 8.6-8.6A2 2 0 0 1 14 4.8L20 5a1 1 0 0 1 1 1l.2 6a2 2 0 0 1-.6 1.4z"/><circle cx="16.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/></svg>`;
  const BLOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6 18.4 18.4"/></svg>`;
  const RESTRICT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A9 9 0 0 1 12 4c6 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s4 8 10 8a9 9 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>`;
  const REPORT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-1.5 4L16 12H5"/></svg>`;
  const LEAVE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`;

  root.innerHTML =
    `<div class="view-body view-body--no-topbar" id="messages-body">
       <div class="msg-inbox-head">
         <h1 class="msg-inbox-title">Messages</h1>
         <button type="button" class="msg-inbox-new" id="compose-btn" aria-label="New message">${iconCompose()}</button>
       </div>
       <div class="segmented segmented--wide" id="messages-tabs">
         <button type="button" class="segmented__item segmented__item--active" data-tab="messages">Chats</button>
         <button type="button" class="segmented__item" data-tab="requests" id="requests-tab-btn">Requests</button>
       </div>
       <div id="messages-list">${all.length ? '' : spinner()}</div>
     </div>` + navBar('/messages');

  const body = qs('#messages-body', root);
  wirePullToRefresh(body);

  if (all.length) paint();

  qs('#compose-btn', root).addEventListener('click', openComposeModal);
  qsa('.segmented__item', qs('#messages-tabs', body)).forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      qsa('.segmented__item', qs('#messages-tabs', body)).forEach((b) => b.classList.toggle('segmented__item--active', b === btn));
      paint();
    });
  });

  async function load() {
    try {
      const [convos, p, blocked] = await Promise.all([
        api.getConversations(state.user.id),
        api.getConversationPrefs(state.user.id).catch(() => ({})),
        api.getBlockedIds().catch(() => new Set()),
      ]);
      all = convos; prefs = p; blockedIds = blocked;
      setCached(MESSAGES_CACHE_KEY, all);
      paint();
      // Presence (online dots) + "Playing X" context are layered in after
      // the list is already up — a query each over the whole inbox.
      try {
        const ids = all.map((c) => c.other?.id);
        const [pl, pr] = await Promise.all([api.getPlayingByUsers(ids), api.getPresenceFor(ids)]);
        playingBy = pl; presenceBy = pr;
        paint();
      } catch { /* context is optional */ }
    } catch (err) {
      // A cached inbox is already on screen — leave it up rather than
      // replacing it with an error over a background refresh hiccup.
      if (!all.length) qs('#messages-list', body).innerHTML = `<p class="muted" style="padding:24px">Couldn't load your messages: ${esc(err.message)}</p>`;
    }
  }

  function paint() {
    const messages = all.filter((c) => c.status === 'accepted' || c.requested_by === state.user.id);
    const requests = all.filter((c) => c.status === 'pending' && c.requested_by !== state.user.id);

    const reqBtn = qs('#requests-tab-btn', body);
    if (reqBtn) reqBtn.textContent = requests.length ? `Requests (${requests.length})` : 'Requests';

    const listEl = qs('#messages-list', body);
    let rows = tab === 'messages' ? messages : requests;
    // Hide chats with people you've blocked, and chats you've restricted
    // (both are managed/undone from Settings).
    rows = rows.filter((c) => (c.isGroup || !blockedIds.has(c.other?.id)) && !prefOf(c.id).restricted);
    if (search) {
      rows = rows.filter((c) => {
        const p = c.other || {};
        return (`${nameOf(c)} ${p.username || ''}`).toLowerCase().includes(search);
      });
    }
    // Pinned chats float to the top; Array.sort is stable, so everything
    // else keeps its recency order underneath.
    if (tab === 'messages') rows = [...rows].sort((a, b) => (prefOf(b.id).pinned ? 1 : 0) - (prefOf(a.id).pinned ? 1 : 0));

    if (!rows.length) {
      listEl.innerHTML = search
        ? emptyState(`No chats match "${esc(search)}".`, { icon: iconSearch() })
        : tab === 'messages'
          ? emptyState('No messages yet. Message someone who follows you back to start a conversation right away.', { icon: iconMessage() })
          : emptyState('No message requests right now.', { icon: iconMessage() });
      return;
    }

    listEl.innerHTML = `<div class="convo-list">${rows.map((c) => convoRow(c, tab)).join('')}</div>`;

    qsa('[data-convo-id]', listEl).forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.convoId;
        // Opening a chat clears a manual "mark as unread".
        if (prefOf(id).unread) {
          prefs[id] = { ...prefOf(id), unread: false };
          api.setConversationPref(state.user.id, id, { unread: false }).catch(() => {});
        }
        navigate(`/messages/${id}`);
      });
    });
    qsa('[data-decline-id]', listEl).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this request?')) return;
        try {
          await api.deleteConversation(btn.dataset.declineId);
          all = all.filter((c) => c.id !== btn.dataset.declineId);
          paint();
        } catch (err) {
          toast(err.message || 'Could not delete that.', 'error');
        }
      });
    });
    qsa('[data-menu-id]', listEl).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = all.find((x) => x.id === btn.dataset.menuId);
        if (c) openConvoMenu(c);
      });
    });
  }

  // An in-app confirmation sheet (styled like the rest of the app) in place
  // of the browser's native confirm() dialog, which looks out of place and
  // can be suppressed inside an installed PWA. Resolves true/false.
  function confirmSheet({ title, message = '', confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal modal--sheet confirm-sheet">
          <header class="msg-actions__grab"></header>
          <h3 class="confirm-sheet__title">${esc(title)}</h3>
          ${message ? `<p class="confirm-sheet__msg">${esc(message)}</p>` : ''}
          <button type="button" class="confirm-sheet__btn ${danger ? 'confirm-sheet__btn--danger' : 'confirm-sheet__btn--go'}" data-yes>${esc(confirmLabel)}</button>
          <button type="button" class="confirm-sheet__btn confirm-sheet__btn--cancel" data-no>Cancel</button>
        </div>`;
      document.body.appendChild(overlay);
      const done = (val) => { overlay.remove(); resolve(val); };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
      qs('[data-yes]', overlay).addEventListener('click', () => done(true));
      qs('[data-no]', overlay).addEventListener('click', () => done(false));
      enableSwipeToDismiss(qs('.modal', overlay), () => done(false));
    });
  }

  // Per-chat options sheet, all server-backed (pin/mute/nickname in
  // conversation_prefs, block/report via the existing moderation API).
  function openConvoMenu(c) {
    const p = prefOf(c.id);
    const uid = state.user.id;
    const nm = nameOf(c);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const commonItems = `
          <button type="button" class="convo-menu__item" data-act="pin">${PIN_SVG}<span>${p.pinned ? 'Unpin from top' : 'Pin to top'}</span></button>
          <button type="button" class="convo-menu__item" data-act="mute">${MUTE_SVG}<span>${p.muted ? 'Unmute' : 'Mute'}</span></button>
          <button type="button" class="convo-menu__item" data-act="unread">${UNREAD_SVG}<span>Mark as unread</span></button>`;
    const groupItems = `
          <button type="button" class="convo-menu__item convo-menu__item--danger" data-act="leave">${LEAVE_SVG}<span>Leave group</span></button>`;
    const dmItems = `
          <button type="button" class="convo-menu__item" data-act="nickname">${TAG_SVG}<span>${p.nickname ? 'Change nickname' : 'Set nickname'}</span></button>
          <button type="button" class="convo-menu__item" data-act="restrict">${RESTRICT_SVG}<span>Restrict</span></button>
          <button type="button" class="convo-menu__item convo-menu__item--danger" data-act="block">${BLOCK_SVG}<span>Block</span></button>
          <button type="button" class="convo-menu__item convo-menu__item--danger" data-act="report">${REPORT_SVG}<span>Report</span></button>
          <button type="button" class="convo-menu__item convo-menu__item--danger" data-act="delete">${iconTrash()}<span>Delete chat</span></button>`;
    overlay.innerHTML = `
      <div class="modal modal--sheet">
        <header class="msg-actions__grab"></header>
        <div class="convo-menu">
          <div class="convo-menu__who">
            ${avatarFor(c, 42)}
            <div class="convo-menu__who-txt"><b>${esc(nm)}</b><span>${c.isGroup ? esc(`${(c.members || []).length} members`) : '@' + esc(c.other?.username || '')}</span></div>
          </div>
          ${commonItems}
          ${c.isGroup ? groupItems : dmItems}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    enableSwipeToDismiss(qs('.modal', overlay), close);

    // Optimistic pref write: patch local state + repaint now, persist after;
    // resync from the server if it fails.
    const setPref = async (patch, okMsg) => {
      prefs[c.id] = { ...prefOf(c.id), ...patch };
      close(); paint();
      try { await api.setConversationPref(uid, c.id, patch); if (okMsg) toast(okMsg); }
      catch (err) { toast(err.message || 'Could not save that.', 'error'); load(); }
    };

    qs('[data-act="pin"]', overlay).addEventListener('click', () => setPref({ pinned: !p.pinned }));
    qs('[data-act="mute"]', overlay).addEventListener('click', () => setPref({ muted: !p.muted }, p.muted ? 'Unmuted' : 'Muted'));
    qs('[data-act="unread"]', overlay).addEventListener('click', () => setPref({ unread: true }, 'Marked as unread'));
    qs('[data-act="leave"]', overlay)?.addEventListener('click', async () => {
      close();
      if (!(await confirmSheet({ title: `Leave ${nm}?`, message: "You'll stop getting this group's messages.", confirmLabel: 'Leave', danger: true }))) return;
      try {
        await api.leaveGroup(c.id, uid);
        all = all.filter((x) => x.id !== c.id);
        paint();
        toast('Left the group');
      } catch (err) { toast(err.message || 'Could not leave.', 'error'); }
    });
    qs('[data-act="restrict"]', overlay)?.addEventListener('click', () => setPref({ restricted: true }, 'Restricted — undo in Settings'));
    qs('[data-act="nickname"]', overlay)?.addEventListener('click', () => {
      const val = prompt(`Nickname for ${nm}`, p.nickname || '');
      if (val === null) { close(); return; }
      setPref({ nickname: val.trim() || null }, 'Nickname saved');
    });
    qs('[data-act="block"]', overlay)?.addEventListener('click', async () => {
      close();
      if (!(await confirmSheet({ title: `Block ${nm}?`, message: "Their chat is hidden and they can't reach you.", confirmLabel: 'Block', danger: true }))) return;
      try {
        await api.blockUser(c.other.id);
        api.invalidateBlockedCache();
        blockedIds.add(c.other.id);
        paint();
        toast(`Blocked ${nm}`);
      } catch (err) { toast(err.message || 'Could not block.', 'error'); }
    });
    qs('[data-act="report"]', overlay)?.addEventListener('click', async () => {
      close();
      const reason = prompt(`Report ${nm} — what's wrong? (optional)`, '');
      if (reason === null) return;
      try {
        await api.reportContent({ targetType: 'user', targetId: c.other.id, reason: reason.trim() || null });
        toast('Report sent — thanks for flagging it.');
      } catch (err) { toast(err.message || 'Could not send report.', 'error'); }
    });
    qs('[data-act="delete"]', overlay)?.addEventListener('click', async () => {
      close();
      if (!(await confirmSheet({ title: `Delete chat with ${nm}?`, message: 'This removes the conversation for you.', confirmLabel: 'Delete', danger: true }))) return;
      try {
        await api.deleteConversation(c.id);
        all = all.filter((x) => x.id !== c.id);
        paint();
      } catch (err) {
        toast(err.message || 'Could not delete that.', 'error');
      }
    });
  }

  function convoRow(c, currentTab) {
    const mine = c.last_message_sender_id === state.user.id;
    const iSentThisRequest = c.status === 'pending' && c.requested_by === state.user.id;
    let prefix = mine ? 'You: ' : '';
    // In a group, name whoever sent the last message (unless it was you).
    if (c.isGroup && !mine && c.last_message_sender_id) {
      const sender = (c.members || []).find((m) => m.id === c.last_message_sender_id);
      if (sender) prefix = `${(sender.display_name || sender.username).split(' ')[0]}: `;
    }
    const KIND_LABEL = { gif: 'Sent a GIF', image: 'Sent a photo', video: 'Sent a video', game: 'Shared a game' };
    const bodyPreview = KIND_LABEL[c.last_message_kind] ? `${prefix}${KIND_LABEL[c.last_message_kind]}`
      : `${prefix}${esc(c.last_message_body || '')}`;
    const preview = iSentThisRequest
      ? 'Request sent — waiting for a reply'
      : c.last_message_body ? bodyPreview : (c.isGroup ? 'New group — say hi' : 'Say hi and start the conversation');
    // Presence + "Playing" are per-person, so groups skip them.
    const playing = c.isGroup ? null : playingBy[c.other?.id];
    const playingChip = playing
      ? `<span class="convo-row__playing"><b>Playing</b> · ${esc(playing.title)}</span>`
      : (c.isGroup ? `<span class="convo-row__playing">${esc(`${(c.members || []).length} members`)}</span>` : '');
    const last = c.isGroup ? null : presenceBy[c.other?.id];
    const online = last && (Date.now() - new Date(last).getTime()) < 3 * 60 * 1000;
    const time = c.last_message_at ? `<span class="convo-row__time">${timeAgo(c.last_message_at)}</span>` : '';
    // Unread = the server-computed state OR a manual "mark as unread".
    const unread = c.unread || prefOf(c.id).unread;
    const pinMark = prefOf(c.id).pinned ? `<span class="convo-row__pin" aria-label="Pinned">${PIN_SVG}</span>` : '';
    const muteMark = prefOf(c.id).muted ? `<span class="convo-row__pin convo-row__mute" aria-label="Muted">${MUTE_SVG}</span>` : '';
    const rightBtn = currentTab === 'requests'
      ? `<button type="button" class="convo-row__decline" data-decline-id="${esc(c.id)}" aria-label="Delete request">${iconTrash()}</button>`
      : `<button type="button" class="convo-row__menu" data-menu-id="${esc(c.id)}" aria-label="Chat options">${iconDotsMenu()}</button>`;
    return `
      <div class="convo-row${unread ? ' convo-row--unread' : ''}" data-convo-id="${esc(c.id)}">
        <span class="convo-row__av">${avatarFor(c, 50)}${online ? '<span class="convo-row__presdot"></span>' : ''}</span>
        <div class="convo-row__body">
          <div class="convo-row__top">
            <span class="convo-row__name">${esc(nameOf(c))}</span>
            ${playingChip}
            ${pinMark}
            ${muteMark}
          </div>
          <div class="convo-row__line">
            <span class="convo-row__preview">${preview}</span>
            ${time}
          </div>
        </div>
        ${rightBtn}
      </div>`;
  }

  // New message OR new group. Direct mode: tap a person to open a DM.
  // Group mode: tap people to add them (chips), name it, Create group.
  function openComposeModal() {
    let mode = 'direct';
    const selected = new Map(); // id -> profile
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal--tall">
        <header class="modal__header"><h2 id="compose-title">New message</h2><button class="modal__close" data-close aria-label="Close">${iconClose()}</button></header>
        <div class="modal__body">
          <div class="segmented compose-mode" id="compose-mode">
            <button type="button" class="segmented__item segmented__item--active" data-mode="direct">Direct</button>
            <button type="button" class="segmented__item" data-mode="group">Group</button>
          </div>
          <div id="group-setup" hidden>
            <input type="text" id="group-name" class="compose-name" placeholder="Group name (optional)" maxlength="40" autocomplete="off">
            <div id="group-chips" class="compose-chips"></div>
          </div>
          <label class="field"><span id="compose-label">To</span><input type="text" id="compose-search" autocomplete="off" placeholder="Search people…"></label>
          <div id="compose-results"></div>
          <button type="button" class="btn btn--accent btn--block" id="create-group" hidden>Create group</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    qs('[data-close]', overlay).addEventListener('click', close);
    enableSwipeToDismiss(qs('.modal', overlay), close);

    const input = qs('#compose-search', overlay);
    const results = qs('#compose-results', overlay);
    const groupSetup = qs('#group-setup', overlay);
    const chipsEl = qs('#group-chips', overlay);
    const createBtn = qs('#create-group', overlay);
    let found = [];

    const refreshCreateBtn = () => {
      createBtn.hidden = !(mode === 'group' && selected.size >= 2);
      createBtn.textContent = `Create group${selected.size ? ` (${selected.size})` : ''}`;
    };
    const renderChips = () => {
      chipsEl.innerHTML = [...selected.values()].map((p) => `<span class="compose-chip" data-chip="${esc(p.id)}">${esc(p.display_name || p.username)}<button type="button" aria-label="Remove">${iconClose()}</button></span>`).join('');
      qsa('[data-chip]', chipsEl).forEach((chip) => chip.querySelector('button').addEventListener('click', () => { selected.delete(chip.dataset.chip); renderChips(); renderResults(); refreshCreateBtn(); }));
    };
    const renderResults = () => {
      if (!found.length) return;
      results.innerHTML = `<div class="profile-list">${found.map((p) => profileRow(p)).join('')}</div>`;
      qsa('.profile-row', results).forEach((row, i) => {
        const p = found[i];
        if (mode === 'group' && selected.has(p.id)) row.classList.add('profile-row--selected');
        row.addEventListener('click', (e) => {
          e.preventDefault();
          if (mode === 'direct') { close(); navigate(`/messages/new/${p.id}`); return; }
          if (selected.has(p.id)) selected.delete(p.id); else selected.set(p.id, p);
          renderChips(); renderResults(); refreshCreateBtn();
        });
      });
    };

    const doSearch = debounce(async () => {
      const q = input.value.trim();
      if (!q) { results.innerHTML = ''; found = []; return; }
      results.innerHTML = spinner();
      try {
        found = (await api.searchUsers(q)).filter((p) => p.id !== state.user.id);
        if (!found.length) { results.innerHTML = `<p class="muted">No one found for "${esc(q)}".</p>`; return; }
        renderResults();
      } catch (err) {
        results.innerHTML = `<p class="muted">Couldn't search right now: ${esc(err.message)}</p>`;
      }
    }, 350);
    input.addEventListener('input', doSearch);

    qsa('[data-mode]', overlay).forEach((btn) => btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      qsa('[data-mode]', overlay).forEach((b) => b.classList.toggle('segmented__item--active', b === btn));
      groupSetup.hidden = mode !== 'group';
      qs('#compose-title', overlay).textContent = mode === 'group' ? 'New group' : 'New message';
      qs('#compose-label', overlay).textContent = mode === 'group' ? 'Add people' : 'To';
      refreshCreateBtn();
      renderResults();
    }));

    createBtn.addEventListener('click', async () => {
      if (selected.size < 2) return;
      createBtn.disabled = true; createBtn.textContent = 'Creating…';
      try {
        const id = await api.createGroup(state.user.id, [...selected.keys()], qs('#group-name', overlay).value);
        close();
        navigate(`/messages/${id}`);
      } catch (err) {
        toast(err.message || 'Could not create the group.', 'error');
        createBtn.disabled = false; refreshCreateBtn();
      }
    });
    qs('#group-name', overlay).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && selected.size >= 2) { e.preventDefault(); createBtn.click(); }
    });

    input.focus();
  }

  // Live inbox: a new request landing, a reply arriving, or a thread
  // being read elsewhere all just refetch-and-repaint here rather than
  // trying to patch one row in place — the list is small enough that a
  // full refetch is cheap, and it's the only way that's guaranteed to
  // stay correct as status/requested_by/read markers all shift at once.
  unsubscribe = api.subscribeToConversations(state.user.id, load);
  window.addEventListener('hashchange', () => unsubscribe?.(), { once: true });

  await load();
}
