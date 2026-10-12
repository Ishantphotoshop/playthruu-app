// ============================================================
// ADMIN CORE — the shell every admin screen sits in
// ============================================================
// Navigation (a bottom tab bar, a header with Back / Refresh / Search),
// the kept-screen machinery, sheets, and the small building blocks every
// screen shares (rows, pills, search bars, chips). Screens live in
// ./screens/ and register themselves into SCREENS.
//
// Screens are kept mounted once built (hidden, never torn down), so
// switching tabs shows a screen exactly as it was left. A kept screen that
// has gone stale is quietly refreshed when it is shown again.

import { supabase } from '../js/supabase-client.js';
import { esc, qs as qsDoc, qsa as qsaDoc, toast, timeAgo } from '../js/utils.js';
import { avatarImg, iconBack, iconSearch, iconClose, iconChevronRight } from '../js/components.js';

export { supabase, esc, toast, timeAgo, avatarImg, iconBack, iconSearch, iconClose, iconChevronRight, qsDoc, qsaDoc };

export const PROJECT_REF = 'kpgjuuplpgilupogpezc';
export const root = document.getElementById('app');

// Anyone whose last heartbeat landed inside this window counts as on the
// app right now (the app beats every 60s while visible).
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export const state = {
  user: null,
  profile: null,
  screen: 'home',
  params: new URLSearchParams(),
  openReports: 0,
};

// Filled in by admin.js (they live outside core to avoid import cycles).
export const hooks = {};
// name -> () => builds the screen (calls paint())
export const SCREENS = {};
// name -> ({ quiet }) => repaints the screen's data in place
export const REFRESH = {};
// name -> (params) => applies #/screen?filter=x to an already-built screen.
// Return true when it repainted (so the stale-refresh is skipped).
export const ENTER = {};

// ------------------------------------------------------------ structure
export const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'people', label: 'People' },
  { id: 'manage', label: 'Manage' },
  { id: 'more', label: 'More' },
];

// Which tab a screen belongs to, and (for screens one level down) where
// Back goes.
export const SCREEN_INFO = {
  home: { tab: 'home' },
  insights: { tab: 'home', parent: 'home' },
  inbox: { tab: 'inbox' },
  reports: { tab: 'inbox', parent: 'inbox' },
  people: { tab: 'people' },
  manage: { tab: 'manage' },
  news: { tab: 'manage', parent: 'manage' },
  trending: { tab: 'manage', parent: 'manage' },
  announce: { tab: 'manage', parent: 'manage' },
  games: { tab: 'manage', parent: 'manage' },
  lists: { tab: 'manage', parent: 'manage' },
  comments: { tab: 'manage', parent: 'manage' },
  activity: { tab: 'manage', parent: 'manage' },
  more: { tab: 'more' },
  waitlist: { tab: 'more', parent: 'more' },
  audit: { tab: 'more', parent: 'more' },
};

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
// Active-state glyphs carry their own fills, so each one can be solid where
// that reads well and stay an outline where it does not.
const F = 'fill="currentColor"';
const TAB_ICONS = {
  home: [
    '<path d="M3.5 11 12 3.5 20.5 11"/><path d="M5.5 9.5V20a.5.5 0 0 0 .5.5h4v-6h4v6h4a.5.5 0 0 0 .5-.5V9.5"/>',
    `<path ${F} d="M3.5 11 12 3.5 20.5 11"/><path ${F} d="M5.5 9.5V20a.5.5 0 0 0 .5.5h4v-6h4v6h4a.5.5 0 0 0 .5-.5V9.5"/>`,
  ],
  inbox: [
    '<path d="M3.5 13.5 6 5.9A2 2 0 0 1 7.9 4.5h8.2A2 2 0 0 1 18 5.9l2.5 7.6"/><path d="M3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5H15l-1 2.2h-4l-1-2.2z"/>',
    `<path d="M3.5 13.5 6 5.9A2 2 0 0 1 7.9 4.5h8.2A2 2 0 0 1 18 5.9l2.5 7.6"/><path ${F} d="M3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5H15l-1 2.2h-4l-1-2.2z"/>`,
  ],
  people: [
    '<circle cx="9" cy="8.5" r="3.4"/><path d="M2.8 19.5c.4-3.3 3-5.3 6.2-5.3s5.8 2 6.2 5.3"/><path d="M15.6 5.4a3.2 3.2 0 0 1 0 6.2"/><path d="M17.6 14.6c2.1.6 3.4 2.3 3.6 4.9"/>',
    `<circle ${F} cx="9" cy="8.5" r="3.4"/><path ${F} d="M2.8 19.5c.4-3.3 3-5.3 6.2-5.3s5.8 2 6.2 5.3z"/><path d="M15.6 5.4a3.2 3.2 0 0 1 0 6.2"/><path d="M17.6 14.6c2.1.6 3.4 2.3 3.6 4.9"/>`,
  ],
  manage: [
    '<rect x="3.8" y="3.8" width="7" height="7" rx="1.8"/><rect x="13.2" y="3.8" width="7" height="7" rx="1.8"/><rect x="3.8" y="13.2" width="7" height="7" rx="1.8"/><rect x="13.2" y="13.2" width="7" height="7" rx="1.8"/>',
    `<rect ${F} x="3.8" y="3.8" width="7" height="7" rx="1.8"/><rect ${F} x="13.2" y="3.8" width="7" height="7" rx="1.8"/><rect ${F} x="3.8" y="13.2" width="7" height="7" rx="1.8"/><rect ${F} x="13.2" y="13.2" width="7" height="7" rx="1.8"/>`,
  ],
  more: [
    '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    `<circle ${F} cx="5.5" cy="12" r="1.9"/><circle ${F} cx="12" cy="12" r="1.9"/><circle ${F} cx="18.5" cy="12" r="1.9"/>`,
  ],
};

