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
// Every IGDB genre, plus Horror (IGDB files it as a theme, but people
// browse by it like a genre), A to Z.
const GENRES = [...api.BROWSE_GENRES, { label: 'Horror', value: 'theme:19' }]
  .sort((a, b) => a.label.localeCompare(b.label));
const PLATFORMS = api.BROWSE_PLATFORM_GROUPS.flatMap((g) => g.items);
// Platform and genre can hold several picks at once, comma separated.
const MULTI = new Set(['platform', 'genre']);
const vals = (v) => String(v || '').split(',').filter(Boolean);

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
  platform: { label: 'Platform', key: 'platform', options: api.BROWSE_PLATFORM_GROUPS.flatMap((g) => [{ section: g.label }, ...g.items]) },
  length: { label: 'Length', key: 'length', options: api.BROWSE_LENGTHS },
  year: { label: 'Release date', key: 'year', options: YEARS.slice(1).map((y) => ({ label: y.label, value: y.id })) },
  players: { label: 'Players', key: 'players', options: api.BROWSE_PLAYERS },
};

const BLANK = {
  query: '', sort: 'popular', genre: '', platform: '', length: '', year: '', players: '', stars: '',
  minVotes: '', maxVotes: '', minHypes: '', hideLogged: false, fadeLogged: false,
};

// The Filters page's side menu, top to bottom.
const CATS = [
  { id: 'sort', label: 'Sort' },
  { id: 'mine', label: 'Your games', signedIn: true },
  { id: 'platform', label: 'Platform' },
  { id: 'genre', label: 'Genre' },
  { id: 'length', label: 'Length' },
  { id: 'year', label: 'Released' },
  { id: 'players', label: 'Players' },
  { id: 'rating', label: 'Rating' },
];

// What browseGames needs, from the screen's own filter object.
function toQuery(f, page) {
  const y = YEARS.find((x) => x.id === f.year);
  // Always full games: DLC, packs and updates never belong in these lists.
  return {
    query: f.query, sort: f.sort, genre: f.genre, platform: f.platform, length: f.length, players: f.players, stars: f.stars,
    minVotes: f.minVotes, maxVotes: f.maxVotes, minHypes: f.minHypes, gameType: 'games',
    dateFrom: y?.from || '', dateTo: y?.to || '', page,
  };
}

// Where a set of games starts: a ready-made list, or one choice from a way in.
function startFrom(params) {
  const base = { ...BLANK };
  const text = (params.get('q') || '').trim();
  if (text) return { title: `\u201c${text}\u201d`, base: { ...base, query: text } };
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
  root.innerHTML = topBar('Browse', { back: true, brand: true, flush: true }) + `
    <div class="view-body view-body--browse">
      <p class="browse-label">Browse by</p>
      <div class="browse-list">
        ${LISTS.map((l) => `
          <a class="browse-row" href="#/discover/games?list=${l.id}">
            <span class="browse-row__name">${esc(l.label)}</span>
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
}

