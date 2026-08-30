import { esc, starRow, statusStamp, formatDate, timeAgo, placeholderCover, initials, qs, qsa, toast, enableSwipeToDismiss, tapFeedback } from './utils.js';
import { getTheme } from './theme.js';
import { state } from './state.js';

// Renders a cover image inside the blur-fill poster mechanism (see
// .poster-frame in styles.css). `extraClass` carries the per-context
// sizing/radius class (e.g. "game-card__cover") that already exists on
// each card type. Pass `tag` to control the wrapping element — 'a' for
// a clickable link (give `href` too), 'span' for a non-interactive cover.
export function posterFrame(coverUrl, title, extraClass = '', { tag = 'span', href = '', id = '' } = {}) {
  const src = coverUrl || placeholderCover(title);
  const fallback = placeholderCover(title);
  const attrs = tag === 'a' ? `href="${esc(href)}"` : '';
  return `<${tag} ${attrs} ${id ? `id="${esc(id)}"` : ''} class="poster-frame ${extraClass}">
    <img class="poster-frame__blur" src="${esc(src)}" alt="" aria-hidden="true" loading="lazy">
    <img class="poster-frame__img" src="${esc(src)}" alt="${esc(title)} cover" loading="lazy" onerror="this.src='${fallback}';this.previousElementSibling.src='${fallback}';">
  </${tag}>`;
}

