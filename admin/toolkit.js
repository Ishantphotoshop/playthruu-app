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

// ------------------------------------------------------------ finder
// One place to jump to a screen, run an action, or find a person or a game.
// The caller supplies the pages/actions (`commands`) and the two async
// lookups; this owns the box, the keyboard and the grouping.
let finderOpen = false;

export function openFinder({ commands, searchPeople, searchGames, recents = () => [] }) {
  if (finderOpen) return;
  finderOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'adm-palette';
  overlay.innerHTML = `
    <div class="adm-palette__box" role="dialog" aria-label="Search">
      <div class="adm-palette__bar">
        <input class="adm-palette__input" type="search" placeholder="Search people, games, or jump to…"
               autocomplete="off" spellcheck="false" enterkeyhint="go" aria-label="Search">
        <button class="adm-palette__cancel" type="button">Cancel</button>
      </div>
      <div class="adm-palette__list" role="listbox"></div>
    </div>`;
  document.body.appendChild(overlay);

  const input = qs('.adm-palette__input', overlay);
  const list = qs('.adm-palette__list', overlay);
  let sections = [];       // [{ title, entries: [{...}] }]
  let flat = [];
  let active = 0;
  let token = 0;
  let timer = null;
  let remote = { people: null, games: null }; // null = still loading

  const close = () => {
    finderOpen = false;
    clearTimeout(timer);
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };

  // Subsequence match, so "tg" finds "Trending games" the way an editor's
  // fuzzy open does.
  const score = (cmd, q) => {
    const hay = `${cmd.title} ${cmd.hint || ''}`.toLowerCase();
    if (!q) return 0;
    if (hay.startsWith(q)) return 3;
    if (hay.includes(q)) return 2;
    let i = 0;
    for (const ch of q) { i = hay.indexOf(ch, i); if (i === -1) return -1; i += 1; }
    return 1;
  };

  const entryHtml = (e) => `
    <button class="adm-palette__item${flat.indexOf(e) === active ? ' adm-palette__item--active' : ''}" role="option" data-n="${flat.indexOf(e)}">
      <span class="adm-palette__lead">${e.lead || ''}</span>
      <span class="adm-palette__label">
        <span class="adm-palette__title">${esc(e.title)}</span>
        ${e.hint ? `<span class="adm-palette__hint">${esc(e.hint)}</span>` : ''}
      </span>
      ${e.badge ? `<span class="adm-palette__badge">${esc(e.badge)}</span>` : ''}
    </button>`;

  const draw = () => {
    flat = sections.flatMap((x) => x.entries);
    if (active >= flat.length) active = Math.max(0, flat.length - 1);
    const q = input.value.trim();
    const loading = q.length >= 2 && (remote.people === null || remote.games === null);
    list.innerHTML = (sections.length
      ? sections.map((sec) => `<div class="adm-palette__sec">${esc(sec.title)}</div>${sec.entries.map(entryHtml).join('')}`).join('')
      : '') + (loading ? '<p class="adm-palette__none">Searching…</p>' : '')
      + (!flat.length && !loading ? `<p class="adm-palette__none">${q ? 'Nothing matches that.' : ''}</p>` : '');
    qsa('.adm-palette__item', list).forEach((btn) => {
      btn.addEventListener('click', () => run(Number(btn.dataset.n)));
      btn.addEventListener('mousemove', () => {
        const n = Number(btn.dataset.n);
        if (n === active) return;
        qs('.adm-palette__item--active', list)?.classList.remove('adm-palette__item--active');
        active = n; btn.classList.add('adm-palette__item--active');
      });
    });
    qs('.adm-palette__item--active', list)?.scrollIntoView({ block: 'nearest' });
  };

  const run = (n) => {
    const e = flat[n];
    if (!e) return;
    close();
    e.run();
  };

  const rebuild = () => {
    const q = input.value.trim().toLowerCase();
    const cmds = commands
      .map((c) => ({ c, s: score(c, q) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c)
      .slice(0, q ? 5 : 20);
    sections = [];
    if (!q) { const rec = recents(); if (rec.length) sections.push({ title: 'Recent', entries: rec }); }
    if (remote.people?.length) sections.push({ title: 'People', entries: remote.people });
    if (remote.games?.length) sections.push({ title: 'Games', entries: remote.games });
    if (cmds.length) sections.push({ title: q ? 'Go to' : 'Jump to', entries: cmds });
    active = 0;
    draw();
  };

  const onType = () => {
    const q = input.value.trim();
    clearTimeout(timer);
    const mine = ++token;
    if (q.length < 2) { remote = { people: [], games: [] }; rebuild(); return; }
    remote = { people: null, games: null };
    rebuild();
    timer = setTimeout(async () => {
      const [people, games] = await Promise.all([
        searchPeople(q).catch(() => []),
        searchGames(q).catch(() => []),
      ]);
      if (mine !== token) return;
      remote = { people, games };
      rebuild();
    }, 220);
  };

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(flat.length - 1, active + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  }

  input.addEventListener('input', onType);
  qs('.adm-palette__cancel', overlay).addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  remote = { people: [], games: [] };
  rebuild();
  requestAnimationFrame(() => input.focus());
}

// ------------------------------------------------------------ bulk select
// A list gets a small bar ("48 people  [Select]"). Select turns on tick
// boxes (and makes tapping a row tick it instead of opening it); a dock
// with the caller's actions floats above the tab bar while anything is
// ticked. The caller owns what the actions do; this owns the selection.
const SINGULAR = { people: 'person', stories: 'story', 'comments': 'comment' };
const noun = (label, n) => {
  if (n !== 1) return label;
  const [first, ...rest] = String(label).split(' ');
  const one = SINGULAR[first] || (first.endsWith('s') ? first.slice(0, -1) : first);
  return [one, ...rest].join(' ');
};

export function bulkSelect(host, { idOf, actions, label = 'items' }) {
  // Lists repaint, and each repaint calls this again on the same host. The
  // host remembers its instance so a repeat call just re-syncs the rows.
  if (host.__bulk) { host.__bulk.actions = actions; host.__bulk.label = label; host.__bulk.attach(); return host.__bulk; }

  const selected = new Set();
  let mode = false;
  const inst = { actions, label };
  host.__bulk = inst;

  const bar = document.createElement('div');
  bar.className = 'adm-listbar';
  host.parentElement.insertBefore(bar, host);

  const dock = document.createElement('div');
  dock.className = 'adm-dock';
  (host.closest('.adm-page') || document.body).appendChild(dock);

  const rows = () => qsa('[data-bulk-row]', host);
  const pickable = () => rows().filter((r) => qs('[data-bulk-box]', r));

  function setRow(row, on) {
    const id = idOf(row);
    if (on) selected.add(id); else selected.delete(id);
    qs('[data-bulk-box]', row)?.setAttribute('aria-checked', String(on));
    row.classList.toggle('adm-item--picked', on);
  }

  function setMode(on) {
    mode = on;
    host.classList.toggle('adm-selecting', on);
    if (!on) { selected.clear(); rows().forEach((r) => setRow(r, false)); }
    draw();
  }

  function draw() {
    const total = pickable().length;
    if (!total) { bar.innerHTML = ''; bar.hidden = true; dock.classList.remove('adm-dock--in'); return; }
    bar.hidden = false;
    if (!mode) {
      bar.innerHTML = `<span class="adm-listbar__count">${total} ${esc(noun(inst.label, total))}</span>
        <button class="adm-listbar__btn" data-bulk-enter>Select</button>`;
    } else {
      bar.innerHTML = `<span class="adm-listbar__count adm-listbar__count--on">${selected.size} selected</span>
        <span class="adm-listbar__right">
          <button class="adm-listbar__btn" data-bulk-all>${selected.size >= total ? 'None' : 'All'}</button>
          <button class="adm-listbar__btn adm-listbar__btn--solid" data-bulk-exit>Done</button>
        </span>`;
    }
    qs('[data-bulk-enter]', bar)?.addEventListener('click', () => setMode(true));
    qs('[data-bulk-exit]', bar)?.addEventListener('click', () => setMode(false));
    qs('[data-bulk-all]', bar)?.addEventListener('click', () => {
      const all = selected.size >= total;
      pickable().forEach((r) => setRow(r, !all));
      draw();
    });

    const show = mode && selected.size > 0;
    dock.classList.toggle('adm-dock--in', show);
    dock.innerHTML = show ? `<span class="adm-dock__count">${selected.size}</span>
      ${inst.actions.map((a, i) => `<button class="adm-dock__btn${a.danger ? ' adm-dock__btn--danger' : ''}" data-bulk-act="${i}">${esc(a.label)}</button>`).join('')}` : '';
    qsa('[data-bulk-act]', dock).forEach((btn) => btn.addEventListener('click', async () => {
      const action = inst.actions[Number(btn.dataset.bulkAct)];
      const ids = [...selected];
      await action.run(ids);
      setMode(false);
    }));
  }

  // In select mode a tap on a row ticks it; the row's own open handler never sees it.
  host.addEventListener('click', (e) => {
    if (!mode) return;
    const row = e.target.closest('[data-bulk-row]');
    if (!row || e.target.closest('[data-bulk-box]')) return;
    e.preventDefault();
    e.stopPropagation();
    setRow(row, !selected.has(idOf(row)));
    draw();
  }, true);

  inst.attach = () => {
    const present = new Set(rows().map(idOf));
    [...selected].forEach((id) => { if (!present.has(id)) selected.delete(id); });
    rows().forEach((row) => {
      const box = qs('[data-bulk-box]', row);
      if (!box) return;
      if (selected.has(idOf(row))) setRow(row, true);
      if (box.dataset.wired) return;
      box.dataset.wired = '1';
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        setRow(row, !selected.has(idOf(row)));
        draw();
      });
    });
    host.classList.toggle('adm-selecting', mode);
    draw();
  };
  inst.exit = () => setMode(false);
  Object.defineProperty(inst, 'size', { get: () => selected.size });

  inst.attach();
  return inst;
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
