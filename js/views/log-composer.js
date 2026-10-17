import * as api from '../api.js';
import { openDatePicker } from './date-picker.js';
import { state } from '../state.js';
import {
  esc, starRow, toast, qs, qsa, debounce, formatDate, enableSwipeToDismiss, reviewText,
  celebrate, pulseLogTab, getRecentSearches, recordRecentSearch, removeRecentSearch, clearRecentSearches,
} from '../utils.js';
import {
  iconClose, iconSearch, iconChevronRight, confirmSheet, skeletonList,
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
// resolveGame: a promise for the saved game when `game` is only a stand-in
// (title + cover), so the sheet can open instantly while the catalogue
// lookup finishes behind it. Saving waits for it.
export function openLogComposer({ game = null, resolveGame = null, existingLog = null, defaultReplay = false, onSaved = () => {} } = {}) {
  // A second tap on + (or a double tap) while the sheet is open or opening
  // must not stack another one on top.
  if (document.querySelector('.modal-overlay[data-lc]')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.lc = '1';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  let selectedGame = game || existingLog?.games || null;
  let pendingGame = resolveGame;
  pendingGame?.then((g) => { if (g && pendingGame === resolveGame) selectedGame = g; }).catch(() => {});

  const draft = {
    // Nothing is picked until you pick it. Saving with a rating or a review and no
    // choice counts as Played (see save()).
    status: existingLog?.status || null,
    rating: Number(existingLog?.rating) || 0,
    loved: !!existingLog?.loved,
    review: existingLog?.review || '',
    spoilers: !!existingLog?.contains_spoilers,
    replay: !!(existingLog?.is_replay || defaultReplay),
    isPublic: existingLog?.is_public !== false,
    played_date: existingLog?.played_date || (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; })(),
    hours: existingLog?.hours_played ?? null,
  };

  // An unfinished review is kept on this device as a draft, per game, until the entry is saved or deleted.
  const draftKey = () => { const id = existingLog ? 'log' + existingLog.id : selectedGame?.id; return id ? `pt-review-draft:${state.user?.id || 'anon'}:${id}` : null; };
  const stashDraft = () => { try { const k = draftKey(); if (!k) return; const t = draft.review.trim(); if (t && t !== (existingLog?.review || '').trim()) localStorage.setItem(k, draft.review); else localStorage.removeItem(k); } catch (_) { /* no storage, no draft */ } };
  const dropDraft = () => { try { const k = draftKey(); if (k) localStorage.removeItem(k); } catch (_) { /* fine */ } };
  let draftLoadedFor = null;
  const loadDraft = () => {
    const k = draftKey();
    if (!k || draftLoadedFor === k) return;
    draftLoadedFor = k;
    try {
      const d = localStorage.getItem(k);
      if (d && d.trim() && d.trim() !== draft.review.trim()) { draft.review = d; draft.isDraft = true; hist = [draft.review]; pos = 0; }
    } catch (_) { /* fine */ }
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
  // Back on the log form, when the game was picked from the search step,
  // goes back to that search (same words, same results) instead of closing
  // everything. The app's Back handling has already used up the sheet's
  // history entry by now, so staying open puts one back for the next Back.
  let view = 'form';
  let cameFromPicker = false;
  let lastQuery = '';
  let lastFound = null;
  overlay.__dismiss = () => {
    if (view === 'edit') {
      overlay.__closing = false;
      paintForm();
      history.pushState({ ...history.state, ov: (history.state?.ov || 0) + 1 }, '', location.href);
      return;
    }
    if (view === 'form' && cameFromPicker) {
      overlay.__closing = false;
      selectedGame = null; pendingGame = null;
      paintPicker();
      history.pushState({ ...history.state, ov: (history.state?.ov || 0) + 1 }, '', location.href);
      return;
    }
    close();
  };

  const haptics = window.Capacitor?.Plugins?.Haptics || null;
  const buzz = () => {
    if (haptics) haptics.impact({ style: 'LIGHT' }).catch(() => {});
    else { try { navigator.vibrate?.(10); } catch { /* not supported here */ } }
  };

  // The heart: a firmer two-beat buzz than the light detent used for the
  // stars and pills, so it is clearly felt.
  const buzzHeart = () => {
    if (haptics) haptics.impact({ style: 'MEDIUM' }).catch(() => {});
    else { try { navigator.vibrate?.([16, 40, 26]); } catch { /* not supported here */ } }
  };

  // ---------------------------------------------------------- the form
  // Letterboxd's "I Watched" screen, as "I Played": a full screen with a close
  // cross and a save tick, the game, the date (tap to change, the cross removes
  // it), stars and Like, the review (opens the editor), hours, and three toggles.
  function paintForm() {
    loadDraft();
    view = 'form';
    overlay.classList.add('modal-overlay--full');
    const g = selectedGame;
    const today = localToday();
    const title = draft.status === 'playing' ? 'I’m Playing' : draft.status === 'backlog' ? 'Backlog' : 'I Played';
    overlay.innerHTML = `
      <div class="ip" role="dialog" aria-label="${esc(title)}: ${esc(headTitle(g))}">
        <header class="ip-bar">
          <button type="button" class="ip-bar__btn" data-act="cancel" aria-label="Close">${iconClose()}</button>
          <h2>${title}</h2>
          <button type="button" class="ip-bar__btn ip-save" data-act="save" aria-label="Save">${iconTick()}</button>
        </header>
        <div class="ip-body">
          <div class="ip-game">
            ${g.cover_url ? `<img src="${esc(g.cover_url)}" alt="">` : ''}
            <b>${esc(headTitle(g))}</b>
          </div>
          ${draft.status === 'backlog' ? '' : `
          <label class="ip-date" id="lc-date-row">
            <span class="ip-date__l">Date</span>
            <span class="ip-date__v">${draft.played_date ? esc(longDate(draft.played_date)) : 'Add a date'}</span>
            ${draft.played_date ? `<button type="button" class="ip-clear" data-act="nodate" aria-label="Remove date">${iconClearDot()}</button>` : ''}
            <input type="date" class="ip-date__in" id="lc-date" aria-label="Date played"
                   value="${esc(draft.played_date || '')}" min="${esc(g.release_date || '')}" max="${today}">
          </label>`}
          <div class="ip-rate">
            <div><div class="lg-rate" id="lc-rating">${starRow(draft.rating, { interactive: true, size: 38 })}</div><small>Rate</small></div>
            <button type="button" class="ip-like" data-act="love" aria-pressed="${draft.loved}" aria-label="${draft.loved ? 'Remove from loved' : 'Mark as loved'}">${iconHeartSolid()}<small>Like</small></button>
          </div>
          <button type="button" class="ip-review" data-act="edit">
            ${draft.review.trim() ? `${draft.isDraft ? '<span class="ip-draft">Draft</span>' : ''}<span class="ip-review__t">${reviewText(draft.review)}</span>` : '<span class="ip-review__ph">Add review…</span>'}
          </button>
          <label class="ip-hours">
            <span>Hours played</span>
            <input type="number" class="lg-num" id="lc-hours" aria-label="Hours played" placeholder="add"
                   inputmode="numeric" min="0" max="20000" step="1" value="${draft.hours ?? ''}">
          </label>
          <div class="ip-toggles">
            <button type="button" data-toggle="replay" aria-pressed="${draft.replay}">${iconReplayEye()}<span>${draft.replay ? 'Replay' : 'First-time play'}</span></button>
            <button type="button" data-toggle="spoilers" aria-pressed="${draft.spoilers}">${iconSpoilerShield(draft.spoilers)}<span>${draft.spoilers ? 'Contains spoilers' : 'No spoilers'}</span></button>
            <button type="button" data-toggle="isPublic" aria-pressed="${!draft.isPublic}">${iconLockSm(!draft.isPublic)}<span>${draft.isPublic ? 'Public' : 'Only me'}</span></button>
          </div>
          ${existingLog ? '<button type="button" class="ip-delete" data-act="delete">Delete this entry</button>' : ''}
        </div>
      </div>`;
    wireRating();
  }

  // The full-screen review editor: a blank page, and bold, italic, quote, link,
  // undo and redo along the bottom. Back returns to the form with the text kept.
  let hist = [draft.review];
  let pos = 0;
  function paintEditor() {
    view = 'edit';
    hist = [draft.review]; pos = 0;
    overlay.innerHTML = `
      <div class="ip ip--edit" role="dialog" aria-label="Edit review">
        <header class="ip-bar">
          <button type="button" class="ip-bar__btn" data-act="back-edit" aria-label="Back">${iconArrowLeft()}</button>
          <h2>Edit Text</h2>
          <span></span>
        </header>
        <textarea class="ip-editor" id="lc-review" aria-label="Review">${esc(draft.review)}</textarea>
        <div class="ip-tools">
          <button type="button" data-fmt="b" aria-label="Bold">${iconFmtBold()}</button>
          <button type="button" data-fmt="i" aria-label="Italic">${iconFmtItalic()}</button>
          <button type="button" data-fmt="q" aria-label="Quote">${iconFmtQuote()}</button>
          <button type="button" data-fmt="l" aria-label="Link">${iconFmtLink()}</button>
          <span></span>
          <button type="button" data-fmt="undo" aria-label="Undo" disabled>${iconFmtUndo()}</button>
          <button type="button" data-fmt="redo" aria-label="Redo" disabled>${iconFmtRedo()}</button>
        </div>
      </div>`;
    const t = qs('#lc-review', overlay);
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }
  function syncUndo() {
    const u = qs('[data-fmt="undo"]', overlay);
    const r = qs('[data-fmt="redo"]', overlay);
    if (u) u.disabled = pos === 0;
    if (r) r.disabled = pos >= hist.length - 1;
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
      picker.innerHTML = starRow(v, { interactive: true, size: 38 });
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
    if (pendingGame) {
      try { const real = await pendingGame; if (real) selectedGame = real; } catch { toast('Could not find that game.', 'error'); return; }
      pendingGame = null;
    }
    const g = selectedGame;

    // This is the "I Played" screen: with nothing else chosen, the entry is a play.
    if (!draft.status) draft.status = 'played';

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

    const btn = qs('.ip-save', overlay);
    if (btn) btn.disabled = true;
    try {
      const saved = existingLog
        ? await api.updateLog(existingLog.id, payload)
        : await api.createLog(payload);
      dropDraft();
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
      if (btn) btn.disabled = false;
    }
  }

  // ------------------------------------------------------- the picker
  // Shown when no game came in (the + tab, the feed's empty state).
  // Deliberately the SAME list the Search tab shows — cover, title,
  // year, director — because it is the same question, and two different
  // answers to "which game do you mean" is one more than the app needs.
  function paintPicker() {
    view = 'picker';
    overlay.classList.remove('modal-overlay--full');
    overlay.innerHTML = `
      <div class="modal lg-sheet lg-sheet--tall lg-sheet--picker">
        <header class="lg-head lg-head--plain">
          <div class="lg-head__text">
            <h2 class="lg-head__title">Name of Game</h2>
          </div>
          <button type="button" class="lg-x" data-act="cancel" aria-label="Close">${iconClose()}</button>
        </header>
        <div class="lg-body lg-body--pad">
          <form class="search-bar-row lc-search-row" id="lc-form">
            <input type="search" id="lc-search" class="search-input" autocomplete="off" enterkeyhint="search"
                   placeholder="Search games…" aria-label="Search games">
          </form>
          <div id="lc-results"></div>
        </div>
      </div>`;

    enableSwipeToDismiss(qs('.modal', overlay), close);

    const input = qs('#lc-search', overlay);
    const results = qs('#lc-results', overlay);
    let directorObserver = null;

    // Game searches only (the Search tab keeps one history for every tab, and
    // a username is no use when the question is which game you played).
    // Same look as the Recent searches on the Search screen, names first and
    // lined up under the heading.
    function paintRecent() {
      const entries = getRecentSearches().filter((e) => e.tab === 'games');
      if (!entries.length) { results.innerHTML = ''; return; }
      results.innerHTML = `
        <div class="search-recent__row">
          <p class="search-recent__heading">Recent searches</p>
          <button type="button" class="link-btn" id="lc-clear">Clear</button>
        </div>
        <div class="lc-recent-list">
          ${entries.map((e) => `
            <div class="lc-recent-row">
              <button type="button" class="lc-recent" data-term="${esc(e.term)}">${esc(e.term)}</button>
              <button type="button" class="lc-recent-x" data-del="${esc(e.term)}" aria-label="Remove ${esc(e.term)}">${iconClose()}</button>
            </div>`).join('')}
        </div>`;
      qsa('.lc-recent', results).forEach((btn) => {
        btn.addEventListener('click', () => { input.value = btn.dataset.term; runSearch(); });
      });
      qsa('.lc-recent-x', results).forEach((btn) => {
        // Keep focus in the search box, so removing a row never closes the list.
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => { removeRecentSearch(btn.dataset.del, 'games'); paintRecent(); });
      });
      qs('#lc-clear', results)?.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Clear search history?', confirmLabel: 'Clear', danger: true });
        if (ok) clearRecentSearches();
        paintRecent();
      });
    }

    function showResults(found) {
      results.innerHTML = combinedGameResultsList(found);
      wireCombinedGameResults(results, found, {
        onLocal: (picked) => { pendingGame = null; selectedGame = picked; cameFromPicker = true; startForm(); },
        onRemote: async (picked) => {
          try {
            const saved = await api.addGame(picked, state.user.id);
            pendingGame = null; selectedGame = saved; cameFromPicker = true; startForm();
          } catch (err) {
            toast(err.message || 'Could not open that game.', 'error');
          }
        },
      });
      if (directorObserver) directorObserver.disconnect();
      directorObserver = wireResultDirectors(results, found, api);
    }

    let searchTicket = 0;
    async function runSearch() {
      const q = input.value.trim();
      const ticket = ++searchTicket;
      if (!q) { paintRecent(); return; }
      results.innerHTML = skeletonList(6); // boxed placeholders, same as the Search screen
      try {
        const { results: found } = await api.searchGamesEverywhere(q);
        if (ticket !== searchTicket) return; // a newer search has started
        if (found.length) recordRecentSearch(q, 'games');
        if (!found.length) { results.innerHTML = '<p class="muted">No games found. Try a different spelling.</p>'; return; }
        lastQuery = q; lastFound = found;
        showResults(found);
      } catch (err) {
        if (ticket !== searchTicket) return;
        results.innerHTML = `<p class="muted">Couldn't search right now: ${esc(err.message)}</p>`;
      }
    }

    const doSearch = debounce(runSearch, 350);
    input.addEventListener('input', () => {
      if (directorObserver) directorObserver.disconnect();
      // Emptying the box goes back to the history rather than leaving
      // the last query's results under an empty field.
      if (!input.value.trim()) { searchTicket++; paintRecent(); return; }
      doSearch();
    });
    // Enter runs the search right away and puts the keyboard away.
    qs('#lc-form', overlay).addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch();
      input.blur();
    });
    // Coming back from a game's log form: the search is just as it was left.
    if (lastQuery && lastFound) {
      input.value = lastQuery;
      showResults(lastFound);
    } else {
      paintRecent();
      input.focus();
    }
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
      paintForm();
      return;
    }

    // The date row opens the date picker; its cross removes the date.
    const dateRow = e.target.closest('.ip-date');
    if (dateRow && !e.target.closest('.ip-clear') && !e.target.matches('input')) {
      e.preventDefault();
      const g = selectedGame || {};
      const minDate = g.release_date ? String(g.release_date).slice(0, 10) : (g.release_year ? `${g.release_year}-01-01` : null);
      openDatePicker({
        value: draft.played_date, min: minDate, max: localToday(),
        onPick: (v) => { draft.played_date = v; const dv = qs('.ip-date__v', overlay); if (dv) dv.textContent = longDate(v); paintForm(); },
      });
      return;
    }

    // The editor's toolbar: wrap the selection (or a placeholder word) in the
    // marks reviewText() understands; undo and redo step through the edits.
    const fmtBtn = e.target.closest('[data-fmt]');
    if (fmtBtn) {
      const t = qs('#lc-review', overlay);
      const k = fmtBtn.dataset.fmt;
      if (k === 'undo' || k === 'redo') {
        pos = Math.max(0, Math.min(hist.length - 1, pos + (k === 'undo' ? -1 : 1)));
        draft.review = hist[pos];
        t.value = draft.review;
        syncUndo();
        t.focus();
        return;
      }
      const a = t.selectionStart;
      const b = t.selectionEnd;
      const sel = t.value.slice(a, b);
      const [pre, post, fill] = { b: ['**', '**', 'bold'], i: ['_', '_', 'italic'], q: ['\n> ', '', 'quote'], l: ['[', '](https://)', 'link text'] }[k];
      const body = sel || fill;
      t.value = t.value.slice(0, a) + pre + body + post + t.value.slice(b);
      t.focus();
      t.setSelectionRange(a + pre.length, a + pre.length + body.length);
      draft.review = t.value; draft.isDraft = true; stashDraft();
      hist = hist.slice(0, pos + 1); hist.push(draft.review); pos = hist.length - 1;
      syncUndo();
      return;
    }


    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const act = actBtn.dataset.act;

    if (act === 'cancel') return close();

    if (act === 'love') {
      draft.loved = !draft.loved;
      buzzHeart();
      actBtn.setAttribute('aria-pressed', String(draft.loved));
      actBtn.setAttribute('aria-label', draft.loved ? 'Remove from loved' : 'Mark as loved');
      return;
    }
    if (act === 'nodate') { e.preventDefault(); draft.played_date = null; paintForm(); return; }
    if (act === 'edit') { paintEditor(); return; }
    if (act === 'back-edit') { paintForm(); return; }

    if (act === 'save') return save();

    if (act === 'delete' && existingLog) {
      if (!(await confirmSheet({ title: 'Delete this entry?', message: "This can't be undone.", confirmLabel: 'Delete', danger: true }))) return;
      try {
        await api.deleteLog(existingLog.id);
        dropDraft();
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
      draft.review = e.target.value; draft.isDraft = true; stashDraft();
      hist = hist.slice(0, pos + 1); hist.push(draft.review); pos = hist.length - 1; syncUndo();
    }
    if (e.target.id === 'lc-date') {
      draft.played_date = e.target.value || null;
      const v = qs('.ip-date__v', overlay);
      if (v) v.textContent = draft.played_date ? longDate(draft.played_date) : 'Add a date';
    }
    if (e.target.id === 'lc-hours') {
      const n = Number(e.target.value);
      draft.hours = e.target.value === '' || isNaN(n) ? null : Math.max(0, Math.min(20000, Math.round(n)));
    }
  });

  // The form for a freshly picked game: an unreleased one can only go in the
  // backlog, so it starts there instead of failing on Save.
  function startForm() {
    if (!existingLog && isUnreleased(selectedGame)) draft.status = 'backlog';
    paintForm();
  }

  if (selectedGame) startForm();
  else paintPicker();
}

