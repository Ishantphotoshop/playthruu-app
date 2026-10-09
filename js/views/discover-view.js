import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, emptyState, iconSearch, iconFilter, iconClose, iconChevronRight, posterFrame } from '../components.js';
import { esc, qs, qsa, toast, revealTogether, igdbSized } from '../utils.js';
import { navigate } from '../router.js';

// Browse, the screen behind the Search tab's filter button. Three steps,
// the way Letterboxd does it:
//   /discover               Browse by: ready-made lists (Highest rated,
//                           Hidden gems...) and ways in (Genre, Platform...)
//   /discover/pick/:kind    the choices for one of those ways in
//   /discover/games?...     the games, three to a row, with a filter
//                           button top right that opens Filters: one row
//                           per filter showing its current value.
// Every filter maps straight onto a field IGDB itself has (genres, themes,
// platforms, game_modes, player_perspectives, game_type, release date,
// rating and rating count, hypes), see browseGames in api.js.

const THIS_YEAR = new Date().getFullYear();
const YEARS = [
  { id: '', label: 'Any time' },
  { id: 'this', label: `This year (${THIS_YEAR})`, from: `${THIS_YEAR}-01-01`, to: `${THIS_YEAR}-12-31` },
  { id: 'last', label: `Last year (${THIS_YEAR - 1})`, from: `${THIS_YEAR - 1}-01-01`, to: `${THIS_YEAR - 1}-12-31` },
  { id: '2020s', label: '2020s', from: '2020-01-01', to: '2029-12-31' },
  { id: '2010s', label: '2010s', from: '2010-01-01', to: '2019-12-31' },
  { id: '2000s', label: '2000s', from: '2000-01-01', to: '2009-12-31' },
  { id: '1990s', label: '1990s', from: '1990-01-01', to: '1999-12-31' },
  { id: '1980s', label: '1980s', from: '1980-01-01', to: '1989-12-31' },
  { id: 'older', label: 'Before 1980', from: '1950-01-01', to: '1979-12-31' },
];
const RATINGS = [
  { label: 'Any rating', value: '' }, { label: '90 and up', value: '90' }, { label: '80 and up', value: '80' },
  { label: '75 and up', value: '75' }, { label: '50 and up', value: '50' },
];
const any = (label, list) => [{ label, value: '' }, ...list];
// Genres people actually browse by (IGDB's tiny ones like Pinball or
// Quiz/Trivia only ever turned up obscure games).
const GENRES = api.BROWSE_GENRES.filter((g) => !['genre:30', 'genre:26'].includes(g.value));

// Ready-made lists at the top of Browse. `f` is the filters each one
// starts with; the Filters page can change any of them afterwards.
const LISTS = [
  { id: 'popular', label: 'Popular right now', f: { sort: 'trending' } },
  { id: 'top', label: 'Highest rated', f: { sort: 'top_rated', minVotes: api.CREDIBLE_VOTES * 5 } },
  { id: 'critics', label: 'Critics’ favourites', f: { sort: 'all_time', minVotes: api.CREDIBLE_VOTES * 5 } },
  { id: 'anticipated', label: 'Most anticipated', f: { sort: 'anticipated' } },
  { id: 'new', label: 'New releases', f: { sort: 'recent' } },
  { id: 'gems', label: 'Hidden gems', f: { sort: 'top_rated', minRating: '80', minVotes: api.CREDIBLE_VOTES, maxVotes: api.FAMOUS_VOTES } },
  { id: 'coop', label: 'Play with friends', f: { sort: 'popular', players: 'coop' } },
  { id: 'couch', label: 'Split screen', f: { sort: 'popular', players: 'split' } },
];
const LIST = Object.fromEntries(LISTS.map((l) => [l.id, l]));

// Ways in: each opens a list of its choices, and a choice opens the games.
const KINDS = {
  genre: { label: 'Genre', key: 'genre', options: GENRES },
  platform: { label: 'Platform', key: 'platform', options: api.BROWSE_PLATFORMS_ALL },
  year: { label: 'Release date', key: 'year', options: YEARS.slice(1).map((y) => ({ label: y.label, value: y.id })) },
  players: { label: 'Players', key: 'players', options: api.BROWSE_PLAYERS },
};

const BLANK = {
  sort: 'popular', genre: '', platform: '', year: '', players: '', minRating: '',
  minVotes: '', maxVotes: '', minHypes: '', hideLogged: false, fadeLogged: false,
};

