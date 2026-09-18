import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, profileRow, wireFollowButtons, emptyState, spinner, iconUser } from '../components.js';
import { esc, qs, toast, promptSignIn } from '../utils.js';

/**
 * "Find people to follow" — the screen the empty feed points at.
 *
 * It used to point at /search, which drops you on a blank box with
 * nothing to search for: the one person who most needs suggestions is
 * the one with no idea who to look up. This shows actual accounts,
 * ranked by how many people already follow them and shuffled so it is
 * not the same faces every visit (see getSuggestedPeople).
 */
export async function renderPeopleView(root) {
  root.innerHTML = topBar('People to follow', { back: true }) +
    `<div class="view-body" id="people-body">${spinner()}</div>` + navBar('');
  const body = qs('#people-body', root);

  if (!state.user) {
    body.innerHTML = emptyState('Sign in to follow people and build your feed.', { icon: iconUser() });
    return;
  }

  try {
    const people = await api.getSuggestedPeople(state.user.id, 25);
    if (!people.length) {
      body.innerHTML = emptyState(
        "You're already following everyone here. Try searching for someone by name.",
        { icon: iconUser(), actionLabel: 'Search players', actionRoute: '/search' },
      );
      return;
    }
    body.innerHTML = `
      <p class="people-intro">Accounts other players follow. Follow a few and your feed fills up.</p>
      <div class="profile-list">${people.map((p) => profileRow(p, { following: false })).join('')}</div>`;

    wireFollowButtons(body, {
      onToggle: async (userId, wasFollowing) => {
        if (!state.user) { promptSignIn('Sign in to follow players.'); throw new Error('not signed in'); }
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
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load suggestions: ${esc(err.message)}</p>`;
  }
}
