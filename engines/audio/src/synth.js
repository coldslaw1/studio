// The synthesizer: turns "tone" objects into raw samples (Float32Array).
// Pure maths, no browser needed. Everything else is built on addTone().

import { createRng } from './rng.js';

const TAU = Math.PI * 2;

/** Wave shapes a tone can use. */
export const WAVES = ['sine', 'square', 'saw', 'triangle', 'noise'];

/** Every tone setting with its default value. */
export const TONE_DEFAULTS = {
  wave: 'square', // one of WAVES
  freq: 440, // start pitch in Hz. For noise: how "bright" it is (100 rumble .. 12000 hiss)
  freqEnd: 0, // if > 0 the pitch slides from freq to freqEnd
  duration: 0.2, // seconds, whole sound including fade out
  delay: 0, // seconds to wait before this tone starts (for layering)
  volume: 0.5, // 0..1
  attack: 0.002, // fade-in seconds
  decay: 0, // seconds to fall from full level to `sustain` (0 = no fall)
  sustain: 1, // level 0..1 held after the decay
  release: 0.02, // fade-out seconds at the end
  duty: 0.5, // square wave only: 0.5 = hollow, 0.125 = thin and nasal
  vibratoDepth: 0, // pitch wobble in semitones
  vibratoRate: 6, // wobbles per second
  arp: null, // list of semitone jumps played in turn, e.g. [0, 4, 7]
  arpSpeed: 0.06, // seconds per arp step
  arpLoop: false, // false = stay on the last step, true = cycle
  lowpass: 0, // Hz, 0 = off. Cuts highs (muffled)
  lowpassEnd: 0, // if > 0 the lowpass sweeps to this value
  highpass: 0, // Hz, 0 = off. Cuts lows (thin)
  seed: 1, // noise pattern seed
  bandpass: 0, // Hz, 0 = off. Keeps only a band around this pitch (resonant, "body" of an object)
  bandpassEnd: 0, // if > 0 the band sweeps to this value
  q: 1, // how narrow and ringing the bandpass is: 0.3 wide .. 30 whistling
  fm: 0, // sine only: 0 = off, else the modulator's pitch as a multiple of freq (1.4 bell, 0.5 growl)
  fmDepth: 0, // how strong the fm is: 0 none .. 12 very metallic
  tremoloDepth: 0, // volume wobble 0..1
  tremoloRate: 8, // wobbles per second
  jitter: 0, // 0..1 random pitch wander (creaks, growls, wind)
  drive: 0, // 0..1 soft distortion, adds grit
  pan: 0, // -1 left .. 1 right (used by stereo rendering)
};

const KEYS = Object.keys(TONE_DEFAULTS);

