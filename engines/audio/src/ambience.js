// Ambience: the sound of a place. generateAmbience() describes a bed (wind,
// rain, a stream, a village...) as layers of shaped noise, hums and ticks that
// loop without a seam, plus "sprinkles": small sounds (a bird, a drip, a
// hammer) that happen now and then. In a game the sprinkles are scheduled
// live at random times, so the place never audibly repeats.

import { createRng } from './rng.js';
import { soundStyle } from './palettes.js';
import { generateSound } from './gen-sfx.js';
import { renderSound } from './render.js';
import { createReverb, fxActive } from './fx.js';

const noise = (o) => ({ type: 'noise', volume: 0.3, ...o });
const sprinkle = (describe, every, volume = [0.3, 0.6], extra = {}) => ({ describe, every, volume, pitch: [0.92, 1.08], spread: 0.8, ...extra });

// kind -> (intensity) -> { layers, sprinkles }. Frequencies in Hz, `swells` are whole cycles per loop.
const KINDS = {
  wind: (i) => ({
    layers: [noise({ lowpass: 520, volume: 0.5 * i, swell: 0.65, swells: [1, 3], sweep: 0.8 }), noise({ bandpass: 950, q: 5, volume: 0.1 * i, swell: 0.9, swells: [2, 5], sweep: 0.5 })],
    sprinkles: [sprinkle('leaves rustle', [6, 14], [0.2, 0.4])],
  }),
  rain: (i) => ({
    layers: [{ type: 'grains', rate: 900 * i, hz: 4500, q: 0.8, volume: 0.5 }, noise({ highpass: 1500, lowpass: 7000, volume: 0.22 * i, swell: 0.15, swells: [2] })],
    sprinkles: [sprinkle('water drip', [1.5, 4], [0.2, 0.45])],
  }),
  storm: (i) => ({
    layers: [{ type: 'grains', rate: 1500 * i, hz: 4200, q: 0.8, volume: 0.55 }, noise({ highpass: 1200, lowpass: 7000, volume: 0.25 * i, swell: 0.3, swells: [2, 3] }),
      noise({ lowpass: 480, volume: 0.45 * i, swell: 0.7, swells: [1, 3], sweep: 0.9 })],
    sprinkles: [sprinkle('distant thunder', [9, 20], [0.5, 0.9], { spread: 0.5 })],
  }),
  stream: (i) => ({
    layers: [noise({ bandpass: 1300, q: 0.8, volume: 0.4 * i, swell: 0.25, swells: [3, 7, 11] }), { type: 'grains', rate: 60 * i, hz: 900, q: 6, volume: 0.25 }, noise({ highpass: 3000, volume: 0.07 * i })],
    sprinkles: [sprinkle('water bubble', [1, 3], [0.15, 0.35])],
  }),
  ocean: (i) => ({
    layers: [noise({ lowpass: 900, volume: 0.6 * i, swell: 0.9, swells: [2], sweep: 1.2, lfo: 'wave' }), noise({ highpass: 2500, volume: 0.15 * i, swell: 0.95, swells: [2], lfo: 'wave' })],
    sprinkles: [],
  }),
  forest: (i) => ({
    layers: [noise({ lowpass: 700, volume: 0.3 * i, swell: 0.5, swells: [1, 2] }), noise({ bandpass: 3000, q: 1, volume: 0.08 * i, swell: 0.8, swells: [3] })],
    sprinkles: [sprinkle('bird chirp', [2, 7]), sprinkle('small high bird tweet', [4, 11], [0.2, 0.5]), sprinkle('leaves rustle', [5, 12], [0.2, 0.4])],
  }),
  village: (i) => ({
    layers: [noise({ lowpass: 400, volume: 0.26 * i, swell: 0.3, swells: [1] }), noise({ bandpass: 420, q: 2, volume: 0.14 * i, swell: 0.6, swells: [2, 3], tremolo: 3.3, tremoloDepth: 0.8 })],
    sprinkles: [sprinkle('distant hammer anvil hit', [4, 10], [0.3, 0.6]), sprinkle('chicken cluck', [6, 15], [0.2, 0.4]), sprinkle('bird chirp', [3, 9], [0.2, 0.45]),
      sprinkle('small distant bell', [14, 30], [0.3, 0.5]), sprinkle('distant wooden door shut', [10, 22], [0.3, 0.5])],
  }),
  cave: (i) => ({
    layers: [{ type: 'drone', freq: 52, wave: 'sine', volume: 0.09 * i, swell: 0.4, swells: [1] }, noise({ lowpass: 260, volume: 0.25 * i, swell: 0.4, swells: [1, 2] })],
    sprinkles: [sprinkle('echoing water drip', [1.5, 5], [0.3, 0.6]), sprinkle('small echoing water drip', [3, 9], [0.2, 0.4])],
  }),
  night: (i) => ({
    layers: [noise({ lowpass: 500, volume: 0.22 * i, swell: 0.3, swells: [1] })],
    sprinkles: [sprinkle('cricket', [0.5, 1.4], [0.15, 0.3]), sprinkle('small cricket', [0.9, 2.6], [0.1, 0.22]), sprinkle('distant owl hoot', [10, 22], [0.3, 0.5])],
  }),
  fire: (i) => ({
    layers: [{ type: 'grains', rate: 14 * i, hz: 2500, q: 1.2, volume: 0.22 }, { type: 'grains', rate: 5 * i, hz: 900, q: 2, volume: 0.2 },
      noise({ lowpass: 380, volume: 0.35 * i, swell: 0.3, swells: [3, 5], tremolo: 9, tremoloDepth: 0.35 })],
    sprinkles: [],
  }),
  crypt: (i) => ({
    layers: [{ type: 'drone', freq: 49, wave: 'saw', lowpass: 300, volume: 0.08 * i, swell: 0.5, swells: [1] }, { type: 'drone', freq: 52.5, wave: 'sine', volume: 0.06 * i, swell: 0.4, swells: [2] },
      noise({ lowpass: 220, volume: 0.2 * i, swell: 0.5, swells: [1] })],
    sprinkles: [sprinkle('echoing water drip', [3, 8], [0.25, 0.5]), sprinkle('distant metal chain rustle', [12, 26], [0.25, 0.45]), sprinkle('distant heavy wooden creak', [15, 30], [0.25, 0.45]),
      sprinkle('distant quiet ghost moan', [20, 40], [0.2, 0.35])],
  }),
  swamp: (i) => ({
    layers: [noise({ lowpass: 400, volume: 0.25 * i, swell: 0.3, swells: [1] }), { type: 'grains', rate: 3 * i, hz: 500, q: 8, volume: 0.3 }],
    sprinkles: [sprinkle('frog croak', [2, 6], [0.25, 0.5]), sprinkle('small frog croak', [3, 8], [0.2, 0.4]), sprinkle('cricket', [0.8, 2], [0.1, 0.25]), sprinkle('water bubble', [2, 5], [0.2, 0.4])],
  }),
};
const SYNONYMS = { river: 'stream', brook: 'stream', water: 'stream', waves: 'ocean', sea: 'ocean', shore: 'ocean', beach: 'ocean', woods: 'forest', meadow: 'forest', town: 'village',
  market: 'village', hamlet: 'village', dungeon: 'crypt', cellar: 'crypt', tomb: 'crypt', campfire: 'fire', fireplace: 'fire', crickets: 'night', thunderstorm: 'storm', breeze: 'wind', cavern: 'cave', marsh: 'swamp', bog: 'swamp' };
