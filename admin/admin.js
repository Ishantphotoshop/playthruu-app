// ============================================================
// PLAYTHRUU ADMIN
// ============================================================
// A separate front end onto the same Supabase project the app uses,
// shipping the same public anon key. It holds no extra secret and grants
// no extra power on its own: every table it writes to is behind an RLS
// policy checking profiles.is_admin for the calling user, so somebody
// who finds this URL can load the page and still not change a row.
// See migrations/2026-09-02_admin_toolkit.sql.
//
// It draws with the app's real components and stylesheet rather than a
// parallel set of its own — same buttons, cards, sheets, type and both
// themes — so this reads as part of PlayThruu instead of a different
// piece of software. What marks it out is the ADMIN stamp in the header,
// built from the app's own .stamp component.

import { supabase } from '../js/supabase-client.js';
import { searchGamesEverywhere, addGame, getPresenceFor } from '../js/api.js';
import { esc, qs, qsa, toast, timeAgo } from '../js/utils.js';
import { getTheme, applyTheme } from '../js/theme.js';
import {
  emptyState, spinner, avatarImg, ratingHistogram, wireRatingHistogram,
  iconBack, iconChevronRight, iconChevronUp, iconChevronDown,
  iconFlame, iconNewspaper, iconUser, iconFlag, iconGamepad,
  iconTrash, iconCheck, iconEye, iconNote, iconMessage, iconDiary,
  iconList, iconMail,
} from '../js/components.js';
import { stockChart, wireStockChart } from './chart.js';
import {
  countUp, skeletonRows, skeletonPanel, undoable, downloadCsv, openPalette,
  bulkSelect, checkbox, typeToConfirm, timeTitle, wireConnectionBanner,
} from './ui.js';

const PROJECT_REF = 'kpgjuuplpgilupogpezc';
const SQL_EDITOR_URL = `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`;

// Each migration this build needs, with a check for whether it's already
// applied. Listing them means the setup screen can tell WHICH are
// outstanding and hand over only those — someone who already ran the
// first one shouldn't be asked to paste it again. The check is defined
// per migration because they aren't all detectable the same way: the
// first two each add a table (probe it exists), the third only adds
// policies and so drops a sentinel row into app_settings to be found by.
const MIGRATIONS = [
  { path: '../migrations/2026-09-02_admin_toolkit.sql', check: () => tableExists('app_settings') },
  { path: '../migrations/2026-09-02_presence_and_moderation.sql', check: () => tableExists('user_presence') },
  { path: '../migrations/2026-09-02_admin_analytics_access.sql', check: () => settingExists('analytics_ready') },
];

// Anyone whose last heartbeat landed inside this window counts as on the
// app right now. The app beats every 60s while visible, so 3 minutes is
// wide enough to absorb a missed beat or a slow request without showing
// somebody as online long after they've closed it.
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

const root = document.getElementById('app');

const state = {
  user: null,
  profile: null,
  screen: 'home',
  openReports: 0,
};

// ------------------------------------------------------------ helpers
function fail(err, fallback = 'Something went wrong') {
  // The real Postgres/PostgREST message matters more here than anywhere
  // in the app: an RLS refusal and a typo'd column look identical from
  // the outside if all you print is "something went wrong".
  console.error(err);
  toast(err?.message || fallback, 'error');
}

const fmtNum = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat().format(n));

function presenceOf(lastSeenAt) {
  if (!lastSeenAt) return { online: false, label: 'never seen' };
  const ms = Date.now() - new Date(lastSeenAt).getTime();
  if (ms < ONLINE_WINDOW_MS) return { online: true, label: 'online' };
  return { online: false, label: `seen ${timeAgo(lastSeenAt)} ago` };
}

function presenceHtml(lastSeenAt) {
  const { online, label } = presenceOf(lastSeenAt);
  return `<span class="adm-presence${online ? ' adm-presence--online' : ''}">
    <span class="adm-presence__dot"></span>${esc(label)}</span>`;
}

async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'success');
  } catch {
    // The Clipboard API needs a secure context, which a WebView served
    // over plain http during local testing doesn't have.
    toast('Select the text and copy it manually', 'error');
  }
}

function confirmSheet({ title, sub, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__header"><h2>${esc(title)}</h2></div>
        <div class="adm-sheet-body">
          ${sub ? `<p class="modal__hint">${esc(sub)}</p>` : ''}
          <div class="adm-btn-row">
            <button class="btn" data-act="cancel">Cancel</button>
            <button class="btn ${danger ? 'btn--danger' : 'btn--accent'}" data-act="ok">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.dataset.act === 'cancel') close(false);
      if (e.target.dataset.act === 'ok') close(true);
    });
    document.body.appendChild(overlay);
  });
}

function openSheet(title, bodyHtml, wire) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal--tall">
      <div class="modal__header"><h2>${esc(title)}</h2></div>
      <div class="adm-sheet-body">${bodyHtml}</div>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  wire?.(qs('.modal', overlay), close);
  return close;
}

const iconMegaphone = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2.5l7 4.5v-14L6.5 9H4a1 1 0 0 0-1 1z"/><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M6.5 14v4a1.5 1.5 0 0 0 3 0v-2.5"/></svg>`;
const iconGrip = () => `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;
const iconCopyStack = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="12" height="16" rx="1.5"/><path d="M8 1.5h12v16" opacity="0.55"/></svg>`;

// ------------------------------------------------------------ charts
// Small, dependency-free SVG/HTML charts. Everything is painted through
// the app's colour tokens so both themes work with no per-chart code.

// The cumulative growth curve that used to live here is now the
// scrubbable chart in chart.js — same idea, but it answers "what was it
// on the 12th?" instead of only showing the shape.

// Day-by-day activity bars, most recent column highlighted. The label
// and value ride on the element so wireBars() can read them back out
// without needing the original array.
function barSeries(bars) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return `<div class="adm-bars" role="img" aria-label="Recent activity">
    ${bars.map((b, i) => `
      <div class="adm-bars__col" data-label="${esc(b.label)}" data-value="${b.value}" title="${esc(b.label)}: ${b.value}">
        <div class="adm-bars__bar${i === bars.length - 1 ? ' adm-bars__bar--today' : ''}"
             style="height:${b.value === 0 ? 2 : Math.max(6, Math.round((b.value / max) * 100))}%"></div>
      </div>`).join('')}
  </div>`;
}

// One stacked bar + a legend, for a categorical split.
function segBar(segments) {
  const shown = segments.filter((s) => s.value > 0);
  const total = shown.reduce((a, s) => a + s.value, 0) || 1;
  return `
    <div class="adm-segbar">
      ${shown.map((s) => `<span class="adm-segbar__seg" style="width:${(s.value / total * 100).toFixed(1)}%;background:${s.color}"></span>`).join('')}
    </div>
    <div class="adm-legend">
      ${segments.map((s) => `<span class="adm-legend__item"><span class="adm-legend__dot" style="background:${s.color}"></span>${esc(s.label)} <b>${s.value}</b></span>`).join('')}
    </div>`;
}

// ------------------------------------------------------------ chrome
function header(title, { back = false } = {}) {
  return `
    <header class="topbar">
      ${back ? `<button class="topbar__back" id="go-back" aria-label="Back">${iconBack()}</button>` : ''}
      <h1 class="topbar__title">${esc(title)}</h1>
      <span class="stamp stamp--playing adm-stamp">ADMIN</span>
    </header>`;
}

function paint(html) {
  root.innerHTML = html;
  qs('#go-back')?.addEventListener('click', () => go('home'));
}

// ------------------------------------------------------------ routing
// Hash-based so the phone's own Back button (and the APK shell's back
// handling) moves between screens instead of closing the app.
function go(screen) {
  const target = screen === 'home' ? '' : screen;
  if (location.hash.replace(/^#\/?/, '') !== target) {
    location.hash = target ? `#/${target}` : '#/';
    return; // hashchange re-enters here
  }
  render(screen);
}

const SCREENS = {};

function render(screen) {
  // The dashboard's own refresh loop must not keep running (and keep
  // hitting the database) once you've moved off it.
  if (state.screen === 'home' && screen !== 'home') clearInterval(dashboardTimer);
  state.screen = screen;
  (SCREENS[screen] || SCREENS.home)();
}

// ------------------------------------------------------------ palette
// Everything reachable from the tiles, plus the actions worth having
// without navigating first.
function paletteCommands() {
  const cmds = SECTIONS.map((s) => ({
    title: s.title,
    hint: s.sub,
    icon: s.icon(),
    badge: s.id === 'reports' && state.openReports ? String(state.openReports) : '',
    run: () => go(s.id),
  }));
  cmds.unshift({ title: 'Dashboard', hint: 'Stats and charts', icon: iconFlame(), run: () => go('home') });
  cmds.push(
    { title: 'Write a news post', hint: 'Publish to the News tab', icon: iconNewspaper(), run: () => { go('news'); setTimeout(() => openNewsEditor(null), 60); } },
    { title: 'Feature a game', hint: 'Add to Trending', icon: iconFlame(), run: () => { go('trending'); setTimeout(openGamePicker, 60); } },
    { title: 'Switch theme', hint: 'Light or dark', icon: iconTheme(), run: toggleTheme },
    { title: 'Sign out', hint: 'End this session', icon: iconUser(), run: signOut },
  );
  return cmds;
}

function showPalette() { openPalette(paletteCommands()); }

// Ctrl/Cmd-K anywhere, plus single-key jumps that stay out of the way
// while anything is being typed into.
document.addEventListener('keydown', (e) => {
  if (!state.user || !state.profile?.is_admin) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
    || document.activeElement?.isContentEditable;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    showPalette();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === '/') { e.preventDefault(); showPalette(); return; }
  if (e.key === 'Escape' && state.screen !== 'home') { go('home'); return; }
  // Number keys jump straight to a section, in the order the tiles read.
  const n = Number(e.key);
  if (n >= 1 && n <= SECTIONS.length) { go(SECTIONS[n - 1].id); }
});

window.addEventListener('hashchange', () => {
  const screen = location.hash.replace(/^#\/?/, '') || 'home';
  if (state.user && state.profile?.is_admin) render(screen);
});

// ============================================================
// GATE SCREENS
// ============================================================
function loginScreen() {
  root.innerHTML = `
    <div class="adm-gate">
      <div class="adm-gate__mark"></div>
      <h1 class="adm-gate__title">Admin</h1>
      <p class="adm-gate__sub">Sign in with your PlayThruu account. Admin rights are checked against the database, not this screen.</p>
      <form id="login-form">
        <label class="field"><span>Email</span>
          <input type="email" id="email" placeholder="you@example.com" autocomplete="username" required>
        </label>
        <label class="field"><span>Password</span>
          <input type="password" id="password" placeholder="••••••••" autocomplete="current-password" required>
        </label>
        <button class="btn btn--accent btn--block" type="submit" id="login-btn">Sign in</button>
      </form>
    </div>`;

  qs('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    const { error } = await supabase.auth.signInWithPassword({
      email: qs('#email').value.trim(),
      password: qs('#password').value,
    });
    if (error) {
      btn.disabled = false;
      btn.textContent = 'Sign in';
      fail(error, 'Could not sign in');
      return;
    }
    boot();
  });
}

const grantSql = (userId) =>
  `-- Make this account an admin\nupdate public.profiles\n   set is_admin = true\n where id = '${userId}';`;

