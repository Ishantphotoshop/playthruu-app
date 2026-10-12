// ============================================================
// GAMES, TRENDING, LISTS
// ============================================================
import {
  supabase, state, SCREENS, REFRESH, hooks, paint, header, qs, qsa, stillOn, esc, fmtNum, ago, fail, copy,
  displayName, avatarImg, onRow, item, group, poster, pill, chev, chipIcon, emptyBlock, searchBar, wireSearch, chips, syncChips,
  openSheet, confirmSheet, actionSheet, openApp, switchRow, getSetting, setSetting, skeletonRows, touch, toast, sectionHead, audit, addRecent,
} from '../core.js';
import { bulkSelect, typeToConfirm, downloadCsv, undoable, skeletonPanel } from '../toolkit.js';
import { searchGamesEverywhere, addGame, getBackdropOptions, getCoverOptions } from '../../js/api.js';
import { icons } from './icons.js';

// ============================================================
// GAMES
// ============================================================
const gamesView = { query: '', filter: 'all', sort: 'new', page: 0 };
const GAMES_PAGE = 50;
const G_FILTERS = [['all', 'All'], ['visible', 'Visible'], ['hidden', 'Hidden'], ['nocover', 'No cover']];
const G_SORTS = [['new', 'Newest'], ['title', 'A–Z'], ['year', 'By year']];

SCREENS.games = function games() {
  paint(`
    ${header('Games')}
    <main class="view-body">
      <div class="adm-sticky">
        ${searchBar({ id: 'g-q', placeholder: 'Search the catalog', value: gamesView.query })}
        ${chips(G_FILTERS, gamesView.filter, 'data-filter')}
      </div>
      <div class="adm-sortbar">
        <div class="adm-seg" id="g-sort" role="tablist" aria-label="Sort by">${G_SORTS.map(([id, l]) => `<button role="tab" data-sort="${id}" aria-selected="${id === gamesView.sort}">${l}</button>`).join('')}</div>
        <button class="adm-iconbtn" id="g-export" aria-label="Export CSV" title="Export CSV">${icons.download()}</button>
      </div>
      <div id="list">${skeletonRows(6)}</div>
      <div id="g-more"></div>
      <p class="adm-hint">Hiding keeps the game (and everyone’s logs of it) but pulls it out of search and trending. Deleting removes it for good.</p>
    </main>`);

  wireSearch(qs('.adm-sticky'), { id: 'g-q', onChange: (v) => { gamesView.query = v; gamesView.page = 0; paintGames(); } });
  qsa('[data-filter]').forEach((b) => b.addEventListener('click', () => { gamesView.filter = b.dataset.filter; gamesView.page = 0; syncChips(qs('.adm-sticky'), gamesView.filter, 'data-filter'); paintGames(); }));
  qsa('#g-sort [data-sort]').forEach((b) => b.addEventListener('click', () => { gamesView.sort = b.dataset.sort; gamesView.page = 0; qsa('#g-sort [data-sort]').forEach((x) => x.setAttribute('aria-selected', String(x === b))); paintGames(); }));
  qs('#g-export').addEventListener('click', exportGames);
  paintGames();
};
REFRESH.games = () => { gamesView.page = 0; return paintGames(); };

function gamesQuery({ head = false } = {}) {
  let q = supabase.from('games').select(head ? 'id' : 'id, title, cover_url, release_year, is_hidden, created_at, igdb_id, rawg_id', head ? { count: 'exact', head: true } : undefined);
  const clean = gamesView.query.replace(/[%,]/g, ' ').trim();
  if (clean) q = q.ilike('title', `%${clean}%`);
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
    (data || []).map((g) => ({ id: g.id, title: g.title, year: g.release_year ?? '', hidden: g.is_hidden ? 'yes' : 'no', igdb_id: g.igdb_id ?? '', rawg_id: g.rawg_id ?? '', cover_url: g.cover_url ?? '', added: g.created_at })));
}

const gameRow = (g) => item({
  id: g.id, pick: true, lead: poster(g.cover_url),
  title: `${esc(g.title)}${g.is_hidden ? ` ${pill('HIDDEN', 'warn')}` : ''}`,
  meta: `${g.release_year ? esc(g.release_year) : 'no year'}${g.cover_url ? '' : ' · no cover'}`, meta2: `added ${esc(ago(g.created_at))}`, trail: chev(),
});

