// ============================================================
// INBOX + REPORTS
// ============================================================
// The Inbox gathers everything waiting on a decision: open reports, news in
// the review queue, flagged stories and new players. Each item opens the
// same sheet it would from its own screen.
import {
  supabase, state, SCREENS, REFRESH, ENTER, hooks, paint, header, qs, qsa, stillOn, go, esc, fmtNum, ago, fail,
  displayName, avatarImg, onRow, item, group, poster, pill, chev, chipIcon, sectionHead, emptyBlock, chips, syncChips,
  openSheet, confirmSheet, openApp, skeletonRows, touch, toast, setBadge, audit,
} from '../core.js';
import { bulkSelect } from '../toolkit.js';
import { loadAttentionCounts } from './home.js';
import { icons } from './icons.js';

const OPEN_STATUSES = ['open', 'reviewed'];
const DONE_STATUSES = ['resolved', 'dismissed'];
const isDone = (r) => DONE_STATUSES.includes(r.status);
const KIND_LABEL = { profile: 'Profile', log: 'Review', list: 'List', game: 'Game' };

// ------------------------------------------------------------ report context
// What each report points at, and whose it is.
async function reportTargets(rows) {
  const ids = (type) => [...new Set(rows.filter((r) => r.target_type === type).map((r) => r.target_id).filter(Boolean))];
  const out = {};
  const [logs, lists, games] = await Promise.all([
    ids('log').length ? supabase.from('logs').select('id, user_id, review, rating, games!logs_game_id_fkey(title)').in('id', ids('log')) : { data: [] },
    ids('list').length ? supabase.from('lists').select('id, user_id, name').in('id', ids('list')) : { data: [] },
    ids('game').length ? supabase.from('games').select('id, title, is_hidden').in('id', ids('game')) : { data: [] },
  ]);
  ids('profile').forEach((id) => { out[id] = { userId: id }; });
  (logs.data || []).forEach((l) => { out[l.id] = { userId: l.user_id, label: l.games?.title || 'a game', text: l.review || '' }; });
  (lists.data || []).forEach((l) => { out[l.id] = { userId: l.user_id, label: l.name }; });
  (games.data || []).forEach((g) => { out[g.id] = { label: g.title, hidden: !!g.is_hidden }; });
  return out;
}

async function reportPeople(rows, targets) {
  const userIds = [...new Set([...rows.map((r) => r.reporter_id), ...Object.values(targets).map((t) => t.userId)].filter(Boolean))];
  if (!userIds.length) return {};
  const { data } = await supabase.from('profiles').select('id, username, display_name, avatar_url, is_suspended, is_admin').in('id', userIds);
  return Object.fromEntries((data || []).map((p) => [p.id, p]));
}

const whoName = (people, id) => (people[id] ? `@${people[id].username}` : 'a deleted account');

function aboutText(r, targets, people) {
  const t = targets[r.target_id];
  if (!t) return `${KIND_LABEL[r.target_type] || 'Item'} (gone)`;
  if (r.target_type === 'profile') return people[t.userId] ? `Profile ${whoName(people, t.userId)}${people[t.userId].is_suspended ? ' (suspended)' : ''}` : 'Profile (account deleted)';
  if (r.target_type === 'game') return `Game ${t.label}${t.hidden ? ' (hidden)' : ''}`;
  return `${KIND_LABEL[r.target_type]} of ${t.label} by ${whoName(people, t.userId)}`;
}

const reportRow = (r, targets, people, { pick = false } = {}) => item({
  id: r.id, pick: pick && !isDone(r),
  lead: chipIcon(icons.flag(), isDone(r) ? 'muted' : 'bad'),
  title: esc(r.reason || 'No reason given'),
  meta: esc(aboutText(r, targets, people)),
  meta2: `${esc(r.status)} · by ${esc(whoName(people, r.reporter_id))} · ${esc(ago(r.created_at))}`,
  trail: chev(),
});

async function setReportStatus(ids, status, msg) {
  const { error } = await supabase.from('reports').update({ status }).in('id', ids);
  if (error) { fail(error); return false; }
  if (msg) toast(msg, 'success');
  audit(`report_${status}`, `${status === 'resolved' ? 'Resolved' : status === 'dismissed' ? 'Dismissed' : 'Reopened'} ${ids.length === 1 ? 'a report' : `${ids.length} reports`}`, { type: 'report', id: ids[0] });
  await refreshReportViews();
  return true;
}

// After any change: repaint whichever of Reports / Inbox / Home is built,
// and update the tab badge.
async function refreshReportViews() {
  loadAttentionCounts();
  REFRESH.reports?.({ quiet: true });
  if (state.screen === 'inbox') REFRESH.inbox?.({ quiet: true });
}

