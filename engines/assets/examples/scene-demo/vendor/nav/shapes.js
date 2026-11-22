// Obstacle shapes, in the collision engine's forms: rect { x, y, w, h } (x, y = top-left corner),
// circle { x, y, r } (x, y = centre), polygon { x, y, points: [[px, py], ...] } (points relative to
// x, y; dents are allowed here). The one question asked of a shape is "how far is this point from it".
import { need, pointOf } from './util.js';

/** shapeKind(shape) -> 'circle' | 'polygon' | 'rect'; throws when it is none of them. */
export function shapeKind(shape) {
  need(shape && typeof shape === 'object', `nav: not a shape: ${JSON.stringify(shape)}`);
  if (Array.isArray(shape.points)) { need(shape.points.length >= 3, 'nav: a polygon needs at least 3 points'); return 'polygon'; }
  if (shape.r > 0) { need(Number.isFinite(shape.x) && Number.isFinite(shape.y), `nav: a circle needs x and y, got ${JSON.stringify(shape)}`); return 'circle'; }
  need(shape.w > 0 && shape.h > 0 && Number.isFinite(shape.x) && Number.isFinite(shape.y), `nav: not a shape (rect { x, y, w, h }, circle { x, y, r } or polygon { x, y, points }): ${JSON.stringify(shape)}`);
  return 'rect';
}

/** shapeBounds(shape) -> { x0, y0, x1, y1 } the box around it. */
export function shapeBounds(shape) {
  const kind = shapeKind(shape);
  if (kind === 'circle') return { x0: shape.x - shape.r, y0: shape.y - shape.r, x1: shape.x + shape.r, y1: shape.y + shape.r };
  if (kind === 'rect') return { x0: shape.x, y0: shape.y, x1: shape.x + shape.w, y1: shape.y + shape.h };
  const ox = shape.x ?? 0; const oy = shape.y ?? 0;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of shape.points) {
    const [px, py] = pointOf(p);
    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  return { x0: x0 + ox, y0: y0 + oy, x1: x1 + ox, y1: y1 + oy };
}

/**
 * shapeDistance(shape, x, y) -> distance from the point to the shape's edge: above 0 outside,
 * 0 on the edge, below 0 inside.
 */
export function shapeDistance(shape, x, y) {
  if (Array.isArray(shape.points)) {
    const ox = shape.x ?? 0; const oy = shape.y ?? 0;
    const px = x - ox; const py = y - oy;
    const pts = shape.points; const n = pts.length;
    let inside = false; let best = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [ax, ay] = pointOf(pts[j]); const [bx, by] = pointOf(pts[i]);
      if ((ay > py) !== (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax) inside = !inside;
      const ex = bx - ax; const ey = by - ay;
      const l2 = ex * ex + ey * ey;
      let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - (ax + ex * t); const dy = py - (ay + ey * t);
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    best = Math.sqrt(best);
    return inside ? -best : best;
  }
  if (shape.r > 0) return Math.sqrt((x - shape.x) * (x - shape.x) + (y - shape.y) * (y - shape.y)) - shape.r;
  const dx = Math.max(shape.x - x, x - (shape.x + shape.w));
  const dy = Math.max(shape.y - y, y - (shape.y + shape.h));
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy);
  return Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2);
}

/** moveShape(shape, x, y) -> a copy of the shape at another position. */
export function moveShape(shape, x, y) {
  return { ...shape, x, y };
}
