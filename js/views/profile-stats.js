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
    if (!l.played_date) continue;
    const d = new Date(l.played_date);
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

  const backlogLogs = logs.filter((l) => l.status === 'backlog' && l.games);
  let lower = '';
  if (isOwn) {
    const oldest = backlogLogs.reduce((min, l) => (!min || new Date(l.created_at) < new Date(min.created_at) ? l : min), null);
    const days = oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldest.created_at)) / 86400000)) : 0;
    lower = box('Backlog', '', backlogLogs.length ? `
      <div class="ps-split">
        <div>
          <div class="ps-big"><b>${num(backlogLogs.length)}</b>waiting</div>
          <div class="ps-note ps-note--below">Oldest added ${days === 0 ? 'today' : `${num(days)} day${days === 1 ? '' : 's'} ago`}</div>
        </div>
        <button type="button" class="ps-pill" id="ps-pick">Pick for me</button>
      </div>
      <div class="ps-pick" id="ps-pick-out" hidden></div>` : '<p class="ps-empty">Nothing waiting. Add games to Want to Play and they show here.</p>');
  } else if (state.user) {
    lower = box('Compare', `you and @${esc(profile.username)}`, '<div id="ps-compare"><p class="ps-empty">Comparing…</p></div>');
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

  return `
    <div class="ps-stack">
      <div class="ps-years" role="group" aria-label="Show">
        ${[['year', 'This year'], ['last', 'Last'], ['all', 'All']].map(([k, label]) => `<button type="button" data-ps-period="${k}" aria-pressed="${k === period}">${label}</button>`).join('')}
      </div>
      <a href="${base}/completed" class="ps-row" id="ps-completed"><span class="ps-row__l">Completed</span><span class="ps-row__r">${completedValue(period, stats, lastYear)}</span></a>
      <a href="${base}/logged" class="ps-row"><span class="ps-row__l">Logged</span><span class="ps-row__r"><b>${num(stats.logged)}</b></span></a>
      ${box('Activity', `<span id="ps-amut">${periodNote(period)}</span>`, `<div id="ps-act-slot">${activityHtml(diary, period)}</div>`)}
      ${lower}
      ${box('Hours', '', hoursBody)}
    </div>`;
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
      <div class="ps-tiles">
        ${tile(num(stats.logged), 'Games', { tag: 'a', attr: `href="${base}/logged"` })}
        ${tile(num(diary), 'Diary', { tag: 'button', attr: 'type="button" data-jump-tab="journal"' })}
        ${tile(num(reviews), 'Reviews', { tag: 'a', attr: `href="${base}/reviews"` })}
        ${tile(num(backlog), 'Backlog', { tag: 'button', attr: 'type="button" data-jump-tab="wanttoplay"' })}
        ${tile(num(likes), 'Likes', { tag: 'button', attr: 'type="button" data-ps-open="likes"' })}
        ${tile(esc(genres[0]?.[0] || '—'), 'Taste', { tag: 'button', attr: 'type="button" data-ps-open="taste"' })}
      </div>
      <div class="ps-bar"><span class="ps-cur" id="ps-cur">Stats</span><button type="button" class="ps-back" id="ps-back" hidden>Back to stats</button></div>
      <div id="ps-panel">${statsPanelHtml({ profile, logs, stats, isOwn, diary: logs.filter((l) => l.status === 'played' || l.status === 'dropped'), lastYear: 0 }, 'year')}</div>
    </div>`;
}

export function wireProfileStats(container, { profile, logs, stats, isOwn }) {
  const wrap = qs('#ps-wrap', container);
  if (!wrap) return;
  const diary = logs.filter((l) => l.status === 'played' || l.status === 'dropped');
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
    slot.addEventListener('pointerdown', (e) => {
      const act = e.target.closest('.ps-act');
      if (!act) return;
      held = act;
      try { slot.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
      paint(act, barAt(act, e.clientX));
    });
    slot.addEventListener('pointermove', (e) => { if (held) paint(held, barAt(held, e.clientX)); });
    const release = () => { if (!held) return; const act = held; held = null; paint(act, -1); };
    slot.addEventListener('pointerup', release);
    slot.addEventListener('pointercancel', release);
    slot.addEventListener('lostpointercapture', release);

    if (isOwn) {
      const backlog = logs.filter((l) => l.status === 'backlog' && l.games);
      const out = qs('#ps-pick-out', panel);
      let last = -1;
      qs('#ps-pick', panel)?.addEventListener('click', () => {
        if (!backlog.length) return;
        let i = Math.floor(Math.random() * backlog.length);
        if (backlog.length > 1 && i === last) i = (i + 1) % backlog.length;
        last = i;
        const g = backlog[i].games;
        out.hidden = false;
        out.innerHTML = `
          <a href="#/game/${g.id}" class="ps-pick__link">
            <span class="ps-pick__cover">${posterFrame(g.cover_url, g.title, 'ps-pick__img')}</span>
            <span><span class="ps-note">Tonight's pick</span><span class="ps-pick__name">${esc(g.title)}</span></span>
          </a>`;
      });
      return;
    }

    // Someone else's profile: set their ratings beside yours.
    const cmp = qs('#ps-compare', panel);
    if (!cmp || !state.user) return;
    api.getLogsForUser(state.user.id, { limit: 500 }).then((mine) => {
      const theirs = new Map(logs.map((l) => [l.game_id, l]));
      const both = mine.filter((l) => theirs.has(l.game_id));
      const rated = both
        .map((l) => ({ me: Number(l.rating), they: Number(theirs.get(l.game_id).rating), game: l.games }))
        .filter((r) => r.me > 0 && r.they > 0);
      const agree = rated.filter((r) => Math.abs(r.me - r.they) <= 1).length;
      const differ = rated.length - agree;
      if (!both.length) { cmp.innerHTML = '<p class="ps-empty">No games in common yet.</p>'; return; }
      const gap = rated.reduce((best, r) => (!best || Math.abs(r.me - r.they) > Math.abs(best.me - best.they) ? r : best), null);
      const cell = (n, label) => `<div class="ps-cell"><b>${num(n)}</b><span>${label}</span></div>`;
      cmp.innerHTML = `
        <div class="ps-cells">${cell(both.length, 'In common')}${cell(agree, 'Agree')}${cell(differ, 'Differ')}</div>
        ${gap && Math.abs(gap.me - gap.they) > 1 && gap.game ? `
          <a href="#/game/${gap.game.id}" class="ps-pick__link ps-gap-link">
            <span class="ps-pick__cover">${posterFrame(gap.game.cover_url, gap.game.title, 'ps-pick__img')}</span>
            <span class="ps-gap__text">Biggest gap: <b>${esc(gap.game.title)}</b><br>You gave it ${gap.me} star${gap.me === 1 ? '' : 's'}, they gave it ${gap.they}.</span>
          </a>` : ''}`;
    }).catch(() => { cmp.innerHTML = '<p class="ps-empty">Could not compare right now.</p>'; });
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
  back.addEventListener('click', showStats);

  wireStats();
}