// Both first-run gaps — tables not existing, and this account not being
// flagged as an admin — are fixed by SQL, and the grant needs an id you
// only have once signed in. So they're deliberately ONE screen handing
// over ONE block to paste, rather than several rounds of copy-run-return.
function setupScreen(userId, { missing, needsAdmin }) {
  const jobs = missing.length + (needsAdmin ? 1 : 0);
  root.innerHTML = `
    <div class="adm-gate">
      <div class="adm-gate__mark"></div>
      <h1 class="adm-gate__title">${missing.length ? 'One-time setup' : 'Almost there'}</h1>
      <p class="adm-gate__sub">${jobs > 1
        ? `${jobs} things to switch on, all in one go. Copy the SQL below, run it once in Supabase, and this screen never comes back.`
        : missing.length
          ? "The admin tables aren't in the database yet. Run this once and this screen goes away for good."
          : "You're signed in, but this account isn't an admin yet. Run this once and reopen the app."}</p>

      <div class="adm-step"><span class="adm-step__num">1</span>
        <span class="adm-step__text">Tap <strong>Copy setup SQL</strong>.</span></div>
      <div class="adm-step"><span class="adm-step__num">2</span>
        <span class="adm-step__text">Tap <strong>Open editor</strong>, paste into a new query, and hit Run. It's safe to run more than once.</span></div>
      <div class="adm-step"><span class="adm-step__num">3</span>
        <span class="adm-step__text">Come back and tap <strong>Recheck</strong>.</span></div>

      <div class="adm-btn-row">
        <button class="btn" id="copy-sql">Copy setup SQL</button>
        <a class="btn btn--accent" href="${SQL_EDITOR_URL}" target="_blank" rel="noopener">Open editor</a>
      </div>
      <div class="adm-btn-row"><button class="btn btn--block" id="recheck">Recheck</button></div>

      ${needsAdmin ? `<p class="adm-hint">The grant below is scoped to your own account id, nobody else's.</p>
        <code class="adm-code">${esc(grantSql(userId))}</code>` : ''}

      <p class="adm-hint">Signed in as <span class="mono">${esc(state.user?.email || userId)}</span></p>
      <div class="adm-btn-row"><button class="btn btn--block" id="signout">Sign out</button></div>
    </div>`;

  qs('#recheck').addEventListener('click', boot);
  qs('#signout').addEventListener('click', signOut);
  qs('#copy-sql').addEventListener('click', async () => {
    try {
      let sql = '';
      for (const m of missing) {
        const res = await fetch(m.path, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Could not load ${m.path}`);
        sql += `${await res.text()}\n\n`;
      }
      // The grant goes last on purpose: it wants profiles settled first,
      // and it means the run finishes on the statement that unlocks the app.
      if (needsAdmin) sql += `${grantSql(userId)}\n`;
      await copy(sql, 'Setup SQL copied');
    } catch (err) {
      fail(err, 'Could not build the setup SQL');
    }
  });
}

async function signOut() {
  await supabase.auth.signOut();
  state.user = null;
  state.profile = null;
  loginScreen();
}

// ============================================================
// HOME
// ============================================================
const SECTIONS = [
  { id: 'trending', icon: iconFlame, title: 'Trending', sub: 'Feature games' },
  { id: 'news', icon: iconNewspaper, title: 'News', sub: 'Publish posts' },
  { id: 'announce', icon: iconMegaphone, title: 'Announce', sub: 'Feed banner' },
  { id: 'activity', icon: iconDiary, title: 'Activity', sub: 'Live logs' },
  { id: 'people', icon: iconUser, title: 'People', sub: "Who's online" },
  { id: 'reports', icon: iconFlag, title: 'Reports', sub: 'Moderation' },
  { id: 'comments', icon: iconMessage, title: 'Comments', sub: 'Read, remove' },
  { id: 'lists', icon: iconList, title: 'Lists', sub: 'User collections' },
  { id: 'games', icon: iconGamepad, title: 'Games', sub: 'Hide or remove' },
  { id: 'waitlist', icon: iconMail, title: 'Waitlist', sub: 'Signups' },
];

// Which series the big chart is showing. Kept at module scope so
// switching metric survives the dashboard's own background refresh.
let chartMetric = 'players';
let chartHandle = null;
let dashboardTimer = null;

const METRICS = [
  { id: 'players', label: 'Players', title: 'Total players' },
  { id: 'logs', label: 'Logs', title: 'Total logs' },
  { id: 'reviews', label: 'Reviews', title: 'Total reviews' },
];

SCREENS.home = function home() {
  const name = (state.profile?.display_name || state.profile?.username || '').split(' ')[0] || 'there';
  paint(`
    ${header('PlayThruu')}
    <main class="view-body">
      <div class="adm-hero">
        <span class="adm-hero__hello">Hey ${esc(name)}</span>
        <span class="adm-hero__now" id="hero-now"><b>·</b> online now</span>
      </div>

      <div class="adm-quickbar">
        <button class="adm-quick" id="open-palette">
          <span class="adm-quick__key">${navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'} K</span>
          Search or jump to…
        </button>
        <button class="icon-btn icon-btn--small" id="theme-toggle" aria-label="Switch theme">${iconTheme()}</button>
        <button class="icon-btn icon-btn--small" id="refresh-now" aria-label="Refresh">${iconRefresh()}</button>
      </div>

      <div class="adm-panel adm-panel--chart" id="chart-panel">${skeletonPanel()}</div>

      <h2 class="section-heading">At a glance</h2>
      <div class="stat-card-row" id="stats-1"></div>
      <div class="stat-card-row" id="stats-2" style="margin-top:calc(-1 * var(--space-3))"></div>
      <div id="analytics"></div>

      <h2 class="section-heading">Control</h2>
      <div class="adm-grid" id="nav">
        ${SECTIONS.map((s) => `
          <button class="adm-gtile" data-go="${s.id}">
            <span class="adm-gtile__icon">${s.icon()}</span>
            <span>
              <span class="adm-gtile__title">${esc(s.title)}</span>
              <span class="adm-gtile__sub">${esc(s.sub)}</span>
            </span>
          </button>`).join('')}
      </div>

      <h2 class="section-heading">Session</h2>
      <div class="list-card">
        <span class="list-card__body">
          <span class="list-card__name">${esc(state.profile?.display_name || state.profile?.username || 'You')}</span>
          <span class="list-card__meta">${esc(state.user?.email || '')}</span>
        </span>
        <button class="btn btn--pill" id="signout">Sign out</button>
      </div>
      <p class="adm-hint">Changes here are live immediately — this is the production database, not a copy.
        <span id="last-sync"></span></p>
    </main>`);

  qs('#signout').addEventListener('click', signOut);
  qsa('[data-go]').forEach((el) => el.addEventListener('click', () => go(el.dataset.go)));
  qs('#open-palette').addEventListener('click', showPalette);
  qs('#theme-toggle').addEventListener('click', toggleTheme);
  qs('#refresh-now').addEventListener('click', (e) => {
    e.currentTarget.classList.add('is-spinning');
    loadDashboard().finally(() => e.currentTarget.classList.remove('is-spinning'));
  });

  loadDashboard();

  // The dashboard is the screen most likely to be left open on a second
  // monitor, so it keeps itself current rather than going stale until
  // someone reloads. Cleared whenever another screen takes over.
  clearInterval(dashboardTimer);
  dashboardTimer = setInterval(() => {
    if (state.screen === 'home' && document.visibilityState === 'visible') loadDashboard({ quiet: true });
  }, 60000);
};

function iconTheme() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>`; }
function iconRefresh() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4.5h-4.5"/></svg>`; }

function toggleTheme() {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  applyTheme(next);
  toast(next === 'light' ? 'Light' : 'Dark', 'success');
}

// Pulls the raw rows once and computes everything client-side. At this
// app's scale (tens of players, low hundreds of logs) that's a couple of
// small queries and a few reduces — far simpler than a wall of COUNT
// round-trips or server-side aggregates, and it powers the charts too.
async function loadDashboard({ quiet = false } = {}) {
  const now = Date.now();
  const day = 86400000;
  const iso = (ms) => new Date(ms).toISOString();

  const [profilesRes, logsRes, gamesCountRes, presenceRes, reportsRes] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, avatar_url, created_at'),
    supabase.from('logs').select('id, user_id, game_id, status, rating, review, loved, created_at'),
    supabase.from('games').select('id', { count: 'exact', head: true }),
    supabase.from('user_presence').select('last_seen_at').gte('last_seen_at', iso(now - ONLINE_WINDOW_MS)),
    supabase.from('reports').select('id', { count: 'exact', head: true }).neq('status', 'resolved'),
  ]);

  const profiles = profilesRes.data || [];
  const logs = logsRes.data || [];
  const gamesCount = gamesCountRes.count ?? null;
  const online = (presenceRes.data || []).length;
  state.openReports = reportsRes.count || 0;

  // --- headline counts ---
  const players = profiles.length;
  const newPlayers7 = profiles.filter((p) => now - new Date(p.created_at).getTime() < 7 * day).length;
  const logs7 = logs.filter((l) => now - new Date(l.created_at).getTime() < 7 * day).length;
  const reviews = logs.filter((l) => l.review).length;
  const loved = logs.filter((l) => l.loved).length;

  // --- hero ---
  const heroNow = qs('#hero-now');
  if (heroNow) heroNow.innerHTML = `<b>${online}</b> online now`;

  // Each tile carries how it moved over the last 7 days against the 7
  // before that, so a number is never just a number with no sense of
  // whether it's climbing. Tapping one switches the big chart to it.
  const priorWeek = (pred) => {
    const inLast = logs.filter((l) => now - new Date(l.created_at).getTime() < 7 * day).filter(pred).length;
    const inPrev = logs.filter((l) => {
      const age = now - new Date(l.created_at).getTime();
      return age >= 7 * day && age < 14 * day;
    }).filter(pred).length;
    return inPrev === 0 ? (inLast ? 100 : 0) : Math.round(((inLast - inPrev) / inPrev) * 100);
  };

  const trendTag = (pct) => {
    if (!pct) return '';
    const up = pct > 0;
    return `<i class="stat-card__trend${up ? ' stat-card__trend--up' : ' stat-card__trend--down'}">${up ? '▲' : '▼'}${Math.abs(pct)}%</i>`;
  };

  const tile = (value, label, variant, { metric = '', trend = '' } = {}) => `
    <div class="stat-card stat-card--${variant}${metric ? ' stat-card--tappable' : ''}"${metric ? ` data-metric="${metric}" role="button" tabindex="0"` : ''}>
      <b data-count="${value === null || value === undefined ? '' : value}">—</b>
      <span>${label}${trend}</span>
    </div>`;

  qs('#stats-1').innerHTML =
    tile(online, 'Online', 'green')
    + tile(players, 'Players', 'grey', { metric: 'players', trend: '' })
    + tile(logs.length, 'Logs', 'grey', { metric: 'logs', trend: trendTag(priorWeek(() => true)) });
  qs('#stats-2').innerHTML =
    tile(newPlayers7, 'New / 7d', 'blue')
    + tile(reviews, 'Reviews', 'grey', { metric: 'reviews', trend: trendTag(priorWeek((l) => !!l.review)) })
    + tile(loved, 'Loved', 'grey', { trend: trendTag(priorWeek((l) => !!l.loved)) });

  qsa('[data-count]').forEach((el) => {
    const raw = el.dataset.count;
    if (raw === '') { el.textContent = '—'; return; }
    if (quiet) { el.textContent = fmtNum(Number(raw)); return; } // no replay on a background refresh
    countUp(el, Number(raw), { format: fmtNum });
  });

  const pickMetric = (metric) => {
    chartMetric = metric;
    paintChart();
  };
  qsa('[data-metric]').forEach((el) => {
    el.addEventListener('click', () => pickMetric(el.dataset.metric));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickMetric(el.dataset.metric); }
    });
  });

  // --- reports badge (only known now) ---
  const reportTile = qs('.adm-gtile[data-go="reports"]');
  if (reportTile && state.openReports) {
    reportTile.insertAdjacentHTML('beforeend', `<span class="adm-gtile__count">${state.openReports}</span>`);
  }

  // --- daily cumulative series, one point per day since the very first
  // row, for the scrubbable chart. Built once for each metric so the
  // range buttons and the metric switcher are both instant: they slice
  // and re-read these arrays rather than going back to the database. ---
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function cumulativeDaily(rows, at = (r) => r.created_at) {
    const times = rows.map((r) => new Date(at(r)).getTime()).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
    if (!times.length) return [];
    const first = startOfDay(times[0]);
    const last = startOfDay(now);
    // Long-lived projects would make a per-day walk from day one silly;
    // capping the window keeps this bounded while still covering "ALL"
    // for anything of this app's age.
    const from = Math.max(first, last - 730 * day);
    const out = [];
    let i = 0;
    let running = times.filter((t) => t < from).length;
    for (let d = from; d <= last; d += day) {
      const end = d + day;
      while (i < times.length && times[i] < end) { if (times[i] >= from) running += 1; i += 1; }
      out.push({ t: d, value: running });
    }
    return out;
  }

  const seriesByMetric = {
    players: cumulativeDaily(profiles),
    logs: cumulativeDaily(logs),
    reviews: cumulativeDaily(logs.filter((l) => l.review)),
  };

  function paintChart() {
    const host = qs('#chart-panel');
    if (!host) return;
    const metric = METRICS.find((m) => m.id === chartMetric) || METRICS[0];
    const keepRange = chartHandle?.range;
    host.innerHTML = `
      <div class="adm-metric-tabs" role="tablist">
        ${METRICS.map((m) => `<button class="adm-metric-tab${m.id === metric.id ? ' adm-metric-tab--on' : ''}"
            role="tab" aria-selected="${m.id === metric.id}" data-metric-tab="${m.id}">${esc(m.label)}</button>`).join('')}
      </div>
      ${stockChart('main', { title: metric.title, series: seriesByMetric[metric.id] })}`;
    chartHandle = wireStockChart(qs('.sc', host), {
      series: seriesByMetric[metric.id],
      format: (v) => fmtNum(v),
      defaultRange: keepRange || '1m',
    });
    qsa('[data-metric-tab]', host).forEach((btn) => btn.addEventListener('click', () => {
      chartMetric = btn.dataset.metricTab;
      paintChart();
    }));
  }
  paintChart();

  // --- activity: logs per day over the last 14 days ---
  const days = 14;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const activityBars = [];
  for (let d = days - 1; d >= 0; d--) {
    const from = startOfToday.getTime() - d * day;
    const to = from + day;
    const count = logs.filter((l) => { const t = new Date(l.created_at).getTime(); return t >= from && t < to; }).length;
    activityBars.push({ value: count, label: new Date(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
  }

  // --- status split ---
  const statusColor = { playing: 'var(--accent-bright)', played: 'var(--coral)', backlog: 'var(--ink-faint)', dropped: 'var(--violet)' };
  const statusSeg = ['playing', 'played', 'backlog', 'dropped'].map((s) => ({
    label: s[0].toUpperCase() + s.slice(1),
    value: logs.filter((l) => l.status === s).length,
    color: statusColor[s],
  }));

  // --- rating distribution (reuses the app's own histogram) ---
  const ratingCounts = {};
  let ratingTotal = 0;
  let ratingSum = 0;
  logs.forEach((l) => {
    if (!l.rating) return;
    const key = Number(l.rating).toFixed(1);
    ratingCounts[key] = (ratingCounts[key] || 0) + 1;
    ratingTotal += 1;
    ratingSum += Number(l.rating);
  });
  const avgRating = ratingTotal ? ratingSum / ratingTotal : null;

  // --- top games by logs ---
  const gameCounts = {};
  logs.forEach((l) => { if (l.game_id) gameCounts[l.game_id] = (gameCounts[l.game_id] || 0) + 1; });
  const topGameIds = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  let topGames = [];
  if (topGameIds.length) {
    const { data: gs } = await supabase.from('games').select('id, title, cover_url').in('id', topGameIds.map((g) => g[0]));
    const byId = Object.fromEntries((gs || []).map((g) => [g.id, g]));
    topGames = topGameIds.map(([gid, n]) => ({ game: byId[gid], count: n })).filter((r) => r.game);
  }

  // --- top players by logs ---
  const playerCounts = {};
  logs.forEach((l) => { if (l.user_id) playerCounts[l.user_id] = (playerCounts[l.user_id] || 0) + 1; });
  const byUser = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const topPlayers = Object.entries(playerCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([uid, n]) => ({ profile: byUser[uid], count: n })).filter((r) => r.profile);
  const topPlayerMax = Math.max(1, ...topPlayers.map((p) => p.count));

  // --- paint the analytics panels ---
  const panel = (title, meta, body) => `
    <div class="adm-panel">
      <div class="adm-panel__head">
        <span class="adm-panel__title">${esc(title)}</span>
        ${meta ? `<span class="adm-panel__meta">${meta}</span>` : ''}
      </div>
      ${body}
    </div>`;

  const analytics = qs('#analytics');
  if (!analytics) return;
  analytics.innerHTML = `
    ${panel('Activity · 14 days', `${logs7} this week`, barSeries(activityBars) + `<div class="adm-axis"><span>${esc(activityBars[0].label)}</span><span>today</span></div>`)}
    ${panel('Library status', `${logs.length} logs`, logs.length ? segBar(statusSeg) : '<p class="adm-hint" style="margin:0">No logs yet.</p>')}
    ${panel('Ratings', '', ratingHistogram(ratingCounts, { average: avgRating, total: ratingTotal }))}
    ${topGames.length ? panel('Top games', '', `<div class="adm-top">${topGames.map((r, i) => `
      <div class="adm-top__row">
        <span class="adm-top__rank">${i + 1}</span>
        ${r.game.cover_url ? `<img class="adm-top__poster" src="${esc(r.game.cover_url)}" alt="" loading="lazy">` : '<span class="adm-top__poster"></span>'}
        <span class="adm-top__name">${esc(r.game.title)}</span>
        <span class="adm-top__val">${r.count}</span>
      </div>`).join('')}</div>`) : ''}
    ${topPlayers.length ? panel('Most active', '', `<div class="adm-top">${topPlayers.map((r, i) => `
      <div class="adm-top__row">
        <span class="adm-top__rank">${i + 1}</span>
        ${avatarImg(r.profile, 28)}
        <span class="adm-top__name">${esc(r.profile.display_name || r.profile.username)}</span>
        <span class="adm-top__bar"><span class="adm-top__bar-fill" style="width:${Math.round(r.count / topPlayerMax * 100)}%"></span></span>
        <span class="adm-top__val">${r.count}</span>
      </div>`).join('')}</div>`) : ''}
  `;

  const hist = qs('.rating-histogram', analytics);
  if (hist) wireRatingHistogram(hist);

  // The daily bars carry real numbers, so they answer "which day was
  // that spike?" on tap rather than only on a desktop hover title.
  wireBars(analytics);

  const sync = qs('#last-sync');
  if (sync) sync.textContent = ` Last read ${new Date().toLocaleTimeString()}.`;
}

// Makes barSeries() columns tappable: the value and its date surface in
// a small readout above the bars instead of a native tooltip nobody sees
// on a phone.
function wireBars(scope) {
  qsa('.adm-bars', scope).forEach((bars) => {
    const readout = document.createElement('div');
    readout.className = 'adm-bars__readout';
    readout.innerHTML = '<span></span>';
    bars.parentElement.insertBefore(readout, bars);

    const cols = qsa('.adm-bars__col', bars);
    const show = (col) => {
      cols.forEach((c) => c.classList.toggle('adm-bars__col--on', c === col));
      readout.firstElementChild.textContent = col ? `${col.dataset.label} · ${col.dataset.value}` : '';
      readout.classList.toggle('adm-bars__readout--on', !!col);
    };
    cols.forEach((col) => {
      col.addEventListener('pointerenter', () => show(col));
      col.addEventListener('click', () => show(col));
    });
    bars.addEventListener('pointerleave', () => show(null));
  });
}

// ============================================================
// TRENDING
// ============================================================
SCREENS.trending = function trending() {
  paint(`
    ${header('Trending now', { back: true })}
    <main class="view-body">
      <div class="list-card" id="mode-card" style="display:block;padding:var(--space-3)">${spinner()}</div>
      <h2 class="section-heading">Featured games</h2>
      <button class="btn btn--accent btn--block" id="add-game">Add a game</button>
      <div id="list" style="margin-top:var(--space-3)">${spinner()}</div>
    </main>`);

  qs('#add-game').addEventListener('click', openGamePicker);
  paintTrendingMode();
  paintCurated();
};

async function getSetting(key, fallbackValue) {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? fallbackValue;
}

async function setSetting(key, value) {
  const { error } = await supabase.from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: state.user.id });
  if (error) throw error;
}

async function paintTrendingMode() {
  const host = qs('#mode-card');
  if (!host) return;

  // boot() already refuses to reach this screen without the migration,
  // but PostgREST's schema cache can lag a fresh one by a few seconds —
  // long enough to land here with the table "missing". Left unhandled
  // that threw mid-render and stranded the card on its spinner.
  let mode;
  try {
    mode = await getSetting('trending_mode', 'lead');
  } catch (err) {
    host.innerHTML = `<p class="adm-hint" style="margin:0">Couldn't read the trending setting — ${esc(err.message)}</p>`;
    return;
  }

  host.innerHTML = `
    <div class="adm-switch-row">
      <span class="adm-switch-row__text">
        <span class="adm-switch-row__title">Replace the live list</span>
        <span class="adm-switch-row__sub">${mode === 'replace'
          ? 'Only your picks show. IGDB fills any leftover slots.'
          : "Your picks lead, then IGDB's live popular list follows."}</span>
      </span>
      <button class="adm-switch" id="mode-switch" role="switch" aria-checked="${mode === 'replace'}"></button>
    </div>`;

  qs('#mode-switch').addEventListener('click', async (e) => {
    const next = e.currentTarget.getAttribute('aria-checked') === 'true' ? 'lead' : 'replace';
    try {
      await setSetting('trending_mode', next);
      paintTrendingMode();
      toast(next === 'replace' ? 'Your picks only' : 'Your picks lead', 'success');
    } catch (err) { fail(err); }
  });
}

async function paintCurated() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase
    .from('curated_trending')
    .select('id, position, game_id, games(id, title, cover_url, release_year)')
    .order('position', { ascending: true });

  if (error) { host.innerHTML = emptyState(error.message); return; }
  if (!data?.length) {
    host.innerHTML = emptyState('Nothing featured yet. Add a game and it shows up at the top of Trending now.', { icon: iconFlame() });
    return;
  }

  host.innerHTML = data.map((r, i) => `
    <div class="list-card adm-row" data-id="${r.id}" draggable="true">
      <span class="adm-drag" aria-hidden="true">${iconGrip()}</span>
      <span class="adm-pos">${i + 1}</span>
      ${r.games?.cover_url
        ? `<img class="adm-thumb" src="${esc(r.games.cover_url)}" alt="" loading="lazy">`
        : '<span class="adm-thumb"></span>'}
      <span class="adm-row__body">
        <span class="adm-row__title">${esc(r.games?.title || 'Missing game')}</span>
        <span class="adm-row__meta">${r.games?.release_year ? esc(r.games.release_year) : ''}</span>
      </span>
      <span class="adm-row__actions">
        <button class="icon-btn icon-btn--small" data-move="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${iconChevronUp()}</button>
        <button class="icon-btn icon-btn--small" data-move="down" ${i === data.length - 1 ? 'disabled' : ''} aria-label="Move down">${iconChevronDown()}</button>
        <button class="icon-btn icon-btn--small" data-remove aria-label="Remove">${iconTrash()}</button>
      </span>
    </div>`).join('');

  // Writes the whole list's positions in one go. Order is derived from
  // the DOM so drag and the arrow buttons share one code path.
  const persistOrder = async () => {
    const ids = qsa('.adm-row', host).map((el) => el.dataset.id);
    qsa('.adm-pos', host).forEach((el, i) => { el.textContent = i + 1; });
    try {
      await Promise.all(ids.map((id, i) =>
        supabase.from('curated_trending').update({ position: i }).eq('id', id)));
      toast('Order saved', 'success');
    } catch (err) { fail(err); }
  };

  qsa('[data-move]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const row = btn.closest('.adm-row');
    if (btn.dataset.move === 'up') row.previousElementSibling?.before(row);
    else row.nextElementSibling?.after(row);
    await persistOrder();
    paintCurated();
  }));

  // The arrows still work (and are the accessible path); dragging is the
  // faster one when a pick has to move more than a place or two.
  let dragged = null;
  qsa('.adm-row', host).forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      dragged = row;
      row.classList.add('adm-row--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.id);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('adm-row--dragging');
      qsa('.adm-row', host).forEach((r) => r.classList.remove('adm-row--dragover'));
      dragged = null;
      persistOrder();
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragged || dragged === row) return;
      row.classList.add('adm-row--dragover');
      // Insert before or after depending on which half is hovered, so a
      // row can be dropped at either end of its neighbour.
      const box = row.getBoundingClientRect();
      const after = e.clientY > box.top + box.height / 2;
      if (after) row.after(dragged); else row.before(dragged);
    });
    row.addEventListener('dragleave', () => row.classList.remove('adm-row--dragover'));
    row.addEventListener('drop', (e) => e.preventDefault());
  });

  qsa('[data-remove]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    if (!await confirmSheet({
      title: 'Remove from Trending?',
      sub: 'The game stays in the catalog — it just stops being featured.',
      confirmLabel: 'Remove', danger: true,
    })) return;
    const { error: delErr } = await supabase.from('curated_trending').delete().eq('id', id);
    if (delErr) return fail(delErr);
    toast('Removed', 'success');
    paintCurated();
  }));
}