// ------------------------------------------------------------ REPORTS
let reportsFilter = 'open';

SCREENS.reports = function reports() {
  if (['open', 'resolved', 'all'].includes(state.params.get('filter'))) reportsFilter = state.params.get('filter');
  paint(`
    ${header('Reports')}
    <main class="view-body">
      <div class="adm-sticky">${chips([['open', 'Open'], ['resolved', 'Closed'], ['all', 'All']], reportsFilter, 'data-filter')}</div>
      <div id="list">${skeletonRows(5, { thumb: false })}</div>
    </main>`);
  qsa('[data-filter]').forEach((b) => b.addEventListener('click', () => { reportsFilter = b.dataset.filter; syncChips(qs('.adm-sticky'), reportsFilter, 'data-filter'); paintReports(); }));
  paintReports();
};
REFRESH.reports = () => paintReports();
ENTER.reports = (params) => {
  const f = params.get('filter');
  if (!f) return false;
  reportsFilter = f;
  syncChips(qs('.adm-sticky'), reportsFilter, 'data-filter');
  paintReports();
  return true;
};

async function paintReports() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  let q = supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(120);
  if (reportsFilter === 'open') q = q.in('status', OPEN_STATUSES);
  if (reportsFilter === 'resolved') q = q.in('status', DONE_STATUSES);
  const { data, error } = await q;
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }
  if (!data?.length) {
    host.innerHTML = emptyBlock(reportsFilter === 'open' ? 'Nothing open. Quiet night.' : 'Nothing here.', icons.flag());
    host.__bulk?.attach();
    return;
  }
  const targets = await reportTargets(data);
  const people = await reportPeople(data, targets);
  if (!stillOn(screen)) return;

  host.innerHTML = group(data.map((r) => reportRow(r, targets, people, { pick: true })).join(''));
  bulkSelect(host, {
    idOf: (row) => row.dataset.id, label: 'reports',
    actions: [
      { label: 'Resolve', run: (ids) => setReportStatus(ids, 'resolved', `${ids.length} resolved`) },
      { label: 'Dismiss', run: (ids) => setReportStatus(ids, 'dismissed', `${ids.length} dismissed`) },
    ],
  });
  onRow(host, '.adm-item', (row) => openReport(row.dataset.id));
  touch(screen);
}

