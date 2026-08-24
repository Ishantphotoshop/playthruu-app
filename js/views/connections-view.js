import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, profileRow, wireFollowButtons, emptyState, spinner, iconUser } from '../components.js';
import { esc, qs, toast } from '../utils.js';

export async function renderConnectionsView(root, { username, kind }) {
  const title = kind === 'followers' ? 'Followers' : 'Following';
  root.innerHTML = topBar(title, { back: true }) + `<div class="view-body" id="connections-body">${spinner()}</div>` + navBar('');
  const body = qs('#connections-body', root);

  try {
    const profile = state.profile?.username === username ? state.profile : await api.getProfileByUsername(username);
    const [people, followingSet] = await Promise.all([
      kind === 'followers' ? api.getFollowers(profile.id) : api.getFollowing(profile.id),
      api.getFollowingIdSet(state.user?.id),
    ]);

    if (!people.length) {
      body.innerHTML = emptyState(
        kind === 'followers' ? `@${username} doesn't have any followers yet.` : `@${username} isn't following anyone yet.`,
        { icon: iconUser() }
      );
      return;
    }

    body.innerHTML = `<div class="profile-list">${people.map(p =>
      profileRow(p, p.id === state.user?.id ? {} : { following: followingSet.has(p.id) })
    ).join('')}</div>`;

    wireFollowButtons(body, {
      onToggle: async (userId, wasFollowing) => {
        try {
          if (wasFollowing) await api.unfollow(state.user.id, userId);
          else await api.follow(state.user.id, userId);
        } catch (err) {
          toast(err.message || 'Could not update follow status.', 'error');
          throw err;
        }
      },
    });
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this list: ${esc(err.message)}</p>`;
  }
}
