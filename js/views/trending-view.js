import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, posterFrame, iconStamp } from '../components.js';
import { qs, qsa, toast } from '../utils.js';
import { navigate } from '../router.js';

// See friends-playing-view.js's comment — same idea, "see more" from
// the feed's own capped strip, into everything instead, wrapped into a
// grid rather than one long horizontal scroll. Same .trending-card
// markup trendingStrip() itself uses, just laid out in .card-grid
// instead of .trending-strip's own wrapper.
export async function renderTrendingView(root) {
  root.innerHTML = topBar('Trending now', { back: true, brand: true }) +
    `<div class="view-body" id="trending-body">${spinner()}</div>` + navBar('');
  const body = qs('#trending-body', root);

  try {
    const games = await api.getWorldTrending(60, 10);
    if (!games.length) {
      body.innerHTML = emptyState("Nothing trending right now.", { icon: iconStamp() });
      return;
    }
    body.innerHTML = `<div class="card-grid">${games.map((g, i) => `
      <button type="button" class="trending-card" data-idx="${i}">
        ${posterFrame(g.cover_url, g.title, 'trending-card__cover')}
      </button>`).join('')}</div>`;

    qsa('.trending-card', body).forEach((el) => {
      el.addEventListener('click', async () => {
        el.disabled = true;
        try {
          const saved = await api.addGame(games[Number(el.dataset.idx)], state.user.id);
          navigate(`/game/${saved.id}`);
        } catch (err) {
          toast(err.message || 'Could not open that game.', 'error');
          el.disabled = false;
        }
      });
    });
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this right now: ${err.message}</p>`;
  }
}
