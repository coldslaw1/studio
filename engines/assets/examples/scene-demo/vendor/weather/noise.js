// Small deterministic helpers: a hash, smooth noise along a line, easing and colour mixing.
// Nothing here keeps state, so the same time always gives the same gust.

/** A float in [0, 1) from two whole numbers. */
export function hash2(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Smooth noise along a line: -1..1, changing about once per unit of x. `seed` picks the line. */
export function noise1(x, seed = 0) {
  const i = Math.floor(x); const f = x - i;
  const a = hash2(i, seed); const b = hash2(i + 1, seed);
  const s = f * f * (3 - 2 * f);
  return (a + (b - a) * s) * 2 - 1;
}

/** Two octaves of noise1: -1..1, with small quick changes on top of slow ones. */
export function fbm1(x, seed = 0) { return (noise1(x, seed) + 0.5 * noise1(x * 2.7 + 13.1, seed + 7)) / 1.5; }

/** 0..1 eased so it starts and ends gently. */
export const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** v held between lo and hi. */
export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

/** a + (b - a) * t. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** A seeded rng() for examples and defaults (mulberry32). Games pass their own. */
export function seededRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
