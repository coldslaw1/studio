// Spatial index for moving things: a grid of buckets keyed by one number per cell. Each item
// sits in the bucket of its centre point, so insert, move and remove are O(1) and a query only
// looks at the buckets under the box. Works with negative coordinates.

const OFF = 1 << 25;
const SPAN = OFF * 2;

/**
 * createSpatialIndex(cellSize) -> index
 * @param {number} cellSize  bucket size in pixels; about the size of a typical query box side / 4
 * index:
 *   insert(item)   item needs numeric x and y. The index writes item._cell and item._slot.
 *   update(item)   call after the item moved. Returns true when it changed bucket.
 *   remove(item)   take it out (does nothing when it is not in the index)
 *   queryRect(x, y, w, h, out)    push items whose centre is inside the box [x, x+w) x [y, y+h) into out
 *   queryRadius(x, y, r, out)     push items whose centre is within r of (x, y) into out
 *   size()         number of items
 * Queries return `out` (pass your own array and set out.length = 0 to avoid garbage).
 * Items are matched by centre point: to catch wide items, grow the box by their half size.
 */
export function createSpatialIndex(cellSize) {
  if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new Error(`createSpatialIndex: cellSize must be > 0, got ${cellSize}`);
  const cells = new Map();
  const spare = [];
  let count = 0;

  const keyOf = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`spatial index: item position must be finite, got ${x}, ${y}`);
    return (Math.floor(x / cellSize) + OFF) * SPAN + (Math.floor(y / cellSize) + OFF);
  };

  function put(item, key) {
    let bucket = cells.get(key);
    if (!bucket) cells.set(key, (bucket = spare.pop() ?? []));
    item._cell = key;
    item._slot = bucket.push(item) - 1;
  }

  function take(item) {
    const bucket = cells.get(item._cell);
    const lastItem = bucket.pop();
    if (lastItem !== item) { bucket[item._slot] = lastItem; lastItem._slot = item._slot; }
    if (bucket.length === 0) { cells.delete(item._cell); if (spare.length < 256) spare.push(bucket); }
  }

  return {
    cellSize,
    insert(item) {
      if (item._cell !== undefined && item._cell !== -1) throw new Error('spatial index insert: item is already in an index');
      put(item, keyOf(item.x, item.y));
      count++;
    },
    update(item) {
      const key = keyOf(item.x, item.y);
      if (key === item._cell) return false;
      take(item);
      put(item, key);
      return true;
    },
    remove(item) {
      if (item._cell === undefined || item._cell === -1) return;
      take(item);
      item._cell = -1;
      count--;
    },
    queryRect(x, y, w, h, out = []) {
      const c0 = Math.floor(x / cellSize);
      const c1 = Math.floor((x + w) / cellSize);
      const r0 = Math.floor(y / cellSize);
      const r1 = Math.floor((y + h) / cellSize);
      const x1 = x + w;
      const y1 = y + h;
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > cells.size) { // huge box: walking the buckets is cheaper
        for (const bucket of cells.values()) for (const it of bucket) if (it.x >= x && it.x < x1 && it.y >= y && it.y < y1) out.push(it);
        return out;
      }
      for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) {
          const bucket = cells.get((c + OFF) * SPAN + (r + OFF));
          if (!bucket) continue;
          const inner = c > c0 && c < c1 && r > r0 && r < r1;
          for (let i = 0; i < bucket.length; i++) {
            const it = bucket[i];
            if (inner || (it.x >= x && it.x < x1 && it.y >= y && it.y < y1)) out.push(it);
          }
        }
      }
      return out;
    },
    queryRadius(x, y, r, out = []) {
      const c0 = Math.floor((x - r) / cellSize);
      const c1 = Math.floor((x + r) / cellSize);
      const r0 = Math.floor((y - r) / cellSize);
      const r1 = Math.floor((y + r) / cellSize);
      const rr = r * r;
      for (let c = c0; c <= c1; c++) {
        for (let q = r0; q <= r1; q++) {
          const bucket = cells.get((c + OFF) * SPAN + (q + OFF));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const it = bucket[i];
            if ((it.x - x) * (it.x - x) + (it.y - y) * (it.y - y) <= rr) out.push(it);
          }
        }
      }
      return out;
    },
    size: () => count,
    /** Buckets in use (for stats and tests). */
    buckets: () => cells.size,
  };
}
