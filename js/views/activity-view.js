import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, emptyState, spinner, iconStamp } from '../components.js';
import { esc, qs } from '../utils.js';
import { navigate } from '../router.js';
import { activityRow } from './notifications-view.js';

// One player's Activity: the same rows as the Notifications tabs (logs, likes, follows, comments), only their own doings.
export async function renderActivityView(root, { username }) {
  root.innerHTML = topBar('Activity', { back: true }) + `<div class="view-body" id="activity-body">${spinner()}</div>` + navBar('');
  const body = qs('#activity-body', root);

  try {
    const profile = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    let rows = [], cursor = null, hasMore = false;
    const viewerId = state.user?.id;
    const paint = () => {
      body.innerHTML = rows.length
        ? `<div class="act-list">${rows.map((r) => activityRow({ ...r, unread: false }, viewerId)).join('')}</div>${hasMore ? '<button type="button" class="ps-pill" id="act-more" style="margin:16px auto;display:block">Show more</button>' : ''}`
        : emptyState(`${username} hasn't done anything yet.`, { icon: iconStamp() });
      qs('#act-more', body)?.addEventListener('click', load);
    };
    const load = async () => {
      const res = await api.getActivityFeed(profile.id, { scope: 'you', includeYou: false, includeIncoming: false, before: cursor, limit: 40 });
      const seen = new Set(rows.map((r) => r.key));
      rows = rows.concat(res.rows.filter((r) => !seen.has(r.key)));
      cursor = res.cursor; hasMore = !!res.hasMore && res.rows.some((r) => !seen.has(r.key));
      paint();
    };
    await load();
    body.addEventListener('click', (e) => {
      const rowEl = e.target.closest('.act');
      if (rowEl?.dataset.href) navigate(rowEl.dataset.href);
    });
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this activity: ${esc(err.message)}</p>`;
  }
}
