// ============================================================
// NEWS — the News Brain's review queue
// ============================================================
// Stories live in news_articles (shared with playthruu.com). The News Brain
// publishes confirmed, officially sourced, high-confidence stories itself
// and queues everything else here. Every action runs as the signed-in admin
// through RLS, is written to news_events, and then asks playthruu.com to
// refresh so the website and the app's News tab change straight away.
import {
  supabase, state, SCREENS, REFRESH, ENTER, hooks, paint, header, qs, qsa, stillOn, esc, fmtNum, ago, fail,
  onRow, item, group, pill, chev, chipIcon, emptyBlock, chips, syncChips, openSheet, confirmSheet, skeletonRows, touch, toast,
} from '../core.js';
import { bulkSelect, typeToConfirm } from '../toolkit.js';
import { loadAttentionCounts } from './home.js';
import { icons } from './icons.js';

const NEWS_SITE = 'https://playthruu.com';
const NEWS_TABS = [['review', 'Review'], ['published', 'Published'], ['flagged', 'Flagged'], ['archived', 'Archived'], ['rejected', 'Rejected']];
const NEWS_VERIFY = { confirmed: 'Confirmed', reported: 'Reported', rumor: 'Rumor', leak: 'Leak' };
let newsTab = 'review';
let newsPinSupported = true; // false until migrations/2026-10-08_news_pin.sql has been run
let counts = {};

SCREENS.news = function news() {
  newsTab = NEWS_TABS.some(([id]) => id === state.params.get('tab')) ? state.params.get('tab') : newsTab;
  paint(`
    ${header('News')}
    <main class="view-body">
      <div class="adm-sticky" id="n-tabs">${chips(NEWS_TABS, newsTab, 'data-tab')}</div>
      <p class="adm-hint adm-hint--top">Written by the News Brain every 3 hours. Anything it isn’t sure of waits here for you.</p>
      <div id="list">${skeletonRows(5, { thumb: false })}</div>
    </main>`);
  wireTabs();
  paintNews();
  loadCounts();
};
REFRESH.news = () => { loadCounts(); return paintNews(); };
ENTER.news = (params) => {
  const t = params.get('tab');
  if (!t || !NEWS_TABS.some(([id]) => id === t)) return false;
  newsTab = t;
  syncChips(qs('#n-tabs'), newsTab, 'data-tab');
  paintNews();
  return true;
};

function wireTabs() {
  qsa('#n-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { newsTab = b.dataset.tab; syncChips(qs('#n-tabs'), newsTab, 'data-tab'); paintNews(); }));
}

// Little numbers on the tabs. Cheap head counts, filled in after the list.
async function loadCounts() {
  const screen = state.screen;
  const head = (q) => q.then((r) => r.count ?? 0);
  const [review, published, archived, rejected, flagged] = await Promise.all([
    head(supabase.from('news_articles').select('id', { count: 'exact', head: true }).eq('status', 'review')),
    head(supabase.from('news_articles').select('id', { count: 'exact', head: true }).eq('status', 'published')),
    head(supabase.from('news_articles').select('id', { count: 'exact', head: true }).eq('status', 'archived')),
    head(supabase.from('news_articles').select('id', { count: 'exact', head: true }).eq('status', 'rejected')),
    head(supabase.from('news_articles').select('id', { count: 'exact', head: true }).or('flagged_incorrect.eq.true,needs_update.eq.true')),
  ]);
  if (!stillOn(screen)) return;
  counts = { review, published, archived, rejected, flagged };
  const box = qs('#n-tabs');
  if (box) {
    box.innerHTML = chips(NEWS_TABS.map(([id, label]) => [id, label, counts[id]]), newsTab, 'data-tab');
    wireTabs();
  }
}

async function paintNews() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  const fields = 'id, slug, title, summary, category, importance, status, lifecycle, verification_status, confidence_level, confidence_reason, editor_notes, flagged_incorrect, needs_update, brain_locked, sources, updated_at';
  const read = (cols) => {
    const query = supabase.from('news_articles').select(cols).order('updated_at', { ascending: false }).limit(100);
    return newsTab === 'flagged' ? query.or('flagged_incorrect.eq.true,needs_update.eq.true') : query.eq('status', newsTab);
  };
  let { data, error } = await read(`${fields}, pinned_at`);
  newsPinSupported = !error;
  // No pinned_at column yet (migration not run): show the list without it.
  if (error) ({ data, error } = await read(fields));
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }
  // Pinned first, most recently pinned on top; the rest keep their order.
  data = [...data.filter((a) => a.pinned_at).sort((x, y) => y.pinned_at.localeCompare(x.pinned_at)), ...data.filter((a) => !a.pinned_at)];
  if (!data.length) {
    host.innerHTML = emptyBlock(newsTab === 'review' ? 'Nothing waiting for review.' : 'Nothing here.', icons.news());
    host.__bulk?.attach();
    return;
  }

  host.innerHTML = group(data.map((a) => {
    const flags = [
      a.pinned_at ? pill('PINNED', 'info') : '', a.importance === 'breaking' ? pill('BREAKING', 'bad') : '',
      a.flagged_incorrect ? pill('INCORRECT', 'bad') : '', a.needs_update ? pill('UPDATE', 'warn') : '', a.brain_locked ? pill('LOCKED', 'muted') : '',
    ].filter(Boolean).join(' ');
    return item({
      id: a.id, pick: true, lead: chipIcon(icons.news(), a.status === 'published' ? 'ok' : 'warn'),
      title: esc(a.title), meta: `${flags ? `${flags} ` : ''}${esc(NEWS_VERIFY[a.verification_status] || '')} · ${esc(a.category || '')}`, meta2: esc(ago(a.updated_at)), trail: chev(),
    });
  }).join(''));
  wireBulk(host, data);
  onRow(host, '.adm-item', (row) => openStory(data.find((a) => a.id === row.dataset.id)));
  touch(screen);
}

