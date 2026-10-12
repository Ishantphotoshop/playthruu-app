// ============================================================
// HOME + INSIGHTS
// ============================================================
// Home answers "what needs me right now?" first (open reports, news waiting
// for review, new players), then the live numbers, the growth chart and a
// feed of what just happened. The heavier analytics (bars, ratings, top
// games and players) live one tap away on Insights.

import {
  supabase, state, SCREENS, REFRESH, hooks, paint, header, qs, qsa, stillOn, go, esc, fmtNum, ago,
  displayName, avatarImg, onRow, item, group, poster, chipIcon, pill, chev, sectionHead, emptyBlock,
  ONLINE_WINDOW_MS, setBadge, touch, skeletonRows,
} from '../core.js';
import { countUp, skeletonPanel } from '../toolkit.js';
import { stockChart, wireStockChart } from '../chart.js';
import { ratingHistogram, wireRatingHistogram } from '../../js/components.js';
import { icons } from './icons.js';

const DAY = 86400000;
const METRICS = [
  { id: 'players', label: 'Players', title: 'Total players' },
  { id: 'logs', label: 'Logs', title: 'Total logs' },
  { id: 'reviews', label: 'Reviews', title: 'Total reviews' },
];
let chartMetric = 'players';
let chartHandle = null;
let homeTimer = null;
let latest = { profiles: [], logs: [] };

// ------------------------------------------------------------ HOME
SCREENS.home = function home() {
  const name = (state.profile?.display_name || state.profile?.username || '').split(' ')[0] || 'there';
  paint(`
    ${header('PlayThruu')}
    <main class="view-body">
      <div class="adm-hello">
        <div class="adm-hello__text">
          <span class="adm-hello__hi">Hey ${esc(name)}</span>
          <span class="adm-hello__sub" id="hello-sub">Checking what needs you…</span>
        </div>
        <button class="adm-live" id="live-now" aria-label="Who is online">
          <i aria-hidden="true"></i><b id="online-n">–</b><span>online</span>
        </button>
      </div>

      <div id="attention">${skeletonRows(3, { thumb: false })}</div>

      <div class="adm-quick-row" role="group" aria-label="Quick actions">
        <button class="adm-quick" data-q="feature">${icons.flame()}<span>Feature a game</span></button>
        <button class="adm-quick" data-q="banner">${icons.megaphone()}<span>Post a banner</span></button>
        <button class="adm-quick" data-q="news">${icons.news()}<span>Review news</span></button>
        <button class="adm-quick" data-q="people">${icons.people()}<span>Find someone</span></button>
      </div>

      ${sectionHead('Overview', { link: 'insights', linkText: 'Insights' })}
      <div class="adm-stats" id="stats"></div>
      <div class="adm-panel adm-panel--chart" id="chart-panel">${skeletonPanel()}</div>

      ${sectionHead('Latest')}
      <div id="latest">${skeletonRows(5)}</div>

      <p class="adm-foot">Live production data. <span id="last-sync"></span></p>
    </main>`);

  qs('#live-now').addEventListener('click', () => go('people?filter=online'));
  qsa('[data-q]').forEach((b) => b.addEventListener('click', () => {
    const q = b.dataset.q;
    if (q === 'feature') { go('trending'); setTimeout(() => hooks.openGamePicker?.(), 80); }
    else if (q === 'banner') go('announce');
    else if (q === 'news') go('news?tab=review');
    else if (q === 'people') hooks.openSearch?.();
  }));

  loadHome();
  clearInterval(homeTimer);
  homeTimer = setInterval(() => {
    if (state.screen === 'home' && document.visibilityState === 'visible') loadHome({ quiet: true });
  }, 60000);
};
REFRESH.home = (opts = {}) => loadHome(opts);

