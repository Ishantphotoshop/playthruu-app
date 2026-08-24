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
      try {
        r.handler(params);
      } catch {
        notFoundHandler();
      }
      updateNav(cleanPath);
      return;
    }
  }
  notFoundHandler();
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
  resolve();
}
