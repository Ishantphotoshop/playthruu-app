// Minimal hash router. No build step needed, works identically
// whether the app is loaded from a URL or from inside a wrapped APK.

const routes = [];

// opts.keep = false: the page is rebuilt every visit instead of being kept
// in the back stack (screens that tear their live subscriptions down the
// moment you leave them).
export function route(pattern, handler, opts = {}) {
  // pattern like '/game/:id' -> regex with named groups
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map(seg => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  routes.push({ regex: new RegExp(`^${regexStr}$`), paramNames, handler, keep: opts.keep !== false });
}

let notFoundHandler = () => {};
export function setNotFound(handler) { notFoundHandler = handler; }

// ---- page transitions -------------------------------------------------
// Every route swap goes through the View Transitions API: the browser
// takes a picture of the screen as it is, lets us replace the DOM, takes
// another, and cross-fades between the two. Nothing in any view had to
// change for it — the whole animation is the few lines of CSS on
// ::view-transition-old/new in styles.css.
//
// Two things about how it is called here matter.
//
// The callback deliberately does NOT return the handler's promise. Route
// handlers are async: they paint a shell or a spinner synchronously and
// then await their data. startViewTransition waits for whatever the
// callback returns, so returning that promise would hold the OLD screen
// frozen on screen for the whole fetch — a second or more of nothing
// happening, which is worse than no animation at all. Dropping it means
// the transition captures the new shell, and the data fills in behind
// the animation exactly as it always did.
//
// And a refresh is not a navigation. refreshCurrentView() re-runs the
// same route after saving a log or following someone; cross-fading a
// screen into itself reads as a flicker, so those skip it.
const prefersReducedMotion = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

// The first paint has nothing to slide in FROM — it would fly in over an
// empty page, which is a lurch on app start rather than a transition.
let skipNextTransition = true;

// ---- the back stack ---------------------------------------------------
// Every history entry carries { key, idx } in history.state. key names the
// entry; idx is how deep it sits in the app's own history (0 = the first
// screen of this visit). Each entry renders into its OWN page element
// inside #app, and leaving an entry detaches that element instead of
// throwing it away. Back lands on an entry whose page still exists, so it
// is put straight back (same DOM, listeners, loaded data and scroll)
// rather than re-running the route and refetching everything.
//
// Before this, every hashchange (back included) re-ran the route handler
// into one shared #app, so going back rebuilt the previous screen from
// scratch: scroll, typed search, filters and loaded pages all reset.
// A view's late async paint also landed in whatever screen was showing by
// then; with a page element per entry it lands in its own page.
const appEl = () => document.getElementById('app');
const pages = new Map(); // key -> { el, path, idx, scroll }
const MAX_PAGES = 20;
// The four main tabs keep ONE page each for the whole visit. Tapping Home,
// Search, Notifications or Profile in the bar shows that tab's page exactly as
// it was left (same DOM, scroll, typed search, loaded lists), instead of
// building it again. A tab is only rebuilt when something it shows may have
// changed (see markPagesStale / markTabStale), or on a pull-to-refresh.
const TAB_PERSIST = new Set(['/feed', '/search', '/notifications', '/me']);
const tabPages = new Map(); // tab path -> the shared page record
// Home and Profile show things that move on without you (friends' activity,
// follower counts): after this long away they are built again instead of
// shown old. Search keeps what you typed; Notifications refreshes itself.
const TAB_TTL = { '/feed': 15 * 60_000, '/me': 15 * 60_000 };
const tabFresh = (tp, path) => !tp.stale && Date.now() - tp.builtAt < (TAB_TTL[path] || Infinity);
let current = null; // { key, idx, path }
let activePage = null;
let seq = 0;
// Depth for the next new entry when navigate() REPLACES the current one:
// a replacement sits at the same depth as what it replaced.
let pendingIdx = null;

// The element the route being rendered should paint into.
export function pageEl() { return activePage || appEl(); }

// How deep the current entry is; > 0 means Back has somewhere to go.
export function historyDepth() { return history.state?.idx ?? 0; }

function entryState() {
  let st = history.state;
  if (!st || !st.key) {
    // A brand-new entry (a link, navigate(), or a first load): one level
    // deeper than the entry we came from, unless it replaced that entry
    // or already knows its depth (sign-out keeps it, see app.js).
    const idx = pendingIdx ?? st?.idx ?? (current ? current.idx + 1 : 0);
    pendingIdx = null;
    st = { key: `e${Date.now().toString(36)}${(seq++).toString(36)}`, idx };
    history.replaceState(st, '', location.href);
  }
  return st;
}

// Scroll lives on #app and on inner scrollers (horizontal poster strips,
// tab bodies). Detaching an element resets its scroll, so it is recorded
// on the way out and put back on the way in.
function saveScroll(el) {
  const list = [[null, appEl().scrollTop, 0]];
  el.querySelectorAll('*').forEach((n) => { if (n.scrollTop || n.scrollLeft) list.push([n, n.scrollTop, n.scrollLeft]); });
  return list;
}
function restoreScroll(list) {
  (list || []).forEach(([n, top, left]) => {
    if (!n) appEl().scrollTop = top;
    else { n.scrollTop = top; n.scrollLeft = left; }
  });
}

function stashCurrent() {
  if (!current) return;
  const page = pages.get(current.key);
  if (page && page.el.parentNode) {
    page.scroll = saveScroll(page.el);
    page.mainTop = page.el.querySelector('.view-body')?.scrollTop || 0;
  }
}

// Something was saved (a log, a follow, a profile edit): every kept page
// other than the one on screen may now show old data. They are left
// alone until Back reaches one, which is then rebuilt with fresh data
// instead of put back as it was (see resolve). Pages nothing changed
// under keep coming back exactly as they were left.
export function markPagesStale() {
  for (const [k, pg] of pages) if (k !== current?.key) pg.stale = true;
  const here = pages.get(current?.key);
  for (const tp of tabPages.values()) if (tp !== here) tp.stale = true;
}

// One tab's page is out of date (a new notification arrived while it was
// away): it is rebuilt the next time it is opened.
export function markTabStale(path) {
  const tp = tabPages.get(path);
  if (tp && tp !== pages.get(current?.key)) tp.stale = true;
}

// Logging, editing or deleting a game changes what Home and Profile show.
// Every kept tab other than the one on screen is marked out of date, so it
// is rebuilt with the new entry the moment you open it. If your own profile
// is the page on screen, it is rebuilt right now, in place, with no spinner
// and the scroll spot held (see resumeMainScroll).
let logsRefreshTimer = 0;
window.addEventListener('logs:changed', () => {
  markPagesStale();
  if (current?.path !== '/me') return;
  clearTimeout(logsRefreshTimer);
  logsRefreshTimer = setTimeout(() => {
    if (current?.path !== '/me') return;
    const pg = pages.get(current.key);
    if (pg) { pg.mainTop = pg.el.querySelector('.view-body')?.scrollTop || 0; pg.stale = true; }
    refreshCurrentView({ dataChanged: false });
  }, 250);
});

// A rebuilt page starts at the top; take it back to where it was left.
// Its sections fill in over the next moment, so the offset is held
// (with scroll anchoring off, which would otherwise chase each section as
// it lands) until the page settles, or until the user touches it.
function resumeMainScroll(el, top) {
  if (!top) return;
  let n = 0;
  let stopped = false;
  const stop = () => { stopped = true; };
  const opts = { passive: true, capture: true };
  ['touchstart', 'wheel', 'keydown', 'pointerdown'].forEach((t) => el.addEventListener(t, stop, opts));
  const finish = () => {
    ['touchstart', 'wheel', 'keydown', 'pointerdown'].forEach((t) => el.removeEventListener(t, stop, opts));
    el.querySelectorAll('.view-body').forEach((vb) => { vb.style.overflowAnchor = ''; });
  };
  const tick = () => {
    if (stopped || activePage !== el) { finish(); return; }
    const vb = el.querySelector('.view-body');
    if (vb) { vb.style.overflowAnchor = 'none'; vb.scrollTop = top; }
    if (++n < 12) setTimeout(tick, 150);
    else finish();
  };
  tick();
}

function prune(idx) {
  // Entries at or past this depth were forward history that a new
  // navigation has discarded; the browser can never return to them.
  for (const [k, pg] of pages) if (pg.idx >= idx && k !== current?.key) pages.delete(k);
  while (pages.size > MAX_PAGES) {
    let oldest = null;
    for (const [k, pg] of pages) if (k !== current?.key && (!oldest || pg.idx < pages.get(oldest).idx)) oldest = k;
    if (!oldest) break;
    pages.delete(oldest);
  }
}

// Forget every kept page (sign-out, a new session). The depth is kept:
// the entries behind this one are still there in the browser's history.
export function resetPages() {
  pages.clear();
  tabPages.clear();
  activePage = null;
  if (current) current = { key: null, idx: current.idx, path: null };
}

// The bottom bar's own destinations. These are SIBLINGS, not a stack:
// a directional slide between them claims a hierarchy that is not there.
const TAB_ROOTS = new Set(['/feed', '/search', '/log', '/notifications', '/messages', '/me']);

function directionTo(path, st) {
  if (!current || current.key === st.key) return 'forward';
  if (TAB_ROOTS.has(current.path) && TAB_ROOTS.has(path)) return 'tab';
  return st.idx < current.idx ? 'back' : 'forward';
}

function paint(run, direction) {
  const animate = typeof document.startViewTransition === 'function'
    && !prefersReducedMotion.matches
    && !skipNextTransition
    && direction !== 'tab'; // switching between the main tabs is instant
  skipNextTransition = false;
  // The CSS reads this to decide how the two screens move: a stack push
  // slides, a pop slides the other way, a tab switch does neither.
  document.documentElement.dataset.nav =
    direction === 'back' ? 'back' : direction === 'tab' ? 'tab' : 'forward';
  if (!animate) { run(); return; }
  try {
    const t = document.startViewTransition(() => { run(); });
    // Tapping a second tab before the first transition has finished is
    // normal, and the API's answer is to abandon the first — which
    // rejects all three of its promises with an AbortError. Nothing is
    // waiting on them, so left alone that surfaces as an uncaught
    // rejection in the console every time somebody navigates quickly.
    // There is nothing to recover from; the new transition is already
    // running.
    t?.finished?.catch(() => {});
    t?.ready?.catch(() => {});
    t?.updateCallbackDone?.catch(() => {});
  } catch {
    run(); // a transition already running, or the browser refusing one
  }
}


// ---- overlays: Back closes the top one first --------------------------
// Every overlay (sheet, modal, viewer) gets a history entry of its own
// when it opens: the same URL, with history.state.ov counting how many
// are stacked. Back (browser, Android gesture, TWA, WebView or the in-app
// arrow) then pops that entry, and popstate closes the overlay instead of
// the page underneath changing. Before, Back with a sheet open left the
// page (and the hashchange cleanup tore the sheet down on the way out),
// so one press did two things.
//
// Closing an overlay from its own UI (the X, a swipe, saving) drops its
// entry again, so the next Back goes where it should instead of "doing
// nothing" on a leftover entry. While that drop is in flight, navigate()
// waits for it: otherwise a navigation right after the close could be
// undone by the drop landing a moment later.
//
// It works by reconciling two counts rather than tracking events: how
// many tracked overlays are open, and how many overlay entries the
// current history entry says there are. That keeps it right when things
// interleave (a sheet swapped for another in one tick, Back pressed
// several times quickly).
const trackedOverlays = new WeakSet();
let overlaySelector = null;
let dismissOverlay = (el) => el.remove();
let onOverlaysClosed = () => {};
let backInFlight = false;
let afterBack = [];

function openTrackedOverlays() {
  return [...document.querySelectorAll(overlaySelector)]
    .filter((el) => trackedOverlays.has(el) && !el.__closing);
}

function settleBack() {
  backInFlight = false;
  const queued = afterBack;
  afterBack = [];
  queued.forEach((fn) => fn());
}

function stepBack() {
  backInFlight = true;
  history.back();
  // popstate normally settles it; this is the safety net if it never comes.
  setTimeout(() => { if (backInFlight) settleBack(); }, 500);
}

// True when the entry we are on belongs to an open overlay.
export function onOverlayEntry() { return !!history.state?.ov; }

// Resolves once the history entry of an overlay that was just closed has
// been dropped. Anything that closes one sheet and immediately opens
// another has to wait for this: the new sheet pushes its own entry, and
// the Back still in flight from the old one then lands on it, sees an
// overlay with no entry to match, and closes it. That is how "Write a
// review" opened the composer for a frame and then lost it.
//
// The removal is noticed by the MutationObserver in trackOverlays, one
// task after the element leaves the page, so this yields a task first to
// let that start the Back before checking whether one is in flight.
export function afterOverlayClosed() {
  return new Promise((done) => {
    setTimeout(() => { if (backInFlight) afterBack.push(done); else done(); }, 0);
  });
}

export function trackOverlays({ selector, dismiss, onAllClosed }) {
  overlaySelector = selector;
  if (dismiss) dismissOverlay = dismiss;
  if (onAllClosed) onOverlaysClosed = onAllClosed;
  new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((el) => {
        if (el.nodeType !== 1 || !el.matches(selector) || trackedOverlays.has(el)) return;
        const st = history.state;
        if (!st?.key) return; // no routed page under it (the signed-out funnel)
        trackedOverlays.add(el);
        el.__entryKey = st.key;
        history.pushState({ ...st, ov: (st.ov || 0) + 1 }, '', location.href);
      });
      rec.removedNodes.forEach((el) => {
        if (el.nodeType !== 1 || !trackedOverlays.has(el)) return;
        trackedOverlays.delete(el);
        if (el.__closing) return; // closed by Back: its entry is already gone
        // Closed from its own UI while still on its page: drop its entry.
        // (If it closed because the app navigated away, that entry is now
        // behind us and is skipped when Back reaches it.)
        const st = history.state;
        if (st?.ov && st.key === el.__entryKey && openTrackedOverlays().length < st.ov) stepBack();
      });
    }
  }).observe(document.body, { childList: true });

  window.addEventListener('popstate', () => {
    const st = history.state;
    const depth = st?.ov || 0;
    const open = openTrackedOverlays();
    if (open.length > depth) {
      // Back while overlays are open: close the top ones down to what
      // this entry had open.
      open.slice(depth).reverse().forEach((el) => { el.__closing = true; dismissOverlay(el); });
      if (!openTrackedOverlays().length) onOverlaysClosed();
    } else if (open.length < depth && st?.key) {
      // An overlay's entry whose overlay is gone (it was open when a link
      // inside it navigated away). Nothing to show here; keep going back.
      stepBack();
      return;
    }
    if (backInFlight) settleBack();
  });
}

