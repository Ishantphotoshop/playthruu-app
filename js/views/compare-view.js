import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, avatarImg, posterFrame, emptyState, iconChevronRight, iconReplay, iconReviewLines } from '../components.js';
import { esc, qs, starRow } from '../utils.js';

// Compare: every game you and another player both have, in one scroll of sections:
//
//   Same taste      you both rated it and are within 1 star of each other
//   Different taste you both rated it and are more than 1 star apart
//   Shared backlog  it is only ever in both of your backlogs
//   Not rated yet   you both have it but one of you has not rated it
//
// A game counts once per person however many times it was logged: the latest rating wins,
// and it is "backlog only" when every log of it is a backlog entry.

const when = (l) => new Date(l.played_date || l.created_at || 0).getTime();

function perGame(logs) {
  const map = new Map();
  for (const l of logs) {
    if (!l.games || !l.game_id) continue;
    const e = map.get(l.game_id) || { game: l.games, rating: 0, ratedAt: -1, backlogOnly: true, replay: false, review: false };
    const r = Number(l.rating) || 0;
    if (r > 0 && when(l) >= e.ratedAt) { e.rating = r; e.ratedAt = when(l); }
    if (l.status !== 'backlog') e.backlogOnly = false;
    if (l.is_replay) e.replay = true;
    if (l.review) e.review = true;
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
      game: m.game, me: m.rating, they: t.rating, diff, meReplay: m.replay, meReview: m.review, theyReplay: t.replay, theyReview: t.review,
      same: rated && diff <= 1,
      differ: rated && diff > 1,
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

const SECTIONS = [
  ['same', 'Same taste', (i) => i.same],
  ['differ', 'Different taste', (i) => i.differ],
  ['backlog', 'Shared backlog', (i) => i.backlog],
  ['none', 'Not rated yet', (i) => i.none],
];

function sorted(list, key) {
  const out = list.slice();
  if (key === 'same') out.sort((x, y) => x.diff - y.diff || x.game.title.localeCompare(y.game.title));
  else if (key === 'differ') out.sort((x, y) => y.diff - x.diff || x.game.title.localeCompare(y.game.title));
  else out.sort((x, y) => x.game.title.localeCompare(y.game.title));
  return out;
}

const rateRow = (profile, rating, replay, review) => `
  <div class="cmp-rate">
    <span class="cmp-rate__av">${avatarImg(profile, 24)}</span>
    <span class="cmp-rate__st">
      ${rating > 0 ? starRow(rating, { size: 10, count: 5 }) : '<span class="cmp-dash">not rated</span>'}
      ${replay ? `<span class="card-who__icon card-who__icon--replayed">${iconReplay()}</span>` : ''}
      ${review ? `<span class="card-who__icon card-who__icon--review">${iconReviewLines()}</span>` : ''}
    </span>
  </div>`;

// A section shows its first 15 games; with more than that, a ">" next to the name opens a
// page with all of them.
const STRIP_MAX = 15;

async function loadCompare(username) {
  if (!state.user) return { error: 'Sign in to compare your games with theirs.' };
  const them = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
  if (them.id === state.user.id) return { error: 'This is your own profile. Open someone else’s to compare.' };
  const [mine, theirs] = await Promise.all([
    api.getLogsForUser(state.user.id, { limit: 5000 }),
    api.getLogsForUser(them.id, { limit: 5000 }),
  ]);
  return { them, data: buildCompare(mine, theirs) };
}

const itemHtml = (i, them, cls) => `
  <div class="${cls} cmp-item">
    <a href="#/game/${esc(i.game.id)}" aria-label="${esc(i.game.title)}">
      ${posterFrame(i.game.cover_url, i.game.title, 'recent-played-item__cover')}
    </a>
    ${rateRow(state.profile, i.me, i.meReplay, i.meReview)}
    ${rateRow(them, i.they, i.theyReplay, i.theyReview)}
  </div>`;

export async function renderCompareView(root, { username }) {
  root.innerHTML = topBar('Compare', { back: true, brand: true }) + `<div class="view-body" id="cmp-body">${spinner()}</div>` + navBar('');
  const body = qs('#cmp-body', root);
  try {
    const loaded = await loadCompare(username);
    if (loaded.error) { body.innerHTML = emptyState(loaded.error); return; }
    const { them, data } = loaded;

    const sectionHtml = ([key, label, fn]) => {
      const list = sorted(data.items.filter(fn), key);
      const more = list.length > STRIP_MAX;
      return `
        <section class="cmp-sec">
          <div class="feed-section-head rp-head">
            <h2 class="section-heading">${label}</h2>
            ${more ? `<a href="#/profile/${esc(username)}/compare/${key}" class="see-more-icon" aria-label="See all ${list.length} games in ${label}">${iconChevronRight()}</a>` : ''}
          </div>
          ${list.length ? `
          <div class="recent-played-row">
            ${list.slice(0, STRIP_MAX).map((i) => itemHtml(i, them, 'recent-played-item')).join('')}
          </div>` : '<p class="cmp-none">None yet</p>'}
        </section>`;
    };

    body.innerHTML = `
      <div class="cmp-top">
        ${avatarImg(state.profile, 48)}
        <div class="cmp-score">
          <b>${data.match === null ? '—' : `${data.match}%`}</b>
          <span>taste match</span>
        </div>
        ${avatarImg(them, 48)}
      </div>
      ${data.match === null && data.items.length ? '<p class="cmp-note">Rate at least 3 of the same games to see your taste match.</p>' : ''}
      ${data.items.length ? SECTIONS.map(sectionHtml).join('') : '<p class="cmp-note">You have no games in common yet.</p>'}`;
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this comparison: ${esc(err.message)}</p>`;
  }
}

// The page behind the ">" : every game in one section, three across.
export async function renderCompareSectionView(root, { username, section }) {
  const def = SECTIONS.find((x) => x[0] === section) || SECTIONS[0];
  root.innerHTML = topBar(def[1], { back: true, brand: true }) + `<div class="view-body" id="cmp-body">${spinner()}</div>` + navBar('');
  const body = qs('#cmp-body', root);
  try {
    const loaded = await loadCompare(username);
    if (loaded.error) { body.innerHTML = emptyState(loaded.error); return; }
    const { them, data } = loaded;
    const list = sorted(data.items.filter(def[2]), def[0]);
    body.innerHTML = list.length
      ? `<div class="cmp-grid">${list.map((i) => itemHtml(i, them, 'cmp-cell')).join('')}</div>`
      : '<p class="cmp-note">Nothing here.</p>';
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this comparison: ${esc(err.message)}</p>`;
  }
}