// ---- one way in: its choices ------------------------------------------------
export function renderBrowsePick(root, { kind }) {
  const k = KINDS[kind];
  if (!k) { navigate('/discover', { replace: true }); return; }
  root.innerHTML = topBar(k.label, { back: true, brand: true, flush: true }) + `
    <div class="view-body view-body--browse">
      <div class="browse-list">
        ${k.options.map((o) => o.section ? `<p class="browse-label">${esc(o.section)}</p>` : `
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
    back: true, brand: true, flush: true,
    right: `<button type="button" class="browse-fbtn" id="browse-filter" aria-label="Filters">${iconFilter()}<em id="browse-fcount" hidden></em></button>`,
  }) + `
    <div class="view-body">
      <div id="browse-chips" class="browse-chips" hidden></div>
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
    syncChips();
    syncTitle();
  };

  // What each filter says when it is on, for the chips under the header.
  const optLabel = (opts, v) => opts.find((o) => !o.section && o.value === v)?.label || '';
  function chipFor(key) {
    const f = filters[key];
    switch (key) {
      case 'sort': return RATING_SORTS[f] || optLabel(api.BROWSE_SORTS_SIMPLE, f).replace(/ first$/, '') || '';
      case 'year': return YEARS.find((y) => y.id === f)?.label || '';
      case 'length': return optLabel(api.BROWSE_LENGTHS, f);
      case 'players': return optLabel(api.BROWSE_PLAYERS, f);
      case 'stars': return f ? starsLabel(f) : '';
      case 'hideLogged': return f ? 'Hiding logged games' : '';
      case 'fadeLogged': return f ? 'Fading logged games' : '';
      default: return '';
    }
  }
  const CHIP_KEYS = ['sort', 'platform', 'genre', 'length', 'year', 'players', 'stars', 'hideLogged', 'fadeLogged'];
  // One chip per filter, and one per platform or genre picked on top of
  // where the list started.
  function chipList() {
    const out = [];
    for (const k of CHIP_KEYS) {
      if (String(filters[k] ?? '') === String(base[k] ?? '')) continue;
      if (MULTI.has(k)) {
        const had = vals(base[k]);
        vals(filters[k]).filter((v) => !had.includes(v)).forEach((v) => {
          const label = optLabel(k === 'genre' ? GENRES : PLATFORMS, v);
          if (label) out.push({ k, v, label });
        });
      } else if (chipFor(k)) out.push({ k, v: '', label: chipFor(k) });
    }
    return out;
  }
  function syncChips() {
    const box = qs('#browse-chips', root);
    const on = chipList();
    box.hidden = !on.length;
    box.innerHTML = on.map((c, i) => `<button type="button" class="browse-chip" data-chip="${i}"><span>${esc(c.label)}</span>${iconClose()}</button>`).join('');
    qsa('[data-chip]', box).forEach((b) => b.addEventListener('click', () => {
      const { k, v } = on[Number(b.dataset.chip)];
      filters[k] = MULTI.has(k) ? vals(filters[k]).filter((x) => x !== v).join(',') : base[k];
      syncCount();
      load(true);
    }));
  }
  // The title is the list's own name until the sort is changed; then it
  // says what the games are now sorted by.
  function syncTitle() {
    const el = qs('.topbar__title', root);
    if (!el) return;
    const sortLabel = filters.sort !== base.sort ? (RATING_SORTS[filters.sort] || optLabel(api.BROWSE_SORTS_SIMPLE, filters.sort)) : '';
    el.textContent = sortLabel || title;
  }

  async function needDiary() {
    if (diary || !state.user || !(filters.hideLogged || filters.fadeLogged)) return;
    try { diary = await api.getDiaryGameKeys(state.user.id); } catch { diary = null; }
  }
  const logged = (g) => !!diary && api.isInDiary(diary, g);
  // Your rating: the games you've rated, in your order. Release date and
  // Genre / Platform / Players narrow it too: those are asked of IGDB about
  // just your rated games, so the answer is the same as everywhere else.
  async function myRated() {
    if (fetchedPage > 1) return { games: [], hasMore: false };
    let rows = await api.getMyRatedGames(state.user.id);
    const needsIgdb = filters.genre || filters.platform || filters.length || filters.players || filters.year;
    if (needsIgdb) {
      const ids = rows.map((g) => g.igdb_id).filter(Boolean);
      const q = toQuery(filters, 1);
      const res = await api.browseGames({ ...q, stars: '', sort: 'popular', gameType: '', idList: ids, limit: 500 });
      const keep = new Set(res.games.map((g) => g.igdb_id));
      rows = rows.filter((g) => g.igdb_id && keep.has(g.igdb_id));
    }
    if (filters.stars) rows = rows.filter((g) => g.my_rating === Number(filters.stars));
    rows.sort((a, b) => (filters.sort === 'mine_low' ? a.my_rating - b.my_rating : b.my_rating - a.my_rating));
    return { games: rows, hasMore: false };
  }

  // Loads the way "Bored? Try these" does: posters come in twelve at a
  // time (four rows of three). Twelve placeholder frames hold the space at
  // the end of the grid and are swapped for the twelve posters in place, each
  // cover fading up inside its own frame. What the server returns (a page of
  // twenty) is kept in `buffer` and drawn twelve at a time, and the next page
  // is fetched while you look at the current block, so a fast scroll finds
  // posters waiting.
  const BATCH = 12;
  let buffer = [];      // fetched, not drawn yet
  let fetchedPage = 0;  // last page asked of the server
  let serverMore = true; // the server has more pages
  let prefetching = null;
  const canLoadMore = () => buffer.length > 0 || serverMore;
  const guard = keepLoading({
    sentinel: () => qs('#browse-sentinel', more),
    scroller: () => grid.closest('.view-body'),
    trigger: () => { if (!loading && canLoadMore()) load(false); },
  });
  const skel = (n) => Array.from({ length: n }, () => '<div class="skeleton skeleton--tile" data-ph></div>').join('');

  // One more page from the server into the buffer (the list's own first
  // page when it was already fetched for Browse's thumbnails).
  async function fetchPage(my, { warm = null } = {}) {
    const mine = MY_SORTS.has(filters.sort) && state.user;
    fetchedPage += 1;
    const res = mine ? await myRated() : await (warm || api.browseGames(toQuery(filters, fetchedPage)));
    if (my !== ticket) return;
    serverMore = !!res.hasMore && !mine;
    buffer.push(...(filters.hideLogged ? res.games.filter((g) => !logged(g)) : res.games));
  }

  async function load(reset) {
    const my = ++ticket;
    loading = true;
    if (reset) {
      shown.length = 0; buffer = []; fetchedPage = 0; serverMore = true; prefetching = null;
      grid.classList.add('discovery-grid');
      grid.innerHTML = skel(BATCH);
      more.innerHTML = '';
    } else {
      grid.insertAdjacentHTML('beforeend', skel(BATCH));
    }
    try {
      await needDiary();
      const warm = reset && listId && LIST[listId] && !changed(filters) ? firstPage(listId) : null;
      if (prefetching) await prefetching;
      let first = true;
      while (buffer.length < BATCH && serverMore) {
        await fetchPage(my, { warm: first ? warm : null });
        first = false;
        if (my !== ticket) return;
      }
      if (my !== ticket || !grid.isConnected) return;
      qsa('[data-ph]', grid).forEach((el) => el.remove());
      const batch = buffer.splice(0, BATCH);
      if (!shown.length && !batch.length) {
        grid.classList.remove('discovery-grid');
        grid.innerHTML = `<div class="browse-empty"><p class="browse-empty__title">No Games found</p>
          <p class="browse-empty__line">I would do it all over again</p></div>`;
      } else {
        const start = shown.length;
        shown.push(...batch);
        grid.insertAdjacentHTML('beforeend', batch.map((g, i) => `
          <button type="button" class="discovery-tile${filters.fadeLogged && logged(g) ? ' discovery-tile--logged' : ''}" data-idx="${start + i}" aria-label="${esc(g.title)}">
            ${posterFrame(g.cover_url, g.title, 'discovery-tile__cover')}
          </button>`).join(''));
        [...grid.children].slice(start).forEach(wireTile);
      }
      // The end-of-list marker the scroll guard watches.
      more.innerHTML = canLoadMore() ? '<div id="browse-sentinel" aria-hidden="true" style="height:1px"></div>' : '';
      // Fetch the following page now, while this block is being looked at.
      if (buffer.length < BATCH && serverMore && !prefetching) {
        prefetching = fetchPage(my).catch(() => { serverMore = false; }).finally(() => { prefetching = null; });
      }
    } catch (err) {
      if (my === ticket && grid.isConnected) {
        grid.classList.remove('discovery-grid');
        grid.innerHTML = `<p class="muted">Couldn't load games right now: ${esc(err.message || '')}</p>`;
      }
    } finally {
      if (my === ticket) {
        loading = false;
        // Still near the end after this block (a fast fling): carry straight on.
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

  // ---- Filters: a full page over the games, laid out like a shop's
  // filters. Categories down the left (a green dot on any that is set),
  // that category's choices on the right, and at the bottom Reset and a
  // Show button that says how many games the choices leave. X leaves
  // without changing anything.
  function openFilters() {
    const draft = { ...filters };
    let cat = 'sort';
    const sheet = document.createElement('div');
    sheet.className = 'browse-filters';
    // On the body (like every other sheet) so the app's Back handling can
    // close it.
    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    sheet.__dismiss = close;

    const cats = CATS.filter((c) => !c.signedIn || state.user);
    const differs = (k) => String(draft[k] ?? '') !== String(base[k] ?? '');
    const catSet = (id) => (id === 'mine' ? differs('hideLogged') || differs('fadeLogged')
      : id === 'rating' ? differs('stars') : differs(id));
    const anySet = () => Object.keys(BLANK).some((k) => k !== 'query' && differs(k));

    const tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const isOn = (k, v) => (MULTI.has(k) ? vals(draft[k]).includes(v) : String(draft[k] ?? '') === v);
    const opt = (k, o, multi = MULTI.has(k)) => {
      const on = isOn(k, o.value);
      return `<button type="button" class="bf-opt" data-k="${k}" data-v="${esc(o.value)}">
        <span class="bf-mark bf-mark--${multi ? 'check' : 'radio'}${on ? ' is-on' : ''}">${multi && on ? tick : ''}</span>
        <span class="bf-opt__name">${esc(o.label)}</span></button>`;
    };
    const anyRow = (k, label) => `<button type="button" class="bf-opt" data-k="${k}" data-v="">
        <span class="bf-mark bf-mark--radio${draft[k] ? '' : ' is-on'}"></span><span class="bf-opt__name">${esc(label)}</span></button>`;
    const label = (text) => `<p class="browse-label">${esc(text)}</p>`;
    const sw = (k, text) => `<button type="button" class="browse-frow" data-sw="${k}">
        <span class="browse-frow__name">${esc(text)}</span><span class="browse-switch${draft[k] ? ' is-on' : ''}" aria-hidden="true"></span></button>`;

    function pane() {
      switch (cat) {
        case 'sort':
          return api.BROWSE_SORTS_SIMPLE.map((o) => (o.section ? label(o.section) : opt('sort', o))).join('')
            + (state.user ? label('Your rating') + opt('sort', { label: 'Highest first', value: 'mine_high' }) + opt('sort', { label: 'Lowest first', value: 'mine_low' }) : '');
        case 'mine':
          return sw('hideLogged', 'Hide games I’ve logged') + sw('fadeLogged', 'Fade games I’ve logged');
        case 'platform':
          return anyRow('platform', 'Any platform') + api.BROWSE_PLATFORM_GROUPS.map((g) => label(g.label) + g.items.map((o) => opt('platform', o)).join('')).join('');
        case 'genre':
          return anyRow('genre', 'Any genre') + GENRES.map((o) => opt('genre', o)).join('');
        case 'length':
          return anyRow('length', 'Any length') + api.BROWSE_LENGTHS.map((o) => opt('length', o)).join('')
            + '<p class="bf-note">How long players say a normal playthrough takes, from IGDB. Games nobody has timed yet are left out while a length is picked.</p>';
        case 'year':
          return YEARS.map((y) => opt('year', { label: y.label, value: y.id })).join('');
        case 'players':
          return anyRow('players', 'Anyone') + api.BROWSE_PLAYERS.map((o) => opt('players', o)).join('');
        case 'rating':
          return `${label('Average rating')}
            <div class="star-pick">
              <div class="star-pick__stars">${starsHtml(draft.stars)}
                <input type="range" class="star-pick__range" min="0" max="5" step="0.5" value="${Number(draft.stars) || 0}" aria-label="Star rating">
              </div>
              <button type="button" class="star-pick__clear" data-act="clear-stars"${draft.stars ? '' : ' hidden'}>Reset</button>
            </div>
            <p class="bf-note">Games whose average rating rounds to this many stars.</p>`;
        default: return '';
      }
    }

    function paint() {
      const old = qs('.bf-pane', sheet);
      const keep = old && old.dataset.cat === cat ? old.scrollTop : 0;
      sheet.innerHTML = `
        <div class="browse-filters__top">
          <button type="button" class="browse-filters__icon" data-act="close" aria-label="Close">${iconClose()}</button>
          <h2>Filters</h2>
        </div>
        <div class="bf-split">
          <nav class="bf-side" aria-label="Filter categories">
            ${cats.map((c) => `<button type="button" class="bf-cat${c.id === cat ? ' is-on' : ''}" data-cat="${c.id}"><span>${esc(c.label)}</span>${catSet(c.id) ? '<i aria-label="set"></i>' : ''}</button>`).join('')}
          </nav>
          <div class="bf-pane" data-cat="${cat}">${pane()}</div>
        </div>
        <div class="bf-foot">
          <button type="button" class="bf-reset" data-act="reset"${anySet() ? '' : ' disabled'}>Reset</button>
          <button type="button" class="bf-show" data-act="apply">${showText}</button>
        </div>`;
      qs('.bf-pane', sheet).scrollTop = keep;
      const range = qs('.star-pick__range', sheet);
      if (range) {
        range.addEventListener('input', () => {
          const v = Number(range.value);
          draft.stars = v ? String(v) : '';
          qs('.star-row', sheet).outerHTML = starsHtml(v);
          qs('[data-act="clear-stars"]', sheet).hidden = !v;
          syncSide();
          recount();
        });
      }
    }
    // After a star drag: just the dots and Reset, so the drag keeps going.
    function syncSide() {
      qsa('.bf-cat', sheet).forEach((b) => {
        const want = catSet(b.dataset.cat);
        const dot = qs('i', b);
        if (want && !dot) b.insertAdjacentHTML('beforeend', '<i aria-label="set"></i>');
        if (!want && dot) dot.remove();
      });
      qs('[data-act="reset"]', sheet).disabled = !anySet();
    }

    // The Show button's count, asked of IGDB a moment after the last change.
    let showText = 'Show games';
    let countTimer = null;
    let countTicket = 0;
    function recount() {
      clearTimeout(countTimer);
      const my = ++countTicket;
      if (MY_SORTS.has(draft.sort)) { setShow('Show games', false); return; }
      countTimer = setTimeout(async () => {
        const n = await api.browseGames({ ...toQuery(draft, 1), countOnly: true });
        if (my !== countTicket || !sheet.isConnected) return;
        if (typeof n !== 'number') setShow('Show games', false);
        else setShow(n ? `Show ${n.toLocaleString('en-US')} game${n === 1 ? '' : 's'}` : 'No games match', !n);
      }, 300);
    }
    function setShow(text, disabled) {
      showText = text;
      const b = qs('.bf-show', sheet);
      if (b) { b.textContent = text; b.disabled = disabled; }
    }

    sheet.addEventListener('click', (e) => {
      const el = e.target.closest('[data-k],[data-sw],[data-cat],[data-act]');
      if (!el) return;
      if (el.dataset.cat && el.classList.contains('bf-cat')) { cat = el.dataset.cat; paint(); return; }
      if (el.dataset.k) {
        const k = el.dataset.k;
        const v = el.dataset.v;
        if (MULTI.has(k) && v) {
          const now = vals(draft[k]);
          draft[k] = (now.includes(v) ? now.filter((x) => x !== v) : [...now, v]).join(',');
        } else draft[k] = v;
        paint(); recount();
        return;
      }
      if (el.dataset.sw) { draft[el.dataset.sw] = !draft[el.dataset.sw]; paint(); return; }
      const act = el.dataset.act;
      if (act === 'close') close();
      else if (act === 'reset') { Object.assign(draft, base, { query: draft.query }); paint(); recount(); }
      else if (act === 'clear-stars') { draft.stars = ''; paint(); recount(); }
      else if (act === 'apply') {
        Object.assign(filters, draft);
        close();
        syncCount();
        load(true);
      }
    });

    paint();
    recount();
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
