import * as api from '../api.js';
import { state } from '../state.js';
import { navBar, spinner, emptyState, avatarImg, iconCompose, iconClose, iconMessage, iconTrash, iconSearch, iconDotsMenu, profileRow } from '../components.js';
import { esc, qs, qsa, toast, timeAgo, debounce, enableSwipeToDismiss } from '../utils.js';
import { navigate } from '../router.js';
import { wirePullToRefresh } from './feed-view.js';
import { getCached, setCached } from '../cache.js';

const MESSAGES_CACHE_KEY = 'messages';

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
  const nameOf = (c) => prefOf(c.id).nickname || c.other.display_name || c.other.username;
  const PIN_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.6 2.6a1 1 0 0 0-1.5.1l-4.3 5.1-3.7 1.1a1 1 0 0 0-.4 1.7l3 3-4.4 4.4a1 1 0 1 0 1.4 1.4l4.4-4.4 3 3a1 1 0 0 0 1.7-.4l1.1-3.7 5.1-4.3a1 1 0 0 0 .1-1.5z"/></svg>`;
  const MUTE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>`;
  const UNREAD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z"/><circle cx="18" cy="6" r="3.2" fill="currentColor" stroke="none"/></svg>`;
  const TAG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><path d="M20.6 13.4 12 22l-8-8 8.6-8.6A2 2 0 0 1 14 4.8L20 5a1 1 0 0 1 1 1l.2 6a2 2 0 0 1-.6 1.4z"/><circle cx="16.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/></svg>`;
  const BLOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6 18.4 18.4"/></svg>`;
  const REPORT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-1.5 4L16 12H5"/></svg>`;

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
    // Hide chats with people you've blocked.
    rows = rows.filter((c) => !blockedIds.has(c.other?.id));
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
      el.addEventListener('click', () => navigate(`/messages/${el.dataset.convoId}`));
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

  // Per-chat options sheet, all server-backed (pin/mute/nickname in
  // conversation_prefs, block/report in their own tables).
  function openConvoMenu(c) {
    const p = prefOf(c.id);
    const uid = state.user.id;
    const nm = c.other.display_name || c.other.username;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal--sheet">
        <header class="msg-actions__grab"></header>
        <div class="convo-menu">
          <div class="convo-menu__who">
            ${avatarImg(c.other, 42)}
            <div class="convo-menu__who-txt"><b>${esc(nameOf(c))}</b><span>@${esc(c.other.username)}</span></div>
          </div>
          <button type="button" class="convo-menu__item" data-act="pin">${PIN_SVG}<span>${p.pinned ? 'Unpin from top' : 'Pin to top'}</span></button>
          <button type="button" class="convo-menu__item" data-act="mute">${MUTE_SVG}<span>${p.muted ? 'Unmute' : 'Mute'}</span></button>
          <button type="button" class="convo-menu__item" data-act="unread">${UNREAD_SVG}<span>Mark as unread</span></button>
          <button type="button" class="convo-menu__item" data-act="nickname">${TAG_SVG}<span>${p.nickname ? 'Change nickname' : 'Set nickname'}</span></button>
          <button type="button" class="convo-menu__item convo-menu__item--danger" data-act="block">${BLOCK_SVG}<span>Block</span></button>
          <button type="button" class="convo-menu__item convo-menu__item--danger" data-act="report">${REPORT_SVG}<span>Report</span></button>
          <button type="button" class="convo-menu__item convo-menu__item--danger" data-act="delete">${iconTrash()}<span>Delete chat</span></button>
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
    qs('[data-act="nickname"]', overlay).addEventListener('click', () => {
      const val = prompt(`Nickname for ${nm}`, p.nickname || '');
      if (val === null) { close(); return; }
      setPref({ nickname: val.trim() || null }, 'Nickname saved');
    });
    qs('[data-act="unread"]', overlay).addEventListener('click', async () => {
      close();
      try { await api.markConversationUnread(c.id); await load(); }
      catch (err) { toast(err.message || 'Could not mark unread.', 'error'); }
    });
    qs('[data-act="block"]', overlay).addEventListener('click', async () => {
      close();
      if (!confirm(`Block ${nm}? Their chat is hidden and they can't reach you.`)) return;
      try {
        await api.blockUser(c.other.id);
        api.invalidateBlockedCache();
        blockedIds.add(c.other.id);
        paint();
        toast(`Blocked ${nm}`);
      } catch (err) { toast(err.message || 'Could not block.', 'error'); }
    });
    qs('[data-act="report"]', overlay).addEventListener('click', async () => {
      close();
      const reason = prompt(`Report ${nm} — what's wrong? (optional)`, '');
      if (reason === null) return;
      try {
        await api.reportContent({ targetType: 'user', targetId: c.other.id, reason: reason.trim() || null });
        toast('Report sent — thanks for flagging it.');
      } catch (err) { toast(err.message || 'Could not send report.', 'error'); }
    });
    qs('[data-act="delete"]', overlay).addEventListener('click', async () => {
      close();
      if (!confirm(`Delete your chat with ${nm}?`)) return;
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
    const prefix = mine ? 'You: ' : '';
    const KIND_LABEL = { gif: 'Sent a GIF', image: 'Sent a photo', video: 'Sent a video', game: 'Shared a game' };
    const bodyPreview = KIND_LABEL[c.last_message_kind] ? `${prefix}${KIND_LABEL[c.last_message_kind]}`
      : `${prefix}${esc(c.last_message_body || '')}`;
    const preview = iSentThisRequest
      ? 'Request sent — waiting for a reply'
      : c.last_message_body ? bodyPreview : 'Say hi and start the conversation';
    const playing = playingBy[c.other?.id];
    const ctx = playing
      ? `<div class="convo-row__ctx"><b>Playing</b> · ${esc(playing.title)}</div>`
      : '';
    const last = presenceBy[c.other?.id];
    const online = last && (Date.now() - new Date(last).getTime()) < 3 * 60 * 1000;
    const time = c.last_message_at ? `<span class="convo-row__time">${timeAgo(c.last_message_at)}</span>` : '';
    const pinMark = prefOf(c.id).pinned ? `<span class="convo-row__pin" aria-label="Pinned">${PIN_SVG}</span>` : '';
    const muteMark = prefOf(c.id).muted ? `<span class="convo-row__pin convo-row__mute" aria-label="Muted">${MUTE_SVG}</span>` : '';
    const rightBtn = currentTab === 'requests'
      ? `<button type="button" class="convo-row__decline" data-decline-id="${esc(c.id)}" aria-label="Delete request">${iconTrash()}</button>`
      : `<button type="button" class="convo-row__menu" data-menu-id="${esc(c.id)}" aria-label="Chat options">${iconDotsMenu()}</button>`;
    return `
      <div class="convo-row${c.unread ? ' convo-row--unread' : ''}" data-convo-id="${esc(c.id)}">
        <span class="convo-row__av">${avatarImg(c.other, 46)}${online ? '<span class="convo-row__presdot"></span>' : ''}</span>
        <div class="convo-row__body">
          <div class="convo-row__top">
            <span class="convo-row__name">${esc(nameOf(c))}</span>
            ${pinMark}
            ${muteMark}
            ${rightBtn}
          </div>
          <div class="convo-row__line">
            <span class="convo-row__preview">${preview}</span>
            ${time}
          </div>
          ${ctx}
        </div>
      </div>`;
  }

  function openComposeModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal--tall">
        <header class="modal__header"><h2>New message</h2><button class="modal__close" data-close aria-label="Close">${iconClose()}</button></header>
        <div class="modal__body">
          <label class="field"><span>To</span><input type="text" id="compose-search" autocomplete="off" placeholder="Search people…"></label>
          <div id="compose-results"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    qs('[data-close]', overlay).addEventListener('click', close);
    enableSwipeToDismiss(qs('.modal', overlay), close);

    const input = qs('#compose-search', overlay);
    const results = qs('#compose-results', overlay);
    let found = [];

    const doSearch = debounce(async () => {
      const q = input.value.trim();
      if (!q) { results.innerHTML = ''; return; }
      results.innerHTML = spinner();
      try {
        found = (await api.searchUsers(q)).filter((p) => p.id !== state.user.id);
        results.innerHTML = found.length
          ? `<div class="profile-list">${found.map((p) => profileRow(p)).join('')}</div>`
          : `<p class="muted">No one found for "${esc(q)}".</p>`;
        qsa('.profile-row', results).forEach((row, i) => {
          row.addEventListener('click', (e) => {
            e.preventDefault();
            close();
            navigate(`/messages/new/${found[i].id}`);
          });
        });
      } catch (err) {
        results.innerHTML = `<p class="muted">Couldn't search right now: ${esc(err.message)}</p>`;
      }
    }, 350);
    input.addEventListener('input', doSearch);
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
