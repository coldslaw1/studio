// Tile map collision: grid of square tiles, some solid, some one-way platforms.
import { isCircle, boundsOf, circleVsRect, clamp } from './collide.js';

const EPS = 1e-6;

function toTest(spec, name) {
  if (typeof spec === 'function') return spec;
  if (typeof spec === 'string') return (t) => typeof t === 'string' && t !== '' && spec.includes(t);
  if (Array.isArray(spec)) return (t) => spec.includes(t);
  throw new Error(`createTileMap: ${name} must be a string, array or function, got ${spec}`);
}

/**
 * Create a tile map.
 * @param {object} options
 * @param {number} options.tileSize  size of one square tile in pixels
 * @param {Array}  options.grid      rows of tiles: array of strings, or array of arrays
 * @param {string|Array|function} [options.solid='#']   which tiles block movement
 * @param {string|Array|function} [options.oneWay='-']  platforms you can jump up through
 * @param {boolean} [options.outsideSolid=false]  treat everything outside the map as solid
 * @returns {object} map with cols, rows, width, height, tileSize, grid and helper methods
 */
export function createTileMap(options) {
  const { tileSize, grid, solid = '#', oneWay = '-', outsideSolid = false } = options || {};
  if (!(tileSize > 0)) throw new Error(`createTileMap: tileSize must be > 0, got ${tileSize}`);
  if (!Array.isArray(grid) || grid.length === 0) {
    throw new Error('createTileMap: grid must be a non-empty array of rows');
  }
  const rowsData = grid.map((row) => (typeof row === 'string' ? row.split('') : row.slice()));
  const cols = rowsData[0].length;
  rowsData.forEach((row, i) => {
    if (row.length !== cols) {
      throw new Error(`createTileMap: row ${i} has ${row.length} tiles, expected ${cols}`);
    }
  });
  const solidTest = toTest(solid, 'solid');
  const oneWayTest = toTest(oneWay, 'oneWay');
  const rows = rowsData.length;
  const inside = (col, row) => col >= 0 && row >= 0 && col < cols && row < rows;

  const map = {
    tileSize,
    cols,
    rows,
    width: cols * tileSize,
    height: rows * tileSize,
    grid: rowsData,
    /** Tile value at (col, row), or undefined outside the map. */
    get(col, row) {
      return inside(col, row) ? rowsData[row][col] : undefined;
    },
    /** Change one tile. */
    set(col, row, value) {
      if (!inside(col, row)) throw new Error(`map.set: (${col}, ${row}) is outside the map`);
      rowsData[row][col] = value;
    },
    /** True when the tile at (col, row) blocks movement from every side. */
    isSolid(col, row) {
      return inside(col, row) ? solidTest(rowsData[row][col]) : outsideSolid;
    },
    /** True when the tile at (col, row) is a one-way platform. */
    isOneWay(col, row) {
      return inside(col, row) && oneWayTest(rowsData[row][col]);
    },
    /** True when pixel point (x, y) is inside a solid tile. */
    isSolidAt(x, y) {
      return map.isSolid(Math.floor(x / tileSize), Math.floor(y / tileSize));
    },
    /** Pixel point to tile coordinates { col, row }. */
    toTile(x, y) {
      return { col: Math.floor(x / tileSize), row: Math.floor(y / tileSize) };
    },
    /** Rect { x, y, w, h } of one tile in pixels. */
    tileRect(col, row) {
      return { x: col * tileSize, y: row * tileSize, w: tileSize, h: tileSize };
    },
    /** All tiles equal to `value`, as [{ col, row, x, y }] (x,y = tile top-left). */
    find(value) {
      const out = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (rowsData[row][col] === value) out.push({ col, row, x: col * tileSize, y: row * tileSize });
        }
      }
      return out;
    },
  };
  return map;
}

/**
 * Move a rect through the tile map and stop at solid tiles. Changes rect.x and rect.y.
 * @param {object} map   from createTileMap
 * @param {object} rect  { x, y, w, h }, must not start inside a solid tile
 * @param {number} dx    pixels to move on x this step (velocity * dt)
 * @param {number} dy    pixels to move on y this step
 * @param {object} [options]
 * @param {boolean} [options.dropThrough=false]  ignore one-way platforms this step
 * @returns {{hitLeft:boolean, hitRight:boolean, hitUp:boolean, hitDown:boolean}}
 */
