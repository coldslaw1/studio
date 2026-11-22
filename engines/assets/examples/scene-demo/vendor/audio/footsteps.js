// Footsteps by surface. Each recipe is a heel (low thump) plus what the sole
// does to the ground: a tick on stone, a swish in grass, a crunch in snow.
// Same contract as gen-kinds.js: a context `c` in, a list of tones out.

const heel = (c, hz, vol) => ({ wave: 'sine', freq: c.P(c.v(hz)), freqEnd: c.P(hz * 0.5), duration: c.D(0.09), decay: 0.07, sustain: 0, volume: vol });
const tick = (c, hz, len, vol) => ({ wave: 'noise', freq: c.v(hz, 0.2), duration: len, decay: len * 0.8, sustain: 0, lowpass: Math.min(18000, hz * 1.5), volume: vol, seed: c.seed() });
const grains = (c, n, hz, spread, vol) => Array.from({ length: n }, () => ({
  wave: 'noise', freq: hz * (0.6 + c.rng() * 0.9), duration: 0.012 + c.rng() * 0.03, delay: c.rng() * spread, decay: 0.025, sustain: 0,
  bandpass: c.P(hz * (0.7 + c.rng() * 0.7)), q: 1.5, volume: vol * (0.5 + c.rng() * 0.5), seed: c.seed(),
}));

export const SURFACES = {
  stone: (c) => [heel(c, 150, 0.5), tick(c, 2600, 0.035, 0.4)],
  wood: (c) => [heel(c, 185, 0.55), { wave: 'triangle', freq: c.P(c.v(215)), freqEnd: c.P(150), duration: c.D(0.11), decay: 0.09, sustain: 0, volume: 0.4 }, tick(c, 1800, 0.03, 0.3)],
  metal: (c) => [heel(c, 170, 0.4), { wave: 'sine', freq: c.P(c.v(690)), fm: 2.76, fmDepth: 1.2, duration: c.D(0.22), decay: 0.17, sustain: 0, volume: 0.3 }, tick(c, 5000, 0.02, 0.3)],
  grass: (c) => [heel(c, 110, 0.3), { wave: 'noise', freq: 6000, duration: c.D(0.1), attack: 0.02, release: 0.06, bandpass: c.P(c.v(2400, 0.25)), q: 0.8, volume: 0.4, seed: c.seed() }],
  dirt: (c) => [heel(c, 100, 0.45), tick(c, 800, 0.05, 0.4)],
  gravel: (c) => [heel(c, 120, 0.3), ...grains(c, 6, 3600, 0.1, 0.4)],
  sand: (c) => [heel(c, 95, 0.22), { wave: 'noise', freq: 9000, duration: c.D(0.13), attack: 0.03, release: 0.08, bandpass: c.P(c.v(3800, 0.2)), q: 0.7, volume: 0.4, seed: c.seed() }],
  snow: (c) => [heel(c, 90, 0.28), { wave: 'noise', freq: 5000, duration: c.D(0.17), attack: 0.02, release: 0.08, bandpass: c.P(c.v(1500, 0.2)), q: 2.2, tremoloDepth: 0.7, tremoloRate: c.v(62), volume: 0.5, seed: c.seed() }],
  leaves: (c) => [heel(c, 105, 0.2), ...grains(c, 5, 4200, 0.12, 0.38)],
  mud: (c) => [heel(c, 88, 0.45), { wave: 'noise', freq: 4000, duration: c.D(0.17), attack: 0.02, release: 0.08, bandpass: c.P(c.v(480)), bandpassEnd: c.P(c.v(1150)), q: 3, tremoloDepth: 0.7, tremoloRate: c.v(30), volume: 0.55, seed: c.seed() }],
  water: (c) => [
    heel(c, 100, 0.25),
    { wave: 'noise', freq: c.v(6000), freqEnd: 2000, duration: c.D(0.24), attack: 0.015, decay: 0.2, sustain: 0, highpass: 700, volume: 0.45, seed: c.seed() },
    { wave: 'sine', freq: c.P(c.v(420, 0.2)), freqEnd: c.P(880), duration: 0.05, delay: 0.05 + c.rng() * 0.06, decay: 0.04, sustain: 0, volume: 0.2 },
  ],
  carpet: (c) => [heel(c, 85, 0.4), tick(c, 480, 0.05, 0.3)],
};

/** Surfaces footstep() and audio.step() know. */
export const SURFACE_NAMES = Object.keys(SURFACES);

/** How much heavier or lighter feet change a step: pitch divides, loudness multiplies. */
export const WEIGHTS = { light: 0.75, normal: 1, heavy: 1.4 };