// replace: swap the current entry for this one instead of adding a new
// entry (redirects like an unknown path -> feed), so Back never lands on
// a screen that immediately sends you forward again.
export function navigate(path, { replace = false } = {}) {
  if (backInFlight) { afterBack.push(() => navigate(path, { replace })); return; }
  if (location.hash.slice(1) === path) {
    resolve(true); // force re-render even if the hash didn't change
  } else if (history.state?.ov) {
    // From inside an overlay, which has its own history entry (see
    // app.js): that entry becomes the destination, one level above the
    // page under the overlay, so Back from there is one press to it.
    location.replace(`#${path}`);
  } else if (replace) {
    pendingIdx = current ? current.idx : 0;
    location.replace(`#${path}`);
  } else {
    location.hash = path;
  }
}

function showPage(el) {
  const root = appEl();
  // Anything else in #app goes: the page being left (already stashed if
  // it is kept) and screens painted straight into #app outside the router
  // (landing, sign-in, suspended).
  [...root.children].forEach((c) => { if (c !== el) c.remove(); });
  if (el.parentNode !== root) root.appendChild(el);
  activePage = el;
}

function resolve(force = false) {
  const path = location.hash.slice(1) || '/feed';
  const cleanPath = path.split('?')[0];
  const st = entryState();
  const r = routes.find((x) => x.regex.test(cleanPath));
  // The history bookkeeping happens here, synchronously, and only the DOM
  // swap waits for paint(): with a view transition the swap runs a frame
  // later, and a second tap inside that frame must already see this entry
  // as the current one or it would be given the wrong depth.
  const direction = directionTo(cleanPath, st);
  stashCurrent();
  current = { key: st.key, idx: st.idx, path: cleanPath };
  if (!r) {
    pages.delete(st.key);
    paint(() => { activePage = null; notFoundHandler(); }, direction);
    return;
  }
  // A bare URL with no hash is the feed; give the entry its real hash so
  // tapping Feed in the bar later is the same entry, not a second copy
  // of it that Back would then have to walk through.
  if (!location.hash) history.replaceState(history.state, '', `#${cleanPath}`);
  const m = cleanPath.match(r.regex);
  const params = {};
  r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
  const kept = force ? null : pages.get(st.key);
  // Opening a main tab again from the bar: its page is still alive, show it.
  const shared = !force && TAB_PERSIST.has(cleanPath) ? tabPages.get(cleanPath) : null;
  if (!(kept && kept.path === path && !kept.stale) && shared && tabFresh(shared, cleanPath)) {
    pages.set(st.key, shared);
    paint(() => {
      showPage(shared.el);
      restoreScroll(shared.scroll);
      updateNav(cleanPath);
      window.dispatchEvent(new CustomEvent('page:shown', { detail: { restored: true } }));
    }, direction);
    return;
  }
  if (kept && kept.path === path && !kept.stale) {
    // Back (or forward) to a screen we still have: put it back exactly as
    // it was left. Nothing is re-run and nothing is refetched.
    paint(() => {
      showPage(kept.el);
      restoreScroll(kept.scroll);
      updateNav(cleanPath);
      window.dispatchEvent(new CustomEvent('page:shown', { detail: { restored: true } }));
    }, direction);
    return;
  }
  // A rebuild of the same screen (out of date, or refreshed in place)
  // takes the scroll spot back to where it was.
  const prior = pages.get(st.key);
  const resumeTop = prior && prior.path === path && (prior.stale || force) ? prior.mainTop : 0;
  const el = document.createElement('div');
  el.className = 'page';
  if (r.keep) {
    const rec = { el, path, idx: st.idx, scroll: null, builtAt: Date.now() };
    pages.set(st.key, rec);
    if (TAB_PERSIST.has(cleanPath)) {
      // This tab's page is now the new one, for every history entry that
      // pointed at the old one too.
      const old = tabPages.get(cleanPath);
      if (old) for (const [k, pg] of pages) if (pg === old) pages.set(k, rec);
      tabPages.set(cleanPath, rec);
    }
  } else pages.delete(st.key);
  prune(st.idx + 1);
  paint(() => {
    showPage(el);
    appEl().scrollTop = 0;
    // Every view already wraps its own async body in try/catch, but a
    // handler can still throw synchronously before that (e.g. reading
    // a property off a briefly-null state.profile during a sign-in
    // race). Falls back to whatever notFoundHandler points at.
    try {
      r.handler(params);
    } catch {
      notFoundHandler();
    }
    updateNav(cleanPath);
    resumeMainScroll(el, resumeTop);
    window.dispatchEvent(new CustomEvent('page:shown', { detail: { restored: false } }));
  }, direction);
}

