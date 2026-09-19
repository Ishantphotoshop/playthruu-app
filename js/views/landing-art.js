// The illustration language for the signed-out screens: the entry
// screen's hero and every slide of the feature tour, all drawn here as
// inline SVG.
//
// Hand-built rather than exported images, for three reasons that
// actually matter here: nothing extra to download on the one screen
// that is someone's first impression of the app, every shape recolours
// from the same handful of values (so the art can never drift away from
// the brand the way a flat PNG does), and individual parts can be
// animated — the fan breathes, the light rakes across it — which a
// picture cannot do.
//
// The vocabulary is deliberately small and repeats across every scene:
// a game case as a rounded rectangle with a spine, one warm light
// source low and to the left, a thin highlight along the lit edges, and
// the app's own accent as that light. Five slides drawn from one kit
// look like one product; five unrelated spot illustrations look like
// clip art.

// Every gradient needs an id unique to the document — several of these
// SVGs can be on screen at once (the tour cross-fades two slides mid
// transition), and duplicate ids mean the second copy silently adopts
// the first one's fill.
let uid = 0;
const nextId = () => `lpa${(uid += 1)}`;

// A five-pointed star, outer radius 10, drawn around its own centre so
// it can be dropped anywhere with a translate.
const STAR_D = 'M0,-10 L2.47,-3.40 L9.51,-3.09 L3.99,1.30 L5.88,8.09 L0,4.2 L-5.88,8.09 L-3.99,1.30 L-9.51,-3.09 L-2.47,-3.40 Z';

/**
 * One game case.
 *
 * Drawn centred on the origin and then placed, so rotation happens
 * about the middle of the case rather than a corner. The float
 * animation lives on an INNER group: a CSS transform would otherwise
 * replace the transform attribute doing the placing, and every card
 * would pile up in the top-left corner the moment the animation
 * started.
 */
function gameCase({
  x, y, rot = 0, w = 104, h = 142, from, to, spine,
  floatY = -6, dur = 7, delay = 0, opacity = 1, children = '',
}) {
  const id = nextId();
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.round(w * 0.085);
  return `
    <g transform="translate(${x} ${y}) rotate(${rot})" opacity="${opacity}">
      <g class="lp-card" style="--float-y:${floatY}px;--float-dur:${dur}s;--float-delay:${delay}s">
        <defs>
          <linearGradient id="${id}" x1="0" y1="0" x2="0.65" y2="1">
            <stop offset="0" stop-color="${from}"/>
            <stop offset="1" stop-color="${to}"/>
          </linearGradient>
        </defs>
        <rect x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="${r}" fill="url(#${id})"/>
        <!-- the spine, the one detail that makes a rounded rectangle
             read as a game case rather than a card -->
        <rect x="${-hw}" y="${-hh}" width="${Math.round(w * 0.085)}" height="${h}" rx="${Math.round(w * 0.04)}"
              fill="${spine || 'rgba(0,0,0,0.26)'}"/>
        <!-- lit edge along the top and left, shadow along the bottom -->
        <path d="M${-hw + r} ${-hh} H${hw - r} A${r} ${r} 0 0 1 ${hw} ${-hh + r}"
              fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M${-hw + r} ${hh} H${hw - r}"
              fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1.4" stroke-linecap="round"/>
        <rect x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="${r}"
              fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
        ${children}
      </g>
    </g>`;
}

// A row of stars, the same shape the app uses on a real log, at whatever
// size a scene needs. `value` is in stars and may be a half.
function starRowArt(value, { size = 1, gap = 24, colour = '#ffc247', empty = 'rgba(255,255,255,0.18)' } = {}) {
  const clip = nextId();
  return `
    <defs><clipPath id="${clip}"><rect x="-11" y="-12" width="11" height="24"/></clipPath></defs>
    ${[0, 1, 2, 3, 4].map((i) => {
      const cx = (i - 2) * gap;
      const full = value >= i + 1;
      const half = !full && value >= i + 0.5;
      return `
        <g transform="translate(${cx} 0) scale(${size})">
          <path d="${STAR_D}" fill="${full ? colour : empty}"/>
          ${half ? `<path d="${STAR_D}" fill="${colour}" clip-path="url(#${clip})"/>` : ''}
        </g>`;
    }).join('')}`;
}

