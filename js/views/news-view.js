import * as api from '../api.js';
import { topBar, navBar, spinner, emptyState } from '../components.js';
import { esc, timeAgo, qs } from '../utils.js';

// Articles link straight out to the publisher (target="_blank") rather
// than opening in-app — this is an aggregator, not a reader, and these
// outlets' own pages are where the ads/analytics that fund them live.
function newsCard(article) {
  return `
    <a class="news-card" href="${esc(article.link)}" target="_blank" rel="noopener noreferrer">
      <span class="news-card__cover" style="${article.image ? `background-image:url('${esc(article.image)}')` : ''}"></span>
      <span class="news-card__info">
        <span class="news-card__title">${esc(article.title)}</span>
        ${article.summary ? `<span class="news-card__summary">${esc(article.summary)}</span>` : ''}
        <span class="news-card__meta">${esc(article.source)} · ${timeAgo(article.pubDate)}</span>
      </span>
    </a>`;
}

export async function renderNewsView(root) {
  root.innerHTML = topBar('News', { back: true }) + `
    <div class="view-body">
      <div id="news-list">${spinner()}</div>
    </div>` + navBar('/news');

  const listEl = qs('#news-list', root);
  const articles = await api.getGameNews();
  if (!listEl.isConnected) return; // navigated away before this landed

  listEl.innerHTML = articles.length
    ? `<div class="news-list">${articles.map(newsCard).join('')}</div>`
    : emptyState("Couldn't load news right now. Try again in a bit.");
}
