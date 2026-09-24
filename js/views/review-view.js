import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, avatarImg, posterFrame, spinner, iconHeart, iconSend, iconFlag, iconBlock, openReportSheet } from '../components.js';
import { esc, starRow, formatDate, timeAgo, qs, qsa, toast, tapFeedback, promptSignIn } from '../utils.js';

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
    const g = log.games || {};
    const a = log.profiles || {};
    const who = a.display_name || a.username || 'Someone';
    // "Aditya's review", not "Aditya review" — and not "Aditya's's"
    // either, for the names that already end in one.
    const possessive = /s$/i.test(who) ? `${who}’` : `${who}’s`;
    const isOwner = !!state.user && state.user.id === ownerId;

    body.innerHTML = `
      <article class="rv">
        <div class="rv__head">
          <a href="#/game/${g.id}" class="rv__cover-link" aria-label="${esc(g.title || 'Game')}">
            ${posterFrame(g.cover_url, g.title, 'rv__cover')}
          </a>
          <div class="rv__meta">
            <a href="#/profile/${esc(a.username)}" class="rv__by">
              ${avatarImg(a, 28)}<span class="rv__by-name">${esc(possessive)} review</span>
            </a>
            <a href="#/game/${g.id}" class="rv__game">
              <h1 class="rv__title">${esc(g.title || 'Untitled')}</h1>
              ${g.release_year ? `<span class="rv__year">${esc(String(g.release_year))}</span>` : ''}
            </a>
            ${log.rating ? `<div class="rv__stars">${starRow(log.rating, { size: 18 })}</div>` : ''}
            ${log.played_date ? `<p class="rv__played">Played on ${formatDate(log.played_date)}</p>` : ''}
          </div>
        </div>

        ${reviewBodyHtml(log)}

        <button type="button" class="rv__like${likeInfo.liked ? ' rv__like--on' : ''}" id="review-like"
                aria-pressed="${likeInfo.liked}" aria-label="${likeInfo.liked ? 'Unlike' : 'Like'} this review">
          ${iconHeart()}<span id="review-like-count">${likeInfo.count || ''}</span>
        </button>
      </article>

      <section class="rv-comments">
        <h2 class="rv-comments__head">Comments <span id="comment-count">${countLabel(visibleCount(comments))}</span></h2>
        <div class="comment-list" id="comment-list">
          ${comments.length
            ? comments.map((c) => commentHtml(c, ownerId)).join('')
            : '<p class="rv-comments__empty">No comments yet. Be the first.</p>'}
        </div>
      </section>`;

    root.insertAdjacentHTML('beforeend', composerHtml());

    // The spoiler card is replaced by the writing, rather than the
    // writing being un-blurred underneath it.
    const gate = qs('#spoiler-gate', body);
    if (gate) {
      gate.addEventListener('click', () => {
        const holder = gate.closest('.rv__quote');
        holder.classList.add('is-revealed');
        gate.remove();
      }, { once: true });
    }

    wireLike(qs('#review-like', body), id, likeInfo);
    wireCommentActions(root, body, { logId: id, ownerId, isOwner });
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
function reviewBodyHtml(log) {
  if (!log.review) return '<p class="rv__nowrite">No write-up — just logged and rated.</p>';
  const text = `<p class="rv__text">${esc(log.review)}</p>`;
  if (!log.contains_spoilers) return `<div class="rv__quote">${text}</div>`;
  return `
    <div class="rv__quote rv__quote--gated">
      <button type="button" class="rv__spoiler" id="spoiler-gate">
        <span class="rv__spoiler-title">This review may contain spoilers</span>
        <span class="rv__spoiler-hint">Tap to read it anyway</span>
      </button>
      ${text}
    </div>`;
}

const visibleCount = (comments) => comments.filter((c) => !c.deleted_at).length;
// No "(0)" — a zero in brackets is a count of nothing dressed up as
// information.
const countLabel = (n) => (n ? `(${n})` : '');