async function paintGames({ append = false } = {}) {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  if (!append) host.innerHTML = skeletonRows(6);
  const from = gamesView.page * GAMES_PAGE;
  const [{ data, error }, countRes] = await Promise.all([
    gamesQuery().range(from, from + GAMES_PAGE - 1),
    append ? Promise.resolve(null) : gamesQuery({ head: true }),
  ]);
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }

  if (!append && !data?.length) {
    host.innerHTML = emptyBlock('No games matched.', icons.game());
    host.__bulk?.attach();
    qs('#g-more').innerHTML = '';
    return;
  }
  if (append) host.querySelector('.adm-group').insertAdjacentHTML('beforeend', data.map(gameRow).join(''));
  else host.innerHTML = group(data.map(gameRow).join(''));

  qs('#g-more').innerHTML = data.length === GAMES_PAGE ? '<button class="btn btn--block" id="g-load">Load more</button>' : '';
  qs('#g-load')?.addEventListener('click', () => { gamesView.page += 1; paintGames({ append: true }); });
  if (countRes) host.dataset.total = String(countRes.count ?? 0);

  bulkSelect(host, {
    idOf: (row) => row.dataset.id, label: host.dataset.total ? `of ${fmtNum(Number(host.dataset.total))} games` : 'games',
    actions: [
      { label: 'Hide', run: async (ids) => { const { error: e } = await supabase.from('games').update({ is_hidden: true }).in('id', ids); if (e) return fail(e); toast(`${ids.length} hidden`, 'success'); audit('hide_game', `Hid ${ids.length} ${ids.length === 1 ? 'game' : 'games'}`, { type: 'game', id: ids[0] }); paintGames(); } },
      { label: 'Show', run: async (ids) => { const { error: e } = await supabase.from('games').update({ is_hidden: false }).in('id', ids); if (e) return fail(e); toast(`${ids.length} visible again`, 'success'); audit('show_game', `Showed ${ids.length} ${ids.length === 1 ? 'game' : 'games'} again`, { type: 'game', id: ids[0] }); paintGames(); } },
      {
        label: 'Delete', danger: true,
        run: async (ids) => {
          if (!await typeToConfirm({ title: `Delete ${ids.length} ${ids.length === 1 ? 'game' : 'games'}?`, sub: 'Every log, review and list entry pointing at them goes too. There is no undo for this one.', word: 'delete', confirmLabel: `Delete ${ids.length}` })) return;
          const { error: e } = await supabase.from('games').delete().in('id', ids);
          if (e) return fail(e);
          toast(`${ids.length} deleted`, 'success');
          audit('delete_game', `Deleted ${ids.length} ${ids.length === 1 ? 'game' : 'games'}`, { type: 'game', id: ids[0] });
          paintGames();
        },
      },
    ],
  });
  onRow(host, '.adm-item', (row) => openGame(row.dataset.id));
  touch(screen);
}

