import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, activityCard, iconUser, iconStamp } from '../components.js';
import { qs } from '../utils.js';

// See friends-playing-view.js's comment — same idea, "see more" from
// the feed's own capped strip, into everything instead, wrapped into a
// grid rather than one long horizontal scroll.
export async function renderCurrentlyPlayingView(root) {
  root.innerHTML = topBar('Currently playing', { back: true, brand: true }) +
    `<div class="view-body" id="currently-playing-body">${spinner()}</div>` + navBar('');
  const body = qs('#currently-playing-body', root);

  try {
    const { logs, isFallback } = await api.getFeed(state.user.id, 200, 'playing');
    body.innerHTML = logs.length
      ? `<div class="card-grid">${logs.map((l) => activityCard(l)).join('')}</div>`
      : (isFallback
          ? emptyState("Nobody's currently playing anything yet. Be the first to log one.", { icon: iconStamp(), actionLabel: 'Log your first game', actionRoute: '/log' })
          : emptyState("The people you follow aren't currently playing anything.", { icon: iconUser(), actionLabel: 'Find more people to follow', actionRoute: '/search' }));
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this right now: ${err.message}</p>`;
  }
}
