import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, logCard, emptyState, spinner } from '../components.js';
import { esc, qs } from '../utils.js';
import { wireLogCards } from './feed-view.js';

const SORTS = {
  popular: { label: 'Most popular', fn: (a, b, likes) => (likes[b.id]?.count || 0) - (likes[a.id]?.count || 0) },
  new: { label: 'Newest first', fn: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  old: { label: 'Oldest first', fn: (a, b) => new Date(a.created_at) - new Date(b.created_at) },
  high: { label: 'Highest rated', fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
  low: { label: 'Lowest rated', fn: (a, b) => (a.rating || 0) - (b.rating || 0) },
};

export async function renderGameReviewsView(root, { id }) {
  root.innerHTML = topBar('Reviews', { back: true }) + `<div class="view-body" id="reviews-body">${spinner()}</div>` + navBar('');
  const body = qs('#reviews-body', root);
  let sortKey = 'popular';

  try {
    const [game, logs] = await Promise.all([api.getGame(id), api.getLogsForGame(id, 500)]);
    const reviewedLogs = logs.filter((l) => l.review);
    const likes = await api.getLikesForLogs(reviewedLogs.map((l) => l.id), state.user?.id);

    function paint() {
      const sorted = [...reviewedLogs].sort((a, b) => SORTS[sortKey].fn(a, b, likes));
      body.innerHTML = `
        <div class="reviews-page__head">
          <div>
            <h1>${esc(game.title)}</h1>
            <p class="muted">${reviewedLogs.length} review${reviewedLogs.length === 1 ? '' : 's'}</p>
          </div>
          <label class="discover-select-wrap">
            <select id="reviews-sort" class="discover-select">
              ${Object.entries(SORTS).map(([key, s]) => `<option value="${key}" ${key === sortKey ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="log-list" id="reviews-list">
          ${sorted.length
            ? sorted.map((l) => logCard(l, { showAuthor: true, likeInfo: likes[l.id], ownLog: l.user_id === state.user?.id })).join('')
            : emptyState('No written reviews yet. Be the first to share your thoughts.', { actionLabel: 'Log this game', actionRoute: '/log' })}
        </div>`;

      qs('#reviews-sort', body).addEventListener('change', (e) => {
        sortKey = e.target.value;
        paint();
      });
      wireLogCards(qs('#reviews-list', body), reviewedLogs);
    }

    paint();
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load reviews: ${esc(err.message)}</p>`;
  }
}