function tabbarHtml(active) {
  return `<nav class="tabbar adm-tabbar" aria-label="Admin sections">${TABS.map((t) => `
    <a href="#/${t.id === 'home' ? '' : t.id}" class="tabbar__item${t.id === active ? ' tabbar__item--active' : ''}" data-tab="${t.id}" aria-label="${t.label}"${t.id === active ? ' aria-current="page"' : ''}>
      <span class="tab-off">${svg(TAB_ICONS[t.id][0])}</span><span class="tab-on">${svg(TAB_ICONS[t.id][1])}</span>
      <span class="adm-tab-badge" data-tab-badge="${t.id}" hidden></span>
    </a>`).join('')}</nav>`;
}

// Numbers on the tab bar (the Inbox badge). Applied to every kept screen's
// own tab bar, so the count is right whichever screen is showing.
const badges = {};
export function setBadge(tab, n) {
  badges[tab] = n;
  qsaDoc(`[data-tab-badge="${tab}"]`, root).forEach((el) => {
    el.hidden = !n;
    el.textContent = n > 99 ? '99+' : String(n || '');
  });
}

// ------------------------------------------------------------ pages
let pageEls = {};
const paintedAt = {};

export function resetPages() {
  pageEls = {};
  Object.keys(paintedAt).forEach((k) => delete paintedAt[k]);
}
export const hasPage = (name) => !!pageEls[name];
export const dropPage = (name) => { pageEls[name]?.remove(); delete pageEls[name]; delete paintedAt[name]; };

// Most screens share generic ids (#list, #q ...). With every visited screen
// kept in the DOM, an unscoped lookup would find whichever copy comes first,
// so these default to the screen that is on show right now. An explicit
// scope (a sheet, a row) always wins.
export function qs(sel, scope) { return qsDoc(sel, scope || pageEls[state.screen] || root); }
export function qsa(sel, scope) { return qsaDoc(sel, scope || pageEls[state.screen] || root); }

// Call right after an await, before writing into the page: if the admin has
// moved to another screen meanwhile, bail out instead of painting this
// screen's results into whatever is showing now.
export const stillOn = (screen) => state.screen === screen;

export function touch(screen = state.screen) { paintedAt[screen] = Date.now(); }

export function paint(html) {
  const screen = state.screen;
  let el = pageEls[screen];
  if (!el) {
    el = document.createElement('div');
    el.className = 'adm-page';
    root.appendChild(el);
    pageEls[screen] = el;
  }
  el.innerHTML = html + tabbarHtml(SCREEN_INFO[screen]?.tab);
  paintedAt[screen] = Date.now();
  showPage(screen);
  wireChrome(el, screen);
  Object.entries(badges).forEach(([tab, n]) => setBadge(tab, n));
}

function showPage(screen) {
  qsDoc('.boot-loader', root)?.remove();
  Object.keys(pageEls).forEach((name) => { pageEls[name].hidden = name !== screen; });
}

