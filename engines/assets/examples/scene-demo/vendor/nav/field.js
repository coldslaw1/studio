// The field: a block of square cells around the place being played. Every cell knows its walking
// cost (0 = blocked) and its CLEARANCE: how far its centre is from the nearest thing in the way.
// "Can a body of radius r stand here" is then one comparison, so one field serves small and big
// walkers alike, and props keep their true round or slanted outline instead of a blocky one.
import { need } from './util.js';
import { shapeDistance } from './shapes.js';

const SQRT2 = Math.SQRT2;

// Walks the cells a straight line crosses; false as soon as ok(col, row) fails. Shared by fields and plain grids.
function trace(g, ok, x0, y0, x1, y1) {
  const { cellSize, originX, originY } = g;
  let c = Math.floor((x0 - originX) / cellSize); let r = Math.floor((y0 - originY) / cellSize);
  const c1 = Math.floor((x1 - originX) / cellSize); const r1 = Math.floor((y1 - originY) / cellSize);
  if (!ok(c, r)) return false;
  const dx = x1 - x0; const dy = y1 - y0;
  const sc = dx > 0 ? 1 : -1; const sr = dy > 0 ? 1 : -1;
  const tdx = dx === 0 ? Infinity : Math.abs(cellSize / dx);
  const tdy = dy === 0 ? Infinity : Math.abs(cellSize / dy);
  let tx = dx === 0 ? Infinity : ((dx > 0 ? (c + 1) * cellSize + originX - x0 : x0 - (c * cellSize + originX)) / Math.abs(dx));
  let ty = dy === 0 ? Infinity : ((dy > 0 ? (r + 1) * cellSize + originY - y0 : y0 - (r * cellSize + originY)) / Math.abs(dy));
  let guard = g.cols + g.rows + 4;
  while ((c !== c1 || r !== r1) && guard-- > 0) {
    if (Math.min(tx, ty) > 1) break;
    if (Math.abs(tx - ty) < 1e-12) { // exactly through a corner: both neighbours must be fine
      if (!ok(c + sc, r) || !ok(c, r + sr)) return false;
      c += sc; r += sr; tx += tdx; ty += tdy;
    } else if (tx < ty) { c += sc; tx += tdx; } else { r += sr; ty += tdy; }
    if (!ok(c, r)) return false;
  }
  return true;
}

function ringSearch(g, ok, x, y, rings) {
  const c0 = g.colOf(x); const r0 = g.rowOf(y);
  if (ok(c0, r0)) return [x, y];
  for (let ring = 1; ring <= rings; ring++) {
    let best = null; let bestD = Infinity;
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== ring || !ok(c, r)) continue;
        const px = g.originX + (c + 0.5) * g.cellSize; const py = g.originY + (r + 0.5) * g.cellSize;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < bestD) { bestD = d; best = [px, py]; }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * buildField(spec) -> field
 *   col0, row0, cols, rows   the block of cells covered (cell col covers x from col * cellSize)
 *   cellSize                 side of a cell in game units
 *   fill(cost, spec)         writes the ground cost of every cell into the Uint8Array (0 blocked, 1 plain, up to 255 slow)
 *   obstacles                [{ shape, pad }] props laid over the ground
 *   maxClear                 clearance is measured up to this distance
 * field: { cols, rows, cellSize, originX, originY, col0, row0, cost, clear, version,
 *   colOf(x), rowOf(y), index(col, row), inside(col, row), centre(index),
 *   open(col, row, radius = 0), openAt(x, y, radius = 0), clearAt(x, y), costAt(x, y),
 *   lineClear(x0, y0, x1, y1, radius = 0), nearestOpen(x, y, radius = 0, rings = 12) }
 */
