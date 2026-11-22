// Aiming helpers for thrown weapons: the launch velocity that reaches a point
// under gravity, a plain lob along a facing, and the predicted flight path
// (for drawing an aiming arc or a mob's telegraph). Pure functions; z is height.
import { dirOf, need } from './util.js';

const DEG = Math.PI / 180;

/**
 * aimAt(from, to, speed, gravity, { high = false }) -> { vx, vy, vz, time } or null when the target is out of range.
 * from and to are { x, y, z }. The low arc is used unless high is true (a lob over a wall).
 */
export function aimAt(from, to, speed, gravity, options = {}) {
  need(speed > 0 && gravity >= 0, `aimAt: speed must be above 0 and gravity >= 0, got ${speed}, ${gravity}`);
  const dx = to.x - from.x; const dy = to.y - from.y; const h = (to.z ?? 0) - (from.z ?? 0);
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return { vx: 0, vy: 0, vz: h >= 0 ? speed : -speed, time: Math.abs(h) / speed };
  let tan;
  if (gravity === 0) tan = h / d;
  else {
    const v2 = speed * speed;
    const root = v2 * v2 - gravity * (gravity * d * d + 2 * h * v2);
    if (root < 0) return null;
    tan = (v2 + (options.high ? 1 : -1) * Math.sqrt(root)) / (gravity * d);
  }
  const angle = Math.atan(tan);
  const flat = speed * Math.cos(angle);
  return { vx: dx / d * flat, vy: dy / d * flat, vz: speed * Math.sin(angle), time: d / flat };
}

/** lob(facing, speed, loft) -> { vx, vy, vz } for a throw along a facing (degrees), tilted `loft` degrees upward. */
export function lob(facing, speed, loft = 0) {
  const [fx, fy] = dirOf(facing);
  const flat = speed * Math.cos(loft * DEG);
  return { vx: fx * flat, vy: fy * flat, vz: speed * Math.sin(loft * DEG) };
}

/**
 * predictArc(start, velocity, options) -> [{ x, y, z, t }, ...] the flight path until it meets the ground.
 * start { x, y, z }, velocity { vx, vy, vz }. options: { gravity (required), groundAt = () => 0, step = 1/30, max = 4 seconds }.
 * It ignores walls and fighters; it is a drawing aid, not the simulation.
 */
export function predictArc(start, velocity, options = {}) {
  const { gravity, groundAt = () => 0, step = 1 / 30, max = 4 } = options;
  need(gravity >= 0, `predictArc: options.gravity must be a number >= 0, got ${String(gravity)}`);
  need(step > 0, `predictArc: options.step must be above 0, got ${String(step)}`);
  const points = [{ x: start.x, y: start.y, z: start.z, t: 0 }];
  let { x, y, z } = start; let vz = velocity.vz;
  for (let t = step; t <= max + 1e-9; t += step) {
    x += velocity.vx * step; y += velocity.vy * step; z += vz * step - 0.5 * gravity * step * step;
    vz -= gravity * step;
    const ground = groundAt(x, y);
    if (z <= ground) { points.push({ x, y, z: ground, t }); break; }
    points.push({ x, y, z, t });
  }
  return points;
}
