// ============================================================
// ANNOUNCEMENTS, COMMENTS, ACTIVITY
// ============================================================
import {
  supabase, state, SCREENS, REFRESH, hooks, paint, header, qs, qsa, stillOn, esc, fmtNum, ago, fail, copy,
  displayName, avatarImg, onRow, item, group, poster, pill, chev, chipIcon, emptyBlock, searchBar, wireSearch, chips, syncChips,
  openSheet, confirmSheet, openApp, switchRow, toggle, skeletonRows, touch, toast, sectionHead, audit,
} from '../core.js';
import { bulkSelect } from '../toolkit.js';
import { icons } from './icons.js';

// ------------------------------------------------------------ ANNOUNCEMENTS
SCREENS.announce = function announce() {
  paint(`
    ${header('Announcements')}
    <main class="view-body">
      <div class="adm-box adm-box--pad">
        <label class="field"><span>Banner message</span>
          <textarea id="a-message" rows="3" placeholder="Servers are getting an upgrade tonight…"></textarea>
        </label>
        <label class="field"><span>Link (optional)</span><input id="a-link" placeholder="https://…" inputmode="url"></label>
        <button class="btn btn--accent btn--block" id="a-post">Post banner</button>
        <p class="adm-hint adm-hint--flat">Shows at the top of the feed for everyone until you switch it off.</p>
      </div>
      ${sectionHead('Posted')}
      <div id="list">${skeletonRows(3, { thumb: false })}</div>
    </main>`);

  qs('#a-post').addEventListener('click', async () => {
    const message = qs('#a-message').value.trim();
    if (!message) { toast('Write a message first', 'error'); return; }
    const btn = qs('#a-post');
    btn.disabled = true;
    const { error } = await supabase.from('announcements').insert({ message, link: qs('#a-link').value.trim() || null, created_by: state.user.id });
    btn.disabled = false;
    if (error) return fail(error);
    qs('#a-message').value = '';
    qs('#a-link').value = '';
    toast('Banner is live', 'success');
    audit('banner_post', 'Posted a banner', { type: 'banner' });
    paintAnnouncements();
  });
  paintAnnouncements();
};
REFRESH.announce = () => paintAnnouncements();

async function paintAnnouncements() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyBlock('No banners yet.', icons.megaphone()); return; }

  host.innerHTML = group(data.map((a) => item({
    id: a.id, lead: chipIcon(icons.megaphone(), a.is_active ? 'ok' : 'muted'),
    title: esc(a.message), meta: `${a.is_active ? 'Live now' : 'Switched off'}${a.link ? ' · has a link' : ''}`, meta2: esc(ago(a.created_at)),
    trail: toggle({ on: a.is_active }),
  })).join(''));

  qsa('.adm-switch', host).forEach((sw) => sw.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = sw.closest('.adm-item').dataset.id;
    const cur = data.find((x) => x.id === id);
    sw.setAttribute('aria-checked', String(!cur.is_active));
    const { error: upErr } = await supabase.from('announcements').update({ is_active: !cur.is_active }).eq('id', id);
    if (upErr) { sw.setAttribute('aria-checked', String(cur.is_active)); return fail(upErr); }
    toast(cur.is_active ? 'Banner switched off' : 'Banner is live', 'success');
    audit(cur.is_active ? 'banner_off' : 'banner_on', cur.is_active ? 'Switched a banner off' : 'Switched a banner on', { type: 'banner', id });
    paintAnnouncements();
  }));
  onRow(host, '.adm-item', (row) => editBanner(data.find((x) => x.id === row.dataset.id)));
  touch(screen);
}

function editBanner(a) {
  openSheet('Banner', `
    <label class="field"><span>Message</span><textarea id="b-msg" rows="4">${esc(a.message)}</textarea></label>
    <label class="field"><span>Link (optional)</span><input id="b-link" value="${esc(a.link || '')}" inputmode="url"></label>
    <div class="adm-box">${switchRow({ id: 'b-on', title: 'Show to everyone', sub: 'Appears at the top of the feed.', on: a.is_active })}</div>
    <div class="adm-btn-row">
      <button class="btn btn--danger" id="b-del">Delete</button>
      <button class="btn btn--accent" id="b-save">Save</button>
    </div>`, (sheet, close) => {
    qs('#b-on', sheet).addEventListener('click', (e) => e.currentTarget.setAttribute('aria-checked', String(e.currentTarget.getAttribute('aria-checked') !== 'true')));
    qs('#b-save', sheet).addEventListener('click', async () => {
      const message = qs('#b-msg', sheet).value.trim();
      if (!message) { toast('A message is required', 'error'); return; }
      const { error } = await supabase.from('announcements').update({ message, link: qs('#b-link', sheet).value.trim() || null, is_active: qs('#b-on', sheet).getAttribute('aria-checked') === 'true' }).eq('id', a.id);
      if (error) return fail(error);
      close(); toast('Saved', 'success'); audit('banner_edit', 'Edited a banner', { type: 'banner', id: a.id }); paintAnnouncements();
    });
    qs('#b-del', sheet).addEventListener('click', async () => {
      if (!await confirmSheet({ title: 'Delete this banner?', confirmLabel: 'Delete', danger: true })) return;
      const { error } = await supabase.from('announcements').delete().eq('id', a.id);
      if (error) return fail(error);
      close(); toast('Deleted', 'success'); audit('banner_delete', 'Deleted a banner', { type: 'banner', id: a.id }); paintAnnouncements();
    });
  });
}