function updateNav(path) {
  document.querySelectorAll('.tabbar [data-route]').forEach(el => {
    let base = '/' + path.split('/')[1];
    if (base === '/discover') base = '/search'; // Browse lives under the Search tab
    el.classList.toggle('tabbar__item--active', el.dataset.route === base);
  });
}

let started = false;
export function startRouter() {
  resetPages();
  resolve(true);
  if (started) return; // avoid stacking duplicate listeners on repeated sign-in/out
  started = true;
  window.addEventListener('hashchange', () => resolve());
  // A link to the screen you are already on (tapping Feed while on Feed)
  // is a same-URL navigation: the browser swaps the current entry for a
  // fresh one with no state and fires no hashchange, so the entry
  // silently lost its place in the back stack and was rebuilt, one level
  // too deep, the next time Back reached it. There is nothing to navigate
  // to, so it doesn't.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href^="#/"]');
    if (a && !a.target && a.getAttribute('href') === location.hash) e.preventDefault();
  });
}

// Re-runs whichever route handler is currently active, refetching data.
// Used after actions (saving a log, following someone) that should
// refresh the view without a full page reload or losing scroll history.
// { dataChanged: false } for a refresh that saved nothing (pull to
// refresh, re-tapping Search); anything else is taken as a write, which
// marks the other kept pages stale.
export function refreshCurrentView(opts) {
  if (opts?.dataChanged !== false) markPagesStale();
  // Not a navigation — see paint(). Cross-fading a screen into itself
  // reads as a flicker, not as movement.
  skipNextTransition = true;
  resolve(true);
}