// The Filters rows, in order. `options` rows open a pick list; `text` rows
// open a box to type in; `toggle` rows switch in place.
const ROWS = [
  { key: 'sort', label: 'Sort by', options: api.BROWSE_SORTS_SIMPLE },
  { section: 'Content' },
  { key: 'year', label: 'Release date', options: YEARS.map((y) => ({ label: y.label, value: y.id })) },
  { key: 'genre', label: 'Genre', options: any('Any genre', GENRES) },
  { key: 'platform', label: 'Platform', options: any('Any platform', api.BROWSE_PLATFORMS_ALL) },
  { key: 'players', label: 'Players', options: any('Anyone', api.BROWSE_PLAYERS) },
  { key: 'minRating', label: 'Rating', options: RATINGS },
  { section: 'Your games', signedIn: true },
  { key: 'hideLogged', label: 'Hide games I’ve logged', toggle: true, signedIn: true },
  { key: 'fadeLogged', label: 'Fade games I’ve logged', toggle: true, signedIn: true },
];

// What browseGames needs, from the screen's own filter object.
function toQuery(f, page) {
  const y = YEARS.find((x) => x.id === f.year);
  // Always full games: DLC, packs and updates never belong in these lists.
  return {
    sort: f.sort, genre: f.genre, platform: f.platform, players: f.players, minRating: f.minRating,
    minVotes: f.minVotes, maxVotes: f.maxVotes, minHypes: f.minHypes, gameType: 'games',
    dateFrom: y?.from || '', dateTo: y?.to || '', page,
  };
}

// Where a set of games starts: a ready-made list, or one choice from a way in.
function startFrom(params) {
  const base = { ...BLANK };
  const list = LIST[params.get('list')];
  if (list) return { title: list.label, base: { ...base, ...list.f } };
  for (const kind of Object.values(KINDS)) {
    const v = params.get(kind.key);
    if (v == null) continue;
    const opt = kind.options.find((o) => o.value === v);
    return { title: opt?.label || kind.label, base: { ...base, [kind.key]: v } };
  }
  return { title: 'All games', base };
}

// First page of each ready-made list, fetched once and shared: Browse uses
// its covers for the little thumbnails, and opening that list paints from
// it straight away instead of waiting on the same request again.
const WARM_TTL = 5 * 60_000;
const firstPages = new Map(); // list id -> { at, promise }
function firstPage(id) {
  const hit = firstPages.get(id);
  if (hit && Date.now() - hit.at < WARM_TTL) return hit.promise;
  const promise = api.browseGames(toQuery({ ...BLANK, ...LIST[id].f }, 1));
  promise.catch(() => {});
  firstPages.set(id, { at: Date.now(), promise });
  return promise;
}
export function warmDiscover() {
  LISTS.slice(0, 4).forEach((l) => firstPage(l.id));
}

const chev = () => `<span class="browse-row__chev">${iconChevronRight()}</span>`;

// ---- Browse ----------------------------------------------------------------
export function renderDiscoverView(root) {
  root.innerHTML = topBar('Browse', { back: true, brand: true }) + `
    <div class="view-body view-body--browse">
      <p class="browse-label">Browse by</p>
      <div class="browse-list">
        ${LISTS.map((l) => `
          <a class="browse-row" href="#/discover/games?list=${l.id}">
            <span class="browse-row__name">${esc(l.label)}</span>
            <span class="browse-row__thumbs" data-thumbs="${l.id}"></span>
            ${chev()}
          </a>`).join('')}
      </div>
      <p class="browse-label">Find by</p>
      <div class="browse-list">
        ${Object.entries(KINDS).map(([id, k]) => `
          <a class="browse-row" href="#/discover/pick/${id}">
            <span class="browse-row__name">${esc(k.label)}</span>
            ${chev()}
          </a>`).join('')}
      </div>
    </div>` + navBar('/search');

  // A few covers on each ready-made list, filled in as each one arrives.
  LISTS.forEach((l) => {
    firstPage(l.id).then(({ games }) => {
      const slot = qs(`[data-thumbs="${l.id}"]`, root);
      if (!slot) return;
      slot.innerHTML = games.filter((g) => g.cover_url).slice(0, 3)
        .map((g) => `<img src="${esc(igdbSized(g.cover_url, 'cover_small'))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`).join('');
    }).catch(() => {});
  });
}

// ---- one way in: its choices ------------------------------------------------
export function renderBrowsePick(root, { kind }) {
  const k = KINDS[kind];
  if (!k) { navigate('/discover', { replace: true }); return; }
  root.innerHTML = topBar(k.label, { back: true, brand: true }) + `
    <div class="view-body view-body--browse">
      <div class="browse-list">
        ${k.options.map((o) => `
          <a class="browse-row" href="#/discover/games?${k.key}=${encodeURIComponent(o.value)}">
            <span class="browse-row__name">${esc(o.label)}</span>
            ${chev()}
          </a>`).join('')}
      </div>
    </div>` + navBar('/search');
}

