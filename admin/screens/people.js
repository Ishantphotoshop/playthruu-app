// ============================================================
// PEOPLE + THE PLAYER SHEET
// ============================================================
import {
  supabase, state, SCREENS, REFRESH, ENTER, hooks, paint, header, qs, qsa, stillOn, esc, fmtNum, ago, fail, copy,
  displayName, avatarImg, presenceOf, presenceHtml, formatDuration, onRow, item, group, poster, pill, chev, chipIcon,
  sectionHead, emptyBlock, searchBar, wireSearch, chips, syncChips, openSheet, confirmSheet, openApp, switchRow,
  skeletonRows, touch, toast, dropPage, audit, addRecent,
} from '../core.js';
import { bulkSelect, countUp, downloadCsv } from '../toolkit.js';
import { getPresenceFor, getUsageFor } from '../../js/api.js';
import { icons } from './icons.js';

const view = { query: '', sort: 'seen', filter: 'all' };
const FILTERS = [['all', 'Everyone'], ['online', 'Online'], ['new', 'New'], ['admin', 'Admins'], ['suspended', 'Suspended']];
const SORTS = [['seen', 'Last seen'], ['new', 'Newest'], ['name', 'A–Z'], ['usage', 'Most active']];
let last = { rows: [], seen: {}, usage: {} };

// A person's avatar with the green "online now" dot.
const avatarWithDot = (p, size, online) => `<span class="adm-av">${avatarImg(p, size)}${online ? '<i class="adm-av__dot" aria-label="online"></i>' : ''}</span>`;

// #/people?filter=online&sort=new: applied on first build and when an already-built screen is shown.
function applyParams(params) {
  const f = params.get('filter');
  const s = params.get('sort');
  let changed = false;
  if (f && FILTERS.some(([id]) => id === f)) { view.filter = f; changed = true; }
  if (s && SORTS.some(([id]) => id === s)) { view.sort = s; changed = true; }
  return changed;
}

SCREENS.people = function people() {
  applyParams(state.params);
  paint(`
    ${header('People')}
    <main class="view-body">
      <div class="adm-sticky">
        ${searchBar({ id: 'u-q', placeholder: 'Search name or @username', value: view.query })}
        ${chips(FILTERS, view.filter, 'data-filter')}
      </div>
      <div class="adm-sortbar">
        <div class="adm-seg" id="u-sort" role="tablist" aria-label="Sort by">
          ${SORTS.map(([id, label]) => `<button role="tab" data-sort="${id}" aria-selected="${id === view.sort}">${label}</button>`).join('')}
        </div>
        <button class="adm-iconbtn" id="u-export" aria-label="Export CSV" title="Export CSV">${icons.download()}</button>
      </div>
      <div id="list">${skeletonRows(6)}</div>
      <p class="adm-hint" id="u-note"></p>
    </main>`);

  wireSearch(qs('.adm-sticky'), { id: 'u-q', onChange: (v) => { view.query = v; paintPeople(); } });
  qsa('[data-filter]').forEach((b) => b.addEventListener('click', () => { view.filter = b.dataset.filter; syncChips(qs('.adm-sticky'), view.filter, 'data-filter'); paintPeople(); }));
  qsa('[data-sort]').forEach((b) => b.addEventListener('click', () => { view.sort = b.dataset.sort; syncSort(); paintPeople(); }));
  qs('#u-export').addEventListener('click', exportPeople);
  paintPeople();
};

