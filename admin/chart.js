// ============================================================
// INTERACTIVE CHART — the Stocks-app one
// ============================================================
// A scrubbable line/area chart in the shape iOS Stocks uses: a big
// headline value that is REPLACED by whatever point you're touching, a
// delta against the start of the visible range, a crosshair that tracks
// the finger, and a range selector underneath.
//
// Everything is plain SVG + pointer events, drawn through the app's own
// colour tokens, so it themes itself and ships no dependency. The only
// state it owns is which range is selected and which point (if any) is
// being scrubbed — the data itself is handed in and never mutated here.
//
// The series is a flat array of { t, value } in ascending time order,
// where `t` is a ms timestamp. Ranges slice that array rather than
// refetching, so switching between them is instant.

import { esc } from '../js/utils.js';

// Rendering geometry. The viewBox is fixed and the SVG scales to its
// container, so one set of numbers works at every screen width.
const W = 320;
const H = 132;
const PAD_X = 4;
const PAD_TOP = 10;
const PAD_BOTTOM = 10;

export const RANGES = [
  { id: '7d', label: '1W', days: 7 },
  { id: '1m', label: '1M', days: 30 },
  { id: '3m', label: '3M', days: 90 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'ALL', days: Infinity },
];

const niceDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const shortDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Catmull-Rom through the points, converted to cubic béziers. A plain
// polyline reads as jagged at this size, and a naive quadratic smoothing
// overshoots on spiky data — this passes exactly through every point
// while still curving, which matters when the number under the crosshair
// has to match the pixel the finger is on.
function smoothPath(pts) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    // 1/6 is the standard Catmull-Rom-to-bezier tension.
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function sliceToRange(series, range) {
  if (!series.length || range.days === Infinity) return series;
  const cutoff = Date.now() - range.days * 86400000;
  const within = series.filter((p) => p.t >= cutoff);
  // Always keep at least a couple of points so a young account with one
  // week of history doesn't render an empty 1Y tab.
  return within.length >= 2 ? within : series.slice(-2);
}

function project(points) {
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; } // a flat line sits in the middle
  const span = max - min;
  const x = (i) => PAD_X + (points.length === 1 ? 0.5 : i / (points.length - 1)) * (W - PAD_X * 2);
  const y = (v) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOTTOM);
  return { xy: points.map((p, i) => ({ x: x(i), y: y(p.value), ...p })), min, max };
}

// `id` namespaces the SVG gradient — two charts on one page sharing a
// gradient id would both take whichever was defined last.
export function stockChart(id, { title, series, format = (v) => v, unit = '' }) {
  return `
    <div class="sc" data-chart="${esc(id)}">
      <div class="sc__head">
        <div class="sc__headline">
          <span class="sc__title">${esc(title)}</span>
          <span class="sc__value" data-sc-value>—</span>
          <span class="sc__delta" data-sc-delta></span>
        </div>
        <span class="sc__when" data-sc-when></span>
      </div>
      <div class="sc__plot">
        <svg class="sc__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="sc-fill-${esc(id)}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" class="sc__grad-top"/>
              <stop offset="100%" class="sc__grad-bottom"/>
            </linearGradient>
          </defs>
          <path class="sc__area" data-sc-area d=""/>
          <path class="sc__line" data-sc-line d="" pathLength="1"/>
          <line class="sc__cross" data-sc-cross x1="0" y1="0" x2="0" y2="${H}"/>
          <circle class="sc__dot" data-sc-dot r="3.5" cx="0" cy="0"/>
        </svg>
        <div class="sc__scrim" data-sc-hit tabindex="0" role="slider"
             aria-label="${esc(title)} over time" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></div>
      </div>
      <div class="sc__axis">
        <span data-sc-from></span>
        <span data-sc-to></span>
      </div>
      <div class="sc__ranges" role="tablist">
        ${RANGES.map((r) => `
          <button class="sc__range" role="tab" data-sc-range="${r.id}" aria-selected="false">${r.label}</button>`).join('')}
      </div>
      <p class="sc__empty" data-sc-empty hidden>Not enough history yet.</p>
    </div>`;
}

