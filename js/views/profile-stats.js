import * as api from '../api.js';
import { state } from '../state.js';
import { esc, qs, qsa } from '../utils.js';
import { posterFrame } from '../components.js';

// The area under the Ratings box on a profile: the headline counts, then one
// box each for Taste, Activity, Backlog (your own profile) or Compare (someone
// else's) and Hours. Everything is worked out from the logs the profile has
// already loaded, so nothing here costs another round trip except Compare,
// which needs the viewer's own logs.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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

// Logs per calendar month for the last 12 months, oldest first.
function monthBins(logs) {
  const now = new Date();
  const bins = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    bins.push({ y: d.getFullYear(), m: d.getMonth(), n: 0 });
  }
  for (const l of logs) {
    const raw = l.played_date || l.created_at;
    if (!raw) continue;
    const d = new Date(raw);
    const bin = bins.find((b) => b.y === d.getFullYear() && b.m === d.getMonth());
    if (bin) bin.n += 1;
  }
  return bins;
}

const box = (title, right, body) => `
  <div class="ps-box">
    <div class="ps-head"><span class="ps-title">${title}</span>${right ? `<span class="ps-note">${right}</span>` : ''}</div>
    ${body}
  </div>`;

function completedValue(period, stats, lastYear) {
  if (period === 'last') return `<b>${num(lastYear)}<span class="stat-link__year">/${new Date().getFullYear() - 1}</span></b>`;
  if (period === 'all') return `<b>${num(stats.totalPlayed)}</b>`;
  return `<b>${num(stats.totalPlayed)}<span class="stat-link__year">/${num(stats.thisYear)}</span></b>`;
}

export function profileStatsHtml({ profile, logs, stats, isOwn }) {
  const diary = logs.filter((l) => l.status === 'played' || l.status === 'dropped');
  const lastYear = diary.filter((l) => l.played_date && new Date(l.played_date).getFullYear() === new Date().getFullYear() - 1).length;
  const base = `#/profile/${esc(profile.username)}/log-list`;

  const genres = topGenres(logs);
  const gMax = genres.length ? genres[0][1] : 1;
  const tasteBody = genres.length
    ? genres.map(([name, n], i) => `
        <div class="ps-hbar${i === 0 ? ' ps-hbar--top' : ''}">
          <span>${esc(name)}</span>
          <div class="ps-track"><div class="ps-fill" style="width:${(n / gMax) * 100}%"></div></div>
          <span class="ps-n">${n}</span>
        </div>`).join('')
    : '<p class="ps-empty">Log a few games and your top genres show here.</p>';

  const bins = monthBins(logs);
  const bMax = Math.max(1, ...bins.map((b) => b.n));
  const activityBody = `
    <div class="ps-months">${bins.map((b) => `<i class="${b.n === bMax && b.n > 0 ? 'ps-top' : ''}" style="height:${b.n === 0 ? 1 : (2 + (b.n / bMax) * 54).toFixed(1)}px" title="${MONTHS[b.m]} ${b.y}: ${b.n}"></i>`).join('')}</div>
    <div class="ps-mlab"><span>${MONTHS[bins[0].m]}</span><span>${MONTHS[bins[11].m]}</span></div>`;

  const backlogLogs = logs.filter((l) => l.status === 'backlog' && l.games);
  let lower = '';
  if (isOwn) {
    const oldest = backlogLogs.reduce((min, l) => (!min || new Date(l.created_at) < new Date(min.created_at) ? l : min), null);
    const days = oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldest.created_at)) / 86400000)) : 0;
    lower = box('Backlog', '', backlogLogs.length ? `
      <div class="ps-split">
        <div>
          <div class="ps-big"><b>${num(backlogLogs.length)}</b> waiting</div>
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
      <div class="ps-pair"><div class="ps-big"><b>${num(stats.totalHours)}</b> hrs</div><div class="ps-big"><b>${num(avg)}</b> hrs avg</div></div>
      <div class="ps-note ps-note--below">Most played: ${esc(most.games?.title || 'Unknown')}, ${num(Math.round(Number(most.hours_played)))} hrs</div>`;
  }

  return `
    <div class="ps-wrap" id="ps-wrap">
      <div class="ps-years" role="group" aria-label="Completed in">
        ${[['year', 'This year'], ['last', 'Last'], ['all', 'All']].map(([k, label]) => `<button type="button" data-ps-year="${k}" aria-pressed="${k === 'year'}">${label}</button>`).join('')}
      </div>
      <div class="stat-links stat-links--vertical ps-rows">
        <a href="${base}/completed" class="stat-link" id="ps-completed"><span>Completed</span>${completedValue('year', stats, lastYear)}</a>
        <a href="${base}/logged" class="stat-link"><span>Logged</span><b>${num(stats.logged)}</b></a>
      </div>
      ${box('Taste', 'top 4', tasteBody)}
      ${box('Activity', 'last 12 months', activityBody)}
      ${lower}
      ${box('Hours', '', hoursBody)}
    </div>`;
}

