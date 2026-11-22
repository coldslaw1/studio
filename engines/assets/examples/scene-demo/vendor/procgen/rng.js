// Seeded random numbers. Everything procgen makes comes from one seed, so the same seed always
// gives the same dungeon, camp or quest. Each part of a generator takes its own fork of the
// stream (rng.fork('loot')), so adding a room prop never changes where the monsters stand.

/** hashSeed('crypt-7') -> unsigned 32-bit integer. Accepts strings and numbers. Same as the world engine's. */
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

/** seedOf(seed, ...labels) -> unsigned 32-bit integer for a seed plus any labels ('chest', 3, 12). */
export function seedOf(seed, ...labels) {
  let h = typeof seed === 'number' && Number.isInteger(seed) ? seed >>> 0 : hashSeed(seed);
  for (const label of labels) h = hashSeed(`${h}/${label}`);
  return h;
}

/**
 * createRng(seed, ...labels) -> rng. rng() returns a float in [0, 1) (the studio-wide shape).
 *   rng.int(min, max)       whole number, both ends included
 *   rng.range(min, max)     float in [min, max)
 *   rng.chance(p)           true with probability p
 *   rng.pick(array)         one element
 *   rng.shuffle(array)      a shuffled copy
 *   rng.weighted(table)     a key of { key: weight } (or of [[key, weight], ...])
 *   rng.fork(label)         an independent rng that depends only on the seed and the label
 *   rng.seed                the unsigned 32-bit seed it started from
 */
export function createRng(seed = 0, ...labels) {
  const start = seedOf(seed, ...labels);
  let a = start;
  const rng = () => { // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.seed = start;
  rng.int = (min, max) => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new Error(`rng.int(${min}, ${max}): need integers with min <= max`);
    return min + Math.floor(rng() * (max - min + 1));
  };
  rng.range = (min, max) => min + rng() * (max - min);
  rng.chance = (p) => rng() < p;
  rng.pick = (array) => {
    if (!Array.isArray(array) || !array.length) throw new Error('rng.pick: need a non-empty array');
    return array[Math.floor(rng() * array.length)];
  };
  rng.shuffle = (array) => {
    const out = array.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  };
  rng.weighted = (table) => {
    const entries = Array.isArray(table) ? table : Object.entries(table);
    let total = 0;
    for (const [, w] of entries) total += Math.max(0, w);
    if (!entries.length || total <= 0) throw new Error(`rng.weighted: need at least one positive weight, got ${JSON.stringify(table)}`);
    let roll = rng() * total;
    for (const [key, w] of entries) { roll -= Math.max(0, w); if (roll < 0) return key; }
    return entries[entries.length - 1][0];
  };
  rng.fork = (label) => createRng(start, label);
  return rng;
}

/** round2(n) -> n rounded to 2 decimals, so generated positions are short and identical on every machine. */
export function round2(n) {
  return Math.round(n * 100) / 100;
}
