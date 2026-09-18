// The app's own notification sound: a coin dropping into an arcade
// cabinet.
//
// Synthesised rather than shipped as a file. An .mp3 would be another
// network request that can fail, another thing in the service worker's
// precache list, and a licensing question; this is ~40 lines of Web
// Audio that always works offline and weighs nothing. It is also exact —
// the coin is two square-wave notes, and the whole character of it is in
// the pitch jump and the decay, both of which are numbers here rather
// than something baked into a recording.
//
// The notes are the ones everybody's ear already knows from a coin
// pickup: B5, then up a perfect fourth to E6 held while it rings out.

const NOTE_B5 = 987.77;
const NOTE_E6 = 1318.51;

let ctx = null;
let unlocked = false;

// One context for the life of the tab. Created lazily because Chrome and
// Safari both refuse to start one outside a user gesture and log a
// warning if you try, and most sessions never play a sound at all.
function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

// iOS starts every context suspended and only lets a gesture resume it,
// so the first real notification of a session would be silent without
// this. Called from app.js on the first touch/click anywhere, once.
export function unlockAudio() {
  if (unlocked) return;
  const a = audio();
  if (!a) return;
  unlocked = true;
  if (a.state === 'suspended') a.resume().catch(() => {});
}

export function playCoin({ volume = 0.22 } = {}) {
  const a = audio();
  if (!a) return;
  if (a.state === 'suspended') a.resume().catch(() => {});

  const t0 = a.currentTime;
  // The two notes are one oscillator, not two: a coin is a single
  // continuous ring that jumps in pitch partway through, and
  // retriggering would put an audible click at the seam.
  const osc = a.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(NOTE_B5, t0);
  osc.frequency.setValueAtTime(NOTE_E6, t0 + 0.075);

  const gain = a.createGain();
  // A hair of attack rather than starting at full — a square wave
  // snapping on from silence pops on small speakers.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.008);
  gain.gain.setValueAtTime(volume, t0 + 0.075);
  // Exponential, not linear: that long ring-out is what makes it read as
  // a coin rather than a beep. It cannot reach true zero exponentially,
  // hence the tiny floor and the explicit stop after it.
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.52);

  // Takes the hardest edges off the square wave so it sits in a phone
  // speaker as a chime instead of a buzz.
  const tone = a.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.setValueAtTime(5200, t0);

  osc.connect(tone);
  tone.connect(gain);
  gain.connect(a.destination);

  osc.start(t0);
  osc.stop(t0 + 0.55);
  // Nodes are single-use; letting them go keeps a long session from
  // accumulating a few hundred dead oscillators.
  osc.onended = () => {
    try { osc.disconnect(); tone.disconnect(); gain.disconnect(); } catch {}
  };
}
