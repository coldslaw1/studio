// Small maths for smooth camera motion. Pure functions, no state.

/** Bring an angle in degrees into 0 (included) .. 360 (not included). */
export function wrapDegrees(a) {
  return ((a % 360) + 360) % 360;
}

/** Shortest signed turn in degrees from angle `from` to angle `to`, in -180 .. 180. */
export function angleDelta(from, to) {
  return wrapDegrees(to - from + 180) - 180;
}

/**
 * One step of a critically damped spring: starts gently, arrives gently and never overshoots.
 * @param {number} value     Where it is now.
 * @param {number} target    Where it should end up.
 * @param {number} velocity  Its speed from the last step (start with 0).
 * @param {number} time      Seconds to cover about nine tenths of the way. 0 jumps straight to the target.
 * @param {number} dt        Seconds since the last step.
 * @returns {[number, number]}  [new value, new velocity]
 */
export function smoothDamp(value, target, velocity, time, dt) {
  if (!(dt >= 0)) throw new Error(`smoothDamp: dt must be 0 or more seconds, got ${dt}`);
  if (!(time > 0)) return [target, 0];
  if (dt === 0) return [value, velocity];
  const omega = 4 / time; // covers about nine tenths of the way in `time` seconds
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = value - target;
  const temp = (velocity + omega * change) * dt;
  let next = target + (change + temp) * decay;
  let speed = (velocity - omega * temp) * decay;
  if ((target - value > 0) === (next > target)) { next = target; speed = 0; } // went past: stop on it
  return [next, speed];
}

/** Index of the angle in `yaws` (degrees) nearest to `yaw`, going round the circle. */
export function nearestYawIndex(yaws, yaw) {
  if (!Array.isArray(yaws) || yaws.length === 0) throw new Error('nearestYawIndex: "yaws" must be a list with at least one angle');
  let best = 0;
  let bestGap = Infinity;
  yaws.forEach((y, i) => {
    const gap = Math.abs(angleDelta(yaw, y));
    if (gap < bestGap - 1e-9) { best = i; bestGap = gap; }
  });
  return best;
}