function openGamePicker() {
  openSheet('Add a game', `
    <p class="modal__hint">Searches the catalog and IGDB. Picking one that isn't in the catalog yet adds it.</p>
    <label class="field adm-search"><span>Search</span>
      <input type="search" id="game-q" placeholder="Search any game…" autocomplete="off">
    </label>
    <div id="game-results"></div>`, (sheet) => {
    const input = qs('#game-q', sheet);
    const results = qs('#game-results', sheet);
    input.focus();

    let token = 0;
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ''; return; }
      results.innerHTML = spinner();
      const mine = ++token;
      timer = setTimeout(async () => {
        try {
          const { results: games } = await searchGamesEverywhere(q, 14);
          if (mine !== token) return; // a newer keystroke already won
          if (!games.length) { results.innerHTML = emptyState('Nothing matched that.'); return; }
          results.innerHTML = games.map((g, i) => `
            <button class="list-card adm-row" data-i="${i}">
              ${g.cover_url ? `<img class="adm-thumb" src="${esc(g.cover_url)}" alt="" loading="lazy">` : '<span class="adm-thumb"></span>'}
              <span class="adm-row__body">
                <span class="adm-row__title">${esc(g.title)}</span>
                <span class="adm-row__meta">${g.release_year ? esc(g.release_year) : ''}${g._source === 'local' ? ' · in catalog' : ''}</span>
              </span>
            </button>`).join('');

          qsa('[data-i]', results).forEach((btn) => btn.addEventListener('click', async () => {
            const game = games[Number(btn.dataset.i)];
            btn.disabled = true;
            try {
              // A remote (IGDB/RAWG) hit has no row in `games` yet, and
              // curated_trending.game_id is a real foreign key — so the
              // catalog row has to exist before it can be featured.
              const local = game._source === 'local' && game.id ? game : await addGame(game, state.user.id);
              const { count } = await supabase.from('curated_trending').select('*', { count: 'exact', head: true });
              const { error } = await supabase.from('curated_trending').insert({
                game_id: local.id, position: count ?? 0, created_by: state.user.id,
              });
              if (error) throw error;
              qs('.modal-overlay')?.remove();
              toast(`${game.title} featured`, 'success');
              paintCurated();
            } catch (err) {
              btn.disabled = false;
              fail(err, err?.code === '23505' ? 'That game is already featured' : 'Could not add that game');
            }
          }));
        } catch (err) {
          if (mine === token) results.innerHTML = emptyState('Search failed. Try again.');
          console.error(err);
        }
      }, 320);
    });
  });
}

