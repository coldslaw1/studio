// Small maths helpers shared by the combat modules. No state.
//
// Facing is in DEGREES and uses the puppet engine's yaw: 0 faces -y (up the
// screen), 90 faces +x (right), 180 faces +y (down), -90 faces -x (left).

const DEG = Math.PI / 180;

/** clamp(v, lo, hi) -> v kept inside lo..hi. */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** num(value, fallback) -> value when it is a finite number, otherwise fallback. */
export const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/** round(v) -> v rounded to 6 decimals, so saved state stays short and stable. */
export const round = (v) => Math.round(v * 1e6) / 1e6;

/** dirOf(facing) -> [dx, dy], the unit ground direction for a facing in degrees. */
export function dirOf(facing) {
  const a = facing * DEG;
  return [Math.sin(a), -Math.cos(a)];
}

/** facingOf(dx, dy) -> facing in degrees for a ground direction (the same value as puppet's yawFromVelocity). */
export function facingOf(dx, dy) {
  return Math.atan2(dx, -dy) / DEG;
}

/** angleDiff(a, b) -> the shortest turn from b to a, in degrees, -180..180. */
export function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** boxAngle(facing) -> the angle to give collision's box() so its length (w) points along the facing. */
export const boxAngle = (facing) => facing - 90;

/** own(object, key) -> true when the object itself has the key. */
export const own = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);

/** isId(value) -> true for a usable id: letters, digits, _ . : - */
export const isId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value) && value !== '__proto__';

/** sortedIds(map) -> the keys of an object in a fixed order, so every machine walks fighters the same way. */
export const sortedIds = (map) => Object.keys(map).sort();

/** need(cond, message) -> throws Error(message) when cond is false. */
export function need(cond, message) {
  if (!cond) throw new Error(message);
}

/** positive(value, what) -> value, or throws when it is not a finite number >= 0. */
export function positive(value, what) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${what} must be a number >= 0, got ${String(value)}`);
  return value;
}
