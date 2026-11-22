// Seeded random numbers. Same seed -> same sequence, on every machine.

/** hashSeed('coin:3') -> unsigned 32-bit integer. Accepts a number or a string. */
export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return (Math.floor(seed) >>> 0) || 0x9e3779b9;
  const text = String(seed);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 0x9e3779b9;
}

/**
 * createRng(seed) -> rng, where rng() returns a float in [0, 1).
 * Same shape as the rng from the core kit, so either can be passed in.
 */
export function createRng(seed = 1) {
  let a = hashSeed(seed);
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** pick(rng, list) -> one item of the list */
export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}
