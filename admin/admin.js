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
import {
  emptyState, spinner, avatarImg,
  iconBack, iconChevronRight, iconChevronUp, iconChevronDown,
  iconFlame, iconNewspaper, iconUser, iconFlag, iconGamepad,
  iconTrash, iconCheck, iconEye, iconNote, iconMessage, iconDiary,
} from '../js/components.js';

const PROJECT_REF = 'kpgjuuplpgilupogpezc';
const SQL_EDITOR_URL = `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`;

// Each migration this build needs, with a table to probe for. Listing
// them means the setup screen can tell WHICH are outstanding and hand
// over only those — someone who already ran the first one shouldn't be
// asked to paste it again.
const MIGRATIONS = [
  { path: '../migrations/2026-09-02_admin_toolkit.sql', probe: 'app_settings' },
  { path: '../migrations/2026-09-02_presence_and_moderation.sql', probe: 'user_presence' },
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
  state.screen = screen;
  (SCREENS[screen] || SCREENS.home)();
}

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
  { id: 'trending', icon: iconFlame, title: 'Trending now', sub: 'Hand-pick what the feed features' },
  { id: 'news', icon: iconNewspaper, title: 'News', sub: 'Publish your own posts' },
  { id: 'announce', icon: iconMegaphone, title: 'Announcement', sub: "Banner across everyone's feed" },
  { id: 'activity', icon: iconDiary, title: 'Activity', sub: 'Everything happening right now' },
  { id: 'people', icon: iconUser, title: 'People', sub: "Who's online, suspend, promote" },
  { id: 'reports', icon: iconFlag, title: 'Reports', sub: 'Moderation queue', badge: () => state.openReports },
  { id: 'comments', icon: iconMessage, title: 'Comments', sub: 'Read and remove' },
  { id: 'games', icon: iconGamepad, title: 'Games', sub: 'Hide or remove catalog entries' },
];

