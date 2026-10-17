import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, confirmSheet, posterFrame, avatarImg, iconPlus, iconClose, iconChevronUp, iconChevronDown, iconDotsMenu, iconHeartFilled, combinedGameResultsList, wireCombinedGameResults } from '../components.js';
import { esc, qs, qsa, toast, debounce, enableSwipeToDismiss, promptSignIn, starRow } from '../utils.js';
import { navigate } from '../router.js';

// Creating a list used to only be reachable from the dedicated Lists tab.
// That tab is gone now (see profile-view.js's own Lists tab, and the
// nav change in components.js that gave its bottom-nav slot to
// Messages) — lists themselves weren't removed, just relocated to where
// they were already shown. Extracted so the profile Lists tab's own
// "+ New list" button can reuse this instead of duplicating it.
export function openNewListForm() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal nl">
      <div class="nl__grab" aria-hidden="true"></div>
      <header class="nl__head"><h2>New list</h2><button class="modal__close" data-close aria-label="Close">&times;</button></header>
      <form class="nl__form" id="new-list-form">
        <input class="nl__name" name="name" required maxlength="80" placeholder="List name" autocomplete="off">
        <textarea class="nl__desc" name="description" rows="3" maxlength="300" placeholder="What ties these games together? (optional)"></textarea>
        <button type="submit" class="btn btn--accent nl__go">Create list</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  qs('[data-close]', overlay).addEventListener('click', () => overlay.remove());
  enableSwipeToDismiss(qs('.modal', overlay), () => overlay.remove());
  qs('#new-list-form', overlay).addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.is_public = true; // everything on PlayThruu is public
    try {
      const list = await api.createList(state.user.id, data);
      overlay.remove();
      navigate(`/list/${list.id}`);
    } catch (err) {
      toast(err.message || 'Could not create list.', 'error');
    }
  });
}

const LD_FILTER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';
const LD_GRID_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></svg>';
const LD_ROWS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>';
const LD_PLAYED_ICON = '<svg viewBox="2.5 2 19 19.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14a1.5 1.5 0 0 1 1.5 1.5V20.5h-17V18.5A1.5 1.5 0 0 1 5 17z"/><path d="M12 9v8"/><circle cx="12" cy="6" r="3"/></svg>';
const LD_SORTS = [['order', 'List order'], ['year', 'Release date'], ['az', 'A to Z'], ['rating', 'Your rating']];

// A small menu that drops under a top-bar button and closes on any outside tap.
function popMenu(anchor, entries) {
  qs('.ld-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'ld-pop';
  pop.innerHTML = entries.map((e, i) => `<button type="button" class="ld-pop__item${e.on ? ' ld-pop__item--on' : ''}${e.danger ? ' ld-pop__item--danger' : ''}" data-i="${i}">${esc(e.label)}</button>`).join('');
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', onOut, true); };
  const onOut = (ev) => { if (!pop.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', onOut, true), 0);
  pop.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-i]');
    if (!btn) return;
    close();
    entries[Number(btn.dataset.i)].run();
  });
}

