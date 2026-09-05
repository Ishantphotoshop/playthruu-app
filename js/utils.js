// Shared helpers used across views.

// Escape user-generated text before it goes into innerHTML.
// Every piece of user content (usernames, reviews, bios, game titles)
// MUST pass through this before being inlined into a template string.
export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Renders a row of stars (supports halves) for a rating 0.5–5.
// interactive=true wires up click/tap handlers via data attributes and
// lets the caller read the chosen value from the DOM — that picker
// needs all 5 stars rendered regardless of the current value, since an
// empty star past the current rating is the only thing there is to tap
// to raise it. Every other call site is a read-only display of a
// rating that already exists, so those stop at the last star that
// actually has something to show (full or half) — a plain display
// isn't a fixed "X out of 5" scale, so trailing empty stars there were
// just visual noise, not information.
export function starRow(rating, { interactive = false, size = 18 } = {}) {
  const r = Number(rating) || 0;
  const count = interactive ? 5 : Math.ceil(r);
  let html = `<span class="stars${interactive ? ' stars--interactive' : ''}" style="--star-size:${size}px" data-rating="${r}">`;
  for (let i = 1; i <= count; i++) {
    const fill = r >= i ? 'full' : r >= i - 0.5 ? 'half' : 'empty';
    html += `<span class="star star--${fill}" data-star="${i}" aria-hidden="true"></span>`;
  }
  html += `</span>`;
  return html;
}