export function wireProfileStats(container, { profile, logs, stats, isOwn }) {
  const wrap = qs('#ps-wrap', container);
  if (!wrap) return;
  const diary = logs.filter((l) => l.status === 'played' || l.status === 'dropped');
  const lastYear = diary.filter((l) => l.played_date && new Date(l.played_date).getFullYear() === new Date().getFullYear() - 1).length;

  // The Completed row follows the This year / Last / All switch.
  qsa('[data-ps-year]', wrap).forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('[data-ps-year]', wrap).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      const row = qs('#ps-completed', wrap);
      row.querySelector('b').outerHTML = completedValue(btn.dataset.psYear, stats, lastYear);
    });
  });

  if (isOwn) {
    const backlog = logs.filter((l) => l.status === 'backlog' && l.games);
    const out = qs('#ps-pick-out', wrap);
    let last = -1;
    qs('#ps-pick', wrap)?.addEventListener('click', () => {
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
  const slot = qs('#ps-compare', wrap);
  if (!slot || !state.user) return;
  api.getLogsForUser(state.user.id, { limit: 500 }).then((mine) => {
    const theirs = new Map(logs.map((l) => [l.game_id, l]));
    const both = mine.filter((l) => theirs.has(l.game_id));
    const rated = both
      .map((l) => ({ me: Number(l.rating), they: Number(theirs.get(l.game_id).rating), game: l.games }))
      .filter((r) => r.me > 0 && r.they > 0);
    const agree = rated.filter((r) => Math.abs(r.me - r.they) <= 1).length;
    const differ = rated.length - agree;
    if (!both.length) {
      slot.innerHTML = '<p class="ps-empty">No games in common yet.</p>';
      return;
    }
    const gap = rated.reduce((best, r) => (!best || Math.abs(r.me - r.they) > Math.abs(best.me - best.they) ? r : best), null);
    const cell = (n, label) => `<div class="ps-cell"><b>${num(n)}</b><span>${label}</span></div>`;
    slot.innerHTML = `
      <div class="ps-cells">${cell(both.length, 'In common')}${cell(agree, 'Agree')}${cell(differ, 'Differ')}</div>
      ${gap && Math.abs(gap.me - gap.they) > 1 && gap.game ? `
        <a href="#/game/${gap.game.id}" class="ps-pick__link ps-gap">
          <span class="ps-pick__cover">${posterFrame(gap.game.cover_url, gap.game.title, 'ps-pick__img')}</span>
          <span class="ps-gap__text">Biggest gap: <b>${esc(gap.game.title)}</b><br>You gave it ${gap.me} star${gap.me === 1 ? '' : 's'}, they gave it ${gap.they}.</span>
        </a>` : ''}`;
  }).catch(() => { slot.innerHTML = '<p class="ps-empty">Could not compare right now.</p>'; });
}