// ------------------------------------------------------------ COMMENTS
let commentsQuery = '';

SCREENS.comments = function comments() {
  paint(`
    ${header('Comments')}
    <main class="view-body">
      <div class="adm-sticky">${searchBar({ id: 'c-q', placeholder: 'Find a phrase…', value: commentsQuery })}</div>
      <div id="list">${skeletonRows(6, { thumb: false })}</div>
    </main>`);
  wireSearch(qs('.adm-sticky'), { id: 'c-q', onChange: (v) => { commentsQuery = v; paintComments(); } });
  paintComments();
};
REFRESH.comments = () => paintComments();

async function paintComments() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  let sel = supabase.from('comments').select('id, body, created_at, user_id, log_id').order('created_at', { ascending: false }).limit(120);
  const clean = commentsQuery.replace(/[%,]/g, ' ').trim();
  if (clean) sel = sel.ilike('body', `%${clean}%`);
  const { data, error } = await sel;
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyBlock(clean ? 'No comment matches that.' : 'No comments yet.', icons.comment()); host.__bulk?.attach(); return; }

  const authorIds = [...new Set(data.map((c) => c.user_id).filter(Boolean))];
  let authors = {};
  if (authorIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, username, display_name, avatar_url, is_suspended').in('id', authorIds);
    if (!stillOn(screen)) return;
    authors = Object.fromEntries((profs || []).map((p) => [p.id, p]));
  }
  host.innerHTML = group(data.map((c) => item({
    id: c.id, pick: true, lead: avatarImg(authors[c.user_id] || {}, 38),
    title: esc(c.body), meta: `@${esc(authors[c.user_id]?.username || 'unknown')} · ${esc(ago(c.created_at))}`, trail: chev(),
  })).join(''));
  host.querySelectorAll('.adm-item__title').forEach((t) => t.classList.add('adm-item__title--wrap'));

  bulkSelect(host, {
    idOf: (row) => row.dataset.id, label: 'comments',
    actions: [{
      label: 'Delete', danger: true,
      run: async (ids) => {
        if (!await confirmSheet({ title: `Delete ${ids.length} ${ids.length === 1 ? 'comment' : 'comments'}?`, sub: 'They disappear for everyone, permanently.', confirmLabel: 'Delete', danger: true })) return;
        const { error: e } = await supabase.from('comments').delete().in('id', ids);
        if (e) return fail(e);
        toast(`${ids.length} deleted`, 'success');
        audit('delete_comment', `Deleted ${ids.length} ${ids.length === 1 ? 'comment' : 'comments'}`, { type: 'comment', id: ids[0] });
        paintComments();
      },
    }],
  });
  onRow(host, '.adm-item', (row) => openComment(row.dataset.id));
  touch(screen);
}

