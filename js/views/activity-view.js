import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, logCard, emptyState, spinner, iconStamp } from '../components.js';
import { esc, qs } from '../utils.js';
import { wireLogCards } from './feed-view.js';

export async function renderActivityView(root, { username }) {
  root.innerHTML = topBar(`${username}'s Activity`, { back: true }) + `<div class="view-body" id="activity-body">${spinner()}</div>` + navBar('');
  const body = qs('#activity-body', root);

  try {
    const profile = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    const [activity, likedLogs] = await Promise.all([
      api.getUserActivity(profile.id),
      api.getLikesGiven(profile.id),
    ]);
    const likes = await api.getLikesForLogs([...activity, ...likedLogs].map((l) => l.id), state.user?.id);

    body.innerHTML = `
      <h2 class="section-heading">Recently logged</h2>
      ${activity.length
        ? `<div class="log-list">${activity.map((l) => logCard(l, { showAuthor: false, likeInfo: likes[l.id], ownLog: l.user_id === state.user?.id })).join('')}</div>`
        : emptyState(`${username} hasn't logged anything yet.`, { icon: iconStamp() })}

      <h2 class="section-heading">Reviews liked</h2>
      ${likedLogs.length
        ? `<div class="log-list">${likedLogs.map((l) => logCard(l, { showAuthor: true, likeInfo: likes[l.id], ownLog: l.user_id === state.user?.id })).join('')}</div>`
        : emptyState(`${username} hasn't liked any reviews yet.`, { icon: iconStamp() })}
    `;
    wireLogCards(body, [...activity, ...likedLogs]);
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this activity: ${esc(err.message)}</p>`;
  }
}
