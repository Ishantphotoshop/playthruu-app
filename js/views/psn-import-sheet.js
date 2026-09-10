import * as api from '../api.js';
import { state } from '../state.js';
import { esc, toast, qs, qsa, enableSwipeToDismiss } from '../utils.js';
import { posterFrame } from '../components.js';

// The review step between connecting a PlayStation account and anything
// landing in the diary. Finished games come pre-ticked, since those are
// the ones trophies actually prove; everything else is offered unticked
// as Playing or Backlog, never as "played" — a completion the player
// didn't earn is the one thing this must never invent.
export function openPsnImportSheet({ candidates, onDone = () => {} }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const finished = candidates.filter((c) => c.completed);
  const rest = candidates.filter((c) => !c.completed);
  const picked = new Set(finished.map((c) => c.importedGameId));

  function close() {
    overlay.remove();
    document.body.style.overflow = '';
  }

  const STATUS_LABEL = { played: 'Finished', playing: 'Playing', backlog: 'Backlog' };

  function row(c) {
    const bits = [];
    if (c.completed && c.playedDate) bits.push(esc(c.playedDate));
    if (c.hours) bits.push(`${c.hours}h`);
    if (!c.completed) bits.push(STATUS_LABEL[c.status]);
    return `
      <label class="psn-pick" data-id="${esc(c.importedGameId)}">
        <input type="checkbox" class="psn-pick__box" ${picked.has(c.importedGameId) ? 'checked' : ''}>
        ${posterFrame(c.coverUrl, c.title, 'psn-pick__cover')}
        <span class="psn-pick__meta">
          <b class="psn-pick__title">${esc(c.title)}</b>
          <span class="psn-pick__sub">${bits.join(' · ')}</span>
        </span>
      </label>`;
  }

  function syncApplyBtn() {
    applyBtn.textContent = picked.size ? `Add ${picked.size} to diary` : 'Add to diary';
    applyBtn.disabled = picked.size === 0;
  }

  overlay.innerHTML = `
    <div class="modal modal--tall psn-sheet">
      <header class="psn-sheet__head">
        <button class="modal__close" data-close aria-label="Close">&times;</button>
        <h2 class="psn-sheet__title">What should go in your diary?</h2>
        <p class="psn-sheet__hint">${finished.length
          ? "Finished games are ticked already. Untick anything you'd rather leave out."
          : 'Nothing new was finished since last time. Tick anything you want in anyway.'}</p>
      </header>
      <div class="modal__body psn-sheet__body">
        ${finished.length ? `
          <p class="psn-sheet__group">Finished <span>${finished.length}</span></p>
          <div class="psn-sheet__list" data-group="finished">${finished.map(row).join('')}</div>` : ''}
        ${rest.length ? `
          <p class="psn-sheet__group">Played, not finished <span>${rest.length}</span></p>
          <p class="psn-sheet__note">No trophy says these were finished, so they'd be added as Playing or Backlog — never as finished.</p>
          <div class="psn-sheet__list" data-group="rest">${rest.map(row).join('')}</div>` : ''}
      </div>
      <footer class="psn-sheet__foot">
        <button type="button" class="btn btn--ghost" data-close>Skip</button>
        <button type="button" class="btn btn--accent" id="psn-apply">Add to diary</button>
      </footer>
    </div>`;

  const applyBtn = qs('#psn-apply', overlay);
  const byId = new Map(candidates.map((c) => [c.importedGameId, c]));
  syncApplyBtn();

  qsa('.psn-pick__box', overlay).forEach((box) => {
    box.addEventListener('change', () => {
      const id = box.closest('.psn-pick').dataset.id;
      if (box.checked) picked.add(id); else picked.delete(id);
      syncApplyBtn();
    });
  });

  qsa('[data-close]', overlay).forEach((b) => b.addEventListener('click', () => { close(); onDone({ logged: 0 }); }));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); onDone({ logged: 0 }); } });
  enableSwipeToDismiss(qs('.modal', overlay), () => { close(); onDone({ logged: 0 }); });

  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Adding…';
    try {
      const chosen = [...picked].map((id) => byId.get(id)).filter(Boolean);
      const result = await api.applyPsnDiaryPicks(state.user.id, chosen, candidates);
      close();
      onDone(result);
    } catch (err) {
      toast(err.message || 'Could not add those.', 'error');
      syncApplyBtn();
    }
  });
}
