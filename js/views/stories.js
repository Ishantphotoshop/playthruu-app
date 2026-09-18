import * as api from '../api.js';
import { state } from '../state.js';
import { avatarImg, iconPlus, iconClose, iconTrash, iconEye, spinner, posterFrame } from '../components.js';
import { esc, qs, qsa, toast, timeAgo, placeholderCover, enableSwipeToDismiss } from '../utils.js';
import { navigate } from '../router.js';

// Stories: a game plus a line about it, visible for 24 hours.
//
// Built on what people already log rather than as another photo feed —
// this is a gaming diary, so "20 hours into Silent Hill f" is the thing
// worth surfacing for a day, and the games in your own diary are where
// the picker gets its options from.

const STORY_MS = 5000; // how long one story holds the screen

// ---- the rail ---------------------------------------------------------

function ringHtml(group, meId) {
  const isMine = group.author.id === meId;
  const cover = group.stories[group.stories.length - 1]?.game?.cover_url;
  return `
    <button type="button" class="story-ring${group.unseen ? ' story-ring--unseen' : ''}" data-author="${esc(group.author.id)}">
      <span class="story-ring__frame">
        <span class="story-ring__inner">
          ${cover
            ? `<img src="${esc(cover)}" alt="" loading="lazy">`
            : avatarImg(group.author, 58)}
        </span>
      </span>
      <span class="story-ring__name">${esc(isMine ? 'You' : (group.author.display_name || group.author.username))}</span>
    </button>`;
}

export async function paintStoryRail(slot) {
  if (!slot || !state.user) return;
  let groups = [];
  try {
    groups = await api.getStoryRail(state.user.id);
  } catch {
    // A rail that cannot load is simply not drawn — it is the least
    // important thing on the feed and an error strip here would be worse
    // than its absence.
    slot.innerHTML = '';
    return;
  }

  const meId = state.user.id;
  const mine = groups.find((g) => g.author.id === meId);
  // The add button doubles as your own ring once you have posted — one
  // control, so the rail never shows two things that both mean "you".
  const addHtml = `
    <button type="button" class="story-ring story-ring--add" data-add="1">
      <span class="story-ring__frame">
        <span class="story-ring__inner">${mine ? '' : avatarImg(state.profile, 58)}</span>
        <span class="story-ring__plus">${iconPlus()}</span>
      </span>
      <span class="story-ring__name">Add</span>
    </button>`;

  const others = groups.filter((g) => g.author.id !== meId);
  if (!mine && !others.length) {
    // Nothing live anywhere: still offer the way in, but don't dedicate a
    // whole strip to one button — it reads as a broken carousel.
    slot.innerHTML = '';
    return;
  }

  slot.innerHTML = `
    <div class="story-rail">
      ${mine ? ringHtml(mine, meId) : ''}
      ${addHtml}
      ${others.map((g) => ringHtml(g, meId)).join('')}
    </div>`;

  qsa('.story-ring', slot).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.add) { openAddStorySheet(() => paintStoryRail(slot)); return; }
      const index = groups.findIndex((g) => g.author.id === btn.dataset.author);
      if (index >= 0) openStoryViewer(groups, index, () => paintStoryRail(slot));
    });
  });
}

// ---- the viewer -------------------------------------------------------

