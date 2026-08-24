import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, rankedList, iconPlus, iconClose, combinedGameResultsList, wireCombinedGameResults } from '../components.js';
import { esc, qs, qsa, toast, debounce, enableSwipeToDismiss, promptSignIn } from '../utils.js';
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
    <div class="modal">
      <header class="modal__header"><h2>New list</h2><button class="modal__close" data-close>&times;</button></header>
      <form class="modal__body" id="new-list-form">
        <label class="field"><span>Name *</span><input name="name" required placeholder="Best cozy games"></label>
        <label class="field"><span>Description</span><textarea name="description" rows="2" placeholder="What ties this list together?"></textarea></label>
        <label class="checkbox"><input type="checkbox" name="is_public" checked> Public</label>
        <button type="submit" class="btn btn--accent btn--block">Create list</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  qs('[data-close]', overlay).addEventListener('click', () => overlay.remove());
  enableSwipeToDismiss(qs('.modal', overlay), () => overlay.remove());
  qs('#new-list-form', overlay).addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.is_public = e.target.is_public.checked;
    try {
      const list = await api.createList(state.user.id, data);
      overlay.remove();
      navigate(`/list/${list.id}`);
    } catch (err) {
      toast(err.message || 'Could not create list.', 'error');
    }
  });
}

export async function renderListDetailView(root, { id }) {
  root.innerHTML = topBar('List', { back: true }) + `<div class="view-body" id="list-body">${spinner()}</div>` + navBar('');
  const body = qs('#list-body', root);

  try {
    const [list, itemRows] = await Promise.all([api.getList(id), api.getListItems(id)]);
    let items = itemRows;
    const isOwn = state.user && list.user_id === state.user.id;

    function paint() {
      body.innerHTML = `
        <div class="list-detail__head">
          <div class="list-detail__head-row">
            <div>
              <h1>${esc(list.name)}</h1>
              ${list.description ? `<p class="muted">${esc(list.description)}</p>` : ''}
              <p class="muted">by <a href="#/profile/${esc(list.profiles.username)}">@${esc(list.profiles.username)}</a> · ${items.length} game${items.length === 1 ? '' : 's'}</p>
            </div>
            ${isOwn ? `<button type="button" class="icon-btn" id="add-game-btn" aria-label="Add game to list">${iconPlus()}</button>` : ''}
          </div>
          ${isOwn ? `<button class="btn btn--danger" id="delete-list">Delete list</button>` : ''}
        </div>
        <div id="list-items-slot">${rankedList(items, { isOwn })}</div>
      `;

      if (isOwn) {
        qs('#add-game-btn', body).addEventListener('click', () => openAddGameForm());
        qs('#delete-list', body).addEventListener('click', async () => {
          if (!confirm('Delete this list? This can\'t be undone.')) return;
          try {
            await api.deleteList(id);
            navigate(`/profile/${list.profiles.username}`);
          } catch (err) {
            toast(err.message || 'Could not delete list.', 'error');
          }
        });
        wireRanking();
      }
    }

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
        <label class="checkbox"><input type="checkbox" name="is_public" checked> Public</label>
        <button type="submit" class="btn btn--accent btn--block">Create &amp; add</button>
      </form>`;
    qs('input[name="name"]', bodyEl)?.focus();
    qs('#pick-new-list-form', bodyEl).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = qs('button[type="submit"]', e.target);
      btn.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(e.target));
        data.is_public = e.target.is_public.checked;
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