export function buildField(spec) {
  const { col0, row0, cols, rows, cellSize, fill, obstacles = [], maxClear } = spec;
  need(cols > 0 && rows > 0 && cellSize > 0, `buildField: needs cols, rows and cellSize above 0, got ${cols} x ${rows}, cell ${cellSize}`);
  const n = cols * rows;
  const cost = new Uint8Array(n);
  const clear = new Float32Array(n);
  const originX = col0 * cellSize; const originY = row0 * cellSize;
  fill(cost, spec);

  // distance in cells to the nearest blocked ground cell (two-pass chamfer)
  for (let i = 0; i < n; i++) clear[i] = cost[i] === 0 ? 0 : 1e9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c; let d = clear[i];
      if (d === 0) continue;
      if (c > 0 && clear[i - 1] + 1 < d) d = clear[i - 1] + 1;
      if (r > 0) {
        if (clear[i - cols] + 1 < d) d = clear[i - cols] + 1;
        if (c > 0 && clear[i - cols - 1] + SQRT2 < d) d = clear[i - cols - 1] + SQRT2;
        if (c < cols - 1 && clear[i - cols + 1] + SQRT2 < d) d = clear[i - cols + 1] + SQRT2;
      }
      clear[i] = d;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c; let d = clear[i];
      if (d !== 0) {
        if (c < cols - 1 && clear[i + 1] + 1 < d) d = clear[i + 1] + 1;
        if (r < rows - 1) {
          if (clear[i + cols] + 1 < d) d = clear[i + cols] + 1;
          if (c < cols - 1 && clear[i + cols + 1] + SQRT2 < d) d = clear[i + cols + 1] + SQRT2;
          if (c > 0 && clear[i + cols - 1] + SQRT2 < d) d = clear[i + cols - 1] + SQRT2;
        }
      }
      clear[i] = d;
    }
  }
  // to game units: the blocked cell's edge is half a cell nearer than its centre
  for (let i = 0; i < n; i++) clear[i] = clear[i] === 0 ? 0 : Math.min(maxClear, Math.max(0, clear[i] * cellSize - cellSize * 0.5));
  // props: their true outline, measured from every cell centre near them
  for (const o of obstacles) {
    const b = o.bounds; const reach = maxClear + o.pad;
    const ca = Math.max(0, Math.floor((b.x0 - reach - originX) / cellSize)); const cb = Math.min(cols - 1, Math.floor((b.x1 + reach - originX) / cellSize));
    const ra = Math.max(0, Math.floor((b.y0 - reach - originY) / cellSize)); const rb = Math.min(rows - 1, Math.floor((b.y1 + reach - originY) / cellSize));
    for (let r = ra; r <= rb; r++) {
      const y = originY + (r + 0.5) * cellSize;
      for (let c = ca; c <= cb; c++) {
        const i = r * cols + c;
        if (clear[i] === 0) continue;
        const d = shapeDistance(o.shape, originX + (c + 0.5) * cellSize, y) - o.pad;
        if (d <= 0) { cost[i] = 0; clear[i] = 0; } else if (d < clear[i]) clear[i] = d;
      }
    }
  }

  const field = {
    cols, rows, cellSize, originX, originY, col0, row0, cost, clear, version: spec.version ?? 1, maxClear,
    colOf: (x) => Math.floor((x - originX) / cellSize),
    rowOf: (y) => Math.floor((y - originY) / cellSize),
    index: (col, row) => row * cols + col,
    inside: (col, row) => col >= 0 && row >= 0 && col < cols && row < rows,
    centre: (i) => [originX + ((i % cols) + 0.5) * cellSize, originY + (Math.floor(i / cols) + 0.5) * cellSize],
    /** open(col, row, radius) -> true when a body of that radius can stand on the cell. */
    open: (col, row, radius = 0) => col >= 0 && row >= 0 && col < cols && row < rows && cost[row * cols + col] > 0 && clear[row * cols + col] >= radius,
    /** costCell(col, row) -> the cell's ground cost (0 when blocked or outside). */
    costCell: (col, row) => (col >= 0 && row >= 0 && col < cols && row < rows ? cost[row * cols + col] : 0),
    openAt: (x, y, radius = 0) => field.open(field.colOf(x), field.rowOf(y), radius),
    /** clearAt(x, y) -> distance to the nearest thing in the way (0 when blocked or outside the field). */
    clearAt(x, y) { const c = field.colOf(x); const r = field.rowOf(y); return field.inside(c, r) ? clear[r * cols + c] : 0; },
    /**
     * roomAt(x, y) -> the room at an exact point: the clearance of the four cell centres round it, blended.
     * Use this for "may the body be exactly here"; open() and lineClear() answer per cell, for planning.
     */
    roomAt(x, y) {
      const fx = (x - originX) / cellSize - 0.5; const fy = (y - originY) / cellSize - 0.5;
      let c = Math.floor(fx); let r = Math.floor(fy);
      if (c < -1 || r < -1 || c >= cols || r >= rows) return 0;
      const tx = fx - c; const ty = fy - r;
      const ca = c < 0 ? 0 : c; const cb = c + 1 >= cols ? cols - 1 : c + 1;
      const ra = r < 0 ? 0 : r; const rb = r + 1 >= rows ? rows - 1 : r + 1;
      const top = clear[ra * cols + ca] * (1 - tx) + clear[ra * cols + cb] * tx;
      const bottom = clear[rb * cols + ca] * (1 - tx) + clear[rb * cols + cb] * tx;
      return top * (1 - ty) + bottom * ty;
    },
    /** fitsAt(x, y, radius) -> true when a body of that radius may stand exactly there. */
    fitsAt(x, y, radius = 0) { const c = field.colOf(x); const r = field.rowOf(y); return field.inside(c, r) && cost[r * cols + c] > 0 && field.roomAt(x, y) >= radius; },
    /**
     * mayStep(x0, y0, x1, y1, radius) -> true when a body at (x0, y0) may move to (x1, y1): it fits there, or it is
     * in a tight spot already and the move gives it more room (so a squeezed body can always work its way out).
     */
    mayStep(x0, y0, x1, y1, radius = 0) {
      const c = field.colOf(x1); const r = field.rowOf(y1);
      if (!field.inside(c, r) || cost[r * cols + c] === 0) return false;
      const room = field.roomAt(x1, y1);
      return room >= radius || room > field.roomAt(x0, y0);
    },
    costAt(x, y) { const c = field.colOf(x); const r = field.rowOf(y); return field.inside(c, r) ? cost[r * cols + c] : 0; },
    /**
     * lineClear(x0, y0, x1, y1, radius, maxCost) -> true when a body of that radius can walk the straight line.
     * Leaving the field counts as blocked. With maxCost, ground slower than that also counts (so a
     * shortcut is not taken through a bog).
     */
    lineClear: (x0, y0, x1, y1, radius = 0, maxCost = 255) => trace(field, (c, r) => field.open(c, r, radius) && cost[r * cols + c] <= maxCost, x0, y0, x1, y1),
    /** nearestOpen(x, y, radius, rings) -> [x, y]: the point itself when a body fits there, else the centre of the closest cell where it does, or null. */
    nearestOpen: (x, y, radius = 0, rings = 12) => ringSearch(field, (c, r) => field.open(c, r, radius), x, y, rings),
  };
  return field;
}