export function openStoryViewer(groups, startGroup = 0, onClose) {
  let gi = startGroup;
  let si = 0;
  let timer = null;
  let startedAt = 0;
  let remaining = STORY_MS;
  let paused = false;

  const overlay = document.createElement('div');
  overlay.className = 'story-viewer';
  document.body.appendChild(overlay);

  const close = () => {
    clearTimeout(timer);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  }
  document.addEventListener('keydown', onKey);

  function current() {
    return groups[gi]?.stories?.[si] || null;
  }

  function next() {
    const group = groups[gi];
    if (!group) return close();
    if (si + 1 < group.stories.length) { si += 1; paint(); return; }
    if (gi + 1 < groups.length) { gi += 1; si = 0; paint(); return; }
    close();
  }

  function prev() {
    if (si > 0) { si -= 1; paint(); return; }
    if (gi > 0) { gi -= 1; si = Math.max(0, groups[gi].stories.length - 1); paint(); return; }
    // Already at the very first story — restart it rather than closing,
    // which is what every other story UI does on a back-tap.
    paint();
  }

  function startTimer(ms) {
    clearTimeout(timer);
    startedAt = Date.now();
    remaining = ms;
    timer = setTimeout(next, ms);
  }

  function pause() {
    if (paused) return;
    paused = true;
    clearTimeout(timer);
    remaining = Math.max(400, remaining - (Date.now() - startedAt));
    qs('.story-viewer__fill--live', overlay)?.style.setProperty('animation-play-state', 'paused');
  }

  function resume() {
    if (!paused) return;
    paused = false;
    qs('.story-viewer__fill--live', overlay)?.style.setProperty('animation-play-state', 'running');
    startTimer(remaining);
  }

  function paint() {
    const group = groups[gi];
    const story = current();
    if (!group || !story) return close();

    const isMine = group.author.id === state.user?.id;
    const game = story.game;
    const cover = game?.cover_url;

    overlay.innerHTML = `
      <div class="story-viewer__bg">${cover ? `<img src="${esc(cover)}" alt="">` : ''}</div>
      <div class="story-viewer__bars">
        ${group.stories.map((_, i) => `
          <span class="story-viewer__bar">
            <span class="story-viewer__fill${i < si ? ' story-viewer__fill--done' : ''}${i === si ? ' story-viewer__fill--live' : ''}"
                  style="${i === si ? `animation-duration:${STORY_MS}ms` : ''}"></span>
          </span>`).join('')}
      </div>
      <header class="story-viewer__head">
        <span class="story-viewer__who">
          ${avatarImg(group.author, 32)}
          <span class="story-viewer__meta">
            <b>${esc(isMine ? 'Your story' : (group.author.display_name || group.author.username))}</b>
            <span>${esc(timeAgo(story.created_at))}</span>
          </span>
        </span>
        <span class="story-viewer__tools">
          ${isMine ? `<button type="button" class="story-viewer__icon" data-viewers aria-label="Who has seen this">${iconEye()}</button>` : ''}
          ${isMine ? `<button type="button" class="story-viewer__icon" data-delete aria-label="Delete this story">${iconTrash()}</button>` : ''}
          <button type="button" class="story-viewer__icon" data-close aria-label="Close">${iconClose()}</button>
        </span>
      </header>

      <div class="story-viewer__card">
        ${game ? `
          <button type="button" class="story-viewer__game" data-game="${esc(game.id)}">
            ${posterFrame(game.cover_url, game.title, 'story-viewer__poster')}
            <span class="story-viewer__game-meta">
              <b>${esc(game.title)}</b>
              ${game.genre ? `<span>${esc(String(game.genre).split(',')[0].trim())}</span>` : ''}
            </span>
          </button>` : ''}
        ${story.caption ? `<p class="story-viewer__caption">${esc(story.caption)}</p>` : ''}
      </div>

      <button type="button" class="story-viewer__half story-viewer__half--prev" aria-label="Previous"></button>
      <button type="button" class="story-viewer__half story-viewer__half--next" aria-label="Next"></button>`;

    qs('[data-close]', overlay).addEventListener('click', close);
    qs('.story-viewer__half--prev', overlay).addEventListener('click', prev);
    qs('.story-viewer__half--next', overlay).addEventListener('click', next);
    qs('[data-game]', overlay)?.addEventListener('click', () => {
      close();
      navigate(`/game/${game.id}`);
    });
    qs('[data-viewers]', overlay)?.addEventListener('click', () => { pause(); openViewerList(story, resume); });
    qs('[data-delete]', overlay)?.addEventListener('click', async () => {
      pause();
      if (!confirm('Delete this story?')) { resume(); return; }
      try {
        await api.deleteStory(story.id);
        groups[gi].stories.splice(si, 1);
        if (!groups[gi].stories.length) groups.splice(gi, 1);
        si = 0;
        if (!groups.length) return close();
        if (gi >= groups.length) gi = groups.length - 1;
        toast('Story deleted');
        paint();
      } catch (err) {
        toast(err.message || 'Could not delete that.', 'error');
        resume();
      }
    });

    // Holding anywhere pauses, which is what people expect from a story
    // they want to actually read rather than glance at.
    ['pointerdown'].forEach((ev) => overlay.addEventListener(ev, pause, { once: false }));
    ['pointerup', 'pointercancel'].forEach((ev) => overlay.addEventListener(ev, resume, { once: false }));

    startTimer(STORY_MS);

    // Counted as watched as soon as it is on screen. Viewing your own is
    // refused by RLS on purpose, and that refusal is swallowed.
    if (!isMine && state.user) {
      api.markStoryViewed(story.id, state.user.id).catch(() => {});
      story.seen = true;
    }
  }

  paint();
}

