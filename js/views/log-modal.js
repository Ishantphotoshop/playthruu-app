import * as api from '../api.js';
import { state } from '../state.js';
import { esc, starRow, toast, qs, qsa, debounce, placeholderCover, formatDate, enableSwipeToDismiss, celebrate } from '../utils.js';
import { iconClose, iconCalendar, iconGamepad, iconHeart, iconBookmark, combinedGameResults, wireCombinedGameResults, posterFrame } from '../components.js';
import { openAddToListPicker } from './lists-view.js';

export function openLogModal({ game = null, existingLog = null, defaultReplay = false, onSaved = () => {} } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  let selectedGame = game || existingLog?.games || null;
  let rating = existingLog ? Number(existingLog.rating) || 0 : 0;

  function close() {
    overlay.remove();
    document.body.style.overflow = '';
  }

  function paintForm() {
    const g = selectedGame;
    const status = existingLog?.status || 'played';
    const today = new Date().toISOString().slice(0, 10);

    overlay.innerHTML = `
      <div class="modal modal--tall log-sheet">
        <header class="log-sheet__head">
          <button class="modal__close log-sheet__close" data-close aria-label="Close">&times;</button>
          <h2 class="log-sheet__title">${esc(g.title)}${g.release_year ? ` <span class="log-sheet__year">(${esc(String(g.release_year))})</span>` : ''}</h2>
        </header>
        <form class="modal__body log-sheet__body" id="log-form">

          <div class="quick-row">
            <button type="button" class="quick-act" id="q-played" data-on="${existingLog && status === 'played' ? '1' : ''}">
              <span class="quick-act__icon quick-act__icon--pad">${iconGamepad()}</span>
              <span class="quick-act__label">Played</span>
            </button>
            <button type="button" class="quick-act" id="q-love" data-on="">
              <span class="quick-act__icon quick-act__icon--heart">${iconHeart()}</span>
              <span class="quick-act__label">Love</span>
            </button>
            <button type="button" class="quick-act" id="q-save" data-on="${status === 'backlog' ? '1' : ''}">
              <span class="quick-act__icon quick-act__icon--save">${iconBookmark()}</span>
              <span class="quick-act__label">Save</span>
            </button>
          </div>

          <div class="quick-stars" id="rating-picker">${starRow(rating, { interactive: true, size: 34 })}</div>

          <div class="log-sheet__rows">
            <button type="button" class="sheet-row" id="row-playing">Mark as currently playing</button>
            <button type="button" class="sheet-row" id="row-review">${existingLog ? 'Edit review' : 'Log and review'}</button>
            <button type="button" class="sheet-row" id="row-list">Add to List</button>
            <button type="button" class="sheet-row" id="row-share-ig">Share on Instagram story</button>
            <button type="button" class="sheet-row" id="row-share">Share</button>
          </div>

          <div class="log-sheet__extra" id="log-extra" hidden>
            <div class="field">
              <span>Hours to beat <span class="muted">(optional)</span></span>
              <!-- A vertical alarm-clock style wheel: scroll the numbers
                   under the centre band, which is the reading. "hrs" and a
                   type shortcut sit to its right. -->
              <div class="hour-picker" id="hour-picker">
                <div class="hour-wheel-row">
                  <div class="hour-wheel">
                    <div class="hour-wheel__scroll" id="hour-wheel" role="slider" aria-label="Hours to beat"
                         aria-valuemin="0" aria-valuemax="20000" aria-valuenow="${existingLog?.hours_played ?? 0}" tabindex="0">
                      <div class="hour-wheel__list" id="hour-wheel-list"></div>
                    </div>
                    <div class="hour-wheel__band" aria-hidden="true"></div>
                  </div>
                  <div class="hour-wheel__aside">
                    <span class="hour-wheel__unit">hrs</span>
                    <button type="button" class="hour-picker__edit" id="hour-edit-btn" aria-label="Type an exact number">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                      <span>type</span>
                    </button>
                    <input type="number" id="hour-type-input" class="hour-picker__type" min="0" max="20000" step="1" inputmode="numeric" aria-label="Exact hours" hidden>
                  </div>
                </div>
              </div>
            </div>
            <label class="field" id="date-field">
              <span>Date played</span>
              <div class="date-input-wrap">
                ${iconCalendar()}
                <input type="date" name="played_date" class="date-input" value="${existingLog?.played_date || today}" min="${esc(g.release_date || '')}" max="${today}">
              </div>
            </label>
            <label class="field">
              <span>Review <span class="muted">(optional)</span></span>
              <textarea name="review" rows="4" placeholder="What did you think?">${esc(existingLog?.review || '')}</textarea>
            </label>
            <div class="field-row field-row--checks">
              <label class="checkbox"><input type="checkbox" name="is_replay" ${(existingLog?.is_replay || defaultReplay) ? 'checked' : ''}> Replay</label>
              <label class="checkbox"><input type="checkbox" name="contains_spoilers" ${existingLog?.contains_spoilers ? 'checked' : ''}> Spoilers</label>
              <label class="checkbox"><input type="checkbox" name="is_public" ${existingLog?.is_public !== false ? 'checked' : ''}> Public</label>
            </div>
          </div>

          <div class="modal__actions">
            ${existingLog ? `<button type="button" class="btn btn--danger" id="delete-log">Delete</button>` : ''}
            <button type="submit" class="btn btn--accent">${existingLog ? 'Save changes' : 'Save entry'}</button>
          </div>
        </form>
      </div>`;

    let currentStatus = status;
    const dateField = qs('#date-field', overlay);
    const syncDateVisibility = () => { if (dateField) dateField.style.display = currentStatus === 'backlog' ? 'none' : ''; };
    syncDateVisibility();

    // --- quick actions -------------------------------------------
    // A single, gentle detent for every tap. The old version fired a
    // strong triple-pulse pattern through navigator.vibrate, which on the
    // phone came through as a jarring buzz; a light native Haptics tap is
    // the right weight. Falls back to a short vibrate on the plain web
    // build where Capacitor isn't present.
    const quickHaptics = window.Capacitor?.Plugins?.Haptics || null;
    const buzz = () => {
      if (quickHaptics) { quickHaptics.impact({ style: 'LIGHT' }).catch(() => {}); }
      else { try { navigator.vibrate?.(10); } catch { /* not supported */ } }
    };

    const qPlayed = qs('#q-played', overlay);
    const qLove = qs('#q-love', overlay);
    const qSave = qs('#q-save', overlay);
    let loved = false;

    if (qPlayed) qPlayed.addEventListener('click', () => {
      const on = qPlayed.dataset.on === '1';
      qPlayed.dataset.on = on ? '' : '1';
      if (!on) {
        currentStatus = 'played';
        qSave.dataset.on = '';
        buzz();
        qPlayed.classList.remove('is-shaking');
        void qPlayed.offsetWidth;      // restart the animation
        qPlayed.classList.add('is-shaking');
      }
      syncDateVisibility?.();
    });

    if (qLove) qLove.addEventListener('click', () => {
      loved = !loved;
      qLove.dataset.on = loved ? '1' : '';
      if (loved) { buzz(); qLove.classList.remove('is-pop'); void qLove.offsetWidth; qLove.classList.add('is-pop'); }
    });

    if (qSave) qSave.addEventListener('click', () => {
      const on = qSave.dataset.on === '1';
      qSave.dataset.on = on ? '' : '1';
      if (!on) {
        currentStatus = 'backlog';
        qPlayed.dataset.on = '';
        buzz();
        qSave.classList.remove('is-pop'); void qSave.offsetWidth; qSave.classList.add('is-pop');
      }
      syncDateVisibility?.();
    });

    // --- hours-to-beat: a vertical alarm-clock wheel ---------------
    // The numbers scroll vertically under a fixed centre band (the band is
    // the reading), snapping like a clock's minute wheel, with a light
    // haptic tick each time the centred value changes. Fine steps early
    // (most games), coarser as it climbs; "hrs" and a type shortcut sit to
    // the right, and the type field jumps to any exact number for the big
    // outliers so no one has to spin the whole way to 20,000.
    const ITEM_H = 44;
    const HOUR_STEPS = [];
    for (let h = 0;    h <= 50;    h += 1)    HOUR_STEPS.push(h);
    for (let h = 55;   h <= 100;   h += 5)    HOUR_STEPS.push(h);
    for (let h = 110;  h <= 300;   h += 10)   HOUR_STEPS.push(h);
    for (let h = 350;  h <= 1000;  h += 50)   HOUR_STEPS.push(h);
    for (let h = 1200; h <= 5000;  h += 200)  HOUR_STEPS.push(h);
    for (let h = 6000; h <= 20000; h += 1000) HOUR_STEPS.push(h);
    const fmtHours = (h) => h.toLocaleString('en-US');

    // 0 doubles as "not set" — the save payload turns 0 into null.
    let hoursValue = existingLog?.hours_played != null ? Number(existingLog.hours_played) : 0;

    const wheel = qs('#hour-wheel', overlay);
    const wheelList = qs('#hour-wheel-list', overlay);
    const typeInput = qs('#hour-type-input', overlay);
    const aside = qs('.hour-wheel__aside', overlay);

    if (wheel && wheelList) {
      wheelList.innerHTML = HOUR_STEPS.map((h, i) => `<div class="hour-wheel__item" data-i="${i}">${fmtHours(h)}</div>`).join('');

      const haptics = window.Capacitor?.Plugins?.Haptics || null;
      const buzz = () => {
        if (haptics) haptics.impact({ style: 'LIGHT' }).catch(() => {});
        else { try { navigator.vibrate?.(7); } catch { /* unsupported */ } }
      };

      const nearestIndex = (v) => {
        let best = 0, bd = Infinity;
        for (let i = 0; i < HOUR_STEPS.length; i++) {
          const d = Math.abs(HOUR_STEPS[i] - v);
          if (d < bd) { bd = d; best = i; }
        }
        return best;
      };

      let selIdx = -1;
      const markSelected = (idx) => {
        const items = wheelList.children;
        if (selIdx >= 0 && items[selIdx]) items[selIdx].classList.remove('is-selected');
        if (items[idx]) items[idx].classList.add('is-selected');
        selIdx = idx;
      };

      const syncFromScroll = () => {
        const idx = Math.max(0, Math.min(HOUR_STEPS.length - 1, Math.round(wheel.scrollTop / ITEM_H)));
        if (idx === selIdx) return;
        markSelected(idx);
        hoursValue = HOUR_STEPS[idx];
        wheel.setAttribute('aria-valuenow', String(hoursValue));
        buzz();
      };
      wheel.addEventListener('scroll', () => {
        if (wheel._raf) return;
        wheel._raf = requestAnimationFrame(() => { wheel._raf = null; syncFromScroll(); });
      }, { passive: true });

      const scrollToValue = (v) => {
        const idx = nearestIndex(v);
        wheel.scrollTop = idx * ITEM_H;
        markSelected(idx);
        hoursValue = HOUR_STEPS[idx];
        wheel.setAttribute('aria-valuenow', String(hoursValue));
      };

      wheel.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        wheel.scrollTop += d * ITEM_H;
      });

      // --- type an exact value ---------------------------------------
      const openType = () => {
        typeInput.value = hoursValue > 0 ? String(hoursValue) : '';
        aside.classList.add('is-typing');
        typeInput.hidden = false; typeInput.focus(); typeInput.select();
      };
      const commitType = (save) => {
        if (save) {
          const raw = typeInput.value.trim();
          const v = raw === '' ? 0 : parseFloat(raw);
          if (isFinite(v)) scrollToValue(Math.max(0, Math.min(20000, Math.round(v))));
        }
        typeInput.hidden = true; aside.classList.remove('is-typing');
      };
      qs('#hour-edit-btn', overlay)?.addEventListener('click', openType);
      typeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitType(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commitType(false); }
      });
      typeInput.addEventListener('blur', () => commitType(true));

      // Position on the existing value (or 0) once laid out.
      requestAnimationFrame(() => scrollToValue(hoursValue));
    }

    // --- action rows ---------------------------------------------
    const extra = qs('#log-extra', overlay);
    qs('#row-playing', overlay)?.addEventListener('click', () => {
      currentStatus = 'playing';
      buzz();
      toast('Marked as currently playing — hit save to confirm.', 'success');
    });
    qs('#row-review', overlay)?.addEventListener('click', () => {
      extra.hidden = !extra.hidden;
      if (!extra.hidden) qs('textarea[name="review"]', overlay)?.focus();
    });
    qs('#row-list', overlay)?.addEventListener('click', () => openAddToListPicker(g));
    qs('#row-share', overlay)?.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#/game/${g.id}`;
      try {
        if (navigator.share) await navigator.share({ title: g.title, url });
        else { await navigator.clipboard.writeText(url); toast('Link copied.', 'success'); }
      } catch { /* user dismissed the share sheet */ }
    });
    qs('#row-share-ig', overlay)?.addEventListener('click', async () => {
      // There's no way for a website to drop straight into Instagram's
      // Stories composer without Instagram's own developer approval — so
      // like the profile share button, this opens the native share sheet.
      // On a phone with Instagram installed, Instagram (including "Add to
      // Story") shows up there as one of the share targets.
      const url = `${location.origin}${location.pathname}#/game/${g.id}`;
      try {
        if (navigator.share) await navigator.share({ title: g.title, url });
        else { await navigator.clipboard.writeText(url); toast('Link copied — paste it into your story.', 'success'); }
      } catch { /* user dismissed the share sheet */ }
    });

    qs('[data-close]', overlay)?.addEventListener('click', close);
    enableSwipeToDismiss(qs('.modal', overlay), close);
    if (qs('#change-game', overlay)) {
      qs('#change-game', overlay)?.addEventListener('click', paintPicker);
    }


    // --- rating: tap OR swipe across, Letterboxd-style ---------------
    // Press anywhere on the row and slide left/right without lifting;
    // the rating tracks your finger in half-star steps and ticks softly
    // as it changes. A plain tap is just a zero-length swipe.
    const ratingPicker = qs('#rating-picker', overlay);
    if (ratingPicker) {
      // Work out the rating for a pointer x-position across the row.
      const ratingFromX = (clientX) => {
        const stars = qsa('.star', ratingPicker);
        if (!stars.length) return rating;
        const first = stars[0].getBoundingClientRect();
        // Left of the first star's start still means the lowest rating.
        if (clientX < first.left + 2) return 0.5;
        let val = 0.5;
        for (const s of stars) {
          const box = s.getBoundingClientRect();
          const idx = Number(s.dataset.star);
          if (clientX >= box.right) { val = idx; continue; }
          if (clientX >= box.left) {
            val = (clientX - box.left) < box.width / 2 ? idx - 0.5 : idx;
            break;
          }
        }
        return val;
      };
      const renderRating = (v) => {
        if (v === rating) return;
        rating = v;
        ratingPicker.innerHTML = starRow(v, { interactive: true, size: 34 });
        buzz(); // a soft detent each half-star, like the hours ruler
      };

      let ratingDragging = false;
      ratingPicker.addEventListener('pointerdown', (e) => {
        ratingDragging = true;
        try { ratingPicker.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
        renderRating(ratingFromX(e.clientX));
        e.preventDefault();
      });
      ratingPicker.addEventListener('pointermove', (e) => {
        if (!ratingDragging) return;
        renderRating(ratingFromX(e.clientX));
      });
      const endRating = (e) => {
        if (!ratingDragging) return;
        ratingDragging = false;
        try { ratingPicker.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      };
      ratingPicker.addEventListener('pointerup', endRating);
      ratingPicker.addEventListener('pointercancel', endRating);
    }

    if (existingLog) {
      qs('#delete-log', overlay).addEventListener('click', async () => {
        if (!confirm('Delete this entry? This can\'t be undone.')) return;
        try {
          await api.deleteLog(existingLog.id);
          toast('Entry deleted.', 'success');
          close();
          onSaved({ deleted: true, log: existingLog });
        } catch (err) {
          toast(err.message || 'Could not delete.', 'error');
        }
      });
    }

    qs('#log-form', overlay)?.addEventListener('submit', async (e) => {
      e.preventDefault();

      // A game that hasn't come out can't have been played or be in
      // progress. Wishlist/backlog are fine — those are exactly what
      // you'd want an unreleased game marked as.
      // Compare the FULL date, not just the year. The previous version
      // checked `year > currentYear`, so anything releasing later this
      // same year (a Feb 2026 title checked in 2026) never tripped it.
      const now = new Date(); now.setHours(0, 0, 0, 0);
      let unreleased = false;
      if (g.release_date) {
        const rd = new Date(g.release_date);
        unreleased = !isNaN(rd) && rd > now;
      } else if (g.release_year) {
        unreleased = Number(g.release_year) > now.getFullYear();
      }
      if (unreleased && (currentStatus === 'playing' || currentStatus === 'played')) {
        toast(`${g.title} isn't out yet — add it to your backlog or wishlist instead.`, 'error');
        return;
      }

      const form = new FormData(e.target);
      const payload = {
        game_id: g.id,
        user_id: state.user.id,
        status: currentStatus,
        rating: rating > 0 ? rating : null,
        review: form.get('review')?.trim() || null,
        // 0 means "didn't say", not "took no time".
        hours_played: hoursValue && hoursValue > 0 ? hoursValue : null,
        played_date: currentStatus === 'backlog' ? null : (form.get('played_date') || null),
        is_replay: form.has('is_replay'),
        contains_spoilers: form.has('contains_spoilers'),
        is_public: form.has('is_public'),
      };
      const btn = qs('button[type="submit"]', overlay);
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        let saved;
        if (existingLog) {
          saved = await api.updateLog(existingLog.id, payload);
        } else {
          saved = await api.createLog(payload);
        }
        toast(existingLog ? 'Entry updated.' : 'Logged!', 'success');
        // The one moment worth celebrating — a brand new "played" entry,
        // not an edit and not backlog/playing. Fires after close() so the
        // burst survives the sheet's own removal instead of vanishing
        // with it.
        const firstPlay = !existingLog && currentStatus === 'played';
        close();
        if (firstPlay) celebrate();
        onSaved({ log: saved });
      } catch (err) {
        toast(err.message || 'Could not save that entry.', 'error');
        btn.disabled = false;
        btn.textContent = 'Save entry';
      }
    });

    // Fetch the synopsis in the background if we don't already have it —
    // updates just that one slot so it never disturbs whatever the person
    // has already typed into the rating/review fields above.
    if (!g.igdb_enriched && g.igdb_id) {
      api.enrichGameDetails(g).then((enriched) => {
        selectedGame = enriched;
        if (enriched.description) {
          const slot = qs('#log-form-synopsis-slot', overlay);
          if (slot) slot.innerHTML = `<p class="log-form__synopsis">${esc(enriched.description)}</p>`;
        }
      }).catch(() => { /* synopsis is a nice-to-have, fine if this quietly fails */ });
    }
  }

  // Shown first when no game was passed in (e.g. the feed's "+" log
  // button) — search, pick a game, then paintForm() takes over.
  function paintPicker() {
    overlay.innerHTML = `
      <div class="modal modal--tall log-sheet">
        <header class="modal__header">
          <h2>Log a game</h2>
          <button class="modal__close" data-close aria-label="Close">${iconClose()}</button>
        </header>
        <div class="modal__body">
          <label class="field"><span>Search for a game</span><input type="text" id="log-picker-search" autocomplete="off" placeholder="Start typing a title…"></label>
          <div id="log-picker-results"></div>
        </div>
      </div>`;

    qs('[data-close]', overlay)?.addEventListener('click', close);
    enableSwipeToDismiss(qs('.modal', overlay), close);

    const input = qs('#log-picker-search', overlay);
    const results = qs('#log-picker-results', overlay);

    const doSearch = debounce(async () => {
      const q = input.value.trim();
      if (!q) { results.innerHTML = ''; return; }
      results.innerHTML = '<p class="muted">Searching…</p>';
      try {
        const { results: found } = await api.searchGamesEverywhere(q);
        results.innerHTML = combinedGameResults(found);
        wireCombinedGameResults(results, found, {
          onLocal: (game) => { selectedGame = game; paintForm(); },
          onRemote: async (game) => { selectedGame = await api.addGame(game, state.user.id); paintForm(); },
        });
      } catch (err) {
        results.innerHTML = `<p class="muted">Couldn't search right now: ${esc(err.message)}</p>`;
      }
    }, 350);
    input.addEventListener('input', doSearch);
    input.focus();
  }

  if (selectedGame) paintForm();
  else paintPicker();
}
