import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, avatarImg, posterFrame, emptyState } from '../components.js';
import { esc, qs, qsa, starRow } from '../utils.js';

// Compare: every game you and another player both have, grouped by what you think of it.
//
//   Same taste      you both rated it and are within 1 star of each other
//   Different taste you both rated it and are more than 1 star apart
//   Both loved      you both liked it
//   Shared backlog  it is only ever in both of your backlogs
//   Not rated yet   you both have it but one of you has not rated it
//
// A game counts once per person however many times it was logged: the latest rating wins,
// a like on any log counts, and it is "backlog only" when every log of it is a backlog entry.

const when = (l) => new Date(l.played_date || l.created_at || 0).getTime();

function perGame(logs) {
  const map = new Map();
  for (const l of logs) {
    if (!l.games || !l.game_id) continue;
    const e = map.get(l.game_id) || { game: l.games, rating: 0, ratedAt: -1, loved: false, backlogOnly: true };
    const r = Number(l.rating) || 0;
    if (r > 0 && when(l) >= e.ratedAt) { e.rating = r; e.ratedAt = when(l); }
    if (l.loved) e.loved = true;
    if (l.status !== 'backlog') e.backlogOnly = false;
    map.set(l.game_id, e);
  }
  return map;
}

export function buildCompare(mine, theirs) {
  const a = perGame(mine);
  const b = perGame(theirs);
  const items = [];
  for (const [id, m] of a) {
    const t = b.get(id);
    if (!t) continue;
    const rated = m.rating > 0 && t.rating > 0;
    const diff = rated ? Math.abs(m.rating - t.rating) : null;
    items.push({
      game: m.game, me: m.rating, they: t.rating, diff,
      same: rated && diff <= 1,
      differ: rated && diff > 1,
      loved: m.loved && t.loved,
      backlog: m.backlogOnly && t.backlogOnly,
      none: !rated && !(m.backlogOnly && t.backlogOnly),
    });
  }
  const ratedItems = items.filter((i) => i.diff !== null);
  // One or two shared ratings say nothing about taste, so the match needs at least 3.
  const match = ratedItems.length >= 3
    ? Math.round((1 - ratedItems.reduce((s, i) => s + i.diff, 0) / ratedItems.length / 4.5) * 100)
    : null;
  return { items, match, ratedCount: ratedItems.length };
}

const FILTERS = [
  ['all', 'All', () => true],
  ['same', 'Same taste', (i) => i.same],
  ['differ', 'Different taste', (i) => i.differ],
  ['loved', 'Both loved', (i) => i.loved],
  ['backlog', 'Shared backlog', (i) => i.backlog],
  ['none', 'Not rated yet', (i) => i.none],
];

function sorted(list, key) {
  const out = list.slice();
  if (key === 'same') out.sort((x, y) => x.diff - y.diff || x.game.title.localeCompare(y.game.title));
  else if (key === 'differ' || key === 'all') out.sort((x, y) => (y.diff ?? -1) - (x.diff ?? -1) || x.game.title.localeCompare(y.game.title));
  else out.sort((x, y) => x.game.title.localeCompare(y.game.title));
  return out;
}

const rateRow = (profile, rating) => `
  <div class="cmp-rate">
    <span class="cmp-rate__av">${avatarImg(profile, 12)}</span>
    ${rating > 0 ? starRow(rating, { size: 9, count: 5 }) : '<span class="cmp-dash">not rated</span>'}
  </div>`;

export async function renderCompareView(root, { username }) {
  root.innerHTML = topBar('Compare', { back: true }) + `<div class="view-body" id="cmp-body">${spinner()}</div>` + navBar('');
  const body = qs('#cmp-body', root);
  try {
    if (!state.user) { body.innerHTML = emptyState('Sign in to compare your games with theirs.'); return; }
    const them = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    if (them.id === state.user.id) { body.innerHTML = emptyState('This is your own profile. Open someone else’s to compare.'); return; }
    const [mine, theirs] = await Promise.all([
      api.getLogsForUser(state.user.id, { limit: 5000 }),
      api.getLogsForUser(them.id, { limit: 5000 }),
    ]);
    const data = buildCompare(mine, theirs);
    const themName = them.display_name || them.username;
    let current = 'all';

    const paint = () => {
      const pick = FILTERS.find((f) => f[0] === current);
      const list = sorted(data.items.filter(pick[2]), current);
      qs('#cmp-grid', body).innerHTML = list.length
        ? list.map((i) => `
          <div class="cmp-cell">
            <a href="#/game/${esc(i.game.id)}" class="cmp-cover" aria-label="${esc(i.game.title)}">${posterFrame(i.game.cover_url, i.game.title, 'cmp-cover__img')}</a>
            ${rateRow(state.profile, i.me)}
            ${rateRow(them, i.they)}
          </div>`).join('')
        : `<p class="cmp-empty">${current === 'all' ? 'You have no games in common yet.' : 'Nothing here.'}</p>`;
      qsa('.cmp-chip', body).forEach((c) => c.classList.toggle('is-on', c.dataset.k === current));
    };

    body.innerHTML = `
      <div class="cmp-top">
        ${avatarImg(state.profile, 44)}
        <div class="cmp-score">
          <b>${data.match === null ? '—' : `${data.match}%`}</b>
          <span>taste match</span>
        </div>
        ${avatarImg(them, 44)}
      </div>
      <div class="cmp-legend">
        <span>${avatarImg(state.profile, 12)}You</span>
        <span>${avatarImg(them, 12)}${esc(themName)}</span>
        <em>${data.items.length} game${data.items.length === 1 ? '' : 's'} in common</em>
      </div>
      <div class="cmp-chips" id="cmp-chips">
        ${FILTERS.map(([k, label, fn]) => `<button type="button" class="cmp-chip${k === 'all' ? ' is-on' : ''}" data-k="${k}">${label}<b>${data.items.filter(fn).length}</b></button>`).join('')}
      </div>
      ${data.match === null && data.items.length ? '<p class="cmp-note">Rate at least 3 of the same games to see your taste match.</p>' : ''}
      <div class="cmp-grid" id="cmp-grid"></div>`;
    qs('#cmp-chips', body).addEventListener('click', (e) => {
      const c = e.target.closest('.cmp-chip');
      if (!c) return;
      current = c.dataset.k;
      paint();
    });
    paint();
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this comparison: ${esc(err.message)}</p>`;
  }
}