// The "PLAYED" stamp from the app's own poster frames, tilted the way a
// real rubber stamp lands.
function stampArt(label = 'PLAYED', { x = 0, y = 0, rot = -7, scale = 1 } = {}) {
  const w = label.length * 9.4 + 22;
  return `
    <g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">
      <rect x="${-w / 2}" y="-14" width="${w}" height="28" rx="6"
            fill="rgba(10,6,4,0.42)" stroke="#ff9a5c" stroke-width="2"/>
      <text x="0" y="6" text-anchor="middle" fill="#ffb066"
            font-family="'IBM Plex Mono',monospace" font-size="13" font-weight="600"
            letter-spacing="2.4">${label}</text>
    </g>`;
}

/**
 * The entry screen's hero: five cases fanned out of the dark, lit from
 * below by the same ember glow the page background carries, with the
 * front one showing what the app does to a game — a rating and a stamp.
 *
 * The fan is asymmetric on purpose. A symmetrical spread reads as a
 * logo; letting the right-hand cards sit a little lower and wider makes
 * it read as a pile someone actually put down.
 */
export function heroFanArt() {
  const glow = nextId();
  const rake = nextId();
  const fade = nextId();
  const fadeMask = nextId();
  // Where the cases meet their own reflection. Everything below this
  // line is the mirrored copy.
  const GROUND = 268;

  // The arc, held like a hand of cards: the outer cases ride HIGHER and
  // turn further out, which is what gives the group a tall, fanned
  // silhouette instead of a flat row. The hero case sits lowest and
  // largest, closest to both the light and the reader.
  // Listed back-to-front, because SVG paints in document order: both
  // outer cases first, then the inner pair over them, then the hero.
  // Listing them left-to-right instead put the far-right case on top of
  // the one in front of it, which read as a fold in the fan.
  const fan = [
    { x: 64,  y: 182, rot: -31, w: 86,  h: 118, from: '#3b3550', to: '#221f30', opacity: 0.8,  floatY: -5,  dur: 8.6, delay: 0.2 },
    { x: 326, y: 182, rot: 31,  w: 86,  h: 118, from: '#4a2f3f', to: '#281a24', opacity: 0.8,  floatY: -7,  dur: 9.0, delay: 0.9 },
    { x: 124, y: 150, rot: -17, w: 96,  h: 132, from: '#8b5cf6', to: '#4c2a8a', opacity: 0.95, floatY: -8,  dur: 7.4, delay: 0.5 },
    { x: 266, y: 150, rot: 17,  w: 96,  h: 132, from: '#ffc247', to: '#a86a12', opacity: 0.95, floatY: -6,  dur: 8.0, delay: 1.3 },
  ];
  const heroCase = (extra) => gameCase(Object.assign({
    x: 195, y: 176, rot: -2, w: 126, h: 174, from: '#ff9a5c', to: '#c4470b',
    spine: 'rgba(0,0,0,0.3)', floatY: -10, dur: 6.4, delay: 0,
  }, extra));

  const stack = (withDetail) => `
    ${fan.map((c) => gameCase(c)).join('')}
    ${heroCase({
      children: withDetail ? `
        <g transform="translate(7 -30) scale(0.64)">${starRowArt(4.5, { gap: 25, colour: '#fff3e2', empty: 'rgba(255,255,255,0.26)' })}</g>
        ${stampArt('PLAYED', { x: 7, y: 36, rot: -6, scale: 0.9 })}
        <rect class="lp-rake" x="-63" y="-87" width="126" height="174" rx="11" fill="url(#${rake})"/>` : '',
    })}`;

  return `
    <svg viewBox="0 0 390 398" role="img" aria-label="A fanned hand of game cases, the front one rated four and a half stars and stamped played">
      <defs>
        <radialGradient id="${glow}" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#ff7a29" stop-opacity="0.5"/>
          <stop offset="0.36" stop-color="#ff7a29" stop-opacity="0.19"/>
          <stop offset="0.68" stop-color="#ff7a29" stop-opacity="0.05"/>
          <stop offset="1" stop-color="#ff7a29" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="${rake}" x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stop-color="#fff" stop-opacity="0"/>
          <stop offset="0.5" stop-color="#fff" stop-opacity="0.22"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="${fade}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.5"/>
          <stop offset="0.62" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <mask id="${fadeMask}">
          <rect x="-40" y="${GROUND}" width="470" height="164" fill="url(#${fade})"/>
        </mask>
      </defs>

      <!-- the light everything stands in -->
      <ellipse cx="195" cy="${GROUND}" rx="252" ry="118" fill="url(#${glow})"/>

      <!-- the reflection, drawn first so the real cases sit on top of
           where it meets them. It carries no rating or stamp: a
           reflection that reproduces fine detail stops reading as a
           reflection and starts reading as a second, upside-down copy. -->
      <g mask="url(#${fadeMask})" opacity="0.5">
        <g transform="translate(0 ${GROUND * 2}) scale(1 -1)">${stack(false)}</g>
      </g>

      <!-- the bright line where the cases meet the floor -->
      <ellipse cx="195" cy="${GROUND}" rx="146" ry="4" fill="#ffb066" opacity="0.28"/>

      ${stack(true)}
    </svg>`;
}

