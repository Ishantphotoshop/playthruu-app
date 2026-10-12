// ============================================================
// MANAGE (the hub), MORE, WAITLIST
// ============================================================
import {
  supabase, state, SCREENS, REFRESH, hooks, paint, header, qs, qsa, stillOn, go, esc, fmtNum, ago, fail, copy,
  displayName, avatarImg, onRow, item, group, pill, chev, chipIcon, emptyBlock, searchBar, wireSearch, sectionHead,
  PROJECT_REF, skeletonRows, touch, toast, chips,
} from '../core.js';
import { downloadCsv, countUp } from '../toolkit.js';
import { loadAttentionCounts } from './home.js';
import { icons } from './icons.js';

// ------------------------------------------------------------ MANAGE
const tile = (to, icon, title, sub, tone = '') => `
  <a class="adm-tile" href="#/${to}" data-go="${to}">
    <span class="adm-tile__icon${tone ? ` adm-chip-icon--${tone}` : ''}">${icon}</span>
    <span class="adm-tile__text"><b>${esc(title)}</b><small data-sub="${to}">${esc(sub)}</small></span>
    <span class="adm-tile__count" data-count-for="${to}" hidden></span>
  </a>`;

SCREENS.manage = function manage() {
  paint(`
    ${header('Manage')}
    <main class="view-body">
      ${sectionHead('Content')}
      <div class="adm-tiles">
        ${tile('trending', icons.flame(), 'Trending', 'What players see first')}
        ${tile('news', icons.news(), 'News', 'The News Brain’s queue')}
        ${tile('announce', icons.megaphone(), 'Announcements', 'Banner on the feed')}
        ${tile('games', icons.game(), 'Games', 'The shared catalog')}
        ${tile('lists', icons.list(), 'Lists', 'Collections players made')}
        ${tile('comments', icons.comment(), 'Comments', 'Read, search, remove')}
      </div>
      ${sectionHead('Watch')}
      <div class="adm-tiles">
        ${tile('activity', icons.activity(), 'Activity', 'Live logs from everyone')}
        ${tile('insights', icons.chart(), 'Insights', 'Charts and top lists')}
        ${tile('reports', icons.flag(), 'Reports', 'Moderation', 'bad')}
        ${tile('people', icons.people(), 'People', 'Everyone who joined')}
      </div>
    </main>`);
  loadManageCounts();
};
REFRESH.manage = () => loadManageCounts();

async function loadManageCounts() {
  const screen = state.screen;
  const head = (q) => q.then((r) => (r.error ? null : r.count));
  const [curated, review, live, games, lists, comments, reports, players] = await Promise.all([
    head(supabase.from('curated_trending').select('id', { count: 'exact', head: true })),
    head(supabase.from('news_articles').select('id', { count: 'exact', head: true }).eq('status', 'review')),
    head(supabase.from('announcements').select('id', { count: 'exact', head: true }).eq('is_active', true)),
    head(supabase.from('games').select('id', { count: 'exact', head: true })),
    head(supabase.from('lists').select('id', { count: 'exact', head: true })),
    head(supabase.from('comments').select('id', { count: 'exact', head: true })),
    head(supabase.from('reports').select('id', { count: 'exact', head: true }).in('status', ['open', 'reviewed'])),
    head(supabase.from('profiles').select('id', { count: 'exact', head: true })),
  ]);
  if (!stillOn(screen)) return;
  const sub = (to, text) => { const el = qs(`[data-sub="${to}"]`); if (el && text) el.textContent = text; };
  const badge = (to, n) => { const el = qs(`[data-count-for="${to}"]`); if (el) { el.hidden = !n; el.textContent = fmtNum(n); } };
  if (curated !== null) sub('trending', `${curated} featured`);
  if (review !== null) { sub('news', review ? `${review} to review` : 'Nothing to review'); badge('news', review); }
  if (live !== null) sub('announce', live ? `${live} live now` : 'No banner live');
  if (games !== null) sub('games', `${fmtNum(games)} in the catalog`);
  if (lists !== null) sub('lists', `${fmtNum(lists)} ${lists === 1 ? 'list' : 'lists'}`);
  if (comments !== null) sub('comments', `${fmtNum(comments)} ${comments === 1 ? 'comment' : 'comments'}`);
  if (reports !== null) { sub('reports', reports ? `${reports} open` : 'Nothing open'); badge('reports', reports); }
  if (players !== null) sub('people', `${fmtNum(players)} ${players === 1 ? 'player' : 'players'}`);
  touch(screen);
}