// ============================================================
// NEWS
// ============================================================
SCREENS.news = function news() {
  paint(`
    ${header('News', { back: true })}
    <main class="view-body">
      <button class="btn btn--accent btn--block" id="new-post">Write a post</button>
      <div id="list" style="margin-top:var(--space-4)">${spinner()}</div>
    </main>`);
  qs('#new-post').addEventListener('click', () => openNewsEditor(null));
  paintNews();
};

async function paintNews() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase.from('custom_news').select('*').order('published_at', { ascending: false });
  if (error) { host.innerHTML = emptyState(error.message); return; }
  if (!data?.length) {
    host.innerHTML = emptyState("No posts yet. Anything you write here shows up in the app's News tab.", { icon: iconNewspaper() });
    return;
  }

  host.innerHTML = data.map((p) => `
    <div class="list-card adm-row" data-id="${p.id}">
      ${p.image_url ? `<img class="adm-thumb adm-thumb--wide" src="${esc(p.image_url)}" alt="" loading="lazy">` : '<span class="adm-thumb adm-thumb--wide"></span>'}
      <span class="adm-row__body">
        <span class="adm-row__title">${esc(p.title)}</span>
        <span class="adm-row__meta"${timeTitle(p.published_at)}>
          ${p.is_published ? '' : 'DRAFT · '}${p.pinned ? 'PINNED · ' : ''}${esc(p.source)} · ${esc(timeAgo(p.published_at))} ago
        </span>
      </span>
      <span class="adm-row__actions">
        <button class="icon-btn icon-btn--small" data-toggle aria-label="${p.is_published ? 'Unpublish' : 'Publish'}">${iconEye()}</button>
        <button class="icon-btn icon-btn--small" data-dupe aria-label="Duplicate">${iconCopyStack()}</button>
        <button class="icon-btn icon-btn--small" data-edit aria-label="Edit">${iconNote()}</button>
        <button class="icon-btn icon-btn--small" data-del aria-label="Delete">${iconTrash()}</button>
      </span>
    </div>`).join('');

  qsa('[data-edit]', host).forEach((btn) => btn.addEventListener('click', () => {
    openNewsEditor(data.find((p) => p.id === btn.closest('.adm-row').dataset.id));
  }));

  // Publish/unpublish without opening the editor — the single most
  // common thing to want to change about a post that already exists.
  qsa('[data-toggle]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const post = data.find((p) => p.id === btn.closest('.adm-row').dataset.id);
    const { error: e } = await supabase.from('custom_news').update({ is_published: !post.is_published }).eq('id', post.id);
    if (e) return fail(e);
    toast(post.is_published ? 'Moved to drafts' : 'Published', 'success');
    paintNews();
  }));

  // Copies a post as an unpublished draft, for the recurring formats
  // that only change a line or two between editions.
  qsa('[data-dupe]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const post = data.find((p) => p.id === btn.closest('.adm-row').dataset.id);
    const { error: e } = await supabase.from('custom_news').insert({
      title: `${post.title} (copy)`, summary: post.summary, image_url: post.image_url,
      source: post.source, link: post.link, is_published: false, pinned: post.pinned,
      created_by: state.user.id,
    });
    if (e) return fail(e);
    toast('Duplicated as a draft', 'success');
    paintNews();
  }));

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    if (!await confirmSheet({ title: 'Delete this post?', sub: 'It disappears from the News tab straight away.', confirmLabel: 'Delete', danger: true })) return;
    const { error: delErr } = await supabase.from('custom_news').delete().eq('id', id);
    if (delErr) return fail(delErr);
    toast('Deleted', 'success');
    paintNews();
  }));
}