// Brings a rendered stockChart to life. Returns a small handle so a
// caller can swap the data (switching metric) without re-rendering the
// whole panel and losing the selected range.
export function wireStockChart(root, { series, format = (v) => String(v), unit = '', defaultRange = '1m', onScrub } = {}) {
  const q = (sel) => root.querySelector(sel);
  const el = {
    value: q('[data-sc-value]'), delta: q('[data-sc-delta]'), when: q('[data-sc-when]'),
    area: q('[data-sc-area]'), line: q('[data-sc-line]'), cross: q('[data-sc-cross]'),
    dot: q('[data-sc-dot]'), hit: q('[data-sc-hit]'), from: q('[data-sc-from]'),
    to: q('[data-sc-to]'), empty: q('[data-sc-empty]'), svg: q('.sc__svg'),
  };
  const id = root.dataset.chart;
  el.area.setAttribute('fill', `url(#sc-fill-${id})`);

  let data = series || [];
  let rangeId = defaultRange;
  let pts = [];
  let scrubIndex = null;
  let lastHaptic = -1;

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function currentRange() {
    return RANGES.find((r) => r.id === rangeId) || RANGES[1];
  }

  function paint() {
    const windowed = sliceToRange(data, currentRange());
    const enough = windowed.length >= 2;
    el.empty.hidden = enough;
    el.svg.style.visibility = enough ? '' : 'hidden';
    if (!enough) { pts = []; setReadout(null); return; }

    const { xy } = project(windowed);
    pts = xy;
    const line = smoothPath(pts);
    el.line.setAttribute('d', line);
    el.area.setAttribute('d', `${line} L${pts[pts.length - 1].x.toFixed(2)},${H} L${pts[0].x.toFixed(2)},${H} Z`);
    el.from.textContent = shortDate(pts[0].t);
    el.to.textContent = shortDate(pts[pts.length - 1].t);
    el.hit.setAttribute('aria-valuemax', String(pts.length - 1));

    // A range switch animates the line in by re-running the draw
    // animation; scrubbing must never do this, so it's keyed off the
    // class rather than fired on every paint.
    if (!reduceMotion) {
      el.line.classList.remove('sc__line--draw');
      void el.line.getBoundingClientRect(); // restart the animation
      el.line.classList.add('sc__line--draw');
    }
    setReadout(null);
  }

  // index === null means "not scrubbing": show the latest point and the
  // delta across the whole visible range, which is the resting state.
  function setReadout(index) {
    if (!pts.length) {
      el.value.textContent = '—';
      el.delta.textContent = '';
      el.when.textContent = '';
      el.cross.style.opacity = '0';
      el.dot.style.opacity = '0';
      return;
    }
    const scrubbing = index !== null;
    const i = scrubbing ? Math.max(0, Math.min(pts.length - 1, index)) : pts.length - 1;
    const point = pts[i];
    const base = pts[0].value;
    const diff = point.value - base;
    const sign = diff >= 0 ? '+' : '−';

    // A percentage off a near-zero baseline is arithmetically true and
    // completely uninformative — going from 1 to 51 is "+5000%", which
    // tells you less than "+50" does. Below the floor, the absolute
    // change is shown on its own.
    const PCT_FLOOR = 5;
    const pctPart = Math.abs(base) < PCT_FLOOR
      ? ''
      : ` (${sign}${Math.abs((diff / Math.abs(base)) * 100).toFixed(1)}%)`;

    el.value.textContent = format(point.value) + unit;
    el.when.textContent = scrubbing ? niceDate(point.t) : `${niceDate(pts[0].t)} — now`;
    el.delta.textContent = `${sign}${format(Math.abs(diff))}${unit}${pctPart}`;
    el.delta.classList.toggle('sc__delta--up', diff > 0);
    el.delta.classList.toggle('sc__delta--down', diff < 0);
    el.hit.setAttribute('aria-valuenow', String(i));
    el.hit.setAttribute('aria-valuetext', `${format(point.value)}${unit} on ${niceDate(point.t)}`);

    el.cross.style.opacity = scrubbing ? '1' : '0';
    el.dot.style.opacity = scrubbing ? '1' : '0';
    if (scrubbing) {
      el.cross.setAttribute('x1', point.x); el.cross.setAttribute('x2', point.x);
      el.dot.setAttribute('cx', point.x); el.dot.setAttribute('cy', point.y);
      root.classList.add('sc--scrubbing');
      // A short tick as the crosshair crosses onto a new day is what
      // makes the gesture feel like it's catching on real points rather
      // than sliding over a picture. Guarded: most desktops have no
      // vibrate, and firing on every pointermove would buzz constantly.
      if (i !== lastHaptic) { lastHaptic = i; navigator.vibrate?.(1); }
      onScrub?.(point);
    } else {
      root.classList.remove('sc--scrubbing');
      lastHaptic = -1;
    }
  }

  // Maps a clientX onto the nearest plotted point. Uses the hit layer's
  // own box, so it stays correct however the SVG has been scaled.
  function indexAt(clientX) {
    const box = el.hit.getBoundingClientRect();
    if (!box.width || !pts.length) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    const px = PAD_X + ratio * (W - PAD_X * 2);
    let best = 0, bestD = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.x - px); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }

  let scrubbing = false;
  el.hit.addEventListener('pointerdown', (e) => {
    if (!pts.length) return;
    scrubbing = true;
    el.hit.setPointerCapture(e.pointerId);
    scrubIndex = indexAt(e.clientX);
    setReadout(scrubIndex);
  });
  el.hit.addEventListener('pointermove', (e) => {
    if (!scrubbing) return;
    e.preventDefault();
    scrubIndex = indexAt(e.clientX);
    setReadout(scrubIndex);
  });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false; scrubIndex = null;
    setReadout(null);
  };
  el.hit.addEventListener('pointerup', endScrub);
  el.hit.addEventListener('pointercancel', endScrub);
  el.hit.addEventListener('pointerleave', endScrub);

  // Keyboard scrubbing, so the chart is reachable without a pointer at
  // all — it's exposed as a slider, and these are the keys that implies.
  el.hit.addEventListener('keydown', (e) => {
    if (!pts.length) return;
    const at = scrubIndex ?? pts.length - 1;
    const step = e.shiftKey ? 7 : 1;
    let next = null;
    if (e.key === 'ArrowLeft') next = at - step;
    else if (e.key === 'ArrowRight') next = at + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = pts.length - 1;
    else if (e.key === 'Escape') { scrubIndex = null; setReadout(null); return; }
    else return;
    e.preventDefault();
    scrubIndex = Math.max(0, Math.min(pts.length - 1, next));
    setReadout(scrubIndex);
  });
  el.hit.addEventListener('blur', () => { scrubIndex = null; setReadout(null); });

  root.querySelectorAll('[data-sc-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      rangeId = btn.dataset.scRange;
      root.querySelectorAll('[data-sc-range]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      paint();
    });
  });

  const initial = root.querySelector(`[data-sc-range="${rangeId}"]`) || root.querySelector('[data-sc-range]');
  initial?.setAttribute('aria-selected', 'true');
  rangeId = initial?.dataset.scRange || rangeId;
  paint();

  return {
    setSeries(next) { data = next || []; paint(); },
    setRange(next) {
      const btn = root.querySelector(`[data-sc-range="${next}"]`);
      if (btn) btn.click();
    },
    get range() { return rangeId; },
  };
}