export async function openComment(id) {
  const { data: c } = await supabase.from('comments').select('id, body, created_at, user_id, log_id').eq('id', id).maybeSingle();
  if (!c) { toast('That comment is gone', 'error'); return; }
  const [authorRes, logRes] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, avatar_url, is_suspended').eq('id', c.user_id).maybeSingle(),
    c.log_id ? supabase.from('logs').select('id, user_id, review, games!logs_game_id_fkey(title, cover_url), profiles!logs_user_id_fkey(username, display_name)').eq('id', c.log_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const author = authorRes.data;
  const log = logRes.data;
  const isSelf = author?.id === state.user.id;
  const act = (key, icon, label, hint = '', danger = false) => `
    <button class="adm-action${danger ? ' adm-action--danger' : ''}" data-act="${key}"><span class="adm-action__icon">${icon}</span><span class="adm-action__text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></button>`;

  openSheet('Comment', `
    <div class="adm-box adm-box--pad">
      <p class="adm-bigtext">${esc(c.body)}</p>
      <span class="adm-about__meta">${esc(ago(c.created_at))}</span>
    </div>
    ${author ? `<div class="adm-group"><div class="adm-item" role="button" tabindex="0" data-act="user">${avatarImg(author, 40)}<span class="adm-item__main"><span class="adm-item__title">${esc(displayName(author))}${author.is_suspended ? ` ${pill('SUSPENDED', 'bad')}` : ''}</span><span class="adm-item__meta">@${esc(author.username)}</span></span><span class="adm-item__trail">${chev()}</span></div></div>` : ''}
    ${log ? `<span class="adm-field-group">On this review</span><div class="adm-group"><div class="adm-item" role="button" tabindex="0" data-act="log">${poster(log.games?.cover_url)}<span class="adm-item__main"><span class="adm-item__title">${esc(log.games?.title || 'A game')}</span><span class="adm-item__meta">by ${esc(displayName(log.profiles))}</span>${log.review ? `<span class="adm-item__meta">${esc(String(log.review).slice(0, 80))}</span>` : ''}</span><span class="adm-item__trail">${chev()}</span></div></div>` : ''}
    <div class="adm-actions">
      ${log ? act('app', icons.open(), 'Open the review in the app') : ''}
      ${author && !isSelf ? act('susp', icons.ban(), author.is_suspended ? `Restore @${author.username}` : `Suspend @${author.username}`, author.is_suspended ? '' : 'Block posting and commenting', !author.is_suspended) : ''}
      ${act('del', icons.trash(), 'Delete this comment', 'Removes it for everyone', true)}
    </div>`, (sheet, close) => {
    const on = (sel, fn) => qsa(sel, sheet).forEach((el) => el.addEventListener('click', fn));
    onRow(sheet, '[data-act="user"]', () => { close(); hooks.openUser?.(author.id); });
    onRow(sheet, '[data-act="log"]', () => { close(); hooks.openLog?.(log.id); });
    on('button[data-act="app"]', () => openApp(`review/${log.id}`));
    on('button[data-act="susp"]', async () => {
      const next = !author.is_suspended;
      if (next && !await confirmSheet({ title: `Suspend @${author.username}?`, sub: 'They can’t post, review, comment or message until you restore them.', confirmLabel: 'Suspend', danger: true })) return;
      const { error } = await supabase.from('profiles').update({ is_suspended: next }).eq('id', author.id);
      if (error) return fail(error);
      audit(next ? 'suspend' : 'restore', `${next ? 'Suspended' : 'Restored'} @${author.username} (from a comment)`, { type: 'profile', id: author.id });
      close(); toast(next ? 'Suspended' : 'Restored', 'success');
    });
    on('button[data-act="del"]', async () => {
      if (!await confirmSheet({ title: 'Delete this comment?', sub: 'It disappears for everyone, permanently.', confirmLabel: 'Delete', danger: true })) return;
      const { error } = await supabase.from('comments').delete().eq('id', c.id);
      if (error) return fail(error);
      audit('delete_comment', `Deleted a comment by @${author?.username || 'unknown'}`, { type: 'comment', id: c.id });
      close(); toast('Deleted', 'success'); paintComments();
    });
  });
}
hooks.openComment = openComment;

// ------------------------------------------------------------ ACTIVITY
let activityFilter = 'all';
let activityTimer = null;
const ACT_FILTERS = [['all', 'All'], ['playing', 'Playing'], ['played', 'Played'], ['reviews', 'Reviews'], ['loved', 'Loved']];

SCREENS.activity = function activity() {
  paint(`
    ${header('Activity')}
    <main class="view-body">
      <div class="adm-sticky">${chips(ACT_FILTERS, activityFilter, 'data-filter')}</div>
      <p class="adm-hint adm-hint--top"><span class="adm-livedot"></span> Live. Public logs from across the app, newest first.</p>
      <div id="list">${skeletonRows(6)}</div>
    </main>`);
  qsa('[data-filter]').forEach((b) => b.addEventListener('click', () => { activityFilter = b.dataset.filter; syncChips(qs('.adm-sticky'), activityFilter, 'data-filter'); paintActivity(); }));
  paintActivity();
  clearInterval(activityTimer);
  activityTimer = setInterval(() => { if (state.screen === 'activity' && document.visibilityState === 'visible') paintActivity({ quiet: true }); }, 30000);
};
REFRESH.activity = () => paintActivity();

async function paintActivity() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  let sel = supabase.from('logs')
    .select('id, status, rating, review, loved, created_at, games!logs_game_id_fkey(title, cover_url), profiles!logs_user_id_fkey(username, display_name, avatar_url)')
    .eq('is_public', true).order('created_at', { ascending: false }).limit(60);
  if (activityFilter === 'playing' || activityFilter === 'played') sel = sel.eq('status', activityFilter);
  if (activityFilter === 'reviews') sel = sel.not('review', 'is', null);
  if (activityFilter === 'loved') sel = sel.eq('loved', true);
  const { data, error } = await sel;
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyBlock('Nothing logged yet.', icons.activity()); return; }

  host.innerHTML = group(data.map((l) => {
    const marks = [l.rating ? `${l.rating}★` : '', l.loved ? 'loved' : '', l.review ? 'review' : ''].filter(Boolean).join(' · ');
    return item({
      id: l.id, lead: poster(l.games?.cover_url), title: esc(l.games?.title || 'Unknown game'),
      meta: `${esc(displayName(l.profiles))} · ${esc(l.status || '')}${marks ? ` · ${esc(marks)}` : ''}`, meta2: esc(ago(l.created_at)), trail: chev(),
    });
  }).join(''));
  onRow(host, '.adm-item', (row) => openLog(row.dataset.id));
  touch(screen);
}

