// Small synthesized sound effects and haptics for the random-pick card
// draw. No audio files: every sound is built with Web Audio at play time,
// so none of it costs a request or adds to the cached bundle.
//
// Browsers only allow audio after a user gesture, so sfxUnlock() has to
// run synchronously inside the tap that opens the draw. The 'ambient'
// audio session makes iOS respect the silent switch and mix with whatever
// else is playing instead of pausing it.

let ctx = null;
let master = null;
let noise = null;

export function sfxUnlock() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function noiseBuffer() {
  if (noise) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

// A filtered burst of noise: clicks, riffles, swooshes.
function burst({ at = 0, dur = 0.02, freq = 3000, to = null, q = 1, gain = 0.4, type = 'bandpass' }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// A short soft tone: the "good" moments.
function tone({ at = 0, freq = 660, dur = 0.14, gain = 0.2, type = 'sine' }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  // cards falling back together after a split
  riffle() {
    for (let i = 0; i < 9; i++) burst({ at: i * 0.024 + Math.random() * 0.006, dur: 0.018, freq: 2600 + Math.random() * 1400, q: 0.9, gain: 0.32 });
  },
  lift() { burst({ dur: 0.06, freq: 1400, q: 0.7, gain: 0.12, type: 'lowpass' }); },
  flip() {
    burst({ dur: 0.16, freq: 700, to: 3200, q: 0.8, gain: 0.28 });
    burst({ at: 0.15, dur: 0.022, freq: 3800, q: 1.4, gain: 0.36 });
  },
  deal(i = 0) { burst({ at: i * 0.09, dur: 0.03, freq: 2200, q: 1, gain: 0.22 }); },
  toss() { burst({ dur: 0.22, freq: 2400, to: 500, q: 0.6, gain: 0.24 }); },
  open() { tone({ freq: 523, dur: 0.1 }); tone({ at: 0.08, freq: 784, dur: 0.18 }); },
  save() { tone({ freq: 659, dur: 0.12, gain: 0.18 }); tone({ at: 0.1, freq: 988, dur: 0.24, gain: 0.16 }); },
};

// Native haptics in the app shell, the Vibration API on Android browsers.
// iOS Safari has no web vibration, so this is silent there.
export function buzz(pattern = 8) {
  const haptics = window.Capacitor?.Plugins?.Haptics;
  if (haptics) { haptics.impact({ style: 'LIGHT' }).catch(() => {}); return; }
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
