import * as api from '../api.js';
import { state } from '../state.js';
import {
  esc, starRow, toast, qs, qsa, debounce, formatDate, enableSwipeToDismiss,
  celebrate, pulseLogTab, getRecentSearches, recordRecentSearch,
} from '../utils.js';
import {
  iconClose, iconSearch, iconChevronRight,
  combinedGameResultsList, wireCombinedGameResults, wireResultDirectors,
} from '../components.js';

// The full log entry: rating, status, the write-up and everything the
// `logs` row can carry. Replaces log-modal.js, which had grown into a
// single 550-line form with its own vocabulary — a three-across icon
// row, a scrolling hour wheel, a strip of checkboxes — none of which
// looked like anything else in the app.
//
// This is the game page's sheet in long form: the same named bands
// (Rate, Track, Review, Detail), the same pills, the same rows, the
// same star control. Two surfaces, one language, one stylesheet — the
// .lg-* classes are shared rather than duplicated.
//
//   openLogComposer()                       pick a game first, then log
//   openLogComposer({ game })               log that game
//   openLogComposer({ existingLog })        edit an entry
//   openLogComposer({ game, defaultReplay }) a fresh entry for a replay
export function openLogComposer({ game = null, existingLog = null, defaultReplay = false, onSaved = () => {} } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  let selectedGame = game || existingLog?.games || null;

  const draft = {
    status: existingLog?.status || 'played',
    rating: Number(existingLog?.rating) || 0,
    loved: !!existingLog?.loved,
    review: existingLog?.review || '',
    spoilers: !!existingLog?.contains_spoilers,
    replay: !!(existingLog?.is_replay || defaultReplay),
    isPublic: existingLog?.is_public !== false,
    played_date: existingLog?.played_date || new Date().toISOString().slice(0, 10),
    hours: existingLog?.hours_played ?? null,
  };

  function close() {
    overlay.remove();
    document.body.style.overflow = '';
  }
  // Back — the browser's, Android's, or a hashchange — tears overlays
  // down from app.js without ever calling close(), so anything a sheet
  // needs to do on the way out has to be reachable from the element
  // itself. Nothing to save here (this form commits on its own button),
  // but body scroll still has to come back.
  overlay.__dismiss = close;

  const haptics = window.Capacitor?.Plugins?.Haptics || null;
  const buzz = () => {
    if (haptics) haptics.impact({ style: 'LIGHT' }).catch(() => {});
    else { try { navigator.vibrate?.(10); } catch { /* not supported here */ } }
  };

  // ---------------------------------------------------------- the form
  function paintForm() {
    const g = selectedGame;
    const today = new Date().toISOString().slice(0, 10);

    const pill = (key, text) => `
      <button type="button" class="lg-pill${draft.status === key ? ' lg-pill--on' : ''}" data-status="${key}">${esc(text)}</button>`;

    const toggle = (key, text, note, on) => `
      <button type="button" class="lg-row lg-row--toggle" data-toggle="${key}" aria-pressed="${on}">
        <span class="lg-row__label">${esc(text)}</span>
        <!-- Always present, even when empty: the privacy row fills this
             in when it is switched off, and a span that only exists
             when it already has text can never be the one that gets
             filled. -->
        <span class="lg-row__note">${esc(note)}</span>
        <span class="lg-switch${on ? ' lg-switch--on' : ''}"><span class="lg-switch__knob"></span></span>
      </button>`;

    overlay.innerHTML = `
      <div class="modal lg-sheet lg-sheet--tall">
        <header class="lg-head">
          ${g.cover_url ? `<img class="lg-head__cover" src="${esc(g.cover_url)}" alt="">` : ''}
          <div class="lg-head__text">
            <h2 class="lg-head__title">${esc(headTitle(g))}</h2>
            ${g.release_year ? `<p class="lg-head__year">${esc(String(g.release_year))}</p>` : ''}
          </div>
          <button type="button" class="lg-x" data-act="cancel" aria-label="Close">${iconClose()}</button>
        </header>

        <div class="lg-body">
          <div class="lg-label">Rate</div>
          <div class="lg-group lg-group--rate">
            <div class="lg-rate" id="lc-rating">${starRow(draft.rating, { interactive: true, size: 32 })}</div>
            <button type="button" class="lg-love" data-act="love" aria-pressed="${draft.loved}"
                    aria-label="${draft.loved ? 'Remove from loved' : 'Mark as loved'}">
              ${draft.loved ? iconHeartSolid() : iconHeartLine()}
            </button>
          </div>

          <div class="lg-label">Track</div>
          <div class="lg-group lg-group--track">
            ${pill('played', 'Played')}
            ${pill('playing', 'Playing')}
            ${pill('backlog', 'Backlog')}
          </div>

          <div class="lg-label">Review</div>
          <div class="lg-group lg-group--review">
            <textarea class="lg-text" id="lc-review" rows="5"
              placeholder="What did you think?">${esc(draft.review)}</textarea>
            <div class="lg-count"><span id="lc-count">${countWords(draft.review)}</span></div>
          </div>
          <div class="lg-group lg-group--flush">
            ${toggle('spoilers', 'Contains spoilers', 'hidden behind a tap', draft.spoilers)}
          </div>

          <div class="lg-label">Detail</div>
          <div class="lg-group" id="lc-detail">
            <label class="lg-row lg-row--field" id="lc-date-row" ${draft.status === 'backlog' ? 'hidden' : ''}>
              <span class="lg-row__label">Played on</span>
              <span class="lg-row__note">${draft.played_date ? esc(shortDate(draft.played_date)) : 'add'}</span>
              <span class="lg-row__go">${iconChevronRight()}</span>
              <input type="date" class="lg-row__input" id="lc-date" aria-label="Date played"
                     value="${esc(draft.played_date || '')}" min="${esc(g.release_date || '')}" max="${today}">
            </label>
            <label class="lg-row lg-row--field">
              <span class="lg-row__label">Hours</span>
              <input type="number" class="lg-num" id="lc-hours" aria-label="Hours played" placeholder="add"
                     inputmode="numeric" min="0" max="20000" step="1" value="${draft.hours ?? ''}">
              <span class="lg-row__go">${iconChevronRight()}</span>
            </label>
            ${toggle('replay', 'This is a replay', '', draft.replay)}
            ${toggle('isPublic', 'Anyone can see it', draft.isPublic ? '' : 'only you', draft.isPublic)}
          </div>

          ${existingLog ? `
            <button type="button" class="lg-row lg-row--danger" data-act="delete">
              <span class="lg-row__label">Delete this entry</span>
            </button>` : ''}
        </div>

        <div class="lg-foot">
          <button type="button" class="lg-save" data-act="save">${existingLog ? 'Save changes' : 'Save entry'}</button>
        </div>
      </div>`;

    wireRating();
    enableSwipeToDismiss(qs('.modal', overlay), close);
  }

  // The rating control, identical to the game page's sheet: press
  // anywhere on the row and slide, half-star steps, a soft detent at
  // each one, and pressing the value already set clears it.
  function wireRating() {
    const picker = qs('#lc-rating', overlay);
    if (!picker) return;
    const ratingFromX = (clientX) => {
      const stars = qsa('.star', picker);
      if (!stars.length) return draft.rating;
      const first = stars[0].getBoundingClientRect();
      if (clientX < first.left + 2) return 0.5;
      let val = 0.5;
      for (const st of stars) {
        const box = st.getBoundingClientRect();
        const idx = Number(st.dataset.star);
        if (clientX >= box.right) { val = idx; continue; }
        if (clientX >= box.left) {
          val = (clientX - box.left) < box.width / 2 ? idx - 0.5 : idx;
          break;
        }
      }
      return val;
    };
    const paint = (v) => {
      if (v === draft.rating) return;
      draft.rating = v;
      picker.innerHTML = starRow(v, { interactive: true, size: 32 });
      buzz();
    };

    let dragging = false;
    picker.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { picker.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
      const at = ratingFromX(e.clientX);
      paint(at === draft.rating ? 0 : at);
      e.preventDefault();
    });
    picker.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      paint(ratingFromX(e.clientX));
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      try { picker.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    };
    picker.addEventListener('pointerup', end);
    picker.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------- the save
  async function save() {
    const g = selectedGame;

    // A game that hasn't come out can't have been played or be in
    // progress; the backlog is exactly what an unreleased game is for.
    // The full date, not just the year — an earlier version compared
    // years, so anything releasing later in the current year slipped
    // straight through.
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let unreleased = false;
    if (g.release_date) {
      const rd = new Date(g.release_date);
      unreleased = !isNaN(rd) && rd > now;
    } else if (g.release_year) {
      unreleased = Number(g.release_year) > now.getFullYear();
    }
    if (unreleased && (draft.status === 'playing' || draft.status === 'played')) {
      toast(`${g.title} isn't out yet — add it to your backlog instead.`, 'error');
      return;
    }

    const payload = {
      game_id: g.id,
      user_id: state.user.id,
      status: draft.status,
      rating: draft.rating > 0 ? draft.rating : null,
      loved: draft.loved,
      review: draft.review.trim() || null,
      // 0 means "didn't say", not "took no time".
      hours_played: draft.hours && draft.hours > 0 ? draft.hours : null,
      played_date: draft.status === 'backlog' ? null : (draft.played_date || null),
      is_replay: draft.replay,
      contains_spoilers: draft.spoilers,
      is_public: draft.isPublic,
    };

    const btn = qs('.lg-save', overlay);
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const saved = existingLog
        ? await api.updateLog(existingLog.id, payload)
        : await api.createLog(payload);
      toast(existingLog ? 'Entry updated.' : 'Logged!', 'success');
      // The tab bar is part of the shell, so its pulse is safe to fire
      // before close(). The confetti is saved for the one moment worth
      // it — a brand new "played" entry, not an edit, not a backlog —
      // and fires after, so the burst outlives the sheet.
      pulseLogTab();
      const firstPlay = !existingLog && draft.status === 'played';
      close();
      if (firstPlay) celebrate();
      onSaved({ log: saved });
    } catch (err) {
      toast(err.message || 'Could not save that entry.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = existingLog ? 'Save changes' : 'Save entry'; }
    }
  }

  // ------------------------------------------------------- the picker
  // Shown when no game came in (the + tab, the feed's empty state).
  // Deliberately the SAME list the Search tab shows — cover, title,
  // year, director — because it is the same question, and two different
  // answers to "which game do you mean" is one more than the app needs.
  function paintPicker() {
    overlay.innerHTML = `
      <div class="modal lg-sheet lg-sheet--tall lg-sheet--picker">
        <header class="lg-head lg-head--plain">
          <div class="lg-head__text">
            <h2 class="lg-head__title">Log a game</h2>
          </div>
          <button type="button" class="lg-x" data-act="cancel" aria-label="Close">${iconClose()}</button>
        </header>
        <div class="lg-body lg-body--pad">
          <label class="lg-search">
            <span class="lg-search__icon">${iconSearch()}</span>
            <input type="text" id="lc-search" autocomplete="off" placeholder="Name of Game" aria-label="Name of Game">
          </label>
          <div id="lc-results"></div>
        </div>
      </div>`;

    enableSwipeToDismiss(qs('.modal', overlay), close);

    const input = qs('#lc-search', overlay);
    const results = qs('#lc-results', overlay);
    let directorObserver = null;

    // Games only. The Search tab keeps ONE history across both of its
    // tabs, so the raw list has player searches in it — and a username
    // is no use when the question on screen is which game you played.
    function paintRecent() {
      const entries = getRecentSearches().filter((e) => e.tab !== 'people');
      if (!entries.length) { results.innerHTML = ''; return; }
      results.innerHTML = `
        <p class="search-recent__heading">Recent searches</p>
        <div class="recent-search-list">
          ${entries.map((e) => `
            <button type="button" class="recent-search-row__content lc-recent" data-term="${esc(e.term)}">
              ${iconSearch()}<span>${esc(e.term)}</span>
            </button>`).join('')}
        </div>`;
      qsa('.lc-recent', results).forEach((btn) => {
        btn.addEventListener('click', () => { input.value = btn.dataset.term; runSearch(); });
      });
    }

    async function runSearch() {
      const q = input.value.trim();
      if (!q) { paintRecent(); return; }
      results.innerHTML = '<p class="muted">Searching…</p>';
      try {
        const { results: found } = await api.searchGamesEverywhere(q);
        if (found.length) recordRecentSearch(q, 'games');
        results.innerHTML = combinedGameResultsList(found);
        wireCombinedGameResults(results, found, {
          onLocal: (picked) => { selectedGame = picked; paintForm(); },
          onRemote: async (picked) => { selectedGame = await api.addGame(picked, state.user.id); paintForm(); },
        });
        if (directorObserver) directorObserver.disconnect();
        directorObserver = wireResultDirectors(results, found, api);
      } catch (err) {
        results.innerHTML = `<p class="muted">Couldn't search right now: ${esc(err.message)}</p>`;
      }
    }

    const doSearch = debounce(runSearch, 350);
    input.addEventListener('input', () => {
      if (directorObserver) directorObserver.disconnect();
      // Emptying the box goes back to the history rather than leaving
      // the last query's results under an empty field.
      if (!input.value.trim()) { paintRecent(); return; }
      doSearch();
    });
    paintRecent();
    input.focus();
  }

  // ------------------------------------------------------------ wiring
  // One delegated handler for the whole sheet, so a repaint (picking a
  // game, toggling a pill) never has to re-attach anything.
  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) return close();

    const stBtn = e.target.closest('[data-status]');
    if (stBtn) {
      draft.status = stBtn.dataset.status;
      buzz();
      // In place, not a repaint — rebuilding the sheet's innerHTML to
      // move one highlight reads as the sheet closing and reopening,
      // and it throws away anything typed into the review box.
      qsa('.lg-pill', overlay).forEach((b) => {
        b.classList.toggle('lg-pill--on', b.dataset.status === draft.status);
      });
      // A game in your backlog has no date you played it on.
      const dateRow = qs('#lc-date-row', overlay);
      if (dateRow) dateRow.hidden = draft.status === 'backlog';
      return;
    }

    const tgBtn = e.target.closest('[data-toggle]');
    if (tgBtn) {
      const key = tgBtn.dataset.toggle;
      draft[key] = !draft[key];
      buzz();
      tgBtn.setAttribute('aria-pressed', String(draft[key]));
      tgBtn.querySelector('.lg-switch').classList.toggle('lg-switch--on', draft[key]);
      if (key === 'isPublic') {
        const note = tgBtn.querySelector('.lg-row__note');
        if (note) note.textContent = draft.isPublic ? '' : 'only you';
      }
      return;
    }

    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const act = actBtn.dataset.act;

    if (act === 'cancel') return close();

    if (act === 'love') {
      draft.loved = !draft.loved;
      buzz();
      actBtn.setAttribute('aria-pressed', String(draft.loved));
      actBtn.setAttribute('aria-label', draft.loved ? 'Remove from loved' : 'Mark as loved');
      actBtn.innerHTML = draft.loved ? iconHeartSolid() : iconHeartLine();
      return;
    }

    if (act === 'save') return save();

    if (act === 'delete' && existingLog) {
      if (!confirm('Delete this entry? This can\'t be undone.')) return;
      try {
        await api.deleteLog(existingLog.id);
        toast('Entry deleted.', 'success');
        close();
        onSaved({ deleted: true, log: existingLog });
      } catch (err) {
        toast(err.message || 'Could not delete.', 'error');
      }
    }
  });

  overlay.addEventListener('input', (e) => {
    if (e.target.id === 'lc-review') {
      draft.review = e.target.value;
      const count = qs('#lc-count', overlay);
      if (count) count.textContent = countWords(draft.review);
    }
    if (e.target.id === 'lc-date') {
      draft.played_date = e.target.value || null;
      const note = e.target.closest('.lg-row')?.querySelector('.lg-row__note');
      if (note) note.textContent = draft.played_date ? shortDate(draft.played_date) : 'add';
    }
    if (e.target.id === 'lc-hours') {
      const n = Number(e.target.value);
      draft.hours = e.target.value === '' || isNaN(n) ? null : Math.max(0, Math.min(20000, Math.round(n)));
    }
  });

  if (selectedGame) paintForm();
  else paintPicker();
}

