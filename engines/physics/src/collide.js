// Shape-vs-shape collision tests. Pure functions, no state.
//
// Shapes are plain objects:
//   rect:   { x, y, w, h }  x,y = TOP-LEFT corner  (same as ctx.fillRect)
//   circle: { x, y, r }     x,y = CENTER           (same as ctx.arc)
// A shape is a circle when it has a numeric `r`. Otherwise it is a rect.
// Y grows downward, like the canvas.
//
// A "hit" is { nx, ny, depth }: move shape A by (nx*depth, ny*depth) to
// separate it from shape B. (nx, ny) has length 1.

export function isCircle(s) {
  return typeof s.r === 'number';
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Bounding box of any shape as { x, y, w, h }. */
export function boundsOf(s) {
  if (isCircle(s)) return { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 };
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

/** Center point of any shape as { x, y }. */
export function centerOf(s) {
  if (isCircle(s)) return { x: s.x, y: s.y };
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

export function rectVsRect(a, b) {
  const dx = a.x + a.w / 2 - (b.x + b.w / 2);
  const px = (a.w + b.w) / 2 - Math.abs(dx);
  if (px <= 0) return null;
  const dy = a.y + a.h / 2 - (b.y + b.h / 2);
  const py = (a.h + b.h) / 2 - Math.abs(dy);
  if (py <= 0) return null;
  if (px < py) return { nx: dx < 0 ? -1 : 1, ny: 0, depth: px };
  return { nx: 0, ny: dy < 0 ? -1 : 1, depth: py };
}

export function circleVsCircle(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rs = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return null;
  const d = Math.sqrt(d2);
  if (d === 0) return { nx: 1, ny: 0, depth: rs };
  return { nx: dx / d, ny: dy / d, depth: rs - d };
}

/** Circle c (shape A) against rect r (shape B). */
export function circleVsRect(c, r) {
  const cx = clamp(c.x, r.x, r.x + r.w);
  const cy = clamp(c.y, r.y, r.y + r.h);
  const dx = c.x - cx;
  const dy = c.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > 0) {
    if (d2 >= c.r * c.r) return null;
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: c.r - d };
  }
  // Circle center is inside the rect: push out through the nearest side.
  const left = c.x - r.x;
  const right = r.x + r.w - c.x;
  const top = c.y - r.y;
  const bottom = r.y + r.h - c.y;
  const m = Math.min(left, right, top, bottom);
  if (m === top) return { nx: 0, ny: -1, depth: top + c.r };
  if (m === bottom) return { nx: 0, ny: 1, depth: bottom + c.r };
  if (m === left) return { nx: -1, ny: 0, depth: left + c.r };
  return { nx: 1, ny: 0, depth: right + c.r };
}

/**
 * Test any two shapes. Returns a hit { nx, ny, depth } or null.
 * Move A by (nx*depth, ny*depth) to stop the overlap.
 * Shapes that only touch edges do not count as colliding.
 */
export function collide(a, b) {
  const ac = isCircle(a);
  const bc = isCircle(b);
  if (ac && bc) return circleVsCircle(a, b);
  if (!ac && !bc) return rectVsRect(a, b);
  if (ac) return circleVsRect(a, b);
  const hit = circleVsRect(b, a);
  if (hit) {
    hit.nx = -hit.nx || 0;
    hit.ny = -hit.ny || 0;
  }
  return hit;
}

/** True when two shapes overlap. */
export function overlaps(a, b) {
  return collide(a, b) !== null;
}

/** True when point (px, py) is inside the shape. */
export function pointIn(px, py, s) {
  if (isCircle(s)) {
    const dx = px - s.x;
    const dy = py - s.y;
    return dx * dx + dy * dy < s.r * s.r;
  }
  return px > s.x && px < s.x + s.w && py > s.y && py < s.y + s.h;
}

/** Distance between the centers of two shapes. */
export function distance(a, b) {
  const ca = centerOf(a);
  const cb = centerOf(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

function segVsRect(x0, y0, x1, y1, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tEnter = -Infinity;
  let tExit = Infinity;
  let nx = 0;
  let ny = 0;
  if (dx === 0) {
    if (x0 <= r.x || x0 >= r.x + r.w) return null;
  } else {
    let t1 = (r.x - x0) / dx;
    let t2 = (r.x + r.w - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tEnter = t1;
    nx = dx > 0 ? -1 : 1;
    tExit = t2;
  }
  if (dy === 0) {
    if (y0 <= r.y || y0 >= r.y + r.h) return null;
  } else {
    let t1 = (r.y - y0) / dy;
    let t2 = (r.y + r.h - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tEnter) {
      tEnter = t1;
      nx = 0;
      ny = dy > 0 ? -1 : 1;
    }
    if (t2 < tExit) tExit = t2;
  }
  if (tEnter >= tExit || tExit <= 0 || tEnter > 1) return null;
  if (tEnter < 0) return { t: 0, x: x0, y: y0, nx: 0, ny: 0, inside: true };
  return { t: tEnter, x: x0 + dx * tEnter, y: y0 + dy * tEnter, nx, ny, inside: false };
}

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
  if (b >= 0) return null; // moving away
  const disc = b * b - a * cc;
  if (disc <= 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t > 1) return null;
  const x = x0 + dx * t;
  const y = y0 + dy * t;
  return { t, x, y, nx: (x - c.x) / c.r, ny: (y - c.y) / c.r, inside: false };
}

/**
 * Cast a line from (x0, y0) to (x1, y1) against one shape.
 * Returns null, or { t, x, y, nx, ny, inside }:
 *   t      0..1, how far along the line the hit is
 *   x, y   the hit point
 *   nx, ny the surface direction at the hit point (length 1)
 *   inside true when the line starts inside the shape (then t is 0)
 */
export function raycast(x0, y0, x1, y1, shape) {
  return isCircle(shape) ? segVsCircle(x0, y0, x1, y1, shape) : segVsRect(x0, y0, x1, y1, shape);
}

/**
 * Move a rect by (dx, dy) and find where it first touches another rect.
 * Use this for fast things (bullets) that could skip through a thin wall.
 * Returns null (no hit) or { t, nx, ny, inside }.
 * The safe position is rect.x + dx * t, rect.y + dy * t.
 */
export function sweepRect(rect, dx, dy, other) {
  const grown = { x: other.x - rect.w, y: other.y - rect.h, w: other.w + rect.w, h: other.h + rect.h };
  const hit = segVsRect(rect.x, rect.y, rect.x + dx, rect.y + dy, grown);
  if (!hit) return null;
  return { t: hit.t, nx: hit.nx, ny: hit.ny, inside: hit.inside };
}
