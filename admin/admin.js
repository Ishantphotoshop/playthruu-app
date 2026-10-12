// ============================================================
// PLAYTHRUU ADMIN
// ============================================================
// A separate front end onto the same Supabase project the app uses,
// shipping the same public anon key. It holds no extra secret and grants no
// extra power on its own: every table it writes to is behind an RLS policy
// checking profiles.is_admin for the calling user, so somebody who finds
// this URL can load the page and still not change a row. See
// migrations/2026-09-02_admin_toolkit.sql.
//
// It draws with the app's real stylesheet and components. What marks it out
// is the ADMIN stamp in the header.
//
// Layout of the code:
//   core.js      the shell: tab bar, header, kept screens, sheets, row/chip parts
//   toolkit.js   behaviours: finder, select mode, undo, counters, CSV
//   screens/     one file per area (home, inbox, people, news, content, catalog, hub)
//   admin.js     this file: sign-in and setup gates, boot, search, alerts, shortcuts

import {
  supabase, state, root, hooks, SCREENS, REFRESH, render, go, resetPages, esc, fail, copy, qs, qsa, qsDoc,
  displayName, avatarImg, poster, setBadge, ago, getRecents,
} from './core.js';
import { openFinder, wireConnectionBanner } from './toolkit.js';
import './screens/home.js';
import './screens/inbox.js';
import './screens/people.js';
import './screens/news.js';
import './screens/content.js';
import './screens/catalog.js';
import './screens/hub.js';
import { loadAttentionCounts } from './screens/home.js';
import { openGamePicker } from './screens/catalog.js';
import { icons } from './screens/icons.js';

const PROJECT_REF = 'kpgjuuplpgilupogpezc';
const SQL_EDITOR_URL = `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`;

// Each migration this build needs, with a check for whether it's already
// applied, so the setup screen can hand over only the outstanding ones.
const MIGRATIONS = [
  { path: '../migrations/2026-09-02_admin_toolkit.sql', check: () => tableExists('app_settings') },
  { path: '../migrations/2026-09-02_presence_and_moderation.sql', check: () => tableExists('user_presence') },
  { path: '../migrations/2026-09-02_admin_analytics_access.sql', check: () => settingExists('analytics_ready') },
  { path: '../migrations/2026-09-25_usage_time.sql', check: () => tableExists('user_usage') },
];

// ------------------------------------------------------------ search + jump
const PAGES = [
  ['home', 'Home', 'What needs you right now', icons.chart],
  ['inbox', 'Inbox', 'Reports, news to review, new players', icons.flag],
  ['reports', 'Reports', 'Moderation queue', icons.flag],
  ['people', 'People', 'Everyone who joined', icons.people],
  ['news', 'News', 'The News Brain’s queue', icons.news],
  ['trending', 'Trending', 'Feature games', icons.flame],
  ['announce', 'Announcements', 'Banner on the feed', icons.megaphone],
  ['games', 'Games', 'The shared catalog', icons.game],
  ['lists', 'Lists', 'Collections players made', icons.list],
  ['comments', 'Comments', 'Read, search, remove', icons.comment],
  ['activity', 'Activity', 'Live logs from everyone', icons.activity],
  ['insights', 'Insights', 'Charts and top lists', icons.chart],
  ['manage', 'Manage', 'All the content tools', icons.gear],
  ['waitlist', 'Waitlist', 'Signups from the website', icons.mail],
  ['audit', 'Admin log', 'Who did what, and when', icons.shield],
  ['more', 'More', 'Account, links, sign out', icons.gear],
];

