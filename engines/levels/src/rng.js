// Seeded random numbers. Same seed -> same numbers, on every machine, forever.
// Never use Math.random() in a generator: levels must be reproducible from the seed.

/** hashSeed('garden-7') -> unsigned 32-bit integer. Accepts strings and numbers. */
export function hashSeed(seed) {
  const text = String(seed);
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // final mix so that similar seeds ('a1', 'a2') give unrelated streams
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * createRng(seed) -> rng
 *
 * rng is a FUNCTION: rng() returns a float in [0, 1). That is the studio-wide
 * shape, so it can be passed to any other engine. It also carries helpers:
 *
 *   rng.seed            the seed it was made from (as given)
 *   rng.int(min, max)   integer, both ends INCLUDED
 *   rng.chance(p)       true with probability p (0..1)
 *   rng.pick(array)     one random element (throws on an empty array)
 *   rng.shuffle(array)  a NEW shuffled array (the input is not changed)
 *   rng.weighted(items, weights)  one item, chosen in proportion to its weight
 *   rng.fork(label)     an independent rng derived from this seed + label.
 *                       Forking does NOT consume numbers from the parent, so
 *                       adding a fork never changes what the parent produces.
 */
export function createRng(seed = 0) {
  let a = hashSeed(seed);
  const next = () => { // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = withHelpers(next);
  rng.seed = seed;
  rng.fork = (label) => createRng(`${seed}/${label}`);
  return rng;
}

/**
 * withHelpers(fn) -> rng. Wraps ANY function returning a float in [0, 1)
 * (for example the rng from the core engine) and adds int, chance, pick,
 * shuffle and weighted. Returns the argument unchanged when it already has them.
 * Every function in this engine that takes an rng calls this for you.
 */
export function withHelpers(fn) {
  if (typeof fn !== 'function') throw new Error(`withHelpers: rng must be a function returning 0..1, got ${typeof fn}`);
  if (typeof fn.int === 'function') return fn;
  const rng = () => fn();
  rng.int = (min, max) => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error(`rng.int(${min}, ${max}): need integers with min <= max`);
    }
    return min + Math.floor(fn() * (max - min + 1));
  };
  rng.chance = (p) => fn() < p;
  rng.pick = (array) => {
    if (!array.length) throw new Error('rng.pick: empty array');
    return array[rng.int(0, array.length - 1)];
  };
  rng.shuffle = (array) => {
    const out = array.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  rng.weighted = (items, weights) => {
    if (!items.length || items.length !== weights.length) {
      throw new Error('rng.weighted: items and weights must be the same non-zero length');
    }
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = fn() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll < 0) return items[i];
    }
    return items[items.length - 1];
  };
  return rng;
}
