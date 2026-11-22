// Shapes are plain objects, the same literals the physics engine uses, plus polygons:
//   rect:    { x, y, w, h }       x,y = TOP-LEFT corner (same as ctx.fillRect)
//   circle:  { x, y, r }          x,y = CENTER          (same as ctx.arc)
//   polygon: { x, y, points }     points = [[px, py], ...] relative to x,y; must be convex
// A shape is a circle when it has a numeric `r`, a polygon when it has a `points` array,
// otherwise a rect. Y grows downward, like the canvas. Polygons may be wound either way.

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** True when the shape is a circle ({ x, y, r }). */
export function isCircle(s) {
  return typeof s.r === 'number';
}

/** True when the shape is a polygon ({ x, y, points }). */
export function isPolygon(s) {
  return Array.isArray(s.points);
}

function area2(v) {
  let a = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    const q = v[(i + 1) % v.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/**
 * Throw a clear error unless `s` is a usable shape. Polygons must have 3 or more points,
 * a real area and no dents (convex). Split a dented outline into several convex polygons.
 * @param {object} s     the shape
 * @param {string} [fn]  name of the calling function, used in the error message
 * @returns {object} the same shape
 */
export function checkShape(s, fn = 'checkShape') {
  if (!s || typeof s !== 'object') throw new Error(`${fn}: shape must be an object, got ${s}`);
  if (!num(s.x) || !num(s.y)) throw new Error(`${fn}: x and y must be numbers, got ${s.x}, ${s.y}`);
  if (isCircle(s)) {
    if (!(s.r > 0) || !num(s.r)) throw new Error(`${fn}: circle r must be > 0, got ${s.r}`);
    return s;
  }
  if (!isPolygon(s)) {
    if (!(s.w > 0 && s.h > 0) || !num(s.w) || !num(s.h)) {
      throw new Error(`${fn}: give a rect { x, y, w, h }, a circle { x, y, r } or a polygon { x, y, points } with sizes > 0, got w=${s.w} h=${s.h}`);
    }
    return s;
  }
  const p = s.points;
  if (p.length < 3) throw new Error(`${fn}: a polygon needs at least 3 points, got ${p.length}`);
  for (const q of p) {
    if (!Array.isArray(q) || !num(q[0]) || !num(q[1])) throw new Error(`${fn}: polygon points must be [x, y] number pairs, got ${JSON.stringify(q)}`);
  }
  const a = area2(p);
  if (Math.abs(a) < 1e-12) throw new Error(`${fn}: polygon has no area (points are on one line)`);
  const sign = Math.sign(a);
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i];
    const [bx, by] = p[(i + 1) % p.length];
    const [cx, cy] = p[(i + 2) % p.length];
    if (ax === bx && ay === by) throw new Error(`${fn}: polygon point ${i} is repeated`);
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross * sign < -1e-9 * Math.abs(a)) {
      throw new Error(`${fn}: polygon is not convex (dent at point ${(i + 1) % p.length}); use world.addOutline or convexParts to split it into convex pieces`);
    }
  }
  return s;
}

/**
 * Corner points of a rect or polygon in world coordinates, as [[x, y], ...], always wound so
 * that edge (ex, ey) has the outward direction (ey, -ex). Not for circles.
 */
export function vertsOf(s) {
  if (isPolygon(s)) {
    const v = s.points.map((p) => [s.x + p[0], s.y + p[1]]);
    return area2(v) < 0 ? v.reverse() : v;
  }
  return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
}

/** Bounding box of any shape as { x, y, w, h }. */
export function boundsOf(s) {
  if (isCircle(s)) return { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 };
  if (!isPolygon(s)) return { x: s.x, y: s.y, w: s.w, h: s.h };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of s.points) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: s.x + x0, y: s.y + y0, w: x1 - x0, h: y1 - y0 };
}

/** Center point of any shape as { x, y } (for polygons: the average of the points). */
export function centerOf(s) {
  if (isCircle(s)) return { x: s.x, y: s.y };
  if (!isPolygon(s)) return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  let x = 0;
  let y = 0;
  for (const p of s.points) {
    x += p[0];
    y += p[1];
  }
  return { x: s.x + x / s.points.length, y: s.y + y / s.points.length };
}

/** A copy of just the shape fields of `s`, placed at (x, y). */
export function shapeAt(s, x = s.x, y = s.y) {
  if (isCircle(s)) return { x, y, r: s.r };
  if (isPolygon(s)) return { x, y, points: s.points };
  return { x, y, w: s.w, h: s.h };
}

/**
 * Make a convex polygon shape. Throws when the points are dented or have no area.
 * @param {number} x  position the points are relative to
 * @param {number} y
 * @param {Array<[number, number]>} points  corners in order, either direction
 * @returns {{x:number, y:number, points:Array}}
 */
export function polygon(x, y, points) {
  if (!Array.isArray(points)) throw new Error(`polygon: points must be an array of [x, y] pairs, got ${points}`);
  return checkShape({ x, y, points: points.map((p) => (Array.isArray(p) ? [p[0], p[1]] : p)) }, 'polygon');
}

/**
 * A box that can be turned: a polygon centred on (cx, cy). Use it for rotated walls and
 * buildings. With angle 0 it covers the same area as the rect { x: cx - w/2, y: cy - h/2, w, h }.
 * @param {number} cx  center x
 * @param {number} cy  center y
 * @param {number} w   width before turning
 * @param {number} h   height before turning
 * @param {number} [angle=0]  DEGREES, positive turns clockwise on screen (y down)
 */
export function box(cx, cy, w, h, angle = 0) {
  if (!(w > 0 && h > 0)) throw new Error(`box: w and h must be > 0, got ${w}, ${h}`);
  if (!num(angle)) throw new Error(`box: angle must be a number of degrees, got ${angle}`);
  const c = Math.cos(angle * Math.PI / 180);
  const s = Math.sin(angle * Math.PI / 180);
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return polygon(cx, cy, pts.map(([px, py]) => [px * c - py * s, px * s + py * c]));
}

/**
 * A regular polygon (triangle, hexagon, ...) centred on (cx, cy).
 * @param {number} sides  3 or more
 * @param {number} [angle=0]  DEGREES; 0 puts the first corner to the right
 */
export function regularPolygon(cx, cy, r, sides, angle = 0) {
  if (!(r > 0)) throw new Error(`regularPolygon: r must be > 0, got ${r}`);
  if (!Number.isInteger(sides) || sides < 3) throw new Error(`regularPolygon: sides must be a whole number >= 3, got ${sides}`);
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = angle * Math.PI / 180 + i / sides * 2 * Math.PI;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return polygon(cx, cy, pts);
}