const syncSort = () => qsa('#u-sort [data-sort]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sort === view.sort)));

REFRESH.people = () => paintPeople();
ENTER.people = (params) => {
  if (!applyParams(params)) return false;
  syncChips(qs('.adm-sticky'), view.filter, 'data-filter');
  syncSort();
  paintPeople();
  return true;
};

async function paintPeople() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  const { query, sort, filter } = view;

  let q = supabase.from('profiles')
    .select('id, username, display_name, avatar_url, is_admin, is_suspended, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  const clean = query.replace(/[,()%*]/g, ' ').trim();
  if (clean) q = q.or(`username.ilike.%${clean}%,display_name.ilike.%${clean}%`);
  if (filter === 'admin') q = q.eq('is_admin', true);
  if (filter === 'suspended') q = q.eq('is_suspended', true);
  if (filter === 'new') q = q.gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

  const { data, error } = await q;
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }

  // Presence and usage come from follow-up queries keyed on the ids just
  // returned, rather than embeds that depend on constraint names.
  const ids = (data || []).map((p) => p.id);
  const [seen, usage] = await Promise.all([getPresenceFor(ids), getUsageFor(ids)]);
  if (!stillOn(screen)) return;

  let rows = [...(data || [])];
  if (filter === 'online') rows = rows.filter((p) => presenceOf(seen[p.id]).online);
  if (sort === 'seen') rows.sort((a, b) => new Date(seen[b.id] || 0) - new Date(seen[a.id] || 0));
  else if (sort === 'name') rows.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  else if (sort === 'usage') rows.sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
  last = { rows, seen, usage };

  const onlineNow = rows.filter((p) => presenceOf(seen[p.id]).online).length;
  const note = qs('#u-note');
  if (note) note.textContent = (data || []).length >= 200 ? 'Showing the newest 200. Search to narrow it down.' : `${fmtNum(rows.length)} shown · ${onlineNow} online`;

  if (!rows.length) { host.innerHTML = emptyBlock('Nobody matched that.', icons.people()); host.__bulk?.attach(); return; }

  host.innerHTML = group(rows.map((p) => {
    const pr = presenceOf(seen[p.id]);
    return item({
      id: p.id, pick: true,
      lead: avatarWithDot(p, 42, pr.online),
      title: `${esc(displayName(p))}${p.is_admin ? ` ${pill('ADMIN', 'info')}` : ''}${p.is_suspended ? ` ${pill('SUSPENDED', 'bad')}` : ''}${Date.now() - new Date(p.created_at).getTime() < 2 * 86400000 ? ` ${pill('NEW', 'ok')}` : ''}`,
      meta: `@${esc(p.username)} · joined ${esc(ago(p.created_at))}`,
      meta2: `${presenceHtml(seen[p.id])} · ${esc(formatDuration(usage[p.id] || 0))} in app`,
      trail: chev(),
    });
  }).join(''));

  bulkSelect(host, {
    idOf: (row) => row.dataset.id, label: 'people',
    actions: [
      {
        label: 'Suspend', danger: true,
        run: async (picked) => {
          const safe = picked.filter((id) => id !== state.user.id);
          if (!safe.length) { toast("You can't suspend your own account", 'error'); return; }
          if (!await confirmSheet({ title: `Suspend ${safe.length} ${safe.length === 1 ? 'account' : 'accounts'}?`, sub: 'They can still sign in, but can’t post, review, comment or message until you restore them.', confirmLabel: 'Suspend', danger: true })) return;
          const { error: e } = await supabase.from('profiles').update({ is_suspended: true }).in('id', safe);
          if (e) return fail(e);
          toast(`${safe.length} suspended`, 'success');
          audit('suspend', `Suspended ${safe.length} ${safe.length === 1 ? 'account' : 'accounts'}`, { type: 'profile', id: safe[0] });
          paintPeople();
        },
      },
      {
        label: 'Restore',
        run: async (picked) => {
          const { error: e } = await supabase.from('profiles').update({ is_suspended: false }).in('id', picked);
          if (e) return fail(e);
          toast(`${picked.length} restored`, 'success');
          audit('restore', `Restored ${picked.length} ${picked.length === 1 ? 'account' : 'accounts'}`, { type: 'profile', id: picked[0] });
          paintPeople();
        },
      },
    ],
  });
  onRow(host, '.adm-item', (row) => openUser(row.dataset.id));
  touch(screen);
}