// ------------------------------------------------------------ THE GAME SHEET
export async function openGame(id) {
  const { data: g } = await supabase.from('games').select('*').eq('id', id).maybeSingle();
  if (!g) { toast('That game is gone', 'error'); return; }
  const head = (q) => q.then((r) => r.count ?? 0);
  const [logs, reviews, featured] = await Promise.all([
    head(supabase.from('logs').select('id', { count: 'exact', head: true }).eq('game_id', id)),
    head(supabase.from('logs').select('id', { count: 'exact', head: true }).eq('game_id', id).not('review', 'is', null)),
    head(supabase.from('curated_trending').select('id', { count: 'exact', head: true }).eq('game_id', id)),
  ]);
  addRecent({ type: 'game', id: g.id, title: g.title, hint: `${g.release_year || 'no year'}`, img: g.cover_url || '' });
  const act = (key, icon, label, hint = '', danger = false) => `
    <button class="adm-action${danger ? ' adm-action--danger' : ''}" data-act="${key}"><span class="adm-action__icon">${icon}</span><span class="adm-action__text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></button>`;

  openSheet('Game', `
    <div class="adm-gamehead">
      ${poster(g.cover_url, 'adm-thumb adm-thumb--xl')}
      <div class="adm-gamehead__text">
        <b>${esc(g.title)}</b>
        <span>${[g.release_year, g.genre, g.platform].filter(Boolean).map(esc).join(' · ') || 'No details yet'}</span>
        <span>${[g.developer, g.publisher].filter(Boolean).map(esc).join(' / ')}</span>
        <span class="adm-pills">${g.is_hidden ? pill('hidden', 'warn') : pill('visible', 'ok')} ${featured ? pill('on Trending', 'info') : ''} ${g.cover_url ? '' : pill('no cover', 'bad')}</span>
      </div>
    </div>
    <div class="adm-stats adm-stats--3">
      <div class="adm-stat"><b>${fmtNum(logs)}</b><span>Logs</span></div>
      <div class="adm-stat"><b>${fmtNum(reviews)}</b><span>Reviews</span></div>
      <div class="adm-stat"><b>${g.igdb_id ?? '–'}</b><span>IGDB id</span></div>
    </div>
    <div class="adm-actions">
      ${act('edit', icons.edit(), 'Edit details and artwork', 'Title, year, cover, backdrop, description')}
      ${act('hide', g.is_hidden ? icons.eye() : icons.eyeOff(), g.is_hidden ? 'Show this game again' : 'Hide this game', g.is_hidden ? 'Back in search and trending' : 'Pulls it from search and trending')}
      ${featured ? '' : act('feature', icons.flame(), 'Feature on Trending', 'Adds it to your picks at the end')}
      ${act('app', icons.open(), 'Open the game page in the app')}
      ${act('copy', icons.copy(), 'Copy game id')}
      ${act('del', icons.trash(), 'Delete this game', 'Removes every log and list entry too', true)}
    </div>`, (sheet, close) => {
    const on = (key, fn) => qs(`[data-act="${key}"]`, sheet)?.addEventListener('click', fn);
    on('edit', () => { close(); openGameEditor(g); });
    on('hide', async () => {
      const { error } = await supabase.from('games').update({ is_hidden: !g.is_hidden }).eq('id', g.id);
      if (error) return fail(error);
      audit(g.is_hidden ? 'show_game' : 'hide_game', `${g.is_hidden ? 'Showed' : 'Hid'} the game “${g.title}”`, { type: 'game', id: g.id });
      close(); toast(g.is_hidden ? 'Visible again' : 'Hidden', 'success'); paintGames();
    });
    on('feature', async () => {
      const { count } = await supabase.from('curated_trending').select('*', { count: 'exact', head: true });
      const { error } = await supabase.from('curated_trending').insert({ game_id: g.id, position: count ?? 0, created_by: state.user.id });
      if (error) return fail(error, error.code === '23505' ? 'That game is already featured' : 'Could not feature that game');
      audit('feature_game', `Featured “${g.title}” on Trending`, { type: 'game', id: g.id });
      close(); toast(`${g.title} featured`, 'success'); REFRESH.trending?.();
    });
    on('app', () => openApp(`game/${g.id}`));
    on('copy', () => copy(g.id, 'Game id copied'));
    on('del', async () => {
      if (!await confirmSheet({ title: `Delete ${g.title}?`, sub: 'Every log, review and list entry pointing at this game goes with it. Hiding is usually what you want instead.', confirmLabel: 'Delete for good', danger: true })) return;
      close();
      undoable({
        message: `Deleted ${g.title}`,
        onCommit: async () => { const { error } = await supabase.from('games').delete().eq('id', g.id); if (error) throw error; audit('delete_game', `Deleted the game “${g.title}”`, { type: 'game', id: g.id }); paintGames(); },
        onUndo: () => paintGames(),
      });
      qs('#list')?.querySelector(`[data-id="${g.id}"]`)?.classList.add('is-gone');
    });
  });
}
hooks.openGame = openGame;