// ---- the games, and their Filters -------------------------------------------
export function renderBrowseGames(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const listId = params.get('list');
  const { title, base } = startFrom(params);
  const filters = { ...base };
  let page = 1;
  let loading = false;
  let ticket = 0;
  let diary = null; // what this person has logged, loaded once when needed
  const shown = []; // every game on screen, by its tile's data-idx

  root.innerHTML = topBar(title, {
    back: true, brand: true,
    right: `<button type="button" class="browse-fbtn" id="browse-filter" aria-label="Filters">${iconFilter()}<em id="browse-fcount" hidden></em></button>`,
  }) + `
    <div class="view-body">
      <div id="browse-grid" class="discovery-grid"></div>
      <div id="browse-more"></div>
    </div>` + navBar('/search');

  const grid = qs('#browse-grid', root);
  const more = qs('#browse-more', root);
  qs('#browse-filter', root).addEventListener('click', openFilters);

  // How many filters differ from where this set of games started.
  const changed = (f) => Object.keys(BLANK).filter((key) => String(f[key] ?? '') !== String(base[key] ?? '')).length;
  const syncCount = () => {
    const n = changed(filters);
    const el = qs('#browse-fcount', root);
    el.hidden = !n; el.textContent = n;
  };

  async function needDiary() {
    if (diary || !state.user || !(filters.hideLogged || filters.fadeLogged)) return;
    try { diary = await api.getDiaryGameKeys(state.user.id); } catch { diary = null; }
  }
  const logged = (g) => !!diary && api.isInDiary(diary, g);

  async function load(reset) {
    const my = ++ticket;
    loading = true;
    if (reset) {
      page = 1; shown.length = 0;
      grid.classList.add('discovery-grid');
      grid.innerHTML = Array.from({ length: 12 }, () => '<div class="skeleton skeleton--tile"></div>').join('');
      more.innerHTML = '';
    }
    try {
      await needDiary();
      // The ready-made list's first page was usually fetched already (for
      // Browse's thumbnails); untouched filters can paint from it.
      const warm = reset && listId && LIST[listId] && !changed(filters) ? firstPage(listId) : null;
      const { games, hasMore } = await (warm || api.browseGames(toQuery(filters, page)));
      if (my !== ticket || !grid.isConnected) return;
      if (reset) grid.innerHTML = '';
      const list = filters.hideLogged ? games.filter((g) => !logged(g)) : games;
      if (!shown.length && !list.length && !hasMore) {
        grid.classList.remove('discovery-grid');
        grid.innerHTML = `<div class="browse-empty"><p class="browse-empty__title">No Games found</p>
          <p class="browse-empty__line">I would do it all over again</p></div>`;
      } else {
        const start = shown.length;
        shown.push(...list);
        grid.insertAdjacentHTML('beforeend', list.map((g, i) => `
          <button type="button" class="discovery-tile${filters.fadeLogged && logged(g) ? ' discovery-tile--logged' : ''}" data-idx="${start + i}" aria-label="${esc(g.title)}">
            ${posterFrame(g.cover_url, g.title, 'discovery-tile__cover')}
          </button>`).join(''));
        const added = [...grid.children].slice(start);
        added.forEach(wireTile);
        revealTogether(added);
      }
      // Next page loads as you scroll, about a screen and a half early.
      more.innerHTML = hasMore ? '<div id="browse-sentinel" aria-hidden="true" style="height:1px"></div>' : '';
      const sentinel = hasMore && qs('#browse-sentinel', more);
      if (sentinel && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          if (!entries.some((e) => e.isIntersecting) || loading) return;
          io.disconnect();
          page += 1;
          load(false);
        }, { root: sentinel.closest('.view-body'), rootMargin: '0px 0px 1200px 0px' });
        io.observe(sentinel);
      }
    } catch (err) {
      if (my === ticket && grid.isConnected) {
        grid.classList.remove('discovery-grid');
        grid.innerHTML = `<p class="muted">Couldn't load games right now: ${esc(err.message || '')}</p>`;
      }
    } finally {
      if (my === ticket) loading = false;
    }
  }

  function wireTile(btn) {
    btn.addEventListener('click', async () => {
      const g = shown[Number(btn.dataset.idx)];
      if (!g || btn.dataset.opening) return;
      if (!state.user) {
        if (g.igdb_id) navigate(`/game/igdb/${g.igdb_id}`);
        else toast("Couldn't open that game.", 'error');
        return;
      }
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
  }

  // ---- Filters: a full page over the games. X leaves without changing
  // anything, the tick applies, Reset goes back to where this list started.
  function openFilters() {
    const draft = { ...filters };
    const sheet = document.createElement('div');
    sheet.className = 'browse-filters';
    root.appendChild(sheet);
    const close = () => sheet.remove();

    const valueOf = (row) => {
      if (row.toggle) return '';
      if (row.text) return draft[row.key]?.trim() || 'Any';
      const o = row.options.find((x) => !x.section && x.value === String(draft[row.key] ?? ''));
      return o?.short || o?.label || 'Any';
    };
    const isSet = (row) => String(draft[row.key] ?? '') !== String(base[row.key] ?? '');

    function paintList() {
      const rows = ROWS.filter((r) => !r.signedIn || state.user);
      sheet.innerHTML = `
        <div class="browse-filters__top">
          <button type="button" class="browse-filters__icon" data-act="close" aria-label="Close">${iconClose()}</button>
          <h2>Filters</h2>
          <button type="button" class="browse-filters__icon browse-filters__icon--ok" data-act="apply" aria-label="Apply filters">${iconCheck()}</button>
        </div>
        <div class="browse-filters__body">
          ${rows.map((r) => r.section
            ? `<p class="browse-label">${esc(r.section)}</p>`
            : r.toggle
              ? `<button type="button" class="browse-frow" data-toggle="${r.key}">
                   <span class="browse-frow__name">${esc(r.label)}</span>
                   <span class="browse-switch${draft[r.key] ? ' is-on' : ''}" aria-hidden="true"></span>
                 </button>`
              : `<button type="button" class="browse-frow" data-row="${r.key}">
                   <span class="browse-frow__name">${esc(r.label)}</span>
                   <span class="browse-frow__value${isSet(r) ? ' is-set' : ''}">${esc(valueOf(r))}</span>
                   ${chev()}
                 </button>`).join('')}
          <button type="button" class="browse-reset" data-act="reset">Reset filters</button>
        </div>`;
      qs('[data-act="close"]', sheet).addEventListener('click', close);
      qs('[data-act="apply"]', sheet).addEventListener('click', () => {
        Object.assign(filters, draft);
        close();
        syncCount();
        load(true);
      });
      qs('[data-act="reset"]', sheet).addEventListener('click', () => { Object.assign(draft, base); paintList(); });
      qsa('[data-toggle]', sheet).forEach((b) => b.addEventListener('click', () => {
        draft[b.dataset.toggle] = !draft[b.dataset.toggle];
        qs('.browse-switch', b).classList.toggle('is-on', draft[b.dataset.toggle]);
      }));
      qsa('[data-row]', sheet).forEach((b) => b.addEventListener('click', () => paintRow(ROWS.find((r) => r.key === b.dataset.row))));
    }

    // One filter's choices (or its text box), then straight back to the list.
    function paintRow(row) {
      sheet.innerHTML = `
        <div class="browse-filters__top">
          <button type="button" class="browse-filters__icon" data-act="back" aria-label="Back">${iconBackArrow()}</button>
          <h2>${esc(row.label)}</h2>
          <span class="browse-filters__icon"></span>
        </div>
        <div class="browse-filters__body">
          ${row.text
            ? `<div class="browse-text"><input type="text" class="search-input" id="browse-text" placeholder="${esc(row.text)}" value="${esc(draft[row.key] || '')}" autocomplete="off" enterkeyhint="done">
                 <button type="button" class="btn btn--accent btn--block" data-act="done">Done</button></div>`
            : row.options.map((o) => o.section ? `<p class="browse-label">${esc(o.section)}</p>` : `
              <button type="button" class="browse-opt${String(draft[row.key] ?? '') === o.value ? ' is-on' : ''}" data-v="${esc(o.value)}">
                <span>${esc(o.label)}</span>${String(draft[row.key] ?? '') === o.value ? iconCheck() : ''}
              </button>`).join('')}
        </div>`;
      qs('[data-act="back"]', sheet).addEventListener('click', paintList);
      if (row.text) {
        const input = qs('#browse-text', sheet);
        const done = () => { draft[row.key] = input.value.trim(); paintList(); };
        qs('[data-act="done"]', sheet).addEventListener('click', done);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
        input.focus();
      } else {
        qsa('.browse-opt', sheet).forEach((b) => b.addEventListener('click', () => { draft[row.key] = b.dataset.v; paintList(); }));
      }
    }

    paintList();
  }

  syncCount();
  load(true);
}

function iconCheck() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
}
function iconBackArrow() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
}
