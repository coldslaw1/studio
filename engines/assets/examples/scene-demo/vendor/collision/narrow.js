// Shape-vs-shape overlap tests. Pure functions, no state.
//
// A "hit" is { nx, ny, depth }: move shape A by (nx*depth, ny*depth) to separate it from
// shape B. (nx, ny) has length 1. Shapes that only touch do not count as colliding.
import { isCircle, isPolygon, vertsOf } from './shapes.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Outward unit directions of every edge of a corner list from vertsOf. */
export function normalsOf(verts) {
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey);
    if (len > 0) out.push([ey / len, -ex / len]);
  }
  return out;
}

/** Smallest and largest value of the corners along direction (nx, ny). */
export function project(verts, nx, ny) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of verts) {
    const d = p[0] * nx + p[1] * ny;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

function rectVsRect(a, b) {
  const dx = a.x + a.w / 2 - (b.x + b.w / 2);
  const px = (a.w + b.w) / 2 - Math.abs(dx);
  if (px <= 0) return null;
  const dy = a.y + a.h / 2 - (b.y + b.h / 2);
  const py = (a.h + b.h) / 2 - Math.abs(dy);
  if (py <= 0) return null;
  if (px < py) return { nx: dx < 0 ? -1 : 1, ny: 0, depth: px };
  return { nx: 0, ny: dy < 0 ? -1 : 1, depth: py };
}

function circleVsCircle(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rs = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return null;
  const d = Math.sqrt(d2);
  if (d === 0) return { nx: 1, ny: 0, depth: rs };
  return { nx: dx / d, ny: dy / d, depth: rs - d };
}

/** Circle (shape A) against a corner list (shape B). */
export function circleVsVerts(c, verts) {
  let inside = true;
  let bestIn = -Infinity; // signed distance to the nearest edge line when inside
  let inNx = 0;
  let inNy = 0;
  let bestD2 = Infinity;
  let px = 0;
  let py = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len2 = ex * ex + ey * ey;
    if (len2 === 0) continue;
    const len = Math.sqrt(len2);
    const sd = ((c.x - p[0]) * ey - (c.y - p[1]) * ex) / len;
    if (sd > 0) inside = false;
    if (sd > bestIn) {
      bestIn = sd;
      inNx = ey / len;
      inNy = -ex / len;
    }
    const t = clamp(((c.x - p[0]) * ex + (c.y - p[1]) * ey) / len2, 0, 1);
    const cx = p[0] + ex * t;
    const cy = p[1] + ey * t;
    const d2 = (c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy);
    if (d2 < bestD2) {
      bestD2 = d2;
      px = cx;
      py = cy;
    }
  }
  if (inside || bestD2 === 0) return { nx: inNx || 0, ny: inNy || 0, depth: c.r - bestIn };
  if (bestD2 >= c.r * c.r) return null;
  const d = Math.sqrt(bestD2);
  return { nx: (c.x - px) / d, ny: (c.y - py) / d, depth: c.r - d };
}

/** Two corner lists (separating axis test). */
export function vertsVsVerts(va, vb) {
  let best = null;
  for (const list of [normalsOf(va), normalsOf(vb)]) {
    for (const [nx, ny] of list) {
      const [a0, a1] = project(va, nx, ny);
      const [b0, b1] = project(vb, nx, ny);
      const plus = b1 - a0; // push A along +n by this much
      const minus = a1 - b0; // or along -n by this much
      if (plus <= 0 || minus <= 0) return null;
      const depth = Math.min(plus, minus);
      if (!best || depth < best.depth - 1e-12) {
        const s = plus < minus ? 1 : -1;
        best = { nx: nx * s || 0, ny: ny * s || 0, depth };
      }
    }
  }
  return best;
}

function flip(hit) {
  if (hit) {
    hit.nx = -hit.nx || 0;
    hit.ny = -hit.ny || 0;
  }
  return hit;
}

/**
 * Test any two shapes (rect, circle or polygon in any mix).
 * @returns {null|{nx:number, ny:number, depth:number}} null when they do not overlap;
 *   otherwise move A by (nx*depth, ny*depth) to stop the overlap.
 */
export function collide(a, b) {
  const ac = isCircle(a);
  const bc = isCircle(b);
  if (ac && bc) return circleVsCircle(a, b);
  if (ac) return circleVsVerts(a, vertsOf(b));
  if (bc) return flip(circleVsVerts(b, vertsOf(a)));
  if (!isPolygon(a) && !isPolygon(b)) return rectVsRect(a, b);
  return vertsVsVerts(vertsOf(a), vertsOf(b));
}

/** True when two shapes overlap (touching edges do not count). */
export function overlaps(a, b) {
  return collide(a, b) !== null;
}

/** True when point (px, py) is inside the shape (points exactly on the edge are outside). */
export function pointIn(px, py, s) {
  if (isCircle(s)) {
    const dx = px - s.x;
    const dy = py - s.y;
    return dx * dx + dy * dy < s.r * s.r;
  }
  if (!isPolygon(s)) return px > s.x && px < s.x + s.w && py > s.y && py < s.y + s.h;
  const v = vertsOf(s);
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    const q = v[(i + 1) % v.length];
    if ((px - p[0]) * (q[1] - p[1]) - (py - p[1]) * (q[0] - p[0]) >= 0) return false;
  }
  return true;
}
