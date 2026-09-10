import * as api from '../api.js';
import { state } from '../state.js';
import { esc, toast, qs, qsa, enableSwipeToDismiss } from '../utils.js';
import { posterFrame } from '../components.js';

// The review step between connecting a PlayStation account and anything
// landing in the diary. Everything ticked is logged as played, full
// stop — the import no longer invents a status of its own, which is what
// used to drop untouched games into "Currently playing". Trophies only
// decide what starts ticked; the person decides the rest.
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

  function hoursLabel(c) {
    if (!c.hours) return null;
    return c.hours < 1 ? `${Math.round(c.hours * 60)}m` : `${c.hours}h`;
  }

  function row(c) {
    const meta = [c.platform, hoursLabel(c), c.completed && c.playedDate ? c.playedDate : null].filter(Boolean);
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
      </div>`;
  }

  overlay.innerHTML = `
    <div class="modal modal--tall psn-sheet">
      <header class="psn-sheet__head">
        <button class="modal__close" data-close aria-label="Close">&times;</button>
        <h2 class="psn-sheet__title">Which games have you finished?</h2>
        <p class="psn-sheet__hint">Everything you tick is added to your diary as played, so tick only the games you actually finished.${finished.length ? ' The ones your trophies already prove are ticked for you.' : ''}</p>
      </header>
      <div class="modal__body psn-sheet__body">
        ${finished.length ? `
          <p class="psn-sheet__group">Finished <span>${finished.length}</span></p>
          <div class="psn-sheet__list" data-group="finished">${finished.map(row).join('')}</div>` : ''}
        ${rest.length ? `
          <p class="psn-sheet__group">Played, not finished <span>${rest.length}</span></p>
          <p class="psn-sheet__note">No trophy says you reached the end of these — tick any you did finish.</p>
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
    // The whole row is the target, not just the 23px tick.
    el.addEventListener('click', () => {
      const on = !picked.has(id);
      if (on) picked.add(id); else picked.delete(id);
      el.classList.toggle('is-picked', on);
      tick.setAttribute('aria-checked', String(on));
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