// ------------------------------------------------------------ ART PICKERS + EDITOR
// IGDB's metadata is wrong often enough to be worth a fix-up screen: a
// mis-scraped year or a missing cover otherwise sticks forever.
function openArtPicker({ title, hint, game, fetchFn, tag, onPick }) {
  openSheet(title, `
    <p class="modal__hint">${hint}</p>
    <div id="ap-body">${skeletonPanel()}</div>`, async (sheet, close) => {
    const body = qs('#ap-body', sheet);
    let options;
    try { options = await fetchFn(game); } catch { body.innerHTML = emptyBlock('Could not reach IGDB/RAWG right now.'); return; }
    if (!options.length) { body.innerHTML = emptyBlock('Nothing official found for this game.'); return; }
    body.innerHTML = `<div class="adm-art-grid">${options.map((o, i) => `
      <button type="button" class="adm-art-tile" data-i="${i}"><img src="${esc(o.thumbUrl)}" alt="" loading="lazy"><span class="adm-art-tile__tag">${esc(tag(o))}</span></button>`).join('')}</div>`;
    qsa('.adm-art-tile', body).forEach((btn) => btn.addEventListener('click', () => { onPick(options[Number(btn.dataset.i)].url); close(); }));
  });
}
const openCoverPicker = (game, onPick) => openArtPicker({
  title: 'Choose a cover', game, fetchFn: getCoverOptions, onPick,
  hint: 'Only official box art: IGDB’s own cover and RAWG’s store image for this game. Nothing fan-made.',
  tag: (o) => (o.source === 'igdb' ? `IGDB${o.w ? ` · ${o.w}×${o.h}px` : ''}` : 'RAWG'),
});
const openBackdropPicker = (game, onPick) => openArtPicker({
  title: 'Choose a backdrop', game, fetchFn: getBackdropOptions, onPick,
  hint: 'Every screenshot and artwork IGDB and RAWG have for this game. Screenshots come first. Key art tends to carry the game’s own logo baked into it.',
  tag: (o) => `${o.source === 'igdb' ? 'IGDB' : 'RAWG'} · ${o.kind}`,
});

function artSlot({ id, wide, label, url }) {
  return `
    <div class="adm-art-slot">
      <div class="adm-art-slot__frame${wide ? ' adm-art-slot__frame--wide' : ''}">
        <img id="${id}-preview" src="${esc(url || '')}" alt="" ${url ? '' : 'hidden'} onerror="this.hidden=true">
        <span class="adm-art-slot__empty" id="${id}-empty" ${url ? 'hidden' : ''}>No ${label.toLowerCase()}</span>
      </div>
      <button type="button" class="btn btn--ghost btn--pill btn--block" id="${id}-pick">Change ${label.toLowerCase()}…</button>
      <span class="adm-row__sub" id="${id}-dim">${url ? 'measuring…' : '–'}</span>
    </div>`;
}

