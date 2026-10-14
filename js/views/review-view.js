import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, avatarImg, posterFrame, spinner, iconHeart, iconSend, iconFlag, iconBlock, iconDotsMenu, iconClose, openReportSheet } from '../components.js';
import { openEntryMenu } from './entry-menu.js';
import { navigate, refreshCurrentView } from '../router.js';
import { esc, starRow, formatDate, timeAgo, qs, qsa, toast, tapFeedback, promptSignIn, reviewText, enableSwipeToDismiss } from '../utils.js';

// Likes on the comments of the review being shown: { commentId: { count, liked } }.
let commentLikes = {};
// The review's author, so a comment they liked can carry their little badge.
let commentAuthor = null;

// One person's review, on its own page — opened by tapping a poster in
// the feed's "Friend's recent activity". It is a thread, not an entry in
// a list: the review sits at the top as the thing being discussed, the
// comments run underneath it, and the box you type into is pinned to the
// bottom of the screen the whole time.
//
// Deliberately no navBar(), the same call message-thread-view makes and
// for the same reason: a composer belongs where the tab bar would sit,
// and stacking one ON TOP of the tab bar leaves two bars competing for
// the bottom of the screen and the thumb that reaches it.

export async function renderReviewView(root, { id }) {
  root.innerHTML = topBar('Review', { back: true }) +
    `<div class="view-body view-body--review" id="review-body">${spinner()}</div>`;
  const body = qs('#review-body', root);

  try {
    const log = await api.getLogById(id);
    const ownerId = log.user_id;
    const [likeInfo, comments] = await Promise.all([
      api.getLikeInfo(id, state.user?.id).catch(() => ({ count: 0, liked: false })),
      api.getComments(id, { ownerId }).catch(() => []),
    ]);
    commentLikes = await api.getCommentLikes(comments.map((c) => c.id), state.user?.id, ownerId).catch(() => ({}));
    commentAuthor = log.profiles || null;

    // Who is allowed to write here: off, everyone, or only people the author follows /
    // the author's followers. The owner can always comment (unless comments are off).
    let commentNote = null;
    const authorName = log.profiles?.display_name || log.profiles?.username || 'the author';
    if (log.comments_disabled) {
      commentNote = 'Comments are turned off.';
    } else if (state.user && ownerId !== state.user.id && log.comments_who && log.comments_who !== 'everyone') {
      const [ownerFollowsMe, iFollowOwner] = await Promise.all([
        api.isFollowing(ownerId, state.user.id).catch(() => false),
        api.isFollowing(state.user.id, ownerId).catch(() => false),
      ]);
      const ok = log.comments_who === 'following' ? ownerFollowsMe
        : log.comments_who === 'followers' ? iFollowOwner
        : (ownerFollowsMe || iFollowOwner);
      if (!ok) {
        commentNote = log.comments_who === 'following' ? `Only people ${authorName} follows can comment.`
          : log.comments_who === 'followers' ? `Only ${authorName}\u2019s followers can comment.`
          : `Only people ${authorName} follows and ${authorName}\u2019s followers can comment.`;
      }
    }
    const g = log.games || {};
    const a = log.profiles || {};
    const who = a.display_name || a.username || 'Someone';
    // "Aditya's review", not "Aditya review" — and not "Aditya's's"
    // either, for the names that already end in one.
    const possessive = /s$/i.test(who) ? `${who}’` : `${who}’s`;
    const isOwner = !!state.user && state.user.id === ownerId;

    // Your own review says so at the top, and carries the three dots: Edit,
    // Share to Instagram Stories, Share and Delete.
    const bar = qs('.topbar', root);
    if (isOwner && bar) qs('.topbar__title', bar).textContent = 'Your review';
    if (bar) {
      qs('.topbar__right', bar).innerHTML = `<button type="button" class="icon-btn" id="rv-menu-btn" aria-label="Review options">${iconDotsMenu()}</button>`;
      qs('#rv-menu-btn', bar).addEventListener('click', () => openEntryMenu(log, isOwner, { onChanged: () => refreshCurrentView() }));
    }

    body.innerHTML = `
      <article class="rv">
        <div class="rv__head">
          <a href="#/game/${g.id}" class="rv__cover-link" aria-label="${esc(g.title || 'Game')}">
            ${posterFrame(g.cover_url, g.title, 'rv__cover')}
          </a>
          <div class="rv__meta">
            ${log.review ? `<a href="#/profile/${esc(a.username)}" class="rv__whose">${avatarImg(a, 32)}<span>${isOwner ? 'Your review' : `${esc(possessive)} review`}</span></a>` : ''}
            <a href="#/game/${g.id}" class="rv__game">
              <h1 class="rv__title">${esc(g.title || 'Untitled')}</h1>
              ${g.release_year ? `<span class="rv__year">${esc(String(g.release_year))}</span>` : ''}
            </a>
            ${log.rating || log.loved ? `<div class="rv__stars">${log.rating ? starRow(log.rating, { size: 18 }) : ''}${log.loved ? `<span class="rv__loved" aria-label="Liked">${iconHeart()}</span>` : ''}</div>` : ''}
            ${(log.played_date || log.created_at) ? `<p class="rv__played">${log.is_replay ? 'Replayed' : 'Played'} on ${formatDate(log.played_date || String(log.created_at).slice(0, 10))}</p>` : ''}
          </div>
        </div>

        ${reviewBodyHtml(log)}

        ${log.review ? `<button type="button" class="rv__like${likeInfo.liked ? ' rv__like--on' : ''}" id="review-like"
                aria-pressed="${likeInfo.liked}" aria-label="${likeInfo.liked ? 'Unlike' : 'Like'} this review">
          ${iconHeart()}<span id="review-like-count">${likeLabel(likeInfo.count)}</span>
        </button>` : ''}
      </article>

      ${log.comments_disabled && !visibleCount(comments) ? '' : `<section class="rv-comments">
        <h2 class="rv-comments__head">Comments <span id="comment-count">${countLabel(visibleCount(comments))}</span></h2>
        <div class="comment-list" id="comment-list">
          ${comments.length
            ? comments.map((c) => commentHtml(c, ownerId)).join('')
            : '<p class="rv-comments__empty">No comments yet. Be the first.</p>'}
        </div>
      </section>`}`;

    root.insertAdjacentHTML('beforeend', composerHtml(commentNote));

    // The spoiler card is replaced by the writing, rather than the
    // writing being un-blurred underneath it.
    // A review that does contain spoilers is covered. Tapping the cover brings the words
    // in one by one; "Hide the words" under the review covers it again.
    const gate = qs('#spoiler-gate', body);
    const card = qs('#spoiler-card', body);
    if (gate && card) {
      wrapWords(qs('.rv__text', card));
      const hide = qs('#spoiler-hide', body);
      gate.addEventListener('click', () => {
        card.classList.add('is-revealed');
        hide.classList.add('is-shown');
      });
      hide.addEventListener('click', () => {
        card.classList.remove('is-revealed');
        hide.classList.remove('is-shown');
      });
    }

    wireLike(qs('#review-like', body), id, likeInfo, qs('.rv', body));
    wireCommentActions(root, body, { logId: id, ownerId, isOwner, commentsOff: !!commentNote });
    wireComposer(root, body, { logId: id, ownerId });
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this review: ${esc(err.message)}</p>`;
  }
}

// The write-up. A review marked for spoilers is not shown blurred — a
// blur is a picture of hidden text, it still takes the full height of
// whatever is behind it, and every review ends up a different size. A
// card of ONE fixed height says the same thing in the same space every
// time, and the writing replaces it when you tap.
// Wrap every word of the (already escaped and formatted) review in a span, keeping
// the bold / italic / link markup around them, so the words can arrive one by one.
function wrapWords(root) {
  if (!root) return;
  let i = 0;
  const walk = (node) => {
    Array.from(node.childNodes).forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          const w = document.createElement('span');
          w.className = 'rv__w';
          w.style.setProperty('--i', String(i++));
          w.textContent = part;
          frag.appendChild(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') {
        walk(n);
      }
    });
  };
  walk(root);
}

function reviewBodyHtml(log) {
  if (!log.review) return '';
  const text = `<p class="rv__text">${reviewText(log.review)}</p>`;
  if (!log.contains_spoilers) return `<div class="rv__quote">${text}</div>`;
  return `
    <div class="rv__quote rv__quote--gated" id="spoiler-card">
      ${text}
      <button type="button" class="rv__spoiler" id="spoiler-gate">
        <span class="rv__spoiler-title">Every word here is a spoiler</span>
        <span class="rv__spoiler-hint">Tap to read</span>
      </button>
    </div>
    <button type="button" class="rv__hide" id="spoiler-hide">Hide the words</button>`;
}

const likeLabel = (n) => (n ? `${n} ${n === 1 ? 'like' : 'likes'}` : 'No likes yet');
const visibleCount = (comments) => comments.filter((c) => !c.deleted_at).length;
// No "(0)" — a zero in brackets is a count of nothing dressed up as
// information.
const countLabel = (n) => (n ? `(${n})` : '');

// Pinned to the bottom for the whole visit, which is the point: the
// reply box should never be something you have to scroll to find.
function composerHtml(note) {
  if (note) {
    return `<div class="rv-composer"><p class="rv-composer__off">${esc(note)}</p></div>`;
  }
  if (!state.user) {
    return `
      <div class="rv-composer">
        <button type="button" class="rv-composer__signin" id="comment-signin">Sign in to comment</button>
      </div>`;
  }
  return `
    <div class="rv-composer">
      <form class="rv-composer__row" id="comment-form">
        ${avatarImg(state.profile, 34)}
        <div class="rv-composer__field">
          <input type="text" id="comment-input" maxlength="1000" placeholder="Add a comment…" autocomplete="off" enterkeyhint="send">
          <button type="submit" class="rv-composer__send" id="comment-send" aria-label="Post comment">Post</button>
        </div>
      </form>
    </div>`;
}

function wireComposer(root, body, { logId, ownerId }) {
  qs('#comment-signin', root)?.addEventListener('click', () => promptSignIn('Sign in to join the conversation.'));

  const form = qs('#comment-form', root);
  if (!form) return;
  const input = qs('#comment-input', root);
  const send = qs('#comment-send', root);

  const sync = () => send.classList.toggle('is-ready', !!input.value.trim());
  input.addEventListener('input', sync);
  sync();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    try {
      const saved = await api.addComment(logId, state.user.id, text);
      saved.profiles = saved.profiles || state.profile;
      const list = qs('#comment-list', body);
      const empty = qs('.rv-comments__empty', list);
      if (empty) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', commentHtml(saved, ownerId));
      input.value = '';
      sync();
      bumpCommentCount(body, +1);
      // Put the comment that was just written where it can be seen — it
      // lands at the bottom of a list the composer is covering the end of.
      list.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      toast(err.message || 'Could not post that comment. Try again in a moment.', 'error');
    } finally {
      send.disabled = false;
    }
  });
}

// "5 min ago", "2 hours ago", "3 days ago" — written out, not "5m".
function agoText(dateStr) {
  const secs = Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 1000);
  if (!Number.isFinite(secs) || secs < 60) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['min', 60]];
  for (const [name, size] of units) {
    const v = Math.floor(secs / size);
    if (v >= 1) return `${v} ${name}${v > 1 && name !== 'min' ? 's' : ''} ago`;
  }
  return 'just now';
}

// A deleted comment keeps its place and says what happened to it.
function commentHtml(c, ownerId) {
  const p = c.profiles || {};
  if (c.deleted_at) {
    return `
      <div class="comment comment--gone" data-id="${esc(c.id)}">
        <span class="comment__avatar comment__avatar--gone" aria-hidden="true"></span>
        <p class="comment__deleted">The author deleted this comment.</p>
      </div>`;
  }
  const cl = commentLikes[c.id] || { count: 0, liked: false };
  // A small badge when the review's author has liked this comment.
  const byAuthor = cl.byAuthor && commentAuthor
    ? `<span class="comment__byauthor" title="Liked by the author">${avatarImg(commentAuthor, 18)}<i>${iconHeart()}</i></span>` : '';
  return `
    <div class="comment${c.pinned_at ? ' comment--pinned' : ''}" data-id="${esc(c.id)}" data-user="${esc(c.user_id)}" data-name="${esc(p.username || '')}">
      <a href="#/profile/${esc(p.username)}" class="comment__avatar">${avatarImg(p, 40)}</a>
      <div class="comment__body">
        ${c.pinned_at ? '<span class="comment__pin">Pinned</span>' : ''}
        <div class="comment__head">
          <a href="#/profile/${esc(p.username)}" class="comment__name">${esc(p.display_name || p.username)}</a>
          <span class="comment__time">${agoText(c.created_at)}</span>
          ${byAuthor}
          ${c.restricted_at ? '<span class="comment__restricted">Only you and the author can see this</span>' : ''}
        </div>
        <p class="comment__text">${linkMentions(c.body)}</p>
        <div class="comment__acts"><button type="button" class="comment__replybtn" data-reply="${esc(p.username || '')}">Reply</button></div>
      </div>
      <button type="button" class="comment__like${cl.liked ? ' is-on' : ''}" data-like="${esc(c.id)}" aria-label="Like comment" aria-pressed="${cl.liked}">${iconHeart()}<span class="comment__like-n">${cl.count || ''}</span></button>
    </div>`;
}

// "@someone" becomes a link to that profile. Escaped FIRST and only then
// scanned, so the pattern can never match anything a person typed as
// markup — the handle characters are deliberately the same narrow set
// usernames are restricted to at sign-up.
function linkMentions(bodyText) {
  return esc(bodyText).replace(/@([A-Za-z0-9._]{1,20})/g,
    (m, handle) => `<a href="#/profile/${handle}" class="comment__mention">@${handle}</a>`);
}

// Press and hold a comment for everything you can do to it. A long
// press rather than a visible row of icons: there are six actions here,
// most of them rare, and six icons on every row would bury the reading.
function wireCommentActions(root, body, { logId, ownerId, isOwner, commentsOff = false }) {
  const list = qs('#comment-list', body);
  if (!list) return;

  // Liking is the one action common enough to earn its own target.
  list.addEventListener('click', async (e) => {
    const likeBtn = e.target.closest('[data-like]');
    if (!likeBtn) return;
    if (!state.user) { promptSignIn('Sign in to like comments.'); return; }
    if (likeBtn.disabled) return;
    const cid = likeBtn.dataset.like;
    const was = likeBtn.getAttribute('aria-pressed') === 'true';
    const cur = commentLikes[cid] || { count: 0, liked: false };
    const paint = (liked, count) => {
      likeBtn.setAttribute('aria-pressed', String(liked));
      likeBtn.classList.toggle('is-on', liked);
      qs('.comment__like-n', likeBtn).textContent = count || '';
    };
    // Show it at once; put it back if the save fails.
    const next = { liked: !was, count: Math.max(0, cur.count + (was ? -1 : 1)) };
    commentLikes[cid] = next;
    paint(next.liked, next.count);
    if (next.liked) tapFeedback();
    likeBtn.disabled = true;
    try {
      await api.toggleCommentLike(state.user.id, cid, was);
    } catch (err) {
      commentLikes[cid] = cur;
      paint(cur.liked, cur.count);
      toast('Could not save that like.', 'error');
    } finally {
      likeBtn.disabled = false;
    }
  });

  list.addEventListener('click', (e) => {
    const rb = e.target.closest('[data-reply]');
    if (!rb) return;
    const input = qs('#comment-input');
    if (!input) { promptSignIn('Sign in to reply.'); return; }
    input.value = `@${rb.dataset.reply} `;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  let timer = null;
  let moved = false;
  let opened = false;
  let startX = 0;
  let startY = 0;

  const start = (e) => {
    const row = e.target.closest('.comment');
    if (!row || row.classList.contains('comment--gone')) return;
    if (e.target.closest('a, button')) return; // let links and the like button do their own thing
    moved = false;
    startX = e.clientX; startY = e.clientY;
    timer = setTimeout(() => {
      if (moved) return;
      tapFeedback();
      opened = true;
      openCommentSheet(row, { logId, ownerId, isOwner, body, commentsOff });
    }, 380);
  };
  const cancel = () => { clearTimeout(timer); timer = null; };

  list.addEventListener('pointerdown', start);
  // A finger always wobbles a little while it holds; only a real drag (a scroll) cancels it.
  list.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12) { moved = true; cancel(); }
  });
  list.addEventListener('pointerup', cancel);
  list.addEventListener('pointercancel', cancel);
  // Right-click is the same intent with a mouse.
  list.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.comment');
    if (!row || row.classList.contains('comment--gone')) return;
    e.preventDefault();
    if (opened) { opened = false; return; }
    cancel();
    openCommentSheet(row, { logId, ownerId, isOwner, body, commentsOff });
  });
}

const CS_ICONS = {
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7 4 12l5 5"/><path d="M4 12h9a7 7 0 0 1 7 7"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3l7 7-3 1-3 3 .5 4.5-1.5 1.5-4-4-5 5"/><path d="M8.5 8.5 14 3"/></svg>',
  restrict: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg>',
  delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-3.4 3.4-5 7-5"/><circle cx="18" cy="17" r="3.5"/><path d="M15.5 19.5l5-5"/></svg>',
};

function openCommentSheet(row, { logId, ownerId, isOwner, body, commentsOff = false }) {
  const commentId = row.dataset.id;
  const authorId = row.dataset.user;
  const handle = row.dataset.name;
  const mine = state.user && state.user.id === authorId;
  const pinned = row.classList.contains('comment--pinned');
  const restricted = !!qs('.comment__restricted', row);

  const actions = [];
  // With comments off there is no box to reply in; delete, pin, report and block still work.
  if (!commentsOff) actions.push({ id: 'reply', label: `Reply to @${handle}` });
  if (isOwner) actions.push({ id: 'pin', label: pinned ? 'Unpin comment' : 'Pin to top' });
  if (isOwner && !mine) actions.push({ id: 'restrict', label: restricted ? 'Un-restrict' : 'Restrict this comment' });
  if (mine || isOwner) actions.push({ id: 'delete', label: 'Delete', danger: true });
  if (!mine) {
    actions.push({ id: 'report', label: 'Report', icon: iconFlag() });
    actions.push({ id: 'block', label: `Block @${handle}`, icon: iconBlock(), danger: true });
  }

  // A pop-up floating over the dimmed page: the comment you held lifted up on its own,
  // and a separate menu floating under it. Tapping outside closes it.
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay cs-float';
  const who = qs('.comment__name', row)?.textContent || `@${handle}`;
  const when = qs('.comment__time', row)?.textContent || '';
  const said = qs('.comment__text', row)?.textContent || '';
  const avHtml = qs('.comment__avatar', row)?.innerHTML || '';
  overlay.innerHTML = `
    <div class="cs-lift">
      <span class="cs-lift__av">${avHtml}</span>
      <div class="cs-lift__main"><div class="cs-lift__head"><b>${esc(who)}</b><span>${esc(when)}</span></div><p>${esc(said)}</p></div>
    </div>
    <div class="cs-menu">
      ${actions.map((x) => `
        <button type="button" class="cs-row${x.danger ? ' cs-row--danger' : ''}" data-act="${x.id}">
          <span>${esc(x.label)}</span><i>${CS_ICONS[x.id] || ''}</i>
        </button>`).join('')}
    </div>`;
  document.body.appendChild(overlay);
  // Goes back the way it came: the pop-up fades and settles down, then is removed.
  let leaving = false;
  const close = () => {
    if (leaving) return;
    leaving = true;
    overlay.classList.add('is-out');
    setTimeout(() => overlay.remove(), 190);
  };
  overlay.__dismiss = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  qsa('[data-act]', overlay).forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    // Report opens another screen: open it first, then take this one down.
    if (act !== 'report') close();
    try {
      if (act === 'cancel') return;
      if (act === 'reply') {
        const input = qs('#comment-input');
        if (!input) { promptSignIn('Sign in to reply.'); return; }
        input.value = `@${handle} `;
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (act === 'pin') {
        await api.pinComment(commentId, logId, !pinned);
        toast(pinned ? 'Unpinned.' : 'Pinned to the top.', 'success');
        row.classList.toggle('comment--pinned', !pinned);
        if (!pinned) row.parentElement.prepend(row);
        return;
      }
      if (act === 'restrict') {
        await api.restrictComment(commentId, !restricted);
        toast(restricted ? 'No longer restricted.' : 'Restricted — only you and the author can see it.', 'success');
        return;
      }
      if (act === 'delete') {
        await api.deleteComment(commentId);
        row.outerHTML = commentHtml({ id: commentId, deleted_at: new Date().toISOString() }, ownerId);
        bumpCommentCount(body, -1);
        return;
      }
      if (act === 'block') {
        await api.blockUser(authorId);
        toast(`Blocked @${handle}.`, 'success');
        row.remove();
        bumpCommentCount(body, -1);
        return;
      }
      if (act === 'report') {
        openReportSheet({ targetType: 'comment', targetId: commentId, subject: qs('.comment__text', row)?.textContent || '' });
        close();
      }
    } catch (err) {
      toast(err.message || 'That did not work.', 'error');
    }
  }));
}

// Press and hold the likes line to see who liked the review.
function openLikersSheet(logId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="sheet likers-sheet">
      <div class="sheet__grip" aria-hidden="true"></div>
      <h3 class="likers-sheet__title">Liked by</h3>
      <div class="likers-sheet__list" id="likers-list">${spinner()}</div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.__dismiss = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  enableSwipeToDismiss(qs('.sheet', overlay), close);
  // Going to a profile: navigate while the sheet still has its history entry (it
  // becomes the profile's entry), then take the sheet down. Closing it first
  // made the app step back and land on the review again.
  overlay.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#/"]');
    if (!link) return;
    e.preventDefault();
    navigate(link.getAttribute('href').slice(1));
    overlay.remove();
  });
  const meId = state.user?.id || null;
  Promise.all([api.getLogLikers(logId), api.getFollowingIdSet(meId).catch(() => new Set())]).then(([people, followingSet]) => {
    const list = qs('#likers-list', overlay);
    if (!people.length) { list.innerHTML = '<p class="likers-sheet__empty">No likes yet.</p>'; return; }
    list.innerHTML = people.map((p) => `
      <div class="lkr">
        <a href="#/profile/${esc(p.username)}" class="lkr__link">
          ${avatarImg(p, 42)}
          <span class="lkr__names"><b>${esc(p.display_name || p.username)}</b><span>@${esc(p.username)}</span></span>
        </a>
        ${meId && p.id !== meId
          ? `<button type="button" class="lkr__btn${followingSet.has(p.id) ? ' is-on' : ''}" data-follow="${esc(p.id)}" data-on="${followingSet.has(p.id)}">${followingSet.has(p.id) ? 'Following' : 'Follow'}</button>`
          : ''}
      </div>`).join('');
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-follow]');
      if (!btn || btn.disabled) return;
      const was = btn.dataset.on === 'true';
      btn.disabled = true;
      try {
        if (was) await api.unfollow(meId, btn.dataset.follow); else await api.follow(meId, btn.dataset.follow);
        btn.dataset.on = String(!was);
        btn.classList.toggle('is-on', !was);
        btn.textContent = was ? 'Follow' : 'Following';
        if (!was) tapFeedback();
      } catch (err) {
        toast(err.message || 'Could not do that.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }).catch(() => {
    qs('#likers-list', overlay).innerHTML = '<p class="likers-sheet__empty">Could not load the likes.</p>';
  });
}

function wireLike(btn, logId, likeInfo, article) {
  if (!btn) return;
  let liked = likeInfo.liked;
  let count = likeInfo.count;
  let held = false;
  let holdTimer = null;
  let chain = Promise.resolve();
  const paint = () => {
    btn.classList.toggle('rv__like--on', liked);
    btn.setAttribute('aria-pressed', String(liked));
    qs('#review-like-count', btn).textContent = likeLabel(count);
  };
  // The heart answers at once; the save follows it and is undone only if it fails.
  const setLiked = (next) => {
    if (!state.user) { promptSignIn('Sign in to like this review.'); return; }
    if (next === liked) return;
    const was = liked;
    liked = next;
    count = Math.max(0, count + (next ? 1 : -1));
    paint();
    if (next) tapFeedback();
    chain = chain.then(() => api.toggleLike(state.user.id, logId, was)).catch((err) => {
      liked = was;
      count = Math.max(0, count + (was ? 1 : -1));
      paint();
      toast(err.message || 'Could not update like.', 'error');
    });
  };

  const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
  btn.addEventListener('pointerdown', () => {
    held = false;
    cancelHold();
    holdTimer = setTimeout(() => { held = true; tapFeedback(); openLikersSheet(logId); }, 420);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => btn.addEventListener(t, cancelHold));
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!held) { held = true; openLikersSheet(logId); } });
  btn.addEventListener('click', (e) => {
    // The press that opened the list is not also a like.
    if (held) { held = false; e.preventDefault(); return; }
    setLiked(!liked);
  });

  // Double-tap the review to like it (it only ever likes, never un-likes).
  if (article) {
    let lastTap = 0;
    let lastX = 0;
    let lastY = 0;
    article.addEventListener('pointerup', (e) => {
      if (e.target.closest('a, button, input')) return;
      const now = Date.now();
      if (now - lastTap < 320 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 40) {
        lastTap = 0;
        setLiked(true);
      } else {
        lastTap = now; lastX = e.clientX; lastY = e.clientY;
      }
    });
  }
}

function bumpCommentCount(scope, delta) {
  const el = qs('#comment-count', scope || document);
  if (!el) return;
  const cur = parseInt((el.textContent || '').replace(/\D/g, ''), 10) || 0;
  el.textContent = countLabel(Math.max(0, cur + delta));
}
