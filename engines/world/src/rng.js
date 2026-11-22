// Seeded hashing and random numbers. Everything in a streamed world must come out the same
// whatever order chunks load in, so generation hashes ABSOLUTE coordinates instead of drawing
// numbers from one running stream.

/** hashSeed('garden-7') -> unsigned 32-bit integer. Accepts strings and numbers. */
export function hashSeed(seed) {
  const text = String(seed);
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * hash2(seed, x, y) -> unsigned 32-bit integer for an integer position (negative is fine).
 * @param {number} seed  unsigned 32-bit integer (use hashSeed for strings)
 */
export function hash2(seed, x, y) {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** rand2(seed, x, y) -> float in [0, 1) for an integer position. */
export function rand2(seed, x, y) {
  return hash2(seed, x, y) / 4294967296;
}

/**
 * createRng(seed) -> rng. rng() returns a float in [0, 1) (the studio-wide shape), plus
 * rng.int(min, max) (both ends included), rng.chance(p) and rng.pick(array).
 * @param {number|string} seed
 */
export function createRng(seed = 0) {
  let a = typeof seed === 'number' && Number.isInteger(seed) ? seed >>> 0 : hashSeed(seed);
  const rng = () => { // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (min, max) => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new Error(`rng.int(${min}, ${max}): need integers with min <= max`);
    return min + Math.floor(rng() * (max - min + 1));
  };
  rng.chance = (p) => rng() < p;
  rng.pick = (array) => {
    if (!array.length) throw new Error('rng.pick: empty array');
    return array[Math.floor(rng() * array.length)];
  };
  return rng;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** valueNoise(seed, x, y) -> smooth noise in [0, 1) at any (fractional) position. */
export function valueNoise(seed, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = rand2(seed, x0, y0);
  const b = rand2(seed, x0 + 1, y0);
  const c = rand2(seed, x0, y0 + 1);
  const d = rand2(seed, x0 + 1, y0 + 1);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * fbm(seed, x, y, octaves) -> layered noise in [0, 1): big shapes plus smaller detail.
 * Each octave doubles the frequency and halves the strength.
 */
export function fbm(seed, x, y, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seed + o * 1013, x, y);
    total += amp;
    amp *= 0.5;
    x *= 2;
    y *= 2;
  }
  return sum / total;
}
