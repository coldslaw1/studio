// Turns sound objects into samples. A sound is one tone, or
// { layers: [tone, ...], volume?, fx? } where fx adds room, echo and tone
// (see fx.js). Mono for games' one-shots, stereo when a sound has panned
// layers or effects.

import { addTone, limit, soundLayers } from './synth.js';
import { applyFx, fxActive, fxTail, validateFx } from './fx.js';

function measure(sound, fn) {
  const layers = soundLayers(sound, fn);
  const fx = sound && sound.layers && sound.fx ? validateFx(sound.fx, fn) : null;
  let seconds = 0;
  for (const t of layers) seconds = Math.max(seconds, t.delay + t.duration);
  const stereo = (fx && fxActive(fx)) || layers.some((t) => t.pan !== 0);
  return { layers, fx: fx && fxActive(fx) ? fx : null, dry: seconds, seconds: seconds + (fx && fxActive(fx) ? fxTail(fx) : 0), stereo };
}

/** soundDuration(sound) -> seconds, including the tail of any reverb or echo */
export function soundDuration(sound) {
  return measure(sound, 'soundDuration').seconds;
}

/**
 * renderStereo(sound, sampleRate?) -> { left, right } Float32Arrays in -1..1
 * Layers are placed by their `pan`; sound.fx is applied to the whole mix.
 */
export function renderStereo(sound, sampleRate = 44100) {
  const m = measure(sound, 'renderStereo');
  const n = Math.max(1, Math.round(m.seconds * sampleRate));
  let left = new Float32Array(n), right = new Float32Array(n);
  for (const t of m.layers) addTone(left, sampleRate, t, false, right);
  const volume = sound.layers && typeof sound.volume === 'number' ? sound.volume : 1;
  if (volume !== 1) for (let i = 0; i < n; i++) { left[i] *= volume; right[i] *= volume; }
  if (m.fx) {
    applyFx(left, right, m.fx, sampleRate);
    // The room was given time to ring out; drop the part of the tail that is already silent.
    let last = n - 1;
    while (last > 0 && Math.abs(left[last]) < 0.0012 && Math.abs(right[last]) < 0.0012) last--;
    const keep = Math.min(n, Math.max(Math.round(m.dry * sampleRate), last + Math.round(sampleRate * 0.05)));
    left = left.subarray(0, keep); right = right.subarray(0, keep);
  }
  fadeEnd(left, sampleRate); fadeEnd(right, sampleRate);
  limitPair(left, right);
  return { left, right };
}

/**
 * renderSound(sound, sampleRate?) -> Float32Array of samples in -1..1 (mono)
 * A sound with effects or panned layers is rendered in stereo and folded down.
 */
export function renderSound(sound, sampleRate = 44100) {
  const m = measure(sound, 'renderSound');
  if (m.stereo) {
    const { left, right } = renderStereo(sound, sampleRate);
    for (let i = 0; i < left.length; i++) left[i] = (left[i] + right[i]) * 0.5;
    return left;
  }
  const out = new Float32Array(Math.max(1, Math.round(m.seconds * sampleRate)));
  for (const t of m.layers) addTone(out, sampleRate, t);
  const volume = sound.layers && typeof sound.volume === 'number' ? sound.volume : 1;
  if (volume !== 1) for (let i = 0; i < out.length; i++) out[i] *= volume;
  return limit(out);
}

/**
 * soundPlan(sound, sampleRate?) -> { jobs: [[cost, run]], done() -> [mono] or [left, right] }
 * The form createAudio's render queue takes (see render-queue.js).
 */
export function soundPlan(sound, sampleRate = 44100) {
  const m = measure(sound, 'soundPlan');
  let channels = null;
  const cost = Math.round(m.seconds * sampleRate) * (m.layers.length + (m.fx ? 4 : 0));
  return {
    jobs: [[cost, () => {
      if (m.stereo) { const s = renderStereo(sound, sampleRate); channels = [s.left, s.right]; } else channels = [renderSound(sound, sampleRate)];
    }]],
    done: () => channels,
  };
}

/** limitPair(left, right, peak?) -> scales both channels down together if either is louder than `peak`. */
export function limitPair(left, right, peak = 0.95) {
  let max = 0;
  for (let i = 0; i < left.length; i++) { const a = Math.abs(left[i]), b = Math.abs(right[i]); if (a > max) max = a; if (b > max) max = b; }
  if (max > peak) { const k = peak / max; for (let i = 0; i < left.length; i++) { left[i] *= k; right[i] *= k; } }
}

// A reverb tail is cut where the buffer ends; a short fade keeps that from clicking.
function fadeEnd(samples, sampleRate) {
  const n = Math.min(samples.length, Math.round(sampleRate * 0.03));
  for (let i = 0; i < n; i++) samples[samples.length - 1 - i] *= i / n;
}
