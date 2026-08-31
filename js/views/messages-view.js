import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, avatarImg, iconPlus, iconClose, iconMessage, iconTrash, profileRow } from '../components.js';
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
  let unsubscribe = null;

  root.innerHTML = topBar('', { home: true, right: `<button class="icon-btn" id="compose-btn" aria-label="New message">${iconPlus()}</button>` }) +
    `<div class="view-body" id="messages-body">
       <div class="segmented segmented--wide" id="messages-tabs">
         <button type="button" class="segmented__item segmented__item--active" data-tab="messages">Messages</button>
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
      all = await api.getConversations(state.user.id);
      setCached(MESSAGES_CACHE_KEY, all);
      paint();
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
    const rows = tab === 'messages' ? messages : requests;

    if (!rows.length) {
      listEl.innerHTML = tab === 'messages'
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
  }

  function convoRow(c, currentTab) {
    const mine = c.last_message_sender_id === state.user.id;
    const iSentThisRequest = c.status === 'pending' && c.requested_by === state.user.id;
    const prefix = mine ? 'You: ' : '';
    const KIND_LABEL = { gif: 'Sent a GIF', image: 'Sent a photo', video: 'Sent a video' };
    const bodyPreview = KIND_LABEL[c.last_message_kind] ? `${prefix}${KIND_LABEL[c.last_message_kind]}`
      : `${prefix}${esc(c.last_message_body || '')}`;
    const preview = iSentThisRequest
      ? 'Request sent — waiting for a reply'
      : c.last_message_body ? bodyPreview : 'Say hi and start the conversation';
    return `
      <div class="convo-row${c.unread ? ' convo-row--unread' : ''}" data-convo-id="${esc(c.id)}">
        ${avatarImg(c.other, 46)}
        <div class="convo-row__body">
          <div class="convo-row__top">
            <span class="convo-row__name">${esc(c.other.display_name || c.other.username)}</span>
            ${c.last_message_at ? `<span class="convo-row__time">${timeAgo(c.last_message_at)}</span>` : ''}
          </div>
          <p class="convo-row__preview">${preview}</p>
        </div>
        ${currentTab === 'requests' ? `<button type="button" class="convo-row__decline" data-decline-id="${esc(c.id)}" aria-label="Delete request">${iconTrash()}</button>` : ''}
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