export function exportPeople() {
  downloadCsv(`playthruu-people-${new Date().toISOString().slice(0, 10)}.csv`,
    last.rows.map((p) => ({
      id: p.id, username: p.username, display_name: p.display_name ?? '',
      admin: p.is_admin ? 'yes' : 'no', suspended: p.is_suspended ? 'yes' : 'no',
      joined: p.created_at, last_seen: last.seen[p.id] ?? '',
      total_seconds_in_app: last.usage[p.id] ?? 0, time_in_app: formatDuration(last.usage[p.id] ?? 0),
    })));
}

// ------------------------------------------------------------ THE PLAYER SHEET
export async function openUser(id) {
  const { sheet, close } = openSheet('Player', `<div id="u-body">${skeletonRows(4, { thumb: false })}</div>`);
  const body = qs('#u-body', sheet);

  const [profileRes, seen, usage] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
    getPresenceFor([id]), getUsageFor([id]),
  ]);
  const user = profileRes.data;
  if (!user) { body.innerHTML = emptyBlock('That account no longer exists.'); return; }
  const isSelf = user.id === state.user.id;
  const lastSeen = seen[id];
  qs('.adm-sheet-head h2', sheet).textContent = displayName(user);
  addRecent({ type: 'person', id: user.id, title: displayName(user), hint: `@${user.username}`, img: user.avatar_url || '', name: user.username });

  body.innerHTML = `
    <div class="adm-who">
      ${avatarWithDot(user, 64, presenceOf(lastSeen).online)}
      <div class="adm-who__text">
        <b>${esc(displayName(user))} ${user.is_admin ? pill('ADMIN', 'info') : ''} ${user.is_suspended ? pill('SUSPENDED', 'bad') : ''}</b>
        <span>@${esc(user.username)}</span>
        <span>${presenceHtml(lastSeen)}</span>
        <span>Joined ${esc(ago(user.created_at))} · ${esc(formatDuration(usage[id] || 0))} in the app</span>
      </div>
    </div>
    ${user.bio ? `<p class="adm-bio">${esc(user.bio)}</p>` : ''}
    <div class="adm-stats adm-stats--4" id="u-stats">
      ${['Logs', 'Reviews', 'Lists', 'Followers'].map((l) => `<div class="adm-stat"><b>–</b><span>${l}</span></div>`).join('')}
    </div>
    <div class="adm-btn-row">
      <button class="btn btn--pill" id="u-view">${icons.open()} Open profile</button>
      <button class="btn btn--pill" id="u-copy">${icons.copy()} Copy id</button>
    </div>

    <span class="adm-field-group">Moderation</span>
    <div class="adm-box">
      ${switchRow({ id: 'u-susp', title: 'Suspended', sub: 'Blocks posting, reviews, comments and messages.', on: user.is_suspended, disabled: isSelf })}
      ${switchRow({ id: 'u-admin', title: 'Admin', sub: 'Full access to this control room.', on: user.is_admin, disabled: isSelf })}
    </div>
    ${isSelf ? '<p class="adm-hint">This is you, so the suspend and admin switches are locked. That stops you shutting yourself out.</p>' : ''}

    <span class="adm-field-group">Reports</span>
    <div id="u-reports">${skeletonRows(1, { thumb: false })}</div>

    <span class="adm-field-group">Recent logs</span>
    <div id="u-logs">${skeletonRows(3)}</div>`;

  qs('#u-view', sheet).addEventListener('click', () => openApp(`profile/${encodeURIComponent(user.username)}`));
  qs('#u-copy', sheet).addEventListener('click', () => copy(user.id, 'Player id copied'));

  if (!isSelf) {
    const flip = async (el, column) => {
      const next = el.getAttribute('aria-checked') !== 'true';
      if (column === 'is_suspended' && next && !await confirmSheet({ title: `Suspend ${displayName(user)}?`, sub: 'They can still sign in, but can’t post, review, comment or message until you restore them.', confirmLabel: 'Suspend', danger: true })) return;
      if (column === 'is_admin' && next && !await confirmSheet({ title: `Make ${displayName(user)} an admin?`, sub: 'They get the same powers you have here, including suspending people and deleting content.', confirmLabel: 'Make admin' })) return;
      el.setAttribute('aria-checked', String(next));
      const { error } = await supabase.from('profiles').update({ [column]: next }).eq('id', user.id);
      if (error) { el.setAttribute('aria-checked', String(!next)); return fail(error); }
      user[column] = next;
      audit(column === 'is_suspended' ? (next ? 'suspend' : 'restore') : (next ? 'make_admin' : 'remove_admin'),
        column === 'is_suspended' ? `${next ? 'Suspended' : 'Restored'} @${user.username}` : (next ? `Made @${user.username} an admin` : `Removed admin from @${user.username}`), { type: 'profile', id: user.id });
      toast(column === 'is_suspended' ? (next ? 'Suspended' : 'Restored') : (next ? 'Now an admin' : 'No longer an admin'), 'success');
      paintPeople();
    };
    qs('#u-susp', sheet).addEventListener('click', (e) => flip(e.currentTarget, 'is_suspended'));
    qs('#u-admin', sheet).addEventListener('click', (e) => flip(e.currentTarget, 'is_admin'));
  }

  // The rest loads in parallel so the sheet is useful straight away.
  (async () => {
    const head = (q) => q.then((r) => r.count ?? 0);
    const [logs, reviews, lists, followers, recent, about, by] = await Promise.all([
      head(supabase.from('logs').select('id', { count: 'exact', head: true }).eq('user_id', id)),
      head(supabase.from('logs').select('id', { count: 'exact', head: true }).eq('user_id', id).not('review', 'is', null)),
      head(supabase.from('lists').select('id', { count: 'exact', head: true }).eq('user_id', id)),
      head(supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', id)),
      supabase.from('logs').select('id, status, rating, review, created_at, games!logs_game_id_fkey(title, cover_url)').eq('user_id', id).order('created_at', { ascending: false }).limit(5),
      supabase.from('reports').select('id, reason, status, created_at').eq('target_type', 'profile').eq('target_id', id).order('created_at', { ascending: false }).limit(5),
      supabase.from('reports').select('id', { count: 'exact', head: true }).eq('reporter_id', id),
    ]);
    if (!body.isConnected) return;
    const cells = qsa('#u-stats b', sheet);
    [logs, reviews, lists, followers].forEach((n, i) => cells[i] && countUp(cells[i], n, { format: fmtNum }));

    const rep = qs('#u-reports', sheet);
    if (rep) {
      const rows = about.data || [];
      rep.innerHTML = (rows.length ? group(rows.map((r) => item({
        id: r.id, lead: chipIcon(icons.flag(), r.status === 'open' ? 'bad' : 'muted'), title: esc(r.reason || 'No reason given'),
        meta: `${esc(r.status)} · ${esc(ago(r.created_at))}`, trail: chev(),
      })).join('')) : '<p class="adm-hint adm-hint--flat">Nobody has reported this person.</p>')
        + ((by.count || 0) ? `<p class="adm-hint adm-hint--flat">They have filed ${by.count} ${by.count === 1 ? 'report' : 'reports'} themselves.</p>` : '');
      onRow(rep, '.adm-item', (row) => { close(); hooks.openReport?.(row.dataset.id); });
    }
    const lg = qs('#u-logs', sheet);
    if (lg) {
      const rows = recent.data || [];
      lg.innerHTML = rows.length ? group(rows.map((l) => item({
        id: l.id, lead: poster(l.games?.cover_url), title: esc(l.games?.title || 'Unknown game'),
        meta: `${esc(l.status || '')}${l.rating ? ` · ${l.rating}★` : ''}${l.review ? ' · review' : ''}`, meta2: esc(ago(l.created_at)), trail: chev(),
      })).join('')) : '<p class="adm-hint adm-hint--flat">Nothing logged yet.</p>';
      onRow(lg, '.adm-item', (row) => hooks.openLog?.(row.dataset.id));
    }
  })();
}
hooks.openUser = openUser;

// export buttons live in the list bar area (More screen also uses it)
hooks.exportPeople = exportPeople;
void dropPage;
