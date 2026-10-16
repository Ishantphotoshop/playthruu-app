import { playedKind } from '../utils.js';
import { openNotificationsOn } from './notifications-view.js';
import * as api from '../api.js';
import { state } from '../state.js';
import { esc, qs, qsa } from '../utils.js';
import { posterFrame } from '../components.js';

// The area under the Ratings box on a profile: a grid of six tiles (Games,
// Diary, Reviews, Backlog, Likes, Taste), then the Stats panel: Completed and
// Logged, Activity by month, Backlog with Pick for me (or Compare on someone
// else's profile) and Hours. Everything is worked out from the logs the
// profile has already loaded; only Compare needs the viewer's own logs.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const num = (n) => Number(n).toLocaleString('en-US');

// Switched off for now, not deleted: set to true to bring them back.
//   SHOW_ACTIVITY_BOX  the "Stats" bar, This year / Last / All filter, Completed and Logged
//                      rows and the Activity (months) box
//   SHOW_TILES         the six boxes (Games, Diary, Reviews, Backlog, Likes, Taste)
const SHOW_ACTIVITY_BOX = false;
const SHOW_TILES = false;
// The This year row under Ratings. Set to true to bring it back (its page still exists).
const SHOW_THIS_YEAR = false;
// The Activity (months) box on its own, at the very bottom, without the Stats bar or filter.
const SHOW_ACTIVITY_BOTTOM = false;
// The Hours box (total hours, average, most played). Set to true to bring it back.
const SHOW_HOURS = false;

const chevron = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The list under Ratings: each row opens its own page.
const rowIcon = (vb, body, sw = 1.7) => `<svg class="ps-row__ic" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ROW_ICONS = {
  Diary: rowIcon('0 0 24 24', '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/>'),
  Played: rowIcon('2.5 2 19 19.5', '<path d="M5 17h14a1.5 1.5 0 0 1 1.5 1.5V20.5h-17V18.5A1.5 1.5 0 0 1 5 17z"/><path d="M12 9v8"/><circle cx="12" cy="6" r="3"/>'),
  Reviews: rowIcon('0 0 24 24', '<path d="M5 7h14M5 12h14M5 17h9"/>', 1.8),
  Likes: rowIcon('2.3 4.35 19.4 16.95', '<path d="M12 20.3 4.7 13.4a4.7 4.7 0 0 1 6.6-6.7l.7.7.7-.7a4.7 4.7 0 0 1 6.6 6.7z"/>'),
  Replays: rowIcon('13.75 7.59 104.81 104.81', '<path stroke-width="11" d="M 90.64 85.71 A 40 40 0 1 1 100 60 L 112.31 26.17 M 65.6 60 L 100 60"/>'),
  Backlog: rowIcon('6 2 12 20', '<path d="M7 3h10v3.5L13 12l4 5.5V21H7v-3.5L11 12 7 6.5z"/>'),
  Compare: rowIcon('0 0 24 24', '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>'),
  Activity: rowIcon('0 0 24 24', '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>'),
};

function rowsHtml(profile, logs, isOwn) {
  const base = `#/profile/${esc(profile.username)}`;
  const THIS_YEAR = new Date().getFullYear();
  // Same set the pages open on: backlog games never count as logs.
  const own = logs.filter((l) => l.status !== 'backlog');
  const inYear = (l) => { const raw = l.played_date || l.created_at; return !!raw && new Date(raw).getFullYear() === THIS_YEAR; };
  const playedAll = own.filter((l) => l.status === 'played' || l.status === 'dropped');
  const diary = playedAll.filter((l) => playedKind(l, profile.created_at) === 'diary');
  const sets = {
    played: diary,
    thisYear: diary.filter(inYear),
    logs: own.filter((l) => l.rating || l.review || l.loved),
    reviews: own.filter((l) => l.review),
    likes: own.filter((l) => l.loved),
    replays: own.filter((l) => l.is_replay),
  };
  // "this year / all time", right after the name.
  const count = (list, withTotal = true, totalOnly = false) => `<span class="ps-row__n"><b>${num(totalOnly ? list.length : list.filter(inYear).length)}</b>${withTotal && !totalOnly ? `<em>/ ${num(list.length)}</em>` : ''}</span>`;
  // A row with nothing behind it is faded and does not open; it comes alive once there is something to see.
  const row = (label, list, attrs, withTotal = true, totalOnly = false) => (list && list.length === 0)
    ? `<div class="ps-row ps-row--off" aria-disabled="true">${ROW_ICONS[label] || ''}<span class="ps-row__l">${label}</span><span class="ps-row__r"><span class="ps-row__n"><b>0</b></span><i class="ps-row__chev ps-row__chev--show">${chevron}</i></span></div>`
    : `<a class="ps-row" ${attrs}>${ROW_ICONS[label] || ''}<span class="ps-row__l">${label}</span><span class="ps-row__r">${list ? count(list, withTotal, totalOnly) : ''}<i class="ps-row__chev ps-row__chev--show">${chevron}</i></span></a>`;
  return `
    <div class="ps-rows ps-rows--ic">
      ${SHOW_THIS_YEAR ? row('This year', sets.thisYear, `href="${base}/log-list/year"`) : ''}
      ${row('Played', playedAll, `href="${base}/log-list/played"`, true, true)}
      ${row('Diary', sets.played, `href="${base}/log-list/diary"`, false)}
      ${row('Reviews', sets.reviews, `href="${base}/log-list/reviews"`, true, true)}
      ${row('Likes', sets.likes, `href="${base}/log-list/liked"`, true, true)}
      ${row('Replays', sets.replays, `href="${base}/log-list/replayed"`, true, true)}
      <a class="ps-row${logs.some((l) => l.status === 'backlog') ? '' : ' ps-row--off'}" ${logs.some((l) => l.status === 'backlog') ? `href="${base}/backlog"` : 'aria-disabled="true"'}>${ROW_ICONS.Backlog}<span class="ps-row__l">Backlog</span><span class="ps-row__r"><span class="ps-row__n"><b>${num(logs.filter((l) => l.status === 'backlog').length)}</b></span><i class="ps-row__chev ps-row__chev--show">${chevron}</i></span></a>
      ${row('Activity', null, isOwn ? 'href="#/notifications" data-open-notif="you"' : `href="${base}/activity"`)}
    </div>`;
}