function openGameEditor(game) {
  openSheet('Edit game', `
    <p class="modal__hint">Corrects what the catalog stores. Everyone’s logs of this game keep pointing at it.</p>
    <span class="adm-field-group">Artwork</span>
    <div class="adm-art-pair">
      ${artSlot({ id: 'g-cover', label: 'Cover', url: game.cover_url })}
      ${artSlot({ id: 'g-bg', wide: true, label: 'Backdrop', url: game.background_url })}
    </div>
    <button type="button" class="link-btn" id="g-advanced-toggle">Edit image URLs directly</button>
    <div id="g-advanced" hidden>
      <label class="field"><span>Cover URL</span><input id="g-cover-url" value="${esc(game.cover_url || '')}" placeholder="https://…"></label>
      <div class="adm-btn-row"><button class="btn btn--pill" id="g-hires">Upgrade to 1080p</button><button class="btn btn--pill" id="g-copy-id">Copy id</button></div>
      <label class="field"><span>Backdrop URL</span><input id="g-bg-url" value="${esc(game.background_url || '')}" placeholder="https://…"></label>
      <div class="adm-btn-row"><button class="btn btn--pill" id="g-bg-hires">Upgrade to 1080p</button><button class="btn btn--pill" id="g-bg-clear">Clear</button></div>
    </div>
    <span class="adm-field-group">Details</span>
    <label class="field"><span>Title</span><input id="g-title" value="${esc(game.title || '')}"></label>
    <label class="field"><span>Release year</span><input id="g-year" type="number" inputmode="numeric" value="${esc(game.release_year || '')}" placeholder="2024"></label>
    <div class="field-row">
      <label class="field"><span>Genre</span><input id="g-genre" value="${esc(game.genre || '')}" placeholder="Action, RPG"></label>
      <label class="field"><span>Platform</span><input id="g-platform" value="${esc(game.platform || '')}" placeholder="PC, PS5"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Developer</span><input id="g-dev" value="${esc(game.developer || '')}"></label>
      <label class="field"><span>Publisher</span><input id="g-pub" value="${esc(game.publisher || '')}"></label>
    </div>
    <label class="field"><span>Description</span><textarea id="g-desc" rows="4" placeholder="What shows under the trailer on the game page.">${esc(game.description || '')}</textarea></label>
    <p class="adm-row__sub">IGDB ${game.igdb_id ?? '–'} · RAWG ${game.rawg_id ?? '–'}</p>
    <div class="adm-btn-row">
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn--accent" id="g-save">Save</button>
    </div>`, (sheet, close) => {
    const coverUrlField = qs('#g-cover-url', sheet);
    const bgUrlField = qs('#g-bg-url', sheet);
    function wireSlot(id, urlField) {
      const preview = qs(`#${id}-preview`, sheet);
      const empty = qs(`#${id}-empty`, sheet);
      const dim = qs(`#${id}-dim`, sheet);
      const setUrl = (url, { fromPick = false } = {}) => {
        urlField.value = url || '';
        if (url) {
          preview.src = url; preview.hidden = false; empty.hidden = true;
          dim.textContent = 'measuring…';
          const probe = new Image();
          probe.onload = () => { dim.textContent = `${probe.naturalWidth}×${probe.naturalHeight}px`; };
          probe.onerror = () => { dim.textContent = 'could not load'; preview.hidden = true; empty.hidden = false; };
          probe.src = url;
        } else { preview.hidden = true; empty.hidden = false; dim.textContent = '–'; }
        if (fromPick) toast('Set. Remember to Save', 'success');
      };
      urlField.addEventListener('change', () => setUrl(urlField.value.trim()));
      if (urlField.value.trim()) setUrl(urlField.value.trim());
      return setUrl;
    }
    const setCover = wireSlot('g-cover', coverUrlField);
    const setBg = wireSlot('g-bg', bgUrlField);
    qs('#g-advanced-toggle', sheet).addEventListener('click', (e) => {
      const panel = qs('#g-advanced', sheet);
      panel.hidden = !panel.hidden;
      e.currentTarget.textContent = panel.hidden ? 'Edit image URLs directly' : 'Hide image URLs';
    });
    qs('#g-cover-pick', sheet).addEventListener('click', () => openCoverPicker(game, (url) => setCover(url, { fromPick: true })));
    qs('#g-bg-pick', sheet).addEventListener('click', () => openBackdropPicker(game, (url) => setBg(url, { fromPick: true })));
    const hires = (field, set) => {
      const url = field.value.trim();
      if (!url.includes('images.igdb.com')) { toast('Only IGDB images have size variants', 'error'); return; }
      set(url.replace(/\/t_[a-z0-9_]+\//i, '/t_1080p/'));
      toast('Switched to 1080p', 'success');
    };
    qs('#g-hires', sheet).addEventListener('click', () => hires(coverUrlField, setCover));
    qs('#g-bg-hires', sheet).addEventListener('click', () => hires(bgUrlField, setBg));
    qs('#g-bg-clear', sheet).addEventListener('click', () => setBg(''));
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
        cover_url: coverUrlField.value.trim() || null,
        background_url: bgUrlField.value.trim() || null,
        release_year: yearRaw ? Number(yearRaw) : null,
        genre: qs('#g-genre', sheet).value.trim() || null,
        platform: qs('#g-platform', sheet).value.trim() || null,
        developer: qs('#g-dev', sheet).value.trim() || null,
        publisher: qs('#g-pub', sheet).value.trim() || null,
        description: qs('#g-desc', sheet).value.trim() || null,
      }).eq('id', game.id);
      if (error) { btn.disabled = false; return fail(error); }
      audit('edit_game', `Edited the game “${title}”`, { type: 'game', id: game.id });
      close(); toast('Saved', 'success'); paintGames();
    });
  });
}

// ============================================================
// TRENDING
// ============================================================
SCREENS.trending = function trending() {
  paint(`
    ${header('Trending')}
    <main class="view-body">
      <div class="adm-box adm-box--pad" id="mode-card">${skeletonRows(1, { thumb: false })}</div>
      ${sectionHead('Your featured games')}
      <button class="btn btn--accent btn--block" id="add-game">${icons.plus()} Add a game</button>
      <div id="list" class="adm-gap-top">${skeletonRows(4)}</div>
      <p class="adm-hint">Hold the handle and drag to reorder, or tap a game for more options. The order here is the order players see.</p>
    </main>`);
  qs('#add-game').addEventListener('click', openGamePicker);
  paintTrendingMode();
  paintCurated();
};
REFRESH.trending = () => { paintTrendingMode(); return paintCurated(); };

