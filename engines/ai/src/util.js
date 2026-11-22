// Small shared helpers: checks, rounding, angles. No state.

/** need(condition, message) throws Error(message) when the condition is false. */
export function need(condition, message) {
  if (!condition) throw new Error(message);
}

/** clamp(v, lo, hi) -> v kept inside [lo, hi]. */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * q(v) -> v rounded to 5 decimals. Every number that is stored in the state goes through this, so two
 * machines whose sin/cos differ in the last bit still hold the same state.
 */
export const q = (v) => Math.round(v * 1e5) / 1e5 + 0; // "+ 0" turns -0 into 0, which JSON would do anyway

/** dist(ax, ay, bx, by) -> straight-line distance. */
export const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

/** dist2(ax, ay, bx, by) -> squared distance (cheaper, fine for comparing). */
export const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

/** len(x, y) -> length of a vector. */
export const len = (x, y) => Math.sqrt(x * x + y * y);

/**
 * facingOf(dx, dy) -> degrees for a direction, the studio-wide convention shared with the combat engine:
 * 0 = up the screen (-y), 90 = right (+x), 180 = down (+y), -90 = left. The result is in (-180, 180].
 */
export function facingOf(dx, dy) {
  return q(Math.atan2(dx, -dy) * 180 / Math.PI);
}

/** dirOf(degrees) -> [dx, dy] unit vector for a facing. */
export function dirOf(degrees) {
  const r = degrees * Math.PI / 180;
  return [q(Math.sin(r)), q(-Math.cos(r))];
}

/** angleDiff(a, b) -> smallest signed difference a - b in degrees, in (-180, 180]. */
export function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** isId(v) -> true for a non-empty string of letters, digits, _ . : - */
export const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_.:-]+$/.test(v);

/** sortedKeys(object) -> its keys in a fixed order, so loops run the same on every machine. */
export const sortedKeys = (object) => Object.keys(object).sort();

/** insertSorted(list, id) puts a string into a sorted list (no duplicates). */
export function insertSorted(list, id) {
  let lo = 0; let hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < id) lo = mid + 1; else hi = mid; }
  if (list[lo] !== id) list.splice(lo, 0, id);
}

/** removeSorted(list, id) takes a string out of a sorted list. */
export function removeSorted(list, id) {
  let lo = 0; let hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < id) lo = mid + 1; else hi = mid; }
  if (list[lo] === id) list.splice(lo, 1);
}

/** finite(v, fallback) -> v when it is a finite number, else the fallback. */
export const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);
