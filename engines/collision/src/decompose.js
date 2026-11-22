// Splitting a dented (concave) outline into convex pieces, because every collision test in
// this engine works on convex shapes. Pure functions, no state.

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function area2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

function inTriangle(p, a, b, c) {
  return cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0;
}

// Cut a simple outline (wound so area2 > 0) into triangles of point indexes, one ear at a time.
function triangulate(pts) {
  const left = pts.map((_, i) => i);
  const tris = [];
  while (left.length > 3) {
    let ear = -1;
    let flattest = 0;
    for (let i = 0; i < left.length; i++) {
      const a = pts[left[(i + left.length - 1) % left.length]];
      const b = pts[left[i]];
      const c = pts[left[(i + 1) % left.length]];
      const turn = cross(a, b, c);
      if (Math.abs(turn) < Math.abs(cross(pts[left[(flattest + left.length - 1) % left.length]], pts[left[flattest]], pts[left[(flattest + 1) % left.length]]))) flattest = i;
      if (turn <= 0) continue; // a dent, or a straight run: not an ear
      if (left.some((k) => pts[k] !== a && pts[k] !== b && pts[k] !== c && inTriangle(pts[k], a, b, c))) continue;
      ear = i;
      break;
    }
    if (ear < 0) ear = flattest; // a crossed or squashed outline: drop the flattest corner and carry on
    const n = left.length;
    tris.push([left[(ear + n - 1) % n], left[ear], left[(ear + 1) % n]]);
    left.splice(ear, 1);
  }
  tris.push(left);
  return tris;
}

const isConvex = (pts, poly, eps) => poly.every((_, i) => cross(pts[poly[i]], pts[poly[(i + 1) % poly.length]], pts[poly[(i + 2) % poly.length]]) >= -eps);

// Join two index polygons along a shared edge (a then b in p, b then a in q), or null.
function join(p, q) {
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const j = q.indexOf(b);
    if (j < 0 || q[(j + 1) % q.length] !== a) continue;
    const out = [];
    for (let k = 1; k <= p.length; k++) out.push(p[(i + k) % p.length]); // b ... round to a
    for (let k = 2; k < q.length; k++) out.push(q[(j + k) % q.length]); // the rest of q, after a up to before b
    return out;
  }
  return null;
}

/**
 * Split an outline into convex pieces. A convex outline comes back as one piece; an L, a U or
 * any other dented outline comes back as a few pieces that together cover the same area.
 * @param {Array<[number, number]>} points  corners in order, either direction; the outline
 *   must not cross itself
 * @returns {Array<Array<[number, number]>>} one or more convex point lists, each usable as
 *   the `points` of a polygon shape
 */
export function convexParts(points) {
  if (!Array.isArray(points) || points.length < 3) throw new Error(`convexParts: needs an array of at least 3 [x, y] points, got ${Array.isArray(points) ? points.length + ' points' : points}`);
  for (const p of points) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error(`convexParts: points must be [x, y] number pairs, got ${JSON.stringify(p)}`);
  }
  // drop repeated points, and wind the outline one way
  let pts = points.filter((p, i) => { const q = points[(i + 1) % points.length]; return p[0] !== q[0] || p[1] !== q[1]; }).map((p) => [p[0], p[1]]);
  const total = area2(pts);
  if (pts.length < 3 || Math.abs(total) < 1e-12) throw new Error('convexParts: outline has no area (points are on one line)');
  if (total < 0) pts = pts.reverse();
  const eps = 1e-9 * Math.abs(total);
  const all = pts.map((_, i) => i);
  if (isConvex(pts, all, eps)) return [pts];
  // triangles first, then glue neighbours back together while the result stays convex
  const polys = triangulate(pts).filter((t) => Math.abs(cross(pts[t[0]], pts[t[1]], pts[t[2]])) > eps);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < polys.length && !merged; i++) {
      for (let j = i + 1; j < polys.length && !merged; j++) {
        const both = join(polys[i], polys[j]);
        if (!both || !isConvex(pts, both, eps)) continue;
        polys[i] = both;
        polys.splice(j, 1);
        merged = true;
      }
    }
  }
  return polys.map((poly) => poly.map((k) => [pts[k][0], pts[k][1]]));
}