// ------------------------------------------------------------ THE REPORT SHEET
export async function openReport(id) {
  const { data: r } = await supabase.from('reports').select('*').eq('id', id).maybeSingle();
  if (!r) { toast('That report is gone', 'error'); return; }
  const targets = await reportTargets([r]);
  const people = await reportPeople([r], targets);
  const target = targets[r.target_id];
  const user = target?.userId ? people[target.userId] : null;
  const isSelf = user && user.id === state.user.id;
  const done = isDone(r);
  const link = !target ? null
    : r.target_type === 'profile' ? (user ? `profile/${encodeURIComponent(user.username)}` : null)
    : r.target_type === 'log' ? `review/${r.target_id}`
    : r.target_type === 'list' ? `list/${r.target_id}` : `game/${r.target_id}`;
  const act = (key, icon, label, hint = '', danger = false) => `
    <button class="adm-action${danger ? ' adm-action--danger' : ''}" data-act="${key}"><span class="adm-action__icon">${icon}</span><span class="adm-action__text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></button>`;

  openSheet('Report', `
    <div class="adm-reason"><span>Reason</span><p>${esc(r.reason || 'No reason given')}</p></div>
    <div class="adm-box adm-box--pad">
      <b class="adm-about">${esc(aboutText(r, targets, people))}</b>
      ${target?.text ? `<p class="adm-quote">${esc(target.text.slice(0, 500))}${target.text.length > 500 ? '…' : ''}</p>` : ''}
      <span class="adm-about__meta">Reported by ${esc(whoName(people, r.reporter_id))} · ${esc(ago(r.created_at))} · ${esc(r.status)}</span>
    </div>
    <div class="adm-actions">
      ${link ? act('open', icons.open(), 'Open in the app', 'See it the way a player does') : ''}
      ${user ? act('user', icons.user(), `View ${displayName(user)}`, 'Their profile, logs and past reports') : ''}
      ${user && !isSelf ? act('susp', icons.ban(), user.is_suspended ? `Restore @${user.username}` : `Suspend @${user.username}`, user.is_suspended ? 'Let them post again' : 'Block posting and messaging', !user.is_suspended) : ''}
      ${r.target_type === 'log' && target ? act('del', icons.trash(), 'Delete this review', 'Removes it for good', true) : ''}
      ${r.target_type === 'list' && target ? act('del', icons.trash(), 'Delete this list', 'Removes it for good', true) : ''}
      ${r.target_type === 'game' && target ? act('hide', target.hidden ? icons.eye() : icons.eyeOff(), target.hidden ? 'Show this game again' : 'Hide this game', 'Hidden games leave search and trending', !target.hidden) : ''}
    </div>
    <div class="adm-btn-row adm-btn-row--stack">
      ${done ? '<button class="btn btn--block" id="ra-reopen">Reopen report</button>'
        : '<button class="btn btn--accent btn--block" id="ra-resolve">Resolve (dealt with)</button><button class="btn btn--block" id="ra-dismiss">Dismiss (nothing wrong)</button>'}
    </div>
    <p class="adm-hint">Suspending, deleting or hiding also marks the report resolved.</p>`, (sheet, close) => {
    const on = (sel, fn) => qs(sel, sheet)?.addEventListener('click', fn);
    const andResolve = async (msg) => { close(); if (!done) await setReportStatus([r.id], 'resolved', `${msg}, report resolved`); else { toast(msg, 'success'); refreshReportViews(); } };

    on('[data-act="open"]', () => openApp(link));
    on('[data-act="user"]', () => { close(); hooks.openUser?.(user.id); });
    on('[data-act="susp"]', async () => {
      const next = !user.is_suspended;
      if (next && !await confirmSheet({ title: `Suspend @${user.username}?`, sub: 'They can still sign in, but can’t post, review, comment or message until you restore them.', confirmLabel: 'Suspend', danger: true })) return;
      const { error } = await supabase.from('profiles').update({ is_suspended: next }).eq('id', user.id);
      if (error) return fail(error);
      audit(next ? 'suspend' : 'restore', `${next ? 'Suspended' : 'Restored'} @${user.username} (from a report)`, { type: 'profile', id: user.id });
      if (next) await andResolve(`@${user.username} suspended`);
      else { close(); toast(`@${user.username} restored`, 'success'); refreshReportViews(); }
    });
    on('[data-act="del"]', async () => {
      const what = r.target_type === 'log' ? 'review' : 'list';
      if (!await confirmSheet({ title: `Delete this ${what}?`, sub: 'This removes it for good. It can’t be undone.', confirmLabel: 'Delete', danger: true })) return;
      const { error, count } = await supabase.from(r.target_type === 'log' ? 'logs' : 'lists').delete({ count: 'exact' }).eq('id', r.target_id);
      if (error) return fail(error);
      if (!count) return toast(`Couldn’t delete that ${what}`, 'error');
      audit(`delete_${r.target_type}`, `Deleted a ${what}${target?.label ? ` (${target.label})` : ''} from a report`, { type: r.target_type, id: r.target_id });
      await andResolve(`${what[0].toUpperCase()}${what.slice(1)} deleted`);
    });
    on('[data-act="hide"]', async () => {
      const next = !target.hidden;
      const { error } = await supabase.from('games').update({ is_hidden: next }).eq('id', r.target_id);
      if (error) return fail(error);
      audit(next ? 'hide_game' : 'show_game', `${next ? 'Hid' : 'Showed'} the game “${target.label}” (from a report)`, { type: 'game', id: r.target_id });
      if (next) await andResolve('Game hidden');
      else { close(); toast('Game shown again', 'success'); refreshReportViews(); }
    });
    on('#ra-resolve', () => { close(); setReportStatus([r.id], 'resolved', 'Resolved'); });
    on('#ra-dismiss', () => { close(); setReportStatus([r.id], 'dismissed', 'Dismissed'); });
    on('#ra-reopen', () => { close(); setReportStatus([r.id], 'open', 'Reopened'); });
  });
}
hooks.openReport = openReport;

// ------------------------------------------------------------ INBOX
const NEWS_VERIFY = { confirmed: 'Confirmed', reported: 'Reported', rumor: 'Rumor', leak: 'Leak' };
let inboxFilter = 'all';

SCREENS.inbox = function inbox() {
  if (['all', 'reports', 'news', 'players'].includes(state.params.get('filter'))) inboxFilter = state.params.get('filter');
  paint(`
    ${header('Inbox')}
    <main class="view-body">
      <div class="adm-sticky" id="inbox-chips"></div>
      <div id="list">${skeletonRows(5)}</div>
    </main>`);
  loadInbox();
};
REFRESH.inbox = () => loadInbox();
ENTER.inbox = (params) => {
  const f = params.get('filter');
  if (f) { inboxFilter = f; loadInbox(); return true; }
  return false;
};