// Signed-out visitors reach real pages behind this same nav (a game
// page, /search, /discover — all registered as public routes, see
// app.js) without ever having an account, AND the landing screen itself
// (a separate local mini-app, see landing-view.js) has its own icon-only
// nav for the same four destinations. Those two used to look nothing
// alike — labelled Feed/Log/Messages/Profile here (all of which need an
// account) vs. icon-only Account/Browse/Discover/Search there — so the
// whole nav bar visibly changed shape the moment someone left the
// landing screen for a real page. This now renders the exact same
// markup/class as the landing screen's nav in the signed-out case, so
// it's one consistent bar throughout, not two different-looking ones.
// Account and Browse aren't routes (there's no plain "/browse" page —
// it's a screen inside landing-view.js's own local state), so those two
// are data-action buttons that drop back into the landing shell on the
// right screen; Discover and Search are real links either way.
export function navBar(activeBase = '/feed') {
  if (!state.user) {
    return `
      <nav class="tabbar landing-nav">
        <button type="button" class="tabbar__item" data-action="account" aria-label="Account">${iconAccountNav()}</button>
        <button type="button" class="tabbar__item" data-action="browse" aria-label="Browse">${iconBrowseNav()}</button>
        <a href="#/discover" class="tabbar__item${activeBase === '/discover' ? ' tabbar__item--active' : ''}" data-route="/discover" aria-label="Discover">${iconCompassNav()}</a>
        <a href="#/search" class="tabbar__item${activeBase === '/search' ? ' tabbar__item--active' : ''}" data-route="/search" aria-label="Search">${iconSearch()}</a>
      </nav>`;
  }
  // Left/right item counts (2 and 3) are deliberately uneven — with 5 real
  // destinations plus Log, an even split isn't possible, but Log itself
  // still needs to land dead centre regardless. Each side is its own
  // flex:1 group (see .tabbar__group), so the two groups always claim
  // equal width no matter how many items are inside them, and Log — sitting
  // between the two groups rather than as a sibling counted in either
  // one's spacing — is centred on the bar itself, not on the item list.
  // Before News existed there were only 4 real destinations (an even
  // 2-and-2 split either side of Log), so this same centring fell out for
  // free from plain space-around; adding a 5th destination broke that.
  const leftItems = [
    { route: '/feed', icon: iconHome(), label: 'Feed' },
    { route: '/search', icon: iconSearch(), label: 'Search' },
  ];
  const rightItems = [
    { route: '/news', icon: iconNewspaper(), label: 'News' },
    { route: '/messages', icon: iconMessage(), label: 'Messages' },
    { route: '/me', icon: iconUser(), label: 'Profile' },
  ];
  const navLink = (it) => `
    <a href="#${it.route}" class="tabbar__item${activeBase === it.route ? ' tabbar__item--active' : ''}" data-route="${it.route}">
      ${it.icon}
      <span>${it.label}</span>
    </a>`;
  return `
    <nav class="tabbar">
      <div class="tabbar__group">${leftItems.map(navLink).join('')}</div>
      <a href="#/log" class="tabbar__item tabbar__item--primary${activeBase === '/log' ? ' tabbar__item--active' : ''}" data-route="/log">
        ${iconBrandMark()}
        <span>Log</span>
      </a>
      <div class="tabbar__group">${rightItems.map(navLink).join('')}</div>
    </nav>`;
}
function iconAccountNav() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="8" r="3.7" stroke="currentColor" stroke-width="2.3"/>
    <path d="M4.3 20c1.3-3.6 3.7-5.7 6.6-6.2" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
    <rect x="14" y="14" width="7.5" height="6.5" rx="1.4" stroke="currentColor" stroke-width="2.1"/>
    <path d="M15.8 14v-1.6a1.95 1.95 0 0 1 3.9 0V14" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
  </svg>`;
}
function iconBrowseNav() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="7.7" height="7.7" rx="1.6" stroke="currentColor" stroke-width="2.3"/>
    <rect x="13.3" y="3" width="7.7" height="7.7" rx="1.6" stroke="currentColor" stroke-width="2.3"/>
    <rect x="3" y="13.3" width="7.7" height="7.7" rx="1.6" stroke="currentColor" stroke-width="2.3"/>
    <rect x="13.3" y="13.3" width="7.7" height="7.7" rx="1.6" stroke="currentColor" stroke-width="2.3"/>
  </svg>`;
}
function iconCompassNav() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="2.3"/>
    <path d="m15.3 8.7-4.2 2.8-2.1 4.1 4.2-2.8 2.1-4.1z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
  </svg>`;
}

// Three shapes, not one:
//  - home:  centred PLAYTHRUU wordmark, nothing else
//  - back:  back arrow + page title (sub-pages)
//  - plain: page title only, no wordmark — the wordmark repeating on
//           every tab was visual noise, so it now appears once, on home
export function topBar(title, { back = false, right = '', home = false } = {}) {
  if (home) {
    return `
      <header class="topbar topbar--home">
        <img src="icons/${getTheme() === 'light' ? 'mark-orange' : 'mark-blue'}.svg" alt="" class="topbar__mark">
        <span class="topbar__logo">PlayThruu</span>
      </header>`;
  }
  return `
    <header class="topbar">
      ${back ? `<button class="topbar__back" data-action="back" aria-label="Back">${iconBack()}</button>` : ''}
      <h1 class="topbar__title">${esc(title)}</h1>
      <div class="topbar__right">${right}</div>
    </header>`;
}

export function gameCard(game, { note } = {}) {
  return `
    <a class="game-card" href="#/game/${game.id}">
      ${posterFrame(game.cover_url, game.title, 'game-card__cover')}
      <div class="game-card__title">${esc(game.title)}</div>
      ${note ? `<div class="game-card__note">${esc(note)}</div>` : ''}
    </a>`;
}

export function gameGrid(games) {
  if (!games.length) return emptyState('No games here yet.');
  return `<div class="game-grid">${games.map(g => gameCard(g)).join('')}</div>`;
}

// Numbered, reorderable rows for a list's detail page — ranked #1, #2,
// #3... with up/down/remove controls when it's your own list, read-only
// (no controls, but numbering stays) when viewing someone else's.
export function rankedList(items, { isOwn = false } = {}) {
  if (!items.length) return emptyState('No games in this list yet.');
  return `<div class="ranked-list">
    ${items.map((item, i) => {
      const g = item.games;
      const meta = [g.release_year, g.platform].filter(Boolean).join(' · ');
      return `
        <div class="ranked-row" data-game-id="${g.id}">
          <div class="ranked-row__num">${i + 1}</div>
          <a href="#/game/${g.id}" class="ranked-row__link">
            ${posterFrame(g.cover_url, g.title, 'ranked-row__cover')}
            <div class="ranked-row__info">
              <div class="ranked-row__title">${esc(g.title)}</div>
              ${meta ? `<div class="ranked-row__meta">${esc(meta)}</div>` : ''}
            </div>
          </a>
          ${isOwn ? `
            <div class="ranked-row__controls">
              <button type="button" class="ranked-row__move" data-dir="up" data-idx="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${iconChevronUp()}</button>
              <button type="button" class="ranked-row__move" data-dir="down" data-idx="${i}" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">${iconChevronDown()}</button>
              <button type="button" class="ranked-row__remove" data-idx="${i}" aria-label="Remove from list">${iconClose()}</button>
            </div>` : ''}
        </div>`;
    }).join('')}
  </div>`;
}

// Renders search results that mix your own catalog (clickable, tagged
// data-kind="local") with not-yet-added IGDB results (data-kind="remote",
// rendered as buttons that import-then-select on click). Used by both
// the log modal and the search view so the two stay consistent.
// `capped` controls whether results are boxed into a short scrollable
// area (used by the pop-up "log a game" modal, which has limited height
// to work with) or flow naturally down the page (used by the full-page
// Search tab). Defaults to capped since the modal was the original caller.
// Takes ONE merged, relevance-ranked list (from searchGamesEverywhere),
// where each item carries `_source: 'local' | 'remote'`. Rendering the
// two interleaved by match quality — rather than every local game above
// every remote one — is what keeps the closest match to what was typed
// at the top regardless of whether it's already in the catalogue.
export function combinedGameResults(results, { capped = true } = {}) {
  if (!results.length) {
    return emptyState('No games found. Try a different spelling, or add it manually below.');
  }
  const html = results.map((g, i) => (g._source === 'remote'
    ? `<button type="button" class="game-card game-card--import" data-kind="remote" data-idx="${i}">
         ${posterFrame(g.cover_url, g.title, 'game-card__cover')}
         <div class="game-card__title">${esc(g.title)}</div>
         <div class="game-card__add-badge">+ Add</div>
       </button>`
    : `<a href="#" class="game-card" data-kind="local" data-idx="${i}">
         ${posterFrame(g.cover_url, g.title, 'game-card__cover')}
         <div class="game-card__title">${esc(g.title)}</div>
       </a>`)).join('');
  return `<div class="game-grid${capped ? ' game-grid--modal' : ''}">${html}</div>`;
}

// onLocal(game) fires immediately with the matching local row.
// onRemote(game) should import it (api.addGame) and return the new row;
// the button disables itself while that's in flight. Both look the item
// up in the single merged `results` array by index.
export function wireCombinedGameResults(container, results, { onLocal, onRemote }) {
  qsa('.result-row, .game-card', container).forEach((el) => {
    const idx = Number(el.dataset.idx);
    if (!Number.isInteger(idx)) return;
    const item = results[idx];
    if (!item) return;
    if (el.dataset.kind === 'remote') {
      el.addEventListener('click', async () => {
        el.disabled = true;
        try { await onRemote(item); } catch { el.disabled = false; }
      });
    } else {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await onLocal(item); } catch (err) { toast(err.message || 'Something went wrong.', 'error'); }
      });
    }
  });
}

// Vertical row layout for full-page search results (cover, title, year,
// platform, genre) — easier to scan than the grid, which the pop-up log
// modal still uses. Shares the same data-kind/data-idx markup convention
// as combinedGameResults, so wireCombinedGameResults works on this too.
export function combinedGameResultsList(results) {
  if (!results.length) {
    return emptyState('No games found. Try a different spelling, or add it manually below.');
  }
  const row = (g, i) => {
    const kind = g._source === 'remote' ? 'remote' : 'local';
    const meta = [g.release_year, g.platform, g.genre].filter(Boolean).join(' · ');
    const tag = kind === 'remote' ? `<span class="result-row__add-badge">+ Add</span>` : '';
    const El = kind === 'local' ? 'a' : 'button';
    const attrs = kind === 'local' ? `href="#"` : `type="button"`;
    return `
      <${El} ${attrs} class="result-row" data-kind="${kind}" data-idx="${i}">
        ${posterFrame(g.cover_url, g.title, 'result-row__cover')}
        <div class="result-row__info">
          <div class="result-row__title">${esc(g.title)}${tag}</div>
          ${meta ? `<div class="result-row__meta">${esc(meta)}</div>` : ''}
        </div>
      </${El}>`;
  };
  return `<div class="result-list">${results.map((g, i) => row(g, i)).join('')}</div>`;
}

export function logCard(log, { showAuthor = true, likeInfo = null, ownLog = false } = {}) {
  const game = log.games || {};
  const author = log.profiles || {};
  return `
    <article class="log-card" data-log-id="${log.id}">
      ${posterFrame(game.cover_url, game.title, 'log-card__cover', { tag: 'a', href: `#/game/${game.id}` })}
      <div class="log-card__body">
        <div class="log-card__head">
          <a href="#/game/${game.id}" class="log-card__title">${esc(game.title)}</a>
          ${statusStamp(log.status)}
        </div>
        ${showAuthor ? `
          <a href="#/profile/${esc(author.username)}" class="log-card__author">
            ${avatarImg(author, 20)}<span>${esc(author.display_name || author.username)}</span>
          </a>` : ''}
        <div class="log-card__meta">
          ${log.rating ? starRow(log.rating) : '<span class="log-card__unrated">Not rated</span>'}
          ${log.is_replay ? '<span class="log-card__replay">↻ replay</span>' : ''}
          ${log.played_date ? `<span class="log-card__date">${formatDate(log.played_date)}</span>` : ''}
        </div>
        ${log.review ? (log.contains_spoilers
          ? `<button type="button" class="log-card__review log-card__review--spoiler" data-spoiler>
               <span class="spoiler-tag">SPOILERS</span>
               <span class="spoiler-veil">Tap to reveal</span>
               <span class="spoiler-text">${esc(log.review)}</span>
             </button>`
          : `<p class="log-card__review">${esc(log.review)}</p>`) : ''}
        <div class="log-card__footer">
          <span class="log-card__time">${timeAgo(log.created_at)}</span>
          ${likeInfo ? likeButton(log.id, likeInfo) : ''}
          ${ownLog ? `<button class="log-card__edit" data-action="edit-log" data-log-id="${log.id}">Edit</button>` : ''}
          ${!ownLog ? `<button class="log-card__report" data-action="report-log" data-log-id="${log.id}" aria-label="Report this review" title="Report this review">${iconFlag()}</button>` : ''}
        </div>
      </div>
    </article>`;
}

// Horizontal scrolling strip for "What's the World Playing" — visually
// distinct from the search results grid since this is curated/editorial,
// not something the person searched for themselves.
export function trendingStrip(games) {
  if (!games.length) return '';
  return `<div class="trending-strip">${games.map((g, i) => `
    <button type="button" class="trending-card" data-idx="${i}">
      ${posterFrame(g.cover_url, g.title, 'trending-card__cover')}
    </button>`).join('')}</div>`;
}

export function wireTrendingStrip(container, games, { onSelect }) {
  qsa('.trending-card', container).forEach((el) => {
    el.addEventListener('click', async () => {
      el.disabled = true;
      try {
        await onSelect(games[Number(el.dataset.idx)]);
      } finally {
        el.disabled = false;
      }
    });
  });
}

// Shared "who + rating" footer under a feed poster, so Friend's recent
// activity and Currently playing read identically. `rating` is optional.
//
// The stars line is ALWAYS rendered (empty when there's no rating), not
// conditionally omitted — omitting it entirely made the footer one line
// tall for an unrated entry and two lines for a rated one, so cards in
// the same horizontal strip ended up different heights and the posters
// above them drifted out of alignment with each other. An empty span
// still reserves its line height via CSS, so every card is now the same
// height regardless of what data it has.
function cardWho(profile, rating) {
  return `
    <a href="#/profile/${esc(profile.username)}" class="card-who">
      ${avatarImg(profile, 24)}
      <span class="card-who__meta">
        <span class="card-who__name">${esc(profile.display_name || profile.username)}</span>
        <span class="card-who__stars">${rating ? starRow(rating, { size: 11 }) : ''}</span>
      </span>
    </a>`;
}

// A friend's completed game. The poster opens that log's OWN review page
// (their status/rating/write-up), not the game page — the whole entry is
// the review. Their rating shows under it when they gave one; nothing is
// shown when they didn't (no "logged" filler).
export function friendsPlayingCard(entry) {
  const g = entry.game || {};
  const f = entry.friend || {};
  return `
    <div class="friend-card">
      <a href="#/review/${entry.logId}" class="friend-card__poster" aria-label="Open ${esc(f.display_name || f.username)}'s log of ${esc(g.title)}">
        ${posterFrame(g.cover_url, g.title, 'friend-card__cover')}
      </a>
      ${cardWho(f, entry.rating)}
    </div>`;
}

// Currently playing — poster plus who's on it, styled exactly like the
// friend-activity footer above.
export function activityCard(log) {
  const g = log.games || {};
  const a = log.profiles || {};
  return `
    <div class="activity-card">
      <a href="#/game/${g.id}" class="activity-card__poster">
        ${posterFrame(g.cover_url, g.title, 'activity-card__cover')}
      </a>
      ${cardWho(a, null)}
    </div>`;
}

export function likeButton(logId, { count, liked }) {
  return `
    <button class="like-btn${liked ? ' like-btn--liked' : ''}" data-action="toggle-like" data-log-id="${logId}" aria-pressed="${liked}">
      ${iconHeart()} <span>${count > 0 ? count : ''}</span>
    </button>`;
}

export function avatarImg(profile, size = 32) {
  if (profile?.avatar_url) {
    return `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(profile.avatar_url)}" alt="${esc(profile.username)}">`;
  }
  return `<span class="avatar avatar--fallback" style="width:${size}px;height:${size}px;font-size:${size * 0.4}px">${esc(initials(profile?.display_name || profile?.username))}</span>`;
}