// ---- tour scenes -----------------------------------------------------
// One per slide, all 330x220, all built from the kit above. Each scene
// shows the ACTION rather than an icon for it: the rating slide is a
// rating being given, not a picture of a star.

function sceneFrame(inner, { label }) {
  const glow = nextId();
  return `
    <svg viewBox="0 0 330 220" role="img" aria-label="${label}" style="overflow:visible">
      <defs>
        <radialGradient id="${glow}" cx="0.5" cy="0.78" r="0.6">
          <stop offset="0" stop-color="#ff7a29" stop-opacity="0.34"/>
          <stop offset="1" stop-color="#ff7a29" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="165" cy="188" rx="140" ry="54" fill="url(#${glow})"/>
      ${inner}
    </svg>`;
}

// A small slab used for the mocked-up rows in a couple of scenes.
function slab(x, y, w, h, { fill = 'rgba(255,255,255,0.07)', stroke = 'rgba(255,255,255,0.12)', r = 8 } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
}

const SCENES = {
  // Logging: a case being stamped.
  log: () => sceneFrame(`
    ${gameCase({ x: 122, y: 106, rot: -8, w: 104, h: 144, from: '#3b3550', to: '#221f30', opacity: 0.8, floatY: -5, dur: 8, delay: 0.4 })}
    ${gameCase({
      x: 178, y: 98, rot: 4, w: 116, h: 160, from: '#ff9a5c', to: '#c4470b', floatY: -9, dur: 6.6,
      children: `${stampArt('PLAYED', { x: 0, y: 40, rot: -7, scale: 0.92 })}
        <g transform="translate(0 -34) scale(0.5)">${starRowArt(4, { gap: 26, colour: '#fff3e2', empty: 'rgba(255,255,255,0.24)' })}</g>`,
    })}`, { label: 'A game case being stamped as played' }),

  // Rating: a big, unmistakable four-and-a-half.
  rate: () => sceneFrame(`
    ${gameCase({ x: 165, y: 82, rot: -2, w: 106, h: 146, from: '#ffc247', to: '#a4620d', floatY: -8, dur: 7 })}
    <g transform="translate(165 186)">
      ${starRowArt(4.5, { size: 1.5, gap: 42 })}
    </g>`, { label: 'A game rated four and a half stars' }),

  // Reviewing: the case alongside a written note.
  review: () => sceneFrame(`
    ${gameCase({ x: 78, y: 104, rot: -7, w: 92, h: 128, from: '#8b5cf6', to: '#4c2a8a', floatY: -7, dur: 7.8, delay: 0.3 })}
    <g class="lp-card" style="--float-y:-6px;--float-dur:6.8s;--float-delay:0.6s">
      ${slab(148, 44, 166, 124, { fill: 'rgba(255,255,255,0.06)', r: 14 })}
      <text x="166" y="82" fill="#ff9a5c" font-family="'Unbounded',sans-serif" font-size="30" font-weight="800">&#8220;</text>
      ${slab(190, 66, 106, 9, { fill: 'rgba(255,255,255,0.3)', stroke: 'none', r: 5 })}
      ${slab(166, 92, 130, 9, { fill: 'rgba(255,255,255,0.18)', stroke: 'none', r: 5 })}
      ${slab(166, 110, 118, 9, { fill: 'rgba(255,255,255,0.18)', stroke: 'none', r: 5 })}
      ${slab(166, 128, 74, 9, { fill: 'rgba(255,255,255,0.18)', stroke: 'none', r: 5 })}
      <g transform="translate(196 156) scale(0.42)">${starRowArt(5, { gap: 26 })}</g>
    </g>`, { label: 'A written review beside a game case' }),

  // Friends: faces over the shelf.
  people: () => sceneFrame(`
    ${gameCase({ x: 80, y: 118, rot: -14, w: 80, h: 110, from: '#3b3550', to: '#221f30', opacity: 0.7, floatY: -5, dur: 8.4, delay: 0.2 })}
    ${gameCase({ x: 250, y: 118, rot: 14, w: 80, h: 110, from: '#4a2f3f', to: '#281a24', opacity: 0.7, floatY: -6, dur: 9, delay: 0.7 })}
    ${[
      { cx: 105, cy: 104, r: 30, from: '#8b5cf6', to: '#5b32a8', d: 0.5 },
      { cx: 165, cy: 88, r: 38, from: '#ff9a5c', to: '#c4470b', d: 0 },
      { cx: 225, cy: 104, r: 30, from: '#ffc247', to: '#a86a12', d: 0.9 },
    ].map((a) => {
      const id = nextId();
      return `
        <g class="lp-card" style="--float-y:-7px;--float-dur:7s;--float-delay:${a.d}s">
          <defs><linearGradient id="${id}" x1="0" y1="0" x2="0.5" y2="1">
            <stop offset="0" stop-color="${a.from}"/><stop offset="1" stop-color="${a.to}"/>
          </linearGradient></defs>
          <circle cx="${a.cx}" cy="${a.cy}" r="${a.r}" fill="url(#${id})" stroke="#12100f" stroke-width="3"/>
          <circle cx="${a.cx}" cy="${a.cy - a.r * 0.18}" r="${a.r * 0.3}" fill="rgba(255,255,255,0.75)"/>
          <path d="M${a.cx - a.r * 0.62} ${a.cy + a.r * 0.72} a${a.r * 0.62} ${a.r * 0.58} 0 0 1 ${a.r * 1.24} 0"
                fill="rgba(255,255,255,0.75)"/>
        </g>`;
    }).join('')}
`, { label: 'Three friends over a shelf of games' }),

  // Lists: a ranked stack.
  list: () => sceneFrame(`
    ${[
      { y: 44, n: '1', from: '#ff9a5c', to: '#c4470b', d: 0 },
      { y: 100, n: '2', from: '#ffc247', to: '#a86a12', d: 0.4 },
      { y: 156, n: '3', from: '#8b5cf6', to: '#4c2a8a', d: 0.8 },
    ].map((row) => {
      const id = nextId();
      return `
        <g class="lp-card" style="--float-y:-5px;--float-dur:7.2s;--float-delay:${row.d}s">
          <defs><linearGradient id="${id}" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stop-color="${row.from}"/><stop offset="1" stop-color="${row.to}"/>
          </linearGradient></defs>
          ${slab(58, row.y, 214, 44, { fill: 'rgba(255,255,255,0.05)', r: 12 })}
          <text x="76" y="${row.y + 28}" fill="#8a817c" font-family="'IBM Plex Mono',monospace"
                font-size="15" font-weight="600">${row.n}</text>
          <rect x="94" y="${row.y + 6}" width="24" height="32" rx="5" fill="url(#${id})"/>
          ${slab(128, row.y + 17, 124, 9, { fill: 'rgba(255,255,255,0.2)', stroke: 'none', r: 5 })}
        </g>`;
    }).join('')}`, { label: 'A ranked list of three games' }),
};

