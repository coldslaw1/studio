// The navigation grid: square cells that are open (with a walking cost) or blocked. Path-finding,
// flow fields, wall avoidance and the default line of sight all read it. Build it from a tile map,
// from collision shapes (Kiln footprints), or cell by cell.
import { need } from './util.js';

/**
 * createNavGrid(options) -> grid
 *   cols, rows   size in cells (required, whole numbers above 0)
 *   cellSize     side of a cell in game units (required)
 *   originX, originY = 0   world position of the grid's top-left corner
 * grid: { cols, rows, cellSize, originX, originY, cost (Uint8Array: 0 blocked, 1..255 cost), version,
 *   colOf(x), rowOf(y), index(col, row), inside(col, row), open(col, row), openAt(x, y), centre(index),
 *   setSolid(col, row, solid = true), setCost(col, row, cost), fill(fn), lineClear(x0, y0, x1, y1),
 *   nearestOpen(x, y, rings = 8) }
 * `version` goes up on every change, so cached paths and flow fields know they are stale.
 */
export function createNavGrid(options = {}) {
  const { cols, rows, cellSize, originX = 0, originY = 0 } = options;
  need(Number.isInteger(cols) && cols > 0 && Number.isInteger(rows) && rows > 0, `createNavGrid: cols and rows must be whole numbers above 0, got ${cols} x ${rows}`);
  need(cellSize > 0, `createNavGrid: cellSize must be above 0, got ${String(cellSize)}`);
  const cost = new Uint8Array(cols * rows).fill(1);
  const grid = {
    cols, rows, cellSize, originX, originY, cost, version: 1,
    colOf: (x) => Math.floor((x - originX) / cellSize),
    rowOf: (y) => Math.floor((y - originY) / cellSize),
    index: (col, row) => row * cols + col,
    inside: (col, row) => col >= 0 && row >= 0 && col < cols && row < rows,
    /** open(col, row) -> true when the cell exists and can be walked. */
    open: (col, row) => col >= 0 && row >= 0 && col < cols && row < rows && cost[row * cols + col] > 0,
    openAt: (x, y) => grid.open(grid.colOf(x), grid.rowOf(y)),
    /** centre(index) -> [x, y] world position of the middle of a cell. */
    centre: (i) => [originX + ((i % cols) + 0.5) * cellSize, originY + (Math.floor(i / cols) + 0.5) * cellSize],
    setSolid(col, row, solid = true) { return grid.setCost(col, row, solid ? 0 : 1); },
    /** setCost(col, row, cost) 0 blocks the cell, 1 is plain ground, higher numbers are slower ground (mud, water's edge). */
    setCost(col, row, value) {
      need(grid.inside(col, row), `grid.setCost: cell ${col}, ${row} is outside the ${cols} x ${rows} grid`);
      need(Number.isInteger(value) && value >= 0 && value <= 255, `grid.setCost: cost must be a whole number 0..255, got ${String(value)}`);
      if (cost[row * cols + col] !== value) { cost[row * cols + col] = value; grid.version += 1; }
      return grid;
    },
    /** fill(fn) sets every cell from fn(col, row, x, y) -> cost (0 blocked; true/false also work: true = blocked). */
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
    /**
     * lineClear(x0, y0, x1, y1) -> true when the straight line crosses no blocked cell. Leaving the grid
     * counts as blocked. This is the default line of sight and the test used to straighten paths.
     */
    lineClear(x0, y0, x1, y1) {
      let c = grid.colOf(x0); let r = grid.rowOf(y0);
      const c1 = grid.colOf(x1); const r1 = grid.rowOf(y1);
      if (!grid.open(c, r)) return false;
      const dx = x1 - x0; const dy = y1 - y0;
      const sc = dx > 0 ? 1 : -1; const sr = dy > 0 ? 1 : -1;
      const tdx = dx === 0 ? Infinity : Math.abs(cellSize / dx);
      const tdy = dy === 0 ? Infinity : Math.abs(cellSize / dy);
      let tx = dx === 0 ? Infinity : ((dx > 0 ? (c + 1) * cellSize + originX - x0 : x0 - (c * cellSize + originX)) / Math.abs(dx));
      let ty = dy === 0 ? Infinity : ((dy > 0 ? (r + 1) * cellSize + originY - y0 : y0 - (r * cellSize + originY)) / Math.abs(dy));
      let guard = cols + rows + 4;
      while ((c !== c1 || r !== r1) && guard-- > 0) {
        if (Math.min(tx, ty) > 1) break; // the end point lies on a cell edge: the line has ended without crossing into it
        if (Math.abs(tx - ty) < 1e-12) { // exactly through a corner: both neighbours must be open
          if (!grid.open(c + sc, r) || !grid.open(c, r + sr)) return false;
          c += sc; r += sr; tx += tdx; ty += tdy;
        } else if (tx < ty) { c += sc; tx += tdx; } else { r += sr; ty += tdy; }
        if (!grid.open(c, r)) return false;
      }
      return true;
    },
    /** nearestOpen(x, y, rings = 8) -> [x, y] centre of the closest open cell (searching outward in rings), or null. */
    nearestOpen(x, y, rings = 8) {
      const c0 = grid.colOf(x); const r0 = grid.rowOf(y);
      if (grid.open(c0, r0)) return [x, y];
      for (let ring = 1; ring <= rings; ring++) {
        let best = null; let bestD = Infinity;
        for (let r = r0 - ring; r <= r0 + ring; r++) {
          for (let c = c0 - ring; c <= c0 + ring; c++) {
            if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== ring || !grid.open(c, r)) continue;
            const p = grid.centre(r * cols + c);
            const d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
            if (d < bestD) { bestD = d; best = p; }
          }
        }
        if (best) return best;
      }
      return null;
    },
  };
  return grid;
}

