import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, iconUser, posterFrame } from '../components.js';
import { esc, qs, toast, starRow } from '../utils.js';

// Replaces the old per-person Director page. IGDB doesn't expose
// individual crew credits the way RAWG did, only which studios were
// involved — so this shows the developer studio instead: logo, blurb,
// and the games they've made. Reuses the same `.director-*` CSS classes
// as before (a studio profile and a person profile lay out the same
// way: photo/logo, name, bio, stat row, gameography grid).
export async function renderStudioView(root, { companyId }) {
  root.innerHTML = topBar('Studio', { back: true }) + `<div class="view-body" id="director-body">${spinner()}</div>` + navBar('');
  const body = qs('#director-body', root);

  try {
    const studio = await api.getStudioProfile(companyId);
    if (!studio) {
      body.innerHTML = emptyState('Could not load this studio\'s profile right now.', { icon: iconUser() });
      return;
    }

    body.innerHTML = `
      <div class="director-header">
        ${studio.logo
          ? `<img class="director-header__photo director-header__photo--studio" src="${esc(studio.logo)}" alt="${esc(studio.name)}">`
          : `<div class="director-header__photo director-header__photo--fallback">${iconUser()}</div>`}
        <h1>${esc(studio.name)}</h1>
        ${studio.foundedYear ? `<p class="director-header__active">Founded ${studio.foundedYear}</p>` : ''}
      </div>

      <h2 class="section-heading">About</h2>
      <p class="director-bio">${studio.bio ? esc(studio.bio) : 'No studio description available yet.'}</p>

      <div class="director-stats">
        <div class="director-stats__item"><b>${studio.games.length}</b><span>Games</span></div>
      </div>

      <div class="feed-section-head">
        <h2 class="section-heading">Gameography</h2>
        <span class="see-more-link">${studio.games.length} title${studio.games.length === 1 ? '' : 's'}</span>
      </div>
      ${studio.games.length
        ? `<div class="game-grid">${studio.games.map((g) => `
            <button type="button" class="game-card gameography-card" data-igdb-id="${g.igdb_id}">
              ${posterFrame(g.cover_url, g.title, 'game-card__cover')}
              <div class="game-card__title">${esc(g.title)}</div>
              <div class="gameography-card__meta">
                ${g.year ? `<span>${g.year}</span>` : ''}
                ${g.rating ? starRow(g.rating / 20, { size: 10 }) : ''}
              </div>
            </button>`).join('')}</div>`
        : emptyState('No credited games found.', { icon: iconUser() })}
    `;

    // These are IGDB-only references (not yet in the local catalog), so
    // tapping one imports it first, same pattern as search results.
    const byIgdbId = new Map(studio.games.map((g) => [String(g.igdb_id), g]));
    body.querySelectorAll('[data-igdb-id]').forEach((el) => {
      el.addEventListener('click', async () => {
        const g = byIgdbId.get(el.dataset.igdbId);
        if (!g) return;
        try {
          const saved = await api.addGame({ igdb_id: g.igdb_id, title: g.title, cover_url: g.cover_url, release_year: g.year }, state.user?.id);
          location.hash = `#/game/${saved.id}`;
        } catch (err) {
          toast(err.message || 'Could not open that game.', 'error');
        }
      });
    });
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this studio: ${esc(err.message)}</p>`;
  }
}
