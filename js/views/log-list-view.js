import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, emptyState, spinner, iconStamp, posterFrame, iconFilter, iconClose, iconReplay, iconReviewLines, iconHeartFilled, posterMetaHtml, iconChevronDown, iconChevronRight } from '../components.js';
import { backlogBarHtml, wireBacklogBar } from './profile-stats.js';
import { esc, qs, qsa, formatDate, statusStamp, starRow, igdbSized, playedKind } from '../utils.js';

// `keep` narrows the list after it is fetched (the database can't ask these
// questions directly): this year's games, real logs (a rating, a review or a
// like, not just "marked as played"), liked games, replays.
const THIS_YEAR = new Date().getFullYear();
const MODES = {
  completed: { title: 'Played', statuses: ['played', 'dropped'], reviewsOnly: false, empty: (u) => `${u} hasn't played any games yet.` },
  diary: { title: 'Diary', statuses: ['played', 'dropped'], reviewsOnly: false, diary: true, keep: (l, profile) => playedKind(l, profile.created_at) === 'diary', empty: (u) => `${u} hasn't got any diary entries yet.` },
  played: { title: 'Played', statuses: ['played', 'dropped'], reviewsOnly: false, empty: (u) => `${u} hasn't marked any games as played yet.` },
  year: { title: 'This year', statuses: ['played', 'dropped'], reviewsOnly: false, keep: (l) => { const raw = l.played_date || l.created_at; return !!raw && new Date(raw).getFullYear() === THIS_YEAR; }, empty: (u) => `${u} hasn't played anything this year yet.` },
  logged: { title: 'Played', statuses: undefined, reviewsOnly: false, keep: (l) => l.rating || l.review || l.loved, empty: (u) => `${u} hasn't logged anything yet.` },
  reviews: { title: 'Reviews', statuses: undefined, reviewsOnly: true, empty: (u) => `${u} hasn't written any reviews yet.` },
  liked: { title: 'Likes', statuses: undefined, reviewsOnly: false, keep: (l) => l.loved, empty: (u) => `${u} hasn't liked any games yet.` },
  replayed: { title: 'Replays', statuses: ['played', 'dropped'], reviewsOnly: false, diary: true, keep: (l, profile) => playedKind(l, profile.created_at) === 'diary', post: (list) => { const n = {}; list.forEach((l) => { n[l.game_id] = (n[l.game_id] || 0) + 1; }); return list.filter((l) => n[l.game_id] > 1); }, empty: (u) => `${u} hasn't replayed any games yet.` },
};

// Calendar tiles: weekday and day number in a tile, the game beside it, the cover
// on the right. Grouped under a month heading when `byDate` is true (the list is in date order).
export function diaryTilesHtml(list, byDate = true) {
  const parts = (l) => { const raw = l.played_date || l.created_at; const d = raw ? new Date(raw + (String(raw).length === 10 ? 'T00:00:00' : '')) : null; return d && !isNaN(d) ? d : null; };
  const row = (l) => {
    const d = parts(l);
    return `
    <a href="#/review/${l.id}" class="dq-row">
      <div class="dq-tile"><span>${d ? d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() : ''}</span><b>${d ? d.getDate() : '·'}</b></div>
      <div class="dq-main">
        <div class="dq-title">${esc(l.games.title)}${l.games.release_year ? ` <em>${l.games.release_year}</em>` : ''}</div>
        <div class="dq-meta">${l.rating ? starRow(l.rating, { size: 12 }) : ''}${l.loved ? `<span class="dq-mark dq-mark--heart">${iconHeartFilled()}</span>` : ''}${l.review ? `<span class="dq-mark">${iconReviewLines()}</span>` : ''}${l.is_replay ? `<span class="dq-mark">${iconReplay()}</span>` : ''}</div>
      </div>
      <img src="${esc(igdbSized(l.games.cover_url, 'cover_small') || '')}" alt="" class="dq-cover" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">
    </a>`;
  };
  if (!byDate) return `<div class="dq">${list.map(row).join('')}</div>`;
  let last = null;
  return `<div class="dq">${list.map((l) => {
    const d = parts(l);
    const key = d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'No date';
    const head = key !== last ? `<h3 class="dq-month">${key}</h3>` : '';
    last = key;
    return head + row(l);
  }).join('')}</div>`;
}

