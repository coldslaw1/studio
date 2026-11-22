// A* over a nav grid: eight directions, never cutting a blocked corner, with a cap on the work one
// search may do. The cell path is then straightened into a few waypoints.
import { need, q } from './util.js';

const SQRT2 = Math.SQRT2;
const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];

// A binary heap of cell indices ordered by f score, ties broken by the lower index so results are fixed.
function createHeap(f) {
  const items = [];
  const less = (a, b) => f[a] < f[b] || (f[a] === f[b] && a < b);
  return {
    get size() { return items.length; },
    push(v) {
      let i = items.push(v) - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(items[i], items[p])) break;
        const t = items[i]; items[i] = items[p]; items[p] = t; i = p;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1; const r = l + 1;
          let m = i;
          if (l < items.length && less(items[l], items[m])) m = l;
          if (r < items.length && less(items[r], items[m])) m = r;
          if (m === i) break;
          const t = items[i]; items[i] = items[m]; items[m] = t; i = m;
        }
      }
      return top;
    },
  };
}

/** smoothPath(grid, points) -> fewer points: any waypoint that can be skipped in a straight clear line is dropped. */
export function smoothPath(grid, points) {
  if (points.length <= 2) return points;
  const out = [points[0]];
  let from = 0;
  while (from < points.length - 1) {
    let to = points.length - 1;
    while (to > from + 1 && !grid.lineClear(points[from][0], points[from][1], points[to][0], points[to][1])) to--;
    out.push(points[to]);
    from = to;
  }
  return out;
}

/**
 * findPath(grid, from, to, options) -> { points, complete, expanded }
 *   from, to    { x, y } world positions. A blocked start or goal snaps to the nearest open cell.
 *   maxNodes    = 4000: cells the search may expand. When it runs out, the path leads to the cell that
 *               got closest and `complete` is false, so the walker still heads the right way.
 *   smooth      = true: straighten the path
 * points is a list of [x, y] waypoints, WITHOUT the start and ending at the goal; empty when there is
 * no way at all. expanded is the work done (for budgets and tests).
 */
export function findPath(grid, from, to, options = {}) {
  need(grid && grid.cost && typeof grid.open === 'function', 'findPath: grid must be a nav grid (createNavGrid, navFromTiles, navFromShapes)');
  need(from && Number.isFinite(from.x) && Number.isFinite(from.y), `findPath: from must be { x, y }, got ${JSON.stringify(from)}`);
  need(to && Number.isFinite(to.x) && Number.isFinite(to.y), `findPath: to must be { x, y }, got ${JSON.stringify(to)}`);
  const maxNodes = options.maxNodes ?? 4000;
  const { cols, rows, cost } = grid;
  const start = grid.nearestOpen(from.x, from.y, 4);
  const goal = grid.nearestOpen(to.x, to.y, 8);
  if (!start || !goal) return { points: [], complete: false, expanded: 0 };
  const s = grid.index(grid.colOf(start[0]), grid.rowOf(start[1]));
  const g = grid.index(grid.colOf(goal[0]), grid.rowOf(goal[1]));
  const end = [q(goal[0]), q(goal[1])];
  if (s === g) return { points: [end], complete: true, expanded: 0 };
  if (options.smooth !== false && grid.lineClear(from.x, from.y, goal[0], goal[1])) return { points: [end], complete: true, expanded: 0 };

  // the search arrays are kept on the grid and reused: on a big map, allocating them per search costs
  // far more than the search itself. `seen` and `closed` hold the number of the search that last wrote a cell.
  const n = cols * rows;
  let sc = grid.scratch;
  if (!sc || sc.n !== n) sc = grid.scratch = { n, run: 0, gScore: new Float32Array(n), fScore: new Float32Array(n), came: new Int32Array(n), seen: new Uint32Array(n), closed: new Uint32Array(n) };
  if (++sc.run > 4e9) { sc.run = 1; sc.seen.fill(0); sc.closed.fill(0); }
  const { gScore, fScore, came, seen, closed, run } = sc;
  const gc = g % cols; const gr = (g / cols) | 0;
  const h = (i) => { // octile distance
    const dc = Math.abs((i % cols) - gc); const dr = Math.abs(((i / cols) | 0) - gr);
    return dc > dr ? dc + (SQRT2 - 1) * dr : dr + (SQRT2 - 1) * dc;
  };
  const heap = createHeap(fScore);
  gScore[s] = 0; fScore[s] = h(s); came[s] = -1; seen[s] = run; heap.push(s);
  let expanded = 0; let best = s; let bestH = h(s); let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur] === run) continue;
    closed[cur] = run;
    if (cur === g) { found = true; break; }
    if (++expanded > maxNodes) break;
    const hc = h(cur);
    if (hc < bestH) { bestH = hc; best = cur; }
    const c = cur % cols; const r = (cur / cols) | 0;
    for (let d = 0; d < 8; d++) {
      const nc = c + DC[d]; const nr = r + DR[d];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (closed[ni] === run || cost[ni] === 0) continue;
      if (d >= 4 && (cost[r * cols + nc] === 0 || cost[nr * cols + c] === 0)) continue; // no corner cutting
      const step = (d >= 4 ? SQRT2 : 1) * (cost[ni] + cost[cur]) * 0.5;
      const ng = gScore[cur] + step;
      if (seen[ni] !== run || ng < gScore[ni]) { seen[ni] = run; gScore[ni] = ng; fScore[ni] = ng + h(ni); came[ni] = cur; heap.push(ni); }
    }
  }
  const last = found ? g : best;
  if (last === s) return { points: [], complete: false, expanded };
  let points = [];
  for (let i = last; i !== s && i !== -1; i = came[i]) { const p = grid.centre(i); points.push([q(p[0]), q(p[1])]); }
  points.reverse();
  if (found) points[points.length - 1] = end;
  if (options.smooth !== false) points = smoothPath(grid, [[from.x, from.y], ...points]).slice(1);
  return { points, complete: found, expanded };
}