function openNewsEditor(post) {
  const editing = !!post;
  openSheet(editing ? 'Edit post' : 'New post', `
    <p class="modal__hint">Appears in the app's News tab alongside the RSS feeds.</p>
    <label class="field"><span>Headline</span><input id="n-title" value="${esc(post?.title || '')}" placeholder="What happened?"></label>
    <label class="field"><span>Summary</span><textarea id="n-summary" placeholder="A sentence or two.">${esc(post?.summary || '')}</textarea></label>
    <label class="field"><span>Image URL</span><input id="n-image" value="${esc(post?.image_url || '')}" placeholder="https://…"></label>
    <label class="field"><span>Source label</span><input id="n-source" value="${esc(post?.source || 'PlayThruu')}" placeholder="PlayThruu"></label>
    <label class="field"><span>Link (optional)</span><input id="n-link" value="${esc(post?.link || '')}" placeholder="https://…"></label>
    <div class="adm-switch-row">
      <span class="adm-switch-row__text">
        <span class="adm-switch-row__title">Published</span>
        <span class="adm-switch-row__sub">Off keeps it as a draft only you can see.</span>
      </span>
      <button class="adm-switch" id="n-published" role="switch" aria-checked="${post ? !!post.is_published : true}"></button>
    </div>
    <div class="adm-switch-row">
      <span class="adm-switch-row__text">
        <span class="adm-switch-row__title">Pin to top</span>
        <span class="adm-switch-row__sub">Sits above the RSS articles instead of mixing in by date.</span>
      </span>
      <button class="adm-switch" id="n-pinned" role="switch" aria-checked="${post ? !!post.pinned : true}"></button>
    </div>
    <p class="adm-count-line" id="n-status"></p>
    <div class="adm-btn-row">
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn--accent" id="n-save">${editing ? 'Save' : 'Publish'}</button>
    </div>`, (sheet, close) => {
    qsa('.adm-switch', sheet).forEach((sw) => sw.addEventListener('click', () => {
      sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    }));

    // A new post is kept in localStorage as it's typed, so closing the
    // sheet by accident (or the WebView being killed in the background)
    // doesn't lose the draft. Only for new posts: an edit already has a
    // saved copy in the database to fall back to.
    const DRAFT_KEY = 'playthruu_admin_news_draft';
    const fields = ['n-title', 'n-summary', 'n-image', 'n-source', 'n-link'];
    const status = qs('#n-status', sheet);

    if (!editing) {
      try {
        const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (saved && Object.values(saved).some(Boolean)) {
          fields.forEach((f) => { if (saved[f]) qs(`#${f}`, sheet).value = saved[f]; });
          status.textContent = 'Restored an unsaved draft.';
        }
      } catch { /* nothing usable stored */ }

      let saveTimer;
      const stash = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const snap = {};
          fields.forEach((f) => { snap[f] = qs(`#${f}`, sheet).value; });
          try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snap)); } catch { /* storage full or blocked */ }
          status.textContent = `Draft saved ${new Date().toLocaleTimeString()}`;
        }, 600);
      };
      fields.forEach((f) => qs(`#${f}`, sheet).addEventListener('input', stash));
    }
    sheet.dataset.draftKey = DRAFT_KEY;

    qs('[data-act="cancel"]', sheet).addEventListener('click', close);

    qs('#n-save', sheet).addEventListener('click', async () => {
      const title = qs('#n-title', sheet).value.trim();
      if (!title) { toast('A headline is required', 'error'); return; }
      const payload = {
        title,
        summary: qs('#n-summary', sheet).value.trim() || null,
        image_url: qs('#n-image', sheet).value.trim() || null,
        source: qs('#n-source', sheet).value.trim() || 'PlayThruu',
        link: qs('#n-link', sheet).value.trim() || null,
        is_published: qs('#n-published', sheet).getAttribute('aria-checked') === 'true',
        pinned: qs('#n-pinned', sheet).getAttribute('aria-checked') === 'true',
      };
      const btn = qs('#n-save', sheet);
      btn.disabled = true;
      try {
        const { error } = editing
          ? await supabase.from('custom_news').update(payload).eq('id', post.id)
          : await supabase.from('custom_news').insert({ ...payload, created_by: state.user.id });
        if (error) throw error;
        // The draft has become a real row; keeping it would re-restore
        // itself into the next empty editor.
        if (!editing) { try { localStorage.removeItem(sheet.dataset.draftKey); } catch { /* nothing to clear */ } }
        close();
        toast(editing ? 'Saved' : 'Published', 'success');
        paintNews();
      } catch (err) {
        btn.disabled = false;
        fail(err);
      }
    });
  });
}

// ============================================================
// ANNOUNCEMENT
// ============================================================
SCREENS.announce = function announce() {
  paint(`
    ${header('Announcement', { back: true })}
    <main class="view-body">
      <label class="field"><span>Message</span>
        <textarea id="a-message" placeholder="Servers are getting an upgrade tonight…"></textarea>
      </label>
      <label class="field"><span>Link (optional)</span><input id="a-link" placeholder="https://…"></label>
      <button class="btn btn--accent btn--block" id="a-post">Post banner</button>
      <p class="adm-hint">Shows at the top of the feed for everyone until you switch it off.</p>
      <h2 class="section-heading">Posted</h2>
      <div id="list">${spinner()}</div>
    </main>`);

  qs('#a-post').addEventListener('click', async () => {
    const message = qs('#a-message').value.trim();
    if (!message) { toast('Write a message first', 'error'); return; }
    const btn = qs('#a-post');
    btn.disabled = true;
    const { error } = await supabase.from('announcements').insert({
      message, link: qs('#a-link').value.trim() || null, created_by: state.user.id,
    });
    btn.disabled = false;
    if (error) return fail(error);
    qs('#a-message').value = '';
    qs('#a-link').value = '';
    toast('Banner is live', 'success');
    paintAnnouncements();
  });

  paintAnnouncements();
};

async function paintAnnouncements() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
  if (error) { host.innerHTML = emptyState(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyState('No banners yet.', { icon: iconMegaphone() }); return; }

  host.innerHTML = data.map((a) => `
    <div class="list-card adm-row" data-id="${a.id}">
      <span class="adm-row__body">
        <span class="adm-row__title adm-row__title--wrap">${esc(a.message)}</span>
        <span class="adm-row__meta">${a.is_active ? 'LIVE' : 'OFF'} · ${esc(timeAgo(a.created_at))} ago</span>
      </span>
      <span class="adm-row__actions">
        <button class="icon-btn icon-btn--small" data-toggle aria-label="Toggle">${iconEye()}</button>
        <button class="icon-btn icon-btn--small" data-del aria-label="Delete">${iconTrash()}</button>
      </span>
    </div>`).join('');

  qsa('[data-toggle]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    const current = data.find((a) => a.id === id);
    const { error: upErr } = await supabase.from('announcements').update({ is_active: !current.is_active }).eq('id', id);
    if (upErr) return fail(upErr);
    paintAnnouncements();
  }));

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    if (!await confirmSheet({ title: 'Delete banner?', confirmLabel: 'Delete', danger: true })) return;
    const { error: delErr } = await supabase.from('announcements').delete().eq('id', id);
    if (delErr) return fail(delErr);
    paintAnnouncements();
  }));
}

// ============================================================
// ACTIVITY
// ============================================================
let activityFilter = 'all';

SCREENS.activity = function activity() {
  paint(`
    ${header('Activity', { back: true })}
    <main class="view-body">
      <p class="adm-hint" style="margin-top:0">The most recent public logs across the whole app.</p>
      <div class="adm-chips" id="a-filters" style="margin-top:var(--space-3)">
        <button class="adm-chip" data-filter="all">All</button>
        <button class="adm-chip" data-filter="playing">Playing</button>
        <button class="adm-chip" data-filter="played">Played</button>
        <button class="adm-chip" data-filter="reviews">With reviews</button>
        <button class="adm-chip" data-filter="loved">Loved</button>
      </div>
      <div id="list" style="margin-top:var(--space-3)">${skeletonRows(6)}</div>
    </main>`);
  const sync = () => qsa('#a-filters [data-filter]').forEach((b) => b.classList.toggle('adm-chip--on', b.dataset.filter === activityFilter));
  sync();
  qsa('#a-filters [data-filter]').forEach((b) => b.addEventListener('click', () => {
    activityFilter = b.dataset.filter; sync(); paintActivity();
  }));
  paintActivity();
};