// Counts that never need the big row downloads. Also what the Inbox badge uses.
export async function loadAttentionCounts() {
  const day = new Date(Date.now() - DAY).toISOString();
  const head = (q) => q.then((r) => (r.error ? 0 : r.count || 0));
  const [reports, review, flagged, joined] = await Promise.all([
    head(supabase.from('reports').select('id', { count: 'exact', head: true }).in('status', ['open', 'reviewed'])),
    head(supabase.from('news_articles').select('id', { count: 'exact', head: true }).eq('status', 'review')),
    head(supabase.from('news_articles').select('id', { count: 'exact', head: true }).or('flagged_incorrect.eq.true,needs_update.eq.true')),
    head(supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', day)),
  ]);
  state.openReports = reports;
  setBadge('inbox', reports + review);
  return { reports, review, flagged, joined };
}

async function loadHome({ quiet = false } = {}) {
  const screen = state.screen;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  const [profilesRes, logsRes, gamesCountRes, onlineRes, todayRes, counts, reportsRes, commentsRes] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, avatar_url, created_at').order('created_at', { ascending: false }).limit(5000),
    supabase.from('logs').select('id, user_id, game_id, status, rating, review, loved, created_at').order('created_at', { ascending: false }).limit(20000),
    supabase.from('games').select('id', { count: 'exact', head: true }),
    supabase.from('user_presence').select('user_id', { count: 'exact', head: true }).gte('last_seen_at', iso(now - ONLINE_WINDOW_MS)),
    supabase.from('user_presence').select('user_id', { count: 'exact', head: true }).gte('last_seen_at', iso(now - DAY)),
    loadAttentionCounts(),
    supabase.from('reports').select('id, reason, target_type, created_at, reporter_id').order('created_at', { ascending: false }).limit(4),
    supabase.from('comments').select('id, body, created_at, user_id').order('created_at', { ascending: false }).limit(4),
  ]);
  if (!stillOn(screen)) return;

  const profiles = profilesRes.data || [];
  const logs = logsRes.data || [];
  const online = onlineRes.count || 0;
  const activeToday = todayRes.count || 0;
  const byUser = Object.fromEntries(profiles.map((p) => [p.id, p]));
  latest = { profiles, logs };

  // ---- hello line + live badge
  const need = counts.reports + counts.review + counts.flagged;
  const sub = qs('#hello-sub');
  if (sub) sub.textContent = need ? `${need} ${need === 1 ? 'thing needs' : 'things need'} you` : 'All clear. Nothing waiting.';
  const onlineEl = qs('#online-n');
  if (onlineEl) onlineEl.textContent = String(online);
  qs('#live-now')?.classList.toggle('adm-live--on', online > 0);

  // ---- needs attention
  const att = [
    { n: counts.reports, title: 'Open reports', sub: 'People flagged something', icon: icons.flag(), tone: 'bad', to: 'reports' },
    { n: counts.review, title: 'News to review', sub: 'Waiting in the review queue', icon: icons.news(), tone: 'warn', to: 'news?tab=review' },
    { n: counts.flagged, title: 'Flagged stories', sub: 'Marked incorrect or needing an update', icon: icons.news(), tone: 'warn', to: 'news?tab=flagged' },
    { n: counts.joined, title: 'New players today', sub: 'Joined in the last 24 hours', icon: icons.people(), tone: 'info', to: 'people?sort=new' },
  ].filter((a) => a.n > 0);
  const host = qs('#attention');
  if (host) {
    host.innerHTML = att.length
      ? group(att.map((a) => item({
        id: a.to, cls: 'adm-item--link', attrs: `data-to="${esc(a.to)}"`,
        lead: chipIcon(a.icon, a.tone), title: esc(a.title), meta: esc(a.sub),
        trail: `<span class="adm-count adm-count--${a.tone}">${fmtNum(a.n)}</span>${chev()}`,
      })).join(''))
      : `<div class="adm-clear"><span class="adm-clear__icon">${icons.check()}</span><div><b>All clear</b><small>No open reports, nothing waiting for review.</small></div></div>`;
    onRow(host, '.adm-item', (row) => go(row.dataset.to));
  }

  // ---- stat tiles
  const logs7 = logs.filter((l) => now - new Date(l.created_at).getTime() < 7 * DAY).length;
  const newPlayers7 = profiles.filter((p) => now - new Date(p.created_at).getTime() < 7 * DAY).length;
  const reviews = logs.filter((l) => l.review).length;
  const priorWeek = (pred) => {
    const inLast = logs.filter((l) => now - new Date(l.created_at).getTime() < 7 * DAY).filter(pred).length;
    const inPrev = logs.filter((l) => { const a = now - new Date(l.created_at).getTime(); return a >= 7 * DAY && a < 14 * DAY; }).filter(pred).length;
    return inPrev === 0 ? (inLast ? 100 : 0) : Math.round(((inLast - inPrev) / inPrev) * 100);
  };
  const trend = (pct) => (!pct ? '' : `<i class="adm-trend adm-trend--${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}%</i>`);
  const tile = (value, label, { metric = '', t = '', green = false } = {}) => `
    <div class="adm-stat${green ? ' adm-stat--green' : ''}${metric ? ' adm-stat--tap' : ''}"${metric ? ` data-metric="${metric}" role="button" tabindex="0"` : ''}>
      <b data-count="${value ?? ''}">–</b><span>${label}${t}</span>
    </div>`;
  const stats = qs('#stats');
  if (stats) {
    stats.innerHTML =
      tile(online, 'Online', { green: true }) + tile(activeToday, 'Active 24h') + tile(profiles.length, 'Players', { metric: 'players' })
      + tile(newPlayers7, 'New / 7d') + tile(logs.length, 'Logs', { metric: 'logs', t: trend(priorWeek(() => true)) })
      + tile(reviews, 'Reviews', { metric: 'reviews', t: trend(priorWeek((l) => !!l.review)) });
    qsa('[data-count]', stats).forEach((el) => {
      const raw = el.dataset.count;
      if (raw === '') { el.textContent = '–'; return; }
      if (quiet) el.textContent = fmtNum(Number(raw)); else countUp(el, Number(raw), { format: fmtNum });
    });
    const pick = (m) => { chartMetric = m; paintChart(); };
    qsa('[data-metric]', stats).forEach((el) => {
      el.addEventListener('click', () => pick(el.dataset.metric));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(el.dataset.metric); } });
    });
  }

  // ---- growth chart: cumulative daily series, built once per metric
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function cumulativeDaily(rows) {
    const times = rows.map((r) => new Date(r.created_at).getTime()).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
    if (!times.length) return [];
    const last = startOfDay(now);
    const from = Math.max(startOfDay(times[0]), last - 730 * DAY);
    const out = [];
    let i = 0;
    let running = times.filter((t) => t < from).length;
    for (let d = from; d <= last; d += DAY) {
      const end = d + DAY;
      while (i < times.length && times[i] < end) { if (times[i] >= from) running += 1; i += 1; }
      out.push({ t: d, value: running });
    }
    return out;
  }
  const series = {
    players: cumulativeDaily(profiles),
    logs: cumulativeDaily(logs),
    reviews: cumulativeDaily(logs.filter((l) => l.review)),
  };
  function paintChart() {
    const box = qs('#chart-panel');
    if (!box) return;
    const metric = METRICS.find((m) => m.id === chartMetric) || METRICS[0];
    const keepRange = chartHandle?.range;
    box.innerHTML = `
      <div class="adm-metric-tabs" role="tablist">
        ${METRICS.map((m) => `<button class="adm-chip${m.id === metric.id ? ' adm-chip--on' : ''}" role="tab" aria-selected="${m.id === metric.id}" data-metric-tab="${m.id}">${esc(m.label)}</button>`).join('')}
      </div>
      ${stockChart('main', { title: metric.title, series: series[metric.id] })}`;
    chartHandle = wireStockChart(qs('.sc', box), { series: series[metric.id], format: (v) => fmtNum(v), defaultRange: keepRange || '1m' });
    qsa('[data-metric-tab]', box).forEach((b) => b.addEventListener('click', () => { chartMetric = b.dataset.metricTab; paintChart(); }));
  }
  paintChart();

  // ---- latest: what just happened, newest first
  const gameIds = [...new Set(logs.filter((l) => l.review).slice(0, 4).map((l) => l.game_id).filter(Boolean))];
  let games = {};
  if (gameIds.length) {
    const { data } = await supabase.from('games').select('id, title, cover_url').in('id', gameIds);
    games = Object.fromEntries((data || []).map((g) => [g.id, g]));
    if (!stillOn(screen)) return;
  }
  const events = [];
  profiles.slice(0, 4).forEach((p) => events.push({ at: p.created_at, tone: 'info', icon: icons.people(), title: `${esc(displayName(p))} joined`, meta: `@${esc(p.username)}`, run: () => hooks.openUser?.(p.id) }));
  logs.filter((l) => l.review).slice(0, 4).forEach((l) => {
    const g = games[l.game_id];
    events.push({ at: l.created_at, tone: 'ok', icon: icons.review(), title: `${esc(displayName(byUser[l.user_id]))} reviewed ${esc(g?.title || 'a game')}`, meta: l.rating ? `${l.rating} stars` : 'review', run: () => hooks.openLog?.(l.id) });
  });
  (reportsRes.data || []).forEach((r) => events.push({ at: r.created_at, tone: 'bad', icon: icons.flag(), title: `Report: ${esc(r.reason || 'no reason given')}`, meta: `by ${esc(displayName(byUser[r.reporter_id]))}`, run: () => hooks.openReport?.(r.id) }));
  (commentsRes.data || []).forEach((c) => events.push({ at: c.created_at, tone: 'muted', icon: icons.comment(), title: `${esc(displayName(byUser[c.user_id]))} commented`, meta: esc(String(c.body || '').slice(0, 70)), run: () => hooks.openComment?.(c.id) }));
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  const feed = qs('#latest');
  if (feed) {
    const shown = events.slice(0, 8);
    feed.innerHTML = shown.length
      ? group(shown.map((e, i) => item({
        id: String(i), lead: chipIcon(e.icon, e.tone), title: e.title, meta: `${e.meta} · ${ago(e.at)}`, trail: chev(),
      })).join(''))
      : emptyBlock('Nothing has happened yet.');
    onRow(feed, '.adm-item', (row) => shown[Number(row.dataset.id)]?.run());
  }

  const syncEl = qs('#last-sync');
  if (syncEl) syncEl.textContent = `Last read ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
  touch(screen);
}

// ------------------------------------------------------------ INSIGHTS
SCREENS.insights = function insights() {
  paint(`
    ${header('Insights')}
    <main class="view-body">
      <div id="analytics">${skeletonPanel()}</div>
    </main>`);
  loadInsights();
};
REFRESH.insights = () => loadInsights();

function barSeries(bars) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return `<div class="adm-bars" role="img" aria-label="Recent activity">
    ${bars.map((b, i) => `
      <div class="adm-bars__col" data-label="${esc(b.label)}" data-value="${b.value}">
        <div class="adm-bars__bar${i === bars.length - 1 ? ' adm-bars__bar--today' : ''}" style="height:${b.value === 0 ? 2 : Math.max(6, Math.round((b.value / max) * 100))}%"></div>
      </div>`).join('')}
  </div>`;
}

function segBar(segments) {
  const shown = segments.filter((s) => s.value > 0);
  const total = shown.reduce((a, s) => a + s.value, 0) || 1;
  return `
    <div class="adm-segbar">${shown.map((s) => `<span class="adm-segbar__seg" style="width:${(s.value / total * 100).toFixed(1)}%;background:${s.color}"></span>`).join('')}</div>
    <div class="adm-legend">${segments.map((s) => `<span class="adm-legend__item"><span class="adm-legend__dot" style="background:${s.color}"></span>${esc(s.label)} <b>${s.value}</b></span>`).join('')}</div>`;
}

function wireBars(scope) {
  qsa('.adm-bars', scope).forEach((bars) => {
    const readout = document.createElement('div');
    readout.className = 'adm-bars__readout';
    readout.innerHTML = '<span></span>';
    bars.parentElement.insertBefore(readout, bars);
    const cols = qsa('.adm-bars__col', bars);
    const show = (col) => {
      cols.forEach((c) => c.classList.toggle('adm-bars__col--on', c === col));
      readout.firstElementChild.textContent = col ? `${col.dataset.label} · ${col.dataset.value}` : '';
      readout.classList.toggle('adm-bars__readout--on', !!col);
    };
    cols.forEach((col) => { col.addEventListener('pointerenter', () => show(col)); col.addEventListener('click', () => show(col)); });
    bars.addEventListener('pointerleave', () => show(null));
  });
}

async function loadInsights() {
  const screen = state.screen;
  const now = Date.now();
  const [profilesRes, logsRes] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, avatar_url').limit(5000),
    supabase.from('logs').select('id, user_id, game_id, status, rating, review, loved, created_at').limit(20000),
  ]);
  if (!stillOn(screen)) return;
  const profiles = profilesRes.data || [];
  const logs = logsRes.data || [];

  const days = 14;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const activityBars = [];
  for (let d = days - 1; d >= 0; d--) {
    const from = startOfToday.getTime() - d * DAY;
    const count = logs.filter((l) => { const t = new Date(l.created_at).getTime(); return t >= from && t < from + DAY; }).length;
    activityBars.push({ value: count, label: new Date(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
  }
  const logs7 = logs.filter((l) => now - new Date(l.created_at).getTime() < 7 * DAY).length;

  const statusColor = { playing: 'var(--accent-bright)', played: 'var(--coral)', backlog: 'var(--ink-faint)', dropped: 'var(--violet)' };
  const statusSeg = ['playing', 'played', 'backlog', 'dropped'].map((s) => ({ label: s[0].toUpperCase() + s.slice(1), value: logs.filter((l) => l.status === s).length, color: statusColor[s] }));

  const ratingCounts = {};
  let ratingTotal = 0; let ratingSum = 0;
  logs.forEach((l) => {
    if (!l.rating) return;
    const key = Number(l.rating).toFixed(1);
    ratingCounts[key] = (ratingCounts[key] || 0) + 1; ratingTotal += 1; ratingSum += Number(l.rating);
  });
  const avgRating = ratingTotal ? ratingSum / ratingTotal : null;

  const gameCounts = {};
  logs.forEach((l) => { if (l.game_id) gameCounts[l.game_id] = (gameCounts[l.game_id] || 0) + 1; });
  const topGameIds = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  let topGames = [];
  if (topGameIds.length) {
    const { data: gs } = await supabase.from('games').select('id, title, cover_url').in('id', topGameIds.map((g) => g[0]));
    const byId = Object.fromEntries((gs || []).map((g) => [g.id, g]));
    topGames = topGameIds.map(([gid, n]) => ({ game: byId[gid], count: n })).filter((r) => r.game);
    if (!stillOn(screen)) return;
  }

  const playerCounts = {};
  logs.forEach((l) => { if (l.user_id) playerCounts[l.user_id] = (playerCounts[l.user_id] || 0) + 1; });
  const byUser = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const topPlayers = Object.entries(playerCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([uid, n]) => ({ profile: byUser[uid], count: n })).filter((r) => r.profile);
  const topMax = Math.max(1, ...topPlayers.map((p) => p.count));

  const panel = (title, meta, body) => `
    <div class="adm-panel">
      <div class="adm-panel__head"><span class="adm-panel__title">${esc(title)}</span>${meta ? `<span class="adm-panel__meta">${meta}</span>` : ''}</div>
      ${body}
    </div>`;

  const host = qs('#analytics');
  if (!host) return;
  host.innerHTML = `
    ${panel('Activity, 14 days', `${logs7} this week`, `${barSeries(activityBars)}<div class="adm-axis"><span>${esc(activityBars[0].label)}</span><span>today</span></div>`)}
    ${panel('Library status', `${logs.length} logs`, logs.length ? segBar(statusSeg) : '<p class="adm-hint">No logs yet.</p>')}
    ${panel('Ratings', '', ratingHistogram(ratingCounts, { average: avgRating, total: ratingTotal }))}
    ${topGames.length ? panel('Top games', 'by logs', `<div class="adm-rank">${topGames.map((r, i) => `
      <button class="adm-rank__row" data-game="${esc(r.game.id)}">
        <span class="adm-rank__n">${i + 1}</span>${poster(r.game.cover_url, 'adm-rank__poster')}
        <span class="adm-rank__name">${esc(r.game.title)}</span><span class="adm-rank__val">${r.count}</span>
      </button>`).join('')}</div>`) : ''}
    ${topPlayers.length ? panel('Most active', 'by logs', `<div class="adm-rank">${topPlayers.map((r, i) => `
      <button class="adm-rank__row" data-user="${esc(r.profile.id)}">
        <span class="adm-rank__n">${i + 1}</span>${avatarImg(r.profile, 28)}
        <span class="adm-rank__name">${esc(displayName(r.profile))}<i>@${esc(r.profile.username)}</i></span>
        <span class="adm-rank__bar"><span class="adm-rank__fill" style="width:${Math.round(r.count / topMax * 100)}%"></span></span>
        <span class="adm-rank__val">${r.count}</span>
      </button>`).join('')}</div>`) : ''}`;

  const hist = qs('.rating-histogram', host);
  if (hist) wireRatingHistogram(hist);
  wireBars(host);
  qsa('[data-game]', host).forEach((b) => b.addEventListener('click', () => hooks.openGame?.(b.dataset.game)));
  qsa('[data-user]', host).forEach((b) => b.addEventListener('click', () => hooks.openUser?.(b.dataset.user)));
  touch(screen);
}