async function paintTrendingMode() {
  const screen = state.screen;
  const host = qs('#mode-card');
  if (!host) return;
  let mode;
  try { mode = await getSetting('trending_mode', 'lead'); } catch (err) {
    if (!stillOn(screen)) return;
    host.innerHTML = `<p class="adm-hint adm-hint--flat">Couldn’t read the trending setting: ${esc(err.message)}</p>`;
    return;
  }
  if (!stillOn(screen)) return;
  host.innerHTML = switchRow({ id: 'mode-switch', title: 'Replace the live list', sub: mode === 'replace' ? 'Only your picks show. IGDB fills any leftover slots.' : 'Your picks lead, then IGDB’s live popular list follows.', on: mode === 'replace' });
  qs('#mode-switch', host).addEventListener('click', async (e) => {
    const next = e.currentTarget.getAttribute('aria-checked') === 'true' ? 'lead' : 'replace';
    try { await setSetting('trending_mode', next); paintTrendingMode(); toast(next === 'replace' ? 'Your picks only' : 'Your picks lead', 'success'); audit('trending_mode', next === 'replace' ? 'Trending: your picks only' : 'Trending: your picks lead', { type: 'trending' }); } catch (err) { fail(err); }
  });
}

async function paintCurated() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  const { data, error } = await supabase.from('curated_trending').select('id, position, game_id, games(id, title, cover_url, release_year)').order('position', { ascending: true });
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyBlock('Nothing featured yet. Add a game and it shows up at the top of Trending now.', icons.flame()); return; }

  host.innerHTML = group(data.map((r, i) => item({
    id: r.id, lead: `<span class="adm-drag" aria-label="Drag to reorder">${icons.grip()}</span><span class="adm-pos">${i + 1}</span>${poster(r.games?.cover_url)}`,
    title: esc(r.games?.title || 'Missing game'), meta: r.games?.release_year ? esc(r.games.release_year) : '', trail: chev(),
  })).join(''));

  const persistOrder = async () => {
    const ids = qsa('.adm-item', host).map((el) => el.dataset.id);
    qsa('.adm-pos', host).forEach((el, i) => { el.textContent = i + 1; });
    try {
      const results = await Promise.all(ids.map((id, i) => supabase.from('curated_trending').update({ position: i }).eq('id', id)));
      const bad = results.find((r) => r.error);
      if (bad) throw bad.error;
      toast('Order saved', 'success');
      audit('reorder_trending', 'Reordered Trending', { type: 'trending' });
    } catch (err) { fail(err); paintCurated(); }
  };

  // Drag by the handle. Pointer events, so it works with a finger as well as a mouse.
  qsa('.adm-drag', host).forEach((handle) => handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const row = handle.closest('.adm-item');
    const scroller = host.closest('.view-body');
    row.classList.add('adm-item--dragging');
    try { handle.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
    let moved = false;
    const move = (ev) => {
      moved = true;
      const y = ev.clientY;
      const box = scroller.getBoundingClientRect();
      if (y < box.top + 70) scroller.scrollTop -= 10; else if (y > box.bottom - 120) scroller.scrollTop += 10;
      const others = qsa('.adm-item', host).filter((r) => r !== row);
      const after = others.find((o) => { const b = o.getBoundingClientRect(); return y < b.top + b.height / 2; });
      if (after) after.before(row); else others[others.length - 1]?.after(row);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      row.classList.remove('adm-item--dragging');
      if (moved) persistOrder();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }));

  onRow(host, '.adm-item', (row) => {
    const r = data.find((x) => x.id === row.dataset.id);
    const rows = qsa('.adm-item', host);
    const idx = rows.indexOf(row);
    const moveTo = async (to) => {
      const el = rows[idx];
      if (to <= 0) rows[0].before(el);
      else if (to >= rows.length - 1) rows[rows.length - 1].after(el);
      else (to > idx ? rows[to].after(el) : rows[to].before(el));
      await persistOrder();
      paintCurated();
    };
    actionSheet({
      title: r.games?.title || 'Featured game', sub: `Position ${idx + 1} of ${rows.length}`,
      actions: [
        idx > 0 ? { label: 'Move to the top', icon: icons.pin(), run: () => moveTo(0) } : null,
        idx > 0 ? { label: 'Move up one', icon: icons.chart(), run: () => moveTo(idx - 1) } : null,
        idx < rows.length - 1 ? { label: 'Move down one', icon: icons.chart(), run: () => moveTo(idx + 1) } : null,
        r.games ? { label: 'Open the game', icon: icons.game(), run: () => openGame(r.games.id) } : null,
        {
          label: 'Remove from Trending', hint: 'The game stays in the catalog', icon: icons.trash(), danger: true,
          run: async () => {
            const { error: delErr } = await supabase.from('curated_trending').delete().eq('id', r.id);
            if (delErr) return fail(delErr);
            toast('Removed', 'success');
            audit('unfeature_game', `Removed “${r.games?.title || 'a game'}” from Trending`, { type: 'trending', id: r.id });
            paintCurated();
          },
        },
      ],
    });
  });
  touch(screen);
}