async function paintActivity() {
  const host = qs('#list');
  if (!host) return;
  let sel = supabase
    .from('logs')
    .select('id, status, rating, review, loved, created_at, games!logs_game_id_fkey(title, cover_url), profiles!logs_user_id_fkey(username, display_name, avatar_url)')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(60);
  if (activityFilter === 'playing' || activityFilter === 'played') sel = sel.eq('status', activityFilter);
  if (activityFilter === 'reviews') sel = sel.not('review', 'is', null);
  if (activityFilter === 'loved') sel = sel.eq('loved', true);

  const { data, error } = await sel;

  if (error) { host.innerHTML = emptyState(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyState('Nothing logged yet.', { icon: iconDiary() }); return; }

  host.innerHTML = data.map((l) => {
    const who = l.profiles?.display_name || l.profiles?.username || 'someone';
    const marks = [
      l.rating ? `${l.rating}★` : '',
      l.loved ? 'loved' : '',
      l.review ? 'review' : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="list-card adm-row">
        ${l.games?.cover_url
          ? `<img class="adm-thumb" src="${esc(l.games.cover_url)}" alt="" loading="lazy">`
          : '<span class="adm-thumb"></span>'}
        <span class="adm-row__body">
          <span class="adm-row__title">${esc(l.games?.title || 'Unknown game')}</span>
          <span class="adm-row__meta">${esc(who)} · ${esc(l.status || '')}${marks ? ` · ${esc(marks)}` : ''}</span>
          <span class="adm-row__meta">${esc(timeAgo(l.created_at))} ago</span>
        </span>
      </div>`;
  }).join('');
}

// ============================================================
// PEOPLE
// ============================================================
const peopleView = { query: '', sort: 'seen', filter: 'all' };

SCREENS.people = function people() {
  paint(`
    ${header('People', { back: true })}
    <main class="view-body">
      <div class="segmented segmented--wide" id="sort">
        <button class="segmented__item" data-sort="seen">Last seen</button>
        <button class="segmented__item" data-sort="new">Newest</button>
        <button class="segmented__item" data-sort="name">A–Z</button>
      </div>
      <label class="field adm-search"><span>Search</span>
        <input type="search" id="u-q" placeholder="Username or name…" autocomplete="off" value="${esc(peopleView.query)}">
      </label>
      <div class="adm-chips" id="u-filters">
        <button class="adm-chip" data-filter="all">Everyone</button>
        <button class="adm-chip" data-filter="online">Online</button>
        <button class="adm-chip" data-filter="admin">Admins</button>
        <button class="adm-chip" data-filter="suspended">Suspended</button>
      </div>
      <div class="adm-toolbar">
        <button class="btn btn--pill" id="u-export">Export CSV</button>
      </div>
      <p class="adm-count-line" id="u-count"></p>
      <div id="list">${skeletonRows(6)}</div>
    </main>`);

  const sync = () => {
    qsa('[data-sort]').forEach((b) => b.classList.toggle('segmented__item--active', b.dataset.sort === peopleView.sort));
    qsa('#u-filters [data-filter]').forEach((b) => b.classList.toggle('adm-chip--on', b.dataset.filter === peopleView.filter));
  };
  sync();

  let timer;
  qs('#u-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { peopleView.query = e.target.value.trim(); paintPeople(); }, 260);
  });
  qsa('[data-sort]').forEach((btn) => btn.addEventListener('click', () => {
    peopleView.sort = btn.dataset.sort; sync(); paintPeople();
  }));
  qsa('#u-filters [data-filter]').forEach((btn) => btn.addEventListener('click', () => {
    peopleView.filter = btn.dataset.filter; sync(); paintPeople();
  }));
  qs('#u-export').addEventListener('click', exportPeople);

  paintPeople();
};

let lastPeople = { rows: [], seen: {} };

async function exportPeople() {
  downloadCsv(`playthruu-people-${new Date().toISOString().slice(0, 10)}.csv`,
    lastPeople.rows.map((p) => ({
      id: p.id, username: p.username, display_name: p.display_name ?? '',
      admin: p.is_admin ? 'yes' : 'no', suspended: p.is_suspended ? 'yes' : 'no',
      joined: p.created_at, last_seen: lastPeople.seen[p.id] ?? '',
    })));
}

async function paintPeople() {
  const host = qs('#list');
  if (!host) return;
  const { query, sort, filter } = peopleView;

  let q = supabase.from('profiles')
    .select('id, username, display_name, avatar_url, is_admin, is_suspended, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (query) q = q.or(`username.ilike.%${query}%,display_name.ilike.%${query}%`);
  if (filter === 'admin') q = q.eq('is_admin', true);
  if (filter === 'suspended') q = q.eq('is_suspended', true);

  const { data, error } = await q;
  if (error) { host.innerHTML = emptyState(error.message); return; }

  // Presence comes from a second query keyed on the ids just returned,
  // rather than a PostgREST embed — the embed needs the exact foreign
  // key constraint name, and this doesn't care what it's called.
  const seen = await getPresenceFor((data || []).map((p) => p.id));

  let rows = [...(data || [])];
  if (filter === 'online') rows = rows.filter((p) => presenceOf(seen[p.id]).online);

  if (sort === 'seen') {
    // Never-seen accounts sort last rather than first, which is what
    // treating a missing timestamp as 0 would otherwise do.
    rows.sort((a, b) => new Date(seen[b.id] || 0) - new Date(seen[a.id] || 0));
  } else if (sort === 'name') {
    rows.sort((a, b) => (a.display_name || a.username || '').localeCompare(b.display_name || b.username || ''));
  }

  lastPeople = { rows, seen };
  const countEl = qs('#u-count');
  if (countEl) {
    const onlineNow = rows.filter((p) => presenceOf(seen[p.id]).online).length;
    countEl.textContent = `${fmtNum(rows.length)} shown · ${onlineNow} online`;
  }

  if (!rows.length) { host.innerHTML = emptyState('Nobody matched that.', { icon: iconUser() }); return; }

  host.innerHTML = rows.map((p) => `
    <div class="list-card adm-row" data-id="${p.id}" data-bulk-row>
      ${checkbox()}
      ${avatarImg(p, 40)}
      <span class="adm-row__body">
        <span class="adm-row__title">${esc(p.display_name || p.username)}${p.is_admin ? ' · ADMIN' : ''}${p.is_suspended ? ' · SUSPENDED' : ''}</span>
        <span class="adm-row__meta">@${esc(p.username)} · joined ${esc(timeAgo(p.created_at))} ago</span>
        <span class="adm-row__meta"${timeTitle(seen[p.id])}>${presenceHtml(seen[p.id])}</span>
      </span>
      <span class="adm-row__actions">
        <button class="icon-btn icon-btn--small" data-manage aria-label="Manage">${iconChevronRight()}</button>
      </span>
    </div>`).join('');

  bulkSelect(host, {
    idOf: (row) => row.dataset.id,
    label: 'people',
    actions: [
      {
        label: 'Suspend', danger: true,
        run: async (ids) => {
          const safe = ids.filter((id) => id !== state.user.id);
          if (!safe.length) { toast("You can't suspend your own account", 'error'); return; }
          if (!await confirmSheet({ title: `Suspend ${safe.length} accounts?`, sub: 'They stop being able to post anywhere in the app.', confirmLabel: 'Suspend', danger: true })) return;
          const { error: e } = await supabase.from('profiles').update({ is_suspended: true }).in('id', safe);
          if (e) return fail(e);
          toast(`${safe.length} suspended`, 'success');
          paintPeople();
        },
      },
      {
        label: 'Unsuspend',
        run: async (ids) => {
          const { error: e } = await supabase.from('profiles').update({ is_suspended: false }).in('id', ids);
          if (e) return fail(e);
          toast(`${ids.length} restored`, 'success');
          paintPeople();
        },
      },
    ],
  });

  qsa('[data-manage]', host).forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.closest('.adm-row').dataset.id;
    openUserSheet(rows.find((p) => p.id === id), seen[id]);
  }));
}

function openUserSheet(user, lastSeenAt) {
  const isSelf = user.id === state.user.id;
  openSheet(user.display_name || user.username, `
    <p class="modal__hint">@${esc(user.username)} · ${presenceHtml(lastSeenAt)} · joined ${esc(timeAgo(user.created_at))} ago</p>
    <div class="stat-card-row" id="u-stats">
      <div class="stat-card stat-card--grey"><b>—</b><span>Logs</span></div>
      <div class="stat-card stat-card--grey"><b>—</b><span>Reviews</span></div>
      <div class="stat-card stat-card--grey"><b>—</b><span>Lists</span></div>
    </div>
    <div class="adm-btn-row" style="margin-top:0">
      <button class="btn btn--pill" id="u-view">Open profile</button>
      <button class="btn btn--pill" id="u-copy">Copy id</button>
    </div>
    <div class="adm-switch-row">
      <span class="adm-switch-row__text">
        <span class="adm-switch-row__title">Suspended</span>
        <span class="adm-switch-row__sub">Blocks them from posting anywhere in the app.</span>
      </span>
      <button class="adm-switch" id="u-susp" role="switch" aria-checked="${!!user.is_suspended}" ${isSelf ? 'disabled' : ''}></button>
    </div>
    <div class="adm-switch-row">
      <span class="adm-switch-row__text">
        <span class="adm-switch-row__title">Admin</span>
        <span class="adm-switch-row__sub">Full access to this control room.</span>
      </span>
      <button class="adm-switch" id="u-admin" role="switch" aria-checked="${!!user.is_admin}" ${isSelf ? 'disabled' : ''}></button>
    </div>
    ${isSelf ? `<p class="adm-hint">You can't suspend or demote your own account here — that's the one lock stopping you getting shut out of your own admin app.</p>` : ''}
    <div class="adm-btn-row"><button class="btn btn--block" data-act="close">Done</button></div>`, (sheet, close) => {
    qs('[data-act="close"]', sheet).addEventListener('click', close);
    qs('#u-copy', sheet).addEventListener('click', () => copy(user.id, 'User id copied'));
    qs('#u-view', sheet).addEventListener('click', () => {
      window.open(`../#/profile/${encodeURIComponent(user.username)}`, '_blank', 'noopener');
    });

    // Three head counts, so a decision about an account can be made with
    // some sense of what it has actually done rather than from a name.
    (async () => {
      const [logs, reviews, lists] = await Promise.all([
        supabase.from('logs').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('logs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).not('review', 'is', null),
        supabase.from('lists').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ]);
      const host = qs('#u-stats', sheet);
      if (!host) return; // sheet closed while these were in flight
      const cells = qsa('b', host);
      [logs.count, reviews.count, lists.count].forEach((n, i) => {
        if (cells[i]) countUp(cells[i], n ?? 0, { format: fmtNum });
      });
    })();

    if (isSelf) return;

    const flip = async (el, column) => {
      const next = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(next));
      const { error } = await supabase.from('profiles').update({ [column]: next }).eq('id', user.id);
      if (error) {
        el.setAttribute('aria-checked', String(!next));
        return fail(error);
      }
      user[column] = next;
      toast('Saved', 'success');
      paintPeople();
    };

    qs('#u-susp', sheet).addEventListener('click', (e) => flip(e.currentTarget, 'is_suspended'));
    qs('#u-admin', sheet).addEventListener('click', (e) => flip(e.currentTarget, 'is_admin'));
  });
}

// ============================================================
// REPORTS
// ============================================================
let reportsFilter = 'open';

SCREENS.reports = function reports() {
  paint(`
    ${header('Reports', { back: true })}
    <main class="view-body">
      <div class="adm-chips" id="r-filters">
        <button class="adm-chip" data-filter="open">Open</button>
        <button class="adm-chip" data-filter="resolved">Resolved</button>
        <button class="adm-chip" data-filter="all">All</button>
      </div>
      <p class="adm-count-line" id="r-count"></p>
      <div id="list">${skeletonRows(5, { thumb: false })}</div>
    </main>`);
  const sync = () => qsa('#r-filters [data-filter]').forEach((b) => b.classList.toggle('adm-chip--on', b.dataset.filter === reportsFilter));
  sync();
  qsa('#r-filters [data-filter]').forEach((b) => b.addEventListener('click', () => {
    reportsFilter = b.dataset.filter; sync(); paintReports();
  }));
  paintReports();
};

async function paintReports() {
  const host = qs('#list');
  if (!host) return;
  let q = supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(120);
  if (reportsFilter === 'open') q = q.neq('status', 'resolved');
  if (reportsFilter === 'resolved') q = q.eq('status', 'resolved');

  const { data, error } = await q;
  if (error) { host.innerHTML = emptyState(error.message); return; }

  const countEl = qs('#r-count');
  if (countEl) countEl.textContent = `${fmtNum((data || []).length)} ${reportsFilter === 'all' ? 'total' : reportsFilter}`;

  if (!data?.length) {
    host.innerHTML = emptyState(reportsFilter === 'open' ? 'Nothing open. Quiet night.' : 'Nothing here.', { icon: iconFlag() });
    return;
  }

  const reporterIds = [...new Set(data.map((r) => r.reporter_id).filter(Boolean))];
  let names = {};
  if (reporterIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, username').in('id', reporterIds);
    names = Object.fromEntries((profs || []).map((p) => [p.id, p.username]));
  }

  host.innerHTML = data.map((r) => `
    <div class="list-card adm-row" data-id="${r.id}" data-bulk-row>
      ${r.status === 'resolved' ? '' : checkbox()}
      <span class="adm-row__body">
        <span class="adm-row__title adm-row__title--wrap">${esc(r.reason || 'No reason given')}</span>
        <span class="adm-row__meta"${timeTitle(r.created_at)}>${r.status === 'resolved' ? 'RESOLVED' : 'OPEN'} · ${esc(r.target_type || 'item')} · @${esc(names[r.reporter_id] || 'unknown')} · ${esc(timeAgo(r.created_at))} ago</span>
      </span>
      ${r.status === 'resolved' ? `
        <span class="adm-row__actions">
          <button class="icon-btn icon-btn--small" data-reopen aria-label="Reopen">${iconEye()}</button>
        </span>` : `
        <span class="adm-row__actions">
          <button class="icon-btn icon-btn--small" data-resolve aria-label="Resolve">${iconCheck()}</button>
        </span>`}
    </div>`).join('');

  bulkSelect(host, {
    idOf: (row) => row.dataset.id,
    label: 'reports',
    actions: [{
      label: 'Resolve all',
      run: async (ids) => {
        const { error: e } = await supabase.from('reports').update({ status: 'resolved' }).in('id', ids);
        if (e) return fail(e);
        toast(`${ids.length} resolved`, 'success');
        paintReports();
      },
    }],
  });

  const setStatus = async (id, status) => {
    const { error: upErr } = await supabase.from('reports').update({ status }).eq('id', id);
    if (upErr) return fail(upErr);
    toast(status === 'resolved' ? 'Resolved' : 'Reopened', 'success');
    paintReports();
  };
  qsa('[data-resolve]', host).forEach((btn) => btn.addEventListener('click', () => setStatus(btn.closest('.adm-row').dataset.id, 'resolved')));
  qsa('[data-reopen]', host).forEach((btn) => btn.addEventListener('click', () => setStatus(btn.closest('.adm-row').dataset.id, 'open')));
}

// ============================================================
// COMMENTS
// ============================================================
let commentsQuery = '';

SCREENS.comments = function comments() {
  paint(`
    ${header('Comments', { back: true })}
    <main class="view-body">
      <p class="adm-hint" style="margin-top:0">The most recent comments across the app. Deleting one is permanent.</p>
      <label class="field adm-search"><span>Search</span>
        <input type="search" id="c-q" placeholder="Find a phrase…" autocomplete="off" value="${esc(commentsQuery)}">
      </label>
      <p class="adm-count-line" id="c-count"></p>
      <div id="list" style="margin-top:var(--space-3)">${skeletonRows(6, { thumb: false })}</div>
    </main>`);
  let timer;
  qs('#c-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { commentsQuery = e.target.value.trim(); paintComments(); }, 260);
  });
  paintComments();
};

