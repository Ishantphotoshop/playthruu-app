import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, emptyState, spinner, iconStamp, posterFrame, iconFilter } from '../components.js';
import { esc, qs, formatDate, statusStamp, starRow, igdbSized } from '../utils.js';

// `keep` narrows the list after it is fetched (the database can't ask these
// questions directly): this year's games, real logs (a rating, a review or a
// like, not just "marked as played"), liked games, replays.
const THIS_YEAR = new Date().getFullYear();
const MODES = {
  completed: { title: 'Played', statuses: ['played', 'dropped'], reviewsOnly: false, empty: (u) => `${u} hasn't played any games yet.` },
  diary: { title: 'Diary', statuses: ['played', 'dropped'], reviewsOnly: false, diary: true, empty: (u) => `${u} hasn't got any diary entries yet.` },
  year: { title: 'This year', statuses: ['played', 'dropped'], reviewsOnly: false, keep: (l) => l.played_date && new Date(l.played_date).getFullYear() === THIS_YEAR, empty: (u) => `${u} hasn't played anything this year yet.` },
  logged: { title: 'Logs', statuses: undefined, reviewsOnly: false, keep: (l) => l.rating || l.review || l.loved, empty: (u) => `${u} hasn't logged anything yet.` },
  reviews: { title: 'Reviews', statuses: undefined, reviewsOnly: true, empty: (u) => `${u} hasn't written any reviews yet.` },
  liked: { title: 'Likes', statuses: undefined, reviewsOnly: false, keep: (l) => l.loved, empty: (u) => `${u} hasn't liked any games yet.` },
  replayed: { title: 'Replays', statuses: undefined, reviewsOnly: false, keep: (l) => l.is_replay, empty: (u) => `${u} hasn't replayed any games yet.` },
};

export async function renderLogListView(root, { username, mode }) {
  const cfg = MODES[mode] || MODES.logged;
  root.innerHTML = topBar(cfg.title, { back: true, right: `<button type="button" class="browse-fbtn" id="ll-fbtn" aria-label="Filters">${iconFilter()}</button>` }) + `<div class="view-body" id="loglist-body">${spinner()}</div>` + navBar('');
  const body = qs('#loglist-body', root);

  try {
    const profile = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    let logs = await api.getLogsForUser(profile.id, { statuses: cfg.statuses, reviewsOnly: cfg.reviewsOnly, limit: cfg.keep ? 1000 : 200 });
    if (cfg.keep) logs = logs.filter(cfg.keep);

    // Filters: sort, year, minimum rating, and "By game" (one game, every play under it).
    const f = { sort: 'new', year: 'all', rating: '0', group: mode === 'replayed', open: false };
    const years = [...new Set(logs.map((l) => l.played_date && new Date(l.played_date).getFullYear()).filter(Boolean))].sort((x, y) => y - x);
    const when = (l) => new Date(l.played_date || l.created_at || 0).getTime();
    const sorters = {
      new: (x, y) => when(y) - when(x),
      old: (x, y) => when(x) - when(y),
      high: (x, y) => (y.rating || 0) - (x.rating || 0) || when(y) - when(x),
      low: (x, y) => (x.rating || 99) - (y.rating || 99) || when(y) - when(x),
      az: (x, y) => (x.games?.title || '').localeCompare(y.games?.title || ''),
    };
    const sel = (key, opts) => `<select class="ll-sel" data-f="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(f[key]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const bar = () => `<div class="ll-filters" ${f.open ? '' : 'hidden'}>
      ${sel('sort', [['new', 'Newest first'], ['old', 'Oldest first'], ['high', 'Highest rated'], ['low', 'Lowest rated'], ['az', 'A to Z']])}
      ${years.length > 1 ? sel('year', [['all', 'All years'], ...years.map((y) => [y, y])]) : ''}
      ${sel('rating', [['0', 'Any rating'], ['3', '3★ and up'], ['4', '4★ and up'], ['5', '5★ only']])}
      <button type="button" class="ll-chip" data-group aria-pressed="${f.group}">By game</button>
    </div>`;
    const rowHtml = (l, withTitle) => `
      <a href="#/game/${l.games.id}" class="diary-row ${withTitle ? '' : 'diary-row--sub'}">
        ${withTitle ? `<img src="${esc(igdbSized(l.games.cover_url, 'cover_small') || '')}" alt="" class="diary-row__cover" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">` : ''}
        <div class="diary-row__main">
          ${withTitle ? `<div class="diary-row__title">${esc(l.games.title)}</div>` : ''}
          <div class="diary-row__meta">${l.played_date ? formatDate(l.played_date) : ''} ${l.rating ? starRow(l.rating, { size: 10 }) : ''}</div>
        </div>
        ${statusStamp(l.status)}
      </a>`;

    const paint = () => {
      let list = logs.filter((l) => l.games)
        .filter((l) => f.year === 'all' || (l.played_date && new Date(l.played_date).getFullYear() === Number(f.year)))
        .filter((l) => (l.rating || 0) >= Number(f.rating))
        .sort(sorters[f.sort]);
      let content;
      if (!list.length) content = emptyState(logs.length ? 'Nothing matches those filters.' : cfg.empty(username), { icon: iconStamp() });
      else if (f.group) {
        const byGame = new Map();
        list.forEach((l) => { if (!byGame.has(l.games.id)) byGame.set(l.games.id, []); byGame.get(l.games.id).push(l); });
        content = `<div class="diary-list">${[...byGame.values()].map((g) => `
          <div class="ll-group">
            ${rowHtml(g[0], true).replace('</a>', `<span class="ll-count">${g.length}×</span></a>`)}
            ${g.slice(1).map((l) => rowHtml(l, false)).join('')}
          </div>`).join('')}</div>`;
      } else {
        content = `<div class="game-grid game-grid--3col">${list.map((l) => `<a class="game-card" href="#/game/${l.games.id}">${posterFrame(l.games.cover_url, l.games.title, 'game-card__cover')}</a>`).join('')}</div>`;
      }
      body.innerHTML = bar() + `<div id="ll-results">${content}</div>`;
      body.querySelectorAll('.ll-sel').forEach((el) => el.addEventListener('change', () => { f[el.dataset.f] = el.value; paint(); }));
      qs('[data-group]', body).addEventListener('click', () => { f.group = !f.group; paint(); });
    };
    qs('#ll-fbtn', root).addEventListener('click', () => { f.open = !f.open; const b = qs('.ll-filters', body); if (b) b.hidden = !f.open; });
    if (!logs.length) { body.innerHTML = emptyState(cfg.empty(username), { icon: iconStamp() }); return; }
    paint();
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this list: ${esc(err.message)}</p>`;
  }
}
