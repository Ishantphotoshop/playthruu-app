import * as api from '../api.js';
import { navigate, refreshCurrentView } from '../router.js';
import { confirmSheet, iconClose } from '../components.js';
import { formatDate, qs, toast, enableSwipeToDismiss } from '../utils.js';
import { openLogComposer } from './log-composer.js';

// The three-dots menu on your own review page: Edit, Share to Instagram Stories,
// Share and Delete (the last two shown to everyone / only the owner as noted).

function releaseText(g) {
  if (g.release_date) return formatDate(g.release_date);
  return g.release_year ? String(g.release_year) : '';
}

function longDate(raw) {
  if (!raw) return '';
  const d = new Date(raw + (String(raw).length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function entryUrl(log) {
  return `${location.origin}${location.pathname}#/review/${log.id}`;
}

const WHO_OPTIONS = [
  ['everyone', 'Everyone'],
  ['following', 'People you follow'],
  ['followers', 'Your followers'],
  ['both', 'People you follow and your followers'],
  ['nobody', 'No one'],
];

function currentWho(log) {
  if (log.comments_disabled) return 'nobody';
  return log.comments_who || 'everyone';
}

// The same pop-up as Browse's filters: a full-screen sheet with a close button and a
// title on top, radio choices, and Reset / Save underneath.
// Opening the next screen BEFORE taking the menu down matters: the app steps back one
// history entry whenever a sheet closes on its own, and doing it the other way round
// made that step-back swallow the screen that had just opened.
function openWhoSheet(log, onChanged) {
  const now = currentWho(log);
  let pick = now;
  const sheet = document.createElement('div');
  sheet.className = 'browse-filters';
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.__dismiss = close;
  const paint = () => {
    sheet.innerHTML = `
      <div class="browse-filters__top">
        <button type="button" class="browse-filters__icon" data-act="close" aria-label="Close">${iconClose()}</button>
        <h2>Who can comment</h2>
      </div>
      <div class="browse-filters__body">
        ${WHO_OPTIONS.map(([v, label]) => `
          <button type="button" class="bf-opt" data-who="${v}">
            <span class="bf-mark bf-mark--radio${v === pick ? ' is-on' : ''}"></span><span class="bf-opt__name">${label}</span>
          </button>`).join('')}
        <p class="bf-note">This is about your own review. You can always comment on it yourself, and you can delete or block anyone from the comment list.</p>
      </div>
      <div class="bf-foot">
        <button type="button" class="bf-reset" data-act="reset"${pick === 'everyone' ? ' disabled' : ''}>Reset</button>
        <button type="button" class="bf-show" data-act="save"${pick === now ? ' disabled' : ''}>Save</button>
      </div>`;
  };
  paint();
  sheet.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-who],[data-act]');
    if (!el) return;
    if (el.dataset.who) { pick = el.dataset.who; paint(); return; }
    if (el.dataset.act === 'close') { close(); return; }
    if (el.dataset.act === 'reset') { pick = 'everyone'; paint(); return; }
    if (el.dataset.act === 'save') {
      close();
      try {
        await api.updateLog(log.id, pick === 'nobody' ? { comments_disabled: true } : { comments_disabled: false, comments_who: pick });
        toast(pick === 'nobody' ? 'Comments are off.' : 'Saved.', 'success');
        onChanged();
      } catch (err) {
        toast('Could not change that yet. The comment settings need a database update first.', 'error');
      }
    }
  });
}

