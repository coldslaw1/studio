// Steering: small pure functions that each answer "which way, how fast?" as a velocity [vx, vy].
// Blend several with `blend` to get one movement. Bodies are any objects with x, y (and vx, vy for
// the ones that predict). Nothing here keeps state or reads a clock.
import { len } from './util.js';

const ZERO = [0, 0];

/** seek(body, tx, ty, speed) -> velocity straight at a point. */
export function seek(body, tx, ty, speed) {
  const dx = tx - body.x; const dy = ty - body.y;
  const d = len(dx, dy);
  return d < 1e-9 ? ZERO : [dx / d * speed, dy / d * speed];
}

/** flee(body, tx, ty, speed) -> velocity straight away from a point. */
export function flee(body, tx, ty, speed) {
  const v = seek(body, tx, ty, speed);
  return v === ZERO ? [speed, 0] : [0 - v[0], 0 - v[1]];
}

/** arrive(body, tx, ty, speed, slowRadius) -> like seek, but slows down inside slowRadius and stops on the point. */
export function arrive(body, tx, ty, speed, slowRadius) {
  const dx = tx - body.x; const dy = ty - body.y;
  const d = len(dx, dy);
  if (d < 1e-9) return ZERO;
  const s = slowRadius > 0 && d < slowRadius ? speed * d / slowRadius : speed;
  return [dx / d * s, dy / d * s];
}

/** pursue(body, target, speed, maxLead = 1) -> seek where the target (x, y, vx, vy) will be, looking at most maxLead seconds ahead. */
export function pursue(body, target, speed, maxLead = 1) {
  const d = len(target.x - body.x, target.y - body.y);
  const t = speed > 0 ? Math.min(maxLead, d / speed) : 0;
  return seek(body, target.x + (target.vx || 0) * t, target.y + (target.vy || 0) * t, speed);
}

/** evade(body, threat, speed, maxLead = 1) -> flee from where the threat will be. */
export function evade(body, threat, speed, maxLead = 1) {
  const d = len(threat.x - body.x, threat.y - body.y);
  const t = speed > 0 ? Math.min(maxLead, d / speed) : 0;
  return flee(body, threat.x + (threat.vx || 0) * t, threat.y + (threat.vy || 0) * t, speed);
}

/**
 * wander(heading, turn, speed) -> { v: [vx, vy], heading }. Call it with the last heading (degrees) and
 * a turn in -1..1 (use a seeded roll * 2 - 1); it bends the heading by up to 40 degrees and walks that way.
 */
export function wander(heading, turn, speed) {
  const next = heading + turn * 40;
  const r = next * Math.PI / 180;
  return { v: [Math.sin(r) * speed, -Math.cos(r) * speed], heading: ((next % 360) + 360) % 360 };
}

/**
 * separation(body, neighbours, radius) -> a push away from every neighbour closer than radius, stronger
 * the closer it is. Length 0..1 per neighbour; scale it with its weight in blend(). skipId leaves one
 * neighbour out (the one being attacked).
 */
export function separation(body, neighbours, radius, skipId = null) {
  let x = 0; let y = 0;
  for (const o of neighbours) {
    if (o === body || (skipId !== null && o.id === skipId)) continue;
    const dx = body.x - o.x; const dy = body.y - o.y;
    const d = len(dx, dy);
    if (d >= radius) continue;
    if (d < 1e-6) { // exactly on top of each other: part along a direction fixed by the ids
      const s = (body.id ?? '') < (o.id ?? '') ? 1 : -1;
      x += s; continue;
    }
    const w = (radius - d) / radius;
    x += dx / d * w; y += dy / d * w;
  }
  return [x, y];
}

/** cohesion(body, neighbours) -> unit vector toward the middle of the neighbours ([0, 0] with none). */
export function cohesion(body, neighbours) {
  let x = 0; let y = 0; let n = 0;
  for (const o of neighbours) { if (o !== body) { x += o.x; y += o.y; n++; } }
  if (!n) return ZERO;
  const dx = x / n - body.x; const dy = y / n - body.y;
  const d = len(dx, dy);
  return d < 1e-6 ? ZERO : [dx / d, dy / d];
}

/** alignment(body, neighbours) -> unit vector of the neighbours' average velocity ([0, 0] when they stand still). */
export function alignment(body, neighbours) {
  let x = 0; let y = 0;
  for (const o of neighbours) { if (o !== body) { x += o.vx || 0; y += o.vy || 0; } }
  const d = len(x, y);
  return d < 1e-6 ? ZERO : [x / d, y / d];
}

const turned = (v, degrees) => {
  const r = degrees * Math.PI / 180; const c = Math.cos(r); const s = Math.sin(r);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
};

/**
 * avoidWalls(grid, body, v, lookahead) -> v, turned when a wall lies within `lookahead` game units ahead.
 * Three feelers are tried: straight on, then each side at 40 and 80 degrees; the first clear one wins,
 * and the side checked first follows `side` (1 or -1) so a group does not all dodge the same way.
 */
export function avoidWalls(grid, body, v, lookahead, side = 1) {
  const speed = len(v[0], v[1]);
  if (speed < 1e-9 || !grid) return v;
  const ux = v[0] / speed; const uy = v[1] / speed;
  if (grid.lineClear(body.x, body.y, body.x + ux * lookahead, body.y + uy * lookahead)) return v;
  for (const a of [40 * side, -40 * side, 80 * side, -80 * side]) {
    const t = turned([ux, uy], a);
    if (grid.lineClear(body.x, body.y, body.x + t[0] * lookahead, body.y + t[1] * lookahead)) return [t[0] * speed, t[1] * speed];
  }
  return v;
}

/**
 * blend(parts, maxSpeed) -> one velocity: the weighted sum of [[vx, vy], weight] parts, cut to maxSpeed.
 */
export function blend(parts, maxSpeed) {
  let x = 0; let y = 0;
  for (const [v, w] of parts) { x += v[0] * w; y += v[1] * w; }
  const d = len(x, y);
  if (d > maxSpeed && d > 0) { x = x / d * maxSpeed; y = y / d * maxSpeed; }
  return [x, y];
}

/**
 * followPath(body, points, reach) -> { target: [x, y] | null, done }. Drops waypoints the body is within
 * `reach` of (it edits the list) and returns the next one to walk to.
 */
export function followPath(body, points, reach) {
  while (points.length > 1 && len(points[0][0] - body.x, points[0][1] - body.y) <= reach) points.shift();
  if (!points.length) return { target: null, done: true };
  const last = points.length === 1 && len(points[0][0] - body.x, points[0][1] - body.y) <= reach;
  return { target: points[0], done: last };
}
