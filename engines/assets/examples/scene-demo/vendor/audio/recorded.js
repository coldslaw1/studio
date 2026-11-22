// Recorded layers under generated sounds. A sample pack (samples.js) may hold recordings tagged
// with the generator's own words ("wood", "impact", "door", "creak"). When every tag of a recording
// is among the words of a described sound, the recording becomes the body of that sound: it is
// re-pitched by the described size, the synthesised version is mixed in quietly underneath (so the
// art style still colours it), and the style's room and the described distance are applied as
// before. With no fitting recording, or no pack, nothing changes.
//
//   const asset = generateSound({ describe: 'heavy wooden door creak', style: 'crypt' });
//   renderRecorded(asset, bank)                 -> { left, right } (falls back to the synthesised sound)
//   createAudio({ samples: bank }).play(asset)  does the same on its own
import { createRng } from './rng.js';
import { renderStereo, limitPair } from './render.js';
import { applyFx, fxActive, fxTail } from './fx.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * recordedMatch(bank, asset) -> { sound, take, takes } or null.
 * asset: what generateSound or footstep returned. The recording whose tags are all among the sound's
 * words wins (its kind, its material and the words of the description); more tags beat fewer.
 * asset.recorded === false switches recordings off for that sound.
 */
export function recordedMatch(bank, asset) {
  if (!bank || !asset || asset.recorded === false || typeof bank.matchSound !== 'function') return null;
  const words = new Set([asset.kind, asset.material, asset.surface, ...String(asset.describe ?? '').toLowerCase().split(/[^a-z]+/)].filter(Boolean));
  const [name] = bank.matchSound([...words]);
  if (!name) return null;
  const takes = bank.sound(name).takes;
  return { sound: name, take: Math.floor(createRng(`take:${name}:${asset.seed ?? 1}`)() * takes), takes };
}

/**
 * renderRecorded(asset, bank, sampleRate?, { under }?) -> { left, right, recorded }
 * recorded is the name of the recording used, or null when the plain synthesised sound was returned.
 * under: how loud the synthesised version sits beneath the recording, 0 to 1 (default 0.3).
 */
export function renderRecorded(asset, bank, sampleRate = 44100, options = {}) {
  if (!asset || typeof asset !== 'object' || !asset.sound) throw new Error('renderRecorded: expected an asset from generateSound or footstep');
  const match = recordedMatch(bank, asset);
  if (!match) return { ...renderStereo(asset.sound, sampleRate), recorded: null };
  const under = clamp(options.under ?? 0.3, 0, 1);
  const rec = bank.sound(match.sound, match.take), fx = asset.sound.fx && fxActive(asset.sound.fx) ? asset.sound.fx : null;
  const full = renderStereo(asset.sound, sampleRate); // the synthesised sound as it would have played: its peak is the loudness asked for
  let target = 0;
  for (let i = 0; i < full.left.length; i++) target = Math.max(target, Math.abs(full.left[i]), Math.abs(full.right[i]));
  const dry = fx ? renderStereo({ ...asset.sound, fx: undefined }, sampleRate) : full;
  const step = clamp(asset.pitch ?? 1, 0.5, 1.8) * rec.sampleRate / sampleRate, src = rec.data;
  const recN = Math.floor((src.length - 1) / step), n = Math.max(recN, dry.left.length) + Math.round((fx ? fxTail(fx) : 0) * sampleRate);
  let left = new Float32Array(n), right = new Float32Array(n), peak = 0;
  for (let i = 0; i < src.length; i++) peak = Math.max(peak, Math.abs(src[i]));
  const gain = peak > 0 ? 0.7 / peak : 0;
  for (let i = 0; i < recN; i++) { const p = i * step, k = Math.floor(p), x = (src[k] + (src[k + 1] - src[k]) * (p - k)) * gain; left[i] = x; right[i] = x; }
  for (let i = 0; i < dry.left.length; i++) { left[i] += dry.left[i] * under; right[i] += dry.right[i] * under; }
  if (fx) {
    applyFx(left, right, fx, sampleRate);
    let last = n - 1;
    while (last > 0 && Math.abs(left[last]) < 0.0012 && Math.abs(right[last]) < 0.0012) last--;
    const keep = Math.min(n, last + Math.round(sampleRate * 0.05));
    left = left.subarray(0, keep); right = right.subarray(0, keep);
  }
  const fade = Math.min(left.length, Math.round(sampleRate * 0.01));
  for (let i = 0; i < fade; i++) { const k = i / fade; left[left.length - 1 - i] *= k; right[right.length - 1 - i] *= k; }
  // the mix of two layers is brought back to the loudness the description asked for
  let mixed = 0;
  for (let i = 0; i < left.length; i++) mixed = Math.max(mixed, Math.abs(left[i]), Math.abs(right[i]));
  if (mixed > 0 && target > 0) { const k = target / mixed; for (let i = 0; i < left.length; i++) { left[i] *= k; right[i] *= k; } }
  limitPair(left, right);
  return { left, right, recorded: match.sound };
}

/** recordedPlan(asset, bank, sampleRate?) -> the render-queue form of renderRecorded (see render-queue.js). */
export function recordedPlan(asset, bank, sampleRate = 44100) {
  let channels = null;
  const cost = Math.round((asset.seconds ?? 1) * sampleRate) * ((asset.sound.layers?.length ?? 1) + 6);
  return { jobs: [[cost, () => { const s = renderRecorded(asset, bank, sampleRate); channels = [s.left, s.right]; }]], done: () => channels };
}
