import * as api from '../api.js';
import { state } from '../state.js';
import {
  navBar, spinner, emptyState, posterFrame, iconUser, iconBack, avatarImg,
  likeButton, iconReply, iconFlag, iconChevronRight,
} from '../components.js';
import { esc, starRow, formatDate, timeAgo, qs, qsa, toast, promptSignIn, recordRecentlyViewed, pulseLogTab } from '../utils.js';
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
    // A handheld silhouette, not two bare pills — at the 24px this
    // renders at, two side-by-side rounded rectangles with nothing
    // joining them read as the digits "00" rather than a console. The
    // connecting screen bar is what breaks that illusion; the dot and
    // stick keep it legible as a Joy-Con rail rather than a plain slab.
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6.5" width="5.5" height="11" rx="2.6"/><rect x="16" y="6.5" width="5.5" height="11" rx="2.6"/><path d="M8 9.5h8v5H8z" stroke-linejoin="round"/><circle cx="5.25" cy="9.7" r="0.85" fill="currentColor" stroke="none"/><path d="M18.75 10.5v3M17.25 12h3" stroke-width="1.4"/></svg>`;
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
// The credit under the title — "2020 · Directed By / Neil Druckmann",
// the year and the attribution line above the name it belongs to. The
// director is the headline credit when there is one; a game with none
// credits its studio instead rather than leaving the line half-empty,
// and a game with neither falls back to the bare year.
//
// Rendered into #director-slot, so it repaints on its own once the
// director lookup lands (see loadCastDirector) — which is why the year
// and developer, both known immediately, are passed in here rather than
// printed separately: otherwise the line would visibly reflow from
// "2020 · Naughty Dog" to "2020 · Directed By / …" mid-read.
function headCreditHtml(year, director, developer) {
  if (director) {
    // RAWG's own profile (real photo, real bio, real filmography) beats
    // Wikidata's whenever RAWG recognizes this director — see director-
    // view.js. Only falls back to the Wikidata person page when RAWG has
    // no match for them at all.
    const href = director.rawgSlug ? `#/director/${director.rawgSlug}` : director.qid ? `#/person/${director.qid}` : '';
    return `
      <span class="gd-credit__line">${year ? `${esc(year)} &middot; ` : ''}Directed By</span>
      <a class="gd-credit__name"${href ? ` href="${href}"` : ''}>${esc(director.name)}</a>`;
  }
  if (developer) {
    return `
      <span class="gd-credit__line">${year ? `${esc(year)} &middot; ` : ''}Developed By</span>
      <span class="gd-credit__name">${esc(developer)}</span>`;
  }
  return year ? `<span class="gd-credit__line">${esc(year)}</span>` : '';
}

// The game's title: a transparent-background logo PNG when one's been
// found (see api.getGameArt), otherwise the plain text heading it always
// was. The <h1> stays present either way — visually hidden behind the
// logo image, not removed — so the page keeps one real, accessible
// heading for screen readers and there's no layout jump when the logo
// swaps in.
function gameTitleHtml(title, logoUrl) {
  return `
    <h1 class="gd-head__title${logoUrl ? ' gd-head__title--hidden' : ''}">${esc(title)}</h1>
    ${logoUrl ? `<img class="gd-head__logo" src="${esc(logoUrl)}" alt="${esc(title)}">` : ''}`;
}

// One "who's doing this" block — Played by / Playing / Want to play —
// a heading with a row of faces under it, each its own section divided
// by a rule, the way the reference lays them out. `entries` is the raw
// logs list for one status; deduped by user here since a replay can
// leave more than one log per person and this is meant to count PEOPLE,
// not rows.
// What the row says depends entirely on where you already stand with
// this game — that's the point of it. Signed out it's an invitation;
// with a log it reports the log back, rating included, so the row is
// worth reading rather than just worth pressing.
function logRowLabel(ownLog) {
  if (!state.user) return 'Rate, log, review + more';
  if (!ownLog) return 'Rate, log, review + more';
  if (ownLog.status === 'backlog') return 'In your backlog';
  if (ownLog.status === 'playing') return `You're playing this`;
  // The verb tracks the status, the way the other two do — "logged" is
  // what the app calls the act, not what you did to the game.
  const stars = ownLog.rating ? ` ${starRow(ownLog.rating, { size: 13 })}` : '';
  if (ownLog.status === 'played') return `You played this${stars}`;
  return `You logged this${stars}`;
}

function crowdSectionHtml(label, entries) {
  const seen = new Set();
  const people = [];
  for (const l of entries) {
    if (!l.profiles || seen.has(l.user_id)) continue;
    seen.add(l.user_id);
    people.push(l.profiles);
  }
  if (!people.length) return '';
  const shown = people.slice(0, 6);
  const extra = people.length - shown.length;
  return `
    <section class="gd-block">
      <h2 class="gd-block__title">${esc(label)}</h2>
      <div class="gd-faces">
        ${shown.map((p) => `
          <a class="gd-face" href="#/profile/${esc(p.username)}" title="${esc(p.display_name || p.username)}">
            ${avatarImg(p, 38)}
          </a>`).join('')}
        ${extra > 0 ? `<span class="gd-face gd-face--more">+${compactNumber(extra)}</span>` : ''}
      </div>
    </section>
    <div class="gd-rule"></div>`;
}

// The game page's own review card — bordered, self-contained, no game
// poster repeated on every row (unlike the shared feed logCard, this
// list is already all reviews of the one game whose page you're on, so
// that thumbnail would just be the same image forty times). Reuses the
// feed card's data-action attributes and spoiler markup exactly, so it
// stays wired by the existing wireLogCards() with no changes there.
function reviewCardHtml(log, { likeInfo, commentCount, ownLog }) {
  const author = log.profiles || {};
  return `
    <article class="gd-review" data-log-id="${log.id}">
      <div class="gd-review__head">
        <a href="#/profile/${esc(author.username)}" class="gd-review__author">
          ${avatarImg(author, 32)}
          <span class="gd-review__who">
            <span class="gd-review__name">${esc(author.display_name || author.username)}</span>
            <span class="gd-review__time">${esc(timeAgo(log.created_at))}</span>
          </span>
        </a>
        ${log.rating ? starRow(log.rating, { size: 13 }) : ''}
      </div>
      ${log.contains_spoilers
        ? `<button type="button" class="gd-review__body gd-review__body--spoiler" data-spoiler>
             <span class="spoiler-tag">SPOILERS</span>
             <span class="spoiler-veil">Tap to reveal</span>
             <span class="spoiler-text">${esc(log.review)}</span>
           </button>`
        : `<p class="gd-review__body">${esc(log.review)}</p>`}
      <div class="gd-review__foot">
        ${likeButton(log.id, likeInfo || { count: 0, liked: false })}
        <a href="#/review/${log.id}" class="gd-review__replies">${iconReply()}<span>${commentCount > 0 ? commentCount : ''}</span></a>
        ${ownLog
          ? `<button type="button" class="gd-review__edit" data-action="edit-log" data-log-id="${log.id}">Edit</button>`
          : `<button type="button" class="gd-review__report" data-action="report-log" data-log-id="${log.id}" aria-label="Report this review" title="Report this review">${iconFlag()}</button>`}
      </div>
    </article>`;
}

