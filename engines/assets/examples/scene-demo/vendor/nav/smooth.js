// Path smoothing. A cell path is a staircase; these turn it into a few straight legs (stringPull)
// and then soften the corners (roundPath), checking every new leg against the field for the body's
// radius, so smoothing can never lead a walker through a prop.
import { dist, q } from './util.js';

/** pathLength(points, from) -> length of the path, starting at `from` ({ x, y }) when given. */
export function pathLength(points, from = null) {
  let total = 0; let px = from ? from.x : points[0]?.[0]; let py = from ? from.y : points[0]?.[1];
  for (const p of points) { total += dist(px, py, p[0], p[1]); px = p[0]; py = p[1]; }
  return total;
}

/**
 * stringPull(field, points, radius = 0) -> fewer points. `points` starts at the walker's position. A
 * waypoint is dropped whenever the body can walk straight from the one before to the one after.
 */
export function stringPull(field, points, radius = 0) {
  if (points.length <= 2) return points.slice();
  const costAt = (p) => field.costCell(field.colOf(p[0]), field.rowOf(p[1]));
  let cur = points;
  for (let pass = 0; pass < 2; pass++) { // the second pass picks up shortcuts the first one opened
    const out = [cur[0]];
    let from = 0;
    while (from < cur.length - 1) {
      // a shortcut may not cross ground slower than the path it replaces (it would undo a detour round a bog)
      let cap = costAt(cur[from]);
      const clear = (to) => { for (let k = from + 1; k <= to; k++) { const c = costAt(cur[k]); if (c > cap) cap = c; } return field.lineClear(cur[from][0], cur[from][1], cur[to][0], cur[to][1], radius, cap); };
      let to = from + 1;
      // gallop forward while the far point is in a clear line, then settle on the last that was
      let step = 1;
      while (to + step < cur.length && clear(to + step)) { to += step; step *= 2; }
      while (step > 1) {
        step >>= 1;
        if (to + step < cur.length && clear(to + step)) to += step;
      }
      out.push(cur[to]);
      from = to;
    }
    if (out.length === cur.length) return out;
    cur = out;
  }
  return cur;
}

/**
 * roundPath(field, points, options) -> points with every corner replaced by a short curve.
 *   corner = one cell: how far before a corner the turn begins (never more than half a leg)
 *   steps  = 3: points per curve;  radius = 0: the body's radius, for the safety check
 * A corner whose curve would touch something keeps its sharp point. `points` starts at the walker.
 */
export function roundPath(field, points, options = {}) {
  const corner = options.corner ?? field.cellSize;
  const steps = options.steps ?? 3;
  const radius = options.radius ?? 0;
  if (points.length < 3 || corner <= 0) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1]; const b = points[i]; const c = points[i + 1];
    const la = dist(a[0], a[1], b[0], b[1]); const lc = dist(b[0], b[1], c[0], c[1]);
    const cut = Math.min(corner, la * 0.5, lc * 0.5);
    if (cut < 1e-6) { out.push(b); continue; }
    const p = [b[0] + (a[0] - b[0]) / la * cut, b[1] + (a[1] - b[1]) / la * cut];
    const e = [b[0] + (c[0] - b[0]) / lc * cut, b[1] + (c[1] - b[1]) / lc * cut];
    const curve = [];
    for (let k = 0; k <= steps; k++) { // a quadratic curve from p to e, pulled toward the corner
      const t = k / steps; const u = 1 - t;
      curve.push([q(u * u * p[0] + 2 * u * t * b[0] + t * t * e[0]), q(u * u * p[1] + 2 * u * t * b[1] + t * t * e[1])]);
    }
    let ok = true; let prev = a;
    for (const pt of curve) { if (!field.lineClear(prev[0], prev[1], pt[0], pt[1], radius)) { ok = false; break; } prev = pt; }
    if (ok) out.push(...curve); else out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}