SCREENS.home = function home() {
  paint(`
    ${header('PlayThruu')}
    <main class="view-body">
      <h2 class="section-heading">At a glance</h2>
      <div class="stat-card-row" id="stats-1"></div>
      <div class="stat-card-row" id="stats-2" style="margin-top:calc(-1 * var(--space-3))"></div>

      <h2 class="section-heading">Control</h2>
      <div class="list-cards" id="nav">
        ${SECTIONS.map((s) => `
          <button class="list-card adm-tile" data-go="${s.id}">
            <span class="adm-tile__icon">${s.icon()}</span>
            <span class="list-card__body">
              <span class="list-card__name">${esc(s.title)}</span>
              <span class="list-card__meta">${esc(s.sub)}</span>
            </span>
            <span class="adm-badge-slot" data-slot="${s.id}"></span>
            <span class="list-card__chev">${iconChevronRight()}</span>
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
      <p class="adm-hint">Changes here are live immediately — this is the production database, not a copy.</p>
    </main>`);

  qs('#signout').addEventListener('click', signOut);
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

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [players, logs, games, reviews, online, newLogs, reports] = await Promise.all([
    count('profiles'),
    count('logs'),
    count('games'),
    count('logs', (q) => q.not('review', 'is', null)),
    count('user_presence', (q) => q.gte('last_seen_at', new Date(Date.now() - ONLINE_WINDOW_MS).toISOString())),
    count('logs', (q) => q.gte('created_at', since)),
    count('reports', (q) => q.neq('status', 'resolved')),
  ]);

  state.openReports = reports || 0;

  const tile = (value, label, variant) => `
    <div class="stat-card stat-card--${variant}"><b>${fmtNum(value)}</b><span>${label}</span></div>`;

  const row1 = qs('#stats-1');
  const row2 = qs('#stats-2');
  if (row1) {
    row1.innerHTML = tile(online, 'Online', 'green') + tile(players, 'Players', 'grey') + tile(logs, 'Logs', 'grey');
  }
  if (row2) {
    row2.innerHTML = tile(newLogs, 'Logs / 7d', 'blue') + tile(reviews, 'Reviews', 'grey') + tile(games, 'Games', 'grey');
  }

  // The reports badge is only known once the counts land, so its slot is
  // filled retroactively rather than rendering the whole menu twice.
  const slot = qs('[data-slot="reports"]');
  if (slot && state.openReports) slot.innerHTML = `<span class="adm-count">${state.openReports}</span>`;
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
    <div class="list-card adm-row" data-id="${r.id}">
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

  qsa('[data-move]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const idx = data.findIndex((r) => r.id === btn.closest('.adm-row').dataset.id);
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
        <span class="adm-row__meta">
          ${p.is_published ? '' : 'DRAFT · '}${p.pinned ? 'PINNED · ' : ''}${esc(p.source)} · ${esc(timeAgo(p.published_at))} ago
        </span>
      </span>
      <span class="adm-row__actions">
        <button class="icon-btn icon-btn--small" data-edit aria-label="Edit">${iconNote()}</button>
        <button class="icon-btn icon-btn--small" data-del aria-label="Delete">${iconTrash()}</button>
      </span>
    </div>`).join('');

  qsa('[data-edit]', host).forEach((btn) => btn.addEventListener('click', () => {
    openNewsEditor(data.find((p) => p.id === btn.closest('.adm-row').dataset.id));
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
    <div class="adm-btn-row">
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn--accent" id="n-save">${editing ? 'Save' : 'Publish'}</button>
    </div>`, (sheet, close) => {
    qsa('.adm-switch', sheet).forEach((sw) => sw.addEventListener('click', () => {
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
        const { error } = editing
          ? await supabase.from('custom_news').update(payload).eq('id', post.id)
          : await supabase.from('custom_news').insert({ ...payload, created_by: state.user.id });
        if (error) throw error;
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
SCREENS.activity = function activity() {
  paint(`
    ${header('Activity', { back: true })}
    <main class="view-body">
      <p class="adm-hint" style="margin-top:0">The most recent public logs across the whole app.</p>
      <div id="list" style="margin-top:var(--space-3)">${spinner()}</div>
    </main>`);
  paintActivity();
};

async function paintActivity() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase
    .from('logs')
    .select('id, status, rating, review, loved, created_at, games!logs_game_id_fkey(title, cover_url), profiles!logs_user_id_fkey(username, display_name, avatar_url)')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(40);

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
SCREENS.people = function people() {
  paint(`
    ${header('People', { back: true })}
    <main class="view-body">
      <div class="segmented segmented--wide" id="sort">
        <button class="segmented__item segmented__item--active" data-sort="seen">Last seen</button>
        <button class="segmented__item" data-sort="new">Newest</button>
      </div>
      <label class="field adm-search"><span>Search</span>
        <input type="search" id="u-q" placeholder="Username or name…" autocomplete="off">
      </label>
      <div id="list">${spinner()}</div>
    </main>`);

  let sort = 'seen';
  let timer;
  qs('#u-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => paintPeople(e.target.value.trim(), sort), 260);
  });
  qsa('[data-sort]').forEach((btn) => btn.addEventListener('click', () => {
    sort = btn.dataset.sort;
    qsa('[data-sort]').forEach((b) => b.classList.toggle('segmented__item--active', b === btn));
    paintPeople(qs('#u-q').value.trim(), sort);
  }));

  paintPeople('', sort);
};

async function paintPeople(query, sort) {
  const host = qs('#list');
  if (!host) return;
  let q = supabase.from('profiles')
    .select('id, username, display_name, avatar_url, is_admin, is_suspended, created_at')
    .order('created_at', { ascending: false })
    .limit(80);
  if (query) q = q.or(`username.ilike.%${query}%,display_name.ilike.%${query}%`);

  const { data, error } = await q;
  if (error) { host.innerHTML = emptyState(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyState('Nobody matched that.', { icon: iconUser() }); return; }

  // Presence comes from a second query keyed on the ids just returned,
  // rather than a PostgREST embed — the embed needs the exact foreign
  // key constraint name, and this doesn't care what it's called.
  const seen = await getPresenceFor(data.map((p) => p.id));

  const rows = [...data];
  if (sort === 'seen') {
    // Never-seen accounts sort last rather than first, which is what
    // treating a missing timestamp as 0 would otherwise do.
    rows.sort((a, b) => new Date(seen[b.id] || 0) - new Date(seen[a.id] || 0));
  }

  host.innerHTML = rows.map((p) => `
    <div class="list-card adm-row" data-id="${p.id}">
      ${avatarImg(p, 40)}
      <span class="adm-row__body">
        <span class="adm-row__title">${esc(p.display_name || p.username)}${p.is_admin ? ' · ADMIN' : ''}${p.is_suspended ? ' · SUSPENDED' : ''}</span>
        <span class="adm-row__meta">@${esc(p.username)}</span>
        <span class="adm-row__meta">${presenceHtml(seen[p.id])}</span>
      </span>
      <span class="adm-row__actions">
        <button class="icon-btn icon-btn--small" data-manage aria-label="Manage">${iconChevronRight()}</button>
      </span>
    </div>`).join('');

  qsa('[data-manage]', host).forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.closest('.adm-row').dataset.id;
    openUserSheet(rows.find((p) => p.id === id), seen[id], query, sort);
  }));
}

function openUserSheet(user, lastSeenAt, query, sort) {
  const isSelf = user.id === state.user.id;
  openSheet(user.display_name || user.username, `
    <p class="modal__hint">@${esc(user.username)} · ${presenceHtml(lastSeenAt)} · joined ${esc(timeAgo(user.created_at))} ago</p>
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
      paintPeople(query, sort);
    };

    qs('#u-susp', sheet).addEventListener('click', (e) => flip(e.currentTarget, 'is_suspended'));
    qs('#u-admin', sheet).addEventListener('click', (e) => flip(e.currentTarget, 'is_admin'));
  });
}

