// Ready-made sound effects. sfx('coin') returns a sound object (plain data)
// that renderSound() or audio.play() can use. No audio files anywhere.

import { createRng } from './rng.js';

// Each recipe gets v(value, spread): returns value nudged by up to +-spread
// (a fraction). With seed 0 it returns value unchanged.
const RECIPES = {
  coin: (v) => ({ wave: 'square', freq: v(988), arp: [0, 5], arpSpeed: 0.07, duration: 0.38, decay: 0.3, sustain: 0, volume: 0.35 }),
  pickup: (v) => ({ wave: 'triangle', freq: v(660), arp: [0, 4, 7, 12], arpSpeed: 0.045, duration: 0.26, decay: 0.2, sustain: 0.1, volume: 0.5 }),
  jump: (v) => ({ wave: 'square', duty: 0.3, freq: v(240), freqEnd: v(680), duration: v(0.22), decay: 0.2, sustain: 0.2, volume: 0.35 }),
  bounce: (v) => ({ wave: 'triangle', freq: v(520), freqEnd: v(240), duration: 0.14, decay: 0.12, sustain: 0.1, volume: 0.5 }),
  laser: (v) => ({ wave: 'saw', freq: v(1500), freqEnd: v(220), duration: v(0.2), decay: 0.18, sustain: 0, lowpass: 7000, volume: 0.35 }),
  shoot: (v) => ({ layers: [
    { wave: 'square', duty: 0.25, freq: v(820), freqEnd: v(160), duration: 0.13, decay: 0.1, sustain: 0, volume: 0.35 },
    { wave: 'noise', freq: 6000, duration: 0.05, decay: 0.04, sustain: 0, volume: 0.25, seed: v(7, 0.9) },
  ] }),
  zap: (v) => ({ wave: 'square', freq: v(1800), freqEnd: v(320), arp: [0, 12], arpSpeed: 0.015, arpLoop: true, duration: 0.2, decay: 0.2, sustain: 0.1, volume: 0.3 }),
  explosion: (v) => ({ layers: [
    { wave: 'noise', freq: v(2600), freqEnd: 140, duration: v(0.75), decay: 0.6, sustain: 0, lowpass: 3200, lowpassEnd: 280, volume: 0.7, seed: v(11, 0.9) },
    { wave: 'sine', freq: v(115), freqEnd: 34, duration: 0.5, decay: 0.4, sustain: 0, volume: 0.7 },
  ] }),
  hit: (v) => ({ layers: [
    { wave: 'noise', freq: v(4200), freqEnd: 700, duration: 0.1, decay: 0.08, sustain: 0, volume: 0.5, seed: v(3, 0.9) },
    { wave: 'square', freq: v(230), freqEnd: 85, duration: 0.11, decay: 0.1, sustain: 0, volume: 0.35 },
  ] }),
  hurt: (v) => ({ wave: 'saw', freq: v(420), freqEnd: v(120), duration: 0.28, decay: 0.25, sustain: 0.1, vibratoDepth: 1.5, vibratoRate: 30, lowpass: 3500, volume: 0.4 }),
  thud: (v) => ({ wave: 'sine', freq: v(125), freqEnd: 40, duration: 0.2, decay: 0.16, sustain: 0, volume: 0.8 }),
  step: (v) => ({ wave: 'noise', freq: v(900, 0.2), duration: 0.05, decay: 0.04, sustain: 0, lowpass: 1400, volume: 0.3, seed: v(5, 0.9) }),
  land: (v) => ({ layers: [
    { wave: 'sine', freq: v(165), freqEnd: 58, duration: 0.13, decay: 0.1, sustain: 0, volume: 0.6 },
    { wave: 'noise', freq: 1200, duration: 0.06, decay: 0.05, sustain: 0, lowpass: 900, volume: 0.3, seed: v(9, 0.9) },
  ] }),
  splash: (v) => ({ wave: 'noise', freq: v(6500), freqEnd: 1500, duration: v(0.42), attack: 0.03, decay: 0.35, sustain: 0, highpass: 700, volume: 0.45, seed: v(13, 0.9) }),
  swish: (v) => ({ wave: 'noise', freq: v(1800), freqEnd: 7500, duration: 0.18, attack: 0.07, release: 0.09, highpass: 900, volume: 0.3, seed: v(17, 0.9) }),
  door: (v) => ({ layers: [
    { wave: 'triangle', freq: v(190), freqEnd: 120, duration: 0.1, decay: 0.08, sustain: 0, volume: 0.6 },
    { wave: 'triangle', freq: v(150), freqEnd: 95, duration: 0.14, delay: 0.11, decay: 0.1, sustain: 0, volume: 0.6 },
  ] }),
  teleport: (v) => ({ wave: 'sine', freq: v(300), freqEnd: v(1900), duration: 0.42, vibratoDepth: 2, vibratoRate: 25, attack: 0.02, release: 0.12, volume: 0.4 }),
  powerup: (v) => ({ wave: 'square', duty: 0.3, freq: v(330), freqEnd: v(660), arp: [0, 4, 7, 12], arpSpeed: 0.06, arpLoop: true, duration: 0.55, release: 0.1, volume: 0.3 }),
  blip: (v) => ({ wave: 'square', freq: v(660), duration: 0.05, volume: 0.3 }),
  tick: (v) => ({ wave: 'square', freq: v(1250), duration: 0.02, volume: 0.25 }),
  select: (v) => ({ wave: 'square', duty: 0.25, freq: v(880), duration: 0.07, decay: 0.06, sustain: 0.2, volume: 0.3 }),
  confirm: (v) => ({ wave: 'square', duty: 0.25, freq: v(660), arp: [0, 7], arpSpeed: 0.06, duration: 0.16, decay: 0.14, sustain: 0.2, volume: 0.3 }),
  cancel: (v) => ({ wave: 'square', duty: 0.25, freq: v(660), arp: [0, -7], arpSpeed: 0.06, duration: 0.16, decay: 0.14, sustain: 0.2, volume: 0.3 }),
  error: (v) => ({ layers: [
    { wave: 'square', freq: v(155), duration: 0.11, lowpass: 2500, volume: 0.35 },
    { wave: 'square', freq: v(155), duration: 0.16, delay: 0.14, lowpass: 2500, volume: 0.35 },
  ] }),
  alarm: (v) => ({ wave: 'square', freq: v(720), arp: [0, 6], arpSpeed: 0.12, arpLoop: true, duration: 0.72, lowpass: 5000, volume: 0.3 }),
  win: (v) => ({ layers: [
    { wave: 'square', duty: 0.3, freq: v(523.25, 0.03), arp: [0, 4, 7, 12, 16], arpSpeed: 0.09, duration: 0.85, decay: 0.8, sustain: 0.3, release: 0.2, volume: 0.3 },
    { wave: 'triangle', freq: v(261.63, 0.03), arp: [0, 0, 7, 7, 12], arpSpeed: 0.09, duration: 0.85, release: 0.2, volume: 0.35 },
  ] }),
  lose: (v) => ({ wave: 'triangle', freq: v(392, 0.03), arp: [0, -3, -7, -12], arpSpeed: 0.17, duration: 0.95, vibratoDepth: 0.4, vibratoRate: 6, release: 0.3, volume: 0.5 }),
};

/** Names of all built-in sound effects. */
export const SFX_NAMES = Object.keys(RECIPES);

/**
 * sfx(name, seed?) -> sound object (plain data, safe to edit or JSON-save)
 * seed 0 (default) is the standard version. Any other number or string gives a
 * repeatable variation of the same kind of sound.
 */
export function sfx(name, seed = 0) {
  const recipe = Object.hasOwn(RECIPES, name) ? RECIPES[name] : null;
  if (!recipe) throw new Error(`sfx: unknown sound "${name}". Built-in sounds: ${SFX_NAMES.join(', ')}`);
  const rng = createRng(`${name}:${seed}`);
  const round = (x) => Math.round(x * 1000) / 1000;
  const vary = seed === 0 ? (x) => x : (x, spread = 0.12) => round(x * (1 + (rng() * 2 - 1) * spread));
  return recipe(vary);
}