const INTENSITY = { gentle: 0.6, soft: 0.6, light: 0.6, calm: 0.6, quiet: 0.5, heavy: 1.5, strong: 1.5, howling: 1.7, stormy: 1.6, loud: 1.4, busy: 1.4 };
const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'at', 'on', 'with', 'and', 'ambience', 'ambient', 'background', 'sound', 'sounds', 'noise', 'bed', 'loop', 'outside', 'outdoor', 'outdoors', 'day']);

/** Kinds of place generateAmbience knows. */
export const AMBIENCE_KINDS = Object.keys(KINDS);

/**
 * generateAmbience(request) -> { name, kind, describe, style, seed, seconds, bed, sprinkles, fx, ignored }
 *   request: a kind or description string, or { kind, describe, style, seed, seconds }
 *     kind / describe: one of AMBIENCE_KINDS, or words like "gentle wind", "heavy rain", "distant village"
 *     style:   one of SOUND_STYLE_NAMES; colours the bed and the sprinkles (default 'storybook')
 *     seconds: length of the looping bed, 4..30 (default 12)
 *   bed:       { layers } plain data for the looping part
 *   sprinkles: [{ name, sound, every: [min, max] seconds, volume: [lo, hi], pitch: [lo, hi], spread }]
 * Play it with audio.playAmbience(ambience); render a WAV with renderAmbience(ambience).
 */