// ------------------------------------------------------------ MORE
SCREENS.more = function more() {
  const me = state.profile || {};
  paint(`
    ${header('More')}
    <main class="view-body">
      <div class="adm-account">
        ${avatarImg(me, 56)}
        <div class="adm-account__text">
          <b>${esc(displayName(me))} ${pill('ADMIN', 'info')}</b>
          <span>@${esc(me.username || '')}</span>
          <span>${esc(state.user?.email || '')}</span>
        </div>
      </div>

      ${sectionHead('Tools')}
      ${group(`
        ${item({ id: 'audit', lead: chipIcon(icons.shield(), 'warn'), title: 'Admin log', meta: 'Who did what, and when', trail: chev(), attrs: 'data-to="audit"' })}
        ${item({ id: 'waitlist', lead: chipIcon(icons.mail(), 'info'), title: 'Waitlist', meta: '<span id="wl-sub">Signups from the website</span>', trail: chev(), attrs: 'data-to="waitlist"' })}
        ${item({ id: 'export-people', lead: chipIcon(icons.download()), title: 'Export players', meta: 'Everyone, as a CSV file', trail: chev(), attrs: 'data-run="export-people"' })}
        ${item({ id: 'export-games', lead: chipIcon(icons.download()), title: 'Export games', meta: 'The whole catalog, as a CSV file', trail: chev(), attrs: 'data-run="export-games"' })}`)}

      ${sectionHead('Open')}
      ${group(`
        ${item({ id: 'app', lead: chipIcon(icons.game()), title: 'The PlayThruu app', meta: 'See it the way players do', trail: icons.open(), attrs: 'data-href="../"' })}
        ${item({ id: 'news-admin', lead: chipIcon(icons.news()), title: 'News admin on the website', meta: 'Full editor with sources and SEO', trail: icons.open(), attrs: 'data-href="https://playthruu.com/admin/news"' })}
        ${item({ id: 'supabase', lead: chipIcon(icons.shield()), title: 'Supabase dashboard', meta: 'Database, logs and functions', trail: icons.open(), attrs: `data-href="https://supabase.com/dashboard/project/${PROJECT_REF}"` })}
        ${item({ id: 'classic', lead: chipIcon(icons.refresh()), title: 'Classic admin', meta: 'The previous version, as a fallback', trail: icons.open(), attrs: 'data-href="../admin-classic/"' })}`)}

      ${sectionHead('Session')}
      <button class="btn btn--block" id="signout">${icons.signout()} Sign out</button>
      <p class="adm-hint">Changes here are live the moment you make them. This is the production database, not a copy.</p>
    </main>`);

  qs('#signout').addEventListener('click', () => hooks.signOut?.());
  const host = qs('.view-body');
  onRow(host, '.adm-item', (row) => {
    if (row.dataset.to) go(row.dataset.to);
    else if (row.dataset.href) window.open(row.dataset.href, '_blank', 'noopener');
    else if (row.dataset.run === 'export-people') hooks.exportPeople?.();
    else if (row.dataset.run === 'export-games') exportAllGames();
  });
  head(supabase.from('waitlist').select('id', { count: 'exact', head: true })).then((n) => {
    const el = qs('#wl-sub');
    if (el && n !== null) el.textContent = `${fmtNum(n)} ${n === 1 ? 'signup' : 'signups'}`;
  });
};
const head = (q) => q.then((r) => (r.error ? null : r.count));

