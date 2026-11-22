// Small helpers shared by the stats engine files.

/** own(object, key) -> true when the key is the object's own (not inherited). */
export const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** need(condition, message) throws Error(message) when the condition is false. */
export function need(ok, message) { if (!ok) throw new Error(message); }

/** clamp(value, min, max) */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** isObject(value) -> true for a plain object (not null, not an array). */
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** clone(data) -> a deep copy of plain JSON data. */
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** tidy(number) rounds away floating point dust (9 decimals), so saves and tests see clean numbers. */
export const tidy = (n) => Math.round(n * 1e9) / 1e9;

/** names(object) -> "a, b, c" for error messages. */
export const names = (o) => Object.keys(o).join(', ') || 'none';

/** range(value, where) -> [min, max] from a number or a [min, max] pair of whole numbers >= 0. */
export function range(v, where) {
  const pair = Array.isArray(v) ? v : [v, v];
  need(pair.length === 2 && pair.every((n) => Number.isInteger(n) && n >= 0) && pair[0] <= pair[1], `${where} must be a whole number >= 0 or [min, max], got ${JSON.stringify(v)}`);
  return pair;
}

/** randomInt(rng, min, max) -> whole number from min to max, both included. */
export function randomInt(rng, min, max) {
  if (max <= min) return min;
  return min + Math.min(max - min, Math.floor(rng() * (max - min + 1)));
}

/** pickWeighted(list, weightOf, rng) -> one element, chosen by weight. */
export function pickWeighted(list, weightOf, rng) {
  let total = 0;
  for (const x of list) total += weightOf(x);
  let r = rng() * total;
  for (const x of list) { r -= weightOf(x); if (r < 0) return x; }
  return list[list.length - 1];
}