function num(fn, tone, key, min, max) {
  const v = tone[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${fn}: tone.${key} must be a number from ${min} to ${max}, got ${JSON.stringify(v)}`);
  }
}

/**
 * validateTone(tone, fn?) -> the tone with defaults filled in.
 * Throws an Error that names the bad setting.
 */
export function validateTone(tone, fn = 'validateTone') {
  if (!tone || typeof tone !== 'object' || Array.isArray(tone)) {
    throw new Error(`${fn}: a tone must be an object like { wave: 'square', freq: 440, duration: 0.2 }, got ${JSON.stringify(tone)}`);
  }
  for (const key of Object.keys(tone)) {
    if (!KEYS.includes(key)) throw new Error(`${fn}: unknown tone setting "${key}". Valid settings: ${KEYS.join(', ')}`);
  }
  const t = { ...TONE_DEFAULTS, ...tone };
  if (!WAVES.includes(t.wave)) throw new Error(`${fn}: tone.wave must be one of ${WAVES.join(', ')}, got ${JSON.stringify(t.wave)}`);
  num(fn, t, 'freq', 1, 20000);
  num(fn, t, 'freqEnd', 0, 20000);
  num(fn, t, 'duration', 0.001, 10);
  num(fn, t, 'delay', 0, 600);
  num(fn, t, 'volume', 0, 1);
  num(fn, t, 'attack', 0, 10);
  num(fn, t, 'decay', 0, 10);
  num(fn, t, 'sustain', 0, 1);
  num(fn, t, 'release', 0, 10);
  num(fn, t, 'duty', 0.01, 0.99);
  num(fn, t, 'vibratoDepth', 0, 24);
  num(fn, t, 'vibratoRate', 0, 100);
  num(fn, t, 'arpSpeed', 0.005, 10);
  num(fn, t, 'lowpass', 0, 20000);
  num(fn, t, 'lowpassEnd', 0, 20000);
  num(fn, t, 'highpass', 0, 20000);
  num(fn, t, 'bandpass', 0, 20000);
  num(fn, t, 'bandpassEnd', 0, 20000);
  num(fn, t, 'q', 0.3, 30);
  num(fn, t, 'fm', 0, 16);
  num(fn, t, 'fmDepth', 0, 12);
  num(fn, t, 'tremoloDepth', 0, 1);
  num(fn, t, 'tremoloRate', 0, 200);
  num(fn, t, 'jitter', 0, 1);
  num(fn, t, 'drive', 0, 1);
  num(fn, t, 'pan', -1, 1);
  if (t.arp !== null && !(Array.isArray(t.arp) && t.arp.length > 0 && t.arp.every((s) => Number.isFinite(s)))) {
    throw new Error(`${fn}: tone.arp must be null or a list of semitone numbers like [0, 4, 7], got ${JSON.stringify(t.arp)}`);
  }
  return t;
}

// Smooths the sharp edges of square and saw waves so they do not sound harsh.
function blep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

/**
 * addTone(out, sampleRate, tone, wrap?, right?) -> out
 * Mixes one tone into the sample buffer `out` (adds, does not overwrite).
 * wrap = true makes a tone that runs past the end continue at the start
 * (used for seamless music loops); otherwise the overflow is dropped.
 * With a second buffer `right`, out is the left channel and tone.pan places the tone.
 */
export function addTone(out, sampleRate, tone, wrap = false, right = null) {
  const t = validateTone(tone, 'addTone');
  const n = Math.max(1, Math.round(t.duration * sampleRate));
  const start = Math.round(t.delay * sampleRate);
  let attackN = Math.max(8, t.attack * sampleRate);
  let releaseN = Math.max(32, t.release * sampleRate);
  if (attackN + releaseN > n) { const k = n / (attackN + releaseN); attackN *= k; releaseN *= k; }
  const decayRate = t.decay > 0 ? 5 / (t.decay * sampleRate) : 0;
  const slide = t.freqEnd > 0 ? Math.pow(t.freqEnd / t.freq, 1 / n) : 1;
  const arp = t.arp ? t.arp.map((s) => Math.pow(2, s / 12)) : null;
  const arpN = t.arpSpeed * sampleRate;
  const vib = t.vibratoDepth > 0 ? Math.pow(2, t.vibratoDepth / 12) - 1 : 0;
  const vibStep = (TAU * t.vibratoRate) / sampleRate;
  const lpSlide = t.lowpass > 0 && t.lowpassEnd > 0 ? Math.pow(t.lowpassEnd / t.lowpass, 1 / n) : 1;
  const hpA = t.highpass > 0 ? 1 - Math.exp((-TAU * t.highpass) / sampleRate) : 0;
  const rng = createRng(t.seed);
  const isNoise = t.wave === 'noise';
  let base = t.freq, cutoff = t.lowpass, lpA = 0, lp = 0, hp = 0;
  let phase = 0, held = isNoise ? rng() * 2 - 1 : 0;
  const fm = t.wave === 'sine' && t.fm > 0 && t.fmDepth > 0;
  let fmPhase = 0;
  const jitRng = t.jitter > 0 ? createRng(`${t.seed}:jitter`) : null;
  let jit = 0, jitTarget = 0;
  const jitEvery = Math.max(8, Math.round(sampleRate / 90));
  let band = t.bandpass, bpSlide = t.bandpass > 0 && t.bandpassEnd > 0 ? Math.pow(t.bandpassEnd / t.bandpass, 1 / n) : 1;
  const bpK = 1 / t.q, bpGain = bpK * Math.sqrt(t.q);
  let b1 = 0, b2 = 0, a1 = 0, a2 = 0, a3 = 0;
  const tremStep = (TAU * t.tremoloRate) / sampleRate;
  const driveGain = 1 + t.drive * 7, driveNorm = t.drive > 0 ? 1 / Math.tanh(driveGain) : 1;
  let dcIn = 0, dcOut = 0;
  const gl = right ? Math.cos((t.pan + 1) * Math.PI / 4) * Math.SQRT2 : 1, gr = right ? Math.sin((t.pan + 1) * Math.PI / 4) * Math.SQRT2 : 0;

  for (let i = 0; i < n; i++) {
    let f = base;
    if (arp) {
      const step = Math.floor(i / arpN);
      f *= arp[t.arpLoop ? step % arp.length : Math.min(step, arp.length - 1)];
    }
    if (vib) f *= 1 + vib * Math.sin(vibStep * i);
    if (jitRng) {
      if (i % jitEvery === 0) jitTarget = jitRng() * 2 - 1;
      jit += (jitTarget - jit) * 0.02;
      f *= 1 + t.jitter * 0.6 * jit;
    }
    const dt = Math.min(isNoise ? 1 : 0.49, f / sampleRate);

    let s;
    if (fm) { s = Math.sin(TAU * phase + t.fmDepth * Math.sin(TAU * fmPhase)); fmPhase += dt * t.fm; if (fmPhase >= 1) fmPhase -= Math.floor(fmPhase); }
    else if (t.wave === 'sine') s = Math.sin(TAU * phase);
    else if (t.wave === 'square') {
      let p2 = phase + 1 - t.duty; if (p2 >= 1) p2 -= 1;
      s = (phase < t.duty ? 1 : -1) + blep(phase, dt) - blep(p2, dt) - (2 * t.duty - 1); // the last term keeps a thin pulse centred on zero
    } else if (t.wave === 'saw') s = 2 * phase - 1 - blep(phase, dt);
    else if (t.wave === 'triangle') s = 4 * Math.abs(phase - 0.5) - 1;
    else s = held;

    phase += dt;
    if (phase >= 1) { phase -= 1; if (isNoise) held = rng() * 2 - 1; }

    if (cutoff > 0) {
      if ((i & 31) === 0) lpA = 1 - Math.exp((-TAU * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
      lp += lpA * (s - lp); s = lp; cutoff *= lpSlide;
    }
    if (hpA) { hp += hpA * (s - hp); s -= hp; }
    if (band > 0) {
      if ((i & 31) === 0) {
        const g = Math.tan(Math.PI * Math.min(band, sampleRate * 0.45) / sampleRate);
        a1 = 1 / (1 + g * (g + bpK)); a2 = g * a1; a3 = g * a2;
      }
      const v3 = s - b2, v1 = a1 * b1 + a2 * v3, v2 = b2 + a2 * b1 + a3 * v3;
      b1 = 2 * v1 - b1; b2 = 2 * v2 - b2;
      s = v1 * bpGain; band *= bpSlide;
    }
    if (t.drive > 0) { // distortion can push the wave off centre; the two lines after it pull it back
      const d = Math.tanh(s * driveGain) * driveNorm;
      dcOut = d - dcIn + 0.997 * dcOut; dcIn = d; s = dcOut;
    }

    let env = i < attackN ? i / attackN : 1;
    if (decayRate && i >= attackN) env *= t.sustain + (1 - t.sustain) * Math.exp(-decayRate * (i - attackN));
    if (i >= n - releaseN) env *= (n - i) / releaseN;
    if (t.tremoloDepth > 0) env *= 1 - t.tremoloDepth * (0.5 - 0.5 * Math.cos(tremStep * i));

    base *= slide;
    let at = start + i;
    if (at >= out.length) { if (!wrap) break; at %= out.length; }
    if (right) { const x = s * env * t.volume; out[at] += x * gl; right[at] += x * gr; }
    else out[at] += s * env * t.volume;
  }
  return out;
}

/** limit(samples, peak?) -> samples. Scales the whole buffer down if it is louder than `peak` (never up). */
export function limit(samples, peak = 0.95) {
  let max = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > max) max = a; }
  if (max > peak) { const k = peak / max; for (let i = 0; i < samples.length; i++) samples[i] *= k; }
  return samples;
}

/** soundLayers(sound, fn?) -> list of validated tones. Throws on a bad sound. */
export function soundLayers(sound, fn = 'soundLayers') {
  if (sound && Array.isArray(sound.layers)) {
    if (sound.layers.length === 0) throw new Error(`${fn}: sound.layers is empty, add at least one tone`);
    return sound.layers.map((t) => validateTone(t, fn));
  }
  return [validateTone(sound, fn)];
}

// renderSound and soundDuration live in render.js now (they know about effects and stereo).
export { renderSound, soundDuration } from './render.js';
