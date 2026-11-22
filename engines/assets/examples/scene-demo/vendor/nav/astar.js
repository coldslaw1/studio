// A* over a field: eight directions, never cutting a blocked corner, only over cells the body fits
// on, with a mild liking for a little room to spare so paths do not scrape along props.
import { need, q, createHeap } from './util.js';

const SQRT2 = Math.SQRT2;
const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * findGridPath(field, from, to, options) -> { points, complete, expanded, snapped, goal }
 *   from, to    { x, y }. A start or goal the body cannot stand on snaps to the nearest cell where it can.
 *   radius      = 0: the body's radius
 *   maxNodes    = 8000: cells the search may expand. Out of budget, the path leads to the cell that got
 *               closest and `complete` is false.
 *   margin      = one cell: within this much spare room of a prop, cells cost more
 *   marginCost  = 1.5: how much more, right at the prop
 * points: [x, y] cell centres from the first step to the goal, WITHOUT the start; empty when there is no
 * way at all. goal: where the path really ends ([x, y]); snapped: true when that is not the point asked for.
 */
export function findGridPath(field, from, to, options = {}) {
  need(field && field.clear && field.cost, 'findGridPath: field must come from nav.field() or buildField');
  need(from && Number.isFinite(from.x) && Number.isFinite(from.y), `findGridPath: from must be { x, y }, got ${JSON.stringify(from)}`);
  need(to && Number.isFinite(to.x) && Number.isFinite(to.y), `findGridPath: to must be { x, y }, got ${JSON.stringify(to)}`);
  const radius = options.radius ?? 0;
  const maxNodes = options.maxNodes ?? 8000;
  const margin = options.margin ?? field.cellSize;
  const marginCost = options.marginCost ?? 1.5;
  const { cols, rows, cost, clear } = field;
  const none = { points: [], complete: false, expanded: 0, snapped: false, goal: null };
  const start = field.nearestOpen(from.x, from.y, radius, 6);
  if (!start) return none;
  // no standing room anywhere near the goal (unloaded ground, deep inside a wall): still search toward it
  const near = field.nearestOpen(to.x, to.y, radius, options.snapRings ?? 16);
  const goal = near ?? [to.x, to.y];
  const snapped = goal[0] !== to.x || goal[1] !== to.y;
  const end = [q(goal[0]), q(goal[1])];
  const clampC = Math.max(0, Math.min(cols - 1, field.colOf(goal[0]))); const clampR = Math.max(0, Math.min(rows - 1, field.rowOf(goal[1])));
  const s = field.index(field.colOf(start[0]), field.rowOf(start[1]));
  const g = field.index(clampC, clampR);
  if (s === g && near) return { points: [end], complete: true, expanded: 0, snapped, goal: end };

  const n = cols * rows;
  let sc = field.scratch;
  if (!sc) sc = field.scratch = { run: 0, gScore: new Float32Array(n), fScore: new Float32Array(n), came: new Int32Array(n), seen: new Uint32Array(n), closed: new Uint32Array(n) };
  const run = ++sc.run;
  const { gScore, fScore, came, seen, closed } = sc;
  const gc = g % cols; const gr = (g / cols) | 0;
  const h = (i) => {
    const dc = Math.abs((i % cols) - gc); const dr = Math.abs(((i / cols) | 0) - gr);
    return dc > dr ? dc + (SQRT2 - 1) * dr : dr + (SQRT2 - 1) * dc;
  };
  const fits = (i) => cost[i] > 0 && clear[i] >= radius;
  const weight = (i) => { // ground cost, plus a little for being close to a prop
    const spare = clear[i] - radius;
    return cost[i] + (spare < margin && margin > 0 ? (1 - spare / margin) * marginCost : 0);
  };
  const heap = createHeap(fScore);
  gScore[s] = 0; fScore[s] = h(s); came[s] = -1; seen[s] = run; heap.push(s);
  let expanded = 0; let best = s; let bestH = h(s); let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur] === run) continue;
    closed[cur] = run;
    if (cur === g && near) { found = true; break; }
    if (++expanded > maxNodes) break;
    const hc = h(cur);
    if (hc < bestH) { bestH = hc; best = cur; }
    const c = cur % cols; const r = (cur / cols) | 0;
    const wc = weight(cur);
    for (let d = 0; d < 8; d++) {
      const nc = c + DC[d]; const nr = r + DR[d];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (closed[ni] === run || !fits(ni)) continue;
      if (d >= 4 && (!fits(r * cols + nc) || !fits(nr * cols + c))) continue; // no corner cutting
      const ng = gScore[cur] + (d >= 4 ? SQRT2 : 1) * (weight(ni) + wc) * 0.5;
      if (seen[ni] !== run || ng < gScore[ni]) { seen[ni] = run; gScore[ni] = ng; fScore[ni] = ng + h(ni); came[ni] = cur; heap.push(ni); }
    }
  }
  const last = found ? g : best;
  if (last === s) return { ...none, expanded };
  const points = [];
  for (let i = last; i !== s && i !== -1; i = came[i]) { const p = field.centre(i); points.push([q(p[0]), q(p[1])]); }
  points.reverse();
  if (found) points[points.length - 1] = end;
  return { points, complete: found, expanded, snapped: found && snapped, goal: found ? end : points[points.length - 1] };
}