// ============================================================
// REPORTS
// ============================================================
SCREENS.reports = function reports() {
  paint(`${header('Reports', { back: true })}<main class="view-body"><div id="list">${spinner()}</div></main>`);
  paintReports();
};

async function paintReports() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(80);
  if (error) { host.innerHTML = emptyState(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyState('Nothing reported. Quiet night.', { icon: iconFlag() }); return; }

  const reporterIds = [...new Set(data.map((r) => r.reporter_id).filter(Boolean))];
  let names = {};
  if (reporterIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, username').in('id', reporterIds);
    names = Object.fromEntries((profs || []).map((p) => [p.id, p.username]));
  }

  host.innerHTML = data.map((r) => `
    <div class="list-card adm-row" data-id="${r.id}">
      <span class="adm-row__body">
        <span class="adm-row__title adm-row__title--wrap">${esc(r.reason || 'No reason given')}</span>
        <span class="adm-row__meta">${r.status === 'resolved' ? 'RESOLVED' : 'OPEN'} · ${esc(r.target_type || 'item')} · @${esc(names[r.reporter_id] || 'unknown')} · ${esc(timeAgo(r.created_at))} ago</span>
      </span>
      ${r.status === 'resolved' ? '' : `
        <span class="adm-row__actions">
          <button class="icon-btn icon-btn--small" data-resolve aria-label="Resolve">${iconCheck()}</button>
        </span>`}
    </div>`).join('');

  qsa('[data-resolve]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    const { error: upErr } = await supabase.from('reports').update({ status: 'resolved' }).eq('id', id);
    if (upErr) return fail(upErr);
    toast('Resolved', 'success');
    paintReports();
  }));
}

// ============================================================
// COMMENTS
// ============================================================
SCREENS.comments = function comments() {
  paint(`
    ${header('Comments', { back: true })}
    <main class="view-body">
      <p class="adm-hint" style="margin-top:0">The most recent comments across the app. Deleting one is permanent.</p>
      <div id="list" style="margin-top:var(--space-3)">${spinner()}</div>
    </main>`);
  paintComments();
};