function openViewerList(story, onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal--sheet">
      <header class="msg-actions__grab"></header>
      <div class="group-info">
        <h3 class="group-info__title">Seen by</h3>
        <div class="group-info__members" id="story-viewers">${spinner()}</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); onClose?.(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  enableSwipeToDismiss(qs('.modal', overlay), close);

  api.getStoryViewers(story.id).then((views) => {
    const el = qs('#story-viewers', overlay);
    if (!el) return;
    el.innerHTML = views.length
      ? views.map((v) => `
          <a href="#/profile/${esc(v.viewer.username)}" class="group-info__member">
            ${avatarImg(v.viewer, 38)}
            <span class="group-info__m-meta"><b>${esc(v.viewer.display_name || v.viewer.username)}</b><span>${esc(timeAgo(v.viewed_at))} ago</span></span>
          </a>`).join('')
      : '<p class="muted">Nobody yet.</p>';
  }).catch(() => {
    const el = qs('#story-viewers', overlay);
    if (el) el.innerHTML = '<p class="muted">Couldn’t load that.</p>';
  });
}

// ---- adding one -------------------------------------------------------

// The options come from your own diary, because a story here is about a
// game you are actually playing — a full game search would invite
// posting about things you have never touched, which is a different
// (and less interesting) feature.
export function openAddStorySheet(onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal--tall">
      <header class="modal__header"><h2>Add to your story</h2><button class="modal__close" data-close aria-label="Close">${iconClose()}</button></header>
      <div class="modal__body">
        <p class="set-hint" style="padding:0 0 10px">Pick something from your diary. It stays up for 24 hours.</p>
        <div id="story-games">${spinner()}</div>
        <label class="field" id="story-caption-field" hidden>
          <span>Say something (optional)</span>
          <input type="text" id="story-caption" maxlength="200" placeholder="20 hours in and still lost…">
        </label>
        <button type="button" class="btn btn--accent btn--block" id="story-post" hidden>Add to story</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  qs('[data-close]', overlay).addEventListener('click', close);
  enableSwipeToDismiss(qs('.modal', overlay), close);

  let picked = null;

  api.getLogsForUser(state.user.id, { limit: 40 }).then((logs) => {
    const el = qs('#story-games', overlay);
    if (!el) return;
    // Playing first — that is what a story is usually about — then the
    // rest of the diary, newest first. One entry per game.
    const seen = new Set();
    const ordered = [
      ...logs.filter((l) => l.status === 'playing'),
      ...logs.filter((l) => l.status !== 'playing'),
    ].filter((l) => l.games && !seen.has(l.game_id) && seen.add(l.game_id));

    if (!ordered.length) {
      el.innerHTML = '<p class="muted">Log a game first and it shows up here.</p>';
      return;
    }
    el.innerHTML = `<div class="story-pick">${ordered.slice(0, 24).map((l) => `
      <button type="button" class="story-pick__item" data-game="${esc(l.game_id)}" data-log="${esc(l.id)}">
        <img src="${esc(l.games.cover_url || placeholderCover(l.games.title))}" alt="" loading="lazy">
        <span>${esc(l.games.title)}</span>
      </button>`).join('')}</div>`;

    qsa('.story-pick__item', el).forEach((btn) => {
      btn.addEventListener('click', () => {
        qsa('.story-pick__item', el).forEach((b) => b.classList.toggle('story-pick__item--on', b === btn));
        picked = { gameId: btn.dataset.game, logId: btn.dataset.log };
        qs('#story-caption-field', overlay).hidden = false;
        qs('#story-post', overlay).hidden = false;
      });
    });
  }).catch(() => {
    const el = qs('#story-games', overlay);
    if (el) el.innerHTML = '<p class="muted">Couldn’t load your diary.</p>';
  });

  qs('#story-post', overlay).addEventListener('click', async () => {
    if (!picked) return;
    const btn = qs('#story-post', overlay);
    btn.disabled = true;
    btn.textContent = 'Posting…';
    try {
      await api.createStory(state.user.id, {
        gameId: picked.gameId,
        logId: picked.logId,
        caption: qs('#story-caption', overlay).value,
      });
      close();
      toast('Added to your story');
      onDone?.();
    } catch (err) {
      toast(err.message || 'Could not post that.', 'error');
      btn.disabled = false;
      btn.textContent = 'Add to story';
    }
  });
}