export function openGamePicker() {
  openSheet('Add a game', `
    <p class="modal__hint">Searches the catalog and IGDB. Picking one that isn’t in the catalog yet adds it.</p>
    ${searchBar({ id: 'game-q', placeholder: 'Search any game…' })}
    <div id="game-results"></div>`, (sheet, close) => {
    const input = qs('#game-q', sheet);
    const results = qs('#game-results', sheet);
    input.focus();
    let token = 0;
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      qs('[data-clear]', sheet).hidden = !q;
      if (q.length < 2) { results.innerHTML = ''; return; }
      results.innerHTML = skeletonRows(3);
      const mine = ++token;
      timer = setTimeout(async () => {
        try {
          const { results: games } = await searchGamesEverywhere(q, 14);
          if (mine !== token) return; // a newer keystroke already won
          if (!games.length) { results.innerHTML = emptyBlock('Nothing matched that.'); return; }
          results.innerHTML = group(games.map((g, i) => item({
            id: String(i), lead: poster(g.cover_url), title: esc(g.title), meta: `${g.release_year ? esc(g.release_year) : ''}${g._source === 'local' ? ' · in the catalog' : ''}`,
            trail: `<span class="adm-pillbtn">Feature</span>`,
          })).join(''));
          onRow(results, '.adm-item', async (row) => {
            const game = games[Number(row.dataset.id)];
            row.classList.add('is-busy');
            try {
              // A remote (IGDB/RAWG) hit has no row in `games` yet, and
              // curated_trending.game_id is a real foreign key, so the
              // catalog row has to exist before it can be featured.
              const local = game._source === 'local' && game.id ? game : await addGame(game, state.user.id);
              const { count } = await supabase.from('curated_trending').select('*', { count: 'exact', head: true });
              const { error } = await supabase.from('curated_trending').insert({ game_id: local.id, position: count ?? 0, created_by: state.user.id });
              if (error) throw error;
              close();
              toast(`${game.title} featured`, 'success');
              audit('feature_game', `Featured “${game.title}” on Trending`, { type: 'game', id: local.id });
              REFRESH.trending?.();
            } catch (err) {
              row.classList.remove('is-busy');
              fail(err, err?.code === '23505' ? 'That game is already featured' : 'Could not add that game');
            }
          });
        } catch (err) {
          if (mine === token) results.innerHTML = emptyBlock('Search failed. Try again.');
          console.error(err);
        }
      }, 320);
    });
    qs('[data-clear]', sheet).addEventListener('click', () => { input.value = ''; results.innerHTML = ''; qs('[data-clear]', sheet).hidden = true; input.focus(); });
  });
}
hooks.openGamePicker = openGamePicker;

// ============================================================
// LISTS
// ============================================================
let listsQuery = '';

SCREENS.lists = function lists() {
  paint(`
    ${header('Lists')}
    <main class="view-body">
      <div class="adm-sticky">${searchBar({ id: 'l-q', placeholder: 'Search list names', value: listsQuery })}</div>
      <div id="list">${skeletonRows(6, { thumb: false })}</div>
    </main>`);
  wireSearch(qs('.adm-sticky'), { id: 'l-q', onChange: (v) => { listsQuery = v; paintLists(); } });
  paintLists();
};
REFRESH.lists = () => paintLists();