async function paintComments() {
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase
    .from('comments').select('id, body, created_at, user_id, log_id')
    .order('created_at', { ascending: false }).limit(60);

  if (error) { host.innerHTML = emptyState(error.message); return; }
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
      <div class="list-card adm-row" data-id="${c.id}">
        ${avatarImg(who || {}, 36)}
        <span class="adm-row__body">
          <span class="adm-row__title adm-row__title--wrap">${esc(c.body)}</span>
          <span class="adm-row__meta">@${esc(who?.username || 'unknown')} · ${esc(timeAgo(c.created_at))} ago</span>
        </span>
        <span class="adm-row__actions">
          <button class="icon-btn icon-btn--small" data-del aria-label="Delete">${iconTrash()}</button>
        </span>
      </div>`;
  }).join('');

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    if (!await confirmSheet({ title: 'Delete this comment?', sub: 'It disappears for everyone, permanently.', confirmLabel: 'Delete', danger: true })) return;
    const { error: delErr } = await supabase.from('comments').delete().eq('id', id);
    if (delErr) return fail(delErr);
    toast('Deleted', 'success');
    paintComments();
  }));
}

// ============================================================
// GAMES
// ============================================================
SCREENS.games = function games() {
  paint(`
    ${header('Games', { back: true })}
    <main class="view-body">
      <label class="field adm-search"><span>Search the catalog</span>
        <input type="search" id="g-q" placeholder="Title…" autocomplete="off">
      </label>
      <div id="list">${spinner()}</div>
      <p class="adm-hint">Hiding keeps the row (and everyone's logs of it) but pulls the game out of search and trending. Deleting removes it for good.</p>
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
    .order('created_at', { ascending: false }).limit(50);
  if (query) q = q.ilike('title', `%${query}%`);

  const { data, error } = await q;
  if (error) { host.innerHTML = emptyState(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyState('No games matched.', { icon: iconGamepad() }); return; }

  host.innerHTML = data.map((g) => `
    <div class="list-card adm-row" data-id="${g.id}">
      ${g.cover_url ? `<img class="adm-thumb" src="${esc(g.cover_url)}" alt="" loading="lazy">` : '<span class="adm-thumb"></span>'}
      <span class="adm-row__body">
        <span class="adm-row__title">${esc(g.title)}${g.is_hidden ? ' · HIDDEN' : ''}</span>
        <span class="adm-row__meta">${g.release_year ? esc(g.release_year) : ''}</span>
      </span>
      <span class="adm-row__actions">
        <button class="icon-btn icon-btn--small" data-edit aria-label="Edit">${iconNote()}</button>
        <button class="icon-btn icon-btn--small" data-hide aria-label="Hide">${iconEye()}</button>
        <button class="icon-btn icon-btn--small" data-del aria-label="Delete">${iconTrash()}</button>
      </span>
    </div>`).join('');

  qsa('[data-edit]', host).forEach((btn) => btn.addEventListener('click', () => {
    openGameEditor(data.find((g) => g.id === btn.closest('.adm-row').dataset.id), query);
  }));

  qsa('[data-hide]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    const current = data.find((g) => g.id === id);
    const { error: upErr } = await supabase.from('games').update({ is_hidden: !current.is_hidden }).eq('id', id);
    if (upErr) return fail(upErr);
    toast(current.is_hidden ? 'Visible again' : 'Hidden', 'success');
    paintGames(query);
  }));

  qsa('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.adm-row').dataset.id;
    const game = data.find((g) => g.id === id);
    if (!await confirmSheet({
      title: `Delete ${game.title}?`,
      sub: "Every log, review and list entry pointing at this game goes with it. Hiding is usually what you want instead.",
      confirmLabel: 'Delete for good', danger: true,
    })) return;
    const { error: delErr } = await supabase.from('games').delete().eq('id', id);
    if (delErr) return fail(delErr);
    toast('Deleted', 'success');
    paintGames(query);
  }));
}

// IGDB's metadata is wrong often enough to be worth a fix-up screen —
// a mis-scraped year or a missing cover otherwise sticks forever.
function openGameEditor(game, query) {
  openSheet('Edit game', `
    <p class="modal__hint">Corrects what the catalog stores. Everyone's logs of this game keep pointing at it.</p>
    <label class="field"><span>Title</span><input id="g-title" value="${esc(game.title || '')}"></label>
    <label class="field"><span>Cover URL</span><input id="g-cover" value="${esc(game.cover_url || '')}" placeholder="https://…"></label>
    <label class="field"><span>Release year</span><input id="g-year" type="number" inputmode="numeric" value="${esc(game.release_year || '')}" placeholder="2024"></label>
    <div class="adm-btn-row">
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn--accent" id="g-save">Save</button>
    </div>`, (sheet, close) => {
    qs('[data-act="cancel"]', sheet).addEventListener('click', close);
    qs('#g-save', sheet).addEventListener('click', async () => {
      const title = qs('#g-title', sheet).value.trim();
      if (!title) { toast('A title is required', 'error'); return; }
      const yearRaw = qs('#g-year', sheet).value.trim();
      const btn = qs('#g-save', sheet);
      btn.disabled = true;
      const { error } = await supabase.from('games').update({
        title,
        cover_url: qs('#g-cover', sheet).value.trim() || null,
        release_year: yearRaw ? Number(yearRaw) : null,
      }).eq('id', game.id);
      if (error) { btn.disabled = false; return fail(error); }
      close();
      toast('Saved', 'success');
      paintGames(query);
    });
  });
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
  const probes = await Promise.all(MIGRATIONS.map(async (m) => {
    const { error } = await supabase.from(m.probe).select('*', { head: true, count: 'exact' }).limit(1);
    return { migration: m, missing: !!(error && isMissingTable(error)) };
  }));
  const missing = probes.filter((p) => p.missing).map((p) => p.migration);
  const needsAdmin = !profile?.is_admin;

  if (missing.length || needsAdmin) {
    setupScreen(session.user.id, { missing, needsAdmin });
    return;
  }

  render(location.hash.replace(/^#\/?/, '') || 'home');
}

boot();
