// Dark/Light theme switching. Dark ("console") is the default and the
// only theme most people will ever see — light ("creamy white +
// orange") is opt-in via the toggle in Settings. The actual palettes
// live in css/styles.css as :root vs :root[data-theme="light"]; this
// file only ever touches the one data-theme attribute plus the two bits
// of chrome CSS can't reach (localStorage, and the native status-bar
// colour via <meta name="theme-color">).
const STORAGE_KEY = 'playthruu_theme';
const THEME_COLOR = { dark: '#0a0e16', light: '#f5ecda' };

export function getTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark'; // storage unavailable — dark is the safe default
  }
}

// Applies the theme to the document. Safe to call before the rest of the
// app exists (used by the no-flash init in index.html) and again later
// once the real toggle changes it.
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.dark);
}

export function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* setting still applies this session, just won't persist */ }
  applyTheme(next);
  return next;
}
