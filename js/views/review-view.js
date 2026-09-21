import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, avatarImg, posterFrame, spinner, iconHeart, iconSend, iconClose } from '../components.js';
import { esc, starRow, formatDate, timeAgo, qs, qsa, toast, tapFeedback, promptSignIn } from '../utils.js';

// One person's review, on its own page — opened by tapping a review in
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
    const [log, likeInfo, comments] = await Promise.all([
      api.getLogById(id),
      api.getLikeInfo(id, state.user?.id).catch(() => ({ count: 0, liked: false })),
      api.getComments(id).catch(() => []),
    ]);
    const g = log.games || {};
    const a = log.profiles || {};
    const who = a.display_name || a.username || 'Someone';
    // "Aditya's Review", not "Aditya Review" — and not "Aditya's's"
    // either, for the names that already end in one.
    const possessive = /s$/i.test(who) ? `${who}’` : `${who}’s`;

    body.innerHTML = `
      <article class="rv">
        <div class="rv__head">
          <a href="#/game/${g.id}" class="rv__cover-link" aria-label="${esc(g.title || 'Game')}">
            ${posterFrame(g.cover_url, g.title, 'rv__cover')}
          </a>
          <div class="rv__meta">
            <a href="#/profile/${esc(a.username)}" class="rv__by">
              ${avatarImg(a, 26)}<span>${esc(possessive)} review</span>
            </a>
            <a href="#/game/${g.id}" class="rv__game">
              <h1 class="rv__title">${esc(g.title || 'Untitled')}</h1>
              ${g.release_year ? `<span class="rv__year">${esc(String(g.release_year))}</span>` : ''}
            </a>
            ${log.rating ? `<div class="rv__stars">${starRow(log.rating, { size: 19 })}</div>` : ''}
            ${log.played_date ? `<p class="rv__played">Played on ${formatDate(log.played_date)}</p>` : ''}
          </div>
        </div>

        ${log.review
          ? `<blockquote class="rv__quote${log.contains_spoilers ? ' rv__quote--spoiler' : ''}"${log.contains_spoilers ? ' data-spoiler' : ''}>
               ${log.contains_spoilers ? '<span class="spoiler-tag">Spoilers — tap to reveal</span>' : ''}
               <p class="rv__text">${esc(log.review)}</p>
             </blockquote>`
          : '<p class="rv__nowrite">No write-up — just logged and rated.</p>'}

        <button type="button" class="rv__like${likeInfo.liked ? ' rv__like--on' : ''}" id="review-like"
                aria-pressed="${likeInfo.liked}">
          ${iconHeart()}<span id="review-like-count">${likeLabel(likeInfo.count)}</span>
        </button>
      </article>

      <section class="rv-comments">
        <h2 class="rv-comments__head">Comments <span id="comment-count">(${comments.length})</span></h2>
        <div class="comment-list" id="comment-list">
          ${comments.length
            ? comments.map(commentHtml).join('')
            : '<p class="rv-comments__empty">No comments yet. Be the first.</p>'}
        </div>
      </section>`;

    root.insertAdjacentHTML('beforeend', composerHtml());

    const spoiler = qs('[data-spoiler]', body);
    if (spoiler) spoiler.addEventListener('click', () => spoiler.classList.add('is-revealed'), { once: true });

    wireLike(qs('#review-like', body), id, likeInfo);
    wireCommentDeletes(qs('#comment-list', body));
    wireComposer(root, body, id);
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this review: ${esc(err.message)}</p>`;
  }
}

// "24 likes", not a bare number — the count means nothing on its own
// next to a heart that is also the button you press.
function likeLabel(n) {
  return `${n} ${n === 1 ? 'like' : 'likes'}`;
}

// Pinned to the bottom for the whole visit, which is the point: the
// reply box should never be something you have to scroll to find.
// Signed out it is still there, and still the full width of the bar —
// it just asks you to sign in instead of pretending to take a comment
// and refusing at the last moment.
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
        ${avatarImg(state.profile, 30)}
        <input type="text" id="comment-input" maxlength="1000" placeholder="Add a comment" autocomplete="off" enterkeyhint="send">
        <button type="submit" class="rv-composer__send" id="comment-send" aria-label="Post comment">${iconSend()}</button>
      </form>
    </div>`;
}

function wireComposer(root, body, logId) {
  qs('#comment-signin', root)?.addEventListener('click', () => promptSignIn('Sign in to join the conversation.'));

  const form = qs('#comment-form', root);
  if (!form) return;
  const input = qs('#comment-input', root);
  const send = qs('#comment-send', root);

  // The send button only lights up once there is something to send.
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
      list.insertAdjacentHTML('beforeend', commentHtml(saved));
      wireCommentDeletes(list);
      input.value = '';
      sync();
      bumpCommentCount(body, +1);
      // Put the comment that was just written where it can be seen —
      // it lands at the bottom of a list the composer is covering the
      // end of.
      list.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      toast(err.message || 'Could not post that comment. Try again in a moment.', 'error');
    } finally {
      send.disabled = false;
    }
  });
}

function commentHtml(c) {
  const p = c.profiles || {};
  const own = state.user && c.user_id === state.user.id;
  return `
    <div class="comment" data-id="${esc(c.id)}">
      <a href="#/profile/${esc(p.username)}" class="comment__avatar">${avatarImg(p, 32)}</a>
      <div class="comment__body">
        <div class="comment__head">
          <a href="#/profile/${esc(p.username)}" class="comment__name">${esc(p.display_name || p.username)}</a>
          <span class="comment__time">${timeAgo(c.created_at)}</span>
        </div>
        <p class="comment__text">${esc(c.body)}</p>
      </div>
      ${own ? `<button type="button" class="comment__delete" data-del="${esc(c.id)}" aria-label="Delete comment">${iconClose()}</button>` : ''}
    </div>`;
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
      qs('#review-like-count', btn).textContent = likeLabel(count);
    } catch (err) {
      toast(err.message || 'Could not update like.', 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function wireCommentDeletes(list) {
  qsa('[data-del]', list).forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this comment?')) return;
      const row = btn.closest('.comment');
      try {
        await api.deleteComment(btn.dataset.del);
        row?.remove();
        bumpCommentCount(list.closest('.view-body'), -1);
      } catch (err) {
        toast(err.message || 'Could not delete that comment.', 'error');
      }
    });
  });
}

function bumpCommentCount(scope, delta) {
  const el = qs('#comment-count', scope || document);
  if (!el) return;
  const cur = parseInt((el.textContent || '').replace(/\D/g, ''), 10) || 0;
  el.textContent = `(${Math.max(0, cur + delta)})`;
}