async function paintLists() {
  const screen = state.screen;
  const host = qs('#list');
  if (!host) return;
  let sel = supabase.from('lists').select('id, name, is_public, created_at, user_id').order('created_at', { ascending: false }).limit(120);
  const clean = listsQuery.replace(/[%,]/g, ' ').trim();
  if (clean) sel = sel.ilike('name', `%${clean}%`);
  const { data, error } = await sel;
  if (!stillOn(screen)) return;
  if (error) { host.innerHTML = emptyBlock(error.message); return; }
  if (!data?.length) { host.innerHTML = emptyBlock(clean ? 'No list matches that.' : 'No lists yet.', icons.list()); return; }

  const ownerIds = [...new Set(data.map((l) => l.user_id).filter(Boolean))];
  const [ownersRes, itemsRes] = await Promise.all([
    ownerIds.length ? supabase.from('profiles').select('id, username').in('id', ownerIds) : Promise.resolve({ data: [] }),
    supabase.from('list_items').select('list_id').in('list_id', data.map((l) => l.id)),
  ]);
  if (!stillOn(screen)) return;
  const owners = Object.fromEntries((ownersRes.data || []).map((p) => [p.id, p.username]));
  const counts = {};
  (itemsRes.data || []).forEach((it) => { counts[it.list_id] = (counts[it.list_id] || 0) + 1; });

  host.innerHTML = group(data.map((l) => item({
    id: l.id, lead: chipIcon(icons.list(), l.is_public ? 'info' : 'muted'), title: esc(l.name),
    meta: `@${esc(owners[l.user_id] || 'unknown')} · ${counts[l.id] || 0} ${(counts[l.id] || 0) === 1 ? 'game' : 'games'}`, meta2: `${l.is_public ? 'public' : 'private'} · ${esc(ago(l.created_at))}`, trail: chev(),
  })).join(''));
  onRow(host, '.adm-item', (row) => openList(row.dataset.id));
  touch(screen);
}

export async function openList(id) {
  const { data: l } = await supabase.from('lists').select('id, name, description, is_public, created_at, user_id').eq('id', id).maybeSingle();
  if (!l) { toast('That list is gone', 'error'); return; }
  const [ownerRes, itemsRes] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, avatar_url').eq('id', l.user_id).maybeSingle(),
    supabase.from('list_items').select('position, games(id, title, cover_url)').eq('list_id', id).order('position', { ascending: true }).limit(40),
  ]);
  const owner = ownerRes.data;
  const items = (itemsRes.data || []).filter((x) => x.games);
  const act = (key, icon, label, hint = '', danger = false) => `
    <button class="adm-action${danger ? ' adm-action--danger' : ''}" data-act="${key}"><span class="adm-action__icon">${icon}</span><span class="adm-action__text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></button>`;
  openSheet('List', `
    <div class="adm-box adm-box--pad">
      <b class="adm-about">${esc(l.name)}</b>
      ${l.description ? `<p class="adm-quote">${esc(l.description)}</p>` : ''}
      <span class="adm-about__meta">${items.length} ${items.length === 1 ? 'game' : 'games'} · ${l.is_public ? 'public' : 'private'} · ${esc(ago(l.created_at))}</span>
    </div>
    ${owner ? `<div class="adm-group"><div class="adm-item" role="button" tabindex="0" data-act="owner">${avatarImg(owner, 40)}<span class="adm-item__main"><span class="adm-item__title">${esc(displayName(owner))}</span><span class="adm-item__meta">@${esc(owner.username)} · owner</span></span><span class="adm-item__trail">${chev()}</span></div></div>` : ''}
    ${items.length ? `<div class="adm-strip">${items.map((x) => `<button class="adm-strip__item" data-game="${esc(x.games.id)}" title="${esc(x.games.title)}">${poster(x.games.cover_url, 'adm-strip__img')}</button>`).join('')}</div>` : ''}
    <div class="adm-actions">
      ${act('app', icons.open(), 'Open the list in the app')}
      ${act('del', icons.trash(), 'Delete this list', 'Removes it for its owner, for good', true)}
    </div>`, (sheet, close) => {
    onRow(sheet, '[data-act="owner"]', () => { close(); hooks.openUser?.(owner.id); });
    qsa('[data-game]', sheet).forEach((b) => b.addEventListener('click', () => { close(); openGame(b.dataset.game); }));
    qs('button[data-act="app"]', sheet).addEventListener('click', () => openApp(`list/${l.id}`));
    qs('button[data-act="del"]', sheet).addEventListener('click', async () => {
      if (!await confirmSheet({ title: 'Delete this list?', sub: 'It disappears for its owner, permanently.', confirmLabel: 'Delete', danger: true })) return;
      const { error } = await supabase.from('lists').delete().eq('id', l.id);
      if (error) return fail(error);
      audit('delete_list', `Deleted the list “${l.name}”`, { type: 'list', id: l.id });
      close(); toast('Deleted', 'success'); paintLists();
    });
  });
}
hooks.openList = openList;

void fmtNum; void chipIcon;
