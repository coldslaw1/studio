// Renderer-agnostic viewing: the engine never draws. A view turns world positions into screen
// positions (top-down or isometric), says which tiles are on screen, and visitTiles walks them
// in back-to-front order so any renderer (canvas sprites, vector art, character grids) can draw.

/**
 * createView(options) -> view
 * options:
 *   mode     'ortho' (top-down, default) or 'iso' (diamond isometric)
 *   tileSize world pixels per tile (same as the world's). Required.
 *   width, height   screen size in pixels. Required.
 *   tileW, tileH    iso only: size of one tile diamond on screen. Default tileSize * 2, tileSize.
 *   zoom     ortho only: screen pixels per world pixel. Default 1.
 * view:
 *   lookAt(x, y)            centre the screen on a world position (pixels)
 *   toScreen(x, y, out)     world pixels -> screen pixels, written into out { x, y } and returned
 *   toWorld(sx, sy, out)    screen pixels -> world pixels
 *   tileBounds(pad)         { tx0, ty0, tx1, ty1 } tile box that covers the screen (pad extra tiles)
 *   depth(x, y)             sort key: draw things with a smaller depth first
 */
export function createView(options = {}) {
  const { mode = 'ortho', tileSize, width, height, zoom = 1 } = options;
  if (mode !== 'ortho' && mode !== 'iso') throw new Error(`createView: mode must be 'ortho' or 'iso', got ${JSON.stringify(mode)}`);
  if (!(tileSize > 0)) throw new Error(`createView: tileSize must be > 0, got ${tileSize}`);
  if (!(width > 0) || !(height > 0)) throw new Error(`createView: width and height must be > 0, got ${width} x ${height}`);
  const tileW = options.tileW ?? tileSize * 2;
  const tileH = options.tileH ?? tileSize;
  const hw = tileW / 2 / tileSize; // screen x per world pixel along the tile x axis
  const hh = tileH / 2 / tileSize;
  const cam = { x: 0, y: 0 };
  const iso = mode === 'iso';
  const p = { x: 0, y: 0 };

  const view = {
    mode, width, height, tileSize, tileW, tileH, camera: cam,
    lookAt(x, y) { cam.x = x; cam.y = y; },
    toScreen(x, y, out = {}) {
      const dx = x - cam.x; const dy = y - cam.y;
      if (iso) { out.x = width / 2 + (dx - dy) * hw; out.y = height / 2 + (dx + dy) * hh; } else { out.x = width / 2 + dx * zoom; out.y = height / 2 + dy * zoom; }
      return out;
    },
    toWorld(sx, sy, out = {}) {
      const u = sx - width / 2; const v = sy - height / 2;
      if (iso) { const a = u / hw; const b = v / hh; out.x = cam.x + (a + b) / 2; out.y = cam.y + (b - a) / 2; } else { out.x = cam.x + u / zoom; out.y = cam.y + v / zoom; }
      return out;
    },
    tileBounds(pad = 1) {
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const [sx, sy] of [[0, 0], [width, 0], [0, height], [width, height]]) {
        view.toWorld(sx, sy, p);
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      }
      return { tx0: Math.floor(x0 / tileSize) - pad, ty0: Math.floor(y0 / tileSize) - pad, tx1: Math.floor(x1 / tileSize) + pad, ty1: Math.floor(y1 / tileSize) + pad };
    },
    depth: (x, y) => (iso ? x + y : y),
  };
  return view;
}

/**
 * visitTiles(world, layer, bounds, fn) - call fn(value, tx, ty) for every LOADED tile in the box
 * { tx0, ty0, tx1, ty1 } (both ends included), row by row, left to right. That order is
 * back-to-front for both top-down and isometric drawing. Returns the number of tiles visited.
 */
export function visitTiles(world, layer, bounds, fn) {
  const { tx0, ty0, tx1, ty1 } = bounds;
  const n = world.chunkSize;
  let count = 0;
  for (let ty = ty0; ty <= ty1; ty++) {
    let tx = tx0;
    while (tx <= tx1) {
      const chunk = world.chunkAtTile(tx, ty);
      const end = Math.min(tx1, (Math.floor(tx / n) + 1) * n - 1);
      if (chunk) {
        const arr = chunk.layers[layer];
        if (!arr) throw new Error(`visitTiles: unknown layer "${layer}"`);
        let i = (ty - chunk.y0) * n + (tx - chunk.x0);
        for (let x = tx; x <= end; x++) fn(arr[i++], x, ty);
        count += end - tx + 1;
      }
      tx = end + 1;
    }
  }
  return count;
}

/**
 * visitChunks(world, bounds, fn) - call fn(chunk) for every loaded chunk touching the tile box,
 * back to front (rows first). Use it when you draw one cached picture per chunk.
 */
export function visitChunks(world, bounds, fn) {
  const n = world.chunkSize;
  const c0 = Math.floor(bounds.tx0 / n); const c1 = Math.floor(bounds.tx1 / n);
  const r0 = Math.floor(bounds.ty0 / n); const r1 = Math.floor(bounds.ty1 / n);
  let count = 0;
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const chunk = world.getChunk(cx, cy);
      if (chunk) { fn(chunk); count++; }
    }
  }
  return count;
}
