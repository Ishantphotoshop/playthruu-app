import * as api from '../api.js';
import { topBar, spinner, posterFrame } from '../components.js';
import { esc, timeAgo, formatDate, qs } from '../utils.js';

// The in-app reader a News card opens into. Used to stop at the first
// paragraph and hand off to playthruu.com for the rest; now the whole
// article reads here — headings, paragraphs, the inline "Reported"/
// dated-update asides — so someone can just keep scrolling and finish
// it without leaving. A link to the site stays at the bottom for the
// sourcing/citations the site version carries, which is also what sends
// traffic there.
const NEWS_SITE = 'https://playthruu.com/news/';
const STATUS_LABEL = { confirmed: 'Confirmed', reported: 'Reported', rumor: 'Rumor', leak: 'Leak' };

// Each block in `body` is one of: a heading, a plain paragraph, an
// inline "this part is Reported, not confirmed" aside, or a dated
// addendum tacked on after the story first went up.
function bodyBlockHtml(b) {
  if (b.type === 'h2') return `<h2 class="na__h2">${esc(b.text)}</h2>`;
  if (b.type === 'status') return `<div class="na__aside"><span class="na__aside-label">${esc(b.label || 'Unconfirmed')}</span><p>${esc(b.text)}</p></div>`;
  if (b.type === 'update') return `<div class="na__aside na__aside--update"><span class="na__aside-label">Update${b.date ? ` — ${esc(formatDate(b.date))}` : ''}</span><p>${esc(b.text)}</p></div>`;
  return `<p class="na__p">${esc(b.text)}</p>`;
}

export async function renderNewsArticleView(root, { slug }) {
  root.innerHTML = topBar('News', { back: true }) +
    `<div class="view-body" id="na-body">${spinner()}</div>`;
  const body = qs('#na-body', root);

  let a;
  try {
    a = await api.getNewsArticleBySlug(slug);
  } catch {
    body.innerHTML = `<p class="empty-state">Couldn't load that story.</p>`;
    return;
  }

  const siteLink = NEWS_SITE + a.slug;
  const status = STATUS_LABEL[a.verification_status] || '';
  const flagStatus = status && status !== 'Confirmed';
  const blocks = Array.isArray(a.body) ? a.body : [];

  body.innerHTML = `
    <article class="na">
      ${a.image_url ? `
        <div class="na__cover" style="background-image:url('${esc(a.image_url)}')">
          ${a.importance === 'breaking' ? '<span class="na__breaking">Breaking</span>' : ''}
        </div>
        ${a.image_credit ? `<div class="na__credit">${esc(a.image_credit)}</div>` : ''}
      ` : ''}
      <div class="na__content">
        <div class="na__meta">${esc(a.category)}${flagStatus ? ` · ${esc(status)}` : ''} · ${timeAgo(a.updated_at)}</div>
        <h1 class="na__title">${esc(a.title)}</h1>
        <div id="na-game-slot"></div>
        ${a.why_it_matters ? `<p class="na__why"><strong>Why it matters:</strong> ${esc(a.why_it_matters)}</p>` : ''}
        <div class="na__article">
          ${blocks.length ? blocks.map(bodyBlockHtml).join('') : a.card_description ? `<p class="na__p">${esc(a.card_description)}</p>` : ''}
        </div>
        <a class="na__cta" href="${esc(siteLink)}" target="_blank" rel="noopener noreferrer">View sources on PlayThruu.com</a>
      </div>
    </article>`;

  // The story names a game ("Apex Legends", "Heroes of the Storm"), so
  // look it up against the catalogue and offer a way straight to its
  // page — in the background, after the article itself is already on
  // screen, since this is a search call this view doesn't need to block
  // reading on. Silently does nothing when there's no clean match: a
  // wrong game is worse than no chip at all.
  if (a.game) wireGameChip(a.game);
}

async function wireGameChip(gameTitle) {
  let matches = [];
  try { matches = await api.searchGames(gameTitle, 5); } catch { return; }
  const exact = matches.find((g) => g.title?.toLowerCase() === gameTitle.toLowerCase());
  const game = exact || matches[0];
  if (!game) return;
  const slot = qs('#na-game-slot');
  if (!slot) return; // navigated away before the search came back
  slot.innerHTML = `
    <a class="na__game" href="#/game/${game.id}">
      ${posterFrame(game.cover_url, game.title, 'na__game-cover')}
      <span class="na__game-text"><span class="na__game-label">About this game</span><span class="na__game-title">${esc(game.title)}</span></span>
    </a>`;
}
