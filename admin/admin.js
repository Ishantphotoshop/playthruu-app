// ============================================================
// PLAYTHRUU ADMIN
// ============================================================
// A separate front end onto the same Supabase project the app already
// uses, shipping the same public anon key. It holds no extra secret and
// grants no extra power on its own: every table it writes to is behind
// an RLS policy that checks profiles.is_admin for the calling user, so
// somebody who finds this URL can load the page and still not change a
// single row. See migrations/2026-09-02_admin_toolkit.sql.
//
// searchGamesEverywhere/addGame are imported from the app's own api.js
// rather than reimplemented — those wrap the IGDB proxy, the RAWG
// fallback, relevance ranking and duplicate merging, and a second
// hand-rolled copy would drift from what the real app finds.

import { supabase } from '../js/supabase-client.js';
import { searchGamesEverywhere, addGame } from '../js/api.js';

const PROJECT_REF = 'kpgjuuplpgilupogpezc';
const SQL_EDITOR_URL = `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`;
const MIGRATION_PATH = '../migrations/2026-09-02_admin_toolkit.sql';

const root = document.getElementById('admin-root');

const state = {
  user: null,
  profile: null,
  screen: 'home',
  stats: null,
  openReports: 0,
};

// ------------------------------------------------------------ helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const qs = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function toast(message, kind = '') {
  qs('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast${kind ? ` toast--${kind}` : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// Surfacing the real Postgres/PostgREST message matters more here than
// anywhere in the main app: an RLS refusal and a typo'd column look
// identical from the outside if all you print is "something went wrong".
function fail(err, fallback = 'Something went wrong') {
  console.error(err);
  toast(err?.message || fallback, 'error');
}

const fmtNum = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat().format(n));

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'ok');
  } catch {
    // Clipboard API needs a secure context; a WebView served over http
    // during local testing doesn't have one.
    toast('Select the text and copy it manually', 'error');
  }
}

function confirmSheet({ title, sub, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet__grab"></div>
        <h2 class="sheet__title">${esc(title)}</h2>
        ${sub ? `<p class="sheet__sub">${esc(sub)}</p>` : ''}
        <div class="btn-row">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--accent'}" data-act="ok">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const close = (result) => { backdrop.remove(); resolve(result); };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.dataset.act === 'cancel') close(false);
      if (e.target.dataset.act === 'ok') close(true);
    });
    document.body.appendChild(backdrop);
  });
}

function openSheet(html, wire) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet"><div class="sheet__grab"></div>${html}</div>`;
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);
  wire?.(qs('.sheet', backdrop), close);
  return close;
}

// ------------------------------------------------------------ icons
const ic = {
  back: '<svg viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c1 3-3.5 4.6-3.5 8.5a3.5 3.5 0 0 0 7 0c0-1.4-.7-2.3-1.2-3 .8 3-2.3 3.6-2.3 3.6"/><path d="M8.2 12.5A5 5 0 0 0 12 21a5 5 0 0 0 4.8-6.4c-.5 1.6-1.8 2.4-1.8 2.4"/></svg>',
  news: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="13" height="14" rx="1.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16.5 9h2.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 9.5h5M7 12.5h5M7 15.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2.5l7 4.5v-14L6.5 9H4a1 1 0 0 0-1 1z"/><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M6.5 14v4a1.5 1.5 0 0 0 3 0v-2.5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none"><circle cx="9.5" cy="8" r="3.5" stroke="currentColor" stroke-width="2"/><path d="M2.5 20c1.3-3.8 3.9-5.7 7-5.7s5.7 1.9 7 5.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 5.2a3.3 3.3 0 0 1 0 6M18.5 19.5c-.5-2-1.5-3.6-2.8-4.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 5h10.5l-1.4 3.5L15.5 12H5z"/></svg>',
  gamepad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><path d="M6.5 8.5h11a4 4 0 0 1 3.9 3.1l.9 4A2.4 2.4 0 0 1 19 18.4l-2-2.4H7l-2 2.4a2.4 2.4 0 0 1-4.2-2.8l.9-4A4 4 0 0 1 6.5 8.5z"/><path d="M7.5 11.6v2.3M6.35 12.75h2.3"/><circle cx="15.6" cy="12" r="1.05" fill="currentColor" stroke="none"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="m20 20-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 15l7-7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 9l7 7 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 6.5l3 3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="2"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6A9.7 9.7 0 0 1 12 5.9c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-3.3 4"/><path d="M6.3 8.1A16.7 16.7 0 0 0 2.5 12S6 18.1 12 18.1a9.6 9.6 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2"/><path d="M10 12h11M18 9l3 3-3 3"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 13.5h4l1.5 3h6l1.5-3h4"/><path d="M5.5 4.5h13l3 9v5a1.5 1.5 0 0 1-1.5 1.5h-16A1.5 1.5 0 0 1 2.5 18.5v-5z"/></svg>',
};

