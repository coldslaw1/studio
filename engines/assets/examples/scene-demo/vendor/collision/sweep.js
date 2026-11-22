// Swept (continuous) tests: move shape A along a straight line and find the first moment it
// touches shape B. Exact for straight moves of any length, so fast things never tunnel.
import { isCircle, vertsOf } from './shapes.js';
import { collide, normalsOf, project } from './narrow.js';

const TIE = 1e-12;

// Both shapes are corner lists. Swept separating-axis test.
function sweepVerts(va, vb, dx, dy, slop) {
  let tIn = -Infinity;
  let tOut = Infinity;
  let nx = 0;
  let ny = 0;
  let headOn = 0;
  for (const list of [normalsOf(va), normalsOf(vb)]) {
    for (const [ax, ay] of list) {
      const [a0, a1] = project(va, ax, ay);
      const [b0, b1] = project(vb, ax, ay);
      const v = dx * ax + dy * ay;
      let enter = -Infinity;
      let exit = Infinity;
      let side = 0;
      if (a1 <= b0 + slop) { // A is before B along this axis
        if (v <= 0) return null;
        enter = Math.max(0, (b0 - a1) / v);
        exit = (b1 - a0) / v;
        side = -1;
      } else if (a0 >= b1 - slop) { // A is after B
        if (v >= 0) return null;
        enter = Math.max(0, (b1 - a0) / v);
        exit = (b0 - a1) / v;
        side = 1;
      } else if (v > 0) exit = (b1 - a0) / v;
      else if (v < 0) exit = (b0 - a1) / v;
      if (exit < tOut) tOut = exit;
      if (side !== 0) {
        const into = v * side; // negative; more negative = more head-on
        if (enter > tIn + TIE || (enter > tIn - TIE && into < headOn)) {
          tIn = Math.max(tIn, enter);
          nx = ax * side;
          ny = ay * side;
          headOn = into;
        }
      }
    }
  }
  if (tIn === -Infinity) return 'overlap';
  if (tIn >= tOut || tIn > 1) return null;
  return { t: tIn, nx: nx || 0, ny: ny || 0, overlap: false };
}

// A point moving from (px, py) by (dx, dy) against a circle of radius R at (cx, cy).
function rayVsCircle(px, py, dx, dy, cx, cy, R) {
  const fx = px - cx;
  const fy = py - cy;
  const b = fx * dx + fy * dy;
  if (b >= 0) return null; // moving away or along
  const a = dx * dx + dy * dy;
  const cc = Math.max(0, fx * fx + fy * fy - R * R);
  const disc = b * b - a * cc;
  if (disc <= 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t > 1) return null;
  const hx = fx + dx * t;
  const hy = fy + dy * t;
  const len = Math.hypot(hx, hy) || 1;
  return { t: Math.max(0, t), nx: hx / len, ny: hy / len, overlap: false };
}

// A moving circle against a corner list: a ray against the list grown by the radius.
function sweepCircleVerts(c, dx, dy, verts, slop) {
  let best = null;
  const take = (hit, into) => {
    if (!hit) return;
    if (!best || hit.t < best.t - TIE || (hit.t < best.t + TIE && into < best.into)) {
      best = hit;
      best.into = into;
    }
  };
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey);
    if (len === 0) continue;
    const nx = ey / len;
    const ny = -ex / len;
    const vn = dx * nx + dy * ny;
    if (vn < 0) {
      const gap = (c.x - p[0]) * nx + (c.y - p[1]) * ny - c.r;
      if (gap >= -slop) {
        const t = Math.max(0, gap) / -vn;
        if (t <= 1) {
          const s = ((c.x + dx * t - p[0]) * ex + (c.y + dy * t - p[1]) * ey) / (len * len);
          if (s >= 0 && s <= 1) take({ t, nx, ny, overlap: false }, vn);
        }
      }
    }
    const corner = rayVsCircle(c.x, c.y, dx, dy, p[0], p[1], c.r);
    if (corner) take(corner, dx * corner.nx + dy * corner.ny);
  }
  if (best) delete best.into;
  return best;
}

function overlapHit(a, b, slop) {
  const hit = collide(a, b);
  if (!hit || hit.depth <= slop) return null;
  return { t: 0, nx: hit.nx, ny: hit.ny, depth: hit.depth, overlap: true };
}

/**
 * Move shape A by (dx, dy) and find where it first touches shape B. Works for every mix of
 * rect, circle and polygon, and for any speed.
 *
 * Returns null when A never touches B during the move. A shape that is already touching B
 * and moves along it or away from it does NOT hit (so sliding along a wall works).
 * Otherwise returns { t, nx, ny, overlap }:
 *   t        0..1, the part of the move that is free; safe position is a.x + dx*t, a.y + dy*t
 *   nx, ny   the surface direction at the contact, pointing from B toward A (length 1)
 *   overlap  true when A already overlapped B before moving; then t is 0, and nx, ny, depth
 *            say how to push A out (as in collide)
 * @param {object} a   the moving shape
 * @param {number} dx  how far it moves on x this step (velocity * dt)
 * @param {number} dy  how far it moves on y
 * @param {object} b   the shape that stays still
 * @param {number} [slop=1e-9]  overlaps smaller than this count as "just touching"
 */
export function sweep(a, dx, dy, b, slop = 1e-9) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error(`sweep: dx and dy must be finite numbers, got ${dx}, ${dy}`);
  const ac = isCircle(a);
  const bc = isCircle(b);
  if (!ac && !bc) {
    const hit = sweepVerts(vertsOf(a), vertsOf(b), dx, dy, slop);
    return hit === 'overlap' ? overlapHit(a, b, slop) : hit;
  }
  const over = overlapHit(a, b, slop);
  if (over) return over;
  if (dx === 0 && dy === 0) return null;
  if (ac && bc) return rayVsCircle(a.x, a.y, dx, dy, b.x, b.y, a.r + b.r);
  if (ac) return sweepCircleVerts(a, dx, dy, vertsOf(b), slop);
  // polygon moving against a still circle: same as the circle moving the other way
  const hit = sweepCircleVerts(b, -dx, -dy, vertsOf(a), slop);
  if (hit) {
    hit.nx = -hit.nx || 0;
    hit.ny = -hit.ny || 0;
  }
  return hit;
}
