import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, iconUser, posterFrame } from '../components.js';
import { esc, qs, toast, starRow, igdbSized } from '../utils.js';
import { navigate } from '../router.js';

// RAWG-sourced director profile — real photo, real bio, real filmography
// with cover art, reached from the director credit on a game page when
// RAWG recognizes them (see directorChipHtml in game-view.js). Backed by
// RAWG's creators API instead of Wikidata's sparser P57 data.
//
// The hero at the top reuses the exact .gd-hero/.gd-hero__bg/.gd-hero__
// scrim treatment the game page uses for its own backdrop, so a
// director's page reads as the same visual language as the rest of the
// app rather than a one-off design — backed by their highest-rated
// credit's cover art, which also becomes the "Known for" card below.
export async function renderDirectorView(root, { slug }) {
  root.innerHTML = topBar('Director', { back: true }) + `<div class="view-body" id="director-body">${spinner()}</div>` + navBar('');
  const body = qs('#director-body', root);

  try {
    const person = await api.getRawgPersonProfile(slug);
    if (!person) {
      body.innerHTML = emptyState('Could not load this director\'s profile right now.', { icon: iconUser() });
      return;
    }

    const ranked = [...person.games].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const featured = ranked.find((g) => g.cover_url) || null;
    const filmography = featured ? person.games.filter((g) => g !== featured) : person.games;

    body.innerHTML = `
      <div class="gd-hero">
        ${featured?.cover_url ? `
          <div class="gd-hero__bg" style="background-image:url('${esc(igdbSized(featured.cover_url, 'cover_big'))}')"></div>
          <div class="gd-hero__scrim"></div>` : ''}
        <div class="director-hero__content">
          ${person.photo
            ? `<img class="director-hero__photo" src="${esc(person.photo)}" alt="${esc(person.name)}">`
            : `<div class="director-hero__photo director-hero__photo--fallback">${iconUser()}</div>`}
          <h1 class="director-hero__name">${esc(person.name)}</h1>
          ${person.positions.length ? `<div class="director-hero__pills">${person.positions.map((p) => `<span class="gd-tag">${esc(p)}</span>`).join('')}</div>` : ''}
        </div>
      </div>

      <h2 class="section-heading">About</h2>
      ${person.bio.length
        ? `<p class="director-bio">${esc(person.bio[0])}</p>
           ${person.bio.length > 1 ? `
             <div class="director-bio-more" hidden>${person.bio.slice(1).map((p) => `<p class="director-bio">${esc(p)}</p>`).join('')}</div>
             <button type="button" class="gd-link" id="bio-toggle">Show more</button>` : ''}`
        : `<p class="director-bio">No bio available yet.</p>`}

      <div class="director-stats">
        <div class="director-stats__item"><b>${person.games.length}</b><span>Games</span></div>
      </div>

      ${featured ? `
        <h2 class="section-heading">Known for</h2>
        <button type="button" class="director-featured" data-game-title="${esc(featured.title)}">
          ${posterFrame(featured.cover_url, featured.title, 'director-featured__cover')}
          <div class="director-featured__info">
            <div class="director-featured__title">${esc(featured.title)}</div>
            <div class="gameography-card__meta">
              ${featured.year ? `<span>${featured.year}</span>` : ''}
              ${featured.rating ? starRow(featured.rating / 20, { size: 12 }) : ''}
            </div>
          </div>
        </button>` : ''}

      ${filmography.length ? `
        <div class="feed-section-head">
          <h2 class="section-heading">Filmography</h2>
          <span class="see-more-link">${filmography.length} title${filmography.length === 1 ? '' : 's'}</span>
        </div>
        <div class="game-grid game-grid--3col">${filmography.map((g) => `
          <button type="button" class="game-card gameography-card" data-game-title="${esc(g.title)}">
            ${posterFrame(g.cover_url, g.title, 'game-card__cover')}
            <div class="game-card__title">${esc(g.title)}</div>
            <div class="gameography-card__meta">
              ${g.year ? `<span>${g.year}</span>` : ''}
              ${g.rating ? starRow(g.rating / 20, { size: 10 }) : ''}
            </div>
          </button>`).join('')}</div>`
        : (featured ? '' : emptyState('No games found for this director.', { icon: iconUser() }))}
    `;

    const bioToggle = qs('#bio-toggle', body);
    if (bioToggle) {
      bioToggle.addEventListener('click', () => {
        const more = qs('.director-bio-more', body);
        const expanded = more.hidden === false;
        more.hidden = expanded;
        bioToggle.textContent = expanded ? 'Show more' : 'Show less';
      });
    }

    // Same as person-view.js: these are RAWG titles only, no igdb_id, so
    // tapping one searches IGDB for the best match, adds it (if not
    // already in the catalog), then opens it. Covers both the
    // "Known for" card and the grid below — both carry data-game-title.
    body.querySelectorAll('[data-game-title]').forEach((el) => {
      el.addEventListener('click', async () => {
        const title = el.dataset.gameTitle;
        try {
          const matches = await api.searchIgdb(title, 1);
          if (!matches.length) { toast(`Couldn't find "${title}" to open.`, 'error'); return; }
          const g = matches[0];
          // Free-viewing rule, same as everywhere else browsing works in
          // this app: opening a game to look at it doesn't need an
          // account — only actually saving/logging it does.
          if (!state.user) {
            if (g.igdb_id) { navigate(`/game/igdb/${g.igdb_id}`); return; }
            toast(`Couldn't open "${title}".`, 'error');
            return;
          }
          const saved = await api.addGame(g, state.user.id);
          navigate(`/game/${saved.id}`);
        } catch (err) {
          toast(err.message || 'Could not open that game.', 'error');
        }
      });
    });
  } catch (err) {
    body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this profile: ${esc(err.message)}</p>`;
  }
}