// Cast and Crew are the same list with a different second line, so
// they're one renderer. Capped at CREDITS_SHOWN with a "Show more"
// underneath, per the sketch — a well-documented game can credit thirty
// voice actors, and burying the Reviews section under all of them isn't
// what anyone came for.
const CREDITS_SHOWN = 5;

function creditListHtml(people, roleOf) {
  const row = (p, hidden) => `
    <a href="#/person/${p.qid}" class="crew-row"${hidden ? ' data-extra hidden' : ''}>
      ${facePic(p, '')}
      <div class="crew-row__info">
        <div class="crew-row__name">${esc(p.name)}</div>
        <div class="crew-row__role">${esc(roleOf(p) || '')}</div>
      </div>
      <span class="crew-row__go">${iconChevronSmall()}</span>
    </a>`;
  const extra = people.length - CREDITS_SHOWN;
  return `
    <div class="crew-list">
      ${people.map((p, i) => row(p, i >= CREDITS_SHOWN)).join('')}
    </div>
    ${extra > 0 ? `<button type="button" class="gd-showmore" data-showmore>Show more (${extra})</button>` : ''}`;
}

// Reveals the rows held back above. One-way: having expanded a list,
// collapsing it again just hides something you asked to see.
function wireShowMore(scope) {
  const btn = qs('[data-showmore]', scope);
  if (!btn) return;
  btn.addEventListener('click', () => {
    qsa('[data-extra]', scope).forEach((el) => el.removeAttribute('hidden'));
    btn.remove();
  });
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
  root.innerHTML = `<div class="game-topbar-fill" id="game-topbar-fill"></div>`
    + `<button type="button" class="topbar__back game-back" data-action="back" aria-label="Back">${iconBack()}</button>`
    + `<div class="view-body" id="game-body"><div class="view-loading" id="game-loading" hidden>${spinner()}</div></div>` + navBar('');
  const body = qs('#game-body', root);

  // The back chevron is bare over the artwork (a filled disc there was
  // the one thing competing with the picture), but it stays pinned while
  // the page scrolls — and a bare white chevron sitting on top of body
  // text is unreadable. So the plate fades back in once the artwork has
  // scrolled away, which is exactly when it's needed and no sooner.
  const backBtn = qs('.game-back', root);
  const topbarFill = qs('#game-topbar-fill', root);
  if (backBtn) {
    const syncBack = () => {
      // Roughly the artwork's own height; below that there's no art left
      // behind the chevron to protect.
      const plated = body.scrollTop > body.clientWidth * 0.42;
      backBtn.classList.toggle('game-back--plated', plated);
      // The button alone, floating with nothing behind it, let whatever
      // scrolled content settled in that corner (an avatar circle, a
      // poster edge) show through right at its rim — two overlapping
      // circles read as a rendering glitch, not deliberate layering. A
      // full-width shelf under the button gives content a real edge to
      // scroll under instead of a hole to peek through.
      topbarFill?.classList.toggle('game-topbar-fill--on', plated);
    };
    body.addEventListener('scroll', syncBack, { passive: true });
    syncBack();
  }
  let activeTab = 'cast';
  let crewCache = null;
  let castDirectorData = null; // { director, cast } — resolved below, before the first paint
  // Set inside paintGame() below, read by paintTabContent()'s Details
  // branch and by the log sheet's "Log again" note. Both are separate
  // functions from paintGame — a plain function declaration closes over
  // the scope it's DEFINED in, not the scope it's called from, so these
  // have to live up here rather than as locals inside paintGame() for
  // any sibling function to see them.
  let typicalHours = null;
  let beatenPct = null;
  let replayCount = 0;

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

    // Kicked off right here — in parallel with the Promise.all below, not
    // after it — so the logo has the maximum possible head start instead
    // of only beginning once everything else has already finished and
    // painted. For a game that's already cached (the common case, once
    // any single visitor has opened it once) this is just one small
    // image preload with no network round-trip to look the URL up first,
    // so it very often finishes before the page's OTHER data even does —
    // letting the very first paint below show the real logo directly,
    // with nothing to swap in later at all. `logoReady`/`resolvedLogoUrl`
    // are read synchronously right before that first paint to decide.
    //
    // Note: api.getGameArt also returns a `grid_url` (a SteamGridDB
    // cover) — deliberately unused here. It used to also replace the
    // page's poster as a "quality upgrade", reverted because SteamGridDB
    // grids are predominantly fan-made/alternate cover art, not official
    // box art (see the comment on getGameArt in api.js). The poster
    // below (`poster`/game.cover_url) is IGDB/RAWG only.
    let resolvedLogoUrl = null;
    let logoReady = false;
    const logoPromise = (async () => {
      if (!id) return null; // an uncatalogued game (igdbId mode) has nothing to cache against
      let url = game.logo_fetched ? (game.logo_url || null) : null;
      if (!game.logo_fetched) {
        try { ({ logo_url: url } = await api.getGameArt(game)); } catch { url = null; }
      }
      if (url) {
        try { const img = new Image(); img.src = url; await img.decode(); }
        catch { url = null; } // failed to actually load — treat as no logo
      }
      resolvedLogoUrl = url;
      logoReady = true;
      return url;
    })();

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
    const [enriched, logs, breakdown, listsCount, followingIds] = await Promise.all([
      enrichNeeded ? api.enrichGameDetails(game).catch(() => game) : Promise.resolve(game),
      id ? api.getLogsForGame(id) : Promise.resolve([]),
      id ? api.getGameRatingBreakdown(id) : Promise.resolve({}),
      id ? api.getListsCountForGame(id) : Promise.resolve(0),
      // Only worth asking for when there's someone signed in to have a
      // following list at all — the Friends tab on the review list below
      // is simply hidden otherwise.
      state.user ? api.getFollowingIdSet(state.user.id).catch(() => new Set()) : Promise.resolve(new Set()),
    ]);
    game = enriched || game;

    const rated = logs.filter(l => l.rating);
    const avg = rated.length ? (rated.reduce((s, l) => s + Number(l.rating), 0) / rated.length) : null;
    const reviewIds = logs.filter(l => l.review).map(l => l.id);
    const [likes, commentCounts] = await Promise.all([
      api.getLikesForLogs(logs.map(l => l.id), state.user?.id),
      api.getCommentCountsForLogs(reviewIds).catch(() => ({})),
    ]);
    const ownLogs = state.user ? logs.filter(l => l.user_id === state.user.id) : []; // already newest-first
    const ownLog = ownLogs[0] || null;

    clearTimeout(showLoadingTimer);
    paintGame();
    loadMoreFromStudio();
    loadSimilarGames();
    recordRecentlyViewed(game);
    loadCastDirector();
    // logoPromise (kicked off way back when `game` first loaded, above)
    // may well have already resolved by now, in which case the header
    // just painted with the real logo directly and this is a no-op — it
    // only actually swaps anything in for the slower case (a game nobody
    // has ever opened before, still needing the SteamGridDB lookup
    // itself before any image download can even start).
    logoPromise.then((logo_url) => {
      if (!logo_url) return;
      const slot = qs('#game-logo-slot', body);
      // If the first paint above already had logoReady=true, it
      // already rendered the <img> directly — this is then a no-op.
      if (slot && !qs('.gd-head__logo', slot)) slot.innerHTML = gameTitleHtml(game.title, logo_url);
    });

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
        castDirectorData = { director: null, cast: [], crew: [] };
      }
      // The header's credit line is a director credit once one is known,
      // and the studio until then — so it repaints here with the year and
      // developer it was first given, not just the director.
      const directorSlot = qs('#director-slot', body);
      if (directorSlot) {
        directorSlot.innerHTML = headCreditHtml(
          game.release_year || (game.release_date ? new Date(game.release_date).getFullYear() : null),
          castDirectorData.director,
          game.developer,
        );
      }
      // Both tabs resolve from this same castDirectorData fetch — whichever
      // one is open needs repainting once the real result lands, not just Cast.
      if (activeTab === 'cast' || activeTab === 'crew') paintTabContent();
    }

    // Shared by "More from [Studio]" and "Similar games" below — both are
    // a kicker plus a horizontal poster strip that adds-then-opens
    // whatever's tapped, differing only in which games they list and
    // which slot they paint into.
    function renderRail(slotId, kicker, allGames) {
      const slot = qs(`#${slotId}`, body);
      if (!slot) return; // page navigated away
      // A poster rail is nothing but posters, so an entry without cover
      // art renders as a blank tile with no way to tell what it is.
      // IGDB carries plenty of those (bundles, regional SKUs, unreleased
      // entries); one fewer tile beats one unreadable tile.
      const games = allGames.filter((g) => g.cover_url);
      if (!games.length) return;
      slot.innerHTML = `
        <div class="gd-row">
          <span class="gd-kicker">${esc(kicker)}</span>
        </div>
        <div class="trending-strip">
          ${games.map((g, i) => `
            <button type="button" class="trending-card" data-idx="${i}" aria-label="${esc(g.title)}">
              ${posterFrame(g.cover_url, g.title, 'trending-card__cover')}
            </button>`).join('')}
        </div>`;
      qsa('.trending-card', slot).forEach((el) => {
        el.addEventListener('click', async () => {
          el.disabled = true;
          const g = games[Number(el.dataset.idx)];
          try {
            const saved = await api.addGame({ igdb_id: g.igdb_id, title: g.title, cover_url: g.cover_url, release_year: g.year }, state.user?.id ?? null);
            location.hash = `#/game/${saved.id}`;
          } catch (err) {
            toast(err.message || 'Could not open that game.', 'error');
            el.disabled = false;
          }
        });
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
        renderRail('more-from-slot', `More from ${developer.name}`, more);
      } catch { /* discovery extra, fine to quietly skip on any failure */ }
    }

    // "Similar games" — IGDB's own curated similar_games list for this
    // title (see getSimilarGames in api.js). Same lazy-after-paint
    // treatment as the studio rail above, and the same silent skip on
    // any failure or empty result.
    async function loadSimilarGames() {
      if (!game.igdb_id) return;
      try {
        const similar = await api.getSimilarGames(game.igdb_id, 10);
        renderRail('similar-games-slot', 'Similar games', similar);
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
      // Same pool, filtered to people you follow — already ordered
      // newest-first (getLogsForGame's own query order), so no reason to
      // re-sort it by likes the way the Popular tab does.
      const friendsReviews = reviewedLogs.filter((l) => followingIds.has(l.user_id));
      const poster = game.cover_url;

      // People this game has been logged against, split by status —
      // feeds the Played by / Playing / Want to play rows just under
      // the action bar. Built from `logs`, already fetched, so this is
      // free: no extra query.
      const crowdHtml = [
        crowdSectionHtml('Played by', logs.filter((l) => l.status === 'played')),
        crowdSectionHtml('Playing', logs.filter((l) => l.status === 'playing')),
        crowdSectionHtml('Want to play', logs.filter((l) => l.status === 'backlog')),
      ].join('');

      // --- derived stats for the strip -----------------------------
      // Ten bars, one per half-star step, matching how ratings are
      // actually stored — folding them into five whole stars threw away
      // the distinction between a 3.5 and a 4.
      const halfSteps = [];
      for (let v = 0.5; v <= 5; v += 0.5) halfSteps.push(Number(v.toFixed(1)));
      const stepCounts = halfSteps.map((v) => breakdown[v.toFixed(1)] || 0);
      const stepMax = Math.max(1, ...stepCounts);
      // Assigned onto the outer-scope lets declared near activeTab — see
      // the comment there for why these can't just be const here.
      beatenPct = logs.length
        ? Math.round((logs.filter((l) => l.status === 'played').length / logs.length) * 100)
        : null;
      // "Typical" prefers what this game's own players reported over the
      // single static figure that came from the games catalogue — the
      // catalogue value is only the fallback until real logs exist.
      const reportedHours = logs.map((l) => Number(l.hours_played)).filter((h) => h > 0);
      typicalHours = reportedHours.length
        ? Math.round(reportedHours.reduce((s, h) => s + h, 0) / reportedHours.length)
        : (game.playtime_hours || null);
      replayCount = logs.filter((l) => l.is_replay).length;
      const platforms = (game.platform || '').split(',').map((p) => p.trim()).filter(Boolean);
      const year = game.release_year || (game.release_date ? new Date(game.release_date).getFullYear() : null);

      const discussionCount = Object.values(commentCounts).reduce((s, n) => s + n, 0);

      const socialCard = (icon, value, label) => `
        <div class="gd-social__card">
          <span class="gd-social__icon">${icon}</span>
          <b>${value}</b><span>${label}</span>
        </div>`;

      body.innerHTML = `
        <div class="gd">

          <div class="gd-hero">
            ${game.background_url ? `
              <div class="gd-hero__bg" style="background-image:url('${esc(game.background_url)}')"></div>
              <div class="gd-hero__scrim"></div>` : ''}
            <header class="gd-head">
              ${posterFrame(poster, game.title, 'gd-head__cover', { id: 'game-cover', full: true })}
              <div class="gd-head__main">
                <div id="game-logo-slot">${gameTitleHtml(game.title, logoReady ? resolvedLogoUrl : null)}</div>
                <div id="director-slot">${headCreditHtml(year, castDirectorData?.director, game.developer)}</div>
                ${game.trailer_url ? `
                  <button type="button" class="gd-trailer" id="play-trailer">
                    Trailer<span class="gd-trailer__play"></span>
                  </button>` : ''}
              </div>
            </header>
          </div>

          ${game.description ? `
            <div class="gd-synopsis-wrap" id="synopsis-wrap">
              <p class="gd-synopsis is-clamped" id="synopsis">${esc(game.description)}</p>
              <button type="button" class="gd-seemore" id="see-more" hidden>See more</button>
            </div>` : ''}

          <div class="gd-rule"></div>

          ${rated.length ? `
            <section class="gd-dist" id="rating-chart-slot">
              <div class="gd-dist__head">
                <h2 class="gd-dist__title">Ratings</h2>
              </div>
              <div class="gd-dist__plot">
                <div class="gd-dist__bars" id="rating-bars">
                  ${halfSteps.map((star, i) => {
                    const count = stepCounts[i];
                    const label = `${count} log${count === 1 ? '' : 's'} rated ${star} star${star === 1 ? '' : 's'}`;
                    const isPeak = count === stepMax && count > 0;
                    return `
                    <button type="button" class="gd-dist__col${isPeak ? ' gd-dist__col--peak' : ''}"
                            data-rating="${star}" data-count="${count}"
                            aria-label="${label}" title="${label}">
                      <span class="gd-dist__bar" style="height:${Math.max(4, Math.round((count / stepMax) * 100))}%"></span>
                    </button>`;
                  }).join('')}
                </div>
                ${avg ? `
                  <div class="gd-avg">
                    <span class="gd-avg__num" id="rating-avg-num">${avg.toFixed(1)}</span>
                    <span class="gd-avg__stars" id="rating-avg-stars">${starRow(avg, { size: 13 })}</span>
                  </div>` : ''}
              </div>
              <div class="gd-dist__axis">
                <span class="gd-dist__end">${iconStarSmall()}</span>
              </div>
            </section>`
            : `<p class="gd-empty">No ratings yet — be the first.</p>`}

          <div class="gd-rule"></div>

          <!-- One row that reports where you stand, not three abstract
               verbs. Three fixed actions have to be written for the case
               where you have done none of them, so they stay generic
               forever; a row that says "You're playing this" is doing a
               second job at the same size. The whole row opens the sheet
               where the actual choices live. -->
          <button type="button" class="gd-log" id="open-log-sheet">
            <span class="gd-log__mark">${state.profile ? avatarImg(state.profile, 30) : iconUser()}</span>
            <span class="gd-log__text">${logRowLabel(ownLog)}</span>
            <span class="gd-log__more" aria-hidden="true">${iconDots()}</span>
          </button>

          <div class="gd-rule"></div>

          ${crowdHtml}

          <!-- Label and icons share one row, per the sketch — this is a
               one-line fact about the game, not a section with a heading
               and a body. -->
          ${platforms.length ? `
            <section class="gd-block gd-block--inline">
              <h2 class="gd-block__title">Where to play</h2>
              <div class="gd-platforms">
                ${platforms.map((p) => `
                  <span class="gd-platform" title="${esc(p)}">
                    <span class="gd-platform__icon">${platformIcon(p)}</span>
                  </span>`).join('')}
              </div>
            </section>
            <div class="gd-rule"></div>` : ''}

          <section class="gd-block">
            <h2 class="gd-block__title">Social</h2>
            <div class="gd-social">
              ${socialCard(iconController(), logs.length, logs.length === 1 ? 'Play' : 'Plays')}
              ${socialCard(iconPencil(), reviewedLogs.length, reviewedLogs.length === 1 ? 'Review' : 'Reviews')}
              ${socialCard(iconStack(), compactNumber(listsCount), listsCount === 1 ? 'List' : 'Lists')}
              ${socialCard(iconReply(), compactNumber(discussionCount), discussionCount === 1 ? 'Reply' : 'Replies')}
            </div>
          </section>

          <div class="gd-rule"></div>

          <!-- A promo for the app's own news section, not a feed of
               articles. The article list that used to sit here matched
               headlines against the game's title and fell back to the
               general top three when nothing matched — which meant a
               Stardew Valley page routinely served Elden Ring and PC
               hardware stories. A banner is what the sketch asks for and
               it can't be wrong about the game it's on. -->
          <a class="gd-newsad" href="#/news">
            <span class="gd-newsad__label">News</span>
            <span class="gd-newsad__url">www.playthruu.com/news</span>
            <span class="gd-newsad__go" aria-hidden="true">${iconChevronRight()}</span>
          </a>

          <div class="gd-rule"></div>

          <div class="gd-tabs" id="game-tabs">
            <button class="gd-tab gd-tab--active" data-tab="cast">Cast</button>
            <button class="gd-tab" data-tab="crew">Crew</button>
            <button class="gd-tab" data-tab="details">Details</button>
          </div>
          <div id="game-tab-content"></div>

          <div class="gd-rule"></div>

          <section class="gd-block">
            <div class="gd-block__head">
              <h2 class="gd-block__title">Reviews</h2>
              ${reviewedLogs.length ? `<a href="#/game/${id}/reviews" class="gd-link">All ${reviewedLogs.length}</a>` : ''}
            </div>
            ${friendsReviews.length ? `
              <div class="gd-pilltabs" id="review-tabs">
                <button type="button" class="gd-pilltab gd-pilltab--on" data-review-tab="popular">Popular</button>
                <button type="button" class="gd-pilltab" data-review-tab="friends">Friends</button>
              </div>` : ''}
            <div id="review-filter-slot"></div>
            <div class="gd-reviews" id="game-reviews"></div>
          </section>

          <!-- Discovery lives at the very bottom, per the sketch: it's
               where you go once you're done with THIS game, so it sits
               after everything about this one. Filled in by
               loadMoreFromStudio/loadSimilarGames once the page is up. -->
          <div id="more-from-slot"></div>
          <div id="similar-games-slot"></div>
        </div>`;

      // Reviews are painted separately from the rest of the page so that
      // tapping a bar in the distribution can repaint just this list
      // rather than re-rendering (and re-fetching) the whole screen.
      let ratingFilter = null;
      // 'friends' only ever gets set from the segmented control, which
      // is itself only rendered when friendsReviews is non-empty — so
      // this can stay 'popular' unconditionally as the resting state.
      let reviewTab = 'popular';

      function paintReviews() {
        const listEl = qs('#game-reviews', body);
        const filterEl = qs('#review-filter-slot', body);
        if (!listEl) return;

        const pool = reviewTab === 'friends' ? friendsReviews : reviewedLogs;
        const shown = ratingFilter === null
          ? (reviewTab === 'friends' ? friendsReviews : topReviews)
          : pool.filter((l) => Number(l.rating) === ratingFilter);

        filterEl.innerHTML = ratingFilter === null ? '' : `
          <div class="gd-filter">
            <span class="gd-kicker">Showing ${ratingFilter} ★ only · ${shown.length}</span>
            <button type="button" class="gd-link" id="clear-rating-filter">Clear</button>
          </div>`;

        const emptyMsg = reviewTab === 'friends'
          ? (ratingFilter === null
              ? "None of the people you follow have reviewed this yet."
              : `Nobody you follow rated it ${ratingFilter} ★.`)
          : (ratingFilter === null
              ? 'No written reviews yet — be the first.'
              : `No written reviews at ${ratingFilter} ★.`);

        listEl.innerHTML = shown.length
          ? shown.map((l) => reviewCardHtml(l, {
              likeInfo: likes[l.id],
              commentCount: commentCounts[l.id] || 0,
              ownLog: l.user_id === state.user?.id,
            })).join('')
          : `<p class="gd-empty">${emptyMsg}</p>`;

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

      qsa('[data-review-tab]', body).forEach((btn) => {
        btn.addEventListener('click', () => {
          reviewTab = btn.dataset.reviewTab;
          qsa('[data-review-tab]', body).forEach((b) => b.classList.toggle('segmented__item--active', b === btn));
          paintReviews();
        });
      });

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
      // Game pages are open to anyone (see landing-view.js), but every
      // action behind this row writes a row of its own — so the account
      // check happens once, here, rather than inside each handler.
      qs('#open-log-sheet', body)?.addEventListener('click', () => {
        if (!state.user) { promptSignIn('Sign in to log this game.'); return; }
        openLogSheet({
          game,
          ownLog,
          replayCount,
          ensureSavedGame,
          onChanged: () => refreshCurrentView(),
          onAddToList: async () => {
            const saved = await ensureSavedGame();
            if (saved) openAddToListPicker(game);
          },
        });
      });

      const trailerBtn = qs('#play-trailer', body);
      if (trailerBtn) trailerBtn.addEventListener('click', () => openTrailer(game.trailer_url));

      // The synopsis is clamped to three lines; the toggle only appears
      // when there is genuinely more text than that, so a short
      // description doesn't get a "See more" that expands to nothing.
      const synopsis = qs('#synopsis', body);
      const seeMore = qs('#see-more', body);
      if (synopsis && seeMore) {
        // Measured after layout — scrollHeight is only meaningful once
        // the clamp has actually been applied.
        requestAnimationFrame(() => {
          if (synopsis.scrollHeight > synopsis.clientHeight + 2) seeMore.hidden = false;
        });
        seeMore.addEventListener('click', () => {
          const clamped = synopsis.classList.toggle('is-clamped');
          seeMore.textContent = clamped ? 'See more' : 'See less';
        });
      }

      // Hold a bar (or drag across several) to swap the average readout
      // for that bar's own numbers — how many logs actually landed on
      // it, and its own star value rather than the overall average's.
      // A plain tap is untouched and still toggles the rating filter
      // below (that's the click listener above, native `click` still
      // fires after a short pointerdown+up with no real movement) — this
      // only ever touches the read-only number/star display, never the
      // filter, so holding to look never accidentally sets one.
      const distBars = qs('#rating-bars', body);
      const avgNumEl = qs('#rating-avg-num', body);
      const avgStarsEl = qs('#rating-avg-stars', body);
      if (distBars && avgNumEl) {
        const showAverage = () => {
          avgNumEl.textContent = avg.toFixed(1);
          if (avgStarsEl) avgStarsEl.innerHTML = starRow(avg, { size: 13 });
        };
        const showCol = (col) => {
          avgNumEl.textContent = col.dataset.count;
          if (avgStarsEl) avgStarsEl.innerHTML = starRow(Number(col.dataset.rating), { size: 13 });
        };
        // A fixed Y (the row's own vertical centre) is enough to find
        // whichever column the finger is over on any X — every column
        // button already fills the row's full height.
        const colAtX = (x) => {
          const r = distBars.getBoundingClientRect();
          return document.elementFromPoint(x, r.top + r.height / 2)?.closest('.gd-dist__col');
        };

        let holding = false;
        distBars.addEventListener('pointerdown', (e) => {
          holding = true;
          // Without this, pointerup/pointercancel only fire on distBars
          // if the pointer happens to still be over it at release — a
          // thumb sliding down off these short bars (a completely normal
          // way to hold one) would leave the release listeners never
          // firing at all, and the average stuck showing whatever bar
          // was last held. Capturing the pointer routes every later
          // event for this touch to distBars regardless of where it
          // physically ends up, so release is guaranteed to fire.
          distBars.setPointerCapture(e.pointerId);
          const col = e.target.closest('.gd-dist__col');
          if (col) showCol(col);
        });
        distBars.addEventListener('pointermove', (e) => {
          if (!holding) return;
          const col = colAtX(e.clientX);
          if (col) showCol(col);
        });
        const release = (e) => {
          if (!holding) return;
          holding = false;
          showAverage();
          if (e?.pointerId != null && distBars.hasPointerCapture?.(e.pointerId)) {
            distBars.releasePointerCapture(e.pointerId);
          }
        };
        distBars.addEventListener('pointerup', release);
        distBars.addEventListener('pointercancel', release);
        // Kept alongside pointer capture rather than removed: capture
        // suppresses boundary events for OTHER elements but a captured
        // element still fires its own pointerleave, so this stays as a
        // second, harmless path to the same release() cleanup.
        distBars.addEventListener('pointerleave', release);
      }

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
          ? creditListHtml(cast, (p) => (p.characters.length ? p.characters.join(', ') : 'Voice actor'))
          : `<p class="gd-empty">No cast listed for this game on Wikidata yet — coverage there is community-maintained.</p>`;
        wireShowMore(slot);
        return;
      }
      if (activeTab === 'crew') {
        if (castDirectorData === null) { slot.innerHTML = spinner(); return; }
        // Same shape as the Cast branch above, minus the character
        // column — a writer or composer doesn't have one. Director is
        // deliberately excluded (see CREW_PROPS in api.js): it already
        // has its own line in the header, so it isn't in castDirectorData.crew
        // at all, not filtered out here.
        const crew = castDirectorData.crew || [];
        slot.innerHTML = crew.length
          ? creditListHtml(crew, (p) => p.role)
          : `<p class="gd-empty">No crew listed for this game on Wikidata yet — coverage there is community-maintained.</p>`;
        wireShowMore(slot);
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
          ${typicalHours ? factRow('Typical playtime', `${typicalHours}h`) : ''}
          ${beatenPct === null ? '' : factRow('Finished it', `${beatenPct}% of logs`)}
          ${replayCount ? factRow('Replays', String(replayCount)) : ''}
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
function iconStarSmall() { return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`; }
function iconLogAgain() { return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 3.6V9h-5.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function iconPencil() { return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15.6 4.6l3.8 3.8M5 19h3.6L19.4 8.2a1.6 1.6 0 0 0 0-2.3l-1.3-1.3a1.6 1.6 0 0 0-2.3 0L5 15.4z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/></svg>`; }
function iconDots() { return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.5" cy="12" r="1.9"/></svg>`; }
function iconChevronSmall() { return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function iconStarLine() { return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.8l2.7 5.6 6.1.85-4.4 4.3 1.05 6.1-5.45-2.9-5.45 2.9L7.6 14.55 3.2 10.25l6.1-.85z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`; }
function iconController() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 9h10l2.5 7a2 2 0 0 1-3.7 1.4L14 15h-4l-1.8 2.4A2 2 0 0 1 4.5 16z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 11.5v3M7.5 13h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="12" r="0.9" fill="currentColor"/><circle cx="18" cy="14" r="0.9" fill="currentColor"/></svg>`; }
function iconDoc() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M6 3.5h9l4 4V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 10h6M9 13.5h6M9 17h3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`; }
function iconStack() { return `<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="12" height="16" rx="1.5" stroke="currentColor" stroke-width="1.8"/><path d="M8 1.5h12v16" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" opacity="0.55"/></svg>`; }


// The sheet behind the log row. Everything you can do to a game lives
// here rather than on the page, which is what lets the row itself stay
// one line that reports your state instead of a menu bar that cannot.
//
// The three statuses across the top are toggles, not checkboxes: a game
// is in your backlog, or you are playing it, or you have played it, and
// picking one clears whichever was set. "Like" is deliberately NOT up
// there — it is not a status, it is an opinion, so it sits in the list
// below rather than competing with the three that are exclusive.
function openLogSheet({ game, ownLog, replayCount, ensureSavedGame, onChanged, onAddToList }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Local truth. Every tap updates this and repaints immediately, then
  // the write goes out behind it — a status toggle that waits on a
  // round trip before it moves feels broken even when it isn't. On a
  // failed write this is rolled back to `before` and repainted.
  let log = ownLog;
  let dirty = false;

  function close() {
    overlay.remove();
    document.body.style.overflow = '';
    // One reconcile on the way out instead of one per tap: the rest of
    // the page (Played by, the ratings chart, the review list) has to
    // catch up, but it doesn't have to do it four times while someone
    // sets a status and then a rating.
    if (dirty) onChanged?.();
  }

  function render() {
    const status = log?.status || null;
    const rating = log?.rating || 0;

    const tg = (key, label, icon) => `
      <button type="button" class="lg-tg${status === key ? ' lg-tg--on' : ''}" data-status="${key}">
        <span class="lg-tg__icon">${icon}</span>
        <span>${esc(label)}</span>
      </button>`;

    const row = (act, label, icon, opts = {}) => `
      <button type="button" class="lg-row${opts.danger ? ' lg-row--danger' : ''}" data-act="${act}">
        <span class="lg-row__icon">${icon}</span>
        <span class="lg-row__label">${esc(label)}</span>
        ${opts.note ? `<span class="lg-row__note">${esc(opts.note)}</span>` : ''}
      </button>`;

    overlay.innerHTML = `
      <div class="modal lg-sheet">
        <div class="lg-head">
          <h2 class="lg-head__title">${esc(game.title)}</h2>
          ${game.release_year ? `<p class="lg-head__year">${esc(String(game.release_year))}</p>` : ''}
        </div>

        <div class="lg-toggles">
          ${tg('played', 'Played', iconController())}
          ${tg('playing', 'Playing', iconPlay())}
          ${tg('backlog', 'Backlog', iconBookmarkSm())}
        </div>

        <div class="lg-rate">
          <div class="lg-rate__stars">
            ${[1, 2, 3, 4, 5].map((n) => `
              <button type="button" class="lg-star${n <= rating ? ' lg-star--on' : ''}" data-star="${n}" aria-label="${n} star${n === 1 ? '' : 's'}"></button>`).join('')}
          </div>
          <span class="lg-rate__label">${rating ? `Rated ${rating}` : 'Rate'}</span>
        </div>

        <div class="lg-list">
          ${row('review', log?.review ? 'Edit your review' : 'Write a review', iconPencilSm())}
          ${log ? row('again', 'Log again', iconPlusSm(), { note: replayCount ? `${replayCount} replay${replayCount === 1 ? '' : 's'}` : '' }) : ''}
          ${row('list', 'Add to lists', iconStack())}
          ${row('share', 'Copy link', iconLinkSm())}
          ${log ? row('delete', 'Delete this log', iconTrashSm(), { danger: true }) : ''}
        </div>
      </div>`;

    // Keep the row on the page underneath in sync as we go, so closing
    // the sheet never shows a stale sentence for the moment it takes
    // the reconcile to land.
    const rowText = document.querySelector('#open-log-sheet .gd-log__text');
    if (rowText) rowText.innerHTML = logRowLabel(log);
  }

  render();

  // Tapping the status you're already on clears it — that's the only way
  // to take a game back out of your backlog, and without it the toggles
  // are one-way. Clearing means deleting the log, so a log carrying a
  // rating or a review is refused here and sent to "Delete this log",
  // which is explicit about what it destroys.
  // Guards the window between an optimistic repaint and its write
  // landing: during it `log` is a local object with no id yet, so a
  // second tap would try to update or delete a row it can't name.
  let inFlight = false;

  async function setStatus(next) {
    if (inFlight) return;
    const before = log;
    const clearing = !!log && log.status === next;
    if (clearing && (log.rating || log.review)) {
      toast('Your rating and review live on this log — use Delete this log.', 'info');
      return;
    }

    const saved = await ensureSavedGame();
    if (!saved) return;

    log = clearing ? null : { ...(log || {}), status: next };
    dirty = true;
    inFlight = true;
    render();

    try {
      if (clearing) await api.deleteLog(before.id);
      else if (before?.id) log = await api.updateLog(before.id, { status: next });
      else log = await api.createLog({ game_id: game.id, user_id: state.user.id, status: next, is_public: true });
      pulseLogTab();
      render();
    } catch (err) {
      log = before;
      render();
      toast(err.message || 'Could not save that.', 'error');
    } finally {
      inFlight = false;
    }
  }

  async function setRating(n) {
    if (inFlight) return;
    const before = log;
    // Tapping the star you're already on clears the rating rather than
    // re-setting it — the same "tap it again to undo" the status
    // toggles have, so the two behave alike.
    const clearing = !!log && log.rating === n;

    const saved = await ensureSavedGame();
    if (!saved) return;

    log = { ...(log || {}), rating: clearing ? null : n, status: log?.status || 'played' };
    dirty = true;
    inFlight = true;
    render();

    try {
      if (before?.id) log = await api.updateLog(before.id, { rating: clearing ? null : n, status: before.status || 'played' });
      else log = await api.createLog({ game_id: game.id, user_id: state.user.id, status: 'played', rating: n, is_public: true });
      pulseLogTab();
      render();
    } catch (err) {
      log = before;
      render();
      toast(err.message || 'Could not save that rating.', 'error');
    } finally {
      inFlight = false;
    }
  }

  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) return close();

    const star = e.target.closest('[data-star]');
    if (star) return setRating(Number(star.dataset.star));

    const tgBtn = e.target.closest('[data-status]');
    if (tgBtn) return setStatus(tgBtn.dataset.status);

    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const act = actBtn.dataset.act;
    const current = log;
    close();
    if (act === 'review') {
      if (current) openLogModal({ existingLog: current, onSaved: onChanged });
      else {
        const saved = await ensureSavedGame();
        if (saved) openLogModal({ game, onSaved: onChanged });
      }
    }
    if (act === 'again') {
      const saved = await ensureSavedGame();
      if (saved) openLogModal({ game, defaultReplay: true, onSaved: onChanged });
    }
    if (act === 'list') await onAddToList?.();
    if (act === 'share') {
      const url = `${location.origin}${location.pathname}#/game/${game.id}`;
      try { await navigator.clipboard.writeText(url); toast('Link copied', 'success'); }
      catch { toast('Could not copy that link', 'error'); }
    }
    if (act === 'delete' && current) {
      try {
        await api.deleteLog(current.id);
        toast('Log deleted.', 'success');
        onChanged?.();
      } catch (err) { toast(err.message || 'Could not delete that.', 'error'); }
    }
  });
}

function iconPlay() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/></svg>`; }
function iconBookmarkSm() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><path d="M6 3.8h12a1 1 0 0 1 1 1V20.5l-7-4.1-7 4.1V4.8a1 1 0 0 1 1-1z"/></svg>`; }
function iconPencilSm() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>`; }
function iconPlusSm() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`; }
function iconLinkSm() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.3"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/></svg>`; }
function iconTrashSm() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/></svg>`; }

// Full-screen artwork viewer. Single tap on the cover opens it; inside,
// double-tap steps through two zoom levels before returning to fit
// (2x for "read the cover", 3.5x for fine detail), and the image can be
// dragged around once it's bigger than the screen. Pinch goes past the
// double-tap ceiling on purpose — the steps are the quick way in, and
// pinch is there for when someone wants to keep going past the last one.
// At fit, dragging down carries the poster with the finger and lets go
// of it; the close button, the backdrop and Escape all dismiss too.
const POSTER_ZOOM_STEPS = [1, 2, 3.5];
const POSTER_PINCH_MAX = 6;
// How far down the poster has to be pulled (or how fast it has to be
// flicked) before letting go dismisses instead of springing back.
const POSTER_DISMISS_PX = 110;
const POSTER_DISMISS_VELOCITY = 0.5;

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
    <img class="poster-viewer__img" src="${esc(src)}" alt="${esc(title || '')}" draggable="false">`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const img = overlay.querySelector('.poster-viewer__img');
  let scale = 1, tx = 0, ty = 0;
  // Only set while a swipe-to-dismiss is in progress, so the drag can
  // fade the backdrop without disturbing the pan offsets above.
  let dismissY = 0;

  // `animate` is passed for changes that should glide (a zoom step, a
  // spring-back) and left off for anything driven frame-by-frame from a
  // finger, where a transition would visibly lag behind the gesture.
  const apply = (animate = false) => {
    img.classList.toggle('is-animating', animate);
    img.style.transform = `translate(${tx}px, ${ty + dismissY}px) scale(${scale})`;
    overlay.classList.toggle('is-zoomed', scale > 1);
    if (dismissY) {
      // Fades the backdrop out as the poster is pulled away, so the
      // dismissal reads as one continuous movement rather than the
      // image sliding over a wall that only disappears at the end.
      const p = Math.min(1, Math.abs(dismissY) / (POSTER_DISMISS_PX * 2.5));
      overlay.style.background = `rgba(4,6,12,${0.94 * (1 - p * 0.75)})`;
      img.style.opacity = String(1 - p * 0.35);
    } else {
      overlay.style.background = '';
      img.style.opacity = '';
    }
  };

  // Panning is only ever allowed as far as there is off-screen image to
  // bring into view, so a zoomed poster can't be flung into empty space.
  // Measured off the untransformed box (getBoundingClientRect would
  // report the already-scaled size and compound on every move).
  const clamp = () => {
    const maxX = Math.max(0, (img.offsetWidth * scale - overlay.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * scale - overlay.clientHeight) / 2);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
  };

  function close() {
    overlay.remove();
    document.body.style.overflow = '';
  }

  // Slides the poster the rest of the way off-screen and only then tears
  // the overlay down, so a dismissal finishes the motion the finger
  // started instead of the image vanishing mid-flight.
  function closeBySwipe(direction) {
    dismissY = direction * (window.innerHeight || 800);
    apply(true);
    overlay.style.background = 'rgba(4,6,12,0)';
    img.addEventListener('transitionend', close, { once: true });
    setTimeout(close, 400); // in case the transition never fires
  }

  // Each double-tap advances one step and wraps back to fit, so the
  // gesture is "tap again for closer" rather than a single on/off zoom.
  // The tapped point is kept under the finger across the step, which is
  // what makes zooming in on a corner actually land on that corner.
  // A pinch can leave scale between two steps (or past the last one) —
  // the next step up from wherever it landed is the first one bigger
  // than it, so the tap after a pinch still moves in a sensible
  // direction instead of needing an exact match to find its place.
  function stepZoom(clientX, clientY) {
    const next = POSTER_ZOOM_STEPS.find((s) => s > scale + 0.01) ?? 1;
    if (next === 1) { scale = 1; tx = 0; ty = 0; apply(true); return; }
    const r = img.getBoundingClientRect();
    const cx = clientX - (r.left + r.width / 2);
    const cy = clientY - (r.top + r.height / 2);
    const ratio = next / scale;
    tx = tx - cx * (ratio - 1);
    ty = ty - cy * (ratio - 1);
    scale = next;
    clamp();
    apply(true);
  }

  // --- pointer gestures: drag to pan, two fingers to pinch ----------
  // Keyed by pointerId so a second finger arriving mid-drag switches to
  // a pinch without the image jumping.
  const points = new Map();
  let startDist = 0, startScale = 1, startTx = 0, startTy = 0, startMid = null;
  let moved = false, downAt = 0, startY = 0, lastY = 0, lastMoveAt = 0, velocity = 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  img.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    img.setPointerCapture(e.pointerId);
    const pts = [...points.values()];
    if (pts.length === 2) { startDist = dist(pts[0], pts[1]); startMid = mid(pts[0], pts[1]); }
    startScale = scale; startTx = tx; startTy = ty;
    moved = false; downAt = Date.now();
    startY = lastY = e.clientY; lastMoveAt = Date.now(); velocity = 0;
  });

  img.addEventListener('pointermove', (e) => {
    if (!points.has(e.pointerId)) return;
    const prev = points.get(e.pointerId);
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...points.values()];

    if (pts.length >= 2 && startDist > 0) {
      e.preventDefault();
      // Pinch deliberately reaches past the last double-tap step, so
      // there's somewhere to go once the steps run out.
      scale = Math.min(POSTER_PINCH_MAX, Math.max(1, startScale * (dist(pts[0], pts[1]) / startDist)));
      const m = mid(pts[0], pts[1]);
      if (startMid) { tx = startTx + (m.x - startMid.x); ty = startTy + (m.y - startMid.y); }
      if (scale === 1) { tx = 0; ty = 0; } else clamp();
      dismissY = 0;
      moved = true;
      apply();
    } else if (pts.length === 1 && scale > 1) {
      e.preventDefault();
      tx += e.clientX - prev.x;
      ty += e.clientY - prev.y;
      if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 1) moved = true;
      clamp();
      apply();
    } else if (pts.length === 1) {
      // Not zoomed: a vertical drag is a dismissal, and the poster comes
      // with the finger. Sideways movement is ignored rather than fought
      // over, so a slightly diagonal swipe still reads as a swipe.
      e.preventDefault();
      const now = Date.now();
      const dt = now - lastMoveAt;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY; lastMoveAt = now;
      dismissY = e.clientY - startY;
      if (Math.abs(dismissY) > 2) moved = true;
      apply();
    }
  });

  // A tap is a pointer that went down and up in one place, quickly —
  // distinguished here from the end of a drag or pinch, which must not
  // count as the second half of a double-tap.
  let lastTap = 0;
  const release = (e) => {
    points.delete(e.pointerId);
    if (points.size < 2) startDist = 0;

    // Finished a swipe: past the distance threshold, or flicked hard
    // enough that the intent is obvious even on a short pull.
    if (dismissY !== 0 && !points.size) {
      const far = Math.abs(dismissY) > POSTER_DISMISS_PX;
      const fast = velocity > POSTER_DISMISS_VELOCITY && dismissY > 0;
      if (far || fast) { closeBySwipe(dismissY > 0 ? 1 : -1); return; }
      dismissY = 0;
      apply(true); // sprang back
      return;
    }

    if (scale <= 1) { scale = 1; tx = 0; ty = 0; apply(); }
    if (moved || Date.now() - downAt > 400 || points.size) return;
    const now = Date.now();
    if (now - lastTap < 300) { stepZoom(e.clientX, e.clientY); lastTap = 0; }
    else lastTap = now;
  };
  img.addEventListener('pointerup', release);
  img.addEventListener('pointercancel', (e) => {
    points.delete(e.pointerId); startDist = 0;
    if (dismissY) { dismissY = 0; apply(true); }
  });

  // Desktop has no pinch — the wheel does the same job, to the same
  // ceiling the pinch reaches.
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = scale;
    scale = Math.min(POSTER_PINCH_MAX, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (scale === 1) { tx = 0; ty = 0; } else if (before !== scale) clamp();
    apply();
  }, { passive: false });

  img.addEventListener('click', (e) => e.stopPropagation());
  overlay.addEventListener('click', () => { if (scale === 1) close(); });
  overlay.querySelector('.poster-viewer__close').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  apply();
}
