// The sound effect generator: a short description and a seed in, a sound out.
//   generateSound({ describe: 'heavy wooden door creak', seed: 3, style: 'crypt' })
// The same request always gives the same sound. The result's `sound` is plain
// data (tones plus effects) that audio.play, renderSound and renderStereo take.

import { createRng } from './rng.js';
import { parseDescription, LOCAL_TEXTURES, SOUND_KINDS } from './words.js';
import { soundStyle, MATERIALS } from './palettes.js';
import { KINDS_A } from './gen-kinds.js';
import { KINDS_B } from './gen-kinds-b.js';
import { SURFACES, SURFACE_NAMES, WEIGHTS } from './footsteps.js';
import { renderSound } from './render.js';
import { fxActive } from './fx.js';

const KINDS = { ...KINDS_A, ...KINDS_B };
const PHYSICAL = ['impact', 'door', 'break', 'explosion', 'rumble', 'creature', 'step', 'creak'];
const MATERIAL_KIND = { slime: 'squelch', water: 'splash', grass: 'step', dirt: 'step', gravel: 'step', sand: 'step', snow: 'step', leaves: 'step', carpet: 'step' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (x) => Math.round(x * 1000) / 1000;
const LIMITS = { freq: [20, 18000], freqEnd: [20, 18000], duration: [0.01, 8], delay: [0, 8], volume: [0, 1], attack: [0, 4], decay: [0.005, 8], release: [0, 4],
  lowpass: [40, 20000], lowpassEnd: [40, 20000], highpass: [20, 20000], bandpass: [40, 18000], bandpassEnd: [40, 18000], q: [0.3, 30], tremoloRate: [0.1, 200], vibratoRate: [0.1, 100], arpSpeed: [0.01, 5], pan: [-1, 1] };

// Rounds a tone's numbers and keeps them inside what the synthesizer accepts, whatever the seed did.
function tidy(tone) {
  const out = {};
  for (const [key, value] of Object.entries(tone)) {
    if (typeof value !== 'number') { out[key] = value; continue; }
    out[key] = key === 'seed' ? value : round(LIMITS[key] ? clamp(value, ...LIMITS[key]) : value);
  }
  return out;
}

// Builds one sound: runs the recipe, applies style, size, space and texture, sets the loudness.
function assemble({ build, parsed, kind, material, seed, style, attempt, reverbScale = 1, pitch = 1, loudness = 1 }) {
  const st = soundStyle(style, 'generateSound'), mods = parsed.mods, tex = parsed.textures;
  const rng = createRng(`${kind}:${parsed.words.join(' ')}:${seed}:${attempt}`);
  const used = { material: false, textures: new Set(), said: new Set() };
  const factor = st.sfx.pitch * mods.pitch * pitch / Math.pow(mods.size, 0.55) * (tex.has('dark') ? 0.8 : 1) * (tex.has('bright') ? 1.15 : 1) * (tex.has('cute') ? 1.25 : 1) * (tex.has('spooky') ? 0.9 : 1);
  const stretch = mods.length * Math.pow(mods.size, 0.4);
  const c = {
    rng,
    v: (x, spread = 0.12) => x * (1 + (rng() * 2 - 1) * spread),
    pick: (list) => list[Math.floor(rng() * list.length)],
    seed: () => 1 + Math.floor(rng() * 999983),
    P: (hz) => clamp(hz * factor, 20, 18000),
    D: (s) => s * stretch,
    mat: (fallback) => { used.material = true; return MATERIALS[material] ?? MATERIALS[fallback]; },
    has: (t) => { if (tex.has(t)) { used.textures.add(t); return true; } return false; },
    said: (w) => { if (parsed.said.has(w)) { used.said.add(w); return true; } return false; },
    wave: tex.has('retro') ? 'square' : st.sfx.wave,
    size: mods.size,
  };
  const layers = build(c);
  // Words the recipe had no use for still leave their mark, so "metallic explosion" and "wet footsteps" mean something.
  if (material && !used.material && MATERIALS[material]) {
    const m = c.mat(material), f = c.P(c.v(m.f));
    m.modes.slice(0, 3).forEach((ratio, i) => layers.push({ wave: 'sine', freq: f * ratio, duration: c.D(m.ring * 2.4 / (i + 1) + 0.06), delay: 0.015 * (i + 1), decay: m.ring * 1.8 / (i + 1) + 0.03, sustain: 0, volume: 0.2 / (i + 1), pan: i % 2 ? 0.3 : -0.3 }));
    layers.push({ wave: 'noise', freq: m.noise, duration: 0.04 + m.ring * 0.1, delay: 0.01, decay: 0.04, sustain: 0, lowpass: Math.min(18000, m.noise * 1.5), volume: 0.18, seed: c.seed() });
  }
  if (tex.has('wet') && !used.textures.has('wet')) {
    used.textures.add('wet');
    layers.push({ wave: 'noise', freq: 6000, freqEnd: 1800, duration: c.D(0.2), attack: 0.012, decay: 0.16, sustain: 0, highpass: 700, volume: 0.22, seed: c.seed() });
    layers.push({ wave: 'sine', freq: c.P(c.v(480, 0.2)), freqEnd: c.P(950), duration: 0.05, delay: c.D(0.06), decay: 0.04, sustain: 0, volume: 0.12 });
  }
  if (tex.has('rusty') && !used.textures.has('rusty')) {
    used.textures.add('rusty');
    for (const t of layers) if (t.wave !== 'noise' && !t.jitter) { t.jitter = 0.2; t.seed ??= c.seed(); }
    layers.push({ wave: 'noise', freq: 3500, duration: c.D(0.15), attack: 0.01, release: 0.08, bandpass: c.P(2400), q: 3, tremoloDepth: 0.8, tremoloRate: 55, volume: 0.1, seed: c.seed() });
  }
  // Big things move air: a low thump under anything physical. Hard hits get a sharper front edge.
  if (mods.size >= 1.3 && PHYSICAL.includes(kind)) layers.push({ wave: 'sine', freq: c.P(58), freqEnd: c.P(33), duration: c.D(0.32), decay: 0.26, sustain: 0, volume: Math.min(0.5, 0.3 * mods.size) });
  if (mods.force >= 1.25) layers.push({ wave: 'noise', freq: 8000, duration: 0.012, decay: 0.01, sustain: 0, highpass: 2500, volume: 0.3, seed: c.seed() });
  if (tex.has('magic')) {
    const f = c.P(c.v(1900, 0.1));
    [0, 4, 7, 12].forEach((semi, i) => layers.push({ wave: 'sine', freq: f * Math.pow(2, semi / 12), fm: 3.01, fmDepth: 0.6, duration: 0.3, delay: c.D(0.05 + i * 0.07), decay: 0.24, sustain: 0, volume: 0.12, pan: (i % 2 ? 0.5 : -0.5) }));
  }
  const tones = layers.map((t) => tidy({ ...t, attack: Math.max(t.attack ?? 0.002, t.wave === 'noise' ? 0 : st.sfx.soft) }));

  const fx = { ...st.sfx.fx };
  if (fx.reverb) fx.reverb = round(fx.reverb * reverbScale);
  if (mods.space === 'far') { fx.lowpass = Math.min(fx.lowpass || 20000, 2200); fx.reverb = Math.max(fx.reverb ?? 0, 0.3); fx.room = Math.max(fx.room ?? 0, 0.7); }
  if (mods.space === 'echo') { fx.reverb = Math.max(fx.reverb ?? 0, 0.45); fx.room = Math.max(fx.room ?? 0, 0.85); fx.echo = 0.25; fx.echoTime = 0.28; }
  if (mods.space === 'dry') { fx.reverb = 0; fx.echo = 0; }
  if (tex.has('dark')) fx.lowpass = Math.min(fx.lowpass || 20000, 3200);
  if (mods.force <= 0.6) fx.lowpass = Math.min(fx.lowpass || 20000, 6000); // soft things have no hard edge
  if (tex.has('spooky')) { fx.reverb = Math.max(fx.reverb ?? 0, 0.35); fx.room = Math.max(fx.room ?? 0, 0.8); }
  if (tex.has('retro')) { fx.crush = 6; fx.reverb = 0; }
  fx.highpass = fx.highpass || 30; // keeps every generated sound centred on zero, with no sub-bass thump
  const sound = { layers: tones };
  if (fxActive(fx)) sound.fx = Object.fromEntries(Object.entries(fx).filter(([, v]) => v !== 0));

  // Loudness: every generated sound peaks at the same level, scaled by "soft" / "loud" and distance.
  const target = clamp(0.7 * Math.pow(mods.force, 0.6) * (mods.space === 'far' ? 0.6 : 1) * loudness, 0.05, 0.95);
  const probe = renderSound({ ...sound, volume: 1 }, 22050);
  let peak = 0;
  for (let i = 0; i < probe.length; i++) { const a = Math.abs(probe[i]); if (!(a <= 1e9)) { peak = NaN; break; } if (a > peak) peak = a; }
  if (!(peak > 0.002)) return null; // silent or broken: the caller tries the next variation
  sound.volume = round(clamp(target / peak, 0.02, 8));
  return { sound, used, seconds: round(probe.length / 22050), pitch: round(factor) };
}

function finish(base, parsed, built, kindFromObject) {
  const unused = [];
  const natural = MATERIAL_KIND[base.material] === base.kind; // "slime squelch": the material is the sound
  if (parsed.materialWord && !built.used.material && !natural && !(parsed.materialFromObject && kindFromObject)) unused.push(parsed.materialWord);
  for (const t of LOCAL_TEXTURES) if (parsed.textures.has(t) && !built.used.textures.has(t)) unused.push(parsed.textures.get(t));
  if (parsed.objectWord && parsed.objectKind !== base.kind && !built.used.said.has(parsed.objectWord) && !(parsed.objectMaterial === base.material && built.used.material) && !unused.includes(parsed.objectWord)) unused.push(parsed.objectWord);
  return { ...base, seconds: built.seconds, pitch: built.pitch, sound: built.sound, guessed: parsed.guessed, ignored: parsed.ignored, unused, ...(parsed.fallback ? { fallback: parsed.fallback } : {}) };
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'sound';

/**
 * generateSound(request) -> { name, describe, seed, style, kind, material, seconds, pitch, sound, guessed, ignored, unused }
 *   request: a description string, or { describe, seed, style, kind }
 *     describe: a few words: what it is, what it is made of, how big, where.
 *               "heavy wooden door creak", "slime squelch", "coin pickup", "distant thunder"
 *     seed:     number or string; the same request always gives the same sound (default 1)
 *     style:    one of SOUND_STYLE_NAMES (default 'storybook')
 *     kind:     force one of SOUND_KINDS instead of reading it from the description
 *   sound:   plain data for audio.play(), audio.define(), renderSound() and renderStereo()
 *   pitch:   how much higher (above 1) or lower the described size and style made it; recorded layers follow it
 *   guessed: [{ word, as }] misspelt or unusual words and the vocabulary word they were read as
 *   ignored: words the generator could not read      unused: known words this kind of sound has no use for
 * Phrases, synonyms and "very" / "slightly" are understood. When no word says what the sound is,
 * the result is the sound of the most similar vocabulary word (named in `fallback`), never just a blip.
 */
export function generateSound(request = {}) {
  const req = typeof request === 'string' ? { describe: request } : request;
  if (!req || typeof req !== 'object') throw new Error(`generateSound: expected a description or { describe, seed, style }, got ${JSON.stringify(request)}`);
  const { describe = '', seed = 1, style = 'storybook' } = req;
  soundStyle(style, 'generateSound');
  const parsed = parseDescription(describe);
  if (req.kind !== undefined && !SOUND_KINDS.includes(req.kind)) throw new Error(`generateSound: unknown kind "${req.kind}". Kinds: ${SOUND_KINDS.join(', ')}`);
  let material = parsed.material;
  let kind = req.kind ?? parsed.kind;
  const kindFromObject = !kind && Boolean(parsed.objectKind);
  kind ??= parsed.objectKind ?? (material ? MATERIAL_KIND[material] ?? 'impact' : 'ui');
  if (kind === 'impact' && (material === 'water' || material === 'slime')) kind = MATERIAL_KIND[material];
  let build = KINDS[kind], reverbScale = kind === 'ui' ? 0.3 : 1;
  if (kind === 'step') {
    const surface = SURFACE_NAMES.includes(material) ? material : material === 'slime' ? 'mud' : 'stone';
    build = (c) => { c.mat(surface); return SURFACES[surface](c); };
    reverbScale = 0.5;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const built = assemble({ build, parsed, kind, material, seed, style, attempt, reverbScale });
    if (built) return finish({ name: slug(describe || kind), describe, seed, style, kind, material }, parsed, built, kindFromObject);
  }
  throw new Error(`generateSound: could not make an audible sound for ${JSON.stringify(describe)} with seed ${JSON.stringify(seed)}; try another seed`);
}

/**
 * footstep(surface, { seed, style, weight }?) -> { name, kind: 'step', surface, seed, style, seconds, sound }
 *   surface: one of SURFACE_NAMES (grass, stone, wood, gravel, snow, water...)
 *   seed:    each seed is a different step on the same ground; play a few in turn (default 1)
 *   weight:  'light', 'normal' or 'heavy' (default 'normal')
 */
export function footstep(surface, options = {}) {
  if (!SURFACE_NAMES.includes(surface)) throw new Error(`footstep: unknown surface "${surface}". Surfaces: ${SURFACE_NAMES.join(', ')}`);
  const { seed = 1, style = 'storybook', weight = 'normal' } = options;
  if (!Object.hasOwn(WEIGHTS, weight)) throw new Error(`footstep: weight must be one of ${Object.keys(WEIGHTS).join(', ')}, got ${JSON.stringify(weight)}`);
  const parsed = parseDescription(`${surface} footstep`), w = WEIGHTS[weight];
  for (let attempt = 0; attempt < 4; attempt++) {
    const built = assemble({ build: (c) => { c.mat(surface); return SURFACES[surface](c); }, parsed, kind: 'step', material: surface, seed, style, attempt, reverbScale: 0.5, pitch: 1 / Math.pow(w, 0.6), loudness: 0.75 * Math.pow(w, 0.7) });
    if (built) return { name: `step-${surface}`, kind: 'step', surface, seed, style, weight, seconds: built.seconds, pitch: built.pitch, sound: built.sound };
  }
  throw new Error(`footstep: could not make an audible step for "${surface}" with seed ${JSON.stringify(seed)}`);
}

/**
 * generateTakes(request, count?) -> [asset, asset, ...]
 * The same sound `count` times (default 4) with seeds seed, seed+1, ...: slightly different each time.
 * audio.define(name, takes) then plays a different one on every play(name), so repeats never sound copied.
 */
export function generateTakes(request, count = 4) {
  const req = typeof request === 'string' ? { describe: request } : request;
  if (!(count >= 1 && count <= 16)) throw new Error(`generateTakes: count must be 1 to 16, got ${JSON.stringify(count)}`);
  const seed = req && req.seed !== undefined ? req.seed : 1;
  return Array.from({ length: count }, (_, i) => generateSound({ ...req, seed: typeof seed === 'number' ? seed + i : `${seed}:${i}` }));
}

/** isSoundAsset(value) -> true for what generateSound and footstep return (an object with a .sound). */
export function isSoundAsset(value) {
  return Boolean(value) && typeof value === 'object' && Boolean(value.sound) && typeof value.sound === 'object' && !Array.isArray(value.tracks);
}