// `following` (true/false) shows a compact follow-toggle icon button on
// the row. Pass `undefined` (the default) to show no follow button at
// all — e.g. when rendering the current user's own row in a list.
export function profileRow(profile, { rightSlot = '', following } = {}) {
  const followBtn = following === undefined ? '' : `
    <button type="button" class="follow-icon-btn${following ? ' follow-icon-btn--active' : ''}"
      data-action="toggle-follow" data-user-id="${esc(profile.id)}" data-following="${following}"
      aria-label="${following ? 'Unfollow' : 'Follow'} ${esc(profile.username)}" title="${following ? 'Following' : 'Follow'}">
      ${following ? iconUserCheck() : iconUserPlus()}
    </button>`;
  return `
    <div class="profile-row">
      <a href="#/profile/${esc(profile.username)}" class="profile-row__link">
        ${avatarImg(profile, 40)}
        <div class="profile-row__names">
          <div class="profile-row__display">${esc(profile.display_name || profile.username)}</div>
          <div class="profile-row__username">@${esc(profile.username)}</div>
        </div>
      </a>
      ${followBtn || rightSlot}
    </div>`;
}

// Wires up every [data-action="toggle-follow"] button inside `container`.
// currentUserId is used to skip rendering-time only — the actual guard
// against following yourself lives wherever rows get built, since your
// own id should never reach here with a follow button attached.
export function wireFollowButtons(container, { onToggle }) {
  qsa('[data-action="toggle-follow"]', container).forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const userId = btn.dataset.userId;
      const wasFollowing = btn.dataset.following === 'true';
      btn.disabled = true;
      try {
        await onToggle(userId, wasFollowing);
        tapFeedback();
        const nowFollowing = !wasFollowing;
        btn.dataset.following = String(nowFollowing);
        btn.classList.toggle('follow-icon-btn--active', nowFollowing);
        btn.title = nowFollowing ? 'Following' : 'Follow';
        btn.innerHTML = nowFollowing ? iconUserCheck() : iconUserPlus();
      } catch {
        // onToggle already surfaces its own error toast
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// The 5-game showcase on a profile: favorites if set, else recent
// completions. `slots` is an array of up to 5 { game, rating, reviewed }
// objects — `rating`/`reviewed` are omitted for a favorited game that
// was never actually logged, so it just shows as bare poster art.
export function showcaseGrid(slots) {
  // Only renders the games that actually exist. It used to always emit
  // five cells and pad the remainder with empty dashed boxes, so a
  // profile with two favourites showed two posters and three visible
  // gaps. The column count is handed to CSS instead, which sizes the
  // posters to fill the row — four games fill the width as four, two
  // fill it as two.
  const filled = slots.filter(Boolean).slice(0, SHOWCASE_MAX);
  if (!filled.length) return '';
  // Bare poster art only — no rating shown beneath (a favourite is a
  // favourite; what they scored it isn't the point here).
  const cells = filled.map((s) => `
      <a href="#/game/${s.game.id}" class="showcase-slot">
        ${posterFrame(s.game.cover_url, s.game.title, 'showcase-slot__cover')}
      </a>`);
  // A single horizontal row of the top picks.
  return `<div class="showcase-grid" style="--showcase-count:${filled.length}">${cells.join('')}</div>`;
}

// Top 3 — a clean horizontal row, big enough to read each cover.
export const SHOWCASE_MAX = 3;

// One card in the redesigned Lists index — a poster collage of the first
// few games, the list name, and a count. Works off the shape returned by
// api.getListsForUser (list_items: [{ position, games: { cover_url } }]).
export function listCard(list) {
  const items = (list.list_items || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const count = items.length;
  const covers = items.map((it) => it.games?.cover_url).filter(Boolean).slice(0, 4);
  const collage = covers.length
    ? `<div class="list-card__collage" data-n="${covers.length}">
         ${covers.map((c) => `<img src="${esc(c)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`).join('')}
       </div>`
    : `<div class="list-card__collage list-card__collage--empty">${iconList()}</div>`;
  return `
    <a href="#/list/${list.id}" class="list-card">
      ${collage}
      <div class="list-card__body">
        <div class="list-card__name">${esc(list.name)}</div>
        <div class="list-card__meta">${count} game${count === 1 ? '' : 's'}${list.is_public ? '' : ' · private'}</div>
      </div>
      <span class="list-card__chev" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
      </span>
    </a>`;
}

// Vertical list of horizontal bars, one row per half-star value 0.5..5 —
// `counts` is the object shape returned by api.getRatingBreakdown.
// "0.5" -> "½", "1.5" -> "1½", "3.0" -> "3". The old version printed a
// bare "½" for every half value, so 1.5, 2.5, 3.5 and 4.5 all rendered
// identically and the axis read ½ 1 ½ 2 ½ 3 ...
function formatHalfStar(v) {
  const n = Number(v);
  const whole = Math.floor(n);
  const isHalf = n % 1 !== 0;
  if (!isHalf) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

export function ratingHistogram(counts, { average = null, total = 0 } = {}) {
  const values = [];
  for (let v = 0.5; v <= 5; v += 0.5) values.push(v.toFixed(1));
  const max = Math.max(1, ...values.map((v) => counts[v] || 0));

  // With no ratings at all, every bar sits at the same floor height and
  // the panel reads as a broken row of dashes. Better to say plainly
  // that nothing's rated yet than to draw an empty chart.
  if (!total) {
    return `
      <div class="rating-histogram rating-histogram--empty">
        <p class="rating-histogram__empty">No ratings yet — be the first.</p>
      </div>`;
  }

  return `
    <div class="rating-histogram">
      <div class="rating-histogram__summary">
        <div class="rating-histogram__avg">
          <b>${average ? Number(average).toFixed(1) : '—'}</b>
          ${average ? starRow(average, { size: 13 }) : ''}
        </div>
        <span class="rating-histogram__total">${total} rating${total === 1 ? '' : 's'}</span>
      </div>
      <div class="rating-histogram__bars">
        ${values.map((v) => {
          const n = counts[v] || 0;
          // Zero-count columns stay visibly empty rather than being
          // floored to a stub, so the shape of the distribution is real.
          const pct = n === 0 ? 0 : Math.max(8, Math.round((n / max) * 100));
          return `
            <button type="button" class="rating-histogram__bar${n === 0 ? ' is-zero' : ''}" data-value="${v}" data-count="${n}" style="--bar-pct:${pct}%" aria-label="${formatHalfStar(v)} stars, ${n} rating${n === 1 ? '' : 's'}">
              <span class="rating-histogram__bar-count">${n}</span>
              <span class="rating-histogram__bar-track"><span class="rating-histogram__bar-fill"></span></span>
            </button>`;
        }).join('')}
      </div>
      <div class="rating-histogram__axis">
        <span>${'★'}</span>
        <span>${'★★★★★'}</span>
      </div>
    </div>`;
}

// Press-and-hold a bar to reveal its exact count while held, hides
// again on release — not a tap-toggle, and not a review filter.
export function wireRatingHistogram(container) {
  qsa('.rating-histogram__bar', container).forEach((bar) => {
    const show = () => bar.classList.add('rating-histogram__bar--active');
    const hide = () => bar.classList.remove('rating-histogram__bar--active');
    bar.addEventListener('pointerdown', show);
    bar.addEventListener('pointerup', hide);
    bar.addEventListener('pointerleave', hide);
    bar.addEventListener('pointercancel', hide);
  });
}

export function emptyState(message, { actionLabel, actionRoute, icon } = {}) {
  return `
    <div class="empty-state">
      ${icon || iconStamp()}
      <p>${esc(message)}</p>
      ${actionLabel ? `<a class="btn btn--accent" href="#${actionRoute}">${esc(actionLabel)}</a>` : ''}
    </div>`;
}

// The brand mark itself, animated — the "u" loader instead of a generic
// ring, so "loading" reads as Playthruu everywhere it shows up (game
// pages, tab switches, every spinner in the app goes through this one
// function). Each loader SVG animates on its own (the chase is a
// stroke-dashoffset keyframe baked into the file's own <style>), so
// this just has to pick the right file for the theme — cream track +
// orange chase on light, light track + blue chase on dark.
export function spinner() {
  const file = getTheme() === 'light' ? 'thruu-loader-cream.svg' : 'thruu-loader-blue.svg';
  return `
    <span class="spinner" role="status" aria-label="Loading">
      <img src="icons/${file}" width="100%" height="100%" alt="" aria-hidden="true">
    </span>`;
}

// Skeletons instead of spinners wherever the shape of the incoming
// content is already known — the layout doesn't jump when data lands,
// and the wait reads as shorter even when it isn't.
export function skeletonRow(count = 5) {
  return `<div class="trending-strip" aria-hidden="true">${
    Array.from({ length: count }, () => `<div class="skeleton skeleton--poster"></div>`).join('')
  }</div>`;
}

export function skeletonList(count = 4) {
  return `<div class="skeleton-list" aria-hidden="true">${
    Array.from({ length: count }, () => `
      <div class="skeleton-list__row">
        <div class="skeleton skeleton--thumb"></div>
        <div class="skeleton-list__lines">
          <div class="skeleton skeleton--line" style="width:62%"></div>
          <div class="skeleton skeleton--line skeleton--line-sm" style="width:38%"></div>
        </div>
      </div>`).join('')
  }</div>`;
}

// ---- icons (inline SVG, currentColor, no external requests) ----
export function iconHome() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 11.5 12 4l8 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
export function iconNewspaper() { return `<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="13" height="14" rx="1.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16.5 9h2.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 9.5h5M7 12.5h5M7 15.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`; }
export function iconSearch() { return `<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="m20 20-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`; }
export function iconFilter() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M7 12h10M10.5 18h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`; }
export function iconList() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/></svg>`; }
export function iconUser() { return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="2"/><path d="M4.5 20c1.4-4 4.2-6 7.5-6s6.1 2 7.5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`; }
export function iconDiary() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H17a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6.5A1.5 1.5 0 0 1 5 19.5v-15z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 3v18" stroke="currentColor" stroke-width="2"/><path d="M12 8h4M12 11.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`; }
export function iconFlame() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5c1 3-3.5 4.6-3.5 8.5a3.5 3.5 0 0 0 7 0c0-1.4-.7-2.3-1.2-3 .8 3-2.3 3.6-2.3 3.6"/><path d="M8.2 12.5A5 5 0 0 0 12 21a5 5 0 0 0 4.8-6.4c-.5 1.6-1.8 2.4-1.8 2.4"/></svg>`; }
export function iconStamp() { return `<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="4" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="2"/><path d="M9 14v3M15 14v3M6 20h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 8h6M9 11h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`; }
export function iconTag() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><path d="M11.5 3.5h6a2 2 0 0 1 2 2v6a1 1 0 0 1-.3.7l-8.5 8.5a1 1 0 0 1-1.4 0l-6.5-6.5a1 1 0 0 1 0-1.4l8.5-8.5a1 1 0 0 1 .7-.3z"/><circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>`; }
export function iconStar() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3.3l2.6 5.5 5.9.8-4.3 4.2 1 6-5.2-2.9-5.2 2.9 1-6-4.3-4.2 5.9-.8z"/></svg>`; }
export function iconTrophy() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5h10v5a5 5 0 0 1-10 0v-5z"/><path d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5 3.5 3.5 0 0 0 6.5 11H7M17 6h2.5A1.5 1.5 0 0 1 21 7.5 3.5 3.5 0 0 1 17.5 11H17"/><path d="M12 14.5v3.5M9 21h6M9.5 18h5"/></svg>`; }
export function iconSparkle() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11.3 3.5c.4 3.4 1.3 4.3 4.7 4.7-3.4.4-4.3 1.3-4.7 4.7-.4-3.4-1.3-4.3-4.7-4.7 3.4-.4 4.3-1.3 4.7-4.7z"/><path d="M17.8 13.5c.25 2 .75 2.5 2.7 2.75-1.95.25-2.45.75-2.7 2.75-.25-2-.75-2.5-2.7-2.75 1.95-.25 2.45-.75 2.7-2.75z"/></svg>`; }
// Open journal with a quill — the centre "Log" action. Drawn in the same
// 24x24 stroke language as the rest of the set so it doesn't read as a
// pasted-in graphic: the right-hand page stops short where the feather
// crosses it, which is what makes the two shapes look like one scene
// rather than two icons stacked on top of each other.
// The middle tab bar button IS the brand mark rather than a generic
// "add" glyph — same notched-circle path as the app icon and
// components/BrandMark.tsx on the website. Filled with currentColor
// (not stroked, like the outline-style nav icons around it) since the
// mark is a solid shape.
export function iconBrandMark() {
  return `<svg viewBox="0 0 120 120" fill="none">
    <path fill="currentColor" d="M 113.4045,52 A 54,54 0 1,0 113.4045,68 L 64,68 A 8,8 0 0,1 64,52 Z"/>
  </svg>`;
}
export function iconBack() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
export function iconGamepad() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><path d="M6.5 8.5h11a4 4 0 0 1 3.9 3.1l.9 4A2.4 2.4 0 0 1 19 18.4l-2-2.4H7l-2 2.4a2.4 2.4 0 0 1-4.2-2.8l.9-4A4 4 0 0 1 6.5 8.5z"/><path d="M7.5 11.6v2.3M6.35 12.75h2.3"/><circle cx="15.6" cy="12" r="1.05" fill="currentColor" stroke="none"/><circle cx="17.8" cy="14" r="1.05" fill="currentColor" stroke="none"/></svg>`; }
export function iconBookmark() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><path d="M6 3.8h12a1 1 0 0 1 1 1V20.5l-7-4.1-7 4.1V4.8a1 1 0 0 1 1-1z"/></svg>`; }
export function iconHeart() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><path d="M12 20.3 4.3 12.6A4.7 4.7 0 0 1 11 6l1 1 1-1a4.7 4.7 0 0 1 6.7 6.6z"/></svg>`; }
export function iconClose() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`; }
export function iconChevronUp() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M5 15l7-7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
export function iconChevronDown() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M5 9l7 7 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
export function iconPlus() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`; }
export function iconCalendar() { return `<svg viewBox="0 0 24 24" fill="none" class="date-input-wrap__icon"><rect x="4" y="5.5" width="16" height="15" rx="2.5" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M8 3.5v3M16 3.5v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`; }
export function iconSettings() { return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`; }
export function iconShare() { return `<svg viewBox="0 0 24 24" fill="none"><circle cx="18" cy="5" r="2.5" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="2.5" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="19" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M8.2 10.7l7.6-4.4M8.2 13.3l7.6 4.4" stroke="currentColor" stroke-width="1.8"/></svg>`; }
export function iconQr() { return `<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M14 14h2.7v2.7H14zM19 14h1.5v1.5H19zM14 19h1.5v1.5H14zM17.5 17.5h3v3h-3z" fill="currentColor"/></svg>`; }
export function iconNote() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M6 3.5h9l4 4V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 10h6M9 13.5h6M9 17h3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`; }
export function iconCamera() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h1.9l1-1.6h7.2l1 1.6h1.9A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V8.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.4" stroke="currentColor" stroke-width="1.8"/></svg>`; }
export function iconDrag() { return `<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/></svg>`; }
export function iconUserPlus() { return `<svg viewBox="0 0 24 24" fill="none"><circle cx="9.5" cy="8" r="3.5" stroke="currentColor" stroke-width="2"/><path d="M2.5 20c1.3-3.8 3.9-5.7 7-5.7s5.7 1.9 7 5.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 7.5v5M16 10h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`; }
export function iconUserCheck() { return `<svg viewBox="0 0 24 24" fill="none"><circle cx="9.5" cy="8" r="3.5" stroke="currentColor" stroke-width="2"/><path d="M2.5 20c1.3-3.8 3.9-5.7 7-5.7s5.7 1.9 7 5.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 11.5l2 2 4-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
export function iconLock() { return `<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`; }
export function iconMail() { return `<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M4.5 7l7.5 6 7.5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
export function iconEye() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="2"/></svg>`; }
// The Messages nav tab, and the empty-state icon on the inbox itself —
// a plain speech bubble, same stroke language as the rest of the set.
export function iconMessage() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-7z"/></svg>`; }
export function iconSend() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12 20 4.5 15 19.5l-3.4-6.8L4.5 12z"/><path d="M11.6 12.7 15 19.5"/></svg>`; }
export function iconTrash() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/><path d="M10 11v6M14 11v6"/></svg>`; }
export function iconDotsMenu() { return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5.5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="18.5" r="1.8"/></svg>`; }
export function iconGif() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="3"/><text x="12" y="14.8" font-family="Arial, sans-serif" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle">GIF</text></svg>`; }
export function iconReply() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8 4 12l5 4"/><path d="M4 12h9a6.5 6.5 0 0 1 6.5 6.5v.5"/></svg>`; }
export function iconInfo() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none"/></svg>`; }
export function iconCopy() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>`; }

export function iconEyeOff() { return `<svg viewBox="0 0 24 24" fill="none"><path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.6 6.1c.45-.06.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-3.3 4.1M6.3 7.5A15.6 15.6 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.3 0 2.5-.3 3.5-.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.9 10.1a2.8 2.8 0 0 0 3.9 3.9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`; }

// ------------------------------------------------------------
// MODERATION UI — report sheet and block confirmation
// ------------------------------------------------------------

export function iconFlag() {
  return `<svg viewBox="0 0 24 24" fill="none"><path d="M5 21V4.5c3.5-1.6 6.5 1.6 10 0v9c-3.5 1.6-6.5-1.6-10 0" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
