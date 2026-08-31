import * as api from '../api.js';
import { topBar, navBar, spinner, emptyState } from '../components.js';
import { esc, timeAgo, qs } from '../utils.js';
import { getCached, setCached } from '../cache.js';

const NEWS_CACHE_KEY = 'news';

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
  // The proxy itself already caches merged articles for 10 minutes
  // server-side (see supabase/functions/news-proxy), but that still
  // costs a network round trip and a spinner on every single tab open.
  // Painting last visit's list immediately removes that wait entirely;
  // the fetch below still runs right after to catch anything newer.
  const cachedList = getCached(NEWS_CACHE_KEY);
  root.innerHTML = topBar('News', { back: true }) + `
    <div class="view-body">
      <div id="news-list">${cachedList || spinner()}</div>
    </div>` + navBar('/news');

  const listEl = qs('#news-list', root);
  const articles = await api.getGameNews();
  if (!listEl.isConnected) return; // navigated away before this landed

  if (articles.length) {
    const html = `<div class="news-list">${articles.map(newsCard).join('')}</div>`;
    listEl.innerHTML = html;
    setCached(NEWS_CACHE_KEY, html);
  } else if (!cachedList) {
    // Only replace the screen with an error when there's nothing already
    // showing — a background refetch hiccup shouldn't yank away
    // headlines that were displaying just fine a moment ago.
    listEl.innerHTML = emptyState("Couldn't load news right now. Try again in a bit.");
  }
}