export async function openLog(id) {
  const { data: l } = await supabase.from('logs')
    .select('id, user_id, game_id, status, rating, review, loved, is_replay, is_public, played_date, hours_played, created_at, games!logs_game_id_fkey(id, title, cover_url, release_year), profiles!logs_user_id_fkey(id, username, display_name, avatar_url, is_suspended)')
    .eq('id', id).maybeSingle();
  if (!l) { toast('That log is gone', 'error'); return; }
  const user = l.profiles;
  const act = (key, icon, label, hint = '', danger = false) => `
    <button class="adm-action${danger ? ' adm-action--danger' : ''}" data-act="${key}"><span class="adm-action__icon">${icon}</span><span class="adm-action__text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></button>`;
  openSheet('Log', `
    <div class="adm-group"><div class="adm-item" role="button" tabindex="0" data-act="game">${poster(l.games?.cover_url, 'adm-thumb adm-thumb--lg')}<span class="adm-item__main"><span class="adm-item__title">${esc(l.games?.title || 'Unknown game')}</span><span class="adm-item__meta">${l.games?.release_year || ''}</span><span class="adm-item__meta">${pill(l.status || 'log', 'info')} ${l.rating ? pill(`${l.rating} stars`, 'ok') : ''} ${l.loved ? pill('loved', 'ok') : ''} ${l.is_replay ? pill('replay', 'muted') : ''} ${l.is_public === false ? pill('private', 'warn') : ''}</span></span><span class="adm-item__trail">${chev()}</span></div></div>
    ${l.review ? `<div class="adm-box adm-box--pad"><p class="adm-bigtext">${esc(l.review)}</p></div>` : ''}
    <p class="adm-hint adm-hint--flat">${esc(ago(l.created_at))}${l.played_date ? ` · played ${esc(l.played_date)}` : ''}${l.hours_played ? ` · ${esc(l.hours_played)} hrs` : ''}</p>
    ${user ? `<div class="adm-group"><div class="adm-item" role="button" tabindex="0" data-act="user">${avatarImg(user, 40)}<span class="adm-item__main"><span class="adm-item__title">${esc(displayName(user))}${user.is_suspended ? ` ${pill('SUSPENDED', 'bad')}` : ''}</span><span class="adm-item__meta">@${esc(user.username)}</span></span><span class="adm-item__trail">${chev()}</span></div></div>` : ''}
    <div class="adm-actions">
      ${act('app', icons.open(), l.review ? 'Open the review in the app' : 'Open the game in the app')}
      ${act('del', icons.trash(), 'Delete this log', l.review ? 'Removes the review and rating too' : 'Removes it from their diary', true)}
    </div>`, (sheet, close) => {
    onRow(sheet, '[data-act="game"]', () => { close(); hooks.openGame?.(l.games.id); });
    onRow(sheet, '[data-act="user"]', () => { close(); hooks.openUser?.(user.id); });
    qsa('button[data-act="app"]', sheet).forEach((b) => b.addEventListener('click', () => openApp(l.review ? `review/${l.id}` : `game/${l.game_id}`)));
    qsa('button[data-act="del"]', sheet).forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmSheet({ title: 'Delete this log?', sub: 'This removes it from their diary for good. It can’t be undone.', confirmLabel: 'Delete', danger: true })) return;
      const { error, count } = await supabase.from('logs').delete({ count: 'exact' }).eq('id', l.id);
      if (error) return fail(error);
      if (!count) return toast('Couldn’t delete that log', 'error');
      audit('delete_log', `Deleted ${l.review ? 'a review' : 'a log'} of ${l.games?.title || 'a game'} by @${user?.username || 'unknown'}`, { type: 'log', id: l.id });
      close(); toast('Log deleted', 'success'); REFRESH.activity?.();
    }));
  });
}
hooks.openLog = openLog;

void fmtNum; void copy; void chipIcon;
