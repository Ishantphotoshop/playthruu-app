// ============================================================
// ADMIN UI PRIMITIVES
// ============================================================
// Shared behaviour the admin screens lean on — a command palette, undoable
// destructive actions, animated counters, skeleton placeholders and CSV
// export. Kept out of admin.js so that file stays a description of the
// screens rather than a mix of screens and machinery.

import { esc, qs, qsa, toast } from '../js/utils.js';

// ------------------------------------------------------------ counters
// Counts a number up to its value instead of snapping to it. Small
// enough to be free, and it makes the dashboard feel like it's reporting
// live figures rather than printing a static page.
export function countUp(el, to, { duration = 620, format = (v) => new Intl.NumberFormat().format(v) } = {}) {
  if (to === null || to === undefined) { el.textContent = '—'; return; }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.textContent = format(to); return; }
  const from = 0;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    // easeOutExpo: moves fast then settles, which reads as "landing on"
    // the figure rather than creeping toward it.
    const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------ skeletons
// Placeholder rows shaped like the content that's coming, so a screen
// keeps its layout while loading instead of collapsing to a spinner and
// then jumping to full height.
export function skeletonRows(n = 5, { thumb = true } = {}) {
  return `<div class="adm-skel">${Array.from({ length: n }, () => `
    <div class="adm-skel__row">
      ${thumb ? '<span class="adm-skel__thumb"></span>' : ''}
      <span class="adm-skel__lines">
        <span class="adm-skel__line"></span>
        <span class="adm-skel__line adm-skel__line--short"></span>
      </span>
    </div>`).join('')}</div>`;
}

export function skeletonPanel() {
  return `<div class="adm-skel"><div class="adm-skel__block"></div></div>`;
}

// ------------------------------------------------------------ undo
// A destructive action people can take back for a few seconds. The row is
// removed from the screen immediately (so it feels instant) but the
// database write is deferred until the window closes — undo therefore
// costs nothing and can't half-apply, which a delete-then-restore would.
const UNDO_MS = 6000;

export function undoable({ message, onCommit, onUndo }) {
  let timer = null;
  let done = false;

  const bar = document.createElement('div');
  bar.className = 'adm-undo';
  bar.innerHTML = `
    <span class="adm-undo__text">${esc(message)}</span>
    <button class="adm-undo__btn" type="button">Undo</button>
    <span class="adm-undo__timer"></span>`;
  document.body.appendChild(bar);
  requestAnimationFrame(() => bar.classList.add('adm-undo--in'));

  const dismiss = () => {
    bar.classList.remove('adm-undo--in');
    setTimeout(() => bar.remove(), 220);
  };

  const commit = async () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    dismiss();
    try { await onCommit(); } catch (err) {
      console.error(err);
      toast(err?.message || 'That change could not be saved', 'error');
      onUndo?.();
    }
  };

  bar.querySelector('.adm-undo__btn').addEventListener('click', () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    dismiss();
    onUndo?.();
  });

  timer = setTimeout(commit, UNDO_MS);
  // Leaving the screen must not silently drop the pending write.
  window.addEventListener('hashchange', commit, { once: true });
  return { commit };
}