// The Backlog as its own page: the same bar and poster grid as the profile's Backlog tab.
export async function renderBacklogView(root, { username }) {
  root.innerHTML = topBar('Backlog', { back: true }) + `<div class="view-body" id="backlog-body">${spinner()}</div>` + navBar('');
  const body = qs('#backlog-body', root);
  try {
    const profile = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    const isOwn = state.user?.id === profile.id;
    const logs = (await api.getLogsForUser(profile.id, { statuses: ['backlog'], limit: 5000 }))
      .filter((l) => l.status === 'backlog' && l.games)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    body.innerHTML = logs.length ? `
      ${backlogBarHtml(profile, logs, isOwn)}
      <div class="poster-grid3">
        ${logs.map((l) => `
          <a href="#/game/${l.games.id}" class="poster-grid3__item">
            ${posterFrame(l.games.cover_url, l.games.title, 'poster-grid3__cover')}
          </a>`).join('')}
      </div>` : emptyState('Nothing on the backlog yet.', { icon: iconStamp() });
    wireBacklogBar(body, logs, isOwn);
  } catch (err) {
    body.innerHTML = emptyState(err.message || 'Could not load the backlog.');
  }
}

// One game's replay history, laid out like the Diary: month strips, then each playthruu, newest first.
export async function renderGameReplaysView(root, { username, gameId }) {
  root.innerHTML = topBar('', { back: true }) + `<div class="view-body" id="gr-body">${spinner()}</div>` + navBar('');
  const body = qs('#gr-body', root);
  try {
    const profile = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    const all = await api.getLogsForUser(profile.id, { statuses: ['played', 'dropped'], limit: 5000 });
    const list = all.filter((l) => l.games && l.games.id === gameId && l.status !== 'backlog' && l.is_replay && playedKind(l, profile.created_at) === 'diary')
      .sort((a, b) => new Date(b.played_date || b.created_at) - new Date(a.played_date || a.created_at));
    qs('.topbar__title', root).textContent = list[0]?.games?.title || 'Replays';
    body.innerHTML = list.length ? diaryTilesHtml(list, true) : emptyState('No replays of this game yet.');
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this: ${esc(err.message)}</p>`;
  }
}

export async function renderLogListView(root, { username, mode }) {
  const cfg = MODES[mode] || MODES.logged;
  root.innerHTML = topBar(cfg.title, { back: true, right: mode === 'replayed' ? '' : `<button type="button" class="browse-fbtn" id="ll-fbtn" aria-label="Filters">${iconFilter()}</button>` }) + `<div class="view-body" id="loglist-body">${spinner()}</div>` + navBar('');
  const body = qs('#loglist-body', root);

  try {
    const profile = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    let logs = await api.getLogsForUser(profile.id, { statuses: cfg.statuses, reviewsOnly: cfg.reviewsOnly, limit: 5000 });
    if (cfg.keep) logs = logs.filter((l) => cfg.keep(l, profile));
    if (cfg.post) logs = cfg.post(logs);
    logs = logs.filter((l) => l.status !== 'backlog'); // backlog games stay in the Backlog

    // Filters: sort, year, minimum rating, and "By game" (one game, every play under it).
    const fkey = `ll-filters:${username}:${mode}`;
    const f = { sort: 'new', year: 'all', rating: '0', group: false };
    try { Object.assign(f, JSON.parse(sessionStorage.getItem(fkey) || '{}')); } catch (_) { /* fine without it */ }
    // Only a properly logged game (a diary entry) has a review page; a game just marked as
    // played opens the game page.
    const isLogged = (l) => (l.status === 'played' || l.status === 'dropped') && playedKind(l, profile.created_at) === 'diary';
    const dateOf = (l) => l.played_date || l.created_at;
    const yearOf = (l) => { const raw = dateOf(l); return raw ? new Date(raw).getFullYear() : null; };
    const years = [...new Set(logs.map(yearOf).filter(Boolean))].sort((x, y) => y - x);
    const when = (l) => new Date(l.played_date || l.created_at || 0).getTime();
    const sorters = {
      new: (x, y) => when(y) - when(x),
      old: (x, y) => when(x) - when(y),
      high: (x, y) => (y.rating || 0) - (x.rating || 0) || when(y) - when(x),
      low: (x, y) => (x.rating || 99) - (y.rating || 99) || when(y) - when(x),
      az: (x, y) => (x.games?.title || '').localeCompare(y.games?.title || ''),
    };
    const SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['high', 'Highest rated'], ['low', 'Lowest rated'], ['az', 'A to Z']];
    const RATINGS = [['0', 'Any rating'], ['3', '3★ and up'], ['4', '4★ and up'], ['5', '5★ only']];
    const matches = (d) => logs.filter((l) => l.games)
      .filter((l) => d.year === 'all' || yearOf(l) === Number(d.year))
      .filter((l) => (l.rating || 0) >= Number(d.rating));
    const BLANK = { sort: 'new', year: 'all', rating: '0', group: false };

    // The filter pop-up: same layout as Browse's (categories left, choices right, Reset and Show below).
    function openFilters() {
      const draft = { ...f };
      let cat = 'sort';
      const sheet = document.createElement('div');
      sheet.className = 'browse-filters';
      document.body.appendChild(sheet);
      const close = () => sheet.remove();
      sheet.__dismiss = close;
      const cats = [['sort', 'Sort'], ['rating', 'Rating'], ...(years.length > 1 ? [['year', 'Year']] : []), ['view', 'View']];
      const differs = (k) => String(draft[k]) !== String(BLANK[k]);
      const opt = (k, v, name) => `<button type="button" class="bf-opt" data-k="${k}" data-v="${v}"><span class="bf-mark bf-mark--radio${String(draft[k]) === String(v) ? ' is-on' : ''}"></span><span class="bf-opt__name">${name}</span></button>`;
      const pane = () => {
        if (cat === 'sort') return SORTS.map(([v, t]) => opt('sort', v, t)).join('');
        if (cat === 'rating') return RATINGS.map(([v, t]) => opt('rating', v, t)).join('');
        if (cat === 'year') return opt('year', 'all', 'All years') + years.map((y) => opt('year', y, y)).join('');
        return opt('group', false, 'Every play as a poster') + opt('group', true, 'By game, every play listed under it');
      };
      const paintSheet = () => {
        const list = matches(draft);
        const n = draft.group ? new Set(list.map((l) => l.games.id)).size : list.length;
        sheet.innerHTML = `
          <div class="browse-filters__top">
            <button type="button" class="browse-filters__icon" data-act="close" aria-label="Close">${iconClose()}</button>
            <h2>Filters</h2>
          </div>
          <div class="bf-split">
            <nav class="bf-side">${cats.map(([id, t]) => `<button type="button" class="bf-cat${id === cat ? ' is-on' : ''}" data-cat="${id}"><span>${t}</span>${differs(id) ? '<i aria-label="set"></i>' : ''}</button>`).join('')}</nav>
            <div class="bf-pane">${pane()}</div>
          </div>
          <div class="bf-foot">
            <button type="button" class="bf-reset" data-act="reset"${Object.keys(BLANK).some(differs) ? '' : ' disabled'}>Reset</button>
            <button type="button" class="bf-show" data-act="apply"${n ? '' : ' disabled'}>${n ? `Show ${n} game${n === 1 ? '' : 's'}` : 'No games match'}</button>
          </div>`;
      };
      sheet.addEventListener('click', (e) => {
        const el = e.target.closest('[data-k],[data-cat],[data-act]');
        if (!el) return;
        if (el.dataset.cat) cat = el.dataset.cat;
        else if (el.dataset.k) draft[el.dataset.k] = el.dataset.k === 'group' ? el.dataset.v === 'true' : el.dataset.v;
        else if (el.dataset.act === 'reset') Object.assign(draft, BLANK);
        else if (el.dataset.act === 'close') { close(); return; }
        else if (el.dataset.act === 'apply') { Object.assign(f, draft); try { sessionStorage.setItem(fkey, JSON.stringify(f)); } catch (_) { /* fine without it */ } close(); paint(); return; }
        paintSheet();
      });
      paintSheet();
    }
    const rowHtml = (l, withTitle) => `
      <a href="${isLogged(l) ? `#/review/${l.id}` : `#/game/${l.games.id}`}" class="diary-row ${withTitle ? '' : 'diary-row--sub'}">
        ${withTitle ? `<img src="${esc(igdbSized(l.games.cover_url, 'cover_small') || '')}" alt="" class="diary-row__cover" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">` : ''}
        <div class="diary-row__main">
          ${withTitle ? `<div class="diary-row__title">${esc(l.games.title)}</div>` : ''}
          <div class="diary-row__meta">${dateOf(l) ? formatDate(String(dateOf(l)).slice(0, 10)) : ''} ${l.rating ? starRow(l.rating, { size: 10 }) : ''}</div>
        </div>
        ${statusStamp(l.status)}
      </a>`;

    // A small number on the filter icon: how many filters are on.
    const setBadge = () => {
      const n = Object.keys(BLANK).filter((k) => String(f[k]) !== String(BLANK[k])).length;
      const btn = qs('#ll-fbtn', root);
      if (!btn) return;
      if (!btn) return;
      qs('.ll-fbadge', btn)?.remove();
      if (n) btn.insertAdjacentHTML('beforeend', `<em class="ll-fbadge">${n}</em>`);
    };
    const paint = () => {
      let list = matches(f).sort(sorters[f.sort]);
      let content;
      if (!list.length) content = emptyState(logs.length ? 'Nothing matches those filters.' : cfg.empty(username), { icon: iconStamp() });
      else if (mode === 'replayed') {
        // one row per game replayed more than once; tap it and every play opens underneath, newest first, first ever last
        const byGame = new Map();
        list.forEach((l) => { if (!byGame.has(l.games.id)) byGame.set(l.games.id, []); byGame.get(l.games.id).push(l); });
        const when = (l) => new Date(l.played_date || l.created_at || 0).getTime();
        const groups = [...byGame.values()].map((g) => g.sort((x, y) => when(y) - when(x))).sort((x, y) => when(y[0]) - when(x[0]));
        content = `<div class="rpl">${groups.map((g) => `
          <div class="rpl__game">
            <a class="rpl__head" href="#/profile/${esc(username)}/replays/${esc(g[0].games.id)}">
              <span class="rpl__cover">${posterFrame(g[0].games.cover_url, g[0].games.title, 'rpl__img')}</span>
              <span class="rpl__main"><span class="rpl__title">${esc(g[0].games.title)}${g[0].games.release_year ? ` <em>${esc(String(g[0].games.release_year))}</em>` : ''}</span><span class="rpl__sub">${g.length} playthruu</span></span>
              <span class="rpl__chev">${iconChevronRight()}</span>
            </a>
          </div>`).join('')}</div>`;
      } else if (f.group) {
        const byGame = new Map();
        list.forEach((l) => { if (!byGame.has(l.games.id)) byGame.set(l.games.id, []); byGame.get(l.games.id).push(l); });
        content = `<div class="diary-list">${[...byGame.values()].map((g) => `
          <div class="ll-group">
            ${rowHtml(g[0], true).replace('</a>', `<span class="ll-count">${g.length}×</span></a>`)}
            ${g.slice(1).map((l) => rowHtml(l, false)).join('')}
          </div>`).join('')}</div>`;
      } else if (cfg.diary) {
        content = diaryTilesHtml(list, f.sort === 'new' || f.sort === 'old');
      } else {
        content = `<div class="ll-grid">${list.map((l) => `<div class="ll-cell"><a class="game-card" data-game-id="${esc(l.games.id)}" href="${isLogged(l) ? `#/review/${l.id}` : `#/game/${l.games.id}`}" aria-label="${esc(l.games.title)}">${posterFrame(l.games.cover_url, l.games.title, 'game-card__cover')}</a>${posterMetaHtml(l)}</div>`).join('')}</div>`;
      }
      body.innerHTML = `<div id="ll-results">${content}</div>`;
      setBadge();
    };
    qs('#ll-fbtn', root)?.addEventListener('click', openFilters);
    if (!logs.length) { body.innerHTML = emptyState(cfg.empty(username), { icon: iconStamp() }); return; }
    paint();
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this list: ${esc(err.message)}</p>`;
  }
}