export function iconBlock() {
  return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.9"/><path d="M6.2 6.2l11.6 11.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
}

// Reasons are a fixed list rather than free text alone: a structured
// value is what makes a report queue triageable later, and it means
// someone reporting abuse doesn't have to describe it to send it.
const REPORT_REASONS = [
  'Spam or advertising',
  'Harassment or hate',
  'Sexual or graphic content',
  'Spoilers without warning',
  'Wrong or misleading game info',
  'Something else',
];

// `targetType` must be one of the values the reports table's CHECK
// constraint allows: log | game | profile | list.
export function openReportSheet({ targetType, targetId, subject = '', onSubmit }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <header class="modal__header">
        <h2>Report ${esc(targetType)}</h2>
        <button class="modal__close" data-close aria-label="Close">${iconClose()}</button>
      </header>
      <div class="modal__body">
        ${subject ? `<p class="muted report-sheet__subject">${esc(subject)}</p>` : ''}
        <div class="report-reasons">
          ${REPORT_REASONS.map((r, i) => `
            <label class="report-reason">
              <input type="radio" name="report-reason" value="${esc(r)}"${i === 0 ? ' checked' : ''}>
              <span>${esc(r)}</span>
            </label>`).join('')}
        </div>
        <label class="field">
          <span>Anything else? <span class="muted">(optional)</span></span>
          <textarea id="report-detail" rows="3" maxlength="400" placeholder="Add context that would help us review this."></textarea>
        </label>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" data-close>Cancel</button>
          <button type="button" class="btn btn--danger" id="report-submit">Send report</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  qsa('[data-close]', overlay).forEach((b) => b.addEventListener('click', close));
  enableSwipeToDismiss(qs('.modal', overlay), close);

  qs('#report-submit', overlay).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const reason = qs('input[name="report-reason"]:checked', overlay)?.value || 'Something else';
    const detail = qs('#report-detail', overlay).value.trim();
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await onSubmit({ targetType, targetId, reason: detail ? `${reason} — ${detail}` : reason });
      close();
      toast('Report sent. Thanks for flagging it.', 'success');
    } catch (err) {
      toast(err.message || 'Could not send that report.', 'error');
      btn.disabled = false;
      btn.textContent = 'Send report';
    }
  });
}

