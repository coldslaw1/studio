// Line (ray) tests against single shapes and tile grids.
import { isCircle, vertsOf } from './shapes.js';

function segVsCircle(x0, y0, x1, y1, c) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - c.x;
  const fy = y0 - c.y;
  const cc = fx * fx + fy * fy - c.r * c.r;
  if (cc < 0) return { t: 0, x: x0, y: y0, nx: 0, ny: 0, inside: true };
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = fx * dx + fy * dy;
  if (b >= 0) return null;
  const disc = b * b - a * cc;
  if (disc <= 0) return null;
  const t = Math.max(0, (-b - Math.sqrt(disc)) / a);
  if (t > 1) return null;
  const x = x0 + dx * t;
  const y = y0 + dy * t;
  return { t, x, y, nx: (x - c.x) / c.r, ny: (y - c.y) / c.r, inside: false };
}

function segVsVerts(x0, y0, x1, y1, verts) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tIn = -Infinity;
  let tOut = Infinity;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey);
    if (len === 0) continue;
    const ax = ey / len;
    const ay = -ex / len;
    const dist = (x0 - p[0]) * ax + (y0 - p[1]) * ay; // > 0 = outside this edge
    const v = dx * ax + dy * ay;
    if (v === 0) {
      if (dist >= 0) return null;
      continue;
    }
    const t = -dist / v;
    if (v < 0) {
      if (t > tIn) {
        tIn = t;
        nx = ax;
        ny = ay;
      }
    } else if (t < tOut) tOut = t;
  }
  if (tIn >= tOut || tOut <= 0 || tIn > 1) return null;
  if (tIn < 0) return { t: 0, x: x0, y: y0, nx: 0, ny: 0, inside: true };
  return { t: tIn, x: x0 + dx * tIn, y: y0 + dy * tIn, nx: nx || 0, ny: ny || 0, inside: false };
}

/**
 * Cast a line from (x0, y0) to (x1, y1) against one shape (rect, circle or polygon).
 * Returns null, or { t, x, y, nx, ny, inside }:
 *   t      0..1, how far along the line the hit is
 *   x, y   the hit point
 *   nx, ny the surface direction at the hit point (length 1)
 *   inside true when the line starts inside the shape (then t is 0 and nx, ny are 0)
 */
export function raycast(x0, y0, x1, y1, shape) {
  return isCircle(shape) ? segVsCircle(x0, y0, x1, y1, shape) : segVsVerts(x0, y0, x1, y1, vertsOf(shape));
}

/**
 * Cast a line through a tile grid and find the first solid tile. The grid is any object with
 * `tileSize` and `isSolid(col, row)` (a physics-engine tile map works as it is).
 * @param {object} map
 * @param {number} [ox=0]  x of the grid's top-left corner in the world
 * @param {number} [oy=0]  y of the grid's top-left corner
 * @returns {null|{t:number, x:number, y:number, nx:number, ny:number, col:number, row:number, inside:boolean}}
 */
export function raycastGrid(map, x0, y0, x1, y1, ox = 0, oy = 0) {
  const ts = map.tileSize;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let col = Math.floor((x0 - ox) / ts);
  let row = Math.floor((y0 - oy) / ts);
  if (map.isSolid(col, row)) return { t: 0, x: x0, y: y0, nx: 0, ny: 0, col, row, inside: true };
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(ts / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(ts / dy);
  let tMaxX = dx === 0 ? Infinity : (ox + (dx > 0 ? col + 1 : col) * ts - x0) / dx;
  let tMaxY = dy === 0 ? Infinity : (oy + (dy > 0 ? row + 1 : row) * ts - y0) / dy;
  for (;;) {
    let t;
    let nx = 0;
    let ny = 0;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      col += stepX;
      nx = -stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      row += stepY;
      ny = -stepY;
    }
    if (!(t <= 1)) return null;
    if (map.isSolid(col, row)) return { t: Math.max(0, t), x: x0 + dx * t, y: y0 + dy * t, nx, ny, col, row, inside: false };
  }
}
