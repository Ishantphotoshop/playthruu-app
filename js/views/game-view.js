import * as api from '../api.js';
import { state } from '../state.js';
import {
  navBar, spinner, logCard, emptyState, posterFrame, iconUser, iconBack,
} from '../components.js';
import { esc, starRow, formatDate, qs, qsa, toast, promptSignIn, recordRecentlyViewed, pulseLogTab } from '../utils.js';
import { openLogModal } from './log-modal.js';
import { openAddToListPicker } from './lists-view.js';
import { refreshCurrentView, navigate } from '../router.js';
import { wireLogCards } from './feed-view.js';

// Simple geometric marks for the "Playable on" row — not literal brand
// logos (nothing here is verified pixel-accurate without a live render,
// and several of these are trademarked anyway), just clean, recognisable
// abstractions in the app's own plain-line icon style: PlayStation's
// four face-button shapes, Xbox's four-blade pinwheel, a Joy-Con pair
// for Switch, a monitor for PC, a handset for mobile. Falls back to a
// plain dot for anything unrecognised so an unusual platform still gets
// *a* mark instead of breaking the row.
function platformIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('playstation') || /\bps[1-5]\b/.test(n)) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.6 15 11"/><circle cx="16.2" cy="13.6" r="1.6"/><path d="m12 4.6-3 6.4"/><path d="M7.8 13.6a1.6 1.6 0 1 1 0-.1z"/><circle cx="12" cy="16.2" r="1.6"/><circle cx="12" cy="9.4" r="1.6"/></svg>`;
  }
  if (n.includes('xbox')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M7 7.2C9 9.6 10.6 11 12 12.4M17 7.2c-2 2.4-3.6 3.8-5 5.2M7 16.8c2-2.4 3.6-3.8 5-5.2M17 16.8c-2-2.4-3.6-3.8-5-5.2"/></svg>`;
  }
  if (n.includes('switch') || n.includes('nintendo')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="6.5" height="16" rx="3.2"/><rect x="14.5" y="4" width="6.5" height="16" rx="3.2"/><circle cx="6.25" cy="8" r="0.9" fill="currentColor" stroke="none"/></svg>`;
  }
  if (n.includes('pc') || n.includes('windows') || n.includes('mac') || n.includes('linux') || n.includes('steam')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="12.5" rx="1.6"/><path d="M9 20.5h6M12 17v3.5"/></svg>`;
  }
  if (n.includes('ios') || n.includes('android') || n.includes('mobile')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.2"/><path d="M10.5 18.2h3" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="3"/></svg>`;
}

function compactNumber(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'm';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
  return String(n);
}

// Shared by the header's compact credits preview and the full Cast tab
// below it — one Wikidata photo helper so both stay visually identical.
// Portraits come from Wikidata's P18; coverage is partial even for
// well-documented games, so the initial-letter tile is the normal case
// rather than an error state, and `onerror` swaps back to it if a
// Commons file 404s or is hotlink-blocked.
function facePic(p, cls) {
  return p.photo
    ? `<img class="crew-row__photo ${cls}" src="${esc(p.photo)}" alt="" loading="lazy"
            onerror="this.outerHTML='<span class=\\'crew-row__photo ${cls} crew-row__photo--initial\\'>${esc((p.name || '?').charAt(0).toUpperCase())}</span>'">`
    : `<span class="crew-row__photo ${cls} crew-row__photo--initial">${esc((p.name || '?').charAt(0).toUpperCase())}</span>`;
}

// The director on their own — sits where the genre tags used to, right
// under the title, so it's the first credited detail anyone sees.
// Deliberately separate from the cast preview below: cast is cast,
// director is its own line, not folded into the same strip.
function directorChipHtml(director) {
  if (!director) return '';
  // RAWG's own profile (real photo, real bio, real filmography) beats
  // Wikidata's whenever RAWG recognizes this director — see director-
  // view.js. Only falls back to the Wikidata person page when RAWG has
  // no match for them at all.
  const href = director.rawgSlug ? `#/director/${director.rawgSlug}` : director.qid ? `#/person/${director.qid}` : '';
  return `
    <a class="gd-credit-chip" ${href ? `href="${href}"` : ''}>
      ${facePic(director, 'gd-credit-chip__photo')}
      <span>Dir. ${esc(director.name)}</span>
    </a>`;
}