export function statusStamp(status) {
  const labels = {
    played: 'PLAYED',
    playing: 'PLAYING',
    backlog: 'BACKLOG',
    dropped: 'DROPPED',
  };
  const label = labels[status] || status.toUpperCase();
  return `<span class="stamp stamp--${esc(status)}">${esc(label)}</span>`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeAgo(dateStr) {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then) / 1000;
  const units = [
    ['year', 31536000], ['month', 2592000], ['week', 604800],
    ['day', 86400], ['hour', 3600], ['minute', 60],
  ];
  for (const [name, secs] of units) {
    const val = Math.floor(diff / secs);
    if (val >= 1) return `${val}${name[0]}`;
  }
  return 'now';
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function initials(name) {
  if (!name) return '?';
  return name.trim().slice(0, 2).toUpperCase();
}

let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast toast--${kind} toast--visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast--visible'), 2600);
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function placeholderCover(title) {
  // Deterministic little gradient placeholder for games without cover art.
  const hue = Math.abs([...String(title || '?')].reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="hsl(${hue},35%,18%)"/><rect width="300" height="450" fill="hsl(${(hue+40)%360},45%,12%)" opacity="0.5" transform="rotate(20 150 225)"/></svg>`
  )}`;
}

// IGDB serves every image at a set of fixed sizes, chosen by the
// `/t_<size>/` segment of the URL — so the same cover can be asked for
// at 1080p or at thumbnail size just by rewriting that one segment. We
// store the biggest version on the row (see igdbImageUrl in api.js) and
// step it back down here per context: a poster in a 100px-wide grid
// tile doesn't need a 1080p download, and the blurred backdrop layer
// behind it needs even less than that. Non-IGDB covers (RAWG) have no
// such size templating and are returned untouched.
export function igdbSized(url, size) {
  if (!url || !url.includes('images.igdb.com')) return url;
  return url.replace(/\/t_[a-z0-9_]+\//i, `/t_${size}/`);
}

// Lets a bottom-sheet modal be dragged down and flung away with a
// finger, instead of only closing via the X. Pass the `.modal` element
// and its existing close function.
//
// The gesture is bound to the sheet's HEADER (the grabber row), and the
// header is given `touch-action: none` — that's the crucial bit: without
// it the browser claims the vertical drag for scrolling and never sends
// us the pointermove events, which is why the first version did nothing
// on the phone. Dragging elsewhere (the scrollable body) is untouched,
// and a plain tap on a header control still clicks because we only take
// over once the finger has actually moved down a few pixels.
//
// `onDrag`, if passed, fires on every pointermove with the drag's
// progress toward the dismiss threshold (0 = not dragged, 1 = at/past
// THRESHOLD), and again with exactly 0 once the sheet springs back to
// rest (so a caller tying some other effect to the drag — e.g. easing
// off a background blur as the sheet comes down — can reset cleanly
// instead of being left stuck mid-fade).
export function enableSwipeToDismiss(modal, close, onDrag) {
  if (!modal) return;
  const header = modal.querySelector('.modal__header, .log-sheet__head, header');
  if (!header) return;
  header.style.touchAction = 'none';
  header.style.cursor = 'grab';

  const THRESHOLD = 90; // drag past this (px) to dismiss
  let startY = 0, dy = 0, candidate = false, dragging = false;
  const overlay = () => modal.parentElement;

  // Mouse used to be filtered out here ("touch affordance only") on the
  // assumption this gesture would only ever be tested on a real
  // touchscreen — but the header's own cursor:grab above already
  // promises a draggable mouse affordance, and on desktop (e.g. testing
  // in a plain browser window, no touch emulation) that promise went
  // nowhere: pointerdown fired, immediately returned, and nothing ever
  // dragged. Pointer events already unify mouse/pen/touch, so the exact
  // same listeners below now just work for all three.
  header.addEventListener('pointerdown', (e) => {
    startY = e.clientY; dy = 0; candidate = true; dragging = false;
  });

  header.addEventListener('pointermove', (e) => {
    if (!candidate) return;
    dy = e.clientY - startY;
    if (!dragging) {
      if (dy > 5) {
        dragging = true;
        header.style.cursor = 'grabbing';
        try { header.setPointerCapture(e.pointerId); } catch { /* fine */ }
      } else return;
    }
    if (dy < 0) dy = 0;
    modal.style.transition = 'none';
    modal.style.transform = `translateY(${dy}px)`;
    const ov = overlay();
    if (ov) ov.style.opacity = String(Math.max(0.25, 1 - dy / 420));
    // Deliberately NOT tied to THRESHOLD (90px, the dismiss trigger) —
    // that reaches 1 almost immediately and then sits there for the
    // rest of a longer drag, so the blur looked like it snapped to nil
    // instead of easing out with the finger. Spread over the same
    // longer range as the overlay fade above so it tracks the whole
    // visible gesture.
    if (onDrag) onDrag(Math.min(1, dy / 420));
  });

  const settle = (e) => {
    if (!candidate) return;
    const wasDragging = dragging;
    candidate = false; dragging = false;
    header.style.cursor = 'grab';
    try { header.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!wasDragging) return; // it was a tap, not a drag — leave it alone
    const ov = overlay();
    if (dy > THRESHOLD) {
      modal.style.transition = 'transform 0.22s ease-in';
      modal.style.transform = 'translateY(110%)';
      if (ov) { ov.style.transition = 'opacity 0.22s ease'; ov.style.opacity = '0'; }
      setTimeout(close, 200);
    } else {
      modal.style.transition = 'transform 0.32s cubic-bezier(0.16,1,0.3,1)';
      modal.style.transform = 'translateY(0)';
      if (ov) { ov.style.transition = 'opacity 0.2s ease'; ov.style.opacity = ''; }
      if (onDrag) onDrag(0);
    }
  };
  header.addEventListener('pointerup', settle);
  header.addEventListener('pointercancel', settle);
}

// Opens the real sign-up screen — the single place every "you need an
// account for that" moment in the app funnels through, now that game
// pages and search are reachable while signed out (see landing-view.js).
// A quick toast explains why, then the auth screen takes over.
//
// Dynamically imported rather than a static import at the top of this
// file: utils.js is imported by nearly every module in the app, and a
// static import of the whole auth screen here would tangle it into
// that dependency web just for this one path. A dynamic import keeps
// utils.js dependency-free while still reaching the auth screen the
// moment it's actually needed.
export function promptSignIn(message = 'Sign in to do that.') {
  toast(message, 'info');
  import('./views/auth-view.js').then(({ renderAuthView }) => {
    const appEl = document.getElementById('app');
    if (appEl) renderAuthView(appEl, { startMode: 'signup' });
  });
}

// ---- "Recently viewed" games, kept on-device (localStorage) --------
// Not account data — just a quick-access trail for THIS device/browser,
// so it works before signing in too. Wrapped in try/catch throughout:
// private browsing and storage-disabled settings can make localStorage
// throw on read OR write, and losing this list is never worth breaking
// the page over.
const RECENT_GAMES_KEY = 'playthruu_recent_games';
const RECENT_GAMES_MAX = 12;

export function recordRecentlyViewed(game) {
  if (!game?.id) return;
  try {
    const list = getRecentlyViewed().filter((g) => g.id !== game.id);
    list.unshift({ id: game.id, title: game.title, cover_url: game.cover_url || null });
    localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(list.slice(0, RECENT_GAMES_MAX)));
  } catch { /* storage unavailable — nothing to persist to */ }
}

export function getRecentlyViewed() {
  try {
    const raw = localStorage.getItem(RECENT_GAMES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Same pattern again, this time for the search screen's own history —
// the actual typed terms, not the games that came from them (that's
// recordRecentlyViewed above, a separate list). Games and Players keep
// SEPARATE histories (separate keys) — a game title showing up while
// searching for players (or vice versa) was confusing, since the two
// tabs search completely different things.
// ONE combined history for both tabs, not two separate lists — a search
// is stored as { term, tab } so a single recent list can show game and
// player searches mixed together, newest first, and tapping one knows
// which tab to jump to. (The old design kept two per-tab lists under two
// keys; this key is new so it starts clean rather than trying to merge
// two untimestamped lists.)
const RECENT_SEARCHES_KEY = 'playthruu_recent_searches_v2';
// Effectively the whole history — a person never types 1000 distinct
// searches, and each entry is a few bytes, so this keeps "show everything
// I've ever searched" true while still capping localStorage at something
// sane rather than growing without any bound at all.
const RECENT_SEARCHES_MAX = 1000;

export function recordRecentSearch(term, tab) {
  const q = term?.trim();
  if (!q || (tab !== 'games' && tab !== 'people')) return;
  try {
    // De-dupe on the term+tab pair, so the same word searched in both
    // tabs keeps one entry each, and re-searching bumps it to the top.
    const list = getRecentSearches().filter(
      (e) => !(e.term.toLowerCase() === q.toLowerCase() && e.tab === tab));
    list.unshift({ term: q, tab });
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, RECENT_SEARCHES_MAX)));
  } catch { /* storage unavailable — nothing to persist to */ }
}

// Returns the whole combined history, newest first, as { term, tab }
// objects. Tolerant of any malformed entries left in storage.
export function getRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((e) => e && typeof e.term === 'string' && (e.tab === 'games' || e.tab === 'people'));
  } catch {
    return [];
  }
}

