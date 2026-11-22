// Navmesh: the walkable ground as a few big convex pieces instead of thousands of cells. A search
// visits pieces, not cells, so long trips over open country cost almost nothing, and the path is
// pulled taut through the gaps between pieces (the funnel), so it comes out straight without a
// smoothing pass. Build one from a field (meshFromField) or from your own polygons (createNavMesh).
import { need, q, dist, createHeap, pointOf } from './util.js';
import { shapeDistance } from './shapes.js';

function finish(mesh) {
  for (const p of mesh.polys) p.links.sort((a, b) => a.to - b.to || a.ax - b.ax || a.ay - b.ay);
  return mesh;
}

/**
 * meshFromField(field, radius = 0) -> mesh. Every cell a body of that radius can stand on is merged
 * into rectangles (cells of one ground cost only), linked where they touch.
 * mesh: { polys: [{ id, cx, cy, cost, x0, y0, x1, y1, links: [{ to, ax, ay, bx, by }] }], inset, locate(x, y), snap(x, y) }
 */
export function meshFromField(field, radius = 0) {
  need(field && field.clear, 'meshFromField: field must come from nav.field() or buildField');
  const { cols, rows, cost, clear, cellSize: cs, originX: ox, originY: oy } = field;
  const owner = new Int32Array(cols * rows).fill(-1);
  const fits = (i) => cost[i] > 0 && clear[i] >= radius;
  const polys = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (owner[i] >= 0 || !fits(i)) continue;
      const k = cost[i];
      let c1 = c + 1;
      while (c1 < cols && owner[r * cols + c1] < 0 && fits(r * cols + c1) && cost[r * cols + c1] === k) c1++;
      let r1 = r + 1;
      grow: while (r1 < rows) {
        for (let cc = c; cc < c1; cc++) { const j = r1 * cols + cc; if (owner[j] >= 0 || !fits(j) || cost[j] !== k) break grow; }
        r1++;
      }
      const id = polys.length;
      for (let rr = r; rr < r1; rr++) for (let cc = c; cc < c1; cc++) owner[rr * cols + cc] = id;
      polys.push({ id, cost: k, x0: ox + c * cs, y0: oy + r * cs, x1: ox + c1 * cs, y1: oy + r1 * cs, cx: ox + (c + c1) * cs / 2, cy: oy + (r + r1) * cs / 2, c0: c, r0: r, c1, r1, links: [] });
    }
  }
  const link = (a, b, ax, ay, bx, by) => { polys[a].links.push({ to: b, ax, ay, bx, by }); polys[b].links.push({ to: a, ax, ay, bx, by }); };
  for (const p of polys) {
    if (p.c1 < cols) { // right side: runs of one neighbour
      let from = p.r0;
      for (let r = p.r0; r <= p.r1; r++) {
        const o = r < p.r1 ? owner[r * cols + p.c1] : -2;
        const was = owner[from * cols + p.c1];
        if (o !== was) { if (was >= 0) link(p.id, was, p.x1, oy + from * cs, p.x1, oy + r * cs); from = r; }
      }
    }
    if (p.r1 < rows) { // bottom side
      let from = p.c0;
      for (let c = p.c0; c <= p.c1; c++) {
        const o = c < p.c1 ? owner[p.r1 * cols + c] : -2;
        const was = owner[p.r1 * cols + from];
        if (o !== was) { if (was >= 0) link(p.id, was, ox + from * cs, p.y1, ox + c * cs, p.y1); from = c; }
      }
    }
  }
  return finish({
    polys, inset: cs * 0.5, radius, version: field.version,
    locate(x, y) { const c = field.colOf(x); const r = field.rowOf(y); return field.inside(c, r) ? owner[r * cols + c] : -1; },
    snap: (x, y) => field.nearestOpen(x, y, radius, 16),
  });
}

/**
 * createNavMesh({ polygons }) -> mesh from your own convex polygons.
 *   polygons   [{ points: [[x, y], ...], cost = 1 }] or bare point lists. Two polygons are linked where
 *              they share an edge (the same two corner points). Each must be convex.
 */
