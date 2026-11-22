// Flow fields: one search outward from a goal gives every cell its distance to it, so any number of
// agents heading for the same place (a pack chasing one player) share the work of a single search.
// On a big map the field only covers a window around the goal, so it stays small and quick to build.
import { need, q } from './util.js';

const SQRT2 = Math.SQRT2;
const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * createFlowField(grid, goal, options) -> field
 *   goal       { x, y } (snapped to the nearest open cell) or a list of them (the nearest one wins)
 *   reach      = 64: the field covers this many CELLS in every direction from the (first) goal. Grids up
 *              to 200 x 200 cells are covered whole unless you pass a reach.
 *   maxCells   = 20000: cells the search may fill; cells beyond that have no direction
 *   maxDist    = Infinity: stop this many CELLS of walking distance from the goal
 * field: { dist (Float32Array over the window: walking distance in cells, Infinity where unknown),
 *   c0, r0, w, h (the window, in cells), version (of the grid when built), filled, goal: { x, y },
 *   distAt(x, y) -> game units or Infinity, dirAt(x, y) -> [dx, dy] unit vector toward the goal, or null
 *   when the spot is outside the window, unknown, or the goal itself }
 */
export function createFlowField(grid, goal, options = {}) {
  need(grid && grid.cost && typeof grid.open === 'function', 'createFlowField: grid must be a nav grid');
  const goals = Array.isArray(goal) ? goal : [goal];
  need(goals.length > 0 && goals.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)), 'createFlowField: goal must be { x, y } or a list of them');
  const { cols, rows, cost } = grid;
  const maxCells = options.maxCells ?? 20000;
  const maxDist = options.maxDist ?? Infinity;
  const whole = options.reach === undefined && cols <= 200 && rows <= 200;
  const reach = options.reach ?? 64;
  const gc = grid.colOf(goals[0].x); const gr = grid.rowOf(goals[0].y);
  const c0 = whole ? 0 : Math.max(0, gc - reach); const r0 = whole ? 0 : Math.max(0, gr - reach);
  const w = Math.max(1, (whole ? cols : Math.min(cols, gc + reach + 1)) - c0);
  const h = Math.max(1, (whole ? rows : Math.min(rows, gr + reach + 1)) - r0);
  const dist = new Float32Array(w * h).fill(Infinity);
  const inWin = (c, r) => c >= c0 && r >= r0 && c < c0 + w && r < r0 + h;
  const at = (c, r) => (r - r0) * w + (c - c0);
  const solid = (c, r) => cost[r * cols + c] === 0;
  // a small binary heap of [distance, window index] kept in two parallel arrays
  const hd = []; const hi = [];
  const less = (a, b) => hd[a] < hd[b] || (hd[a] === hd[b] && hi[a] < hi[b]);
  const swap = (a, b) => { const d = hd[a]; hd[a] = hd[b]; hd[b] = d; const i = hi[a]; hi[a] = hi[b]; hi[b] = i; };
  const push = (d, i) => {
    let k = hd.push(d) - 1; hi.push(i);
    while (k > 0) { const p = (k - 1) >> 1; if (!less(k, p)) break; swap(k, p); k = p; }
  };
  const pop = () => {
    const out = hi[0];
    const ld = hd.pop(); const li = hi.pop();
    if (hd.length) {
      hd[0] = ld; hi[0] = li;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1; const r = l + 1; let m = k;
        if (l < hd.length && less(l, m)) m = l;
        if (r < hd.length && less(r, m)) m = r;
        if (m === k) break;
        swap(k, m); k = m;
      }
    }
    return out;
  };
  let first = null;
  for (const p of goals) {
    const open = grid.nearestOpen(p.x, p.y, 8);
    if (!open) continue;
    const c = grid.colOf(open[0]); const r = grid.rowOf(open[1]);
    if (!inWin(c, r)) continue;
    if (!first) first = open;
    if (dist[at(c, r)] !== 0) { dist[at(c, r)] = 0; push(0, at(c, r)); }
  }
  let filled = 0;
  while (hd.length && filled < maxCells) {
    const d = hd[0];
    const cur = pop();
    if (d > dist[cur]) continue;
    filled++;
    if (d >= maxDist) continue;
    const c = c0 + (cur % w); const r = r0 + ((cur / w) | 0);
    const here = cost[r * cols + c];
    for (let k = 0; k < 8; k++) {
      const nc = c + DC[k]; const nr = r + DR[k];
      if (!inWin(nc, nr) || solid(nc, nr)) continue;
      if (k >= 4 && (solid(nc, r) || solid(c, nr))) continue; // no corner cutting
      const nd = Math.fround(d + (k >= 4 ? SQRT2 : 1) * (cost[nr * cols + nc] + here) * 0.5); // fround: dist is a Float32Array
      const ni = at(nc, nr);
      if (nd < dist[ni]) { dist[ni] = nd; push(nd, ni); }
    }
  }
  return {
    dist, c0, r0, w, h, filled, version: grid.version,
    goal: first ? { x: q(first[0]), y: q(first[1]) } : null,
    distAt(x, y) {
      const c = grid.colOf(x); const r = grid.rowOf(y);
      return inWin(c, r) ? dist[at(c, r)] * grid.cellSize : Infinity;
    },
    dirAt(x, y) {
      const c = grid.colOf(x); const r = grid.rowOf(y);
      if (!inWin(c, r)) return null;
      const here = dist[at(c, r)];
      if (here === 0) return null;
      let best = here; let bc = 0; let br = 0;
      for (let k = 0; k < 8; k++) {
        const nc = c + DC[k]; const nr = r + DR[k];
        if (!inWin(nc, nr)) continue;
        if (k >= 4 && (solid(nc, r) || solid(c, nr))) continue;
        const nd = dist[at(nc, nr)];
        if (nd < best) { best = nd; bc = DC[k]; br = DR[k]; }
      }
      if (best === here || best === Infinity) return null; // unknown, or a walled-off pocket
      // aim at the centre of the better neighbour, so a walker that drifted off-centre is pulled back in line
      const tx = grid.originX + (c + bc + 0.5) * grid.cellSize - x;
      const ty = grid.originY + (r + br + 0.5) * grid.cellSize - y;
      const l = Math.sqrt(tx * tx + ty * ty) || 1;
      return [tx / l, ty / l];
    },
  };
}