export function tourSceneArt(kind) {
  return (SCENES[kind] || SCENES.log)();
}

/**
 * The drifting embers behind the entry screen. Positions are generated
 * once per module load rather than per paint: the entry screen remounts
 * every time the bottom nav comes back to it, and re-rolling the field
 * each time would make motes that are mid-flight jump to new places.
 */
const EMBER_COUNT = 26;
const EMBERS = Array.from({ length: EMBER_COUNT }, () => ({
  x: (Math.random() * 100).toFixed(1),
  y: (Math.random() * 90 + 5).toFixed(1),
  size: (Math.random() * 2.4 + 1.2).toFixed(1),
  peak: (Math.random() * 0.45 + 0.25).toFixed(2),
  drift: (Math.random() * 80 - 40).toFixed(0),
  dur: (Math.random() * 9 + 9).toFixed(1),
  delay: (Math.random() * 14).toFixed(1),
}));

export function emberFieldHtml() {
  return `
    <div class="lp__embers" aria-hidden="true">
      ${EMBERS.map((e) => `<span class="lp__ember" style="--x:${e.x}%;--y:${e.y}%;--size:${e.size}px;--peak:${e.peak};--drift:${e.drift}px;--dur:${e.dur}s;--delay:${e.delay}s;"></span>`).join('')}
    </div>`;
}
