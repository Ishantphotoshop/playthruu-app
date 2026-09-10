import * as api from '../api.js';
import { state } from '../state.js';
import { esc, toast, qs, qsa, enableSwipeToDismiss } from '../utils.js';
import { posterFrame } from '../components.js';

// The review step between connecting a PlayStation account and anything
// landing in the diary. Finished games come pre-ticked, since those are
// the ones trophies actually prove. Everything else is offered unticked
// and — crucially — never as "played": claiming a completion the player
// didn't earn is the one thing this must never invent.
export function openPsnImportSheet({ candidates, onDone = () => {} }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const finished = candidates.filter((c) => c.completed);
  const rest = candidates.filter((c) => !c.completed);
  const picked = new Set(finished.map((c) => c.importedGameId));
  // Each unfinished row keeps its own status, so one blanket label can't
  // speak for a game with 74 hours on it and one with none.
  const status = new Map(candidates.map((c) => [c.importedGameId, c.status]));

  function close() {
    overlay.remove();
    document.body.style.overflow = '';
  }

  const STATUS_LABEL = { played: 'Finished', playing: 'Playing', backlog: 'Backlog' };

  function hoursLabel(c) {
    if (!c.hours) return null;
    return c.hours < 1 ? `${Math.round(c.hours * 60)}m` : `${c.hours}h`;
  }

  function row(c) {
    const meta = [c.platform, hoursLabel(c), c.completed && c.playedDate ? c.playedDate : null].filter(Boolean);
    const st = status.get(c.importedGameId);
    return `
      <div class="psn-pick${picked.has(c.importedGameId) ? ' is-picked' : ''}" data-id="${esc(c.importedGameId)}">
        <span class="psn-pick__tick" data-tick role="checkbox" aria-checked="${picked.has(c.importedGameId)}" aria-label="${esc(c.title)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </span>
        ${posterFrame(c.coverUrl, c.title, 'psn-pick__cover')}
        <div class="psn-pick__meta">
          <b class="psn-pick__title">${esc(c.title)}</b>
          <span class="psn-pick__sub">${meta.map((m) => `<span>${esc(String(m))}</span>`).join('<i>·</i>')}</span>
        </div>
        ${c.completed
          // No chip on a finished row: the section heading above it
          // already says "Finished", and repeating it on all 34 rows
          // only steals the width the game's title needs.
          ? ''
          : `<button type="button" class="psn-chip psn-chip--toggle" data-status aria-label="Change status">${STATUS_LABEL[st]}</button>`}
      </div>`;
  }

  overlay.innerHTML = `
    <div class="modal modal--tall psn-sheet">
      <header class="psn-sheet__head">
        <button class="modal__close" data-close aria-label="Close">&times;</button>
        <h2 class="psn-sheet__title">What should go in your diary?</h2>
        <p class="psn-sheet__hint">${finished.length
          ? 'The games your trophies prove you finished are ticked already.'
          : 'Nothing new was finished since last time. Tick anything you want in anyway.'}</p>
      </header>
      <div class="modal__body psn-sheet__body">
        ${finished.length ? `
          <p class="psn-sheet__group">Finished <span>${finished.length}</span></p>
          <div class="psn-sheet__list" data-group="finished">${finished.map(row).join('')}</div>` : ''}
        ${rest.length ? `
          <p class="psn-sheet__group">Played, not finished <span>${rest.length}</span></p>
          <p class="psn-sheet__note">No trophy says you reached the end of these, so they'll never be added as finished. Tap the tag on a row to switch it between Playing and Backlog.</p>
          <div class="psn-sheet__list" data-group="rest">${rest.map(row).join('')}</div>` : ''}
        <p class="psn-sheet__disclaimer">All of this is read from your trophies, so it's only ever as complete as PlayStation's own records. A game can go missing, and a remaster can be mistaken for the original — anything here can be edited or deleted afterwards.</p>
      </div>
      <footer class="psn-sheet__foot">
        <button type="button" class="btn btn--ghost" data-close>Skip</button>
        <button type="button" class="btn btn--accent" id="psn-apply">Add to diary</button>
      </footer>
    </div>`;

  const applyBtn = qs('#psn-apply', overlay);
  const byId = new Map(candidates.map((c) => [c.importedGameId, c]));

  function syncApplyBtn() {
    applyBtn.textContent = picked.size ? `Add ${picked.size} to diary` : 'Add to diary';
    applyBtn.disabled = picked.size === 0;
  }
  syncApplyBtn();

  qsa('.psn-pick', overlay).forEach((el) => {
    const id = el.dataset.id;
    const tick = qs('[data-tick]', el);
    // The whole row toggles, not just the tick — but the status tag is
    // its own control and mustn't drag the tick along with it.
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-status]')) return;
      const on = !picked.has(id);
      if (on) picked.add(id); else picked.delete(id);
      el.classList.toggle('is-picked', on);
      tick.setAttribute('aria-checked', String(on));
      syncApplyBtn();
    });
    qs('[data-status]', el)?.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = status.get(id) === 'playing' ? 'backlog' : 'playing';
      status.set(id, next);
      e.currentTarget.textContent = STATUS_LABEL[next];
    });
  });

  qsa('[data-close]', overlay).forEach((b) => b.addEventListener('click', () => { close(); onDone({ logged: 0 }); }));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); onDone({ logged: 0 }); } });
  enableSwipeToDismiss(qs('.modal', overlay), () => { close(); onDone({ logged: 0 }); });

  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Adding…';
    try {
      const chosen = [...picked]
        .map((id) => {
          const c = byId.get(id);
          return c && { ...c, status: status.get(id) || c.status };
        })
        .filter(Boolean);
      const result = await api.applyPsnDiaryPicks(state.user.id, chosen, candidates);
      close();
      onDone(result);
    } catch (err) {
      toast(err.message || 'Could not add those.', 'error');
      syncApplyBtn();
    }
  });
}
