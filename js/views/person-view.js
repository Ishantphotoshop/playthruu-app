import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, iconUser } from '../components.js';
import { esc, qs, toast } from '../utils.js';

// Mirrors studio-view.js's layout (same .director-* CSS) — a person and
// a studio profile lay out the same way: photo, bio, stat row,
// gameography. Sourced from Wikidata instead of IGDB since that's
// where person-level credits (voice actors, directors) actually live.
// One row's credit label — director credits and voice credits render
// differently, and someone with both on the same title (rare, but real
// for small indie teams) shows both rather than picking one.
function roleLabel(g) {
  const parts = [];
  if (g.roles?.includes('director')) parts.push('Directed');
  if (g.roles?.includes('voice')) parts.push(g.characters.length ? g.characters.join(', ') : 'Voice actor');
  return parts.join(' · ');
}

export async function renderPersonView(root, { qid }) {
  // Was hardcoded "Cast" regardless of who was being viewed — wrong on a
  // director's own page. Generic until the profile loads and can say
  // which one this actually is.
  root.innerHTML = topBar('Credits', { back: true }) + `<div class="view-body" id="person-body">${spinner()}</div>` + navBar('');
  const body = qs('#person-body', root);

  try {
    const person = await api.getWikidataPersonProfile(qid);
    const isDirector = person.games.some((g) => g.roles?.includes('director'));
    const titleEl = qs('.topbar__title', root);
    if (titleEl) titleEl.textContent = isDirector ? 'Director' : 'Cast';

    body.innerHTML = `
      <div class="director-header">
        <div class="director-header__photo director-header__photo--fallback">${iconUser()}</div>
        <h1>${esc(person.name)}</h1>
      </div>

      <h2 class="section-heading">About</h2>
      <p class="director-bio">${person.description ? esc(person.description) : 'No bio available yet.'}</p>

      <div class="director-stats">
        <div class="director-stats__item"><b>${person.games.length}</b><span>Games</span></div>
      </div>

      <div class="feed-section-head">
        <h2 class="section-heading">Credits</h2>
        <span class="see-more-link">${person.games.length} title${person.games.length === 1 ? '' : 's'}</span>
      </div>
      ${person.games.length
        ? `<div class="crew-list">${person.games.map((g) => `
            <button type="button" class="crew-row" data-game-title="${esc(g.title)}">
              <span class="crew-row__photo crew-row__photo--fallback">${iconUser()}</span>
              <div class="crew-row__info">
                <div class="crew-row__name">${esc(g.title)}</div>
                ${roleLabel(g) ? `<div class="crew-row__role">${esc(roleLabel(g))}</div>` : ''}
              </div>
            </button>`).join('')}</div>`
        : emptyState('No credits found on Wikidata for this person yet.', { icon: iconUser() })}
    `;

    // These games only exist as Wikidata titles here, not IGDB ids — so
    // tapping one searches IGDB for the best match, adds it (if not
    // already in the catalog), then opens it. Same pattern as adding a
    // game from search results elsewhere in the app.
    body.querySelectorAll('[data-game-title]').forEach((el) => {
      el.addEventListener('click', async () => {
        const title = el.dataset.gameTitle;
        const original = el.querySelector('.crew-row__name').textContent;
        el.querySelector('.crew-row__name').textContent = 'Opening…';
        try {
          const matches = await api.searchIgdb(title, 1);
          if (!matches.length) { toast(`Couldn't find "${title}" to open.`, 'error'); el.querySelector('.crew-row__name').textContent = original; return; }
          const saved = await api.addGame(matches[0], state.user?.id);
          location.hash = `#/game/${saved.id}`;
        } catch (err) {
          toast(err.message || 'Could not open that game.', 'error');
          el.querySelector('.crew-row__name').textContent = original;
        }
      });
    });
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this profile: ${esc(err.message)}</p>`;
  }
}
