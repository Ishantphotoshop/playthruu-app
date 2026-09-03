import * as api from '../api.js';
import { state } from '../state.js';
import {
  topBar, avatarImg, iconSend, iconDotsMenu, iconGif, iconPlus,
  iconReply, iconInfo, iconCopy, iconTrash, iconClose, iconSearch,
  iconGamepad, iconChevronRight, iconCamera, iconList, iconNote, iconStamp,
} from '../components.js';
import { esc, qs, qsa, toast, timeAgo, formatDate, debounce, enableSwipeToDismiss, recordRecentEmoji, getRecentEmoji } from '../utils.js';
import { navigate } from '../router.js';
import { TOP_EMOJI, EMOJI_LIST, searchEmoji } from '../emoji-data.js';

const REFRESH_MS = 30000; // how often relative timestamps re-render on their own
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // a soft cap so a huge video doesn't just hang on mobile data
const DOUBLE_TAP_MS = 300;
const LONG_PRESS_MS = 420;
const HEART_REACTION = '❤️';

// One conversation — or, via /messages/new/:userId, the START of one
// that doesn't exist as a row yet (see api.getConversationBetween vs
// getOrCreateConversation: opening this screen only ever LOOKS for an
// existing thread; a new one is created the moment the first message is
// actually sent, not the moment someone taps "Message" and then backs
// out without saying anything).
//
// Deliberately doesn't render the shared navBar() — a chat wants its
// composer pinned where the tab bar would normally sit, and stacking a
// composer ON TOP of the tab bar (rather than replacing it) is exactly
// the cramped, two-fixed-bars-fighting layout that doesn't work on a
// real phone. Same idea as the tour screens (landing-view.js), which
// drop the tab bar for the same reason: this is a focused,
// one-thing-at-a-time screen, not a tab of the main app.
export async function renderMessageThreadView(root, { conversationId, otherUserId }) {
  root.innerHTML = topBar('', { back: true, right: `<button class="icon-btn" id="thread-menu-btn" aria-label="Conversation options">${iconDotsMenu()}</button>` }) +
    `<div class="view-body thread-body" id="thread-body"><div class="spinner" role="status" aria-label="Loading"></div></div>
     <div class="thread-composer" id="thread-composer" hidden>
       <div class="thread-replying" id="thread-replying" hidden></div>
       <form class="thread-composer__row" id="thread-composer-form">
         <button type="button" class="thread-composer__icon" id="thread-attach-btn" aria-label="Share a game, photo, or GIF">${iconPlus()}</button>
         <input type="file" id="thread-media-input" accept="image/*,video/*" class="sr-only-file-input">
         <input type="text" id="thread-input" placeholder="Message…" autocomplete="off" maxlength="2000">
         <button type="submit" class="thread-composer__send" id="thread-send" aria-label="Send">${iconSend()}</button>
       </form>
     </div>`;

  const body = qs('#thread-body', root);
  const composer = qs('#thread-composer', root);
  let convo = null;       // { other, status, requested_by, id } — id is null until a thread actually exists
  let threadId = conversationId || null;
  let messages = [];
  let gamesById = {};     // hydrated game data for kind='game' messages
  let otherPlaying = null; // the other person's currently-playing game (public log)
  let otherLastSeen = null; // their presence timestamp (visible via the conversation policy)
  let reactionsByMessage = {};
  let replyingTo = null;  // a message object, or null
  let unsubscribe = null;
  let unsubscribeReactions = null;
  let refreshTimer = null;

  const teardown = () => {
    unsubscribe?.();
    unsubscribeReactions?.();
    if (refreshTimer) clearInterval(refreshTimer);
  };
  window.addEventListener('hashchange', teardown, { once: true });

  qs('#thread-menu-btn', root).addEventListener('click', openThreadMenu);

  try {
    if (threadId) {
      convo = await api.getConversation(threadId, state.user.id);
      messages = await api.getMessages(threadId);
    } else {
      const existing = await api.getConversationBetween(state.user.id, otherUserId);
      if (existing) {
        // Turns out there's already a thread with this person — land in
        // THAT one (with its real history) instead of pretending to
        // start fresh. history.replaceState so back/refresh point at
        // the real conversation URL from here on, not the draft one.
        convo = existing;
        threadId = existing.id;
        messages = await api.getMessages(threadId);
        history.replaceState(null, '', `#/messages/${threadId}`);
      } else {
        convo = { other: await api.getProfile(otherUserId), status: null, requested_by: null, id: null };
      }
    }
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this conversation: ${esc(err.message)}</p>`;
    return;
  }

  // The other person's currently-playing game (from their public log) —
  // shown in the header as gaming-native "who is this / what are they on"
  // context. Fire-and-forget: the header re-renders once it lands.
  api.getPlayingByUsers([convo.other.id]).then((m) => {
    otherPlaying = m[convo.other.id] || null;
    renderHeader();
  }).catch(() => {});
  api.getPresenceFor([convo.other.id]).then((m) => {
    otherLastSeen = m[convo.other.id] || null;
    renderHeader();
  }).catch(() => {});
  renderHeader();

  // Rendered once — everything after this patches specific slots inside
  // it rather than re-rendering the shell, since the composer sits
  // outside #thread-body and re-wiring its listeners on every repaint
  // would stack a duplicate handler per message sent.
  body.innerHTML = `
    <div id="thread-note-slot"></div>
    <div class="thread-messages" id="thread-messages"></div>`;
  composer.hidden = false;

  qs('#thread-composer-form', root).addEventListener('submit', (e) => { e.preventDefault(); onSend(); });
  qs('#thread-attach-btn', root).addEventListener('click', openShareSheet);
  qs('#thread-media-input', root).addEventListener('change', onPickMedia);
  qs('#thread-replying', root).addEventListener('click', (e) => {
    if (e.target.closest('[data-cancel-reply]')) { replyingTo = null; paintReplyingBar(); }
  });
  // A keyboard sticker (Gboard/Samsung Keyboard etc.) inserts as a pasted
  // image, not text — caught here and sent through the same upload path
  // as the "+" button, rather than needing a dedicated sticker picker of
  // our own to cover the same ground.
  qs('#thread-input', root).addEventListener('paste', onPasteImage);

  updateRequestBanner();
  if (threadId) {
    await loadReactions();
    api.markConversationRead(threadId).catch(() => {});
    startListening();
  }
  paintMessages();
  snapToBottomOnOpen();
  // Game cards (hydrateGames) and images decode AFTER this first paint and
  // add height below the fold, which is what left the thread landing a bit
  // short of the newest message on open — re-snap once they settle.
  hydrateGames().then(snapToBottomOnOpen);

  // Relative times ("2m", "1h") go stale the longer a thread stays
  // open — this keeps them honest without anyone needing to leave and
  // come back. Scroll position is preserved explicitly since a full
  // repaint would otherwise silently snap back to the top.
  refreshTimer = setInterval(() => {
    const before = body.scrollTop;
    paintMessages();
    body.scrollTop = before;
  }, REFRESH_MS);

  function startListening() {
    unsubscribe = api.subscribeToMessages(threadId, {
      onInsert: (msg) => {
        if (messages.some((m) => m.id === msg.id)) return; // our own send, already appended optimistically below
        messages.push(msg);
        paintMessages();
        if (msg.kind === 'game') hydrateGames();
        scrollToBottom(true);
        if (msg.sender_id !== state.user.id) api.markConversationRead(threadId).catch(() => {});
      },
      onDelete: (msg) => {
        messages = messages.filter((m) => m.id !== msg.id);
        delete reactionsByMessage[msg.id];
        paintMessages();
      },
    });
    unsubscribeReactions = api.subscribeToReactions(threadId, () => messages.map((m) => m.id), async () => {
      await loadReactions();
      paintMessages();
    });
  }

  async function loadReactions() {
    if (!messages.length) { reactionsByMessage = {}; return; }
    try { reactionsByMessage = await api.getReactionsForMessages(messages.map((m) => m.id)); }
    catch { /* reactions are a nice-to-have, fine to quietly skip on failure */ }
  }

  function updateRequestBanner() {
    const slot = qs('#thread-note-slot', body);
    if (!slot) return;
    const isPendingForMe = convo.status === 'pending' && convo.requested_by !== state.user.id;
    const isPendingSentByMe = convo.status === 'pending' && convo.requested_by === state.user.id;
    slot.innerHTML = isPendingForMe
      ? `<p class="thread-note">This is a message request. Send a reply to accept it.</p>`
      : isPendingSentByMe
        ? `<p class="thread-note">Request sent — they'll see this once they check their requests.</p>`
        : '';
  }

  // ---- rendering --------------------------------------------------

  // The conversation header lives in the top bar: avatar + name +
  // currently-playing. Re-rendered when the playing context lands.
  function renderHeader() {
    const titleEl = qs('.topbar__title', root);
    if (!titleEl) return;
    const name = convo.other.display_name || convo.other.username;
    const online = otherLastSeen && (Date.now() - new Date(otherLastSeen).getTime()) < 3 * 60 * 1000;
    let pres;
    if (otherPlaying) pres = `<span class="thread-hd__pres thread-hd__pres--online"><span class="thread-hd__dot" style="background:var(--orange)"></span>Playing <b>${esc(otherPlaying.title)}</b></span>`;
    else if (online) pres = `<span class="thread-hd__pres thread-hd__pres--online"><span class="thread-hd__dot"></span>Active now</span>`;
    else if (otherLastSeen) pres = `<span class="thread-hd__pres">Active ${esc(timeAgo(otherLastSeen))} ago</span>`;
    else pres = `<span class="thread-hd__pres">@${esc(convo.other.username)}</span>`;
    titleEl.innerHTML = `
      <a href="#/profile/${esc(convo.other.username)}" class="thread-hd${online || otherPlaying ? ' thread-hd--online' : ''}">
        ${avatarImg(convo.other, 34)}
        <span class="thread-hd__meta">
          <span class="thread-hd__name">${esc(name)}</span>
          ${pres}
        </span>
      </a>`;
  }

  // Fetch the game data for any kind='game' messages so their cards can
  // render, then repaint. Cheap and idempotent — only fetches ids not
  // already hydrated.
  async function hydrateGames() {
    const need = messages
      .filter((m) => m.kind === 'game' || m.kind === 'review')
      .map((m) => parseCard(m).g)
      .filter((g) => g && !gamesById[g]);
    if (!need.length) return;
    try {
      const fetched = await api.getGamesByIds(need);
      gamesById = { ...gamesById, ...fetched };
      paintMessages();
    } catch { /* cards fall back to a plain link line */ }
  }

  // A short label for whatever a message actually is, used anywhere the
  // full content can't be shown as-is (reply quotes, the "replying to"
  // bar) — the alternative is printing a raw storage/GIPHY URL as text.
  function mediaSnippet(m) {
    if (m.kind === 'text') return m.body;
    if (m.kind === 'gif') return 'GIF';
    if (m.kind === 'image') return 'Photo';
    if (m.kind === 'video') return 'Video';
    if (m.kind === 'game') { const g = gamesById[parseCard(m).g]; return g?.title ? `🎮 ${g.title}` : 'Game'; }
    if (m.kind === 'review') return '📝 Review';
    if (m.kind === 'list') return `≣ ${parseCard(m).n || 'List'}`;
    return m.body;
  }

  function bubbleContent(m) {
    if (m.kind === 'gif') return `<img class="msg-gif" src="${esc(m.body)}" alt="GIF" loading="lazy">`;
    if (m.kind === 'image') return `<img class="msg-gif msg-image" src="${esc(m.body)}" alt="" loading="lazy">`;
    if (m.kind === 'video') return `<video class="msg-video" src="${esc(m.body)}" controls playsinline preload="metadata"></video>`;
    if (m.kind === 'sticker') return `<span class="msg-sticker">${esc(m.body)}</span>`; // legacy — no longer sendable, still rendered if one exists
    if (m.kind === 'game') return gameCardHtml(m);
    if (m.kind === 'review') return reviewCardHtml(m);
    if (m.kind === 'list') return listCardHtml(m);
    return esc(m.body);
  }

  // Playthruu card messages (game / review / list) store JSON in the body.
  // The very first game cards stored a bare game id, so fall back to that.
  function parseCard(m) {
    try { const o = JSON.parse(m.body); if (o && typeof o === 'object') return o; } catch { /* not json */ }
    return m.kind === 'game' ? { g: m.body } : {};
  }
  const senderLabel = (m) => (m.sender_id === state.user.id ? 'You' : (convo.other.display_name || convo.other.username));
  function starStr(r) { const n = Math.round(Number(r) || 0); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }

  // The flagship: a shared game as a rich hero card that taps through to
  // the game, carrying the sender's own rating/status when they have one.
  function gameCardHtml(m) {
    const c = parseCard(m);
    const g = gamesById[c.g];
    if (!g) return `<span class="msg-gamecard"><span class="msg-gamecard__cover"></span><span class="msg-gamecard__body"><span class="msg-gamecard__title">Shared a game</span><span class="msg-gamecard__meta">Loading…</span></span></span>`;
    const meta = [g.release_year, g.genre, g.platform].filter(Boolean).join(' · ');
    const tag = c.s === 'playing' ? 'Playing' : c.s === 'played' ? 'Played' : c.s === 'backlog' ? 'Backlog' : 'Game';
    const who = senderLabel(m);
    const rate = c.r
      ? `<span class="msg-gamecard__rate"><span class="msg-stars">${starStr(c.r)}</span> ${esc(who)} rated it ${c.r}</span>`
      : (c.s ? `<span class="msg-gamecard__rate">${esc(who)} · ${esc(tag.toLowerCase())}</span>` : '');
    return `
      <a href="#/game/${esc(g.id)}" class="msg-gamecard">
        <span class="msg-gamecard__cover" style="${g.cover_url ? `background-image:url('${esc(g.cover_url)}')` : ''}">
          <span class="msg-gamecard__tag">${esc(tag)}</span>
        </span>
        <span class="msg-gamecard__body">
          <span class="msg-gamecard__title">${esc(g.title)}</span>
          ${meta ? `<span class="msg-gamecard__meta">${esc(meta)}</span>` : ''}
          ${rate}
          <span class="msg-gamecard__cta">Open game ${iconChevronRight()}</span>
        </span>
      </a>`;
  }

  // A shared review — the sender's rating + their words, over the game.
  function reviewCardHtml(m) {
    const c = parseCard(m);
    const g = gamesById[c.g];
    const cover = g?.cover_url || c.cov || '';
    const title = g?.title || c.ti || 'Game';
    return `
      <a href="#/game/${esc(c.g)}" class="msg-reviewcard">
        <span class="msg-reviewcard__top">
          <span class="msg-reviewcard__cover" style="${cover ? `background-image:url('${esc(cover)}')` : ''}"></span>
          <span class="msg-reviewcard__head">
            <span class="msg-reviewcard__tag">Review · ${esc(senderLabel(m))}</span>
            <span class="msg-reviewcard__title">${esc(title)}</span>
            ${c.r ? `<span class="msg-reviewcard__stars">${starStr(c.r)}</span>` : ''}
          </span>
        </span>
        <span class="msg-reviewcard__text">${esc(c.rev || '')}</span>
      </a>`;
  }

  // A shared list — a poster collage + name + count.
  function listCardHtml(m) {
    const c = parseCard(m);
    const covers = (c.cov || []).slice(0, 4);
    const cells = Array.from({ length: 4 }).map((_, i) => `<span style="${covers[i] ? `background-image:url('${esc(covers[i])}')` : ''}"></span>`).join('');
    return `
      <a href="#/list/${esc(c.id)}" class="msg-listcard">
        <span class="msg-listcard__collage">${cells}</span>
        <span class="msg-listcard__body">
          <span class="msg-listcard__tag">List · ${esc(senderLabel(m))}</span>
          <span class="msg-listcard__name">${esc(c.n || 'List')}</span>
          <span class="msg-listcard__meta">${c.c || 0} game${(c.c || 0) === 1 ? '' : 's'}</span>
        </span>
      </a>`;
  }

  function replyPreviewHtml(m) {
    if (!m.reply_to_id) return '';
    const original = messages.find((x) => x.id === m.reply_to_id);
    if (!original) return '';
    const mine = original.sender_id === state.user.id;
    const who = mine ? 'You' : (convo.other.display_name || convo.other.username);
    return `<div class="msg-reply-preview"><b>${esc(who)}</b><span>${esc(mediaSnippet(original))}</span></div>`;
  }

  function reactionsHtml(m) {
    const rows = reactionsByMessage[m.id] || [];
    if (!rows.length) return '';
    const byEmoji = {};
    rows.forEach((r) => { (byEmoji[r.emoji] ||= []).push(r.user_id); });
    return `<div class="msg-reactions">
      ${Object.entries(byEmoji).map(([emoji, uids]) => `
        <button type="button" class="msg-reaction${uids.includes(state.user.id) ? ' msg-reaction--mine' : ''}" data-react="${esc(emoji)}" data-mid="${esc(m.id)}">
          ${emoji}${uids.length > 1 ? ` ${uids.length}` : ''}
        </button>`).join('')}
    </div>`;
  }

  // A day bucket key, and its human label (Today / Yesterday / date).
  function dayKey(ts) { return new Date(ts).toDateString(); }
  function dayLabel(ts) {
    const d = new Date(ts); const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  }
  // One timestamp per cluster (its last message), with a Seen marker on
  // my own clusters. Returns trusted HTML (time string + a static word).
  function clusterStampHtml(last, mine) {
    const t = new Date(last.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (!mine) return t;
    const otherLastRead = convo.user_one_id === state.user.id ? convo.user_two_last_read_at : convo.user_one_last_read_at;
    const seen = otherLastRead && new Date(otherLastRead) >= new Date(last.created_at);
    return `${t}${seen ? ' · <b>Seen</b>' : ''}`;
  }

  function paintMessages() {
    const el = qs('#thread-messages', body);
    if (!el) return;
    if (!messages.length) {
      el.innerHTML = `<p class="thread-empty">No messages yet — say something.</p>`;
      return;
    }
    // Group consecutive same-sender messages (within 5 min, same day) into
    // one calm cluster with a single timestamp; break the stream by day.
    let html = '';
    let lastDay = null;
    let i = 0;
    while (i < messages.length) {
      const m = messages[i];
      const day = dayKey(m.created_at);
      if (day !== lastDay) { html += `<div class="msg-daysep">${esc(dayLabel(m.created_at))}</div>`; lastDay = day; }
      const mine = m.sender_id === state.user.id;
      const cluster = [m];
      let j = i + 1;
      while (j < messages.length) {
        const n = messages[j];
        if (n.sender_id !== m.sender_id || dayKey(n.created_at) !== day) break;
        if ((new Date(n.created_at) - new Date(messages[j - 1].created_at)) > 5 * 60 * 1000) break;
        cluster.push(n); j++;
      }
      html += `<div class="msg-cluster${mine ? ' msg-cluster--mine' : ''}">`;
      cluster.forEach((cm, k) => {
        const isTail = k === cluster.length - 1;
        const bare = cm.kind !== 'text'; // media/game cards carry their own weight — no bubble chrome
        html += `
          <div class="msg-row${isTail ? ' msg-row--tail' : ''}" data-mid="${esc(cm.id)}">
            ${replyPreviewHtml(cm)}
            <div class="msg-bubble${bare ? ' msg-bubble--bare' : ''}">${bubbleContent(cm)}</div>
            ${reactionsHtml(cm)}
          </div>`;
      });
      html += `<span class="msg-stamp">${clusterStampHtml(cluster[cluster.length - 1], mine)}</span>`;
      html += `</div>`;
      i = j;
    }
    el.innerHTML = html;

    qsa('.msg-reaction', el).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await reactWith(btn.dataset.mid, btn.dataset.react); }
        catch (err) { toast(err.message || 'Could not react to that.', 'error'); }
      });
    });
    qsa('.msg-image', el).forEach((img) => {
      img.addEventListener('click', () => openImageViewer(img.src));
    });
    wireRowGestures(el);
  }

  async function reactWith(messageId, emoji) {
    await api.toggleReaction(messageId, state.user.id, emoji);
    recordRecentEmoji(emoji);
    await loadReactions();
    paintMessages();
  }

  // ---- per-message gestures: double-tap to ❤️, hold to open the full
  // reaction/action sheet. Both read the same pointer sequence, so
  // they're detected together rather than as two separate listeners
  // that would each have to guess what the other decided. ---------

  function wireRowGestures(container) {
    let holdTimer = null;
    let startX = 0, startY = 0, moved = false;
    let lastTapRow = null, lastTapAt = 0;

    qsa('.msg-row', container).forEach((row) => {
      const start = (e) => {
        if (e.target.closest('.msg-reaction, video, a')) return; // let those handle their own taps
        moved = false;
        startX = e.clientX; startY = e.clientY;
        holdTimer = setTimeout(() => {
          holdTimer = null;
          const msg = messages.find((m) => m.id === row.dataset.mid);
          if (msg) openMessageActions(msg);
        }, LONG_PRESS_MS);
      };
      const cancelIfMoved = (e) => {
        if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
          moved = true;
          if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        }
      };
      const end = (e) => {
        const wasHold = !holdTimer;
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (moved || wasHold) return; // a drag, or the hold sheet already opened — not a tap
        const now = Date.now();
        if (lastTapRow === row && now - lastTapAt < DOUBLE_TAP_MS) {
          lastTapRow = null;
          const msg = messages.find((m) => m.id === row.dataset.mid);
          if (msg) doubleTapLike(row, msg);
        } else {
          lastTapRow = row;
          lastTapAt = now;
        }
      };
      row.addEventListener('pointerdown', start);
      row.addEventListener('pointermove', cancelIfMoved);
      row.addEventListener('pointerup', end);
      row.addEventListener('pointercancel', () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } });
    });
  }

  async function doubleTapLike(row, msg) {
    burstHeart(row);
    try { await reactWith(msg.id, HEART_REACTION); }
    catch { /* the burst already played — a failed react here isn't worth a toast over */ }
  }

  function burstHeart(row) {
    const bubble = qs('.msg-bubble', row) || row;
    const heart = document.createElement('span');
    heart.className = 'msg-heart-burst';
    heart.textContent = HEART_REACTION;
    bubble.appendChild(heart);
    heart.addEventListener('animationend', () => heart.remove());
  }

  // ---- long-press sheet: search/top/recent emoji picker + actions ----

  function emojiBtnHtml(e) {
    return `<button type="button" class="emoji-picker__emoji" data-react="${e}">${e}</button>`;
  }

  function paintEmojiSection(overlayEl, query) {
    const el = qs('#emoji-picker-body', overlayEl);
    if (query) {
      const results = searchEmoji(query);
      el.innerHTML = results.length
        ? `<div class="emoji-picker__grid">${results.map(emojiBtnHtml).join('')}</div>`
        : `<p class="muted emoji-picker__empty">No emoji found.</p>`;
    } else {
      const recent = getRecentEmoji();
      el.innerHTML = `
        <p class="emoji-picker__label">Top</p>
        <div class="emoji-picker__row">${TOP_EMOJI.map(emojiBtnHtml).join('')}</div>
        ${recent.length ? `<p class="emoji-picker__label">Recent</p><div class="emoji-picker__row">${recent.map(emojiBtnHtml).join('')}</div>` : ''}
        <p class="emoji-picker__label">All</p>
        <div class="emoji-picker__grid">${EMOJI_LIST.map(([e]) => emojiBtnHtml(e)).join('')}</div>`;
    }
    qsa('[data-react]', el).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const overlay = overlayEl;
        overlay.remove();
        try { await reactWith(overlay.dataset.mid, btn.dataset.react); }
        catch (err) { toast(err.message || 'Could not react to that.', 'error'); }
      });
    });
  }

  function openMessageActions(msg) {
    const mine = msg.sender_id === state.user.id;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.mid = msg.id;
    overlay.innerHTML = `
      <div class="modal modal--sheet">
        <header class="msg-actions__grab" aria-hidden="true"></header>
        <div class="msg-actions">
          <label class="emoji-picker__search">
            ${iconSearch()}
            <input type="text" id="emoji-search-input" placeholder="Search emoji…" autocomplete="off">
          </label>
          <div id="emoji-picker-body"></div>
          <div class="msg-actions__list">
            <button type="button" class="msg-actions__item" id="act-reply">${iconReply()}<span>Reply</span></button>
            ${msg.kind === 'text' ? `<button type="button" class="msg-actions__item" id="act-copy">${iconCopy()}<span>Copy</span></button>` : ''}
            <button type="button" class="msg-actions__item" id="act-info">${iconInfo()}<span>Info</span></button>
            ${mine ? `<button type="button" class="msg-actions__item msg-actions__item--danger" id="act-delete">${iconTrash()}<span>Delete</span></button>` : ''}
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    enableSwipeToDismiss(qs('.modal', overlay), close);

    paintEmojiSection(overlay, '');
    qs('#emoji-search-input', overlay).addEventListener('input', debounce((e) => {
      paintEmojiSection(overlay, e.target.value.trim());
    }, 200));

    qs('#act-reply', overlay).addEventListener('click', () => { close(); replyingTo = msg; paintReplyingBar(); qs('#thread-input', root)?.focus(); });
    qs('#act-copy', overlay)?.addEventListener('click', async () => {
      close();
      try { await navigator.clipboard.writeText(msg.body); toast('Copied.', 'success'); }
      catch { /* clipboard unavailable — nothing to fall back to here */ }
    });
    qs('#act-info', overlay).addEventListener('click', () => { close(); openMessageInfo(msg); });
    qs('#act-delete', overlay)?.addEventListener('click', async () => {
      close();
      if (!confirm('Delete this message?')) return;
      try {
        await api.deleteMessage(msg.id);
        messages = messages.filter((m) => m.id !== msg.id);
        delete reactionsByMessage[msg.id];
        paintMessages();
      } catch (err) {
        toast(err.message || 'Could not delete that.', 'error');
      }
    });
  }

  function openMessageInfo(msg) {
    const mine = msg.sender_id === state.user.id;
    const otherLastRead = convo.user_one_id === state.user.id ? convo.user_two_last_read_at : convo.user_one_last_read_at;
    const seen = mine && otherLastRead && new Date(otherLastRead) >= new Date(msg.created_at);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <header class="modal__header"><h2>Message info</h2><button class="modal__close" data-close aria-label="Close">${iconClose()}</button></header>
        <div class="modal__body">
          <div class="msg-info-row"><span>Sent</span><span>${formatDate(msg.created_at)} · ${new Date(msg.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div>
          ${mine ? `<div class="msg-info-row"><span>Status</span><span>${seen ? 'Seen' : 'Delivered'}</span></div>` : ''}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    qs('[data-close]', overlay).addEventListener('click', close);
    enableSwipeToDismiss(qs('.modal', overlay), close);
  }

  function paintReplyingBar() {
    const bar = qs('#thread-replying', root);
    if (!replyingTo) { bar.hidden = true; bar.innerHTML = ''; return; }
    const mine = replyingTo.sender_id === state.user.id;
    const who = mine ? 'yourself' : (convo.other.display_name || convo.other.username);
    bar.hidden = false;
    bar.innerHTML = `
      <div class="thread-replying__info">
        <span class="thread-replying__label">Replying to ${esc(who)}</span>
        <p class="thread-replying__snippet">${esc(mediaSnippet(replyingTo))}</p>
      </div>
      <button type="button" data-cancel-reply aria-label="Cancel reply">${iconClose()}</button>`;
  }

  // ---- sending ------------------------------------------------------

  async function ensureThread() {
    if (threadId) return;
    convo = await api.getOrCreateConversation(state.user.id, otherUserId);
    threadId = convo.id;
    history.replaceState(null, '', `#/messages/${threadId}`);
    startListening();
  }

  async function sendOne(body, kind) {
    await ensureThread();
    const saved = await api.sendMessage(threadId, state.user.id, body, { kind, replyToId: replyingTo?.id ?? null });
    if (!messages.some((m) => m.id === saved.id)) {
      messages.push(saved);
      if (convo.status === 'pending' && convo.requested_by !== state.user.id) {
        convo.status = 'accepted';
        updateRequestBanner();
      }
      replyingTo = null;
      paintReplyingBar();
      paintMessages();
      scrollToBottom(true);
    }
  }

  async function onSend() {
    const input = qs('#thread-input', root);
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await sendOne(text, 'text');
    } catch (err) {
      toast(err.message || 'Could not send that.', 'error');
      input.value = text;
    }
  }

  async function uploadAndSend(file) {
    if (file.size > MAX_MEDIA_BYTES) {
      toast('That file is too large — keep it under 25MB.', 'error');
      return;
    }
    try {
      await ensureThread(); // the upload's storage path is keyed by conversation id, so the thread has to exist first
      const { url, kind } = await api.uploadMessageMedia(threadId, file);
      await sendOne(url, kind);
    } catch (err) {
      toast(err.message || 'Could not upload that.', 'error');
    }
  }

  async function onPickMedia(e) {
    const input = e.target;
    const file = input.files[0];
    input.value = ''; // lets picking the exact same file twice in a row still fire 'change'
    if (!file) return;
    const btn = qs('#thread-media-btn', root);
    btn.disabled = true;
    try { await uploadAndSend(file); } finally { btn.disabled = false; }
  }

  // Gboard/Samsung Keyboard-style stickers, and any regular copy-pasted
  // image, land in the clipboard as image data rather than text — this
  // is what lets "just paste a sticker from your keyboard" work without
  // a picker of our own duplicating what the keyboard already offers.
  function onPasteImage(e) {
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    if (!item) return; // plain text paste — let the input handle it normally
    e.preventDefault();
    const file = item.getAsFile();
    if (file) uploadAndSend(file);
  }

  function scrollToBottom(smooth) {
    requestAnimationFrame(() => {
      body.scrollTo({ top: body.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  // Reliably land on the newest message when a thread first opens. A single
  // scroll can fall short because content below the fold (game cards from
  // hydrateGames, images still decoding) grows the scroll height after the
  // first paint — so we snap now, next frame, shortly after, and again as
  // each image finishes loading.
  function snapToBottomOnOpen() {
    scrollToBottom(false);
    requestAnimationFrame(() => scrollToBottom(false));
    setTimeout(() => scrollToBottom(false), 140);
    body.querySelectorAll('#thread-messages img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', () => scrollToBottom(false), { once: true });
    });
  }

  // ---- GIF picker -----------------------------------------------------

  function openGifPicker() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal--tall">
        <header class="modal__header"><h2>Send a GIF</h2><button class="modal__close" data-close aria-label="Close">${iconClose()}</button></header>
        <div class="modal__body">
          <label class="field"><span>Search</span><input type="text" id="gif-search" autocomplete="off" placeholder="Search GIPHY…"></label>
          <div class="gif-grid" id="gif-results"><div class="spinner"></div></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    qs('[data-close]', overlay).addEventListener('click', close);
    enableSwipeToDismiss(qs('.modal', overlay), close);

    const results = qs('#gif-results', overlay);
    const paintGifs = (gifs) => {
      results.innerHTML = gifs.length
        ? gifs.map((g, i) => `<button type="button" class="gif-tile" data-idx="${i}"><img src="${esc(g.preview)}" alt="" loading="lazy"></button>`).join('')
        : `<p class="muted">No GIFs found.</p>`;
      qsa('.gif-tile', results).forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await sendOne(gifs[Number(btn.dataset.idx)].full, 'gif');
            close();
          } catch (err) {
            toast(err.message || 'Could not send that GIF.', 'error');
            btn.disabled = false;
          }
        });
      });
    };

    api.getTrendingGifs().then(paintGifs).catch(() => { results.innerHTML = `<p class="muted">Couldn't load GIFs right now.</p>`; });

    const doSearch = debounce(async () => {
      const q = qs('#gif-search', overlay).value.trim();
      results.innerHTML = '<div class="spinner"></div>';
      try { paintGifs(await api.searchGifs(q)); }
      catch { results.innerHTML = `<p class="muted">Couldn't search right now.</p>`; }
    }, 400);
    qs('#gif-search', overlay).addEventListener('input', doSearch);
  }

  // ---- composer "+" → progressive share sheet -------------------------
  // The default composer is one clean input; everything else lives behind
  // the "+". "Share a game" is the flagship, the rest is media/GIF.

  // My own logs, fetched once and reused across the game/review/playing
  // pickers so a shared game can carry my rating/status.
  let myLogsPromise = null;
  const myLogs = () => (myLogsPromise ||= api.getLogsForUser(state.user.id).catch(() => []));

  function openShareSheet() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal--sheet">
        <header class="msg-actions__grab" aria-hidden="true"></header>
        <div class="msg-actions">
          <div class="share-grid">
            <button type="button" class="share-opt share-opt--game" data-act="game"><span class="share-opt__ic">${iconGamepad()}</span>Share a game</button>
            <button type="button" class="share-opt" data-act="review"><span class="share-opt__ic">${iconNote()}</span>Review</button>
            <button type="button" class="share-opt" data-act="list"><span class="share-opt__ic">${iconList()}</span>List</button>
            <button type="button" class="share-opt" data-act="photo"><span class="share-opt__ic">${iconCamera()}</span>Photo</button>
            <button type="button" class="share-opt" data-act="gif"><span class="share-opt__ic">${iconGif()}</span>GIF</button>
            <button type="button" class="share-opt" data-act="playing"><span class="share-opt__ic">${iconStamp()}</span>Playing</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    enableSwipeToDismiss(qs('.modal', overlay), close);
    const on = (act, fn) => qs(`[data-act="${act}"]`, overlay).addEventListener('click', () => { close(); fn(); });
    on('game', openGamePicker);
    on('review', openReviewPicker);
    on('list', openListPicker);
    on('photo', () => qs('#thread-media-input', root).click());
    on('gif', openGifPicker);
    on('playing', sharePlaying);
  }

  // A reusable picker modal shell: header + a body you fill in.
  function pickerModal(title, fill) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal--tall">
        <header class="modal__header"><h2>${esc(title)}</h2><button class="modal__close" data-close aria-label="Close">${iconClose()}</button></header>
        <div class="modal__body" id="picker-body"></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    qs('[data-close]', overlay).addEventListener('click', close);
    enableSwipeToDismiss(qs('.modal', overlay), close);
    fill(qs('#picker-body', overlay), close);
    return overlay;
  }

  async function sendCard(kind, payload, close) {
    close?.();
    try { await sendOne(JSON.stringify(payload), kind); }
    catch (err) { toast(err.message || 'Could not share that.', 'error'); }
  }

  function openGamePicker() {
    pickerModal('Share a game', (body, close) => {
      body.innerHTML = `<label class="field"><span>Search</span><input type="search" id="gp-search" autocomplete="off" placeholder="Search any game…"></label><div id="gp-results"></div>`;
      const input = qs('#gp-search', body);
      const results = qs('#gp-results', body);
      input.focus();
      let token = 0;
      const run = debounce(async () => {
        const q = input.value.trim();
        if (q.length < 2) { results.innerHTML = ''; return; }
        results.innerHTML = '<div class="spinner"></div>';
        const mine = ++token;
        try {
          const { results: games } = await api.searchGamesEverywhere(q, 14);
          if (mine !== token) return;
          if (!games.length) { results.innerHTML = `<p class="muted">Nothing matched that.</p>`; return; }
          results.innerHTML = games.map((g, i) => `
            <button type="button" class="gamepick-row" data-i="${i}">
              ${g.cover_url ? `<img src="${esc(g.cover_url)}" alt="">` : '<span class="gamepick-row__cover"></span>'}
              <span style="min-width:0">
                <span class="gamepick-row__title">${esc(g.title)}</span>
                <span class="gamepick-row__meta">${g.release_year ? esc(g.release_year) : ''}${g._source === 'local' ? ' · in catalog' : ''}</span>
              </span>
            </button>`).join('');
          qsa('.gamepick-row', results).forEach((btn) => btn.addEventListener('click', async () => {
            const game = games[Number(btn.dataset.i)];
            btn.disabled = true;
            try {
              const local = (game._source === 'local' && game.id) ? game : await api.addGame(game, state.user.id);
              gamesById[local.id] = local; // render the card instantly
              const log = (await myLogs()).find((l) => l.game_id === local.id);
              await sendCard('game', { g: local.id, r: log?.rating || null, s: log?.status || null, l: !!log?.loved }, close);
            } catch (err) {
              btn.disabled = false;
              toast(err.message || 'Could not share that game.', 'error');
            }
          }));
        } catch {
          if (mine === token) results.innerHTML = `<p class="muted">Search failed. Try again.</p>`;
        }
      }, 300);
      input.addEventListener('input', run);
    });
  }

  function openReviewPicker() {
    pickerModal('Share a review', async (body, close) => {
      body.innerHTML = '<div class="spinner"></div>';
      const logs = (await myLogs()).filter((l) => l.review && l.games);
      if (!logs.length) { body.innerHTML = `<p class="muted">You haven't written any reviews yet.</p>`; return; }
      body.innerHTML = logs.map((l, i) => `
        <button type="button" class="gamepick-row" data-i="${i}" style="align-items:flex-start">
          ${l.games.cover_url ? `<img src="${esc(l.games.cover_url)}" alt="">` : '<span class="gamepick-row__cover"></span>'}
          <span style="min-width:0">
            <span class="gamepick-row__title">${esc(l.games.title)}</span>
            <span class="gamepick-row__meta">${l.rating ? starStr(l.rating) : ''}</span>
            <span class="gamepick-row__meta" style="color:var(--ink-dim);white-space:normal;margin-top:4px">${esc(l.review.slice(0, 90))}${l.review.length > 90 ? '…' : ''}</span>
          </span>
        </button>`).join('');
      qsa('.gamepick-row', body).forEach((btn) => btn.addEventListener('click', () => {
        const l = logs[Number(btn.dataset.i)];
        gamesById[l.game_id] = l.games;
        sendCard('review', { g: l.game_id, r: l.rating || null, rev: l.review.slice(0, 400), ti: l.games.title, cov: l.games.cover_url || null }, close);
      }));
    });
  }

  function openListPicker() {
    pickerModal('Share a list', async (body, close) => {
      body.innerHTML = '<div class="spinner"></div>';
      let lists = [];
      try { lists = await api.getListsForUser(state.user.id); } catch { /* handled below */ }
      if (!lists.length) { body.innerHTML = `<p class="muted">You don't have any lists yet.</p>`; return; }
      const covers = (l) => (l.list_items || []).slice().sort((a, b) => a.position - b.position).map((it) => it.games?.cover_url).filter(Boolean);
      body.innerHTML = lists.map((l, i) => {
        const cov = covers(l).slice(0, 4);
        const cells = Array.from({ length: 4 }).map((_, k) => `<span style="${cov[k] ? `background-image:url('${esc(cov[k])}')` : ''}"></span>`).join('');
        return `
          <button type="button" class="listpick-row" data-i="${i}">
            <span class="listpick-row__collage">${cells}</span>
            <span style="min-width:0;flex:1">
              <span class="gamepick-row__title">${esc(l.name)}</span>
              <span class="gamepick-row__meta">${(l.list_items || []).length} games</span>
            </span>
          </button>`;
      }).join('');
      qsa('.listpick-row', body).forEach((btn) => btn.addEventListener('click', () => {
        const l = lists[Number(btn.dataset.i)];
        sendCard('list', { id: l.id, n: l.name, c: (l.list_items || []).length, cov: covers(l).slice(0, 4) }, close);
      }));
    });
  }

  async function sharePlaying() {
    try {
      const playing = (await api.getPlayingByUsers([state.user.id]))[state.user.id];
      if (!playing) { toast("You're not marked as playing anything right now.", 'info'); return; }
      gamesById[playing.id] = playing;
      const log = (await myLogs()).find((l) => l.game_id === playing.id);
      await sendCard('game', { g: playing.id, s: 'playing', r: log?.rating || null, l: !!log?.loved });
    } catch (err) {
      toast(err.message || 'Could not share that.', 'error');
    }
  }

  // ---- full-screen image viewer ---------------------------------------
  // Pinch with two fingers to zoom and pan at once; lift any finger and
  // it snaps back to normal — a "hold to inspect" gesture rather than
  // "pinch and stay zoomed," which is what was actually asked for here.
  // One-finger vertical drag (only while at normal size) fades the
  // backdrop and slides the image toward wherever it's dragged; letting
  // go past the threshold dismisses, otherwise it springs back.

  function openImageViewer(src) {
    const overlay = document.createElement('div');
    overlay.className = 'image-viewer';
    overlay.innerHTML = `
      <button type="button" class="image-viewer__close" aria-label="Close">${iconClose()}</button>
      <div class="image-viewer__stage">
        <img class="image-viewer__img" src="${esc(src)}" alt="">
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const img = qs('.image-viewer__img', overlay);
    const stage = qs('.image-viewer__stage', overlay);

    const close = () => { overlay.remove(); document.body.style.overflow = ''; };
    qs('.image-viewer__close', overlay).addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target === stage) close(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });

    const pointers = new Map();
    let scale = 1, tx = 0, ty = 0;
    let pinchStartDist = 0, pinchStartScale = 1, pinchStartMid = null, pinchStartT = null;
    let dragStartX = 0, dragStartY = 0, verticalDrag = false;

    const setTransform = (animated) => {
      img.style.transition = animated ? 'transform 0.25s cubic-bezier(0.2,0.8,0.2,1)' : 'none';
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const snapBack = () => { scale = 1; tx = 0; ty = 0; setTransform(true); overlay.style.background = ''; };

    stage.addEventListener('pointerdown', (e) => {
      try { stage.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStartDist = dist(a, b);
        pinchStartScale = scale;
        pinchStartMid = mid(a, b);
        pinchStartT = { tx, ty };
        verticalDrag = false;
      } else if (pointers.size === 1 && scale === 1) {
        dragStartX = e.clientX; dragStartY = e.clientY;
        verticalDrag = false;
      }
    });

    stage.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        scale = Math.max(1, Math.min(4, pinchStartScale * (dist(a, b) / Math.max(1, pinchStartDist))));
        const m = mid(a, b);
        tx = pinchStartT.tx + (m.x - pinchStartMid.x);
        ty = pinchStartT.ty + (m.y - pinchStartMid.y);
        setTransform(false);
      } else if (pointers.size === 1 && scale === 1) {
        const dy = e.clientY - dragStartY;
        const dx = e.clientX - dragStartX;
        if (!verticalDrag && Math.hypot(dx, dy) > 8 && Math.abs(dy) > Math.abs(dx)) verticalDrag = true;
        if (verticalDrag) {
          ty = dy; tx = dx * 0.4;
          overlay.style.background = `rgba(0,0,0,${Math.max(0.35, 1 - Math.abs(dy) / 400)})`;
          setTransform(false);
        }
      }
    });

    const endGesture = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        if (verticalDrag && Math.abs(ty) > 120) {
          img.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
          img.style.transform = `translate(${tx}px, ${ty > 0 ? 700 : -700}px)`;
          img.style.opacity = '0';
          setTimeout(close, 180);
          return;
        }
        verticalDrag = false;
        snapBack();
      } else {
        // Lifting one finger out of a pinch resets to normal, per spec —
        // not "stays zoomed until you pinch back out."
        snapBack();
      }
    };
    stage.addEventListener('pointerup', endGesture);
    stage.addEventListener('pointercancel', endGesture);
  }

  // ---- "⋯" menu: delete conversation, view profile -----------------

  function openThreadMenu() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal--sheet">
        <header class="msg-actions__grab" aria-hidden="true"></header>
        <div class="msg-actions__list">
          <button type="button" class="msg-actions__item" id="menu-profile"><span>View profile</span></button>
          ${threadId ? `<button type="button" class="msg-actions__item msg-actions__item--danger" id="menu-delete"><span>Delete conversation</span></button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    enableSwipeToDismiss(qs('.modal', overlay), close);

    qs('#menu-profile', overlay).addEventListener('click', () => { close(); navigate(`/profile/${convo.other.username}`); });
    qs('#menu-delete', overlay)?.addEventListener('click', async () => {
      close();
      if (!confirm('Delete this conversation? This removes it for both of you.')) return;
      try {
        await api.deleteConversation(threadId);
        teardown();
        navigate('/messages');
      } catch (err) {
        toast(err.message || 'Could not delete that.', 'error');
      }
    });
  }
}