// Prompts a social sign-in to replace the placeholder username the
// signup trigger generated for them (see handle_new_user in schema.sql,
// which falls back to "player_" + a fragment of the user id when the
// provider supplies no username of its own).
//
// Deliberately not dismissable by tapping the backdrop: leaving with a
// placeholder name is the outcome this exists to prevent. There is a
// skip, but it has to be chosen.
export function openUsernameClaim({ suggested = '', onCheck, onSave }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <header class="modal__header">
        <h2>Pick your username</h2>
      </header>
      <div class="modal__body">
        <p class="muted">This is how people will find you. You can change it later in Settings.</p>
        <label class="field">
          <span>Username</span>
          <input type="text" id="claim-username" maxlength="20" autocomplete="off"
                 spellcheck="false" placeholder="yourusername" value="${esc(suggested)}">
        </label>
        <p class="claim-status" id="claim-status"></p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="claim-skip">Not now</button>
          <button type="button" class="btn btn--accent" id="claim-save">Save</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const input = qs('#claim-username', overlay);
  const status = qs('#claim-status', overlay);
  const saveBtn = qs('#claim-save', overlay);
  const close = () => { overlay.remove(); document.body.style.overflow = ''; };

  // Mirrors the CHECK constraint on profiles.username, so the same rule
  // is enforced here as in the database rather than only being
  // discovered when the save fails.
  const VALID = /^[a-z0-9._]{1,20}$/;
  const normalise = (v) => v.trim().toLowerCase();

  function validate(v) {
    if (!v) return 'Pick something.';
    if (!VALID.test(v)) return 'Letters, numbers, periods and underscores only.';
    if (v.startsWith('.') || v.endsWith('.') || v.includes('..')) return 'No leading, trailing or double periods.';
    return null;
  }

  let checkTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(checkTimer);
    const v = normalise(input.value);
    const problem = validate(v);
    if (problem) { status.textContent = problem; status.className = 'claim-status claim-status--bad'; return; }
    status.textContent = 'Checking…';
    status.className = 'claim-status';
    checkTimer = setTimeout(async () => {
      try {
        const free = await onCheck(v);
        status.textContent = free ? 'Available.' : 'Already taken.';
        status.className = `claim-status claim-status--${free ? 'ok' : 'bad'}`;
      } catch {
        status.textContent = '';
      }
    }, 350);
  });

  saveBtn.addEventListener('click', async () => {
    const v = normalise(input.value);
    const problem = validate(v);
    if (problem) { status.textContent = problem; status.className = 'claim-status claim-status--bad'; return; }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await onSave(v);
      close();
      toast('Username set.', 'success');
    } catch (err) {
      status.textContent = err.message || 'That username could not be saved.';
      status.className = 'claim-status claim-status--bad';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  qs('#claim-skip', overlay).addEventListener('click', close);
  setTimeout(() => input.focus(), 50);
}