// The voice cast preview — an overlapping stack of the first few
// portraits, staying in its original spot near the score/trailer line.
// Links into the full Cast tab (already right below), which has the
// complete list, characters, and bios — this is just a teaser of it.
function castPreviewHtml(cast) {
  if (!cast || !cast.length) return '';
  const shown = cast.slice(0, 4);
  const extra = cast.length - shown.length;
  return `
    <button type="button" class="gd-cast-preview" id="cast-preview-jump" aria-label="Jump to voice cast">
      ${shown.map((p) => facePic(p, 'gd-cast-preview__photo')).join('')}
      ${extra > 0 ? `<span class="gd-cast-preview__more">+${extra}</span>` : ''}
    </button>`;
}

// `igdbId` is the "view without a database row" path — reached when
// someone taps a game that isn't in the catalogue yet while signed out
// (see landing-view.js's openGame). Viewing was always meant to be free
// everywhere in this app (search, browse, discover); this page was the
// one place that broke that rule, by requiring an insert just to be
// looked at. getIgdbGameDetail fetches everything needed to render
// straight from IGDB, `id: null`, no write — ensureSavedGame() below is
// what actually inserts it, and only runs when someone takes a real
// action (log, backlog, add to list), which is exactly when this app
// already asks for an account everywhere else.
export async function renderGameView(root, { id, igdbId }) {
  // No topbar strip/title here — the game's real title already shows
  // big in .gd-head below, so a generic "Game" label bar added nothing,
  // and it cut a hard rectangle across the hero image right where the
  // whole point of .gd-hero__scrim/--hero-fade is a seamless blend.
  // Just the back button, floating on its own (see .game-back).
  root.innerHTML = `<button type="button" class="topbar__back game-back" data-action="back" aria-label="Back">${iconBack()}</button>`
    + `<div class="view-body" id="game-body"><div class="view-loading" id="game-loading" hidden>${spinner()}</div></div>` + navBar('');
  const body = qs('#game-body', root);
  let activeTab = 'cast';
  let crewCache = null;
  let castDirectorData = null; // { director, cast } — resolved below, before the first paint

  // Most games are already catalogued and resolve in well under this —
  // showing the spinner immediately would flash it for a fraction of a
  // second on every fast open, which reads as jankier than not showing
  // anything at all. Only reveal it if the wait actually runs long
  // enough for a person to notice.
  const loadingEl = qs('#game-loading', body);
  const showLoadingTimer = setTimeout(() => { loadingEl.hidden = false; }, 200);

  try {
    // Everything the first paint needs is resolved before painting,
    // EXCEPT cast/director — see loadCastDirector below for why that
    // one loads separately, after the page is already up.
    let game = id ? await api.getGame(id) : await api.getIgdbGameDetail(igdbId);
    if (!game) throw new Error("Couldn't find that game.");

    // getIgdbGameDetail already fetched everything enrichGameDetails
    // would (and set igdb_enriched: true), so there's nothing left to
    // enrich in igdbId mode; likewise a game with no local id has, by
    // definition, zero logs/reviews/lists anywhere — real emptiness,
    // not a fallback — so those are skipped rather than queried with an
    // id that doesn't exist.
    const enrichNeeded = !game.igdb_enriched && game.igdb_id;
    // Cast/director caches on the row after its first real fetch (see
    // getGameCastAndDirector in api.js), but that first fetch can
    // legitimately run several seconds (RAWG + a couple of Wikidata
    // round trips, more on a title that needs the edition-suffix
    // retry). It used to block the whole page behind a 3s timeout that
    // gave up and showed a dead-end "try again later" message — instead
    // of blocking the page or truncating the wait, it now loads AFTER
    // the rest of the page paints, with its own spinner in the Cast tab
    // that swaps for the real content the moment it resolves, however
    // long that actually takes.
    const [enriched, logs, breakdown, listsCount] = await Promise.all([
      enrichNeeded ? api.enrichGameDetails(game).catch(() => game) : Promise.resolve(game),
      id ? api.getLogsForGame(id) : Promise.resolve([]),
      id ? api.getGameRatingBreakdown(id) : Promise.resolve({}),
      id ? api.getListsCountForGame(id) : Promise.resolve(0),
    ]);
    game = enriched || game;

    const rated = logs.filter(l => l.rating);
    const avg = rated.length ? (rated.reduce((s, l) => s + Number(l.rating), 0) / rated.length) : null;
    const likes = await api.getLikesForLogs(logs.map(l => l.id), state.user?.id);
    const ownLogs = state.user ? logs.filter(l => l.user_id === state.user.id) : []; // already newest-first
    const ownLog = ownLogs[0] || null;

    clearTimeout(showLoadingTimer);
    paintGame();
    loadMoreFromStudio();
    recordRecentlyViewed(game);
    loadCastDirector();

    // Runs after the page has already painted (castDirectorData starts
    // null, which paintTabContent's Cast branch renders as a spinner —
    // see below). Updates the header's director chip and cast-preview
    // avatars, plus the Cast tab itself if it's the one currently open,
    // once the real result is in — no arbitrary cutoff, it just shows
    // up whenever it's actually ready.
    async function loadCastDirector() {
      try {
        castDirectorData = await api.getGameCastAndDirector(game);
      } catch {
        castDirectorData = { director: null, cast: [] };
      }
      const directorSlot = qs('#director-slot', body);
      if (directorSlot) directorSlot.innerHTML = directorChipHtml(castDirectorData.director);
      const castPreviewSlot = qs('#cast-preview-slot', body);
      if (castPreviewSlot) castPreviewSlot.innerHTML = castPreviewHtml(castDirectorData.cast);
      wireCastPreviewJump();
      if (activeTab === 'cast') paintTabContent();
    }

    // Tapping the cast-avatar stack in the header preview jumps straight
    // to the full Cast tab, which is already right below on the page.
    function wireCastPreviewJump() {
      const jump = qs('#cast-preview-jump', body);
      if (!jump) return;
      jump.addEventListener('click', () => {
        activeTab = 'cast';
        qsa('.gd-tab', body).forEach((t) => t.classList.toggle('gd-tab--active', t.dataset.tab === 'cast'));
        paintTabContent();
        qs('#game-tabs', body)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    // "More from [Studio]" — a discovery strip at the bottom of the page
    // using the game's own developer credit. Two sequential IGDB calls
    // (find the developer's company id via the Studios lookup, then that
    // studio's own catalogue), so it loads in lazily after the page is
    // already usable rather than blocking the initial paint. Silently
    // shows nothing if the game has no igdb_id, no credited developer,
    // or that developer only has this one game — never an error state
    // for what's a nice-to-have, not a core part of the page.
    async function loadMoreFromStudio() {
      if (!game.igdb_id) return;
      try {
        const studios = await api.getGameStudios(game.igdb_id);
        const developer = studios.find((s) => s.roles.includes('Developer'));
        if (!developer) return;
        const profile = await api.getStudioProfile(developer.igdb_id);
        const more = (profile?.games || []).filter((g) => g.igdb_id !== game.igdb_id).slice(0, 10);
        if (!more.length) return;
        const slot = qs('#more-from-slot', body);
        if (!slot) return; // page was navigated away from before this landed
        slot.innerHTML = `
          <div class="gd-row">
            <span class="gd-kicker">More from ${esc(developer.name)}</span>
          </div>
          <div class="trending-strip">
            ${more.map((g, i) => `
              <button type="button" class="trending-card" data-idx="${i}" aria-label="${esc(g.title)}">
                ${posterFrame(g.cover_url, g.title, 'trending-card__cover')}
              </button>`).join('')}
          </div>`;
        qsa('.trending-card', slot).forEach((el) => {
          el.addEventListener('click', async () => {
            el.disabled = true;
            const g = more[Number(el.dataset.idx)];
            try {
              const saved = await api.addGame({ igdb_id: g.igdb_id, title: g.title, cover_url: g.cover_url, release_year: g.year }, state.user?.id ?? null);
              location.hash = `#/game/${saved.id}`;
            } catch (err) {
              toast(err.message || 'Could not open that game.', 'error');
              el.disabled = false;
            }
          });
        });
      } catch { /* discovery extra, fine to quietly skip on any failure */ }
    }

    // Viewing this page never needed a database row (see getIgdbGameDetail
    // in api.js) — game.id is null until someone actually does something
    // that needs one. This is that moment: called right before any write
    // action (log, backlog, add to list), it inserts the game now if it
    // isn't saved yet, swaps the URL over to its real /game/:id (so a
    // refresh or share link lands on the full page, not another live
    // fetch), and returns the saved row. Already-saved games (the normal
    // case) just return immediately, no extra write.
    async function ensureSavedGame() {
      if (game.id) return game;
      try {
        const saved = await api.addGame(game, state.user.id);
        game = saved;
        navigate(`/game/${saved.id}`);
        return saved;
      } catch (err) {
        toast(err.message || 'Could not save that game.', 'error');
        return null;
      }
    }

    function paintGame() {
      const reviewedLogs = logs.filter(l => l.review);
      // Most-liked first — likes are already loaded by this point (see
      // the Promise.all above), so this is the real order, not a
      // temporary placeholder.
      const topReviews = [...reviewedLogs]
        .sort((a, b) => (likes[b.id]?.count || 0) - (likes[a.id]?.count || 0))
        .slice(0, 5);
      const poster = game.cover_url;

      // --- derived stats for the strip -----------------------------
      // Ten bars, one per half-star step, matching how ratings are
      // actually stored — folding them into five whole stars threw away
      // the distinction between a 3.5 and a 4.
      const halfSteps = [];
      for (let v = 0.5; v <= 5; v += 0.5) halfSteps.push(Number(v.toFixed(1)));
      const stepCounts = halfSteps.map((v) => breakdown[v.toFixed(1)] || 0);
      const stepMax = Math.max(1, ...stepCounts);
      const beatenPct = logs.length
        ? Math.round((logs.filter((l) => l.status === 'played').length / logs.length) * 100)
        : null;
      // "Typical" prefers what this game's own players reported over the
      // single static figure that came from the games catalogue — the
      // catalogue value is only the fallback until real logs exist.
      const reportedHours = logs.map((l) => Number(l.hours_played)).filter((h) => h > 0);
      const typicalHours = reportedHours.length
        ? Math.round(reportedHours.reduce((s, h) => s + h, 0) / reportedHours.length)
        : (game.playtime_hours || null);
      const replayCount = logs.filter((l) => l.is_replay).length;
      const platforms = (game.platform || '').split(',').map((p) => p.trim()).filter(Boolean);
      const year = game.release_year || (game.release_date ? new Date(game.release_date).getFullYear() : null);
      const headMeta = [game.developer, year].filter(Boolean).join(' · ');

      const statCell = (value, label) =>
        `<div class="gd-stat"><b>${value}</b><span>${label}</span></div>`;

      body.innerHTML = `
        <div class="gd">

          <div class="gd-hero">
            ${game.background_url ? `
              <div class="gd-hero__bg" style="background-image:url('${esc(game.background_url)}')"></div>
              <div class="gd-hero__scrim"></div>` : ''}
            <header class="gd-head">
              ${posterFrame(poster, game.title, 'gd-head__cover', { id: 'game-cover' })}
              <div class="gd-head__main">
                <h1 class="gd-head__title">${esc(game.title)}</h1>
                ${headMeta ? `<p class="gd-kicker">${esc(headMeta)}</p>` : ''}
                <div id="director-slot">${directorChipHtml(castDirectorData?.director)}</div>
                <div class="gd-score">
                  ${avg ? `<span class="gd-score__num">${avg.toFixed(1)}</span>` : ''}
                  <span class="gd-kicker">${rated.length} log${rated.length === 1 ? '' : 's'}</span>
                  ${game.trailer_url ? `<button type="button" class="gd-link gd-link--trailer" id="play-trailer">▶ Trailer</button>` : ''}
                  <div id="cast-preview-slot">${castPreviewHtml(castDirectorData?.cast)}</div>
                </div>
              </div>
            </header>
          </div>

          ${game.description ? `<p class="gd-synopsis">${esc(game.description)}</p>` : ''}

          ${rated.length ? `
            <section class="gd-dist" id="rating-chart-slot">
              <div class="gd-dist__bars">
                ${halfSteps.map((star, i) => {
                  const count = stepCounts[i];
                  const label = `${count} log${count === 1 ? '' : 's'} rated ${star} star${star === 1 ? '' : 's'}`;
                  return `
                  <button type="button" class="gd-dist__col" data-rating="${star}"
                          aria-label="${label}" title="${label}">
                    <span class="gd-dist__bar" style="height:${Math.max(2, Math.round((count / stepMax) * 100))}%"></span>
                  </button>`;
                }).join('')}
              </div>
              <div class="gd-dist__axis">
                <span class="gd-kicker">0.5 ★</span>
                <span class="gd-kicker">5 ★</span>
              </div>
            </section>`
            : `<p class="gd-empty">No ratings yet — be the first.</p>`}

          ${ownLog
            ? `<div class="gd-actions">
                 <button type="button" class="gd-btn gd-btn--primary" id="edit-own-log">Edit your log${ownLogs.length > 1 ? ` · ${ownLogs.length}×` : ''}</button>
                 <button type="button" class="gd-btn" id="log-again">Log again</button>
                 <button type="button" class="gd-btn gd-btn--icon" id="add-to-list" aria-label="Add to list">${iconStack()}</button>
               </div>`
            : `<div class="gd-actions">
                 <button type="button" class="gd-btn gd-btn--primary" id="log-this-game">LOG it</button>
                 <button type="button" class="gd-btn" id="add-backlog">Backlog</button>
                 <button type="button" class="gd-btn gd-btn--icon" id="add-to-list" aria-label="Add to list">${iconStack()}</button>
               </div>`}

          <div class="gd-strip">
            ${statCell(typicalHours ? `${typicalHours}h` : '—', 'Typical')}
            ${statCell(beatenPct === null ? '—' : `${beatenPct}%`, 'Beat it')}
            ${statCell(replayCount, 'Replays')}
            ${statCell(platforms.length || '—', 'Platforms')}
          </div>

          ${platforms.length ? `
            <section class="gd-section">
              <span class="gd-kicker">Playable on</span>
              <div class="gd-platforms">
                ${platforms.map((p) => `
                  <span class="gd-platform" title="${esc(p)}">
                    <span class="gd-platform__icon">${platformIcon(p)}</span>
                    <span>${esc(p)}</span>
                  </span>`).join('')}
              </div>
            </section>` : ''}

          <div class="gd-tabs" id="game-tabs">
            <button class="gd-tab gd-tab--active" data-tab="cast">Cast</button>
            <button class="gd-tab" data-tab="details">Details</button>
          </div>
          <div id="game-tab-content"></div>

          <div class="gd-row gd-row--reviews">
            <span class="gd-kicker">Reviews</span>
            ${reviewedLogs.length ? `<a href="#/game/${id}/reviews" class="gd-link">All ${reviewedLogs.length}</a>` : ''}
          </div>
          <div id="review-filter-slot"></div>
          <div class="log-list gd-reviews" id="game-reviews"></div>

          <div id="more-from-slot"></div>
        </div>`;

      // Reviews are painted separately from the rest of the page so that
      // tapping a bar in the distribution can repaint just this list
      // rather than re-rendering (and re-fetching) the whole screen.
      let ratingFilter = null;

      function paintReviews() {
        const listEl = qs('#game-reviews', body);
        const filterEl = qs('#review-filter-slot', body);
        if (!listEl) return;

        const shown = ratingFilter === null
          ? topReviews
          : reviewedLogs.filter((l) => Number(l.rating) === ratingFilter);

        filterEl.innerHTML = ratingFilter === null ? '' : `
          <div class="gd-filter">
            <span class="gd-kicker">Showing ${ratingFilter} ★ only · ${shown.length}</span>
            <button type="button" class="gd-link" id="clear-rating-filter">Clear</button>
          </div>`;

        listEl.innerHTML = shown.length
          ? shown.map((l) => logCard(l, { showAuthor: true, likeInfo: likes[l.id], ownLog: l.user_id === state.user?.id })).join('')
          : `<p class="gd-empty">${ratingFilter === null
              ? 'No written reviews yet — be the first.'
              : `No written reviews at ${ratingFilter} ★.`}</p>`;

        // Re-wire after every repaint: the previous nodes (and their
        // listeners) are gone once innerHTML is replaced.
        wireLogCards(listEl, logs);
        const clearBtn = qs('#clear-rating-filter', body);
        if (clearBtn) clearBtn.addEventListener('click', () => { setRatingFilter(null); });
      }

      function setRatingFilter(star) {
        ratingFilter = star;
        qsa('.gd-dist__col', body).forEach((b) => {
          b.classList.toggle('gd-dist__col--active', Number(b.dataset.rating) === star);
        });
        paintReviews();
      }

      qsa('.gd-dist__col', body).forEach((btn) => {
        btn.addEventListener('click', () => {
          const star = Number(btn.dataset.rating);
          // Tapping the active bar again clears the filter, so the chart
          // doubles as its own toggle and there's always a way back.
          setRatingFilter(ratingFilter === star ? null : star);
        });
      });

      paintReviews();

      const coverEl = qs('#game-cover', body);
      if (coverEl) coverEl.addEventListener('click', () => openPosterViewer(poster, game.title));

      // "All N" is a real link now, so its href does the navigating —
      // no click handler needed.
      const logBtn = qs('#log-this-game', body);
      if (logBtn) logBtn.addEventListener('click', async () => {
        // Game pages are open to anyone now (see landing-view.js), but
        // logging one writes a row — that needs an account.
        if (!state.user) { promptSignIn('Sign in to log this game.'); return; }
        const saved = await ensureSavedGame();
        if (saved) openLogModal({ game, onSaved: () => refreshCurrentView() });
      });
      const editBtn = qs('#edit-own-log', body);
      if (editBtn) editBtn.addEventListener('click', () => openLogModal({ existingLog: ownLog, onSaved: () => refreshCurrentView() }));
      const logAgainBtn = qs('#log-again', body);
      if (logAgainBtn) logAgainBtn.addEventListener('click', async () => {
        const saved = await ensureSavedGame();
        if (saved) openLogModal({ game, defaultReplay: true, onSaved: () => refreshCurrentView() });
      });
      const trailerBtn = qs('#play-trailer', body);
      if (trailerBtn) trailerBtn.addEventListener('click', () => openTrailer(game.trailer_url));

      // One tap straight onto the backlog — the full log sheet asks for
      // a rating and a date, neither of which mean anything for a game
      // you haven't started.
      const backlogBtn = qs('#add-backlog', body);
      if (backlogBtn) backlogBtn.addEventListener('click', async () => {
        if (!state.user) { promptSignIn('Sign in to save games.'); return; }
        backlogBtn.disabled = true;
        try {
          const saved = await ensureSavedGame();
          if (!saved) { backlogBtn.disabled = false; return; }
          await api.createLog({ game_id: game.id, user_id: state.user.id, status: 'backlog', is_public: true });
          pulseLogTab();
          toast('Added to your backlog.', 'success');
          refreshCurrentView();
        } catch (err) {
          toast(err.message || 'Could not add that.', 'error');
          backlogBtn.disabled = false;
        }
      });

      const listBtn = qs('#add-to-list', body);
      if (listBtn) listBtn.addEventListener('click', async () => {
        if (!state.user) { promptSignIn('Sign in to save games.'); return; }
        const saved = await ensureSavedGame();
        if (saved) openAddToListPicker(game);
      });

      // Review cards are wired inside paintReviews(), which runs on every
      // repaint — wiring them again here would double up every like
      // handler on the initial render.

      qsa('.gd-tab', body).forEach((btn) => {
        btn.addEventListener('click', () => {
          activeTab = btn.dataset.tab;
          qsa('.gd-tab', body).forEach((b) => b.classList.toggle('gd-tab--active', b === btn));
          paintTabContent();
        });
      });
      wireCastPreviewJump();
      paintTabContent();
    }

    async function paintTabContent() {
      const slot = qs('#game-tab-content', body);
      if (!slot) return;
      if (activeTab === 'cast') {
        if (castDirectorData === null) {
          // The real loading state now — cast/director loads after the
          // rest of the page (see loadCastDirector above), so this
          // shows until that resolves, however long it actually takes.
          slot.innerHTML = spinner();
          return;
        }
        const cast = castDirectorData.cast;

        // Director already shows next to the game's title (#director-slot
        // in the header above) — repeating it here just duplicated it.
        // This tab is voice cast only now.
        slot.innerHTML = cast.length
          ? `<div class="crew-list">${cast.map((p) => `
                <a href="#/person/${p.qid}" class="crew-row">
                  ${facePic(p, '')}
                  <div class="crew-row__info">
                    <div class="crew-row__name">${esc(p.name)}</div>
                    <div class="crew-row__role">${p.characters.length ? esc(p.characters.join(', ')) : 'Voice actor'}</div>
                  </div>
                </a>`).join('')}</div>`
          : `<p class="gd-empty">No cast listed for this game on Wikidata yet — coverage there is community-maintained.</p>`;
        return;
      }
      if (activeTab === 'details') {
        // Developer/publisher are plain text columns on the game row and
        // are listed here as well as in the Studios block below. The
        // Studios block is IGDB-only (it needs an igdb_id), so without
        // these rows a game added from any other source would show no
        // studio credit anywhere once it stopped being printed next to
        // the title.
        slot.innerHTML = `<div class="game-detail__facts">
          ${game.platform ? factRow('Platforms', esc(game.platform.replace(/PC \(Microsoft Windows\)/g, 'PC').replace(/Microsoft Windows/g, 'PC'))) : ''}
          ${game.genre ? factRow('Genre', esc(game.genre)) : ''}
          ${game.developer ? factRow('Developer', esc(game.developer)) : ''}
          ${game.publisher ? factRow('Publisher', esc(game.publisher)) : ''}
          ${!game.platform && !game.genre && !game.developer && !game.publisher ? '<p class="muted">No extra details yet.</p>' : ''}
        </div>
        <h2 class="section-heading">Studios</h2>
        <div id="studio-slot">${spinner()}</div>`;

        const studioSlot = qs('#studio-slot', slot);
        if (crewCache === null) crewCache = await api.getGameStudios(game.igdb_id);
        studioSlot.innerHTML = crewCache.length
          ? `<div class="crew-list">${crewCache.map((p) => `
              <a href="#/studio/${p.igdb_id}" class="crew-row">
                ${p.logo ? `<img class="crew-row__photo crew-row__photo--studio" src="${esc(p.logo)}" alt="">` : `<span class="crew-row__photo crew-row__photo--fallback">${iconUser()}</span>`}
                <div class="crew-row__info">
                  <div class="crew-row__name">${esc(p.name)}</div>
                  <div class="crew-row__role">${esc(p.roles.join(', '))}</div>
                </div>
              </a>`).join('')}</div>`
          : emptyState('No studio credits available for this game.', { icon: iconUser() });
      }
    }
  } catch (err) {
    clearTimeout(showLoadingTimer);
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this game: ${esc(err.message)}</p>`;
  }
}

function factRow(label, valueHtml) {
  return `<div class="game-detail__fact"><span>${esc(label)}</span><span>${valueHtml}</span></div>`;
}

// Any column on the shared `games` table is attacker-writable, so every
// URL out of it is treated as untrusted before it reaches an src=.
// Escaping alone isn't enough for a src: `javascript:` and `data:text/html`
// are valid, well-formed URLs that need no quote-breakout to execute.
// Only http(s) is allowed through.
function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(url, location.href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false; // unparseable — treat as hostile
  }
}
const isSafeImageUrl = isSafeHttpUrl;

function openTrailer(embedUrl) {
  if (!isSafeHttpUrl(embedUrl)) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay lightbox-overlay';
  overlay.innerHTML = `
    <button class="modal__close lightbox-close" aria-label="Close">${iconCloseSmall()}</button>
    <iframe src="${esc(embedUrl)}?autoplay=1" class="trailer-video" style="border:none" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  qs('.lightbox-close', overlay).addEventListener('click', close);
}

function iconCloseSmall() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`; }
function iconController() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 9h10l2.5 7a2 2 0 0 1-3.7 1.4L14 15h-4l-1.8 2.4A2 2 0 0 1 4.5 16z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 11.5v3M7.5 13h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="12" r="0.9" fill="currentColor"/><circle cx="18" cy="14" r="0.9" fill="currentColor"/></svg>`; }
function iconDoc() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M6 3.5h9l4 4V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 10h6M9 13.5h6M9 17h3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`; }
function iconStack() { return `<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="12" height="16" rx="1.5" stroke="currentColor" stroke-width="1.8"/><path d="M8 1.5h12v16" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" opacity="0.55"/></svg>`; }


// Full-screen artwork viewer. Single tap on the cover opens it; inside,
// double-tap (or double-click) toggles a 2.2x zoom centred on where you
// tapped, and tapping the backdrop or the close button dismisses it.
function openPosterViewer(src, title) {
  if (!src) return;
  // `src` and `title` come from the shared `games` table, which ANY
  // signed-up user can insert rows into. Interpolating them raw let a
  // crafted cover_url (e.g. `x" onerror="...`) break out of the src
  // attribute and run script in the session of everyone who opened
  // that game's cover. Escape both, and only allow http(s) images so a
  // `javascript:`/`data:` URL can't execute either.
  if (!isSafeImageUrl(src)) return;
  const overlay = document.createElement('div');
  overlay.className = 'poster-viewer';
  overlay.innerHTML = `
    <button class="poster-viewer__close" aria-label="Close">&times;</button>
    <img class="poster-viewer__img" src="${esc(src)}" alt="${esc(title || '')}">
    <p class="poster-viewer__hint">Double-tap to zoom</p>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const img = overlay.querySelector('.poster-viewer__img');
  let zoomed = false;

  function close() {
    overlay.remove();
    document.body.style.overflow = '';
  }

  function toggleZoom(clientX, clientY) {
    zoomed = !zoomed;
    if (zoomed) {
      // Anchor the zoom on the tapped point rather than the centre, so
      // double-tapping a detail actually brings that detail closer.
      const r = img.getBoundingClientRect();
      const ox = ((clientX - r.left) / r.width) * 100;
      const oy = ((clientY - r.top) / r.height) * 100;
      img.style.transformOrigin = `${ox}% ${oy}%`;
      img.style.transform = 'scale(2.2)';
      overlay.classList.add('is-zoomed');
    } else {
      img.style.transform = '';
      overlay.classList.remove('is-zoomed');
    }
  }

  // Manual double-tap detection: touch devices don't fire dblclick
  // reliably, so tap timing is tracked directly.
  let lastTap = 0;
  img.addEventListener('click', (e) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTap < 300) {
      toggleZoom(e.clientX, e.clientY);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  });

  overlay.addEventListener('click', () => { if (!zoomed) close(); });
  overlay.querySelector('.poster-viewer__close').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
}
