// Seeded randomness. Agents never share one running stream: each keeps a seed and a counter in its own
// (plain JSON) state, so an agent's rolls do not depend on how many other agents exist, in what order they
// were added, or whether it slept for a while.

/** hashSeed('wolf-7') -> unsigned 32-bit integer. Accepts strings and numbers. */
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

/** hashInts(a, b) -> unsigned 32-bit integer mixed from two integers. */
export function hashInts(a, b) {
  let h = (a | 0) ^ Math.imul(b | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** rand2(seed, n) -> float in [0, 1) for the n-th roll of a seed. Same inputs, same answer, always. */
export const rand2 = (seed, n) => hashInts(seed, n) / 4294967296;

/**
 * roll(holder) -> float in [0, 1). The holder is any plain object with integer fields `seed` and `n`
 * (an agent, a squad, the ai state); the counter moves on by one.
 */
export function roll(holder) {
  holder.n = (holder.n + 1) | 0;
  return rand2(holder.seed, holder.n);
}

/** rollRange(holder, lo, hi) -> float in [lo, hi). */
export const rollRange = (holder, lo, hi) => lo + roll(holder) * (hi - lo);

/** rollPick(holder, array) -> one item of a non-empty array. */
export function rollPick(holder, array) {
  if (!array.length) throw new Error('rollPick: empty array');
  return array[Math.floor(roll(holder) * array.length)];
}

/**
 * createRng(seed) -> rng. rng() returns a float in [0, 1) (the studio-wide shape, same as core's
 * createRng), for callers that want an ordinary stream, such as a demo scattering agents.
 */
export function createRng(seed = 0) {
  let a = typeof seed === 'number' && Number.isInteger(seed) ? seed >>> 0 : hashSeed(seed);
  return () => { // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
