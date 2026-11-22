// Seeded random numbers for loot. Same seed -> same drops, on every machine.
// Any rng() that returns a float in [0, 1) works with this engine (core's
// createRng, net's ctx.rng); this one exists so a chest can be rolled from a
// seed and a few numbers without keeping an rng object in the save.

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * seededRng(seed, ...salt) -> rng() returning a float in [0, 1)
 * seed and every salt value are numbers or strings. The salt separates
 * streams: seededRng(worldSeed, 'chest', x, y) gives each chest its own,
 * repeatable, loot.
 */
export function seededRng(seed, ...salt) {
  let s = 0x9e3779b9;
  for (const part of [seed, ...salt]) {
    if (typeof part !== 'string' && !Number.isFinite(part)) {
      throw new Error(`seededRng: seed and salt must be numbers or strings, got ${String(part)}`);
    }
    const h = typeof part === 'string' ? hashString(part) : hashString(String(part));
    s = Math.imul(s ^ h, 0x85ebca6b) >>> 0;
    s = (s ^ (s >>> 13)) >>> 0;
  }
  return () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** randomInt(rng, min, max) -> integer from min to max, both included. */
export function randomInt(rng, min, max) {
  return min + Math.min(max - min, Math.floor(rng() * (max - min + 1)));
}

/** range(value, what) -> [min, max] from a number or a [min, max] pair of integers >= 0. Throws otherwise. */
export function range(value, what) {
  const pair = Array.isArray(value) ? value : [value, value];
  if (pair.length !== 2 || !pair.every((v) => Number.isInteger(v) && v >= 0) || pair[1] < pair[0]) {
    throw new Error(`${what} must be an integer >= 0 or [min, max], got ${JSON.stringify(value)}`);
  }
  return pair;
}