/**
 * plainGrid(spec) -> grid in the shape the ai engine's createNavGrid returns ({ cols, rows, cellSize,
 * originX, originY, cost, version, colOf, rowOf, index, inside, open, openAt, centre, setSolid, setCost,
 * fill, lineClear, nearestOpen }), so `createAi({ grid })`, `ai.setGrid(grid)` and the ai's findPath take it as it is.
 *   cols, rows, cellSize, originX = 0, originY = 0, cost (optional Uint8Array to use)
 */
export function plainGrid(spec) {
  const { cols, rows, cellSize, originX = 0, originY = 0 } = spec;
  need(Number.isInteger(cols) && cols > 0 && Number.isInteger(rows) && rows > 0, `plainGrid: cols and rows must be whole numbers above 0, got ${cols} x ${rows}`);
  need(cellSize > 0, `plainGrid: cellSize must be above 0, got ${String(cellSize)}`);
  const cost = spec.cost ?? new Uint8Array(cols * rows).fill(1);
  need(cost.length === cols * rows, `plainGrid: cost must have ${cols * rows} cells, got ${cost.length}`);
  const grid = {
    cols, rows, cellSize, originX, originY, cost, version: spec.version ?? 1,
    colOf: (x) => Math.floor((x - originX) / cellSize),
    rowOf: (y) => Math.floor((y - originY) / cellSize),
    index: (col, row) => row * cols + col,
    inside: (col, row) => col >= 0 && row >= 0 && col < cols && row < rows,
    open: (col, row) => col >= 0 && row >= 0 && col < cols && row < rows && cost[row * cols + col] > 0,
    openAt: (x, y) => grid.open(grid.colOf(x), grid.rowOf(y)),
    centre: (i) => [originX + ((i % cols) + 0.5) * cellSize, originY + (Math.floor(i / cols) + 0.5) * cellSize],
    setSolid(col, row, solid = true) { return grid.setCost(col, row, solid ? 0 : 1); },
    setCost(col, row, value) {
      need(grid.inside(col, row), `grid.setCost: cell ${col}, ${row} is outside the ${cols} x ${rows} grid`);
      need(Number.isInteger(value) && value >= 0 && value <= 255, `grid.setCost: cost must be a whole number 0..255, got ${String(value)}`);
      if (cost[row * cols + col] !== value) { cost[row * cols + col] = value; grid.version += 1; }
      return grid;
    },
    fill(fn) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = fn(c, r, originX + (c + 0.5) * cellSize, originY + (r + 0.5) * cellSize);
          cost[r * cols + c] = v === true ? 0 : v === false ? 1 : Math.max(0, Math.min(255, v | 0));
        }
      }
      grid.version += 1;
      return grid;
    },
    lineClear: (x0, y0, x1, y1) => trace(grid, grid.open, x0, y0, x1, y1),
    nearestOpen: (x, y, rings = 8) => ringSearch(grid, grid.open, x, y, rings),
  };
  return grid;
}

/**
 * gridForRadius(field, radius) -> a plain grid (see plainGrid) of the same cells in which every cell a
 * body of that radius cannot stand on is blocked. This is the grid to hand to the ai engine.
 */
export function gridForRadius(field, radius = 0) {
  const cost = new Uint8Array(field.cost.length);
  for (let i = 0; i < cost.length; i++) cost[i] = field.clear[i] >= radius ? field.cost[i] : 0;
  return plainGrid({ cols: field.cols, rows: field.rows, cellSize: field.cellSize, originX: field.originX, originY: field.originY, cost, version: field.version });
}