// ------------------------------------------------------------- helpers
// Titles in the shared `games` table often carry their own year, and
// the head prints the year again underneath — so "Elden Ring (2022)"
// read as "Elden Ring (2022) / 2022". Built from a plain string, not a
// template literal: `\s` inside backticks is an unknown escape that
// collapses to a bare "s".
function headTitle(game) {
  const t = String(game?.title || '');
  if (!game?.release_year) return t;
  return t.replace(new RegExp('\\s*\\(' + game.release_year + '\\)\\s*$'), '');
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return formatDate(iso);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, thisYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
}

function countWords(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const n = t.split(/\s+/).length;
  return `${n} word${n === 1 ? '' : 's'}`;
}

// The heart, at both weights. The viewBox is wider than the 3 4 18 18
// the rest of the app uses for this path: measured, the path itself
// runs from x 2.95 to 21.05, so that box clipped a sliver off both
// sides — invisible at the 10px it renders in a feed byline, plainly
// visible at 26px here. The outline needs more room again, since a
// 1.9 stroke puts another 0.95 beyond the path on every side. Both
// weights share one box so the mark does not change size when it is
// toggled.
function iconHeartLine() {
  return `<svg viewBox="1.8 2.2 20.4 20.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 20.3 4.3 12.6A4.7 4.7 0 0 1 11 6l1 1 1-1a4.7 4.7 0 0 1 6.7 6.6z"/></svg>`;
}
function iconHeartSolid() {
  return `<svg viewBox="1.8 2.2 20.4 20.4" fill="currentColor"><path d="M12 20.3 4.3 12.6A4.7 4.7 0 0 1 11 6l1 1 1-1a4.7 4.7 0 0 1 6.7 6.6z"/></svg>`;
}