// Log the action, then have playthruu.com refresh its cached pages. The
// refresh is best-effort: the site also re-reads on its own every 5 minutes.
async function newsDone(article, action, note = '') {
  await supabase.from('news_events').insert({
    article_id: action === 'deleted' ? null : article.id,
    article_slug: article.slug, actor: state.user?.email || 'admin', action, note,
  });
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${NEWS_SITE}/api/news/revalidate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session?.access_token || ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: article.slug }),
    });
  } catch { /* the site refreshes itself within 5 minutes anyway */ }
}

const afterChange = () => { loadAttentionCounts(); paintNews(); loadCounts(); };

function wireBulk(host, data) {
  const byId = (id) => data.find((a) => a.id === id);
  const run = async (ids, fields, action, msg) => {
    const { error } = await supabase.from('news_articles').update(fields).in('id', ids);
    if (error) return fail(error);
    await Promise.allSettled(ids.map(byId).filter(Boolean).map((a) => newsDone(a, action, 'bulk')));
    toast(`${ids.length} ${msg}`, 'success');
    afterChange();
  };
  const now = () => new Date().toISOString();
  const unpin = newsPinSupported ? { pinned_at: null } : {};
  const actions = [];
  if (['review', 'archived', 'rejected'].includes(newsTab)) {
    actions.push({ label: 'Approve', run: (ids) => run(ids, { status: 'published', lifecycle: 'published', published_at: now(), flagged_incorrect: false, updated_at: now() }, 'approve', 'published') });
  }
  if (newsTab === 'published' || newsTab === 'flagged') {
    if (newsPinSupported) {
      actions.push({ label: 'Pin', run: (ids) => run(ids.filter((id) => byId(id)?.status === 'published'), { pinned_at: now() }, 'pin', 'pinned') });
      actions.push({ label: 'Unpin', run: (ids) => run(ids, { pinned_at: null }, 'unpin', 'unpinned') });
    }
    actions.push({ label: 'Unpublish', run: (ids) => run(ids, { status: 'review', ...unpin }, 'unpublish', 'moved back to review') });
    actions.push({ label: 'Archive', run: (ids) => run(ids, { status: 'archived', lifecycle: 'archived', ...unpin }, 'archive', 'archived') });
  }
  if (newsTab !== 'rejected') {
    actions.push({
      label: 'Reject',
      run: async (ids) => {
        if (!await confirmSheet({ title: `Reject ${ids.length} ${ids.length === 1 ? 'story' : 'stories'}?`, sub: 'They come off the site and the Brain can’t bring them back.', confirmLabel: 'Reject', danger: true })) return;
        await run(ids, { status: 'rejected', ...unpin }, 'reject', 'rejected');
      },
    });
  }
  actions.push({
    label: 'Delete', danger: true,
    run: async (ids) => {
      if (!await typeToConfirm({ title: `Delete ${ids.length} ${ids.length === 1 ? 'story' : 'stories'}?`, sub: 'Permanently removes them from the site and the app. There is no undo.', word: 'delete', confirmLabel: `Delete ${ids.length}` })) return;
      await Promise.allSettled(ids.map(byId).filter(Boolean).map((a) => newsDone(a, 'deleted', 'bulk')));
      const { error } = await supabase.from('news_articles').delete().in('id', ids);
      if (error) return fail(error);
      toast(`${ids.length} deleted`, 'success');
      afterChange();
    },
  });
  bulkSelect(host, { idOf: (row) => row.dataset.id, label: 'stories', actions });
}

