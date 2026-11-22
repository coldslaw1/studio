// Seeded random numbers, so every run can be replayed exactly.

/** hashString(text) -> unsigned 32-bit integer (FNV-1a with a final mix). */
export function hashString(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * createRng(seed) -> rng
 *   rng()            float in [0, 1)   (same call shape as Math.random)
 *   rng.int(n)       integer in [0, n)
 *   rng.pick(array)  one element
 *   rng.chance(p)    true with probability p
 *   rng.fork(label)  an independent rng derived from this one's seed
 * The seed may be a number or a string.
 */
export function createRng(seed) {
  const base = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  let a = base;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (array) => array[Math.floor(rng() * array.length)];
  rng.chance = (p) => rng() < p;
  rng.fork = (label) => createRng(`${base}|${label}`);
  return rng;
}
