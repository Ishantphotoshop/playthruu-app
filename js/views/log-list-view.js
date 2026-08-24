import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, logCard, emptyState, spinner, iconStamp } from '../components.js';
import { esc, qs } from '../utils.js';
import { wireLogCards } from './feed-view.js';

const MODES = {
  completed: { title: 'Completed', statuses: ['played', 'dropped'], reviewsOnly: false, empty: (u) => `${u} hasn't completed any games yet.` },
  logged: { title: 'Logged', statuses: undefined, reviewsOnly: false, empty: (u) => `${u} hasn't logged anything yet.` },
  reviews: { title: 'Reviews', statuses: undefined, reviewsOnly: true, empty: (u) => `${u} hasn't written any reviews yet.` },
};

export async function renderLogListView(root, { username, mode }) {
  const cfg = MODES[mode] || MODES.logged;
  root.innerHTML = topBar(cfg.title, { back: true }) + `<div class="view-body" id="loglist-body">${spinner()}</div>` + navBar('');
  const body = qs('#loglist-body', root);

  try {
    const profile = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    const logs = await api.getLogsForUser(profile.id, { statuses: cfg.statuses, reviewsOnly: cfg.reviewsOnly, limit: 200 });
    const likes = await api.getLikesForLogs(logs.map((l) => l.id), state.user?.id);

    body.innerHTML = logs.length
      ? `<div class="log-list">${logs.map((l) => logCard(l, { showAuthor: false, likeInfo: likes[l.id], ownLog: l.user_id === state.user?.id })).join('')}</div>`
      : emptyState(cfg.empty(username), { icon: iconStamp() });
    wireLogCards(body, logs);
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this list: ${esc(err.message)}</p>`;
  }
}