// ------------------------------------------------------------ chrome
function header(title, { back = false, badge = '' } = {}) {
  return `
    <header class="topbar">
      ${back ? `<button class="topbar__back" id="go-back" aria-label="Back">${ic.back}</button>` : ''}
      <h1 class="topbar__title">${esc(title)}</h1>
      ${badge ? `<span class="topbar__badge">${esc(badge)}</span>` : ''}
    </header>`;
}

function paint(html) {
  root.innerHTML = html;
  qs('#go-back')?.addEventListener('click', () => go('home'));
}

const spinner = () => '<div class="spinner"></div>';

const empty = (message, icon = ic.inbox) =>
  `<div class="empty">${icon}<p>${esc(message)}</p></div>`;

// ------------------------------------------------------------ routing
// Hash-based so the phone's own Back button (and the WebView shell's
// back handling) moves between screens instead of closing the app.
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
  state.screen = screen;
  const fn = SCREENS[screen] || SCREENS.home;
  fn();
}

window.addEventListener('hashchange', () => {
  const screen = location.hash.replace(/^#\/?/, '') || 'home';
  if (state.user && state.profile?.is_admin) render(screen);
});

// ============================================================
// GATE SCREENS — login, not-an-admin, migration-not-run
// ============================================================
function loginScreen(prefill = '') {
  root.innerHTML = `
    <div class="gate">
      <div class="gate__mark"></div>
      <h1 class="gate__title">Admin</h1>
      <p class="gate__sub">Sign in with your PlayThruu account. Admin rights are checked against the database, not this screen.</p>
      <form id="login-form">
        <div class="field">
          <label class="field__label" for="email">Email</label>
          <input class="input" type="email" id="email" name="email" value="${esc(prefill)}"
                 placeholder="you@example.com" autocomplete="username" required>
        </div>
        <div class="field">
          <label class="field__label" for="password">Password</label>
          <input class="input" type="password" id="password" name="password"
                 placeholder="••••••••" autocomplete="current-password" required>
        </div>
        <button class="btn btn--accent btn--block" type="submit" id="login-btn">Sign in</button>
      </form>
    </div>`;

  qs('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    const email = qs('#email').value.trim();
    const password = qs('#password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      btn.disabled = false;
      btn.textContent = 'Sign in';
      fail(error, 'Could not sign in');
      return;
    }
    boot();
  });
}

// Both first-run gaps — the tables not existing, and this account not
// being flagged as an admin — are fixed by SQL, and the grant needs an
// id you only have once you're signed in. So they're deliberately ONE
// screen handing over ONE block to paste, rather than two rounds of
// "copy this, run it, come back, now copy this other thing".
function grantSql(userId) {
  return `-- Make this account an admin\nupdate public.profiles\n   set is_admin = true\n where id = '${userId}';`;
}