// Pinned to the bottom for the whole visit, which is the point: the
// reply box should never be something you have to scroll to find.
function composerHtml() {
  if (!state.user) {
    return `
      <div class="rv-composer">
        <button type="button" class="rv-composer__signin" id="comment-signin">Sign in to comment</button>
      </div>`;
  }
  return `
    <div class="rv-composer">
      <form class="rv-composer__row" id="comment-form">
        ${avatarImg(state.profile, 32)}
        <div class="rv-composer__field">
          <input type="text" id="comment-input" maxlength="1000" placeholder="What do you think of this?" autocomplete="off" enterkeyhint="send">
          <button type="submit" class="rv-composer__send" id="comment-send" aria-label="Post comment">${iconSend()}</button>
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
  return `
    <div class="comment${c.pinned_at ? ' comment--pinned' : ''}" data-id="${esc(c.id)}" data-user="${esc(c.user_id)}" data-name="${esc(p.username || '')}">
      <a href="#/profile/${esc(p.username)}" class="comment__avatar">${avatarImg(p, 34)}</a>
      <div class="comment__body">
        ${c.pinned_at ? '<span class="comment__pin">Pinned</span>' : ''}
        <div class="comment__head">
          <a href="#/profile/${esc(p.username)}" class="comment__name">${esc(p.display_name || p.username)}</a>
          <span class="comment__time">${timeAgo(c.created_at)}</span>
          ${c.restricted_at ? '<span class="comment__restricted">Only you and the author can see this</span>' : ''}
        </div>
        <p class="comment__text">${linkMentions(c.body)}</p>
      </div>
      <button type="button" class="comment__like" data-like="${esc(c.id)}" aria-label="Like comment" aria-pressed="false">${iconHeart()}</button>
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
function wireCommentActions(root, body, { logId, ownerId, isOwner }) {
  const list = qs('#comment-list', body);
  if (!list) return;

  // Liking is the one action common enough to earn its own target.
  list.addEventListener('click', (e) => {
    const likeBtn = e.target.closest('[data-like]');
    if (!likeBtn) return;
    if (!state.user) { promptSignIn('Sign in to like comments.'); return; }
    const on = likeBtn.getAttribute('aria-pressed') !== 'true';
    likeBtn.setAttribute('aria-pressed', String(on));
    likeBtn.classList.toggle('is-on', on);
    if (on) tapFeedback();
  });

  let timer = null;
  let moved = false;

  const start = (e) => {
    const row = e.target.closest('.comment');
    if (!row || row.classList.contains('comment--gone')) return;
    if (e.target.closest('a, button')) return; // let links and the like button do their own thing
    moved = false;
    timer = setTimeout(() => {
      if (moved) return;
      tapFeedback();
      openCommentSheet(row, { logId, ownerId, isOwner, body });
    }, 420);
  };
  const cancel = () => { clearTimeout(timer); timer = null; };

  list.addEventListener('pointerdown', start);
  list.addEventListener('pointermove', () => { moved = true; cancel(); });
  list.addEventListener('pointerup', cancel);
  list.addEventListener('pointercancel', cancel);
  // Right-click is the same intent with a mouse.
  list.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.comment');
    if (!row || row.classList.contains('comment--gone')) return;
    e.preventDefault();
    openCommentSheet(row, { logId, ownerId, isOwner, body });
  });
}

function openCommentSheet(row, { logId, ownerId, isOwner, body }) {
  const commentId = row.dataset.id;
  const authorId = row.dataset.user;
  const handle = row.dataset.name;
  const mine = state.user && state.user.id === authorId;
  const pinned = row.classList.contains('comment--pinned');
  const restricted = !!qs('.comment__restricted', row);

  const actions = [];
  actions.push({ id: 'reply', label: `Reply to @${handle}` });
  if (isOwner) actions.push({ id: 'pin', label: pinned ? 'Unpin comment' : 'Pin to top' });
  if (isOwner && !mine) actions.push({ id: 'restrict', label: restricted ? 'Un-restrict' : 'Restrict this comment' });
  if (mine || isOwner) actions.push({ id: 'delete', label: 'Delete', danger: true });
  if (!mine) {
    actions.push({ id: 'report', label: 'Report', icon: iconFlag() });
    actions.push({ id: 'block', label: `Block @${handle}`, icon: iconBlock(), danger: true });
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="sheet comment-sheet">
      <div class="sheet__grip" aria-hidden="true"></div>
      <div class="comment-sheet__list">
        ${actions.map((x) => `
          <button type="button" class="sheet-row${x.danger ? ' sheet-row--danger' : ''}" data-act="${x.id}">
            ${x.icon || ''}<span>${esc(x.label)}</span>
          </button>`).join('')}
      </div>
      <button type="button" class="sheet-row comment-sheet__cancel" data-act="cancel">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  qsa('[data-act]', overlay).forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
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
        close();
        openReportSheet({ targetType: 'comment', targetId: commentId, subject: qs('.comment__text', row)?.textContent || '' });
      }
    } catch (err) {
      toast(err.message || 'That did not work.', 'error');
    }
  }));
}

function wireLike(btn, logId, likeInfo) {
  if (!btn) return;
  let liked = likeInfo.liked;
  let count = likeInfo.count;
  btn.addEventListener('click', async () => {
    if (!state.user) { promptSignIn('Sign in to like this review.'); return; }
    btn.disabled = true;
    try {
      await api.toggleLike(state.user.id, logId, liked);
      if (!liked) tapFeedback();
      liked = !liked;
      count += liked ? 1 : -1;
      btn.classList.toggle('rv__like--on', liked);
      btn.setAttribute('aria-pressed', String(liked));
      qs('#review-like-count', btn).textContent = count || '';
    } catch (err) {
      toast(err.message || 'Could not update like.', 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function bumpCommentCount(scope, delta) {
  const el = qs('#comment-count', scope || document);
  if (!el) return;
  const cur = parseInt((el.textContent || '').replace(/\D/g, ''), 10) || 0;
  el.textContent = countLabel(Math.max(0, cur + delta));
}