async function loadInbox() {
  const screen = state.screen;
  const week = new Date(Date.now() - 7 * 86400000).toISOString();
  const [reportsRes, reviewRes, flaggedRes, joinedRes, counts] = await Promise.all([
    supabase.from('reports').select('*').in('status', OPEN_STATUSES).order('created_at', { ascending: false }).limit(6),
    supabase.from('news_articles').select('id, title, category, verification_status, importance, updated_at').eq('status', 'review').order('updated_at', { ascending: false }).limit(6),
    supabase.from('news_articles').select('id, title, category, verification_status, flagged_incorrect, needs_update, updated_at').or('flagged_incorrect.eq.true,needs_update.eq.true').order('updated_at', { ascending: false }).limit(6),
    supabase.from('profiles').select('id, username, display_name, avatar_url, created_at').gte('created_at', week).order('created_at', { ascending: false }).limit(6),
    loadAttentionCounts(),
  ]);
  if (!stillOn(screen)) return;

  const reports = reportsRes.data || [];
  const targets = await reportTargets(reports);
  const people = await reportPeople(reports, targets);
  if (!stillOn(screen)) return;
  const review = reviewRes.data || [];
  const flagged = flaggedRes.data || [];
  const joined = joinedRes.data || [];

  const total = counts.reports + counts.review + counts.flagged;
  const chipsEl = qs('#inbox-chips');
  if (chipsEl) {
    chipsEl.innerHTML = chips([['all', 'Everything', total], ['reports', 'Reports', counts.reports], ['news', 'News', counts.review + counts.flagged], ['players', 'New players']], inboxFilter, 'data-filter');
    qsa('[data-filter]', chipsEl).forEach((b) => b.addEventListener('click', () => { inboxFilter = b.dataset.filter; syncChips(chipsEl, inboxFilter, 'data-filter'); drawSections(); }));
  }

  const storyRow = (a, tag) => item({
    id: a.id, lead: chipIcon(icons.news(), 'warn'), title: esc(a.title),
    meta: `${esc(tag)} · ${esc(NEWS_VERIFY[a.verification_status] || '')} · ${esc(a.category || '')}`, meta2: esc(ago(a.updated_at)), trail: chev(),
    attrs: 'data-kind="story"',
  });
  const playerRow = (p) => item({
    id: p.id, lead: avatarImg(p, 40), title: esc(displayName(p)), meta: `@${esc(p.username)} · joined ${esc(ago(p.created_at))}`, trail: chev(), attrs: 'data-kind="player"',
  });

  function drawSections() {
    const host = qs('#list');
    if (!host) return;
    const parts = [];
    const show = (key) => inboxFilter === 'all' || inboxFilter === key;
    if (show('reports') && reports.length) {
      parts.push(sectionHead(`Reports · ${counts.reports}`, { link: 'reports', linkText: 'See all' }));
      parts.push(group(reports.map((r) => reportRow(r, targets, people).replace('class="adm-item"', 'class="adm-item" data-kind="report"')).join('')));
    }
    if (show('news') && review.length) {
      parts.push(sectionHead(`News to review · ${counts.review}`, { link: 'news?tab=review', linkText: 'See all' }));
      parts.push(group(review.map((a) => storyRow(a, 'In review')).join('')));
    }
    if (show('news') && flagged.length) {
      parts.push(sectionHead(`Flagged stories · ${counts.flagged}`, { link: 'news?tab=flagged', linkText: 'See all' }));
      parts.push(group(flagged.map((a) => storyRow(a, a.flagged_incorrect ? 'Marked incorrect' : 'Needs update')).join('')));
    }
    if (show('players') && joined.length) {
      parts.push(sectionHead('New players this week', { link: 'people?sort=new&filter=new', linkText: 'See all' }));
      parts.push(group(joined.map(playerRow).join('')));
    }
    host.innerHTML = parts.length ? parts.join('')
      : `<div class="adm-clear"><span class="adm-clear__icon">${icons.check()}</span><div><b>All clear</b><small>Nothing is waiting on you.</small></div></div>`;

    qsa('[data-go]', host).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.go); }));
    onRow(host, '.adm-item', (row) => {
      const kind = row.dataset.kind;
      if (kind === 'report') openReport(row.dataset.id);
      else if (kind === 'story') hooks.openStory?.(row.dataset.id);
      else if (kind === 'player') hooks.openUser?.(row.dataset.id);
    });
  }
  drawSections();
  touch(screen);
}

void avatarImg; void poster; void pill; void fmtNum; void setBadge;
