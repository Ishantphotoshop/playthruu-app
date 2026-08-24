import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, avatarImg, posterFrame, spinner, iconHeart, iconClose } from '../components.js';
import { esc, starRow, formatDate, timeAgo, qs, qsa, toast, tapFeedback } from '../utils.js';

// A single review on its own page — opened from the "friend's recent
// activity" strip. Shows the friend's whole entry (rating + write-up),
// and lets people like it and comment, so it reads as its own little
// thread rather than a line buried in the game's reviews list.
export async function renderReviewView(root, { id }) {
  root.innerHTML = topBar('Review', { back: true }) + `<div class="view-body" id="review-body">${spinner()}</div>` + navBar('');
  const body = qs('#review-body', root);

  try {
    const [log, likeInfo, comments] = await Promise.all([
      api.getLogById(id),
      api.getLikeInfo(id, state.user?.id).catch(() => ({ count: 0, liked: false })),
      api.getComments(id).catch(() => []),
    ]);
    const g = log.games || {};
    const a = log.profiles || {};

    body.innerHTML = `
      <article class="review-page">
        <a href="#/game/${g.id}" class="review-page__game">
          ${posterFrame(g.cover_url, g.title, 'review-page__cover')}
          <div class="review-page__game-info">
            <h1 class="review-page__title">${esc(g.title)}</h1>
            ${g.release_year ? `<p class="review-page__year">${esc(String(g.release_year))}</p>` : ''}
            ${log.rating ? `<div class="review-page__stars">${starRow(log.rating, { size: 20 })}</div>` : ''}
          </div>
        </a>

        <a href="#/profile/${esc(a.username)}" class="review-page__author">
          ${avatarImg(a, 34)}
          <span class="review-page__author-name">${esc(a.display_name || a.username)}</span>
          ${log.played_date ? `<span class="review-page__date">${formatDate(log.played_date)}</span>` : ''}
        </a>

        ${log.review
          ? `<div class="review-page__body${log.contains_spoilers ? ' review-page__body--spoiler' : ''}" ${log.contains_spoilers ? 'data-spoiler' : ''}>
               ${log.contains_spoilers ? '<span class="spoiler-tag">SPOILERS — tap to reveal</span>' : ''}
               <p class="review-page__text">${esc(log.review)}</p>
             </div>`
          : '<p class="muted review-page__nowrite">No written review — just logged and rated.</p>'}

        <div class="review-page__actions">
          <button type="button" class="like-btn${likeInfo.liked ? ' like-btn--liked' : ''}" id="review-like" aria-pressed="${likeInfo.liked}">
            ${iconHeart()} <span>${likeInfo.count > 0 ? likeInfo.count : ''}</span>
          </button>
        </div>

        <section class="comments">
          <h2 class="comments__heading">Comments <span id="comment-count">${comments.length ? `(${comments.length})` : ''}</span></h2>
          ${state.user ? `
            <form class="comment-form" id="comment-form">
              ${avatarImg(state.profile, 30)}
              <input type="text" id="comment-input" maxlength="1000" placeholder="Add a comment…" autocomplete="off">
              <button type="submit" class="btn btn--accent comment-form__send">Post</button>
            </form>` : ''}
          <div class="comment-list" id="comment-list">
            ${comments.length ? comments.map(commentHtml).join('') : '<p class="muted comments__empty">No comments yet. Be the first.</p>'}
          </div>
        </section>
      </article>`;

    // Spoiler reveal.
    const spoiler = qs('[data-spoiler]', body);
    if (spoiler) spoiler.addEventListener('click', () => spoiler.classList.add('is-revealed'), { once: true });

    // Like.
    wireLike(qs('#review-like', body), id, likeInfo);

    // Comment delete (own comments).
    wireCommentDeletes(qs('#comment-list', body));

    // Post a comment.
    const form = qs('#comment-form', body);
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = qs('#comment-input', body);
        const text = input.value.trim();
        if (!text) return;
        const btn = qs('.comment-form__send', body);
        btn.disabled = true;
        try {
          const saved = await api.addComment(id, state.user.id, text);
          saved.profiles = saved.profiles || state.profile;
          const list = qs('#comment-list', body);
          const empty = qs('.comments__empty', list);
          if (empty) list.innerHTML = '';
          list.insertAdjacentHTML('beforeend', commentHtml(saved));
          wireCommentDeletes(list);
          input.value = '';
          bumpCommentCount(body, +1);
        } catch (err) {
          toast(err.message || 'Could not post that comment. Try again in a moment.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    }
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this review: ${esc(err.message)}</p>`;
  }
}

function commentHtml(c) {
  const p = c.profiles || {};
  const own = state.user && c.user_id === state.user.id;
  return `
    <div class="comment" data-id="${esc(c.id)}">
      <a href="#/profile/${esc(p.username)}" class="comment__avatar">${avatarImg(p, 30)}</a>
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
    if (!state.user) { toast('Sign in to like this.', 'error'); return; }
    btn.disabled = true;
    try {
      await api.toggleLike(state.user.id, logId, liked);
      if (!liked) tapFeedback();
      liked = !liked;
      count += liked ? 1 : -1;
      btn.classList.toggle('like-btn--liked', liked);
      btn.setAttribute('aria-pressed', String(liked));
      qs('span', btn).textContent = count > 0 ? count : '';
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
        bumpCommentCount(list.closest('.review-page'), -1);
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
  const next = Math.max(0, cur + delta);
  el.textContent = next ? `(${next})` : '';
}
