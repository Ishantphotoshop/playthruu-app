import * as api from '../api.js';
import { topBar, spinner, posterFrame } from '../components.js';
import { esc, timeAgo, qs } from '../utils.js';

// The teaser reader a News card now opens into, instead of leaving the
// app straight away. Shows the headline, the "why it matters" line and
// the article's opening paragraph — then hands off to the real article
// on playthruu.com for the rest. Keeps people in the app for the part
// that's quick to read, and still sends every full read to the site,
// which is the whole point of doing it this way instead of reading the
// entire article in here.
const NEWS_SITE = 'https://playthruu.com/news/';
const STATUS_LABEL = { confirmed: 'Confirmed', reported: 'Reported', rumor: 'Rumor', leak: 'Leak' };

// Pulls the first real paragraph out of the article's block body — skips
// headings and the inline "Reported"/dated-update asides, which read as
// mid-story context rather than an opening line.
function firstParagraph(body) {
  const p = (body || []).find((b) => b.type === 'p' || !b.type);
  return p ? p.text : '';
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
  const teaser = firstParagraph(a.body);

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
        ${teaser ? `<p class="na__teaser">${esc(teaser)}</p>` : a.card_description ? `<p class="na__teaser">${esc(a.card_description)}</p>` : ''}
        <a class="na__cta" href="${esc(siteLink)}" target="_blank" rel="noopener noreferrer">Continue reading on PlayThruu.com</a>
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
