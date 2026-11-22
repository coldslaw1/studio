// What the walkers know about the ground: chunks of cells (loaded and dropped as an open world
// streams), props laid over them (the well, a cart, a door that opens), and the field built from
// both around the place being played. Everything here is plain data in, plain data out.
import { need } from './util.js';
import { shapeKind, shapeBounds } from './shapes.js';
import { buildField } from './field.js';

/**
 * createModel(cfg) -> model. cfg: { cellSize, chunkCells, bounds, unloaded, windowCells, maxClear }.
 * See createNav for what each means; the nav object re-exports every method here.
 */
export function createModel(cfg) {
  const { cellSize: cs, chunkCells: N, bounds } = cfg;
  const chunks = new Map();       // 'cx,cy' -> { cx, cy, cost: Uint8Array(N * N) }
  const obstacles = new Map();    // id -> { id, shape, pad, group, bounds }
  let serial = 0;
  let field = null; let fieldVersion = -1;
  let focusX = bounds ? bounds.x + bounds.w / 2 : 0; let focusY = bounds ? bounds.y + bounds.h / 2 : 0;
  const key = (cx, cy) => `${cx},${cy}`;
  const inBounds = (col, row) => !bounds || (col >= bounds.c0 && row >= bounds.r0 && col < bounds.c1 && row < bounds.r1);

  const model = {
    version: 1,
    /**
     * setChunk(cx, cy, source) loads or replaces one chunk of ground. Chunk cx covers cell columns
     * cx * chunkCells up to (cx + 1) * chunkCells. source: nothing (all open), a Uint8Array of
     * chunkCells * chunkCells costs (row by row), or fn(col, row, x, y) -> cost (0 or true = blocked,
     * 1 or false = plain ground, up to 255 = slow ground) with absolute cell numbers and the cell's centre.
     */
    setChunk(cx, cy, source) {
      need(Number.isInteger(cx) && Number.isInteger(cy), `nav.setChunk: chunk coordinates must be whole numbers, got ${cx}, ${cy}`);
      const cost = new Uint8Array(N * N);
      if (source instanceof Uint8Array) {
        need(source.length === N * N, `nav.setChunk: a cost array must have ${N * N} cells, got ${source.length}`);
        cost.set(source);
      } else {
        need(source === undefined || source === null || typeof source === 'function', 'nav.setChunk: source must be a Uint8Array, a function or nothing');
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const col = cx * N + c; const row = cy * N + r;
            let v = 1;
            if (!inBounds(col, row)) v = 0;
            else if (source) { const got = source(col, row, (col + 0.5) * cs, (row + 0.5) * cs); v = got === true ? 0 : got === false ? 1 : Math.max(0, Math.min(255, got | 0)); }
            cost[r * N + c] = v;
          }
        }
      }
      chunks.set(key(cx, cy), { cx, cy, cost });
      model.version += 1;
      return model;
    },
    /** dropChunk(cx, cy) forgets a chunk (it went out of memory). Returns true when it was loaded. */
    dropChunk(cx, cy) { const had = chunks.delete(key(cx, cy)); if (had) model.version += 1; return had; },
    hasChunk: (cx, cy) => chunks.has(key(cx, cy)),
    chunkCount: () => chunks.size,
    /** setCell(col, row, cost) changes one cell of a loaded chunk (a tree felled, a wall built). */
    setCell(col, row, value) {
      const cx = Math.floor(col / N); const cy = Math.floor(row / N);
      const chunk = chunks.get(key(cx, cy));
      need(chunk, `nav.setCell: cell ${col}, ${row} is in chunk ${cx}, ${cy}, which is not loaded`);
      need(Number.isInteger(value) && value >= 0 && value <= 255, `nav.setCell: cost must be a whole number 0..255, got ${String(value)}`);
      const i = (row - cy * N) * N + (col - cx * N);
      if (chunk.cost[i] !== value) { chunk.cost[i] = value; model.version += 1; }
      return model;
    },
    /** fill(fn) sets every cell of every loaded chunk from fn(col, row, x, y) -> cost (as in setChunk). */
    fill(fn) {
      need(typeof fn === 'function', 'nav.fill: needs a function (col, row, x, y) -> cost');
      for (const ch of [...chunks.values()]) model.setChunk(ch.cx, ch.cy, fn);
      return model;
    },
    /**
     * addObstacle(shape, options) -> id. Lays a prop over the ground: rect { x, y, w, h } (top-left),
     * circle { x, y, r } (centre) or polygon { x, y, points } (dents allowed). options: id (your own
     * name for it), pad = 0 (grow it by this much), group (a label, to remove many at once).
     */
    addObstacle(shape, options = {}) {
      shapeKind(shape);
      const id = options.id ?? shape.id ?? `o${++serial}`;
      need(typeof id === 'string' || typeof id === 'number', `nav.addObstacle: id must be a string or number, got ${JSON.stringify(id)}`);
      need(!obstacles.has(id), `nav.addObstacle: there is already an obstacle with id ${JSON.stringify(id)}`);
      const pad = options.pad ?? 0;
      need(Number.isFinite(pad) && pad >= 0, `nav.addObstacle: pad must be 0 or more, got ${String(pad)}`);
      const copy = { ...shape, x: shape.x ?? 0, y: shape.y ?? 0 };
      obstacles.set(id, { id, shape: copy, pad, group: options.group ?? null, bounds: shapeBounds(copy) });
      model.version += 1;
      return id;
    },
    /** moveObstacle(id, x, y) moves a prop (a cart, a door leaf). Paths that now cross it are re-planned. */
    moveObstacle(id, x, y) {
      const o = obstacles.get(id);
      need(o, `nav.moveObstacle: no obstacle with id ${JSON.stringify(id)}`);
      need(Number.isFinite(x) && Number.isFinite(y), `nav.moveObstacle: x and y must be numbers, got ${x}, ${y}`);
      if (o.shape.x === x && o.shape.y === y) return model;
      o.shape.x = x; o.shape.y = y; o.bounds = shapeBounds(o.shape);
      model.version += 1;
      return model;
    },
    /** removeObstacle(id) -> true when it was there. removeGroup(group) -> how many were removed. */
    removeObstacle(id) { const had = obstacles.delete(id); if (had) model.version += 1; return had; },
    removeGroup(group) {
      let count = 0;
      for (const [id, o] of [...obstacles]) if (o.group === group) { obstacles.delete(id); count += 1; }
      if (count) model.version += 1;
      return count;
    },
    hasObstacle: (id) => obstacles.has(id),
    /** obstacles() -> [{ id, shape, pad, group }] in the order added. */
    obstacles: () => [...obstacles.values()].map((o) => ({ id: o.id, shape: o.shape, pad: o.pad, group: o.group })),
    /** focus(x, y) says where play is. In a world bigger than the window, the field follows this point. */
    focus(x, y) {
      need(Number.isFinite(x) && Number.isFinite(y), `nav.focus: x and y must be numbers, got ${x}, ${y}`);
      focusX = x; focusY = y;
      return model;
    },
    /** field() -> the field around the focus, rebuilt only when the ground, a prop or the focus changed enough. */
    field() {
      const w = cfg.windowCells;
      let col0; let row0; let cols; let rows;
      if (bounds && bounds.c1 - bounds.c0 <= w * 2 && bounds.r1 - bounds.r0 <= w * 2) {
        col0 = bounds.c0; row0 = bounds.r0; cols = bounds.c1 - bounds.c0; rows = bounds.r1 - bounds.r0;
      } else {
        const fc = Math.floor(focusX / cs); const fr = Math.floor(focusY / cs);
        cols = w; rows = w;
        // keep the old window while the focus stays in its middle half
        if (field && field.cols === w && Math.abs(fc - (field.col0 + w / 2)) <= w / 4 && Math.abs(fr - (field.row0 + w / 2)) <= w / 4) { col0 = field.col0; row0 = field.row0; } else { col0 = Math.round((fc - w / 2) / 8) * 8; row0 = Math.round((fr - w / 2) / 8) * 8; }
      }
      if (field && fieldVersion === model.version && field.col0 === col0 && field.row0 === row0) return field;
      const unloaded = cfg.unloaded === 'open' ? 1 : 0;
      field = buildField({
        col0, row0, cols, rows, cellSize: cs, maxClear: cfg.maxClear, obstacles: [...obstacles.values()], version: (field ? field.version : 0) + 1,
        fill(cost) {
          if (unloaded) cost.fill(1);
          const cx0 = Math.floor(col0 / N); const cx1 = Math.floor((col0 + cols - 1) / N);
          const cy0 = Math.floor(row0 / N); const cy1 = Math.floor((row0 + rows - 1) / N);
          for (let cy = cy0; cy <= cy1; cy++) {
            for (let cx = cx0; cx <= cx1; cx++) {
              const ch = chunks.get(key(cx, cy));
              if (!ch) continue;
              const ca = Math.max(col0, cx * N); const cb = Math.min(col0 + cols, (cx + 1) * N);
              const ra = Math.max(row0, cy * N); const rb = Math.min(row0 + rows, (cy + 1) * N);
              for (let row = ra; row < rb; row++) {
                const src = (row - cy * N) * N + (ca - cx * N);
                cost.set(ch.cost.subarray(src, src + (cb - ca)), (row - row0) * cols + (ca - col0));
              }
            }
          }
        },
      });
      fieldVersion = model.version;
      return field;
    },
  };
  if (bounds) { // a fixed level: every chunk under it starts loaded and open
    for (let cy = Math.floor(bounds.r0 / N); cy <= Math.floor((bounds.r1 - 1) / N); cy++) {
      for (let cx = Math.floor(bounds.c0 / N); cx <= Math.floor((bounds.c1 - 1) / N); cx++) model.setChunk(cx, cy);
    }
  }
  return model;
}