export function moveRect(map, rect, dx, dy, options = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error(`moveRect: dx and dy must be finite numbers, got ${dx}, ${dy}`);
  }
  const ts = map.tileSize;
  const res = { hitLeft: false, hitRight: false, hitUp: false, hitDown: false };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (ts / 2)));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0 && !res.hitLeft && !res.hitRight) {
      rect.x += sx;
      const r0 = Math.floor((rect.y + EPS) / ts);
      const r1 = Math.floor((rect.y + rect.h - EPS) / ts);
      const col = sx > 0 ? Math.floor((rect.x + rect.w - EPS) / ts) : Math.floor((rect.x + EPS) / ts);
      for (let row = r0; row <= r1; row++) {
        if (!map.isSolid(col, row)) continue;
        if (sx > 0) {
          rect.x = col * ts - rect.w;
          res.hitRight = true;
        } else {
          rect.x = (col + 1) * ts;
          res.hitLeft = true;
        }
        break;
      }
    }
    if (sy !== 0 && !res.hitUp && !res.hitDown) {
      const oldBottom = rect.y + rect.h;
      rect.y += sy;
      const c0 = Math.floor((rect.x + EPS) / ts);
      const c1 = Math.floor((rect.x + rect.w - EPS) / ts);
      const row = sy > 0 ? Math.floor((rect.y + rect.h - EPS) / ts) : Math.floor((rect.y + EPS) / ts);
      for (let col = c0; col <= c1; col++) {
        let blocked = map.isSolid(col, row);
        if (!blocked && sy > 0 && !options.dropThrough && map.isOneWay(col, row)) {
          blocked = oldBottom <= row * ts + EPS;
        }
        if (!blocked) continue;
        if (sy > 0) {
          rect.y = row * ts - rect.h;
          res.hitDown = true;
        } else {
          rect.y = (row + 1) * ts;
          res.hitUp = true;
        }
        break;
      }
    }
  }
  return res;
}

/**
 * Push a shape (rect or circle) out of any solid tiles it overlaps. Changes shape.x / shape.y.
 * One-way platforms are ignored. Use moveRect for platformer characters.
 * @returns {Array<{nx:number, ny:number, depth:number, col:number, row:number}>} one hit per push
 */
export function pushOutOfTiles(map, shape) {
  const ts = map.tileSize;
  const hits = [];
  for (let pass = 0; pass < 4; pass++) {
    const b = boundsOf(shape);
    const c0 = Math.floor(b.x / ts);
    const c1 = Math.floor((b.x + b.w - EPS) / ts);
    const r0 = Math.floor(b.y / ts);
    const r1 = Math.floor((b.y + b.h - EPS) / ts);
    let best = null;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (!map.isSolid(col, row)) continue;
        const hit = isCircle(shape)
          ? circleVsRect(shape, map.tileRect(col, row))
          : rectVsTile(map, b, col, row);
        if (hit && hit.depth > EPS && (!best || hit.score > best.score)) {
          best = hit;
          best.col = col;
          best.row = row;
        }
      }
    }
    if (!best) break;
    shape.x += best.nx * best.depth;
    shape.y += best.ny * best.depth;
    hits.push({ nx: best.nx, ny: best.ny, depth: best.depth, col: best.col, row: best.row });
  }
  return hits;
}

// Rect vs one tile. Never pushes toward a neighbouring solid tile, so a box
// sliding along a floor does not catch on the seams between tiles.
function rectVsTile(map, b, col, row) {
  const ts = map.tileSize;
  const tx = col * ts;
  const ty = row * ts;
  const ox = Math.min(b.x + b.w, tx + ts) - Math.max(b.x, tx);
  const oy = Math.min(b.y + b.h, ty + ts) - Math.max(b.y, ty);
  if (ox <= 0 || oy <= 0) return null;
  const nx = b.x + b.w / 2 < tx + ts / 2 ? -1 : 1;
  const ny = b.y + b.h / 2 < ty + ts / 2 ? -1 : 1;
  const xOpen = !map.isSolid(col + nx, row);
  const yOpen = !map.isSolid(col, row + ny);
  const px = nx < 0 ? b.x + b.w - tx : tx + ts - b.x;
  const py = ny < 0 ? b.y + b.h - ty : ty + ts - b.y;
  const useX = xOpen && (!yOpen || px < py);
  if (!useX && !yOpen) return null;
  const hit = useX ? { nx, ny: 0, depth: px } : { nx: 0, ny, depth: py };
  hit.score = ox * oy; // biggest overlap is resolved first
  return hit;
}

/**
 * Cast a line from (x0, y0) to (x1, y1) and find the first solid tile it hits.
 * Good for line of sight, lasers and bullets. One-way platforms are ignored.
 * @returns {null|{t:number, x:number, y:number, col:number, row:number, nx:number, ny:number}}
 */
export function raycastTiles(map, x0, y0, x1, y1) {
  const ts = map.tileSize;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let col = Math.floor(x0 / ts);
  let row = Math.floor(y0 / ts);
  if (map.isSolid(col, row)) return { t: 0, x: x0, y: y0, col, row, nx: 0, ny: 0 };
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(ts / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(ts / dy);
  let tMaxX = dx === 0 ? Infinity : ((dx > 0 ? (col + 1) * ts : col * ts) - x0) / dx;
  let tMaxY = dy === 0 ? Infinity : ((dy > 0 ? (row + 1) * ts : row * ts) - y0) / dy;
  for (;;) {
    let t;
    let nx = 0;
    let ny = 0;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      col += stepX;
      nx = -stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      row += stepY;
      ny = -stepY;
    }
    if (t > 1) return null;
    if (map.isSolid(col, row)) {
      return { t: clamp(t, 0, 1), x: x0 + dx * t, y: y0 + dy * t, col, row, nx, ny };
    }
  }
}
