/**
 * createRng(seed) returns rng(): a float in [0, 1). Deterministic for a given
 * seed (mulberry32), so tests and replays behave the same on every run.
 * Extras: rng.int(n) gives 0..n-1, rng.pick(array) gives a random element.
 */
export function createRng(seed) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}