export function openEntryMenu(log, isOwner, { onChanged = () => {} } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal--sheet">
      <header class="msg-actions__grab" aria-hidden="true"></header>
      <div class="msg-actions__list de-menu">
        ${isOwner ? '<button type="button" class="msg-actions__item" data-do="edit"><span>Edit</span></button>' : ''}
        ${isOwner ? '<button type="button" class="msg-actions__item" data-do="who"><span>Who can comment</span></button>' : ''}
        <button type="button" class="msg-actions__item" data-do="story"><span>Share to Instagram Stories</span></button>
        <button type="button" class="msg-actions__item" data-do="share"><span>Share</span></button>
        ${isOwner ? '<button type="button" class="msg-actions__item msg-actions__item--danger" data-do="delete"><span>Delete</span></button>' : ''}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.__dismiss = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  enableSwipeToDismiss(qs('.modal', overlay), close);

  overlay.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-do]')?.dataset.do;
    if (!act) return;
    if (act === 'edit') {
      // The writing screen (I Played / Edit Text), opened before this menu goes.
      openLogComposer({ existingLog: log, onSaved: () => refreshCurrentView() });
      close();
    } else if (act === 'who') {
      openWhoSheet(log, onChanged);
      close();
    } else if (act === 'share') {
      close();
      shareLink(log);
    } else if (act === 'story') {
      close();
      shareToStory(log);
    } else if (act === 'delete') {
      const asking = confirmSheet({
        title: 'Delete this diary entry?',
        message: `${log.games?.title || 'This game'} will be removed from your diary.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      close();
      if (!(await asking)) return;
      try {
        await api.deleteLog(log.id);
        toast('Deleted from your diary.', 'success');
        if (history.length > 1) history.back(); else navigate('/me');
      } catch (err) {
        toast(err.message || 'Could not delete that.', 'error');
      }
    }
  });
}

async function shareLink(log) {
  const url = entryUrl(log);
  const title = `${log.games?.title || 'A game'} on PlayThruu`;
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch (err) { if (err?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied.', 'success'); }
  catch { toast('Could not copy that link.', 'error'); }
}

// A 1080x1920 picture (the shape of an Instagram story) of the entry, handed to
// the phone's share sheet, where Instagram Stories is one of the choices. A
// browser can't open Instagram's story editor directly, so where sharing a
// picture isn't possible the picture is saved instead, ready to post.
function loadCover(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url.replace(/^\/\//, 'https://');
  });
}

function wrapLines(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…');
  }
  return lines;
}

function starsText(r) {
  const full = Math.floor(r);
  return '★'.repeat(full) + (r - full >= 0.5 ? '½' : '');
}

function igdbBig(url) {
  if (!url) return url;
  return url.replace(/t_[a-z_0-9]+/, 't_cover_big');
}

async function shareToStory(log) {
  const g = log.games || {};
  toast('Making your story picture…', 'info');
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a110b';
  ctx.fillRect(0, 0, W, H);

  const cover = await loadCover(igdbBig(g.cover_url));
  const cw = 640, ch = 853, cx = (W - cw) / 2, cy = 300;
  ctx.fillStyle = '#2c1c11';
  ctx.fillRect(cx, cy, cw, ch);
  if (cover) {
    try { ctx.drawImage(cover, cx, cy, cw, ch); } catch { /* keep the plain tile */ }
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#d8bfa3';
  ctx.font = '600 40px Manrope, system-ui, sans-serif';
  ctx.fillText('DIARY ENTRY', W / 2, 200);

  ctx.fillStyle = '#fbf1e4';
  ctx.font = '800 68px Manrope, system-ui, sans-serif';
  const lines = wrapLines(ctx, g.title || 'Untitled', W - 160, 2);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 1290 + i * 80));
  let y = 1290 + lines.length * 80 + 10;

  const rel = releaseText(g);
  if (rel) {
    ctx.fillStyle = '#b79a7c';
    ctx.font = '500 40px Manrope, system-ui, sans-serif';
    ctx.fillText(rel, W / 2, y + 30);
    y += 70;
  }
  if (log.rating) {
    ctx.fillStyle = '#ff9a2e';
    ctx.font = '700 84px Manrope, system-ui, sans-serif';
    ctx.fillText(starsText(Number(log.rating)), W / 2, y + 90);
    y += 120;
  }
  const when = longDate(log.played_date || log.created_at);
  if (when) {
    ctx.fillStyle = '#d8bfa3';
    ctx.font = '600 40px Manrope, system-ui, sans-serif';
    ctx.fillText(`Logged ${when}`, W / 2, y + 60);
  }
  ctx.fillStyle = '#8f7459';
  ctx.font = '800 44px Manrope, system-ui, sans-serif';
  ctx.fillText('PlayThruu', W / 2, 1810);

  let blob = null;
  try { blob = await new Promise((r) => canvas.toBlob(r, 'image/png')); } catch { /* picture could not be made */ }
  if (!blob) { toast('Could not make the picture. Try again.', 'error'); return; }
  const file = new File([blob], 'playthruu-diary.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: g.title || 'PlayThruu' }); return; }
    catch (err) { if (err?.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'playthruu-diary.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Saved the picture. Add it to your Instagram story.', 'success');
}