export function createNavMesh(options = {}) {
  need(Array.isArray(options.polygons) && options.polygons.length > 0, 'createNavMesh: polygons must be a list with at least one polygon');
  const edges = new Map();
  const key = (p) => `${q(p[0])},${q(p[1])}`;
  const polys = options.polygons.map((raw, id) => {
    const points = (Array.isArray(raw) ? raw : raw.points).map(pointOf);
    need(points.length >= 3, `createNavMesh: polygon ${id} needs at least 3 points`);
    let cx = 0; let cy = 0;
    for (const p of points) { cx += p[0]; cy += p[1]; }
    return { id, points, shape: { x: 0, y: 0, points }, cost: (Array.isArray(raw) ? 1 : raw.cost) ?? 1, cx: cx / points.length, cy: cy / points.length, links: [] };
  });
  for (const p of polys) {
    for (let i = 0; i < p.points.length; i++) {
      const a = p.points[i]; const b = p.points[(i + 1) % p.points.length];
      const ka = key(a); const kb = key(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const other = edges.get(k);
      if (other === undefined) edges.set(k, p.id);
      else { p.links.push({ to: other, ax: a[0], ay: a[1], bx: b[0], by: b[1] }); polys[other].links.push({ to: p.id, ax: a[0], ay: a[1], bx: b[0], by: b[1] }); }
    }
  }
  const locate = (x, y) => { for (const p of polys) if (shapeDistance(p.shape, x, y) <= 1e-9) return p.id; return -1; };
  return finish({
    polys, inset: 0, radius: 0, version: 1, locate,
    snap(x, y) {
      if (locate(x, y) >= 0) return [x, y];
      let best = null; let bestD = Infinity;
      for (const p of polys) { const d = shapeDistance(p.shape, x, y); if (d < bestD) { bestD = d; best = p; } }
      // step from the point toward the nearest polygon's middle until inside it
      for (let t = 0.05; t <= 1; t += 0.05) { const px = x + (best.cx - x) * t; const py = y + (best.cy - y) * t; if (shapeDistance(best.shape, px, py) <= 0) return [px, py]; }
      return [best.cx, best.cy];
    },
  });
}

const tri = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

// The funnel: the shortest line through a row of gaps ("portals"), each given as [left, right].
function funnel(start, portals, goal) {
  const all = [[start, start], ...portals, [goal, goal]];
  const pts = [];
  let apex = start; let left = start; let right = start; let ai = 0; let li = 0; let ri = 0;
  for (let i = 1; i < all.length; i++) {
    const [nl, nr] = all[i];
    if (tri(apex, right, nr) <= 0) {
      if (same(apex, right) || tri(apex, left, nr) > 0) { right = nr; ri = i; } else {
        pts.push(left); apex = left; ai = li; left = apex; right = apex; li = ai; ri = ai; i = ai; continue;
      }
    }
    if (tri(apex, left, nl) >= 0) {
      if (same(apex, left) || tri(apex, right, nl) < 0) { left = nl; li = i; } else {
        pts.push(right); apex = right; ai = ri; left = apex; right = apex; li = ai; ri = ai; i = ai; continue;
      }
    }
  }
  pts.push(goal);
  return pts;
}

function closest(l, inset, px, py) { // nearest point to (px, py) on the link's gap, kept `inset` from its ends
  const ex = l.bx - l.ax; const ey = l.by - l.ay;
  const len = Math.sqrt(ex * ex + ey * ey) || 1;
  const cut = Math.min(inset, len * 0.5) / len;
  let t = ((px - l.ax) * ex + (py - l.ay) * ey) / (len * len);
  t = t < cut ? cut : t > 1 - cut ? 1 - cut : t;
  return [l.ax + ex * t, l.ay + ey * t];
}

/**
 * findMeshPath(mesh, from, to, options) -> { points, complete, expanded, snapped, goal }
 *   from, to   { x, y }; a point off the mesh snaps to the nearest place on it
 *   inset      = 0: extra distance to keep from the ends of every gap (use the body's radius on a
 *              createNavMesh mesh; a meshFromField mesh already allows for the body)
 *   maxNodes   = 4000: pieces the search may expand
 * points are [x, y] corners WITHOUT the start, ending at the goal; empty when there is no way.
 */
export function findMeshPath(mesh, from, to, options = {}) {
  need(mesh && Array.isArray(mesh.polys) && typeof mesh.locate === 'function', 'findMeshPath: mesh must come from meshFromField or createNavMesh');
  need(from && Number.isFinite(from.x) && Number.isFinite(from.y), `findMeshPath: from must be { x, y }, got ${JSON.stringify(from)}`);
  need(to && Number.isFinite(to.x) && Number.isFinite(to.y), `findMeshPath: to must be { x, y }, got ${JSON.stringify(to)}`);
  const none = { points: [], complete: false, expanded: 0, snapped: false, goal: null };
  const inset = mesh.inset + (options.inset ?? 0);
  const maxNodes = options.maxNodes ?? 4000;
  const start = mesh.snap(from.x, from.y);
  if (!start) return none;
  const goal = mesh.snap(to.x, to.y) ?? [to.x, to.y]; // nowhere to stand near the goal: still head toward it
  const sp = mesh.locate(start[0], start[1]); const gp = mesh.locate(goal[0], goal[1]);
  if (sp < 0) return none;
  const snapped = goal[0] !== to.x || goal[1] !== to.y;
  const end = [q(goal[0]), q(goal[1])];
  if (sp === gp) return { points: [end], complete: true, expanded: 0, snapped, goal: end };
  const n = mesh.polys.length;
  const g = new Float32Array(n).fill(Infinity); const f = new Float32Array(n); const came = new Int32Array(n).fill(-1);
  const via = new Array(n).fill(null); const ex = new Float32Array(n); const ey = new Float32Array(n); const closed = new Uint8Array(n);
  const heap = createHeap(f);
  g[sp] = 0; ex[sp] = start[0]; ey[sp] = start[1]; f[sp] = dist(start[0], start[1], goal[0], goal[1]); heap.push(sp);
  let expanded = 0; let found = false; let best = sp; let bestH = f[sp];
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === gp) { found = true; break; }
    if (++expanded > maxNodes) break;
    const hc = dist(ex[cur], ey[cur], goal[0], goal[1]);
    if (hc < bestH) { bestH = hc; best = cur; }
    const poly = mesh.polys[cur];
    for (const l of poly.links) {
      if (closed[l.to]) continue;
      const p = closest(l, inset, ex[cur], ey[cur]);
      const ng = g[cur] + dist(ex[cur], ey[cur], p[0], p[1]) * poly.cost;
      if (ng < g[l.to]) { g[l.to] = ng; ex[l.to] = p[0]; ey[l.to] = p[1]; came[l.to] = cur; via[l.to] = l; f[l.to] = ng + dist(p[0], p[1], goal[0], goal[1]); heap.push(l.to); }
    }
  }
  const last = found ? gp : best;
  if (last === sp) return { ...none, expanded };
  const chain = [];
  for (let i = last; i !== sp; i = came[i]) chain.push(i);
  chain.reverse();
  const portals = [];
  let prev = sp;
  for (const id of chain) {
    const l = via[id]; const from0 = mesh.polys[prev];
    const lenL = dist(l.ax, l.ay, l.bx, l.by) || 1; const cut = Math.min(inset, lenL * 0.5) / lenL;
    const a = [l.ax + (l.bx - l.ax) * cut, l.ay + (l.by - l.ay) * cut]; const b = [l.bx + (l.ax - l.bx) * cut, l.by + (l.ay - l.by) * cut];
    portals.push(tri([from0.cx, from0.cy], a, b) > 0 ? [a, b] : [b, a]);
    prev = id;
  }
  const target = found ? end : [q(ex[last]), q(ey[last])];
  const points = funnel(start, portals, target).map((p) => [q(p[0]), q(p[1])]);
  // drop repeats (a gap one cell wide is a single point)
  const out = [];
  for (const p of points) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  if (out.length > 1 && same(out[0], start)) out.shift();
  return { points: out, complete: found, expanded, snapped: found && snapped, goal: out[out.length - 1] };
}