async function exportAllGames() {
  const { data, error } = await supabase.from('games').select('id, title, release_year, is_hidden, igdb_id, rawg_id, cover_url, created_at').order('created_at', { ascending: false }).limit(5000);
  if (error) return fail(error);
  downloadCsv(`playthruu-games-${new Date().toISOString().slice(0, 10)}.csv`, (data || []).map((g) => ({
    id: g.id, title: g.title, year: g.release_year ?? '', hidden: g.is_hidden ? 'yes' : 'no', igdb_id: g.igdb_id ?? '', rawg_id: g.rawg_id ?? '', cover_url: g.cover_url ?? '', added: g.created_at,
  })));
}

// ------------------------------------------------------------ WAITLIST
let waitQuery = '';
let waitRows = [];

SCREENS.waitlist = function waitlist() {
  paint(`
    ${header('Waitlist')}
    <main class="view-body">
      <div class="adm-sticky">${searchBar({ id: 'w-q', placeholder: 'Search emails', value: waitQuery })}</div>
      <div class="adm-stats adm-stats--3" id="wl-stats"></div>
      <div class="adm-btn-row adm-btn-row--tight">
        <button class="btn" id="wl-copy">${icons.copy()} Copy emails</button>
        <button class="btn" id="wl-export">${icons.download()} Export CSV</button>
      </div>
      <div id="list" class="adm-gap-top">${skeletonRows(6, { thumb: false })}</div>
    </main>`);
  wireSearch(qs('.adm-sticky'), { id: 'w-q', onChange: (v) => { waitQuery = v; drawWaitlist(); } });
  qs('#wl-copy').addEventListener('click', () => {
    const emails = waitRows.map((w) => w.email).filter(Boolean);
    if (!emails.length) { toast('No emails yet', 'error'); return; }
    copy(emails.join(', '), `${emails.length} emails copied`);
  });
  qs('#wl-export').addEventListener('click', () => downloadCsv(`playthruu-waitlist-${new Date().toISOString().slice(0, 10)}.csv`, waitRows.map((w) => ({ email: w.email, source: w.source ?? 'direct', signed_up: w.created_at }))));
  paintWaitlist();
};
REFRESH.waitlist = () => paintWaitlist();

async function paintWaitlist() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase.from('waitlist').select('id, email, source, created_at').order('created_at', { ascending: false }).limit(1000);
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }
  waitRows = data || [];
  const week = waitRows.filter((w) => Date.now() - new Date(w.created_at).getTime() < 7 * 86400000).length;
  const sources = new Set(waitRows.map((w) => w.source).filter(Boolean));
  const stats = qs('#wl-stats');
  if (stats) {
    stats.innerHTML = `<div class="adm-stat adm-stat--green"><b>${fmtNum(waitRows.length)}</b><span>Total</span></div><div class="adm-stat"><b>${fmtNum(week)}</b><span>New / 7d</span></div><div class="adm-stat"><b>${fmtNum(sources.size)}</b><span>Sources</span></div>`;
  }
  drawWaitlist();
  touch(screen);
}

function drawWaitlist() {
  const host = qs('#list');
  if (!host) return;
  const q = waitQuery.toLowerCase();
  const rows = q ? waitRows.filter((w) => (w.email || '').toLowerCase().includes(q) || (w.source || '').toLowerCase().includes(q)) : waitRows;
  if (!rows.length) { host.innerHTML = emptyBlock(waitRows.length ? 'No email matches that.' : 'Nobody on the waitlist yet.', icons.mail()); return; }
  host.innerHTML = group(rows.map((w) => item({
    id: w.id, lead: chipIcon(icons.mail()), title: esc(w.email), meta: `${esc(w.source || 'direct')} · ${esc(ago(w.created_at))}`,
    trail: `<span class="adm-pillbtn">Copy</span>`,
  })).join(''));
  onRow(host, '.adm-item', (row) => copy(rows.find((w) => w.id === row.dataset.id)?.email || '', 'Email copied'));
}