function isUnreleased(g) {
  if (!g) return false;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (g.release_date) { const rd = new Date(g.release_date); return !isNaN(rd) && rd > now; }
  if (g.release_year) return Number(g.release_year) > now.getFullYear();
  return false;
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

function localToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function longDate(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function iconTick() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'; }
function iconArrowLeft() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H5M11 5l-7 7 7 7"/></svg>'; }
function iconClearDot() { return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M8 8l8 8M16 8l-8 8" stroke="var(--bg)" stroke-width="2" stroke-linecap="round"/></svg>'; }
function iconReplayEye() { return '<svg viewBox="0 0 48 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 15C7 6 15 2 24 2s17 4 22 13c-5 9-13 13-22 13S7 24 2 15z"/><path d="M30 13.5a6.3 6.3 0 1 0-1.4 5.6M30.4 9.4v4.4H26" stroke-linecap="round"/></svg>'; }
function iconSpoilerShield(on) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.3-3 7.8-7 9.5-4-1.7-7-5.2-7-9.5V6z"/>${on ? '<path d="M8.5 9.5l7 7M15.5 9.5l-7 7" stroke-linecap="round"/>' : '<path d="M9 12.5h6M12 9.5v6" stroke-linecap="round"/>'}</svg>`; }
function iconLockSm(on) {
  return on
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/></svg>';
}
function iconFmtBold() { return '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 4h6.2a4.3 4.3 0 0 1 2.9 7.5A4.6 4.6 0 0 1 13.8 20H7zm3 3v3.8h3a1.9 1.9 0 0 0 0-3.8zm0 6.6V17h3.6a2 2 0 0 0 0-4z"/></svg>'; }
function iconFmtItalic() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 4h8M6 20h8M15 4 9 20"/></svg>'; }
function iconFmtQuote() { return '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 11.5C4 8 6 5.6 9.4 5l.5 1.6C8 7.3 7 8.6 7 10.4h2.7V17H4zm10 0c0-3.5 2-5.9 5.4-6.5l.5 1.6c-1.9.7-2.9 2-2.9 3.8h2.7V17H14z"/></svg>'; }
function iconFmtLink() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 15l6-6M10.5 6.5l1.3-1.3a4.2 4.2 0 0 1 6 6l-1.3 1.3M13.5 17.5l-1.3 1.3a4.2 4.2 0 0 1-6-6l1.3-1.3"/></svg>'; }
function iconFmtUndo() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7 5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/></svg>'; }
function iconFmtRedo() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 7 4 4-4 4"/><path d="M19 11h-9a5 5 0 0 0 0 10h2"/></svg>'; }

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
