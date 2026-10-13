import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, logCard, emptyState, spinner, iconStamp } from '../components.js';
import { esc, qs } from '../utils.js';
import { wireLogCards } from './feed-view.js';

// `keep` narrows the list after it is fetched (the database can't ask these
// questions directly): this year's games, real logs (a rating, a review or a
// like, not just "marked as played"), liked games, replays.
const THIS_YEAR = new Date().getFullYear();
const MODES = {
  completed: { title: 'Played', statuses: ['played', 'dropped'], reviewsOnly: false, empty: (u) => `${u} hasn't played any games yet.` },
  year: { title: 'This year', statuses: ['played', 'dropped'], reviewsOnly: false, keep: (l) => l.played_date && new Date(l.played_date).getFullYear() === THIS_YEAR, empty: (u) => `${u} hasn't played anything this year yet.` },
  logged: { title: 'Logs', statuses: undefined, reviewsOnly: false, keep: (l) => l.rating || l.review || l.loved, empty: (u) => `${u} hasn't logged anything yet.` },
  reviews: { title: 'Reviews', statuses: undefined, reviewsOnly: true, empty: (u) => `${u} hasn't written any reviews yet.` },
  liked: { title: 'Likes', statuses: undefined, reviewsOnly: false, keep: (l) => l.loved, empty: (u) => `${u} hasn't liked any games yet.` },
  replayed: { title: 'Replays', statuses: undefined, reviewsOnly: false, keep: (l) => l.is_replay, empty: (u) => `${u} hasn't replayed any games yet.` },
};

export async function renderLogListView(root, { username, mode }) {
  const cfg = MODES[mode] || MODES.logged;
  root.innerHTML = topBar(cfg.title, { back: true }) + `<div class="view-body" id="loglist-body">${spinner()}</div>` + navBar('');
  const body = qs('#loglist-body', root);

  try {
    const profile = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    let logs = await api.getLogsForUser(profile.id, { statuses: cfg.statuses, reviewsOnly: cfg.reviewsOnly, limit: cfg.keep ? 1000 : 200 });
    if (cfg.keep) logs = logs.filter(cfg.keep);
    const likes = await api.getLikesForLogs(logs.map((l) => l.id), state.user?.id);

    body.innerHTML = logs.length
      ? `<div class="log-list">${logs.map((l) => logCard(l, { showAuthor: false, likeInfo: likes[l.id], ownLog: l.user_id === state.user?.id })).join('')}</div>`
      : emptyState(cfg.empty(username), { icon: iconStamp() });
    wireLogCards(body, logs);
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this list: ${esc(err.message)}</p>`;
  }
}