export function generateAmbience(request = {}) {
  const req = typeof request === 'string' ? { describe: request } : request;
  if (!req || typeof req !== 'object') throw new Error(`generateAmbience: expected a kind, a description or { kind, style, seed }, got ${JSON.stringify(request)}`);
  const { style = 'storybook', seed = 1, seconds = 12 } = req;
  const st = soundStyle(style, 'generateAmbience').ambience;
  if (!(seconds >= 4 && seconds <= 30)) throw new Error(`generateAmbience: seconds must be a number from 4 to 30, got ${JSON.stringify(seconds)}`);
  let kind = req.kind ?? null, intensity = 1, far = false;
  const ignored = [];
  for (const word of String(req.describe ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
    const k = Object.hasOwn(KINDS, word) ? word : SYNONYMS[word];
    if (k) kind ??= k;
    else if (INTENSITY[word]) intensity *= INTENSITY[word];
    else if (word === 'distant' || word === 'far') far = true;
    else if (!STOP.has(word)) ignored.push(word);
  }
  if (kind === null) throw new Error(`generateAmbience: no kind of place in ${JSON.stringify(req.describe ?? req)}. Kinds: ${AMBIENCE_KINDS.join(', ')}`);
  if (!Object.hasOwn(KINDS, kind)) throw new Error(`generateAmbience: unknown kind "${kind}". Kinds: ${AMBIENCE_KINDS.join(', ')}`);
  const made = KINDS[kind](Math.max(0.3, Math.min(2, intensity)));
  const bright = st.bright * (far ? 0.5 : 1);
  const layers = made.layers.map((layer) => {
    const out = { ...layer };
    for (const key of ['lowpass', 'highpass', 'bandpass', 'hz']) if (out[key]) out[key] = Math.round(Math.min(16000, out[key] * bright));
    out.volume = Math.round(Math.min(1, out.volume * (far ? 0.7 : 1)) * 1000) / 1000;
    return out;
  });
  const sprinkles = made.sprinkles.map((s, n) => {
    const asset = generateSound({ describe: s.describe + (far ? ' distant' : ''), seed: `${seed}:${n}`, style });
    return { name: asset.name, sound: asset.sound, every: s.every.map((t) => t / Math.sqrt(intensity)), volume: s.volume, pitch: s.pitch, spread: s.spread };
  });
  return { name: `${kind}-${seed}`, kind, describe: req.describe ?? kind, style, seed, seconds, bed: { layers }, sprinkles, fx: { ...st.fx }, ignored };
}

/** isAmbience(value) -> true for what generateAmbience returns */
export function isAmbience(value) {
  return Boolean(value) && typeof value === 'object' && Boolean(value.bed) && Array.isArray(value.bed.layers) && Array.isArray(value.sprinkles);
}

const TAU = Math.PI * 2;

// One bed layer as a function that fills samples from..to of both channels, keeping its filter state.
function layerRunner(layer, index, amb, rate) {
  const rng = createRng(`${amb.seed}:${amb.kind}:layer:${index}`);
  const lfoRng = createRng(`${amb.seed}:${amb.kind}:lfo:${layer.lfo ?? index}`);
  const loop = Math.round(amb.seconds * rate);
  const swells = (layer.swells ?? []).map((cycles) => ({ w: (TAU * cycles) / loop, phase: lfoRng() * TAU }));
  const lfo = (i) => { if (!swells.length) return 1; let m = 0; for (const s of swells) m += Math.sin(s.w * i + s.phase); return 0.5 + 0.5 * (m / swells.length); }; // 0..1
  const swell = layer.swell ?? 0, sweep = layer.sweep ?? 0;
  const tremW = layer.tremolo ? (TAU * Math.max(1, Math.round(layer.tremolo * amb.seconds))) / loop : 0;
  const chans = [0, 1].map(() => ({ lp1: 0, lp2: 0, hp: 0, b1: 0, b2: 0, phase: 0, phase2: 0 }));
  const q = layer.q ?? 1, k = 1 / q;
  let a1 = 0, a2 = 0, a3 = 0, lpA = 1, level = 1;
  const hpA = layer.highpass ? 1 - Math.exp((-TAU * layer.highpass) / rate) : 0;
  const droneHz = layer.type === 'drone' ? Math.max(1, Math.round(layer.freq * amb.seconds)) / amb.seconds : 0; // whole cycles per loop: no click at the seam
  const grainP = layer.type === 'grains' ? layer.rate / rate : 0;
  return (left, right, from, to, offset = 0) => {
    for (let i = from; i < to; i++) {
      if ((i & 31) === 0 || i === from || i === 0) {
        const m = lfo(i), bend = Math.pow(2, sweep * (m - 0.5));
        level = layer.volume * (1 - swell * (1 - m)) * (tremW ? 1 - (layer.tremoloDepth ?? 0.5) * (0.5 + 0.5 * Math.sin(tremW * i)) : 1);
        if (layer.lowpass) lpA = 1 - Math.exp((-TAU * Math.min(layer.lowpass * bend, rate * 0.45)) / rate);
        const band = layer.bandpass ?? (layer.type === 'grains' ? layer.hz : 0);
        if (band) { const g = Math.tan(Math.PI * Math.min(band * bend, rate * 0.45) / rate); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; }
      }
      for (let c = 0; c < 2; c++) {
        const s = chans[c];
        let x;
        if (layer.type === 'drone') {
          s.phase += droneHz / rate; if (s.phase >= 1) s.phase -= 1;
          x = layer.wave === 'saw' ? 2 * s.phase - 1 : Math.sin(TAU * s.phase + c * 0.6);
        } else if (layer.type === 'grains') x = rng() < grainP ? (rng() * 2 - 1) * 14 : 0;
        else x = rng() * 2 - 1;
        if (layer.bandpass || layer.type === 'grains') {
          const v3 = x - s.b2, v1 = a1 * s.b1 + a2 * v3, v2 = s.b2 + a2 * s.b1 + a3 * v3;
          s.b1 = 2 * v1 - s.b1; s.b2 = 2 * v2 - s.b2; x = v1 * k * Math.sqrt(q) * 1.6;
        }
        if (layer.lowpass) { s.lp1 += lpA * (x - s.lp1); s.lp2 += lpA * (s.lp1 - s.lp2); x = s.lp2 * 2.2; }
        if (hpA) { s.hp += hpA * (x - s.hp); x -= s.hp; }
        (c ? right : left)[i + offset] += x * level;
      }
    }
  };
}

/**
 * ambiencePlan(ambience, sampleRate?, { sprinkles }?) -> { jobs, done() -> [left, right] }
 * Renders the looping bed in small jobs (see render-queue.js). sprinkles: true (default) bakes the
 * small sounds into the loop for a WAV file; createAudio passes false and schedules them live.
 */
export function ambiencePlan(amb, sampleRate = 44100, options = {}) {
  if (!isAmbience(amb)) throw new Error('ambiencePlan: expected an ambience from generateAmbience');
  const n = Math.round(amb.seconds * sampleRate), cross = Math.round(Math.min(1, amb.seconds / 4) * sampleRate);
  const left = new Float32Array(n + cross), right = new Float32Array(n + cross);
  const jobs = [], chunk = Math.round(sampleRate / 4); // a quarter second per job keeps every slice short
  const add = (layer, index, end) => {
    const run = layerRunner(layer, index, amb, sampleRate);
    if (layer.type === 'drone') { // run the second before the loop into scratch, so filters start warm and the seam is smooth
      const warm = sampleRate, scratch = new Float32Array(warm);
      for (let from = -warm; from < 0; from += chunk) { const to = Math.min(0, from + chunk); jobs.push([(to - from) * 2, () => run(scratch, scratch, from, to, warm)]); }
    }
    for (let from = 0; from < end; from += chunk) { const to = Math.min(end, from + chunk); jobs.push([(to - from) * 2, () => run(left, right, from, to)]); }
  };
  amb.bed.layers.forEach((layer, index) => { if (layer.type !== 'drone') add(layer, index, n + cross); });
  // Fold the extra second back over the start with an equal-power cross-fade: the loop has no seam.
  jobs.push([cross, () => {
    for (let i = 0; i < cross; i++) {
      const w = (i / cross) * Math.PI / 2, a = Math.sin(w), b = Math.cos(w);
      left[i] = left[i] * a + left[n + i] * b; right[i] = right[i] * a + right[n + i] * b;
    }
  }]);
  // Hums are tuned to fit the loop a whole number of times, so they need no cross-fade.
  amb.bed.layers.forEach((layer, index) => { if (layer.type === 'drone') add(layer, index, n); });
  if (options.sprinkles !== false) {
    amb.sprinkles.forEach((s, index) => jobs.push([sampleRate, () => {
      const rng = createRng(`${amb.seed}:${amb.kind}:sprinkle:${index}`), one = renderSound(s.sound, sampleRate);
      let t = (s.every[0] + rng() * (s.every[1] - s.every[0])) * rng();
      while (t < amb.seconds) {
        const vol = s.volume[0] + rng() * (s.volume[1] - s.volume[0]), angle = (rng() * 2 - 1) * s.spread * Math.PI / 4 + Math.PI / 4;
        const start = Math.round(t * sampleRate), gl = Math.cos(angle) * vol, gr = Math.sin(angle) * vol;
        for (let i = 0; i < one.length; i++) { const at = (start + i) % n; left[at] += one[i] * gl; right[at] += one[i] * gr; }
        t += s.every[0] + rng() * (s.every[1] - s.every[0]);
      }
    }]));
  }
  if (fxActive(amb.fx) && amb.fx.reverb) {
    const reverb = createReverb(sampleRate, amb.fx);
    // Warm the room with the end of the loop first (into scratch), so the start already has its echo.
    const warm = Math.min(n, Math.round(sampleRate * 1.5));
    let l = null, r = null;
    for (let from = 0; from < warm; from += chunk) {
      const to = Math.min(warm, from + chunk);
      jobs.push([(to - from) * 4, () => { l ??= left.slice(n - warm, n); r ??= right.slice(n - warm, n); reverb.process(l, r, from, to, amb.fx.reverb); }]);
    }
    for (let from = 0; from < n; from += chunk) { const to = Math.min(n, from + chunk); jobs.push([(to - from) * 4, () => reverb.process(left, right, from, to, amb.fx.reverb)]); }
  }
  jobs.push([n, () => {
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    const gain = peak > 0.6 ? 0.6 / peak : 1; // ambience sits under everything else
    if (amb.fx && amb.fx.lowpass) {
      const a = 1 - Math.exp((-TAU * amb.fx.lowpass) / sampleRate);
      for (const ch of [left, right]) { let s = ch[n - 1]; for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { s += a * (ch[i] - s); if (pass) ch[i] = s; } }
    }
    if (gain !== 1) for (let i = 0; i < n; i++) { left[i] *= gain; right[i] *= gain; }
  }]);
  return { jobs, done: () => [left.subarray(0, n), right.subarray(0, n)] };
}

/** renderAmbience(ambience, sampleRate?) -> { left, right } one seamless loop, sprinkles included */
export function renderAmbience(amb, sampleRate = 44100) {
  const plan = ambiencePlan(amb, sampleRate);
  for (const [, run] of plan.jobs) run();
  const [left, right] = plan.done();
  return { left, right };
}
