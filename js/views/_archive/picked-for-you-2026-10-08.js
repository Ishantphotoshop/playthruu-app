// ARCHIVED 2026-10-08 — "Picked for you", the personal poster strip that sat
// between Currently playing and "Bored? Try these" on the Feed.
//
// Why it went: it read as a second copy of "Bored? Try these" (both are a
// row of posters of games to try), it never said why a game was picked, and
// the feed waited on its recommendation query before revealing anything.
// The recommendation engine itself (getRecommendations in api.js) was left
// in place.
//
// To bring it back:
//   1. Paste paintForYou (and FORYOU_SHOWN / forYouOnLogs) into
//      js/views/feed-view.js, above paintDiscovery.
//   2. Add `<div id="foryou-section"></div>` to the feed's section list and
//      `paintForYou(qs('#foryou-section', body)),` to the Promise.allSettled
//      in paintFeedTab.
//   3. Paste the rules from picked-for-you-2026-10-08.css into css/styles.css
//      (and put .foryou-strip back into the strip selectors listed there).
//   Needs from feed-view.js: api, state, feedSectionHead, posterFrame,
//   iconBookmarkFilled, qs, qsa, esc, toast, tapFeedback, pulseLogTab,
//   navigate, markPagesStale.

// Posters only — no title, no "because you..." line. The reason line
// used to be here on the argument that a suggestion which cannot say
// why is indistinguishable from a list of popular games. In practice it
// turned a row of artwork into a row of small print, and the section
// already earns its place by WHAT it contains: games like the ones you
// have actually been playing lately (see getRecommendations), none of
// which are already in your diary.
//
// Renders nothing at all when there is nothing personal to say, rather
// than falling back to something generic under a "picked for you"
// heading, which would be a lie about where it came from.
//
// The strip shows FORYOU_SHOWN picks; the rest of the ranked pool waits
// behind them. Whenever anything is logged, from anywhere (double-tap
// here, the hold composer, a game page), every visible pick now in the
// diary fades out and the next one from the pool takes its place. When
// the pool runs low it is rebuilt, which also folds in whatever was just
// played as a new seed.
const FORYOU_SHOWN = 12;
let forYouOnLogs = null;

async function paintForYou(slot) {
  if (!slot || !state.user) return;
  const userId = state.user.id;
  let pool = [];
  try {
    pool = await api.getRecommendations(userId);
  } catch {
    slot.innerHTML = '';
    return;
  }
  if (!pool.length) { slot.innerHTML = ''; return; }

  const shown = pool.splice(0, FORYOU_SHOWN);
  const seen = new Set(shown.map((p) => p.game.igdb_id));
  pool.forEach((p) => seen.add(p.game.igdb_id));

  // feedSectionHead (with no see-more), not a bare <h2>: every other
  // section on this page is built from it, and one section using a
  // different wrapper is exactly why the gap above this one was 8px
  // tighter than the gap above all the others.
  slot.innerHTML = `
    ${feedSectionHead('Picked for you')}
    <div class="foryou-strip" id="foryou-strip">${shown.map(cardHtml).join('')}</div>`;
  const strip = qs('#foryou-strip', slot);
  qsa('.foryou-card', strip).forEach((btn, i) => wireCard(btn, shown[i]));

  function cardHtml(p) {
    return `
      <button type="button" class="foryou-card" data-igdb-id="${esc(String(p.game.igdb_id ?? ''))}" data-year="${esc(String(p.game.release_year ?? ''))}" aria-label="${esc(p.game.title)}">
        ${posterFrame(p.game.cover_url, p.game.title, 'foryou-card__cover')}
        <span class="discovery-tile__saved" aria-hidden="true">${iconBookmarkFilled()}</span>
      </button>`;
  }

  // Tap opens the game; double-tap saves it to the backlog. The single
  // tap waits out the double-tap window first, otherwise the first tap
  // of a double would already be navigating away.
  function wireCard(btn, pick) {
    let timer = null;
    btn.addEventListener('pointerdown', () => api.warmGameByIgdb(Number(btn.dataset.igdbId)), { passive: true });
    btn.addEventListener('click', () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        quickSave(btn, pick);
        return;
      }
      timer = setTimeout(() => { timer = null; open(btn, pick); }, 220);
    });
  }

  // A guard flag, not btn.disabled: navigating away leaves this card
  // sitting in the kept page, and a disabled one came back faded and
  // dead to taps when you returned to it.
  async function open(btn, pick) {
    if (btn.dataset.opening) return;
    btn.dataset.opening = '1';
    setTimeout(() => { delete btn.dataset.opening; }, 1500);
    try {
      const saved = await api.addGame(pick.game, userId);
      navigate(`/game/${saved.id}`);
    } catch (err) {
      toast(err.message || 'Could not open that game.', 'error');
      delete btn.dataset.opening;
    }
  }

  async function quickSave(btn, pick) {
    if (btn.dataset.saving) return;
    btn.dataset.saving = '1';
    const badge = qs('.discovery-tile__saved', btn);
    badge.classList.remove('is-popping'); void badge.offsetWidth; badge.classList.add('is-popping');
    tapFeedback();
    try {
      const saved = await api.addGame(pick.game, userId);
      await api.createLog({ game_id: saved.id, user_id: userId, status: 'backlog', is_public: true });
      markPagesStale();
      pulseLogTab();
      toast(`Saved ${saved.title} to your backlog.`, 'success');
      // createLog fires logs:changed, which swaps this card out.
    } catch (err) {
      toast(err.message || 'Could not save that game.', 'error');
      delete btn.dataset.saving;
    }
  }

  async function nextPick(diary) {
    for (;;) {
      if (pool.length < 4 && !nextPick.refilling) {
        nextPick.refilling = api.getRecommendations(userId).then((fresh) => {
          fresh.forEach((p) => { if (!seen.has(p.game.igdb_id)) { seen.add(p.game.igdb_id); pool.push(p); } });
        }).catch(() => {}).finally(() => { nextPick.refilling = null; });
      }
      if (!pool.length && nextPick.refilling) await nextPick.refilling;
      const p = pool.shift();
      if (!p) return null;
      if (!diary.igdb.has(p.game.igdb_id)) return p;
    }
  }

  async function onLogs() {
    if (!strip.isConnected) { window.removeEventListener('logs:changed', onLogs); return; }
    let diary;
    try { diary = await api.getDiaryGameKeys(userId); } catch { return; }
    const gone = qsa('.foryou-card', strip).filter((btn) => diary.igdb.has(Number(btn.dataset.igdbId)));
    for (const btn of gone) {
      const next = await nextPick(diary);
      btn.classList.add('is-leaving');
      await new Promise((r) => setTimeout(r, 380)); // past the save badge pop
      if (!next) { btn.remove(); continue; }
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(next).trim();
      const card = tmp.firstElementChild;
      card.classList.add('is-entering');
      btn.replaceWith(card);
      wireCard(card, next);
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('is-entering')));
    }
    if (!qs('.foryou-card', strip)) slot.innerHTML = '';
    setCached(FEED_CACHE_KEY, qs('#feed-sections')?.innerHTML || '');
  }

  if (forYouOnLogs) window.removeEventListener('logs:changed', forYouOnLogs);
  forYouOnLogs = onLogs;
  window.addEventListener('logs:changed', onLogs);
}
