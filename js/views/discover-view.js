import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, emptyState, iconSearch, iconFilter, iconClose, iconChevronRight, posterFrame } from '../components.js';
import { esc, qs, qsa, toast, revealTogether, igdbSized, keepLoading } from '../utils.js';
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
  sort: 'popular', genre: '', platform: '', year: '', players: '', stars: '',
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
  { key: 'rating', label: 'Rating', custom: true },
  { section: 'Your games', signedIn: true },
  { key: 'hideLogged', label: 'Hide games I’ve logged', toggle: true, signedIn: true },
  { key: 'fadeLogged', label: 'Fade games I’ve logged', toggle: true, signedIn: true },
];

// What browseGames needs, from the screen's own filter object.
function toQuery(f, page) {
  const y = YEARS.find((x) => x.id === f.year);
  // Always full games: DLC, packs and updates never belong in these lists.
  return {
    sort: f.sort, genre: f.genre, platform: f.platform, players: f.players, stars: f.stars,
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

// The Rating page: average rating sorts, the person's own rating sorts,
// and a half-star slider to browse games at one star rating.
const RATING_SORTS = {
  top_rated: 'Average, highest first', lowest: 'Average, lowest first',
  mine_high: 'Yours, highest first', mine_low: 'Yours, lowest first',
};
const MY_SORTS = new Set(['mine_high', 'mine_low']);
const starsLabel = (v) => {
  const n = Number(v);
  const whole = Math.floor(n);
  return `${whole || ''}${n % 1 ? '\u00bd' : ''} star${n === 1 ? '' : 's'}`;
};
// Five stars filled to `v` (0 to 5, halves allowed): the same star glyph as
// everywhere else. A half star has to be cut through the star's own tip, but
// a font's star is never centred in its box (and which font draws it
// depends on the phone), so the middle is measured from the drawn star
// itself: the middle of its ink, as a share of its box.
let starMid = null;
function starMiddle() {
  if (starMid != null) return starMid;
  starMid = 0.5;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    // Measure with exactly the font the star is drawn in.
    const probe = document.createElement('span');
    probe.className = 'star-g__base';
    probe.style.cssText = 'position:absolute;visibility:hidden';
    probe.textContent = '★';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
    probe.remove();
    const m = ctx.measureText('\u2605');
    if (m.width > 0 && Number.isFinite(m.actualBoundingBoxRight)) {
      const mid = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
      if (mid > 0 && mid < m.width) starMid = mid / m.width;
    }
  } catch { /* keep the plain middle */ }
  return starMid;
}
const starsHtml = (v) => {
  const n = Number(v) || 0;
  const mid = (starMiddle() * 100).toFixed(2);
  return `<span class="star-row" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => {
    const pct = n >= i ? 100 : n >= i - 0.5 ? Number(mid) : 0;
    return `<span class="star-g"><span class="star-g__base">\u2605</span><span class="star-g__fill" style="clip-path:inset(0 ${(100 - pct).toFixed(2)}% 0 0)">\u2605</span></span>`;
  }).join('')}</span>`;
};

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
  async function myRated() {
    if (page > 1) return { games: [], hasMore: false };
    const y = YEARS.find((x) => x.id === filters.year);
    const fromY = y?.from ? Number(y.from.slice(0, 4)) : null;
    const toY = y?.to ? Number(y.to.slice(0, 4)) : null;
    let rows = await api.getMyRatedGames(state.user.id);
    if (fromY) rows = rows.filter((g) => g.release_year >= fromY && g.release_year <= toY);
    if (filters.stars) rows = rows.filter((g) => g.my_rating === Number(filters.stars));
    rows.sort((a, b) => (filters.sort === 'mine_low' ? a.my_rating - b.my_rating : b.my_rating - a.my_rating));
    return { games: rows, hasMore: false };
  }

  // Scrolling to the end loads the next page, and the page after it is
  // fetched while you look at this one, so a fast fling finds posters
  // waiting instead of hitting the bottom. Placeholders hold the space
  // while a page is on its way.
  let nextPage = null; // { page, filtersKey, promise }
  let hasMoreNow = false;
  const guard = keepLoading({
    sentinel: () => qs('#browse-sentinel', more),
    scroller: () => grid.closest('.view-body'),
    trigger: () => { if (!loading && hasMoreNow) { page += 1; load(false); } },
  });
  const filtersKey = () => JSON.stringify(filters);
  const fetchPageNow = (pg) => api.browseGames(toQuery(filters, pg));
  const skel = (n) => Array.from({ length: n }, () => '<div class="skeleton skeleton--tile" data-ph></div>').join('');

  async function load(reset) {
    const my = ++ticket;
    loading = true;
    if (reset) {
      page = 1; shown.length = 0; nextPage = null; hasMoreNow = false;
      grid.classList.add('discovery-grid');
      grid.innerHTML = skel(12);
      more.innerHTML = '';
    } else {
      grid.insertAdjacentHTML('beforeend', skel(12));
    }
    try {
      await needDiary();
      // The ready-made list's first page was usually fetched already (for
      // Browse's thumbnails); untouched filters can paint from it.
      const warm = reset && listId && LIST[listId] && !changed(filters) ? firstPage(listId) : null;
      // Your rating: the games you've rated, from your own diary, in your
      // order (one page, it's your list). Release date and stars still narrow it.
      const mine = MY_SORTS.has(filters.sort) && state.user;
      const ahead = nextPage && nextPage.page === page && nextPage.key === filtersKey() ? nextPage.promise : null;
      nextPage = null;
      const { games, hasMore } = mine ? await myRated() : await (warm || ahead || fetchPageNow(page));
      if (my !== ticket || !grid.isConnected) return;
      if (reset) grid.innerHTML = '';
      else qsa('[data-ph]', grid).forEach((el) => el.remove());
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
      // The end-of-list marker the scroll guard watches.
      hasMoreNow = !!hasMore && !mine;
      more.innerHTML = hasMoreNow ? '<div id="browse-sentinel" aria-hidden="true" style="height:1px"></div>' : '';
      // Start on the following page now, while this one is being looked at.
      if (hasMoreNow) {
        const key = filtersKey();
        const p = fetchPageNow(page + 1);
        p.catch(() => {});
        nextPage = { page: page + 1, key, promise: p };
      }
    } catch (err) {
      if (my === ticket && grid.isConnected) {
        grid.classList.remove('discovery-grid');
        grid.innerHTML = `<p class="muted">Couldn't load games right now: ${esc(err.message || '')}</p>`;
      }
    } finally {
      if (my === ticket) {
        loading = false;
        // Still near the end after this page (a fast fling): carry straight on.
        guard.check();
      }
    }
  }

  function wireTile(btn) {
    btn.addEventListener('click', async () => {
      const g = shown[Number(btn.dataset.idx)];
      if (!g || btn.dataset.opening) return;
      if (g.id) { navigate(`/game/${g.id}`); return; } // already in the catalogue (your rated games)
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
      if (row.custom) return draft.stars ? starsLabel(draft.stars) : (RATING_SORTS[draft.sort] || 'Any');
      if (row.text) return draft[row.key]?.trim() || 'Any';
      const o = row.options.find((x) => !x.section && x.value === String(draft[row.key] ?? ''));
      return o?.short || o?.label || (row.key === 'sort' && RATING_SORTS[draft.sort]) || 'Any';
    };
    const isSet = (row) => (row.custom
      ? !!draft.stars || (!!RATING_SORTS[draft.sort] && draft.sort !== base.sort)
      : String(draft[row.key] ?? '') !== String(base[row.key] ?? ''));

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
      qsa('[data-row]', sheet).forEach((b) => b.addEventListener('click', () => {
        const row = ROWS.find((r) => r.key === b.dataset.row);
        if (row.custom) paintRating(); else paintRow(row);
      }));
    }

    // Rating: two ways to sort by it, and stars to browse by.
    function paintRating() {
      const opt = (v, label) => `<button type="button" class="browse-opt${draft.sort === v ? ' is-on' : ''}" data-sort="${v}"><span>${label}</span>${draft.sort === v ? iconCheck() : ''}</button>`;
      sheet.innerHTML = `
        <div class="browse-filters__top">
          <button type="button" class="browse-filters__icon" data-act="back" aria-label="Back">${iconBackArrow()}</button>
          <h2>Rating</h2>
          <span class="browse-filters__icon"></span>
        </div>
        <div class="browse-filters__body">
          <p class="browse-label">Average rating</p>
          ${opt('top_rated', 'Highest first')}${opt('lowest', 'Lowest first')}
          ${state.user ? `<p class="browse-label">Your rating</p>${opt('mine_high', 'Highest first')}${opt('mine_low', 'Lowest first')}` : ''}
          <p class="browse-label">Browse by stars</p>
          <div class="star-pick">
            <div class="star-pick__stars">${starsHtml(draft.stars)}
              <input type="range" class="star-pick__range" min="0" max="5" step="0.5" value="${Number(draft.stars) || 0}" aria-label="Star rating">
            </div>
            <button type="button" class="star-pick__clear" data-act="clear-stars"${draft.stars ? '' : ' hidden'}>Reset</button>
          </div>
        </div>`;
      qs('[data-act="back"]', sheet).addEventListener('click', paintList);
      qsa('[data-sort]', sheet).forEach((b) => b.addEventListener('click', () => { draft.sort = b.dataset.sort; paintList(); }));
      const range = qs('.star-pick__range', sheet);
      const sync = () => {
        const v = Number(range.value);
        draft.stars = v ? String(v) : '';
        qs('.star-row', sheet).outerHTML = starsHtml(v);
        qs('[data-act="clear-stars"]', sheet).hidden = !v;
      };
      range.addEventListener('input', sync);
      qs('[data-act="clear-stars"]', sheet).addEventListener('click', () => { range.value = 0; sync(); });
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