async function setupScreen(userId, { needsMigration, needsAdmin }) {
  const both = needsMigration && needsAdmin;
  const title = needsMigration ? 'One-time setup' : 'Almost there';
  const sub = both
    ? "Two things to switch on, both in one go. Copy the SQL below, run it once in Supabase, and this screen never comes back."
    : needsMigration
      ? "The admin tables aren't in the database yet. Run the migration once and this screen goes away for good."
      : "You're signed in, but this account isn't an admin yet. Run this once and reopen the app.";

  root.innerHTML = `
    <div class="gate">
      <div class="gate__mark"></div>
      <h1 class="gate__title">${esc(title)}</h1>
      <p class="gate__sub">${esc(sub)}</p>

      <div class="step">
        <span class="step__num">1</span>
        <span class="step__text">Tap <strong>Copy setup SQL</strong>.</span>
      </div>
      <div class="step">
        <span class="step__num">2</span>
        <span class="step__text">Tap <strong>Open editor</strong>, paste, and hit Run. It's safe to run more than once.</span>
      </div>
      <div class="step">
        <span class="step__num">3</span>
        <span class="step__text">Come back and tap <strong>Recheck</strong>.</span>
      </div>

      <div class="btn-row">
        <button class="btn" id="copy-sql">Copy setup SQL</button>
        <a class="btn btn--accent" href="${SQL_EDITOR_URL}" target="_blank" rel="noopener">Open editor</a>
      </div>
      <div class="btn-row">
        <button class="btn" id="recheck">Recheck</button>
      </div>

      ${needsAdmin ? `<p class="hint">The grant below is scoped to your own account id, nobody else's.</p>
        <code class="code">${esc(grantSql(userId))}</code>` : ''}
      ${needsMigration ? `<p class="hint">Creates <span class="mono">curated_trending</span>, <span class="mono">custom_news</span>,
        <span class="mono">announcements</span> and <span class="mono">app_settings</span> — all readable by the app, writable only by admins.</p>` : ''}

      <p class="hint">Signed in as <span class="mono">${esc(state.user?.email || userId)}</span></p>
      <div class="btn-row"><button class="btn" id="signout">Sign out</button></div>
    </div>`;

  qs('#recheck').addEventListener('click', boot);
  qs('#signout').addEventListener('click', signOut);

  qs('#copy-sql').addEventListener('click', async () => {
    try {
      let sql = '';
      if (needsMigration) {
        const res = await fetch(MIGRATION_PATH, { cache: 'no-store' });
        if (!res.ok) throw new Error('Could not load the migration file');
        sql += await res.text();
      }
      // The grant goes last on purpose: if both are needed it wants the
      // profiles table to already be settled, and putting it at the end
      // means the run finishes on the statement that unlocks the app.
      if (needsAdmin) sql += `\n\n${grantSql(userId)}\n`;
      await copy(sql, both ? 'Setup SQL copied' : 'Copied');
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
SCREENS.home = async function home() {
  paint(`
    ${header('PlayThruu', { badge: 'Admin' })}
    <main class="body">
      <div class="h-section">At a glance</div>
      <div class="stat-grid" id="stats">
        ${['Players', 'Logs', 'Games'].map((l) => `
          <div class="stat"><div class="stat__num">·</div><div class="stat__label">${l}</div></div>`).join('')}
      </div>
      <div class="stat-grid" id="stats2" style="margin-top:8px">
        ${['Reviews', 'Loved', 'Waitlist'].map((l) => `
          <div class="stat"><div class="stat__num">·</div><div class="stat__label">${l}</div></div>`).join('')}
      </div>

      <div class="h-section">Control</div>
      <div class="nav-list" id="nav"></div>

      <div class="h-section">Session</div>
      <div class="card">
        <div class="row" style="border:none;background:none;padding:0">
          <div class="row__main">
            <div class="row__title">${esc(state.profile?.display_name || state.profile?.username || 'You')}</div>
            <div class="row__sub">${esc(state.user?.email || '')}</div>
          </div>
          <button class="btn btn--sm" id="signout">${ic.logout} Sign out</button>
        </div>
      </div>
      <p class="hint">Changes here are live immediately — this is the production database, not a copy.</p>
    </main>`);

  qs('#signout').addEventListener('click', signOut);

  const sections = [
    { id: 'trending', icon: ic.flame, title: 'Trending now', sub: 'Hand-pick what the feed features' },
    { id: 'news', icon: ic.news, title: 'News', sub: 'Publish your own posts' },
    { id: 'announce', icon: ic.megaphone, title: 'Announcement', sub: 'Banner across everyone\'s feed' },
    { id: 'reports', icon: ic.flag, title: 'Reports', sub: 'Moderation queue', badge: state.openReports },
    { id: 'users', icon: ic.users, title: 'People', sub: 'Suspend, promote, inspect' },
    { id: 'games', icon: ic.gamepad, title: 'Games', sub: 'Hide or remove catalog entries' },
  ];

  qs('#nav').innerHTML = sections.map((s) => `
    <button class="nav-row" data-go="${s.id}">
      <span class="nav-row__icon">${s.icon}</span>
      <span class="nav-row__text">
        <span class="nav-row__title">${esc(s.title)}</span>
        <span class="nav-row__sub">${esc(s.sub)}</span>
      </span>
      ${s.badge ? `<span class="nav-row__count">${s.badge}</span>` : ''}
      <span class="nav-row__chev">${ic.chev}</span>
    </button>`).join('');

  qsa('[data-go]').forEach((el) => el.addEventListener('click', () => go(el.dataset.go)));

  loadStats();
};

async function loadStats() {
  const count = async (table, build) => {
    try {
      let q = supabase.from(table).select('*', { count: 'exact', head: true });
      if (build) q = build(q);
      const { count: n, error } = await q;
      if (error) throw error;
      return n;
    } catch {
      return null;
    }
  };

  const [players, logs, games, reviews, loved, waitlist, reports] = await Promise.all([
    count('profiles'),
    count('logs'),
    count('games'),
    count('logs', (q) => q.not('review', 'is', null)),
    count('logs', (q) => q.eq('loved', true)),
    count('waitlist'),
    count('reports', (q) => q.neq('status', 'resolved')),
  ]);

  state.openReports = reports || 0;

  const fill = (sel, pairs) => {
    const host = qs(sel);
    if (!host) return;
    host.innerHTML = pairs.map(([label, value]) => `
      <div class="stat">
        <div class="stat__num">${fmtNum(value)}</div>
        <div class="stat__label">${label}</div>
      </div>`).join('');
  };

  fill('#stats', [['Players', players], ['Logs', logs], ['Games', games]]);
  fill('#stats2', [['Reviews', reviews], ['Loved', loved], ['Waitlist', waitlist]]);

  // The reports badge is only known after the counts land, so the nav
  // row gets it retroactively rather than rendering twice.
  const reportRow = qs('[data-go="reports"]');
  if (reportRow && state.openReports && !qs('.nav-row__count', reportRow)) {
    reportRow.querySelector('.nav-row__chev')
      .insertAdjacentHTML('beforebegin', `<span class="nav-row__count">${state.openReports}</span>`);
  }
}

// ============================================================
// TRENDING
// ============================================================
SCREENS.trending = async function trending() {
  paint(`
    ${header('Trending now', { back: true })}
    <main class="body">
      <div class="card" id="mode-card">${spinner()}</div>
      <div class="h-section">Featured games</div>
      <button class="btn btn--accent btn--block" id="add-game">${ic.plus} Add a game</button>
      <div id="list" style="margin-top:12px">${spinner()}</div>
    </main>`);

  qs('#add-game').addEventListener('click', openGamePicker);
  await Promise.all([paintTrendingMode(), paintCurated()]);
};

async function paintTrendingMode() {
  const host = qs('#mode-card');
  if (!host) return;

  // boot() already refuses to reach this screen without the migration,
  // but PostgREST's schema cache can lag a fresh migration by a few
  // seconds — long enough to land here with the table "missing". Left
  // unhandled that threw mid-render and stranded the card on its
  // spinner, so it degrades to a readable message instead.
  let mode;
  try {
    mode = await getSetting('trending_mode', 'lead');
  } catch (err) {
    host.innerHTML = `<p class="hint" style="margin:0">Couldn't read the trending setting — ${esc(err.message)}</p>`;
    return;
  }

  host.innerHTML = `
    <div class="switch-row">
      <span class="switch-row__text">
        <span class="switch-row__title">Replace the live list</span>
        <span class="switch-row__sub">${mode === 'replace'
          ? 'Only your picks show. IGDB fills any leftover slots.'
          : 'Your picks lead, then IGDB\'s live popular list follows.'}</span>
      </span>
      <button class="switch" id="mode-switch" role="switch" aria-checked="${mode === 'replace'}"></button>
    </div>`;

  qs('#mode-switch').addEventListener('click', async (e) => {
    const next = e.currentTarget.getAttribute('aria-checked') === 'true' ? 'lead' : 'replace';
    try {
      await setSetting('trending_mode', next);
      paintTrendingMode();
      toast(next === 'replace' ? 'Your picks only' : 'Your picks lead', 'ok');
    } catch (err) { fail(err); }
  });
}

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

async function paintCurated() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase
    .from('curated_trending')
    .select('id, position, game_id, games(id, title, cover_url, release_year)')
    .order('position', { ascending: true });

  if (error) { host.innerHTML = empty(error.message); return; }
  if (!data?.length) {
    host.innerHTML = empty('Nothing featured yet. Add a game and it shows up at the top of Trending now.', ic.flame);
    return;
  }

  host.innerHTML = data.map((r, i) => `
    <div class="row" data-id="${r.id}">
      <span class="pos-pill">${i + 1}</span>
      ${r.games?.cover_url
        ? `<img class="thumb" src="${esc(r.games.cover_url)}" alt="" loading="lazy">`
        : '<span class="thumb"></span>'}
      <span class="row__main">
        <span class="row__title">${esc(r.games?.title || 'Missing game')}</span>
        <span class="row__sub">${r.games?.release_year ? esc(r.games.release_year) : ''}</span>
      </span>
      <span class="row__actions">
        <button class="btn btn--icon" data-move="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ic.up}</button>
        <button class="btn btn--icon" data-move="down" ${i === data.length - 1 ? 'disabled' : ''} aria-label="Move down">${ic.down}</button>
        <button class="btn btn--icon btn--danger" data-remove aria-label="Remove">${ic.trash}</button>
      </span>
    </div>`).join('');

  qsa('[data-move]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const rowEl = btn.closest('.row');
    const idx = data.findIndex((r) => r.id === rowEl.dataset.id);
    const swapWith = btn.dataset.move === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= data.length) return;
    const reordered = [...data];
    [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
    try {
      await Promise.all(reordered.map((r, i) =>
        supabase.from('curated_trending').update({ position: i }).eq('id', r.id)));
      paintCurated();
    } catch (err) { fail(err); }
  }));

  qsa('[data-remove]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.row').dataset.id;
    if (!await confirmSheet({ title: 'Remove from Trending?', sub: 'The game stays in the catalog — it just stops being featured.', confirmLabel: 'Remove', danger: true })) return;
    const { error } = await supabase.from('curated_trending').delete().eq('id', id);
    if (error) return fail(error);
    toast('Removed', 'ok');
    paintCurated();
  }));
}