async function paintComments() {
  const host = qs('#list');
  if (!host) return;
  let sel = supabase
    .from('comments').select('id, body, created_at, user_id, log_id')
    .order('created_at', { ascending: false }).limit(120);
  if (commentsQuery) sel = sel.ilike('body', `%${commentsQuery}%`);
  const { data, error } = await sel;

  if (error) { host.innerHTML = emptyState(error.message); return; }
  const countEl = qs('#c-count');
  if (countEl) countEl.textContent = `${fmtNum((data || []).length)} shown`;
  if (!data?.length) { host.innerHTML = emptyState('No comments yet.', { icon: iconMessage() }); return; }

  const authorIds = [...new Set(data.map((c) => c.user_id).filter(Boolean))];
  let authors = {};
  if (authorIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', authorIds);
    authors = Object.fromEntries((profs || []).map((p) => [p.id, p]));
  }

  host.innerHTML = data.map((c) => {
    const who = authors[c.user_id];
    return `
      <div class="list-card adm-row" data-id="${c.id}" data-bulk-row>
        ${checkbox()}
        ${avatarImg(who || {}, 36)}
        <span class="adm-row__body">
          <span class="adm-row__title adm-row__title--wrap">${esc(c.body)}</span>
          <span class="adm-row__meta"${timeTitle(c.created_at)}>@${esc(who?.username || 'unknown')} · ${esc(timeAgo(c.created_at))} ago</span>
        </span>
        <span class="adm-row__actions">
          <button class="icon-btn icon-btn--small" data-del aria-label="Delete">${iconTrash()}</button>
        </span>
      </div>`;
  }).join('');

  bulkSelect(host, {
    idOf: (row) => row.dataset.id,
    label: 'comments',
    actions: [{
      label: 'Delete', danger: true,
      run: async (ids) => {
        if (!await confirmSheet({ title: `Delete ${ids.length} comments?`, sub: 'They disappear for everyone, permanently.', confirmLabel: 'Delete', danger: true })) return;
        const { error: e } = await supabase.from('comments').delete().in('id', ids);
        if (e) return fail(e);
        toast(`${ids.length} deleted`, 'success');
        paintComments();
      },
    }],
  });

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const row = btn.closest('.adm-row');
    const id = row.dataset.id;
    if (!await confirmSheet({ title: 'Delete this comment?', sub: 'It disappears for everyone, permanently.', confirmLabel: 'Delete', danger: true })) return;
    row.style.display = 'none';
    undoable({
      message: 'Comment deleted',
      onCommit: async () => {
        const { error: delErr } = await supabase.from('comments').delete().eq('id', id);
        if (delErr) throw delErr;
        paintComments();
      },
      onUndo: () => { row.style.display = ''; },
    });
  }));
}

// ============================================================
// GAMES
// ============================================================
const gamesView = { query: '', filter: 'all', sort: 'new', page: 0 };
const GAMES_PAGE = 50;

SCREENS.games = function games() {
  paint(`
    ${header('Games', { back: true })}
    <main class="view-body">
      <label class="field adm-search"><span>Search the catalog</span>
        <input type="search" id="g-q" placeholder="Title…" autocomplete="off" value="${esc(gamesView.query)}">
      </label>
      <div class="adm-chips" id="g-filters">
        <button class="adm-chip" data-filter="all">All</button>
        <button class="adm-chip" data-filter="visible">Visible</button>
        <button class="adm-chip" data-filter="hidden">Hidden</button>
        <button class="adm-chip" data-filter="nocover">No cover</button>
      </div>
      <div class="adm-chips" id="g-sorts">
        <button class="adm-chip" data-sort="new">Newest</button>
        <button class="adm-chip" data-sort="title">A–Z</button>
        <button class="adm-chip" data-sort="year">By year</button>
      </div>
      <div class="adm-toolbar">
        <button class="btn btn--pill" id="g-export">Export CSV</button>
      </div>
      <p class="adm-count-line" id="g-count"></p>
      <div id="list">${skeletonRows(6)}</div>
      <div id="g-more"></div>
      <p class="adm-hint">Hiding keeps the row (and everyone's logs of it) but pulls the game out of search and trending. Deleting removes it for good.</p>
    </main>`);

  const syncChips = () => {
    qsa('#g-filters [data-filter]').forEach((b) => b.classList.toggle('adm-chip--on', b.dataset.filter === gamesView.filter));
    qsa('#g-sorts [data-sort]').forEach((b) => b.classList.toggle('adm-chip--on', b.dataset.sort === gamesView.sort));
  };
  syncChips();

  let timer;
  qs('#g-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { gamesView.query = e.target.value.trim(); gamesView.page = 0; paintGames(); }, 260);
  });
  qsa('#g-filters [data-filter]').forEach((b) => b.addEventListener('click', () => {
    gamesView.filter = b.dataset.filter; gamesView.page = 0; syncChips(); paintGames();
  }));
  qsa('#g-sorts [data-sort]').forEach((b) => b.addEventListener('click', () => {
    gamesView.sort = b.dataset.sort; gamesView.page = 0; syncChips(); paintGames();
  }));
  qs('#g-export').addEventListener('click', exportGames);

  paintGames();
};

function gamesQuery({ head = false } = {}) {
  let q = supabase.from('games').select(
    head ? 'id' : 'id, title, cover_url, release_year, is_hidden, created_at, igdb_id, rawg_id',
    head ? { count: 'exact', head: true } : undefined,
  );
  if (gamesView.query) q = q.ilike('title', `%${gamesView.query}%`);
  if (gamesView.filter === 'visible') q = q.or('is_hidden.is.null,is_hidden.eq.false');
  if (gamesView.filter === 'hidden') q = q.eq('is_hidden', true);
  if (gamesView.filter === 'nocover') q = q.is('cover_url', null);
  if (head) return q;
  if (gamesView.sort === 'title') q = q.order('title', { ascending: true });
  else if (gamesView.sort === 'year') q = q.order('release_year', { ascending: false, nullsFirst: false });
  else q = q.order('created_at', { ascending: false });
  return q;
}

async function exportGames() {
  const { data, error } = await gamesQuery().limit(2000);
  if (error) return fail(error);
  downloadCsv(`playthruu-games-${new Date().toISOString().slice(0, 10)}.csv`,
    (data || []).map((g) => ({
      id: g.id, title: g.title, year: g.release_year ?? '',
      hidden: g.is_hidden ? 'yes' : 'no', igdb_id: g.igdb_id ?? '',
      rawg_id: g.rawg_id ?? '', cover_url: g.cover_url ?? '', added: g.created_at,
    })));
}

// `append` keeps what's on screen and adds the next page under it, which
// is what the Load more button wants; a fresh filter repaints instead.
async function paintGames({ append = false } = {}) {
  const host = qs('#list');
  if (!host) return;
  if (!append) host.innerHTML = skeletonRows(6);

  const from = gamesView.page * GAMES_PAGE;
  const [{ data, error }, countRes] = await Promise.all([
    gamesQuery().range(from, from + GAMES_PAGE - 1),
    append ? Promise.resolve(null) : gamesQuery({ head: true }),
  ]);
  if (error) { host.innerHTML = emptyState(error.message); return; }

  const countEl = qs('#g-count');
  if (countEl && countRes) countEl.textContent = `${fmtNum(countRes.count ?? 0)} games`;

  if (!append && !data?.length) {
    host.innerHTML = emptyState('No games matched.', { icon: iconGamepad() });
    qs('#g-more').innerHTML = '';
    return;
  }

  const rowsHtml = data.map((g) => `
    <div class="list-card adm-row" data-id="${g.id}" data-bulk-row>
      ${checkbox()}
      ${g.cover_url ? `<img class="adm-thumb" src="${esc(g.cover_url)}" alt="" loading="lazy">` : '<span class="adm-thumb"></span>'}
      <span class="adm-row__body">
        <span class="adm-row__title">${esc(g.title)}${g.is_hidden ? ' · HIDDEN' : ''}</span>
        <span class="adm-row__meta"${timeTitle(g.created_at)}>${g.release_year ? esc(g.release_year) : 'no year'}${g.cover_url ? '' : ' · no cover'}</span>
      </span>
      <span class="adm-row__actions">
        <button class="icon-btn icon-btn--small" data-edit aria-label="Edit">${iconNote()}</button>
        <button class="icon-btn icon-btn--small" data-hide aria-label="Hide">${iconEye()}</button>
        <button class="icon-btn icon-btn--small" data-del aria-label="Delete">${iconTrash()}</button>
      </span>
    </div>`).join('');

  if (append) host.insertAdjacentHTML('beforeend', rowsHtml);
  else host.innerHTML = rowsHtml;

  qs('#g-more').innerHTML = data.length === GAMES_PAGE
    ? `<button class="btn btn--block" id="g-load">Load more</button>` : '';
  qs('#g-load')?.addEventListener('click', () => { gamesView.page += 1; paintGames({ append: true }); });

  wireGameRows(host);
}

// Re-wired after every paint (including an append), so newly added rows
// get their handlers too.
function wireGameRows(host) {
  const all = qsa('.adm-row', host);
  const byId = (id) => all.find((r) => r.dataset.id === id);

  bulkSelect(host, {
    idOf: (row) => row.dataset.id,
    label: 'games',
    actions: [
      {
        label: 'Hide',
        run: async (ids) => {
          const { error } = await supabase.from('games').update({ is_hidden: true }).in('id', ids);
          if (error) return fail(error);
          toast(`${ids.length} hidden`, 'success');
          paintGames();
        },
      },
      {
        label: 'Unhide',
        run: async (ids) => {
          const { error } = await supabase.from('games').update({ is_hidden: false }).in('id', ids);
          if (error) return fail(error);
          toast(`${ids.length} visible again`, 'success');
          paintGames();
        },
      },
      {
        label: 'Delete', danger: true,
        run: async (ids) => {
          if (!await typeToConfirm({
            title: `Delete ${ids.length} games?`,
            sub: 'Every log, review and list entry pointing at them goes too. There is no undo for this one.',
            word: 'delete', confirmLabel: `Delete ${ids.length}`,
          })) return;
          const { error } = await supabase.from('games').delete().in('id', ids);
          if (error) return fail(error);
          toast(`${ids.length} deleted`, 'success');
          paintGames();
        },
      },
    ],
  });

  qsa('[data-edit]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    const { data: game } = await supabase.from('games').select('*').eq('id', id).maybeSingle();
    if (game) openGameEditor(game);
  }));

  qsa('[data-hide]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const row = btn.closest('.adm-row');
    const id = row.dataset.id;
    const nowHidden = !row.querySelector('.adm-row__title').textContent.includes('· HIDDEN');
    const { error } = await supabase.from('games').update({ is_hidden: nowHidden }).eq('id', id);
    if (error) return fail(error);
    toast(nowHidden ? 'Hidden' : 'Visible again', 'success');
    paintGames();
  }));

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const row = btn.closest('.adm-row');
    const id = row.dataset.id;
    const title = row.querySelector('.adm-row__title').textContent.replace(' · HIDDEN', '');
    if (!await confirmSheet({
      title: `Delete ${title}?`,
      sub: "Every log, review and list entry pointing at this game goes with it. Hiding is usually what you want instead.",
      confirmLabel: 'Delete for good', danger: true,
    })) return;
    // Vanishes immediately and only actually deletes once the undo
    // window closes, so a misfire costs nothing.
    row.style.display = 'none';
    undoable({
      message: `Deleted ${title}`,
      onCommit: async () => {
        const { error } = await supabase.from('games').delete().eq('id', id);
        if (error) throw error;
        paintGames();
      },
      onUndo: () => { const r = byId(id); if (r) r.style.display = ''; },
    });
  }));
}