// Top genres across everything logged: the first genre on each game.
function topGenres(logs, limit = 4) {
  const counts = new Map();
  for (const l of logs) {
    let g = (l.games?.genre || '').split(',')[0].trim();
    // "Role-playing (RPG)" reads better as "RPG".
    const short = g.match(/\(([^)]+)\)/);
    if (short) g = short[1];
    if (g) counts.set(g, (counts.get(g) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

// Games finished (Played or Dropped) per calendar month, January to December.
// 'year' is this year, 'last' last year, 'all' every year added up by month.
function monthCounts(diary, period) {
  const counts = new Array(12).fill(0);
  const thisYear = new Date().getFullYear();
  for (const l of diary) {
    const raw = l.played_date || l.created_at;
    if (!raw) continue;
    const d = new Date(raw);
    const y = d.getFullYear();
    if (period === 'year' && y !== thisYear) continue;
    if (period === 'last' && y !== thisYear - 1) continue;
    counts[d.getMonth()] += 1;
  }
  return counts;
}

const periodNote = (period) => (period === 'all' ? 'all years, by month' : String(period === 'last' ? new Date().getFullYear() - 1 : new Date().getFullYear()));

function completedValue(period, stats, lastYear) {
  if (period === 'last') return `<b>${num(lastYear)}<small>/${new Date().getFullYear() - 1}</small></b>`;
  if (period === 'all') return `<b>${num(stats.totalPlayed)}</b>`;
  return `<b>${num(stats.totalPlayed)}<small>/${num(stats.thisYear)}</small></b>`;
}

const box = (title, right, body) => `
  <div class="ps-box">
    <div class="ps-head"><span class="ps-title">${title}</span>${right ? `<span class="ps-note">${right}</span>` : ''}</div>
    ${body}
  </div>`;

function activityHtml(diary, period) {
  const counts = monthCounts(diary, period);
  const max = Math.max(1, ...counts);
  const bars = counts.map((n, i) => {
    const h = n === 0 ? 1 : +(2 + (n / max) * 52).toFixed(1);
    return `<div class="ps-ab${n === 0 ? ' ps-ab--zero' : ''}" data-i="${i}" data-n="${n}"><span class="ps-cnt" style="bottom:${h + 6}px">${n}</span><i style="height:${h}px"></i></div>`;
  }).join('');
  return `
    <div class="ps-act" data-period="${period}">
      <div class="ps-gap"></div>
      <div class="ps-abars">${bars}</div>
      <div class="ps-alab">${counts.map((n) => `<span>${n}</span>`).join('')}</div>
    </div>`;
}

function statsPanelHtml(ctx, period) {
  const { profile, logs, stats, isOwn, diary, lastYear } = ctx;
  const base = `#/profile/${esc(profile.username)}/log-list`;

  let lower = '';
  if (isOwn) {
    lower = '';
  } else if (state.user) {
    lower = `<div class="ps-rows ps-rows--ic"><a class="ps-row" href="#/profile/${esc(profile.username)}/compare">${ROW_ICONS.Compare}<span class="ps-row__l">Compare</span><span class="ps-row__r"><i class="ps-row__chev ps-row__chev--show">${chevron}</i></span></a></div>`;
  }

  const withHours = logs.filter((l) => Number(l.hours_played) > 0);
  let hoursBody = '<p class="ps-empty">No hours logged yet.</p>';
  if (withHours.length) {
    const most = withHours.reduce((a, b) => (Number(b.hours_played) > Number(a.hours_played) ? b : a));
    const avg = Math.round(withHours.reduce((s, l) => s + Number(l.hours_played), 0) / withHours.length);
    hoursBody = `
      <div class="ps-pair"><div class="ps-big"><b>${num(stats.totalHours)}</b>hrs</div><div class="ps-big"><b>${num(avg)}</b>hrs avg</div></div>
      <div class="ps-note ps-note--below">Most played: ${esc(most.games?.title || 'Unknown')}, ${num(Math.round(Number(most.hours_played)))} hrs</div>`;
  }

  const activityBlock = SHOW_ACTIVITY_BOX ? `
      <div class="ps-years" role="group" aria-label="Show">
        ${[['year', 'This year'], ['last', 'Last'], ['all', 'All']].map(([k, label]) => `<button type="button" data-ps-period="${k}" aria-pressed="${k === period}">${label}</button>`).join('')}
      </div>
      <a href="${base}/completed" class="ps-row" id="ps-completed"><span class="ps-row__l">Completed</span><span class="ps-row__r">${completedValue(period, stats, lastYear)}</span></a>
      <a href="${base}/logged" class="ps-row"><span class="ps-row__l">Logged</span><span class="ps-row__r"><b>${num(stats.logged)}</b></span></a>
      ${box('Activity', `<span id="ps-amut">${periodNote(period)}</span>`, `<div id="ps-act-slot">${activityHtml(diary, period)}</div>`)}` : '';
  return `
    <div class="ps-stack">
      ${activityBlock}
      ${lower}
      ${SHOW_HOURS ? box('Hours', '', hoursBody) : ''}
      ${SHOW_ACTIVITY_BOTTOM && !SHOW_ACTIVITY_BOX ? box('Activity', `<span id="ps-amut">${periodNote(period)}</span>`, `<div id="ps-act-slot">${activityHtml(diary, period)}</div>`) : ''}
    </div>`;
}

// The Backlog bar: how many games are waiting and (on your own profile) Pick for me, which
// turns the "?" slot into the picked game without growing the box.
export function backlogBarHtml(profile, logs, isOwn) {
  const n = logs.filter((l) => l.status === 'backlog' && l.games).length;
  if (!n || !isOwn) return ''; // someone else's backlog is just their posters, no box
  return `<div class="ps-box">
    <div class="ps-split bl-bar">
      ${isOwn ? '<div class="bl-slot" id="bl-slot"><span>?</span></div>' : ''}
      <div class="bl-main" id="bl-main">
        <div class="bl-line"><b>${num(n)}</b> game${n === 1 ? '' : 's'} waiting for ${isOwn ? 'you' : 'me'}...</div>
      </div>
      ${isOwn ? '<button type="button" class="ps-pill" id="ps-pick">Pick for me</button>' : ''}
    </div></div>`;
}

export function wireBacklogBar(container, logs, isOwn) {
  if (!isOwn) return;
  const backlog = logs.filter((l) => l.status === 'backlog' && l.games);
  const slot = qs('#bl-slot', container);
  const main = qs('#bl-main', container);
  const btn = qs('#ps-pick', container);
  if (!slot || !main || !btn) return;
  let last = -1;
  btn.addEventListener('click', () => {
    if (!backlog.length) return;
    let i = Math.floor(Math.random() * backlog.length);
    if (backlog.length > 1 && i === last) i = (i + 1) % backlog.length;
    last = i;
    const g = backlog[i].games;
    slot.innerHTML = `<a href="#/game/${g.id}" aria-label="${esc(g.title)}">${posterFrame(g.cover_url, g.title, 'bl-slot__img')}</a>`;
    slot.classList.add('bl-slot--on');
    // Name first, then the release year at once; the director joins it the moment the lookup lands
    // (the credits are cached on the game after the first look, so repeats are instant).
    const year = g.release_year ? String(g.release_year) : '';
    const line = (who) => [year, who].filter(Boolean).join(' · ');
    main.innerHTML = `<a href="#/game/${g.id}" class="bl-name">${esc(g.title)}</a><div class="bl-meta" id="bl-meta">${esc(line(''))}</div>`;
    btn.textContent = 'Again';
    const mine = i;
    api.getGameCastAndDirector(g).then((c) => {
      const who = c?.director?.name || g.developer;
      const meta = qs('#bl-meta', container);
      if (who && meta && last === mine) meta.textContent = line(who);
    }).catch(() => {});
  });
}

function tasteHtml(logs) {
  const genres = topGenres(logs, 6);
  const gMax = genres.length ? genres[0][1] : 1;
  return box('Taste', 'top genres', genres.length
    ? genres.map(([name, n], i) => `
        <div class="ps-hbar${i === 0 ? ' ps-hbar--top' : ''}">
          <span>${esc(name)}</span>
          <div class="ps-track"><div class="ps-fill" style="width:${(n / gMax) * 100}%"></div></div>
          <span class="ps-n">${n}</span>
        </div>`).join('')
    : '<p class="ps-empty">Log a few games and your top genres show here.</p>');
}

function likesHtml(logs) {
  const liked = logs.filter((l) => l.loved && l.games);
  if (!liked.length) return box('Likes', '', '<p class="ps-empty">No liked games yet. Tap the heart on a game you love.</p>');
  return box('Likes', `${num(liked.length)} games`, `
    <div class="ps-grid">${liked.map((l) => `
      <a href="#/game/${l.games.id}" class="ps-grid__item" aria-label="${esc(l.games.title)}">${posterFrame(l.games.cover_url, l.games.title, 'ps-grid__img')}</a>`).join('')}
    </div>`);
}

export function profileStatsHtml({ profile, logs, stats, isOwn }) {
  const base = `#/profile/${esc(profile.username)}/log-list`;
  const genres = topGenres(logs, 1);
  const likes = logs.filter((l) => l.loved).length;
  const reviews = logs.filter((l) => l.review).length;
  const backlog = logs.filter((l) => l.status === 'backlog').length;
  const diary = logs.filter((l) => l.status === 'played' || l.status === 'dropped').length;
  const tile = (inner, label, attrs) => `<${attrs.tag} class="ps-tile" ${attrs.attr}><b>${inner}</b><span>${label}</span></${attrs.tag}>`;
  return `
    <div class="ps-wrap" id="ps-wrap">
      ${rowsHtml(profile, logs, isOwn)}
      ${SHOW_TILES ? `<div class="ps-tiles">
        ${tile(num(stats.logged), 'Games', { tag: 'a', attr: `href="${base}/logged"` })}
        ${tile(num(diary), 'Diary', { tag: 'button', attr: 'type="button" data-jump-tab="journal"' })}
        ${tile(num(reviews), 'Reviews', { tag: 'a', attr: `href="${base}/reviews"` })}
        ${tile(num(backlog), 'Backlog', { tag: 'button', attr: 'type="button" data-jump-tab="wanttoplay"' })}
        ${tile(num(likes), 'Likes', { tag: 'button', attr: 'type="button" data-ps-open="likes"' })}
        ${tile(esc(genres[0]?.[0] || '—'), 'Taste', { tag: 'button', attr: 'type="button" data-ps-open="taste"' })}
      </div>
      <div class="ps-bar"><span class="ps-cur" id="ps-cur">Stats</span><button type="button" class="ps-back" id="ps-back" hidden>Back to stats</button></div>` : ''}
      <div id="ps-panel">${statsPanelHtml({ profile, logs, stats, isOwn, diary: logs.filter((l) => (l.status === 'played' || l.status === 'dropped') && playedKind(l, profile.created_at) === 'diary'), lastYear: 0 }, 'year')}</div>
    </div>`;
}

export function wireProfileStats(container, { profile, logs, stats, isOwn }) {
  const wrap = qs('#ps-wrap', container);
  if (!wrap) return;
  // On your own profile, Activity opens your notifications on the You tab.
  wrap.addEventListener('click', (e) => {
    const a = e.target.closest('[data-open-notif]');
    if (!a) return;
    e.preventDefault();
    openNotificationsOn(a.dataset.openNotif);
  });
  const diary = logs.filter((l) => (l.status === 'played' || l.status === 'dropped') && playedKind(l, profile.created_at) === 'diary');
  const lastYear = diary.filter((l) => l.played_date && new Date(l.played_date).getFullYear() === new Date().getFullYear() - 1).length;
  const ctx = { profile, logs, stats, isOwn, diary, lastYear };
  const panel = qs('#ps-panel', wrap);
  const cur = qs('#ps-cur', wrap);
  const back = qs('#ps-back', wrap);
  let period = 'year';

  function showStats() {
    cur.textContent = 'Stats';
    back.hidden = true;
    panel.innerHTML = statsPanelHtml(ctx, period);
    wireStats();
  }

  function wireStats() {
    // The Completed row and Activity follow the This year / Last / All switch.
    qsa('[data-ps-period]', panel).forEach((btn) => {
      btn.addEventListener('click', () => {
        period = btn.dataset.psPeriod;
        qsa('[data-ps-period]', panel).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        qs('#ps-completed .ps-row__r', panel).innerHTML = completedValue(period, stats, lastYear);
        qs('#ps-act-slot', panel).innerHTML = activityHtml(diary, period);
        qs('#ps-amut', panel).textContent = periodNote(period);
      });
    });

    // Activity: press and hold, slide sideways, let go. The box stretches a
    // little at the top while held, to make room for the count above the bar.
    const slot = qs('#ps-act-slot', panel);
    let held = null;
    const barAt = (act, x) => {
      const bars = qsa('.ps-ab', act);
      const a = bars[0].getBoundingClientRect();
      const b = bars[bars.length - 1].getBoundingClientRect();
      return Math.max(0, Math.min(bars.length - 1, Math.floor((x - a.left) / ((b.right - a.left) / bars.length))));
    };
    const paint = (act, k) => {
      act.classList.toggle('ps-act--holding', k > -1);
      qsa('.ps-ab', act).forEach((bar, i) => bar.classList.toggle('ps-ab--on', i === k));
      qsa('.ps-alab span', act).forEach((s, i) => s.classList.toggle('ps-on', i === k));
      const label = qs('#ps-amut', panel);
      if (label) label.textContent = k > -1 ? `${MONTHS[k]}${act.dataset.period === 'all' ? ' (all years)' : ''}` : periodNote(act.dataset.period);
    };
    slot?.addEventListener('pointerdown', (e) => {
      const act = e.target.closest('.ps-act');
      if (!act) return;
      held = act;
      try { slot.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
      paint(act, barAt(act, e.clientX));
    });
    slot?.addEventListener('pointermove', (e) => { if (held) paint(held, barAt(held, e.clientX)); });
    const release = () => { if (!held) return; const act = held; held = null; paint(act, -1); };
    slot?.addEventListener('pointerup', release);
    slot?.addEventListener('pointercancel', release);
    slot?.addEventListener('lostpointercapture', release);

    if (isOwn) return;

    // Someone else's profile: Compare is a plain row; the page behind it loads its own data.
  }

  // Likes and Taste open in place; Back to stats returns.
  qsa('[data-ps-open]', wrap).forEach((btn) => {
    btn.addEventListener('click', () => {
      const which = btn.dataset.psOpen;
      cur.textContent = which === 'likes' ? 'Likes' : 'Taste';
      back.hidden = false;
      panel.innerHTML = which === 'likes' ? likesHtml(logs) : tasteHtml(logs);
    });
  });
  back?.addEventListener('click', showStats);

  wireStats();
}
