import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, emptyState, iconSearch, iconBack, posterFrame } from '../components.js';
import { esc, qs, qsa, toast, revealTogether } from '../utils.js';
import { navigate } from '../router.js';

// Replaces the old "Released between" dd-mm-yyyy date-range inputs —
// nobody actually wants to type exact dates to browse by era, and typed
// date fields are what made this page feel like a form instead of a
// browsing screen. A single-pick era chip covers the same real intent
// ("something from the 2010s") in one tap.
const ERA_OPTIONS = [
  { id: 'any', label: 'Any time', dateFrom: '', dateTo: '' },
  { id: '2020s', label: '2020s', dateFrom: '2020-01-01', dateTo: '2029-12-31' },
  { id: '2010s', label: '2010s', dateFrom: '2010-01-01', dateTo: '2019-12-31' },
  { id: '2000s', label: '2000s', dateFrom: '2000-01-01', dateTo: '2009-12-31' },
  { id: 'retro', label: 'Before 2000', dateFrom: '', dateTo: '1999-12-31' },
];
function eraForFilters(f) {
  return ERA_OPTIONS.find((e) => e.dateFrom === f.dateFrom && e.dateTo === f.dateTo) || ERA_OPTIONS[0];
}
function withAny(label, options) {
  return [{ label, value: '' }, ...options];
}
// A row of plain buttons instead of a native <select> — a real <select>'s
// dropdown is rendered by the OS/browser itself, not this page's CSS, so
// it kept showing up as an unstyled white popup with barely-visible text
// no matter what was tried here. Chips are just DOM elements, fully
// themeable, and every option is visible at once instead of hidden behind
// a tap.
function chipRow(fieldId, options, activeValue) {
  return `<div class="disc-chip-row" id="${fieldId}">
    ${options.map((o) => `<button type="button" class="chip${activeValue === o.value ? ' chip--active' : ''}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
  </div>`;
}

// Discover always opens on these — the filters object below is rebuilt
// fresh on every render, so the first request this page makes is the same
// one every time. That makes it worth having in hand before the page is
// even opened; see warmDiscover.
const DISCOVER_DEFAULTS = {
  genre: '', platform: '', dateFrom: '', dateTo: '', sort: 'popular',
  minRating: '', multiplayer: '', developer: '', publisher: '',
};

// One-shot, short-lived, and only ever consumed by the very first
// (unfiltered, page 1) request — the moment anyone touches a filter or
// pages further, it's irrelevant and ignored. Same reasoning as
// profile-view's bundle warm.
const DISCOVER_WARM_TTL = 60_000;
let discoverWarm = null; // { at, promise }

export function warmDiscover() {
  const promise = api.browseGames({ ...DISCOVER_DEFAULTS, page: 1 });
  promise.catch(() => {});
  discoverWarm = { at: Date.now(), promise };
}

function takeWarmedDiscover(filters, page) {
  if (!discoverWarm || page !== 1) return null;
  if (Date.now() - discoverWarm.at > DISCOVER_WARM_TTL) { discoverWarm = null; return null; }
  const untouched = Object.keys(DISCOVER_DEFAULTS).every((k) => filters[k] === DISCOVER_DEFAULTS[k]);
  if (!untouched) return null;
  const { promise } = discoverWarm;
  discoverWarm = null;
  return promise;
}

// How many filters are switched on. Release dates count as ONE ("Released"),
// not two, since a single era chip sets both ends; Sort counts once it's off
// the default, so it's never a hidden reason the list looks different.
function countFilters(f) {
  const singles = ['genre', 'platform', 'minRating', 'multiplayer'].filter((k) => f[k]).length;
  const text = ['developer', 'publisher'].filter((k) => (f[k] || '').trim()).length;
  const era = (f.dateFrom || f.dateTo) ? 1 : 0;
  return singles + text + era + (f.sort !== DISCOVER_DEFAULTS.sort ? 1 : 0);
}

// The Search tab's filter button lands here (/discover/filters, and /discover
// too). Two screens, one flow:
//   Filters  - every option on one page, a live count of what's switched on,
//              Clear all (stays right here) and Apply filters.
//   Results  - the matching games as a grid of three, like "Bored? Try
//              these", with nothing on it but the games; the back arrow
//              returns to the Filters, exactly as they were left.
// The old results page, with its own Filters button and count, is gone: it
// was also where Clear all used to dump you.
export function renderDiscoverView(root) {
  const filters = { ...DISCOVER_DEFAULTS }; // what's applied
  let page = 1;
  let loading = false;

  // ---- filters screen ---------------------------------------------------
  // Edits happen on a draft copy, so nothing takes effect until Apply.
  function paintFilters() {
    const draft = { ...filters };

    const section = (key, title, body) => `
      <section class="fsec">
        <div class="fsec__head">
          <h2 class="fsec__title">${title}</h2>
          <span class="fsec__value" data-value-for="${key}"></span>
        </div>
        ${body}
      </section>`;

    root.innerHTML = topBar('Filters', { back: true, brand: true }) + `
      <div class="view-body view-body--filters">
        ${section('sort', 'Sort by', chipRow('f-sort', api.BROWSE_SORTS, draft.sort))}
        ${section('genre', 'Genre', chipRow('f-genre', withAny('Any genre', api.BROWSE_GENRES), draft.genre))}
        ${section('platform', 'Platform', chipRow('f-platform', withAny('Any platform', api.BROWSE_PLATFORMS), draft.platform))}
        ${section('minRating', 'Rating', chipRow('f-rating', api.BROWSE_RATINGS, draft.minRating))}
        ${section('multiplayer', 'Players', chipRow('f-players', api.BROWSE_PLAYER_MODES, draft.multiplayer))}
        ${section('era', 'Released', `
          <div class="disc-chip-row" id="f-era">
            ${ERA_OPTIONS.map((e) => `<button type="button" class="chip${eraForFilters(draft).id === e.id ? ' chip--active' : ''}" data-era="${e.id}">${e.label}</button>`).join('')}
          </div>`)}
        <div class="disc-field-grid">
          <label class="fsec">
            <div class="fsec__head"><h2 class="fsec__title">Developer</h2></div>
            <input type="text" id="f-developer" class="discover-select" placeholder="e.g. Naughty Dog" value="${esc(draft.developer)}">
          </label>
          <label class="fsec">
            <div class="fsec__head"><h2 class="fsec__title">Publisher</h2></div>
            <input type="text" id="f-publisher" class="discover-select" placeholder="e.g. Nintendo" value="${esc(draft.publisher)}">
          </label>
        </div>
      </div>
      <div class="filters-bar">
        <button type="button" class="btn btn--ghost filters-bar__clear" id="filters-clear">Clear all</button>
        <button type="button" class="btn btn--accent filters-bar__apply" id="filters-apply">
          Apply filters<span class="filters-bar__count" id="filters-count" hidden></span>
        </button>
      </div>`;

    // The word beside each section's name: what's picked there right now,
    // lit up when it isn't the default.
    const label = (opts, v) => opts.find((o) => o.value === v)?.label || '';
    const sideNote = (key) => {
      switch (key) {
        case 'sort': return draft.sort === DISCOVER_DEFAULTS.sort ? '' : label(api.BROWSE_SORTS, draft.sort);
        case 'genre': return draft.genre ? label(api.BROWSE_GENRES, draft.genre) : '';
        case 'platform': return draft.platform ? label(api.BROWSE_PLATFORMS, draft.platform) : '';
        case 'minRating': return draft.minRating ? label(api.BROWSE_RATINGS, draft.minRating).split(' ')[0] : '';
        case 'multiplayer': return draft.multiplayer ? label(api.BROWSE_PLAYER_MODES, draft.multiplayer) : '';
        case 'era': return eraForFilters(draft).id === 'any' ? '' : eraForFilters(draft).label;
        default: return '';
      }
    };
    const refresh = () => {
      qsa('[data-value-for]', root).forEach((el) => { el.textContent = sideNote(el.dataset.valueFor); });
      const n = countFilters(draft);
      const badge = qs('#filters-count', root);
      badge.hidden = !n;
      badge.textContent = n;
      qs('#filters-clear', root).disabled = !n;
    };

    const wireChipRow = (fieldId, key) => {
      const rowEl = qs(`#${fieldId}`, root);
      qsa('.chip', rowEl).forEach((chip) => {
        chip.addEventListener('click', () => {
          draft[key] = chip.dataset.value;
          qsa('.chip', rowEl).forEach((c) => c.classList.toggle('chip--active', c === chip));
          refresh();
        });
      });
    };
    wireChipRow('f-sort', 'sort');
    wireChipRow('f-genre', 'genre');
    wireChipRow('f-platform', 'platform');
    wireChipRow('f-rating', 'minRating');
    wireChipRow('f-players', 'multiplayer');
    qs('#f-developer', root).addEventListener('input', (e) => { draft.developer = e.target.value; refresh(); });
    qs('#f-publisher', root).addEventListener('input', (e) => { draft.publisher = e.target.value; refresh(); });
    qsa('.chip', qs('#f-era', root)).forEach((chip) => {
      chip.addEventListener('click', () => {
        const era = ERA_OPTIONS.find((e) => e.id === chip.dataset.era);
        draft.dateFrom = era.dateFrom; draft.dateTo = era.dateTo;
        qsa('.chip', qs('#f-era', root)).forEach((c) => c.classList.toggle('chip--active', c === chip));
        refresh();
      });
    });

    // Clear all resets every option on THIS page and stays here: nothing is
    // applied, nothing navigates.
    qs('#filters-clear', root).addEventListener('click', () => {
      Object.assign(draft, DISCOVER_DEFAULTS);
      const setRow = (fieldId, value) => qsa('.chip', qs(`#${fieldId}`, root)).forEach((c) => c.classList.toggle('chip--active', c.dataset.value === value));
      setRow('f-sort', draft.sort); setRow('f-genre', ''); setRow('f-platform', ''); setRow('f-rating', ''); setRow('f-players', '');
      qsa('.chip', qs('#f-era', root)).forEach((c) => c.classList.toggle('chip--active', c.dataset.era === 'any'));
      qs('#f-developer', root).value = ''; qs('#f-publisher', root).value = '';
      refresh();
    });
    qs('#filters-apply', root).addEventListener('click', () => {
      Object.assign(filters, draft);
      paintResults();
    });
    refresh();
  }

  // ---- results screen --------------------------------------------------
  function paintResults() {
    root.innerHTML = `
      <header class="topbar">
        <button type="button" class="topbar__back" id="results-back" aria-label="Back to filters">${iconBack()}</button>
        <h1 class="topbar__title topbar__title--brand">Games</h1>
        <div class="topbar__right"></div>
      </header>
      <div class="view-body">
        <div id="discover-results" class="discovery-grid"></div>
        <div id="discover-more"></div>
      </div>` + navBar('/search');
    // Back is to the Filters, as they were left (not out of Discover).
    qs('#results-back', root).addEventListener('click', paintFilters);
    runSearch();
  }

  const resultsEl = () => qs('#discover-results', root);
  const moreEl = () => qs('#discover-more', root);
  const skeletonTiles = (n) => Array.from({ length: n }, () => `<div class="skeleton skeleton--tile"></div>`).join('');

  // Bumped by every call, so a response that lands after a newer search
  // has started is dropped instead of painting stale tiles.
  let searchTicket = 0;

  async function runSearch(reset = true) {
    // NOT `if (loading) return`. A newer search supersedes an older one;
    // bailing out here once left a freshly painted results screen empty
    // for good whenever Apply was tapped while the previous request was
    // still in flight.
    const ticket = ++searchTicket;
    loading = true;
    if (reset) page = 1;
    const warmed = takeWarmedDiscover(filters, page);
    // Nothing to wait for when the warm already has it — drawing
    // placeholders just to replace them a tick later is the flash this avoids.
    if (reset && !warmed) { resultsEl().innerHTML = skeletonTiles(12); moreEl().innerHTML = ''; }
    try {
      const { games, hasMore } = await (warmed || api.browseGames({ ...filters, page }));
      if (ticket !== searchTicket) return; // a newer search started mid-flight
      if (!resultsEl()) return; // navigated away before this landed
      if (reset) resultsEl().innerHTML = '';
      if (reset && !games.length) {
        resultsEl().classList.remove('discovery-grid');
        resultsEl().innerHTML = `${emptyState('No games match those filters. Try loosening them up.', { icon: iconSearch() })}
          <button type="button" class="btn btn--ghost btn--block" id="results-edit">Change filters</button>`;
        qs('#results-edit', root).addEventListener('click', paintFilters);
      } else {
        const start = resultsEl().children.length;
        resultsEl().insertAdjacentHTML('beforeend', games.map((g, i) => `
          <button type="button" class="discovery-tile" data-idx="${start + i}" data-igdb-id="${esc(String(g.igdb_id ?? ''))}" data-year="${esc(String(g.release_year ?? g.year ?? ''))}" aria-label="${esc(g.title)}">
            ${posterFrame(g.cover_url, g.title, 'discovery-tile__cover')}
          </button>`).join(''));
        pageGames.splice(start, games.length, ...games);
        const added = [...resultsEl().children].slice(start);
        wireTiles();
        revealTogether(added);
      }
      // Loads as you scroll; no button. The sentinel sits under the grid
      // and the next page starts about a screen and a half early.
      moreEl().innerHTML = hasMore ? `<div id="discover-sentinel" aria-hidden="true" style="height:1px"></div>` : '';
      const sentinel = hasMore && qs('#discover-sentinel', moreEl());
      if (sentinel && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          if (!entries.some((e) => e.isIntersecting) || loading) return;
          io.disconnect();
          page += 1;
          runSearch(false);
        }, { root: sentinel.closest('.view-body') || null, rootMargin: '0px 0px 1200px 0px' });
        io.observe(sentinel);
      }
    } catch (err) {
      if (ticket === searchTicket && resultsEl()) {
        resultsEl().classList.remove('discovery-grid');
        resultsEl().innerHTML = `<p class="muted">Couldn't load games right now: ${esc(err.message)}</p>`;
      }
    } finally {
      if (ticket === searchTicket) loading = false;
    }
  }

  // Every game shown so far, by its tile's data-idx, so a tap can import
  // without a second fetch.
  const pageGames = [];
  function wireTiles() {
    qsa('.discovery-tile', resultsEl()).forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const g = pageGames[Number(btn.dataset.idx)];
        if (!g || btn.dataset.opening) return;
        // Discover is browsable while signed out — a not-yet-catalogued
        // game opens live from IGDB instead of needing an account just to
        // view it; signing in only comes up if it's actually logged.
        if (!state.user) {
          if (g.igdb_id) navigate(`/game/igdb/${g.igdb_id}`);
          else toast("Couldn't open that game.", 'error');
          return;
        }
        // A guard flag, not btn.disabled: this page is kept in the back
        // stack, and a tile left disabled came back faded and dead to taps.
        btn.dataset.opening = '1';
        setTimeout(() => { delete btn.dataset.opening; }, 1500);
        try {
          const saved = await api.addGame(g, state.user.id);
          navigate(`/game/${saved.id}`);
        } catch (err) {
          toast(err.message || 'Could not open that game.', 'error');
          delete btn.dataset.opening;
        }
      });
    });
  }

  paintFilters();
}