// IGDB's metadata is wrong often enough to be worth a fix-up screen —
// a mis-scraped year or a missing cover otherwise sticks forever.
function openGameEditor(game) {
  openSheet('Edit game', `
    <p class="modal__hint">Corrects what the catalog stores. Everyone's logs of this game keep pointing at it.</p>
    <div class="adm-editor-preview">
      <img class="adm-thumb adm-thumb--big" id="g-preview" src="${esc(game.cover_url || '')}" alt=""
           onerror="this.classList.add('is-broken')">
      <span class="adm-editor-preview__meta">
        <span class="adm-row__sub">IGDB ${game.igdb_id ?? '—'} · RAWG ${game.rawg_id ?? '—'}</span>
        <span class="adm-row__sub" id="g-dim">—</span>
      </span>
    </div>
    <label class="field"><span>Title</span><input id="g-title" value="${esc(game.title || '')}"></label>
    <label class="field"><span>Cover URL</span><input id="g-cover" value="${esc(game.cover_url || '')}" placeholder="https://…"></label>
    <div class="adm-btn-row" style="margin-top:0">
      <button class="btn btn--pill" id="g-hires">Upgrade to 1080p</button>
      <button class="btn btn--pill" id="g-copy-id">Copy id</button>
    </div>
    <label class="field"><span>Release year</span><input id="g-year" type="number" inputmode="numeric" value="${esc(game.release_year || '')}" placeholder="2024"></label>
    <div class="adm-btn-row">
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn--accent" id="g-save">Save</button>
    </div>`, (sheet, close) => {
    const cover = qs('#g-cover', sheet);
    const preview = qs('#g-preview', sheet);
    const dim = qs('#g-dim', sheet);

    // Reports the real pixel size of whatever URL is in the box, which is
    // the fastest way to spot a cover that's technically present but far
    // too small to sit on a game page.
    const measure = () => {
      preview.classList.remove('is-broken');
      preview.src = cover.value.trim();
      dim.textContent = 'measuring…';
      const probe = new Image();
      probe.onload = () => { dim.textContent = `${probe.naturalWidth}×${probe.naturalHeight}px`; };
      probe.onerror = () => { dim.textContent = 'could not load'; };
      probe.src = cover.value.trim();
    };
    if (cover.value.trim()) measure();
    cover.addEventListener('change', measure);

    // IGDB serves the same image at several sizes off one URL; this is
    // the same swap the main app does when it stores a cover.
    qs('#g-hires', sheet).addEventListener('click', () => {
      const url = cover.value.trim();
      if (!url.includes('images.igdb.com')) { toast('Only IGDB covers have size variants', 'error'); return; }
      cover.value = url.replace(/\/t_[a-z0-9_]+\//i, '/t_1080p/');
      measure();
      toast('Switched to 1080p', 'success');
    });
    qs('#g-copy-id', sheet).addEventListener('click', () => copy(game.id, 'Game id copied'));

    qs('[data-act="cancel"]', sheet).addEventListener('click', close);
    qs('#g-save', sheet).addEventListener('click', async () => {
      const title = qs('#g-title', sheet).value.trim();
      if (!title) { toast('A title is required', 'error'); return; }
      const yearRaw = qs('#g-year', sheet).value.trim();
      const btn = qs('#g-save', sheet);
      btn.disabled = true;
      const { error } = await supabase.from('games').update({
        title,
        cover_url: cover.value.trim() || null,
        release_year: yearRaw ? Number(yearRaw) : null,
      }).eq('id', game.id);
      if (error) { btn.disabled = false; return fail(error); }
      close();
      toast('Saved', 'success');
      paintGames();
    });
  });
}

// ============================================================
// LISTS
// ============================================================
let listsQuery = '';

SCREENS.lists = function lists() {
  paint(`
    ${header('Lists', { back: true })}
    <main class="view-body">
      <p class="adm-hint" style="margin-top:0">Every user-made collection. Deleting one removes it for its owner.</p>
      <label class="field adm-search" style="margin-top:var(--space-3)"><span>Search</span>
        <input type="search" id="l-q" placeholder="List name…" autocomplete="off" value="${esc(listsQuery)}">
      </label>
      <p class="adm-count-line" id="l-count"></p>
      <div id="list">${skeletonRows(6, { thumb: false })}</div>
    </main>`);
  let timer;
  qs('#l-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { listsQuery = e.target.value.trim(); paintLists(); }, 260);
  });
  paintLists();
};

async function paintLists() {
  const host = qs('#list');
  if (!host) return;
  let sel = supabase
    .from('lists').select('id, name, is_public, created_at, user_id')
    .order('created_at', { ascending: false }).limit(120);
  if (listsQuery) sel = sel.ilike('name', `%${listsQuery}%`);
  const { data, error } = await sel;
  if (error) { host.innerHTML = emptyState(error.message); return; }
  const countEl = qs('#l-count');
  if (countEl) countEl.textContent = `${fmtNum((data || []).length)} lists`;
  if (!data?.length) { host.innerHTML = emptyState('No lists yet.', { icon: iconList() }); return; }

  // Owner names and item counts in two follow-up queries keyed on the
  // ids just returned, rather than PostgREST embeds that need exact
  // constraint names.
  const ownerIds = [...new Set(data.map((l) => l.user_id).filter(Boolean))];
  const listIds = data.map((l) => l.id);
  const [ownersRes, itemsRes] = await Promise.all([
    ownerIds.length ? supabase.from('profiles').select('id, username').in('id', ownerIds) : Promise.resolve({ data: [] }),
    supabase.from('list_items').select('list_id').in('list_id', listIds),
  ]);
  const owners = Object.fromEntries((ownersRes.data || []).map((p) => [p.id, p.username]));
  const counts = {};
  (itemsRes.data || []).forEach((it) => { counts[it.list_id] = (counts[it.list_id] || 0) + 1; });

  host.innerHTML = data.map((l) => `
    <div class="list-card adm-row" data-id="${l.id}">
      <span class="adm-tile__icon" style="width:38px;height:38px">${iconList()}</span>
      <span class="adm-row__body">
        <span class="adm-row__title">${esc(l.name)}</span>
        <span class="adm-row__meta">@${esc(owners[l.user_id] || 'unknown')} · ${counts[l.id] || 0} games · ${l.is_public ? 'public' : 'private'}</span>
      </span>
      <span class="adm-row__actions">
        <button class="icon-btn icon-btn--small" data-del aria-label="Delete">${iconTrash()}</button>
      </span>
    </div>`).join('');

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    if (!await confirmSheet({ title: 'Delete this list?', sub: 'It disappears for its owner, permanently.', confirmLabel: 'Delete', danger: true })) return;
    const { error: delErr } = await supabase.from('lists').delete().eq('id', id);
    if (delErr) return fail(delErr);
    toast('Deleted', 'success');
    paintLists();
  }));
}

// ============================================================
// WAITLIST
// ============================================================
SCREENS.waitlist = function waitlist() {
  paint(`
    ${header('Waitlist', { back: true })}
    <main class="view-body">
      <div class="stat-card-row" id="wl-stats"></div>
      <div class="adm-btn-row" style="margin-top:0">
        <button class="btn" id="wl-copy">Copy all emails</button>
        <button class="btn" id="wl-export">Export CSV</button>
      </div>
      <div id="list" style="margin-top:var(--space-4)">${skeletonRows(6, { thumb: false })}</div>
    </main>`);
  paintWaitlist();
};

async function paintWaitlist() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase
    .from('waitlist').select('id, email, source, created_at')
    .order('created_at', { ascending: false }).limit(500);
  if (error) { host.innerHTML = emptyState(error.message); return; }

  const stats = qs('#wl-stats');
  const day = 86400000;
  const week = (data || []).filter((w) => Date.now() - new Date(w.created_at).getTime() < 7 * day).length;
  const sources = new Set((data || []).map((w) => w.source).filter(Boolean));
  if (stats) {
    stats.innerHTML = `
      <div class="stat-card stat-card--blue"><b>${fmtNum((data || []).length)}</b><span>Total</span></div>
      <div class="stat-card stat-card--grey"><b>${fmtNum(week)}</b><span>New / 7d</span></div>
      <div class="stat-card stat-card--grey"><b>${fmtNum(sources.size)}</b><span>Sources</span></div>`;
  }

  const emails = (data || []).map((w) => w.email).filter(Boolean);
  qs('#wl-copy')?.addEventListener('click', () => {
    if (!emails.length) { toast('No emails yet', 'error'); return; }
    copy(emails.join(', '), `${emails.length} emails copied`);
  });
  qs('#wl-export')?.addEventListener('click', () => {
    downloadCsv(`playthruu-waitlist-${new Date().toISOString().slice(0, 10)}.csv`,
      (data || []).map((w) => ({ email: w.email, source: w.source ?? 'direct', signed_up: w.created_at })));
  });

  if (!data?.length) { host.innerHTML = emptyState('Nobody on the waitlist yet.', { icon: iconMail() }); return; }

  host.innerHTML = data.map((w) => `
    <div class="list-card adm-row">
      <span class="adm-row__body">
        <span class="adm-row__title">${esc(w.email)}</span>
        <span class="adm-row__meta">${esc(w.source || 'direct')} · ${esc(timeAgo(w.created_at))} ago</span>
      </span>
    </div>`).join('');
}

// ============================================================
// BOOT
// ============================================================
// A missing table reads as PGRST205 (PostgREST's schema cache) or 42P01
// (Postgres' own "relation does not exist") depending on whether the
// cache has been reloaded yet. Either means a migration hasn't been run,
// which is a setup story rather than an error.
const isMissingTable = (error) =>
  error?.code === 'PGRST205' || error?.code === '42P01' ||
  /does not exist|schema cache/i.test(error?.message || '');

// Applied-migration checks. A table probe treats only a genuine
// "missing table" error as unapplied — a network blip returns true so a
// flaky connection doesn't nag about setup that's actually done.
async function tableExists(table) {
  const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(1);
  return !(error && isMissingTable(error));
}

async function settingExists(key) {
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

async function boot() {
  root.innerHTML = '<div class="boot-loader"><div class="boot-loader__mark"></div></div>';

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) { loginScreen(); return; }
  state.user = session.user;

  const { data: profile, error: profErr } = await supabase
    .from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (profErr) { fail(profErr, 'Could not load your profile'); loginScreen(); return; }
  state.profile = profile;

  // Every check runs before any is reported, so a first launch hands
  // over one combined block of SQL instead of sending you back and forth.
  const probes = await Promise.all(MIGRATIONS.map(async (m) => ({
    migration: m, applied: await m.check(),
  })));
  const missing = probes.filter((p) => !p.applied).map((p) => p.migration);
  const needsAdmin = !profile?.is_admin;

  if (missing.length || needsAdmin) {
    setupScreen(session.user.id, { missing, needsAdmin });
    return;
  }

  // Only worth mounting once an admin session is actually up — the login
  // and setup screens don't write anything an outage could lose.
  if (!bannerMounted) { wireConnectionBanner(); bannerMounted = true; }

  render(location.hash.replace(/^#\/?/, '') || 'home');
}

let bannerMounted = false;

boot();