// ------------------------------------------------------------ export
export function downloadCsv(filename, rows) {
  if (!rows.length) { toast('Nothing to export', 'error'); return; }
  const headers = Object.keys(rows[0]);
  // Quote everything and double any embedded quotes — the safe subset of
  // RFC 4180 that spreadsheets all agree on.
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(cell).join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${rows.length} rows exported`, 'success');
}

// ------------------------------------------------------------ palette
// Ctrl/Cmd-K to jump anywhere or run an action, without hunting for the
// tile. Actions are supplied by the caller so this knows nothing about
// what the admin app can actually do.
let paletteOpen = false;

export function openPalette(commands) {
  if (paletteOpen) return;
  paletteOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'adm-palette';
  overlay.innerHTML = `
    <div class="adm-palette__box" role="dialog" aria-label="Command palette">
      <input class="adm-palette__input" type="text" placeholder="Jump to, or type a command…"
             autocomplete="off" spellcheck="false" aria-label="Search commands">
      <div class="adm-palette__list" role="listbox"></div>
      <div class="adm-palette__foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> run</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = qs('.adm-palette__input', overlay);
  const list = qs('.adm-palette__list', overlay);
  let matches = commands;
  let active = 0;

  const close = () => {
    paletteOpen = false;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };

  // Subsequence match, so "tg" finds "Trending games" the way an editor's
  // fuzzy open does — a plain substring test would not.
  const score = (cmd, q) => {
    const hay = `${cmd.title} ${cmd.hint || ''}`.toLowerCase();
    if (!q) return 0;
    if (hay.startsWith(q)) return 3;
    if (hay.includes(q)) return 2;
    let i = 0;
    for (const ch of q) { i = hay.indexOf(ch, i); if (i === -1) return -1; i += 1; }
    return 1;
  };

  const draw = () => {
    if (!matches.length) {
      list.innerHTML = `<p class="adm-palette__none">Nothing matches that.</p>`;
      return;
    }
    list.innerHTML = matches.map((c, i) => `
      <button class="adm-palette__item${i === active ? ' adm-palette__item--active' : ''}"
              role="option" aria-selected="${i === active}" data-i="${i}">
        <span class="adm-palette__icon">${c.icon || ''}</span>
        <span class="adm-palette__label">
          <span class="adm-palette__title">${esc(c.title)}</span>
          ${c.hint ? `<span class="adm-palette__hint">${esc(c.hint)}</span>` : ''}
        </span>
        ${c.badge ? `<span class="adm-palette__badge">${esc(c.badge)}</span>` : ''}
      </button>`).join('');
    qsa('.adm-palette__item', list).forEach((btn) => {
      btn.addEventListener('click', () => run(Number(btn.dataset.i)));
      btn.addEventListener('mousemove', () => {
        const i = Number(btn.dataset.i);
        if (i === active) return;
        active = i; draw();
      });
    });
    list.querySelector('.adm-palette__item--active')?.scrollIntoView({ block: 'nearest' });
  };

  const run = (i) => {
    const cmd = matches[i];
    if (!cmd) return;
    close();
    cmd.run();
  };

  const filter = () => {
    const q = input.value.trim().toLowerCase();
    matches = commands
      .map((c) => ({ c, s: score(c, q) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);
    active = 0;
    draw();
  };

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(matches.length - 1, active + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  }

  input.addEventListener('input', filter);
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  draw();
  requestAnimationFrame(() => input.focus());
}

// ------------------------------------------------------------ bulk select
// Turns a list of rows into a multi-select surface with an action bar.
// The caller owns what the actions do; this owns the selection, the
// checkboxes, and keeping the bar in sync with what's ticked.
export function bulkSelect(host, { idOf, actions, label = 'selected' }) {
  const selected = new Set();

  const bar = document.createElement('div');
  bar.className = 'adm-bulk';
  host.parentElement.insertBefore(bar, host);

  const rows = () => qsa('[data-bulk-row]', host);

  function drawBar() {
    if (!selected.size) { bar.classList.remove('adm-bulk--in'); bar.innerHTML = ''; return; }
    bar.innerHTML = `
      <span class="adm-bulk__count">${selected.size} ${esc(label)}</span>
      <span class="adm-bulk__actions">
        ${actions.map((a, i) => `<button class="btn btn--pill${a.danger ? ' btn--danger' : ''}" data-bulk-act="${i}">${esc(a.label)}</button>`).join('')}
        <button class="btn btn--pill" data-bulk-clear>Clear</button>
      </span>`;
    bar.classList.add('adm-bulk--in');
    qsa('[data-bulk-act]', bar).forEach((btn) => btn.addEventListener('click', async () => {
      const action = actions[Number(btn.dataset.bulkAct)];
      const ids = [...selected];
      await action.run(ids);
      selected.clear();
      drawBar();
    }));
    qs('[data-bulk-clear]', bar).addEventListener('click', () => {
      selected.clear();
      rows().forEach((r) => r.classList.remove('adm-row--picked'));
      qsa('[data-bulk-box]', host).forEach((b) => b.setAttribute('aria-checked', 'false'));
      drawBar();
    });
  }

  function attach() {
    rows().forEach((row) => {
      const id = idOf(row);
      const box = qs('[data-bulk-box]', row);
      if (!box) return;
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        const on = !selected.has(id);
        if (on) selected.add(id); else selected.delete(id);
        box.setAttribute('aria-checked', String(on));
        row.classList.toggle('adm-row--picked', on);
        drawBar();
      });
    });
  }

  attach();
  return { attach, clear: () => { selected.clear(); drawBar(); }, get size() { return selected.size; } };
}

export function checkbox() {
  return `<button class="adm-check" data-bulk-box role="checkbox" aria-checked="false" aria-label="Select"></button>`;
}

// ------------------------------------------------------------ misc
// A confirm that makes you type the word — reserved for the handful of
// actions that destroy other people's data and can't be undone.
export function typeToConfirm({ title, sub, word, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__header"><h2>${esc(title)}</h2></div>
        <div class="adm-sheet-body">
          ${sub ? `<p class="modal__hint">${esc(sub)}</p>` : ''}
          <p class="modal__hint">Type <b class="adm-confirm-word">${esc(word)}</b> to confirm.</p>
          <label class="field"><input id="adm-confirm-in" autocomplete="off" spellcheck="false" placeholder="${esc(word)}"></label>
          <div class="adm-btn-row">
            <button class="btn" data-act="cancel">Cancel</button>
            <button class="btn btn--danger" data-act="ok" disabled>${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = qs('#adm-confirm-in', overlay);
    const ok = qs('[data-act="ok"]', overlay);
    input.addEventListener('input', () => {
      ok.disabled = input.value.trim().toLowerCase() !== word.toLowerCase();
    });
    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.dataset.act === 'cancel') close(false);
      if (e.target.dataset.act === 'ok' && !ok.disabled) close(true);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ok.disabled) close(true); });
    requestAnimationFrame(() => input.focus());
  });
}

// Absolute time on hover/long-press, relative time in the label — the
// relative one is what you scan, the absolute one is what you need when
// something looks wrong.
export function timeTitle(iso) {
  if (!iso) return '';
  try { return ` title="${esc(new Date(iso).toLocaleString())}"`; } catch { return ''; }
}

// A connection watcher. The admin app writes straight to production, so
// silently failing writes while offline is worse here than in the app.
export function wireConnectionBanner() {
  const bar = document.createElement('div');
  bar.className = 'adm-offline';
  bar.textContent = 'Offline — changes will fail until the connection is back';
  document.body.appendChild(bar);
  const sync = () => bar.classList.toggle('adm-offline--in', !navigator.onLine);
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}