// ------------------------------------------------------------ THE STORY SHEET
export async function openStoryById(id) {
  const fields = 'id, slug, title, summary, category, importance, status, lifecycle, verification_status, confidence_level, confidence_reason, editor_notes, flagged_incorrect, needs_update, brain_locked, sources, updated_at';
  let { data, error } = await supabase.from('news_articles').select(`${fields}, pinned_at`).eq('id', id).maybeSingle();
  if (error) ({ data } = await supabase.from('news_articles').select(fields).eq('id', id).maybeSingle());
  if (!data) { toast('That story is gone', 'error'); return; }
  openStory(data);
}
hooks.openStory = openStoryById;

function openStory(a) {
  const live = a.status === 'published' || a.status === 'archived';
  const hasOfficial = (a.sources || []).some((s) => s.tier === 1);
  const act = (key, icon, label, hint = '', danger = false) => `
    <button class="adm-action${danger ? ' adm-action--danger' : ''}" data-act="${key}"><span class="adm-action__icon">${icon}</span><span class="adm-action__text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></button>`;

  openSheet('Story', `
    <div class="adm-pills">${pill(a.status, a.status === 'published' ? 'ok' : 'warn')} ${pill(NEWS_VERIFY[a.verification_status] || a.verification_status, 'info')} ${pill(a.importance, a.importance === 'breaking' ? 'bad' : 'muted')} ${pill(`${a.confidence_level} confidence`, 'muted')}</div>
    ${a.editor_notes ? `<p class="adm-quote">${esc(a.editor_notes)}</p>` : ''}
    <label class="field"><span>Headline</span><input id="s-title" value="${esc(a.title)}"></label>
    <label class="field"><span>Summary</span><textarea id="s-summary" rows="4">${esc(a.summary)}</textarea></label>
    <div class="field-row">
      <label class="field"><span>Category</span><input id="s-category" value="${esc(a.category)}"></label>
      <label class="field"><span>Importance</span><select id="s-importance">${['breaking', 'important', 'standard', 'minor'].map((v) => `<option${v === a.importance ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Verification</span><select id="s-verify">${Object.keys(NEWS_VERIFY).map((v) => `<option value="${v}"${v === a.verification_status ? ' selected' : ''}>${NEWS_VERIFY[v]}</option>`).join('')}</select></label>
    <button class="btn btn--accent btn--block" id="s-save">Save changes</button>

    <span class="adm-field-group">Actions</span>
    <div class="adm-actions">
      ${a.status !== 'published' ? act('approve', icons.check(), 'Approve and publish', 'Goes live on the site and in the app') : act('unpublish', icons.eyeOff(), 'Unpublish', 'Moves it back to review')}
      ${a.status === 'published' ? act('archive', icons.download(), 'Archive', 'Keeps it, takes it off the front page') : ''}
      ${a.status === 'published' && newsPinSupported ? (a.pinned_at ? act('unpin', icons.pin(), 'Unpin from the top') : act('pin', icons.pin(), 'Pin to the top', 'Keeps it first in News')) : ''}
      ${a.verification_status !== 'confirmed' ? act('verify', icons.shield(), 'Mark verified', hasOfficial ? '' : 'Needs an official source first') : ''}
      ${a.flagged_incorrect ? act('clear-flag', icons.check(), 'Clear the incorrect flag') : act('incorrect', icons.flag(), 'Mark incorrect', 'Pulls it and asks the Brain to fix it', true)}
      ${act('force-update', icons.refresh(), a.needs_update ? 'Update requested' : 'Force an update', 'The Brain revisits it on its next run')}
      ${a.brain_locked ? act('unlock', icons.lock(), 'Unlock for the Brain') : act('lock', icons.lock(), 'Lock from the Brain', 'The Brain won’t change it')}
      ${a.status !== 'rejected' ? act('reject', icons.ban(), 'Reject', 'Comes off the site for good', true) : ''}
      ${act('delete', icons.trash(), 'Delete', 'Removes it everywhere', true)}
    </div>
    <div class="adm-btn-row">
      ${live ? `<a class="btn" href="${NEWS_SITE}/news/${esc(a.slug)}" target="_blank" rel="noopener">Read on site</a>` : ''}
      <a class="btn" href="${NEWS_SITE}/admin/news/${esc(a.id)}" target="_blank" rel="noopener">Full editor</a>
    </div>
    ${a.status === 'published' && !newsPinSupported ? '<p class="adm-hint">Pinning needs a one-time database update: run migrations/2026-10-08_news_pin.sql in the Supabase SQL editor.</p>' : ''}
    <p class="adm-hint">Body text, sources and SEO are edited in the full editor on playthruu.com.</p>`, (sheet, close) => {
    const update = async (fields, action, toastMsg) => {
      const { error } = await supabase.from('news_articles').update(fields).eq('id', a.id);
      if (error) return fail(error);
      await newsDone(a, action);
      close();
      toast(toastMsg, 'success');
      afterChange();
    };
    qs('#s-save', sheet).addEventListener('click', async () => {
      const title = qs('#s-title', sheet).value.trim();
      const summary = qs('#s-summary', sheet).value.trim();
      const category = qs('#s-category', sheet).value.trim();
      const verification = qs('#s-verify', sheet).value;
      if (!title || !summary || !category) { toast('Headline, summary and category are required', 'error'); return; }
      if (verification === 'confirmed' && !hasOfficial) { toast('Confirmed needs an official source. Add one in the full editor', 'error'); return; }
      await update({ title, summary, category, importance: qs('#s-importance', sheet).value, verification_status: verification, updated_at: new Date().toISOString() }, 'edited', 'Saved');
    });
    const now = new Date().toISOString();
    const pin = newsPinSupported ? { pinned_at: null } : {};
    const ops = {
      approve: () => update({ status: 'published', lifecycle: a.lifecycle === 'updated' || a.lifecycle === 'resolved' ? a.lifecycle : 'published', published_at: now, flagged_incorrect: false, updated_at: now }, 'approve', 'Published'),
      unpublish: () => update({ status: 'review', ...pin }, 'unpublish', 'Moved back to review'),
      archive: () => update({ status: 'archived', lifecycle: 'archived', ...pin }, 'archive', 'Archived'),
      verify: () => {
        if (!hasOfficial) { toast('Add an official source in the full editor first', 'error'); return; }
        update({ verification_status: 'confirmed', flagged_incorrect: false, lifecycle: a.status === 'published' ? 'resolved' : 'verified', updated_at: now }, 'verify', 'Marked verified');
      },
      'clear-flag': () => update({ flagged_incorrect: false }, 'clear-flag', 'Flag cleared'),
      'force-update': () => update({ needs_update: true }, 'force-update', 'The Brain will revisit it next run'),
      pin: () => update({ pinned_at: now }, 'pin', 'Pinned to the top of News'),
      unpin: () => update({ pinned_at: null }, 'unpin', 'Unpinned'),
      lock: () => update({ brain_locked: true }, 'lock', 'Locked. The Brain won’t touch it'),
      unlock: () => update({ brain_locked: false }, 'unlock', 'Unlocked'),
      reject: async () => {
        if (!await confirmSheet({ title: 'Reject this story?', sub: 'It comes off the site and the Brain can’t bring it back.', confirmLabel: 'Reject', danger: true })) return;
        update({ status: 'rejected' }, 'reject', 'Rejected');
      },
      incorrect: async () => {
        if (!await confirmSheet({ title: 'Mark as incorrect?', sub: 'A published story is pulled from the site and the Brain is asked to fix it.', confirmLabel: 'Mark incorrect', danger: true })) return;
        update({ flagged_incorrect: true, needs_update: true, ...(a.status === 'published' ? { status: 'review' } : {}) }, 'incorrect', 'Pulled for fixing');
      },
      delete: async () => {
        if (!await confirmSheet({ title: 'Delete this story?', sub: 'Permanently removes it from the site and the app.', confirmLabel: 'Delete', danger: true })) return;
        await newsDone(a, 'deleted');
        const { error } = await supabase.from('news_articles').delete().eq('id', a.id);
        if (error) return fail(error);
        close();
        toast('Deleted', 'success');
        afterChange();
      },
    };
    qsa('[data-act]', sheet).forEach((b) => b.addEventListener('click', () => ops[b.dataset.act]?.()));
  });
}

void fmtNum;
