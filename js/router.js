// Minimal hash router. No build step needed, works identically
// whether the app is loaded from a URL or from inside a wrapped APK.

const routes = [];

export function route(pattern, handler) {
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
  routes.push({ regex: new RegExp(`^${regexStr}$`), paramNames, handler });
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

// The first paint has nothing to cross-fade FROM — it would fade in from
// an empty page, which is a flash on app start rather than a transition.
let skipNextTransition = true;

function paint(run) {
  const animate = typeof document.startViewTransition === 'function'
    && !prefersReducedMotion.matches
    && !skipNextTransition;
  skipNextTransition = false;
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

export function navigate(path) {
  if (location.hash.slice(1) === path) {
    resolve(); // force re-render even if the hash didn't change
  } else {
    location.hash = path;
  }
}

function resolve() {
  const path = location.hash.slice(1) || '/feed';
  const cleanPath = path.split('?')[0];
  for (const r of routes) {
    const m = cleanPath.match(r.regex);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
      // Every view already wraps its own async body in try/catch, but a
      // handler can still throw synchronously before that (e.g. reading
      // a property off a briefly-null state.profile during a sign-in
      // race) — uncaught, that would propagate out of the hashchange
      // listener with no visible error state, unlike every other
      // boundary in the app. Falls back to whatever notFoundHandler
      // currently points at (the signed-in default is /feed).
      paint(() => {
        try {
          r.handler(params);
        } catch {
          notFoundHandler();
        }
        updateNav(cleanPath);
      });
      return;
    }
  }
  paint(() => notFoundHandler());
}

function updateNav(path) {
  document.querySelectorAll('.tabbar [data-route]').forEach(el => {
    const base = '/' + path.split('/')[1];
    el.classList.toggle('tabbar__item--active', el.dataset.route === base);
  });
}

let started = false;
export function startRouter() {
  resolve();
  if (started) return; // avoid stacking duplicate listeners on repeated sign-in/out
  started = true;
  window.addEventListener('hashchange', resolve);
}

// Re-runs whichever route handler is currently active, refetching data.
// Used after actions (saving a log, following someone) that should
// refresh the view without a full page reload or losing scroll history.
export function refreshCurrentView() {
  // Not a navigation — see paint(). Cross-fading a screen into itself
  // reads as a flicker, not as movement.
  skipNextTransition = true;
  resolve();
}