/**
 * navFromTiles(map, options) -> grid. `map` is any tile map with `tileSize` and `isSolid(col, row)`:
 * the physics engine's createTileMap, the world engine's createTileMap, or your own object.
 *   cols, rows   how many tiles to cover (required);  col0, row0 = 0   the first tile
 */
export function navFromTiles(map, options = {}) {
  need(map && map.tileSize > 0 && typeof map.isSolid === 'function', 'navFromTiles: map must have tileSize and isSolid(col, row)');
  const { cols, rows, col0 = 0, row0 = 0 } = options;
  const grid = createNavGrid({ cols, rows, cellSize: map.tileSize, originX: col0 * map.tileSize, originY: row0 * map.tileSize });
  return grid.fill((c, r) => !!map.isSolid(c + col0, r + row0));
}

const pointOf = (p) => (Array.isArray(p) ? p : [p.x, p.y]);

function insideShape(shape, x, y, pad) {
  if (shape.r > 0 && !shape.points) return (x - shape.x) * (x - shape.x) + (y - shape.y) * (y - shape.y) <= (shape.r + pad) * (shape.r + pad);
  if (shape.points) { // convex polygon, points relative to the shape's x, y
    const ox = shape.x ?? 0; const oy = shape.y ?? 0;
    const n = shape.points.length;
    let sign = 0;
    for (let i = 0; i < n; i++) {
      const a = pointOf(shape.points[i]); const b = pointOf(shape.points[(i + 1) % n]);
      const ex = b[0] - a[0]; const ey = b[1] - a[1];
      const cross = ex * (y - oy - a[1]) - ey * (x - ox - a[0]);
      const edge = Math.sqrt(ex * ex + ey * ey) || 1;
      const side = cross / edge; // signed distance to this edge
      if (sign === 0 && Math.abs(side) > pad) sign = side > 0 ? 1 : -1;
      if (sign !== 0 && side * sign < -pad) return false;
    }
    return true;
  }
  return x >= shape.x - pad && y >= shape.y - pad && x <= shape.x + shape.w + pad && y <= shape.y + shape.h + pad;
}

/**
 * navFromShapes(options) -> grid with every cell whose centre is inside a shape (or within `padding` of it) blocked.
 *   shapes    solid shapes in the collision engine's forms: { x, y, w, h } (top-left box), { x, y, r } (circle),
 *             { x, y, points } (convex polygon, points relative to x, y). Kiln's view.footprints() are the last kind.
 *   bounds    { x, y, w, h } the area to cover (required);  cellSize (required)
 *   padding   = 0: grow every shape by this much; use the walker's radius so paths keep clear of walls
 *   blocked   optional (x, y) => true for more blocked ground, for example (x, y) => view.isWater(x, y)
 */
export function navFromShapes(options = {}) {
  const { shapes = [], bounds, cellSize, padding = 0, blocked = null } = options;
  need(bounds && bounds.w > 0 && bounds.h > 0, 'navFromShapes: bounds must be { x, y, w, h } with a size');
  need(cellSize > 0, `navFromShapes: cellSize must be above 0, got ${String(cellSize)}`);
  need(Array.isArray(shapes), 'navFromShapes: shapes must be a list');
  const grid = createNavGrid({ cols: Math.ceil(bounds.w / cellSize), rows: Math.ceil(bounds.h / cellSize), cellSize, originX: bounds.x, originY: bounds.y });
  for (const s of shapes) need(s && Number.isFinite(s.x ?? 0) && (s.points || s.r > 0 || (s.w > 0 && s.h > 0)), `navFromShapes: not a shape: ${JSON.stringify(s)}`);
  return grid.fill((c, r, x, y) => {
    if (blocked && blocked(x, y)) return true;
    for (const s of shapes) if (insideShape(s, x, y, padding)) return true;
    return false;
  });
}