function finderCommands() {
  const cmds = PAGES.map(([id, title, hint, icon]) => ({
    title, hint, lead: `<span class="adm-chip-icon">${icon()}</span>`,
    badge: id === 'reports' && state.openReports ? String(state.openReports) : '', run: () => go(id),
  }));
  cmds.push(
    { title: 'Feature a game', hint: 'Add to Trending', lead: `<span class="adm-chip-icon">${icons.plus()}</span>`, run: () => { go('trending'); setTimeout(openGamePicker, 80); } },
    { title: 'Post a banner', hint: 'Announce something on the feed', lead: `<span class="adm-chip-icon">${icons.megaphone()}</span>`, run: () => go('announce') },
    { title: 'Review news', hint: 'Open the review queue', lead: `<span class="adm-chip-icon">${icons.news()}</span>`, run: () => go('news?tab=review') },
    { title: 'Sign out', hint: 'End this session', lead: `<span class="adm-chip-icon">${icons.signout()}</span>`, run: signOut },
  );
  return cmds;
}

async function searchPeople(q) {
  const clean = q.replace(/[,()%*]/g, ' ').trim();
  if (!clean) return [];
  const { data } = await supabase.from('profiles').select('id, username, display_name, avatar_url, is_admin, is_suspended')
    .or(`username.ilike.%${clean}%,display_name.ilike.%${clean}%`).order('created_at', { ascending: false }).limit(6);
  return (data || []).map((p) => ({
    title: displayName(p), hint: `@${p.username}${p.is_admin ? ' · admin' : ''}${p.is_suspended ? ' · suspended' : ''}`,
    lead: avatarImg(p, 34), run: () => hooks.openUser?.(p.id),
  }));
}

async function searchGames(q) {
  const clean = q.replace(/[%,]/g, ' ').trim();
  if (!clean) return [];
  const { data } = await supabase.from('games').select('id, title, cover_url, release_year, is_hidden').ilike('title', `%${clean}%`).order('created_at', { ascending: false }).limit(6);
  return (data || []).map((g) => ({
    title: g.title, hint: `${g.release_year || 'no year'}${g.is_hidden ? ' · hidden' : ''}`,
    lead: poster(g.cover_url, 'adm-thumb adm-thumb--sm'), run: () => hooks.openGame?.(g.id),
  }));
}

// People and games opened lately, shown when the search box is empty.
function recentEntries() {
  return getRecents().map((r) => (r.type === 'person'
    ? { title: r.title, hint: `${r.hint} · recent`, lead: avatarImg({ avatar_url: r.img, username: r.name || r.title }, 34), run: () => hooks.openUser?.(r.id) }
    : { title: r.title, hint: `${r.hint} · recent`, lead: poster(r.img, 'adm-thumb adm-thumb--sm'), run: () => hooks.openGame?.(r.id) }));
}

hooks.openSearch = () => openFinder({ commands: finderCommands(), searchPeople, searchGames, recents: recentEntries });

// ------------------------------------------------------------ keyboard
document.addEventListener('keydown', (e) => {
  if (!state.user || !state.profile?.is_admin) return;
  const tag = document.activeElement?.tagName || '';
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || document.activeElement?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); hooks.openSearch(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); hooks.openSearch(); return; }
  if (document.querySelector('.modal-overlay, .adm-palette')) return;
  const tabs = ['home', 'inbox', 'people', 'manage', 'more'];
  const n = Number(e.key);
  if (n >= 1 && n <= tabs.length) go(tabs[n - 1]);
});