export async function renderListDetailView(root, { id }) {
  const topRight = `<button type="button" class="icon-btn ld-top" id="ld-filter" aria-label="Sort">${LD_FILTER_ICON}</button><button type="button" class="icon-btn ld-top" id="ld-more" aria-label="More">${iconDotsMenu()}</button>`;
  root.innerHTML = topBar('List', { back: true, right: topRight }) + `<div class="view-body" id="list-body">${spinner()}</div>` + navBar('');
  const body = qs('#list-body', root);

  try {
    const [list, itemRows] = await Promise.all([api.getList(id), api.getListItems(id)]);
    let items = itemRows;
    const isOwn = state.user && list.user_id === state.user.id;
    let mode = 'rows', sort = 'order', editing = false;

    // Your own rating, heart and played mark for each game, shown beside it like on a film list.
    const mine = new Map();
    if (state.user) {
      try {
        const logs = await api.getLogsForUser(state.user.id, { limit: 5000 });
        for (const l of logs) {
          const e = mine.get(l.game_id) || { rating: 0, loved: false, played: false };
          e.rating = Math.max(e.rating, Number(l.rating) || 0);
          e.loved = e.loved || !!l.loved;
          e.played = e.played || l.status === 'played' || l.status === 'dropped';
          mine.set(l.game_id, e);
        }
      } catch { /* the marks are a bonus; the list still shows without them */ }
    }

    const sorted = () => {
      const arr = items.map((it, idx) => ({ it, idx }));
      const g = (x) => x.it.games;
      if (sort === 'year') arr.sort((a, b) => (g(b).release_year || 0) - (g(a).release_year || 0));
      else if (sort === 'az') arr.sort((a, b) => (g(a).title || '').localeCompare(g(b).title || ''));
      else if (sort === 'rating') arr.sort((a, b) => (mine.get(g(b).id)?.rating || 0) - (mine.get(g(a).id)?.rating || 0));
      return arr;
    };

    const rowHtml = ({ it, idx }) => {
      const g = it.games;
      const m = mine.get(g.id);
      const marks = m && (m.rating || m.loved)
        ? `<div class="ld-marks">${m.rating ? starRow(m.rating, { size: 13 }) : ''}${m.loved ? `<span class="ld-heart">${iconHeartFilled()}</span>` : ''}</div>` : '';
      return `
        <div class="ld-row ranked-row" data-game-id="${g.id}">
          <a href="#/game/${g.id}" class="ld-row__link">
            ${posterFrame(g.cover_url, g.title, 'ld-row__cover')}
            <div class="ld-row__info">
              <div class="ld-row__title">${esc(g.title)}${g.release_year ? ` <em>${esc(String(g.release_year))}</em>` : ''}</div>
              ${marks}
            </div>
          </a>
          ${editing ? `
            <div class="ranked-row__controls">
              <button type="button" class="ranked-row__move" data-dir="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">${iconChevronUp()}</button>
              <button type="button" class="ranked-row__move" data-dir="down" data-idx="${idx}" ${idx === items.length - 1 ? 'disabled' : ''} aria-label="Move down">${iconChevronDown()}</button>
              <button type="button" class="ranked-row__remove" data-idx="${idx}" aria-label="Remove from list">${iconClose()}</button>
            </div>` : ''}
        </div>`;
    };
    const gridHtml = ({ it }) => `<a href="#/game/${it.games.id}" class="ld-cell">${posterFrame(it.games.cover_url, it.games.title, 'ld-cell__cover')}</a>`;

    function paint() {
      const played = state.user ? items.filter((it) => mine.get(it.games.id)?.played).length : 0;
      const pct = items.length ? Math.round((played / items.length) * 100) : 0;
      const who = list.profiles;
      body.innerHTML = `
        <div class="ld-owner">
          <a href="#/profile/${esc(who.username)}" class="ld-owner__who">${avatarImg(who, 30)}<span>${esc(who.display_name || who.username)}</span></a>
          <button type="button" class="icon-btn ld-top" id="ld-mode" aria-label="${mode === 'rows' ? 'Show as grid' : 'Show as list'}">${mode === 'rows' ? LD_GRID_ICON : LD_ROWS_ICON}</button>
        </div>
        <h1 class="ld-title">${esc(list.name)}</h1>
        ${list.description ? `<p class="ld-desc">${esc(list.description)}</p>` : ''}
        <div class="ld-sub">
          <span>${items.length} game${items.length === 1 ? '' : 's'}</span>
          ${state.user && items.length ? `<span class="ld-pct">${LD_PLAYED_ICON}${pct}%</span>` : ''}
        </div>
        <div id="list-items-slot">${!items.length ? emptyState('No games in this list yet.')
          : mode === 'grid' ? `<div class="ld-grid">${sorted().map(gridHtml).join('')}</div>`
          : `<div class="ld-rows">${sorted().map(rowHtml).join('')}</div>`}</div>
      `;
      qs('#ld-mode', body).addEventListener('click', () => { mode = mode === 'rows' ? 'grid' : 'rows'; paint(); });
      if (isOwn && editing) wireRanking();
    }

    qs('#ld-filter', root).addEventListener('click', (e) => {
      popMenu(e.currentTarget, LD_SORTS.map(([k, label]) => ({ label, on: sort === k, run: () => { sort = k; if (editing && k !== 'order') editing = false; paint(); } })));
    });
    qs('#ld-more', root).addEventListener('click', (e) => {
      const entries = [];
      if (isOwn) {
        entries.push({ label: editing ? 'Done editing' : 'Edit list', run: () => { editing = !editing; if (editing) { sort = 'order'; mode = 'rows'; } paint(); } });
        entries.push({ label: 'Add a game', run: () => openAddGameForm() });
      }
      entries.push({ label: 'Share', run: async () => {
        const url = `${location.origin}${location.pathname}#/list/${id}`;
        if (navigator.share) { try { await navigator.share({ title: list.name, url }); } catch { /* cancelled */ } return; }
        try { await navigator.clipboard.writeText(url); toast('Link copied.', 'success'); } catch { toast(url); }
      } });
      if (isOwn) entries.push({ label: 'Delete list', danger: true, run: async () => {
        if (!(await confirmSheet({ title: 'Delete this list?', message: "This can't be undone.", confirmLabel: 'Delete', danger: true }))) return;
        try { await api.deleteList(id); navigate(`/profile/${list.profiles.username}`); }
        catch (err) { toast(err.message || 'Could not delete list.', 'error'); }
      } });
      popMenu(e.currentTarget, entries);
    });

    // Reorder/remove act on the in-memory `items` array first (so the
    // UI updates instantly) and persist after — if the save fails, the
    // list is reloaded from the server so it can't drift out of sync.
    function wireRanking() {
      const slot = qs('#list-items-slot', body);
      qsa('.ranked-row__move', slot).forEach((btn) => {
        btn.addEventListener('click', async () => {
          const i = Number(btn.dataset.idx);
          const j = btn.dataset.dir === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= items.length) return;
          [items[i], items[j]] = [items[j], items[i]];
          paint();
          try {
            await api.reorderListItems(id, items.map((it) => it.games.id));
          } catch (err) {
            toast(err.message || 'Could not save the new order.', 'error');
            items = await api.getListItems(id);
            paint();
          }
        });
      });
      qsa('.ranked-row__remove', slot).forEach((btn) => {
        btn.addEventListener('click', async () => {
          const i = Number(btn.dataset.idx);
          const removed = items[i];
          items = items.filter((_, idx) => idx !== i);
          paint();
          try {
            await api.removeGameFromList(id, removed.games.id);
            await api.reorderListItems(id, items.map((it) => it.games.id));
          } catch (err) {
            toast(err.message || 'Could not remove that game.', 'error');
            items = await api.getListItems(id);
            paint();
          }
        });
      });
    }

    function openAddGameForm() {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <header class="modal__header"><h2>Add a game</h2><button class="modal__close" data-close>&times;</button></header>
          <div class="modal__body">
            <label class="field"><span>Search</span><input type="text" id="add-game-search" placeholder="Search for a game…" autocomplete="off"></label>
            <div id="add-game-results"></div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      qs('[data-close]', overlay).addEventListener('click', () => overlay.remove());
      enableSwipeToDismiss(qs('.modal', overlay), () => overlay.remove());

      const resultsEl = qs('#add-game-results', overlay);
      const existingIds = new Set(items.map((it) => it.games.id));

      const runSearch = debounce(async () => {
        const query = qs('#add-game-search', overlay).value.trim();
        if (!query) { resultsEl.innerHTML = ''; return; }
        resultsEl.innerHTML = spinner();
        try {
          const { results: found } = await api.searchGamesEverywhere(query);
          // Only local games carry an id that could already be in the
          // list; remote ones aren't saved yet, so they pass through.
          const filtered = found.filter((g) => !existingIds.has(g.id));
          resultsEl.innerHTML = combinedGameResultsList(filtered);
          wireCombinedGameResults(resultsEl, filtered, {
            onLocal: async (g) => { await addAndClose(g.id); },
            onRemote: async (g) => {
              const saved = await api.addGame(g, state.user.id);
              await addAndClose(saved.id);
            },
          });
        } catch (err) {
          resultsEl.innerHTML = `<p class="muted">Couldn't search right now: ${esc(err.message)}</p>`;
        }
      }, 400);

      async function addAndClose(gameId) {
        try {
          await api.addGameToList(id, gameId, items.length);
          overlay.remove();
          items = await api.getListItems(id);
          paint();
          toast('Added to list.', 'success');
        } catch (err) {
          toast(err.message || 'Could not add that game.', 'error');
        }
      }

      qs('#add-game-search', overlay).addEventListener('input', runSearch);
    }

    paint();
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this list: ${esc(err.message)}</p>`;
  }
}

// A game's own "Add to list" button (on its page, and in the log sheet)
// used to just tell people to go add it from the Lists tab themselves —
// a real dead end for an affordance that looks fully wired up. This
// reuses the same "pick a list" pattern as the list-detail page's own
// add-game flow, just inverted: pick the LIST here, the game is already
// fixed. Picking a list the game is already in surfaces Postgres's own
// duplicate-key error rather than pre-checking membership, since none of
// the callers have the target list's items loaded yet.
export function openAddToListPicker(game) {
  if (!state.user) { promptSignIn('Sign in to add this to a list.'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <header class="modal__header"><h2>Add to list</h2><button class="modal__close" data-close aria-label="Close">${iconClose()}</button></header>
      <div class="modal__body" id="pick-list-body">${spinner()}</div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  qs('[data-close]', overlay).addEventListener('click', close);
  enableSwipeToDismiss(qs('.modal', overlay), close);

  const bodyEl = qs('#pick-list-body', overlay);

  async function paintLists() {
    try {
      const lists = await api.getListsForUser(state.user.id);
      bodyEl.innerHTML = `
        ${lists.length ? `<div class="pick-list">
          ${lists.map((l) => {
            const count = (l.list_items || []).length;
            return `
              <button type="button" class="pick-list__row" data-list-id="${esc(l.id)}">
                <span class="pick-list__name">${esc(l.name)}</span>
                <span class="pick-list__count muted">${count} game${count === 1 ? '' : 's'}</span>
              </button>`;
          }).join('')}
        </div>` : `<p class="muted" style="padding:4px 0 16px">You don't have any lists yet.</p>`}
        <button type="button" class="btn btn--ghost btn--block" id="pick-new-list">+ New list</button>`;

      qsa('[data-list-id]', bodyEl).forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const list = lists.find((l) => l.id === btn.dataset.listId);
          try {
            await api.addGameToList(list.id, game.id, (list.list_items || []).length);
            close();
            toast(`Added to "${list.name}".`, 'success');
          } catch (err) {
            btn.disabled = false;
            const dup = /duplicate|already exists/i.test(err.message || '');
            toast(dup ? 'Already in that list.' : (err.message || 'Could not add to that list.'), 'error');
          }
        });
      });
      qs('#pick-new-list', bodyEl).addEventListener('click', paintNewListForm);
    } catch (err) {
      bodyEl.innerHTML = `<p class="muted">Couldn't load your lists: ${esc(err.message)}</p>`;
    }
  }

  function paintNewListForm() {
    bodyEl.innerHTML = `
      <form id="pick-new-list-form">
        <label class="field"><span>Name *</span><input name="name" required placeholder="Best cozy games"></label>
        <button type="submit" class="btn btn--accent btn--block">Create &amp; add</button>
      </form>`;
    qs('input[name="name"]', bodyEl)?.focus();
    qs('#pick-new-list-form', bodyEl).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = qs('button[type="submit"]', e.target);
      btn.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(e.target));
        data.is_public = true;
        const list = await api.createList(state.user.id, data);
        await api.addGameToList(list.id, game.id, 0);
        close();
        toast(`Added to "${list.name}".`, 'success');
      } catch (err) {
        btn.disabled = false;
        toast(err.message || 'Could not create that list.', 'error');
      }
    });
  }

  paintLists();
}