function openGamePicker() {
  openSheet(`
    <h2 class="sheet__title">Add a game</h2>
    <p class="sheet__sub">Searches the catalog and IGDB. Picking one that isn't in the catalog yet adds it.</p>
    <div class="search-wrap">
      <span class="search-wrap__icon">${ic.search}</span>
      <input class="input" id="game-q" type="search" placeholder="Search any game…" autocomplete="off">
    </div>
    <div id="game-results"></div>`, (sheet, close) => {
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
          if (!games.length) { results.innerHTML = empty('Nothing matched that.'); return; }
          results.innerHTML = games.map((g, i) => `
            <button class="row" style="width:100%;text-align:left" data-i="${i}">
              ${g.cover_url ? `<img class="thumb" src="${esc(g.cover_url)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}
              <span class="row__main">
                <span class="row__title">${esc(g.title)}</span>
                <span class="row__sub">${g.release_year ? esc(g.release_year) : ''}${g._source === 'local' ? ' · in catalog' : ''}</span>
              </span>
            </button>`).join('');

          qsa('[data-i]', results).forEach((btn) => btn.addEventListener('click', async () => {
            const game = games[Number(btn.dataset.i)];
            btn.disabled = true;
            try {
              // A remote (IGDB/RAWG) hit has no row in `games` yet, and
              // curated_trending.game_id is a real foreign key — so the
              // catalog row has to exist before it can be featured.
              const local = game._source === 'local' && game.id
                ? game
                : await addGame(game, state.user.id);
              const { count } = await supabase
                .from('curated_trending').select('*', { count: 'exact', head: true });
              const { error } = await supabase.from('curated_trending').insert({
                game_id: local.id,
                position: count ?? 0,
                created_by: state.user.id,
              });
              if (error) throw error;
              close();
              toast(`${game.title} featured`, 'ok');
              paintCurated();
            } catch (err) {
              btn.disabled = false;
              fail(err, err?.code === '23505' ? 'That game is already featured' : 'Could not add that game');
            }
          }));
        } catch (err) {
          if (mine === token) results.innerHTML = empty('Search failed. Try again.');
          console.error(err);
        }
      }, 320);
    });
  });
}

// ============================================================
// NEWS
// ============================================================
SCREENS.news = async function news() {
  paint(`
    ${header('News', { back: true })}
    <main class="body">
      <button class="btn btn--accent btn--block" id="new-post">${ic.plus} Write a post</button>
      <div id="list" style="margin-top:14px">${spinner()}</div>
    </main>`);
  qs('#new-post').addEventListener('click', () => openNewsEditor(null));
  paintNews();
};

async function paintNews() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase
    .from('custom_news')
    .select('*')
    .order('published_at', { ascending: false });

  if (error) { host.innerHTML = empty(error.message); return; }
  if (!data?.length) {
    host.innerHTML = empty('No posts yet. Anything you write here shows up in the app\'s News tab.', ic.news);
    return;
  }

  host.innerHTML = data.map((p) => `
    <div class="row" data-id="${p.id}">
      ${p.image_url ? `<img class="thumb thumb--wide" src="${esc(p.image_url)}" alt="" loading="lazy">` : '<span class="thumb thumb--wide"></span>'}
      <span class="row__main">
        <span class="row__title">${esc(p.title)}</span>
        <span class="row__sub">
          ${p.is_published ? '' : '<span class="badge">Draft</span> '}
          ${p.pinned ? '<span class="badge badge--accent">Pinned</span> ' : ''}
          ${esc(p.source)} · ${esc(timeAgo(p.published_at))}
        </span>
      </span>
      <span class="row__actions">
        <button class="btn btn--icon" data-edit aria-label="Edit">${ic.edit}</button>
        <button class="btn btn--icon btn--danger" data-del aria-label="Delete">${ic.trash}</button>
      </span>
    </div>`).join('');

  qsa('[data-edit]', host).forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.closest('.row').dataset.id;
    openNewsEditor(data.find((p) => p.id === id));
  }));

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.row').dataset.id;
    if (!await confirmSheet({ title: 'Delete this post?', sub: 'It disappears from the News tab straight away.', confirmLabel: 'Delete', danger: true })) return;
    const { error } = await supabase.from('custom_news').delete().eq('id', id);
    if (error) return fail(error);
    toast('Deleted', 'ok');
    paintNews();
  }));
}

function openNewsEditor(post) {
  const editing = !!post;
  openSheet(`
    <h2 class="sheet__title">${editing ? 'Edit post' : 'New post'}</h2>
    <p class="sheet__sub">Appears in the app's News tab alongside the RSS feeds.</p>
    <div class="field">
      <label class="field__label" for="n-title">Headline</label>
      <input class="input" id="n-title" value="${esc(post?.title || '')}" placeholder="What happened?">
    </div>
    <div class="field">
      <label class="field__label" for="n-summary">Summary</label>
      <textarea class="textarea" id="n-summary" placeholder="A sentence or two.">${esc(post?.summary || '')}</textarea>
    </div>
    <div class="field">
      <label class="field__label" for="n-image">Image URL</label>
      <input class="input" id="n-image" value="${esc(post?.image_url || '')}" placeholder="https://…">
    </div>
    <div class="field">
      <label class="field__label" for="n-source">Source label</label>
      <input class="input" id="n-source" value="${esc(post?.source || 'PlayThruu')}" placeholder="PlayThruu">
    </div>
    <div class="field">
      <label class="field__label" for="n-link">Link (optional)</label>
      <input class="input" id="n-link" value="${esc(post?.link || '')}" placeholder="https://…">
    </div>
    <div class="switch-row">
      <span class="switch-row__text">
        <span class="switch-row__title">Published</span>
        <span class="switch-row__sub">Off keeps it as a draft only you can see.</span>
      </span>
      <button class="switch" id="n-published" role="switch" aria-checked="${post ? !!post.is_published : true}"></button>
    </div>
    <div class="switch-row">
      <span class="switch-row__text">
        <span class="switch-row__title">Pin to top</span>
        <span class="switch-row__sub">Sits above the RSS articles instead of mixing in by date.</span>
      </span>
      <button class="switch" id="n-pinned" role="switch" aria-checked="${post ? !!post.pinned : true}"></button>
    </div>
    <div class="btn-row">
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn--accent" id="n-save">${editing ? 'Save' : 'Publish'}</button>
    </div>`, (sheet, close) => {
    qsa('.switch', sheet).forEach((sw) => sw.addEventListener('click', () => {
      sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    }));
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
        if (editing) {
          const { error } = await supabase.from('custom_news').update(payload).eq('id', post.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('custom_news')
            .insert({ ...payload, created_by: state.user.id });
          if (error) throw error;
        }
        close();
        toast(editing ? 'Saved' : 'Published', 'ok');
        paintNews();
      } catch (err) {
        btn.disabled = false;
        fail(err);
      }
    });
  });
}

// ============================================================
// ANNOUNCEMENTS
// ============================================================
SCREENS.announce = async function announce() {
  paint(`
    ${header('Announcement', { back: true })}
    <main class="body">
      <div class="card">
        <div class="field">
          <label class="field__label" for="a-message">Message</label>
          <textarea class="textarea" id="a-message" placeholder="Servers are getting an upgrade tonight…"></textarea>
        </div>
        <div class="field">
          <label class="field__label" for="a-link">Link (optional)</label>
          <input class="input" id="a-link" placeholder="https://…">
        </div>
        <button class="btn btn--accent btn--block" id="a-post">Post banner</button>
        <p class="hint">Shows at the top of the feed for everyone until you switch it off.</p>
      </div>
      <div class="h-section">Posted</div>
      <div id="list">${spinner()}</div>
    </main>`);

  qs('#a-post').addEventListener('click', async () => {
    const message = qs('#a-message').value.trim();
    if (!message) { toast('Write a message first', 'error'); return; }
    const btn = qs('#a-post');
    btn.disabled = true;
    const { error } = await supabase.from('announcements').insert({
      message,
      link: qs('#a-link').value.trim() || null,
      created_by: state.user.id,
    });
    btn.disabled = false;
    if (error) return fail(error);
    qs('#a-message').value = '';
    qs('#a-link').value = '';
    toast('Banner is live', 'ok');
    paintAnnouncements();
  });

  paintAnnouncements();
};

async function paintAnnouncements() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
  if (error) { host.innerHTML = empty(error.message); return; }
  if (!data?.length) { host.innerHTML = empty('No banners yet.', ic.megaphone); return; }

  host.innerHTML = data.map((a) => `
    <div class="row" data-id="${a.id}">
      <span class="row__main">
        <span class="row__title" style="white-space:normal">${esc(a.message)}</span>
        <span class="row__sub">
          ${a.is_active ? '<span class="badge badge--success">Live</span>' : '<span class="badge">Off</span>'}
          · ${esc(timeAgo(a.created_at))}
        </span>
      </span>
      <span class="row__actions">
        <button class="btn btn--icon" data-toggle aria-label="Toggle">${a.is_active ? ic.eyeOff : ic.eye}</button>
        <button class="btn btn--icon btn--danger" data-del aria-label="Delete">${ic.trash}</button>
      </span>
    </div>`).join('');

  qsa('[data-toggle]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.row').dataset.id;
    const current = data.find((a) => a.id === id);
    const { error } = await supabase.from('announcements')
      .update({ is_active: !current.is_active }).eq('id', id);
    if (error) return fail(error);
    paintAnnouncements();
  }));

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.row').dataset.id;
    if (!await confirmSheet({ title: 'Delete banner?', confirmLabel: 'Delete', danger: true })) return;
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) return fail(error);
    paintAnnouncements();
  }));
}

// ============================================================
// PEOPLE
// ============================================================
SCREENS.users = async function users() {
  paint(`
    ${header('People', { back: true })}
    <main class="body">
      <div class="search-wrap">
        <span class="search-wrap__icon">${ic.search}</span>
        <input class="input" id="u-q" type="search" placeholder="Search username or name…" autocomplete="off">
      </div>
      <div id="list">${spinner()}</div>
    </main>`);

  let timer;
  qs('#u-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => paintUsers(e.target.value.trim()), 260);
  });
  paintUsers('');
};

async function paintUsers(query) {
  const host = qs('#list');
  if (!host) return;
  let q = supabase.from('profiles')
    .select('id, username, display_name, avatar_url, is_admin, is_suspended, created_at')
    .order('created_at', { ascending: false })
    .limit(60);
  if (query) q = q.or(`username.ilike.%${query}%,display_name.ilike.%${query}%`);

  const { data, error } = await q;
  if (error) { host.innerHTML = empty(error.message); return; }
  if (!data?.length) { host.innerHTML = empty('Nobody matched that.', ic.users); return; }

  host.innerHTML = data.map((p) => `
    <div class="row" data-id="${p.id}">
      ${p.avatar_url
        ? `<img class="avatar" src="${esc(p.avatar_url)}" alt="" loading="lazy">`
        : `<span class="avatar avatar--fallback">${esc((p.username || '?').slice(0, 2).toUpperCase())}</span>`}
      <span class="row__main">
        <span class="row__title">
          ${esc(p.display_name || p.username)}
          ${p.is_admin ? '<span class="badge badge--accent">Admin</span>' : ''}
          ${p.is_suspended ? '<span class="badge badge--danger">Suspended</span>' : ''}
        </span>
        <span class="row__sub">@${esc(p.username)} · joined ${esc(timeAgo(p.created_at))}</span>
      </span>
      <span class="row__actions">
        <button class="btn btn--icon" data-manage aria-label="Manage">${ic.chev}</button>
      </span>
    </div>`).join('');

  qsa('[data-manage]', host).forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.closest('.row').dataset.id;
    openUserSheet(data.find((p) => p.id === id));
  }));
}

function openUserSheet(user) {
  const isSelf = user.id === state.user.id;
  openSheet(`
    <h2 class="sheet__title">${esc(user.display_name || user.username)}</h2>
    <p class="sheet__sub">@${esc(user.username)}</p>
    <div class="switch-row">
      <span class="switch-row__text">
        <span class="switch-row__title">Suspended</span>
        <span class="switch-row__sub">Blocks them from posting anywhere in the app.</span>
      </span>
      <button class="switch" id="u-susp" role="switch" aria-checked="${!!user.is_suspended}" ${isSelf ? 'disabled' : ''}></button>
    </div>
    <div class="switch-row">
      <span class="switch-row__text">
        <span class="switch-row__title">Admin</span>
        <span class="switch-row__sub">Full access to this control room.</span>
      </span>
      <button class="switch" id="u-admin" role="switch" aria-checked="${!!user.is_admin}" ${isSelf ? 'disabled' : ''}></button>
    </div>
    ${isSelf ? '<p class="hint">You can\'t suspend or demote your own account here — that\'s the one lock that stops you getting shut out of your own admin app.</p>' : ''}
    <div class="btn-row"><button class="btn" data-act="close">Done</button></div>`, (sheet, close) => {
    qs('[data-act="close"]', sheet).addEventListener('click', close);
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
      toast('Saved', 'ok');
      paintUsers(qs('#u-q')?.value.trim() || '');
    };

    qs('#u-susp', sheet).addEventListener('click', (e) => flip(e.currentTarget, 'is_suspended'));
    qs('#u-admin', sheet).addEventListener('click', (e) => flip(e.currentTarget, 'is_admin'));
  });
}

// ============================================================
// REPORTS
// ============================================================
SCREENS.reports = async function reports() {
  paint(`
    ${header('Reports', { back: true })}
    <main class="body"><div id="list">${spinner()}</div></main>`);
  paintReports();
};

async function paintReports() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(80);
  if (error) { host.innerHTML = empty(error.message); return; }
  if (!data?.length) { host.innerHTML = empty('Nothing reported. Quiet night.', ic.flag); return; }

  // Reporter names come from a second lookup keyed on the ids we just
  // got back, rather than a PostgREST embed — the embed needs the exact
  // foreign-key constraint name, and this doesn't care what it's called.
  const reporterIds = [...new Set(data.map((r) => r.reporter_id).filter(Boolean))];
  let names = {};
  if (reporterIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, username').in('id', reporterIds);
    names = Object.fromEntries((profs || []).map((p) => [p.id, p.username]));
  }

  host.innerHTML = data.map((r) => `
    <div class="row" data-id="${r.id}">
      <span class="row__main">
        <span class="row__title" style="white-space:normal">${esc(r.reason || 'No reason given')}</span>
        <span class="row__sub">
          ${r.status === 'resolved' ? '<span class="badge badge--success">Resolved</span>' : '<span class="badge badge--danger">Open</span>'}
          · ${esc(r.target_type || 'item')} · by @${esc(names[r.reporter_id] || 'unknown')} · ${esc(timeAgo(r.created_at))}
        </span>
      </span>
      ${r.status === 'resolved' ? '' : `
        <span class="row__actions">
          <button class="btn btn--icon" data-resolve aria-label="Resolve">${ic.check}</button>
        </span>`}
    </div>`).join('');

  qsa('[data-resolve]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.row').dataset.id;
    const { error } = await supabase.from('reports').update({ status: 'resolved' }).eq('id', id);
    if (error) return fail(error);
    toast('Resolved', 'ok');
    paintReports();
  }));
}

// ============================================================
// GAMES
// ============================================================
SCREENS.games = async function games() {
  paint(`
    ${header('Games', { back: true })}
    <main class="body">
      <div class="search-wrap">
        <span class="search-wrap__icon">${ic.search}</span>
        <input class="input" id="g-q" type="search" placeholder="Search the catalog…" autocomplete="off">
      </div>
      <div id="list">${spinner()}</div>
      <p class="hint">Hiding keeps the row (and everyone's logs of it) but pulls the game out of search and trending. Deleting removes it for good.</p>
    </main>`);

  let timer;
  qs('#g-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => paintGames(e.target.value.trim()), 260);
  });
  paintGames('');
};

async function paintGames(query) {
  const host = qs('#list');
  if (!host) return;
  let q = supabase.from('games')
    .select('id, title, cover_url, release_year, is_hidden')
    .order('created_at', { ascending: false })
    .limit(50);
  if (query) q = q.ilike('title', `%${query}%`);

  const { data, error } = await q;
  if (error) { host.innerHTML = empty(error.message); return; }
  if (!data?.length) { host.innerHTML = empty('No games matched.', ic.gamepad); return; }

  host.innerHTML = data.map((g) => `
    <div class="row" data-id="${g.id}">
      ${g.cover_url ? `<img class="thumb" src="${esc(g.cover_url)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}
      <span class="row__main">
        <span class="row__title">${esc(g.title)} ${g.is_hidden ? '<span class="badge badge--danger">Hidden</span>' : ''}</span>
        <span class="row__sub">${g.release_year ? esc(g.release_year) : ''}</span>
      </span>
      <span class="row__actions">
        <button class="btn btn--icon" data-hide aria-label="Hide">${g.is_hidden ? ic.eye : ic.eyeOff}</button>
        <button class="btn btn--icon btn--danger" data-del aria-label="Delete">${ic.trash}</button>
      </span>
    </div>`).join('');

  qsa('[data-hide]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.row').dataset.id;
    const current = data.find((g) => g.id === id);
    const { error } = await supabase.from('games').update({ is_hidden: !current.is_hidden }).eq('id', id);
    if (error) return fail(error);
    toast(current.is_hidden ? 'Visible again' : 'Hidden', 'ok');
    paintGames(query);
  }));

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.row').dataset.id;
    const game = data.find((g) => g.id === id);
    if (!await confirmSheet({
      title: `Delete ${game.title}?`,
      sub: 'Every log, review and list entry pointing at this game goes with it. Hiding is usually what you want instead.',
      confirmLabel: 'Delete for good',
      danger: true,
    })) return;
    const { error } = await supabase.from('games').delete().eq('id', id);
    if (error) return fail(error);
    toast('Deleted', 'ok');
    paintGames(query);
  }));
}