window.addEventListener('hashchange', () => {
  if (state.user && state.profile?.is_admin) render(location.hash.replace(/^#\/?/, '') || 'home');
});

// ------------------------------------------------------------ gates
function loginScreen() {
  resetPages();
  stopPulse();
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
  qsDoc('#login-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qsDoc('#login-btn', root);
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    const { error } = await supabase.auth.signInWithPassword({
      email: qsDoc('#email', root).value.trim(),
      password: qsDoc('#password', root).value,
    });
    if (error) { btn.disabled = false; btn.textContent = 'Sign in'; fail(error, 'Could not sign in'); return; }
    boot();
  });
}

const grantSql = (userId) => `-- Make this account an admin\nupdate public.profiles\n   set is_admin = true\n where id = '${userId}';`;

// Both first-run gaps (tables missing, this account not an admin) are fixed by
// SQL, so they are ONE screen handing over ONE block to paste.
function setupScreen(userId, { missing, needsAdmin }) {
  resetPages();
  stopPulse();
  const jobs = missing.length + (needsAdmin ? 1 : 0);
  root.innerHTML = `
    <div class="adm-gate">
      <div class="adm-gate__mark"></div>
      <h1 class="adm-gate__title">${missing.length ? 'One-time setup' : 'Almost there'}</h1>
      <p class="adm-gate__sub">${jobs > 1
        ? `${jobs} things to switch on, all in one go. Copy the SQL below, run it once in Supabase, and this screen never comes back.`
        : missing.length
          ? 'The admin tables aren’t in the database yet. Run this once and this screen goes away for good.'
          : 'You’re signed in, but this account isn’t an admin yet. Run this once and reopen the app.'}</p>
      <div class="adm-step"><span class="adm-step__num">1</span><span class="adm-step__text">Tap <strong>Copy setup SQL</strong>.</span></div>
      <div class="adm-step"><span class="adm-step__num">2</span><span class="adm-step__text">Tap <strong>Open editor</strong>, paste into a new query, and hit Run. It’s safe to run more than once.</span></div>
      <div class="adm-step"><span class="adm-step__num">3</span><span class="adm-step__text">Come back and tap <strong>Recheck</strong>.</span></div>
      <div class="adm-btn-row">
        <button class="btn" id="copy-sql">Copy setup SQL</button>
        <a class="btn btn--accent" href="${SQL_EDITOR_URL}" target="_blank" rel="noopener">Open editor</a>
      </div>
      <div class="adm-btn-row"><button class="btn btn--block" id="recheck">Recheck</button></div>
      ${needsAdmin ? `<p class="adm-hint">The grant below is scoped to your own account id, nobody else’s.</p><code class="adm-code">${esc(grantSql(userId))}</code>` : ''}
      <p class="adm-hint">Signed in as <span class="mono">${esc(state.user?.email || userId)}</span></p>
      <div class="adm-btn-row"><button class="btn btn--block" id="signout">Sign out</button></div>
    </div>`;
  qsDoc('#recheck', root).addEventListener('click', boot);
  qsDoc('#signout', root).addEventListener('click', signOut);
  qsDoc('#copy-sql', root).addEventListener('click', async () => {
    try {
      let sql = '';
      for (const m of missing) {
        const res = await fetch(m.path, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Could not load ${m.path}`);
        sql += `${await res.text()}\n\n`;
      }
      if (needsAdmin) sql += `${grantSql(userId)}\n`;
      await copy(sql, 'Setup SQL copied');
    } catch (err) { fail(err, 'Could not build the setup SQL'); }
  });
}

async function signOut() {
  stopPulse();
  await supabase.auth.signOut();
  state.user = null;
  state.profile = null;
  loginScreen();
}
hooks.signOut = signOut;

// ------------------------------------------------------------ live alerts
// While the admin app is open: the Inbox badge stays current, and a card
// slides in the moment a new player signs up or a new report lands. (The
// phone notification for new players covers the times the app is closed.)
let pulseTimer = null;
let since = { users: null, reports: null };
let bannerMounted = false;

function alertCard({ icon, tone = 'info', title, text, run }) {
  let host = document.getElementById('adm-alerts');
  if (!host) { host = document.createElement('div'); host.id = 'adm-alerts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  while (host.children.length >= 3) host.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = `adm-alert adm-alert--${tone}`;
  el.innerHTML = `<span class="adm-chip-icon adm-chip-icon--${tone}">${icon}</span>
    <span class="adm-alert__text"><b>${esc(title)}</b><span>${esc(text)}</span></span>
    <button class="adm-alert__view" data-view>View</button>
    <button class="adm-alert__x" data-x aria-label="Dismiss">${icons.plus()}</button>`;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-view]')) run?.();
    if (e.target.closest('[data-view], [data-x]')) el.remove();
  });
  host.appendChild(el);
  setTimeout(() => el.remove(), 14000);
}

async function pulse() {
  if (document.hidden || !state.user || !state.profile?.is_admin) return;
  const nowIso = new Date().toISOString();
  const [counts, users, reports] = await Promise.all([
    loadAttentionCounts(),
    since.users ? supabase.from('profiles').select('id, username, display_name, created_at').gt('created_at', since.users).neq('id', state.user.id).order('created_at').limit(10) : { data: [] },
    since.reports ? supabase.from('reports').select('id, reason, target_type, created_at').gt('created_at', since.reports).order('created_at').limit(10) : { data: [] },
  ]);
  void counts;
  const newUsers = users.data || [];
  const newReports = reports.data || [];
  since = { users: newUsers.length ? newUsers[newUsers.length - 1].created_at : since.users || nowIso, reports: newReports.length ? newReports[newReports.length - 1].created_at : since.reports || nowIso };
  if (newUsers.length) {
    alertCard({
      icon: icons.people(), tone: 'info',
      title: newUsers.length > 1 ? `${newUsers.length} new players joined` : 'New player joined',
      text: newUsers.slice(0, 3).map((u) => `@${u.username}`).join(', ') + (newUsers.length > 3 ? ` +${newUsers.length - 3}` : ''),
      run: () => (newUsers.length === 1 ? hooks.openUser?.(newUsers[0].id) : go('people?sort=new')),
    });
  }
  if (newReports.length) {
    alertCard({
      icon: icons.flag(), tone: 'bad',
      title: newReports.length > 1 ? `${newReports.length} new reports` : 'New report',
      text: newReports.length === 1 ? (newReports[0].reason || 'No reason given') : 'Tap to review them',
      run: () => (newReports.length === 1 ? hooks.openReport?.(newReports[0].id) : go('reports')),
    });
  }
  // The open Inbox / Reports / Home lists catch up on the next refresh tick.
  if ((newUsers.length || newReports.length) && ['inbox', 'home'].includes(state.screen)) {
    REFRESH[state.screen]?.({ quiet: true });
  }
}

function startPulse() {
  stopPulse();
  since = { users: new Date().toISOString(), reports: new Date().toISOString() };
  pulseTimer = setInterval(pulse, 30000);
  document.addEventListener('visibilitychange', onVisible);
}
function stopPulse() {
  clearInterval(pulseTimer);
  pulseTimer = null;
  document.removeEventListener('visibilitychange', onVisible);
}
function onVisible() { if (!document.hidden) pulse(); }

// ------------------------------------------------------------ boot
// A missing table reads as PGRST205 (PostgREST's schema cache) or 42P01
// (Postgres' own "relation does not exist") depending on whether the cache
// has been reloaded yet. Either means a migration hasn't been run, which is
// a setup story rather than an error.
const isMissingTable = (error) =>
  error?.code === 'PGRST205' || error?.code === '42P01' || /does not exist|schema cache/i.test(error?.message || '');

async function tableExists(table) {
  const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(1);
  return !(error && isMissingTable(error));
}
async function settingExists(key) {
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    return !error && !!data;
  } catch { return false; }
}

async function boot() {
  resetPages();
  root.innerHTML = '<div class="boot-loader"><div class="boot-loader__mark"></div></div>';

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) { loginScreen(); return; }
  state.user = session.user;

  const { data: profile, error: profErr } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (profErr) { fail(profErr, 'Could not load your profile'); loginScreen(); return; }
  state.profile = profile;

  // Every check runs before any is reported, so a first launch hands over one
  // combined block of SQL instead of sending you back and forth.
  const probes = await Promise.all(MIGRATIONS.map(async (m) => ({ migration: m, applied: await m.check() })));
  const missing = probes.filter((p) => !p.applied).map((p) => p.migration);
  if (missing.length || !profile?.is_admin) { setupScreen(session.user.id, { missing, needsAdmin: !profile?.is_admin }); return; }

  // Only worth mounting once an admin session is actually up.
  if (!bannerMounted) { wireConnectionBanner(); bannerMounted = true; }

  render(location.hash.replace(/^#\/?/, '') || 'home');
  loadAttentionCounts().catch(() => {});
  startPulse();
}

boot();

void SCREENS; void qs; void qsa; void setBadge; void ago;
