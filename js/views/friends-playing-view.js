import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, friendsPlayingCard, iconUser } from '../components.js';
import { qs } from '../utils.js';

// The feed's own strip caps at 15 for a reasonable single scroll — this
// is the "see more" destination for it, so it asks for everything
// instead, wrapped into a grid rather than one long horizontal scroll.
export async function renderFriendsPlayingView(root) {
  root.innerHTML = topBar("Friend's activity", { back: true }) +
    `<div class="view-body" id="friends-playing-body">${spinner()}</div>` + navBar('');
  const body = qs('#friends-playing-body', root);

  try {
    const entries = await api.getFriendsPlaying(state.user.id, 200);
    body.innerHTML = entries.length
      ? `<div class="card-grid">${entries.map((e, i) => friendsPlayingCard(e, i)).join('')}</div>`
      : emptyState("Nobody you follow has completed anything yet.", { icon: iconUser() });
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this right now: ${err.message}</p>`;
  }
}