// ============================================================
// BOOT
// ============================================================
// A missing table reads as PGRST205 (PostgREST's schema cache) or 42P01
// (Postgres' own "relation does not exist"), depending on whether the
// cache has been reloaded yet. Either one means the migration hasn't
// been run, which is a setup story rather than an error.
const isMissingTable = (error) =>
  error?.code === 'PGRST205' || error?.code === '42P01' ||
  /does not exist|schema cache/i.test(error?.message || '');

async function boot() {
  root.innerHTML = '<div class="boot"><div class="boot__mark"></div><p class="boot__label">PlayThruu Admin</p></div>';

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) { loginScreen(); return; }
  state.user = session.user;

  const { data: profile, error: profErr } = await supabase
    .from('profiles').select('*').eq('id', session.user.id).maybeSingle();

  if (profErr) { fail(profErr, 'Could not load your profile'); loginScreen(); return; }
  state.profile = profile;

  // Both checks run before either is reported, so a first launch can
  // hand over one combined block of SQL instead of sending you to the
  // dashboard and back twice.
  const { error: setupErr } = await supabase.from('app_settings').select('key').limit(1);
  const needsMigration = !!(setupErr && isMissingTable(setupErr));
  const needsAdmin = !profile?.is_admin;

  if (setupErr && !needsMigration) { fail(setupErr, 'Could not reach the database'); }

  if (needsMigration || needsAdmin) {
    setupScreen(session.user.id, { needsMigration, needsAdmin });
    return;
  }

  render(location.hash.replace(/^#\/?/, '') || 'home');
}

boot();
