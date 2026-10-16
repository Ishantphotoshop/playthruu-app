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
    // a brand-new account follows nobody: no strangers' games here
    if (isFallback) { body.innerHTML = emptyState('Nothing here yet.', { quotes: 'friends' }); return; }
    body.innerHTML = logs.length
      ? `<div class="card-grid">${logs.map((l) => activityCard(l)).join('')}</div>`
      : (isFallback
          ? emptyState("Nobody's currently playing anything yet. Be the first to log one.", { icon: iconStamp(), actionLabel: 'Log your first game', actionRoute: '/log' })
          : `<div class="cp-empty"><svg class="cp-empty__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/><path d="M5.5 10v4" stroke-width="2.4"/></svg><p class="cp-empty__h">Controllers are charging.</p><p class="cp-empty__s">When a friend starts a game it shows up here.</p><a class="btn btn--accent cp-empty__btn" href="#/people">Find people</a></div>`);
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this right now: ${err.message}</p>`;
  }
}