export function removeRecentSearch(term, tab) {
  try {
    const list = getRecentSearches().filter(
      (e) => !(e.term.toLowerCase() === term.toLowerCase() && e.tab === tab));
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch { /* nothing to persist */ }
}

export function clearRecentSearches() {
  try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* nothing to clear */ }
}

// Same pattern as the recently-viewed games above, for the emoji picker's
// "Recent" row — on-device only, not per-account, so it's just whatever
// this phone reached for lately rather than something worth a database
// round trip.
const RECENT_EMOJI_KEY = 'playthruu_recent_emoji';
const RECENT_EMOJI_MAX = 24;

export function recordRecentEmoji(emoji) {
  if (!emoji) return;
  try {
    const list = getRecentEmoji().filter((e) => e !== emoji);
    list.unshift(emoji);
    localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(list.slice(0, RECENT_EMOJI_MAX)));
  } catch { /* storage unavailable — nothing to persist to */ }
}

export function getRecentEmoji() {
  try {
    const raw = localStorage.getItem(RECENT_EMOJI_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// One light haptic tap, shared by every quick social action (follow,
// like) so they all feel the same. Same pattern as the hours wheel and
// log sheet: Capacitor's native Haptics inside the packaged app (the
// WebView ignores navigator.vibrate entirely), falling back to it on the
// plain web build where it still works.
export function tapFeedback() {
  const haptics = window.Capacitor?.Plugins?.Haptics || null;
  if (haptics) { haptics.impact({ style: 'LIGHT' }).catch(() => {}); }
  else { try { navigator.vibrate?.(8); } catch { /* unsupported */ } }
}

// A short confetti burst from the centre of the screen — used for the
// one moment that's actually worth celebrating (logging a game as
// played for the first time), not sprinkled everywhere. Pure CSS
// particles on a fixed overlay, self-removing once the animation ends,
// so it survives the log sheet closing underneath it rather than
// getting wiped out with the modal. Respects reduced-motion.
export function celebrate() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const COLORS = ['#d9ff3f', '#a78bfa', '#ffc247', '#4ade95', '#ff6b6b'];
  const layer = document.createElement('div');
  layer.className = 'celebrate-layer';
  const count = 26;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'celebrate-piece';
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const dist = 90 + Math.random() * 130;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist - 40}px`);
    p.style.setProperty('--rot', `${(Math.random() - 0.5) * 560}deg`);
    p.style.setProperty('--delay', `${Math.random() * 90}ms`);
    p.style.background = COLORS[i % COLORS.length];
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1300);
}

// A small, every-time confirmation (unlike celebrate(), which is
// reserved for the one big "first play" moment) — the log tab's brand
// mark bounces and a ring of light expands from it, so saving an
// entry visibly lands on the icon you'll tap to do it again. Looked
// up fresh each call rather than cached, since the tab bar element
// itself gets re-rendered on route changes. No reduced-motion check
// needed here — the global rule in styles.css already zeroes out
// .is-logged's animation duration.
export function pulseLogTab() {
  const tab = document.querySelector('.tabbar__item--primary');
  if (!tab) return;
  tab.classList.remove('is-logged');
  // Force a reflow so re-adding the class restarts the animation even
  // if a previous pulse hasn't finished (e.g. two saves back to back).
  void tab.offsetWidth;
  tab.classList.add('is-logged');
  tab.addEventListener('animationend', () => tab.classList.remove('is-logged'), { once: true });
}
