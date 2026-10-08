// ARCHIVED 2026-10-09 — the News tab's search bar and category filter.
//
// A pill search field (Search screen's own .search-bar-row / .search-input) with
// the round filter button beside it. Typing narrows the whole archive: every
// word must appear in a story's headline, summary, game, category, status or
// tags. The button opens a slide-up sheet (All, GTA 6 when any story is about
// it - see isAboutGTA6 in api.js, then each real category) and lights up while
// one is applied. Both fed one paintList() that redraws the first batch and
// lets the scroll sentinel load the rest.
//
// To bring it back: paste the helpers below above paintNewsTab in
// js/views/feed-view.js, replace paintNewsTab with the full version at the
// bottom (it keeps the scroll-loading the live one has), start its body.innerHTML
// with newsSearchRowHtml(), and restore the CSS rules listed in
// news-search-filter-2026-10-09.css. `iconFilter`, `iconCheck` and
// `enableSwipeToDismiss` must still be imported there.

// The filter list for a given day's articles: "All", "GTA 6" (only when
// at least one live story is actually about it — see isAboutGTA6 in
// api.js), then every real category in the order it first appears.
function newsFilterOptions(articles) {
  const seen = new Set();
  const categories = [];
  articles.forEach((a) => { if (a.category && !seen.has(a.category)) { seen.add(a.category); categories.push(a.category); } });
  const options = ['All'];
  if (articles.some((a) => a.isGTA6)) options.push('GTA 6');
  return options.concat(categories);
}

// Same search row as the Search screen (a pill field and the round filter
// button beside it, reused classes and all), with the button lit while a
// category is applied. The filter itself still opens the slide-up sheet
// below, since a wrapping chip row ran to three lines once GTA 6 joined
// the real categories.
function newsSearchRowHtml() {
  return `
    <div class="search-bar-row news-search-row">
      <input type="search" id="news-search" class="search-input" placeholder="Search news…" autocomplete="off" enterkeyhint="search">
      <button type="button" class="filter-btn" id="news-filter-btn" aria-label="Filter news">${iconFilter()}</button>
    </div>`;
}

// A plain bottom sheet, same recipe as every other one in this app
// (message-thread-view's action sheets, confirmSheet) — a grab handle,
// a list of rows, a checkmark on whichever is active. Swipe-to-dismiss
// and a tap outside both close it without picking anything.
function openNewsFilterSheet(options, active, onPick) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal--sheet">
      <header class="msg-actions__grab" aria-hidden="true"></header>
      <div class="msg-actions">
        <h2 class="news-filter-sheet__title">Filter News</h2>
        <div class="msg-actions__list">
          ${options.map((o) => `
            <button type="button" class="msg-actions__item news-filter-sheet__item${o === active ? ' news-filter-sheet__item--active' : ''}" data-option="${esc(o)}">
              <span>${esc(o)}</span>${o === active ? iconCheck() : ''}
            </button>`).join('')}
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  enableSwipeToDismiss(qs('.modal', overlay), close);
  qsa('[data-option]', overlay).forEach((btn) => {
    btn.addEventListener('click', () => { close(); onPick(btn.dataset.option); });
  });
}


// ---- the full paintNewsTab as it was, search + filter included ----
async function paintNewsTab(body) {
  // Same reasoning as paintFeedTab's cache above: show whatever was on
  // screen last time at once and let the real read catch up behind it.
  const cachedList = getCached(NEWS_CACHE_KEY);
  body.innerHTML = `${newsSearchRowHtml()}<div id="news-list">${cachedList || spinner()}</div><div id="news-sentinel" aria-hidden="true"></div>`;

  const listEl = qs('#news-list', body);
  const articles = await api.getGameNews();
  if (!listEl.isConnected) return; // switched tabs again before this landed

  if (!articles.length) {
    // Only replace the screen with an error when there's nothing already
    // showing — a background refetch hiccup shouldn't yank away
    // headlines that were displaying just fine a moment ago.
    if (!cachedList) listEl.innerHTML = emptyState("Couldn't load news right now. Try again in a bit.");
    return;
  }
  markNewsSeen(articles[0].pubDate);

  let active = 'All';
  let query = '';
  let shown = NEWS_BATCH;
  let matched = articles;
  const input = qs('#news-search', body);
  const filterBtn = qs('#news-filter-btn', body);
  const sentinel = qs('#news-sentinel', body);

  // Every word typed has to appear somewhere in the story's headline,
  // blurb, game, category or tags — so "gta leak" finds a story that says
  // "GTA 6" in the title and "leak" in a tag.
  const haystack = new WeakMap();
  const hay = (a) => {
    let h = haystack.get(a);
    if (!h) { h = [a.title, a.summary, a.game, a.category, a.status, ...(a.tags || [])].filter(Boolean).join(' ').toLowerCase(); haystack.set(a, h); }
    return h;
  };
  const matches = (a) => {
    if (active === 'GTA 6' ? !a.isGTA6 : active !== 'All' && a.category !== active) return false;
    return query.split(/\s+/).filter(Boolean).every((w) => hay(a).includes(w));
  };

  const cardsHtml = (list) => list.map(newsCard).join('');
  const paintList = () => {
    matched = articles.filter(matches);
    shown = Math.min(NEWS_BATCH, matched.length);
    const html = `<div class="news-list">${matched.length ? cardsHtml(matched.slice(0, shown)) : emptyState(query ? `Nothing found for “${query}”.` : `No ${active} stories right now.`)}</div>`;
    listEl.innerHTML = html;
    if (active === 'All' && !query) setCached(NEWS_CACHE_KEY, html);
    filterBtn.classList.toggle('filter-btn--on', active !== 'All');
    sentinel.hidden = shown >= matched.length;
  };

  // The rest of the archive arrives a screenful at a time as you near the
  // bottom of what's drawn — every story ever published is in `articles`,
  // but 190+ cards with art shouldn't all be built on open.
  const more = () => {
    if (shown >= matched.length) return;
    const next = matched.slice(shown, shown + NEWS_BATCH);
    qs('.news-list', listEl)?.insertAdjacentHTML('beforeend', cardsHtml(next));
    shown += next.length;
    sentinel.hidden = shown >= matched.length;
  };
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, {
      root: body.closest('.view-body') || null, rootMargin: '0px 0px 900px 0px',
    }).observe(sentinel);
  } else {
    sentinel.outerHTML = '<button type="button" class="btn btn--block" id="news-more">Show more</button>';
    qs('#news-more', body).addEventListener('click', more);
  }

  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = input.value.trim().toLowerCase(); paintList(); }, 160);
  });
  filterBtn.addEventListener('click', () => {
    openNewsFilterSheet(newsFilterOptions(articles), active, (picked) => {
      if (picked === active) return;
      active = picked;
      paintList();
    });
  });
  paintList();
}
