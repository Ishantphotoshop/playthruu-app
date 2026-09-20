import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, spinner, emptyState, posterFrame, iconStamp, gameHref } from '../components.js';
import { qs, qsa, esc, toast } from '../utils.js';
import { navigate } from '../router.js';
import { getCached, setCached, CACHE_KEYS } from '../cache.js';

// See friends-playing-view.js's comment — same idea, "see more" from
// the feed's own capped strip, into everything instead, wrapped into a
// grid rather than one long horizontal scroll. Same .trending-card
// markup trendingStrip() itself uses, just laid out in .card-grid
// instead of .trending-strip's own wrapper.
//
// Two things made this screen the slowest in the app. It asked for 60
// games over a 10-day window, which is a wide IGDB query AND a window
// narrow enough that IGDB often has to reach a long way back to fill
// it; and it held a blank spinner for the whole round-trip on every
// single visit, with nothing cached in between. It now paints the last
// result instantly and refreshes underneath, the same pattern the Feed,
// Messages and Search tabs already use, over a 30-day window that is
// both the usual definition of "trending" and markedly cheaper.
const GRID_LIMIT = 36;

export async function renderTrendingView(root) {
  root.innerHTML = topBar('Trending now', { back: true, brand: true }) +
    `<div class="view-body" id="trending-body">${spinner()}</div>` + navBar('');
  const body = qs('#trending-body', root);

  let games = [];

  function paint() {
    if (!games.length) {
      body.innerHTML = emptyState("Nothing trending right now.", { icon: iconStamp() });
      return;
    }
    // An <a> with a real href, not a button: these are navigations, so
    // they should behave like links (open in a new tab, show a target on
    // long-press) and work before the JS below has wired anything up.
    // gameHref sends a not-yet-catalogued game to its live IGDB page
    // rather than to /game/undefined.
    body.innerHTML = `<div class="card-grid">${games.map((g, i) => `
      <a href="${gameHref(g)}" class="trending-card" data-idx="${i}" aria-label="${esc(g.title)}">
        ${posterFrame(g.cover_url, g.title, 'trending-card__cover')}
      </a>`).join('')}</div>`;
    wire();
  }

  // Signed in, a tap still adds the game to the catalogue first so it
  // lands on a real page it can be logged from — the href is the
  // fallback, not the whole behaviour.
  function wire() {
    qsa('.trending-card', body).forEach((el) => {
      el.addEventListener('click', async (e) => {
        const g = games[Number(el.dataset.idx)];
        if (!g || !state.user || g.id) return; // already catalogued: let the href do it
        e.preventDefault();
        el.style.pointerEvents = 'none';
        try {
          const saved = await api.addGame(g, state.user.id);
          navigate(`/game/${saved.id}`);
        } catch (err) {
          toast(err.message || 'Could not open that game.', 'error');
          el.style.pointerEvents = '';
        }
      });
    });
  }

  const cached = getCached(CACHE_KEYS.trendingPage);
  if (cached?.length) { games = cached; paint(); }

  try {
    const fresh = await api.getWorldTrending(GRID_LIMIT, 30);
    if (!qs('#trending-body', root)) return; // navigated away mid-flight
    setCached(CACHE_KEYS.trendingPage, fresh);
    games = fresh;
    paint();
  } catch (err) {
    // Something already on screen from cache beats replacing it with an
    // error for a refresh nobody asked for.
    if (!games.length && qs('#trending-body', root)) {
      body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this right now: ${esc(err.message)}</p>`;
    }
  }
}