// ------------------------------------------------------------ ADMIN LOG
let logFilter = 'all';
const LOG_FILTERS = [['all', 'Everything'], ['mine', 'Mine'], ['people', 'People'], ['reports', 'Reports'], ['content', 'Content']];
const PEOPLE_ACTIONS = new Set(['suspend', 'restore', 'make_admin', 'remove_admin']);
const toneFor = (a) => (/^(suspend|delete_|remove_admin|unfeature)/.test(a) ? 'bad' : /^(restore|show_|feature|banner_post|banner_on)/.test(a) ? 'ok' : /^report_/.test(a) ? 'info' : 'warn');
const iconFor = (a) => (/^(suspend|restore|make_admin|remove_admin)/.test(a) ? icons.user() : /^report_/.test(a) ? icons.flag() : /^delete_/.test(a) ? icons.trash() : /game/.test(a) ? icons.game() : /banner/.test(a) ? icons.megaphone() : /trending|feature/.test(a) ? icons.flame() : icons.edit());

SCREENS.audit = function auditScreen() {
  paint(`
    ${header('Admin log')}
    <main class="view-body">
      <div class="adm-sticky" id="log-chips">${chips(LOG_FILTERS, logFilter, 'data-filter')}</div>
      <p class="adm-hint adm-hint--top">Every change made from this control room. Entries can’t be edited or deleted.</p>
      <div id="list">${skeletonRows(6, { thumb: false })}</div>
    </main>`);
  qsa('[data-filter]').forEach((b) => b.addEventListener('click', () => { logFilter = b.dataset.filter; qsa('[data-filter]').forEach((x) => { const on = x === b; x.classList.toggle('adm-chip--on', on); x.setAttribute('aria-selected', String(on)); }); paintLog(); }));
  paintLog();
};
REFRESH.audit = () => paintLog();

async function paintLog() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase.from('admin_audit').select('*').order('created_at', { ascending: false }).limit(200);
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(/does not exist|schema cache/i.test(error.message) ? 'The admin log isn’t switched on yet. Run migrations/2026-10-14_admin_audit.sql in Supabase.' : error.message); return; }
  const rows = (data || []).filter((r) => (logFilter === 'mine' ? r.actor_id === state.user.id
    : logFilter === 'people' ? PEOPLE_ACTIONS.has(r.action)
    : logFilter === 'reports' ? r.action.startsWith('report_')
    : logFilter === 'content' ? !PEOPLE_ACTIONS.has(r.action) && !r.action.startsWith('report_') : true));
  if (!rows.length) { host.innerHTML = emptyBlock(logFilter === 'all' ? 'Nothing logged yet. Actions you take here will show up in this list.' : 'Nothing here.', icons.shield()); return; }
  const openable = (r) => ['profile', 'game', 'list'].includes(r.target_type) && r.target_id;
  host.innerHTML = group(rows.map((r) => item({
    id: r.id, lead: chipIcon(iconFor(r.action), toneFor(r.action)), title: esc(r.summary),
    meta: `by ${esc(r.actor_name || 'an admin')}`, meta2: esc(ago(r.created_at)), trail: openable(r) ? chev() : '', attrs: openable(r) ? `data-type="${esc(r.target_type)}" data-target="${esc(r.target_id)}"` : '',
  })).join(''));
  onRow(host, '.adm-item[data-target]', (row) => {
    const { type, target } = row.dataset;
    if (type === 'profile') hooks.openUser?.(target);
    else if (type === 'game') hooks.openGame?.(target);
    else if (type === 'list') hooks.openList?.(target);
  });
  touch(screen);
}

void loadAttentionCounts; void countUp;
