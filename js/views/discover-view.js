import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, iconSearch, iconFilter, iconBack, posterFrame } from '../components.js';
import { esc, qs, qsa, toast } from '../utils.js';
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
function iconCheck() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function withAny(label, options) {
  return [{ label, value: '' }, ...options];
}
// A row of plain buttons instead of a native <select> — a real <select>'s
// dropdown is rendered by the OS/browser itself, not this page's CSS, so
// it kept showing up as an unstyled white popup with barely-visible text
// no matter what was tried here. Chips are just DOM elements, fully
// themeable, and (bonus) every option is visible at once instead of
// hidden behind a tap — which is also closer to what was asked for: a
// filters page that's actually packed with the real options, not a
// handful of options hidden inside dropdowns.
function chipRow(fieldId, options, activeValue) {
  return `<div class="disc-chip-row" id="${fieldId}">
    ${options.map((o) => `<button type="button" class="chip${activeValue === o.value ? ' chip--active' : ''}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
  </div>`;
}

export function renderDiscoverView(root) {
  const filters = {
    genre: '', platform: '', dateFrom: '', dateTo: '', sort: 'popular',
    minRating: '', multiplayer: '', developer: '', publisher: '',
  };
  let page = 1;
  let loading = false;

  // dateFrom/dateTo count as one "Released" filter, not two — they're
  // always set together by a single era chip. Sort counts too now that
  // it lives on this page rather than always being visible above the
  // results — once it's tucked away, the badge is the only hint it's
  // not on the default.
  function activeFilterCount() {
    const singleKeys = ['genre', 'platform', 'minRating', 'multiplayer', 'developer', 'publisher'];
    const era = (filters.dateFrom || filters.dateTo) ? 1 : 0;
    const sortChanged = filters.sort !== 'popular' ? 1 : 0;
    return singleKeys.filter((k) => filters[k]).length + era + sortChanged;
  }

  // ---- results screen --------------------------------------------------
  function paintResults() {
    const count = activeFilterCount();
    root.innerHTML = topBar('Filter', { back: true }) + `
      <div class="view-body">
        <div class="discover-toolbar">
          <button type="button" class="discover-filters-btn discover-filters-btn--solo${count ? ' discover-filters-btn--active' : ''}" id="open-filters">
            ${iconFilter()} Filters${count ? `<span class="discover-filters-count">${count}</span>` : ''}
          </button>
        </div>
        <div id="discover-results" class="discover-list"></div>
        <div id="discover-more"></div>
      </div>` + navBar('/discover');

    qs('#open-filters', root).addEventListener('click', paintFilters);

    runSearch();
  }

  const resultsEl = () => qs('#discover-results', root);
  const moreEl = () => qs('#discover-more', root);

  async function runSearch(reset = true) {
    if (loading) return;
    loading = true;
    if (reset) { page = 1; resultsEl().innerHTML = spinner(); moreEl().innerHTML = ''; }
    try {
      const { games, hasMore } = await api.browseGames({ ...filters, page });
      if (!resultsEl()) return; // navigated away (to the filters screen or elsewhere) before this landed
      if (reset) resultsEl().innerHTML = '';
      if (reset && !games.length) {
        resultsEl().innerHTML = emptyState('No games match those filters. Try loosening them up.', { icon: iconSearch() });
      } else {
        resultsEl().insertAdjacentHTML('beforeend', games.map((g, i) => {
          const meta = [g.release_year, g.platform, g.genre].filter(Boolean).join(' · ');
          return `
            <button type="button" class="result-row discover-card" data-idx="${i}">
              ${posterFrame(g.cover_url, g.title, 'result-row__cover')}
              <div class="result-row__info">
                <div class="result-row__title">${esc(g.title)}</div>
                ${meta ? `<div class="result-row__meta">${esc(meta)}</div>` : ''}
              </div>
            </button>`;
        }).join(''));
        wireDiscoverCards(games);
      }
      moreEl().innerHTML = hasMore ? `<button class="btn btn--ghost btn--block" id="load-more">Load more</button>` : '';
      if (hasMore) qs('#load-more', moreEl()).addEventListener('click', () => { page += 1; runSearch(false); });
    } catch (err) {
      if (resultsEl()) resultsEl().innerHTML = `<p class="muted">Couldn't load games right now: ${esc(err.message)}</p>`;
    } finally {
      loading = false;
    }
  }

  // Each freshly-rendered batch of cards carries the RAWG data for THAT
  // batch (closed over here), so a tap can import without a second fetch.
  function wireDiscoverCards(batch) {
    qsa('.discover-card', resultsEl()).forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      const g = batch[Number(btn.dataset.idx)];
      btn.addEventListener('click', async () => {
        // Discover is browsable while signed out now (see landing-view.js)
        // — a not-yet-catalogued game opens live from IGDB instead of
        // needing an account just to view it (see renderGameView's
        // igdbId mode); signing in only comes up if this game is
        // actually logged/rated/saved, from that page itself.
        if (!state.user) {
          if (g.igdb_id) navigate(`/game/igdb/${g.igdb_id}`);
          else toast("Couldn't open that game.", 'error');
          return;
        }
        btn.disabled = true;
        try {
          const saved = await api.addGame(g, state.user.id);
          navigate(`/game/${saved.id}`);
        } catch (err) {
          toast(err.message || 'Could not open that game.', 'error');
          btn.disabled = false;
        }
      });
    });
  }

  // ---- filters screen ---------------------------------------------------
  // A real full page, not an overlay — back arrow discards changes and
  // returns to the results exactly as they were; the tick applies the
  // draft and re-searches. Edits happen on a draft copy so nothing takes
  // effect until it's actually confirmed.
  function paintFilters() {
    const draft = { ...filters };

    root.innerHTML = `
      <header class="topbar">
        <button type="button" class="topbar__back" id="filters-cancel" aria-label="Back">${iconBack()}</button>
        <h1 class="topbar__title">Filters</h1>
        <div class="topbar__right">
          <button type="button" class="topbar__back" id="filters-apply" aria-label="Apply filters">${iconCheck()}</button>
        </div>
      </header>
      <div class="view-body">
        <div class="disc-field">
          <span class="disc-field__label">Sort by</span>
          ${chipRow('f-sort', api.BROWSE_SORTS, draft.sort)}
        </div>
        <div class="disc-field">
          <span class="disc-field__label">Genre</span>
          ${chipRow('f-genre', withAny('Any genre', api.BROWSE_GENRES), draft.genre)}
        </div>
        <div class="disc-field">
          <span class="disc-field__label">Platform</span>
          ${chipRow('f-platform', withAny('Any platform', api.BROWSE_PLATFORMS), draft.platform)}
        </div>
        <div class="disc-field">
          <span class="disc-field__label">Rating</span>
          ${chipRow('f-rating', api.BROWSE_RATINGS, draft.minRating)}
        </div>
        <div class="disc-field">
          <span class="disc-field__label">Players</span>
          ${chipRow('f-players', api.BROWSE_PLAYER_MODES, draft.multiplayer)}
        </div>
        <div class="disc-field">
          <span class="disc-field__label">Released</span>
          <div class="disc-chip-row" id="f-era">
            ${ERA_OPTIONS.map((e) => `
              <button type="button" class="chip${eraForFilters(draft).id === e.id ? ' chip--active' : ''}" data-era="${e.id}">${e.label}</button>`).join('')}
          </div>
        </div>
        <div class="disc-field-grid">
          <label class="disc-field">
            <span class="disc-field__label">Developer</span>
            <input type="text" id="f-developer" class="discover-select" placeholder="e.g. Naughty Dog" value="${esc(draft.developer)}">
          </label>
          <label class="disc-field">
            <span class="disc-field__label">Publisher</span>
            <input type="text" id="f-publisher" class="discover-select" placeholder="e.g. Nintendo" value="${esc(draft.publisher)}">
          </label>
        </div>
        <button type="button" class="btn btn--ghost btn--block" id="filters-clear">Clear all</button>
      </div>`;

    const wireChipRow = (fieldId, key) => {
      const rowEl = qs(`#${fieldId}`, root);
      qsa('.chip', rowEl).forEach((chip) => {
        chip.addEventListener('click', () => {
          draft[key] = chip.dataset.value;
          qsa('.chip', rowEl).forEach((c) => c.classList.toggle('chip--active', c === chip));
        });
      });
    };
    wireChipRow('f-sort', 'sort');
    wireChipRow('f-genre', 'genre');
    wireChipRow('f-platform', 'platform');
    wireChipRow('f-rating', 'minRating');
    wireChipRow('f-players', 'multiplayer');
    qs('#f-developer', root).addEventListener('input', (e) => { draft.developer = e.target.value; });
    qs('#f-publisher', root).addEventListener('input', (e) => { draft.publisher = e.target.value; });
    qsa('.chip', qs('#f-era', root)).forEach((chip) => {
      chip.addEventListener('click', () => {
        const era = ERA_OPTIONS.find((e) => e.id === chip.dataset.era);
        draft.dateFrom = era.dateFrom; draft.dateTo = era.dateTo;
        qsa('.chip', qs('#f-era', root)).forEach((c) => c.classList.toggle('chip--active', c === chip));
      });
    });

    qs('#filters-cancel', root).addEventListener('click', paintResults);
    qs('#filters-clear', root).addEventListener('click', () => {
      Object.assign(filters, { genre: '', platform: '', dateFrom: '', dateTo: '', sort: 'popular', minRating: '', multiplayer: '', developer: '', publisher: '' });
      paintResults();
    });
    qs('#filters-apply', root).addEventListener('click', () => {
      Object.assign(filters, draft);
      paintResults();
    });
  }

  paintResults();
}
