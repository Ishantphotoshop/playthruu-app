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
          : `<div class="cp-empty"><svg class="cp-empty__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M7 9h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L14.5 14h-5l-1.1 1.8A3 3 0 0 1 3 14v-1a4 4 0 0 1 4-4z"/><path d="M8 11.5v2.5M6.75 12.75h2.5"/><circle cx="15.5" cy="12" r=".6" fill="currentColor"/><circle cx="17.5" cy="13.5" r=".6" fill="currentColor"/></svg><p class="cp-empty__h">Controllers are charging.</p><p class="cp-empty__s">When a friend starts a game it shows up here.</p><a class="btn btn--accent cp-empty__btn" href="#/people">Find people</a></div>`);
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this right now: ${err.message}</p>`;
  }
}
