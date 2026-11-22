// Seeded random numbers. Same seed -> same sequence, on every machine.

/**
 * createRng(seed) -> rng
 *   rng()            float in [0, 1)
 *   rng.int(a, b)    integer from a to b, both included
 *   rng.pick(array)  one element of a non-empty array
 *   rng.chance(p)    true with probability p (0..1)
 * seed: integer or string. Strings are hashed.
 */
export function createRng(seed = 1) {
  let s = typeof seed === 'string' ? hashString(seed) : (Number(seed) >>> 0);
  if (!Number.isFinite(Number(seed)) && typeof seed !== 'string') {
    throw new Error(`createRng: seed must be a number or string, got ${seed}`);
  }
  const rng = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (a, b) => {
    if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) {
      throw new Error(`rng.int: need integers with a <= b, got ${a}, ${b}`);
    }
    return a + Math.floor(rng() * (b - a + 1));
  };
  rng.pick = (array) => {
    if (!Array.isArray(array) || array.length === 0) {
      throw new Error('rng.pick: need a non-empty array');
    }
    return array[Math.floor(rng() * array.length)];
  };
  rng.chance = (p) => rng() < p;
  return rng;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