function wireChrome(el, screen) {
  qsDoc('[data-adm-back]', el)?.addEventListener('click', () => go(SCREEN_INFO[screen]?.parent || 'home'));
  qsDoc('[data-adm-search]', el)?.addEventListener('click', () => hooks.openSearch?.());
  const refresh = qsDoc('[data-adm-refresh]', el);
  refresh?.addEventListener('click', async () => {
    refresh.classList.add('is-spinning');
    try { await REFRESH[screen]?.({ quiet: false }); } finally {
      setTimeout(() => refresh.classList.remove('is-spinning'), 350);
    }
  });
  // Tapping the tab you are already on goes back to its top level / scrolls up.
  qsDoc('.adm-tabbar', el)?.addEventListener('click', (e) => {
    const a = e.target.closest('[data-tab]');
    if (!a) return;
    const target = a.dataset.tab === 'home' ? '' : a.dataset.tab;
    if (location.hash.replace(/^#\/?/, '') === target) {
      e.preventDefault();
      qsDoc('.view-body', el)?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

// ------------------------------------------------------------ routing
export function go(screen) {
  const target = screen === 'home' ? '' : screen;
  if (location.hash.replace(/^#\/?/, '') !== target) {
    location.hash = target ? `#/${target}` : '#/';
    return; // hashchange re-enters through render()
  }
  render(screen);
}

const STALE_MS = 45_000;
export function render(requested) {
  const [name, query] = String(requested || '').split('?');
  const screen = SCREENS[name] ? name : 'home';
  state.screen = screen;
  state.params = new URLSearchParams(query || '');
  if (pageEls[screen]) {
    showPage(screen);
    const handled = ENTER[screen]?.(state.params);
    if (!handled && Date.now() - (paintedAt[screen] || 0) > STALE_MS) REFRESH[screen]?.({ quiet: true });
    return;
  }
  SCREENS[screen]();
}

// ------------------------------------------------------------ header
export const iconRefresh = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4.5h-4.5"/></svg>`;

export function header(title, { sub = '' } = {}) {
  const info = SCREEN_INFO[state.screen] || {};
  return `
    <header class="adm-top">
      ${info.parent
        ? `<button class="adm-top__btn" data-adm-back aria-label="Back">${iconBack()}</button>`
        : '<span class="adm-top__mark" aria-hidden="true"></span>'}
      <div class="adm-top__text">
        <h1 class="adm-top__title">${esc(title)}</h1>
        ${sub ? `<span class="adm-top__sub">${esc(sub)}</span>` : ''}
      </div>
      ${info.parent ? '' : '<span class="stamp stamp--playing adm-stamp">ADMIN</span>'}
      <button class="adm-top__btn" data-adm-refresh aria-label="Refresh">${iconRefresh()}</button>
      <button class="adm-top__btn" data-adm-search aria-label="Search">${iconSearch()}</button>
    </header>`;
}

// ------------------------------------------------------------ helpers
export function fail(err, fallback = 'Something went wrong') {
  // The real Postgres/PostgREST message matters more here than anywhere in
  // the app: an RLS refusal and a typo'd column look identical otherwise.
  console.error(err);
  toast(err?.message || fallback, 'error');
}

export const fmtNum = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat().format(n));

// "5m ago", but "just now" instead of "now ago".
export function ago(iso) {
  if (!iso) return '';
  const a = timeAgo(iso);
  return a === 'now' ? 'just now' : `${a} ago`;
}

export function presenceOf(lastSeenAt) {
  if (!lastSeenAt) return { online: false, label: 'never seen' };
  const ms = Date.now() - new Date(lastSeenAt).getTime();
  if (ms < ONLINE_WINDOW_MS) return { online: true, label: 'online now' };
  return { online: false, label: `seen ${ago(lastSeenAt)}` };
}

export function presenceHtml(lastSeenAt) {
  const { online, label } = presenceOf(lastSeenAt);
  return `<span class="adm-presence${online ? ' adm-presence--online' : ''}"><span class="adm-presence__dot"></span>${esc(label)}</span>`;
}

// Total foreground time from user_usage.total_seconds.
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  if (s < 60) return 'none yet';
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'success');
  } catch {
    // The Clipboard API needs a secure context, which a WebView served over
    // plain http during local testing doesn't have.
    toast('Select the text and copy it manually', 'error');
  }
}

// Opens something in the real app (a new tab / the system browser).
export const appLink = (path) => `../#/${path}`;
export function openApp(path) { window.open(appLink(path), '_blank', 'noopener'); }

export const displayName = (p) => p?.display_name || p?.username || 'someone';

// ------------------------------------------------------------ admin log + recents
// Every action that changes something is written to admin_audit (see
// migrations/2026-10-14_admin_audit.sql). Fire and forget: a failed log write
// never blocks the action itself, and a database without the table just stops trying.
let auditOk = true;
export function audit(action, summary, { type = null, id = null } = {}) {
  if (!auditOk || !state.user) return;
  supabase.from('admin_audit').insert({
    actor_id: state.user.id, actor_name: displayName(state.profile), action, summary,
    target_type: type, target_id: id == null ? null : String(id),
  }).then(({ error }) => { if (error && (error.code === 'PGRST205' || error.code === '42P01')) auditOk = false; });
}

// The people and games opened lately, for the empty search box.
const RECENT_KEY = 'adm_recent_v1';
export function getRecents() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
export function addRecent(entry) {
  try {
    const list = getRecents().filter((r) => !(r.type === entry.type && r.id === entry.id));
    list.unshift(entry);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch { /* storage unavailable: recents just aren't kept */ }
}

// ------------------------------------------------------------ settings
export async function getSetting(key, fallbackValue) {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? fallbackValue;
}
export async function setSetting(key, value) {
  const { error } = await supabase.from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: state.user.id });
  if (error) throw error;
}

// ------------------------------------------------------------ sheets
export function openSheet(title, bodyHtml, wire, { sub = '' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay adm-overlay';
  overlay.innerHTML = `
    <div class="modal modal--tall" role="dialog" aria-label="${esc(title)}">
      <div class="modal__header adm-sheet-head">
        <div class="adm-sheet-head__text">
          <h2>${esc(title)}</h2>
          ${sub ? `<span class="adm-sheet-head__sub">${sub}</span>` : ''}
        </div>
        <button class="modal__close" data-sheet-close aria-label="Close"></button>
      </div>
      <div class="adm-sheet-body">${bodyHtml}</div>
    </div>`;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-sheet-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  const sheet = qsDoc('.modal', overlay);
  wire?.(sheet, close);
  return { close, sheet };
}

export function confirmSheet({ title, sub, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay adm-overlay adm-overlay--top';
    overlay.innerHTML = `
      <div class="modal" role="alertdialog" aria-label="${esc(title)}">
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

// A list of actions in a sheet — what a row's "…" opens.
export function actionSheet({ title, sub = '', actions }) {
  return openSheet(title, `
    <div class="adm-actions">
      ${actions.filter(Boolean).map((a, i) => `
        <button class="adm-action${a.danger ? ' adm-action--danger' : ''}" data-i="${i}" ${a.disabled ? 'disabled' : ''}>
          ${a.icon ? `<span class="adm-action__icon">${a.icon}</span>` : ''}
          <span class="adm-action__text"><b>${esc(a.label)}</b>${a.hint ? `<small>${esc(a.hint)}</small>` : ''}</span>
        </button>`).join('')}
    </div>`, (sheet, close) => {
    const list = actions.filter(Boolean);
    qsaDoc('[data-i]', sheet).forEach((b) => b.addEventListener('click', () => {
      close();
      list[Number(b.dataset.i)].run?.();
    }));
  }, { sub });
}

// ------------------------------------------------------------ building blocks
// A row in a list. Rows are real <div role="button"> so they can hold their
// own buttons; wire taps with `onRow()` below.
export function item({ id = '', lead = '', title, meta = '', meta2 = '', trail = '', pick = false, attrs = '', cls = '' }) {
  return `
    <div class="adm-item${cls ? ` ${cls}` : ''}" role="button" tabindex="0" data-id="${esc(id)}"${pick ? ' data-bulk-row' : ''} ${attrs}>
      ${pick ? '<button class="adm-check" data-bulk-box role="checkbox" aria-checked="false" aria-label="Select"></button>' : ''}
      ${lead}
      <span class="adm-item__main">
        <span class="adm-item__title">${title}</span>
        ${meta ? `<span class="adm-item__meta">${meta}</span>` : ''}
        ${meta2 ? `<span class="adm-item__meta">${meta2}</span>` : ''}
      </span>
      ${trail ? `<span class="adm-item__trail">${trail}</span>` : ''}
    </div>`;
}

export const group = (html) => `<div class="adm-group">${html}</div>`;

export const poster = (url, cls = 'adm-thumb') => (url
  ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" onerror="this.classList.add('is-broken')">`
  : `<span class="${cls}"></span>`);

export const chipIcon = (svgHtml, tone = '') => `<span class="adm-chip-icon${tone ? ` adm-chip-icon--${tone}` : ''}">${svgHtml}</span>`;

// small status words: tone is ok | warn | bad | info | muted
export const pill = (text, tone = 'muted') => `<span class="adm-pill adm-pill--${tone}">${esc(text)}</span>`;

export const chev = () => `<span class="adm-chev">${iconChevronRight()}</span>`;

export function sectionHead(title, { link = '', linkText = 'See all' } = {}) {
  return `<div class="adm-sec"><h2 class="adm-sec__title">${esc(title)}</h2>${link ? `<a class="adm-sec__link" href="#/${esc(link)}" data-go="${esc(link)}">${esc(linkText)} ${iconChevronRight()}</a>` : ''}</div>`;
}

export function emptyBlock(message, iconHtml = '') {
  return `<div class="adm-empty">${iconHtml ? `<span class="adm-empty__icon">${iconHtml}</span>` : ''}<p>${esc(message)}</p></div>`;
}

// Search field with a clear button.
export function searchBar({ id = 'q', placeholder = 'Search…', value = '' } = {}) {
  return `
    <label class="adm-searchbar">
      <span class="adm-searchbar__icon">${iconSearch()}</span>
      <input type="search" id="${id}" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="search" value="${esc(value)}">
      <button type="button" class="adm-searchbar__clear" data-clear aria-label="Clear" ${value ? '' : 'hidden'}>${iconClose()}</button>
    </label>`;
}

// Wires a searchBar: debounced onChange(value), clear button, state-aware.
export function wireSearch(scope, { id = 'q', delay = 260, onChange }) {
  const input = qsDoc(`#${id}`, scope);
  const clear = qsDoc('[data-clear]', input.parentElement);
  let timer;
  const fire = () => { clear.hidden = !input.value; onChange(input.value.trim()); };
  input.addEventListener('input', () => { clear.hidden = !input.value; clearTimeout(timer); timer = setTimeout(fire, delay); });
  clear.addEventListener('click', () => { input.value = ''; fire(); input.focus(); });
  return input;
}

// A single row of filter chips that scrolls sideways instead of wrapping.
export function chips(list, current, attr = 'data-chip') {
  return `<div class="adm-chips" role="tablist">${list.map(([id, label, count]) => `
    <button class="adm-chip${id === current ? ' adm-chip--on' : ''}" ${attr}="${esc(id)}" role="tab" aria-selected="${id === current}">${esc(label)}${count || count === 0 ? `<i class="adm-chip__n">${fmtNum(count)}</i>` : ''}</button>`).join('')}</div>`;
}
export function syncChips(scope, current, attr = 'data-chip') {
  qsaDoc(`[${attr}]`, scope).forEach((b) => {
    const on = b.getAttribute(attr) === current;
    b.classList.toggle('adm-chip--on', on);
    b.setAttribute('aria-selected', String(on));
  });
}

// Activate a row from keyboard too.
export function onRow(host, selector, handler) {
  qsaDoc(selector, host).forEach((row) => {
    if (row.dataset.wired) return;
    row.dataset.wired = '1';
    row.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, label')) handler(row, e); });
    row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); handler(row, e); } });
  });
}

export function toggle({ id = '', on = false, disabled = false }) {
  return `<button class="adm-switch" ${id ? `id="${id}"` : ''} role="switch" aria-checked="${!!on}" ${disabled ? 'disabled' : ''}></button>`;
}

export const switchRow = ({ id, title, sub = '', on = false, disabled = false }) => `
  <div class="adm-switch-row">
    <span class="adm-switch-row__text"><span class="adm-switch-row__title">${esc(title)}</span>${sub ? `<span class="adm-switch-row__sub">${esc(sub)}</span>` : ''}</span>
    ${toggle({ id, on, disabled })}
  </div>`;

// Skeleton lists keep a screen's shape while it loads.
export { skeletonRows } from './toolkit.js';
