// Broad phase: a grid of square cells (spatial hash) that answers "what is near this box?"
// quickly. Works with negative coordinates and with items of any size.

const BIG = 1024; // items covering more cells than this are kept in one plain list instead

/**
 * Create a spatial hash.
 * @param {number} cellSize  size of one cell; about the size of a typical item or a bit larger
 * @returns {{insert:function, remove:function, query:function, size:function}}
 *   insert(item, bounds)  add or move an item; item needs a numeric `id`, bounds is { x, y, w, h }
 *   remove(item)          take it out (does nothing when it is not in the hash)
 *   query(x, y, w, h)     items whose bounds may overlap the box, each once, sorted by id
 *   size()                number of items
 */
export function createSpatialHash(cellSize) {
  if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new Error(`createSpatialHash: cellSize must be > 0, got ${cellSize}`);
  const cells = new Map(); // "col,row" -> Set of items
  const where = new Map(); // item -> array of keys, or null for big items
  const big = new Set();

  function remove(item) {
    if (!where.has(item)) return;
    const keys = where.get(item);
    where.delete(item);
    if (keys === null) {
      big.delete(item);
      return;
    }
    for (const key of keys) {
      const set = cells.get(key);
      set.delete(item);
      if (set.size === 0) cells.delete(key);
    }
  }

  function insert(item, b) {
    if (typeof item.id !== 'number') throw new Error('spatial hash insert: item needs a numeric id');
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) {
      remove(item);
      where.set(item, null); // endless or unknown size: always a candidate
      big.add(item);
      return;
    }
    const c0 = Math.floor(b.x / cellSize);
    const c1 = Math.floor((b.x + b.w) / cellSize);
    const r0 = Math.floor(b.y / cellSize);
    const r1 = Math.floor((b.y + b.h) / cellSize);
    remove(item);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > BIG) {
      where.set(item, null);
      big.add(item);
      return;
    }
    const keys = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = c + ',' + r;
        let set = cells.get(key);
        if (!set) cells.set(key, (set = new Set()));
        set.add(item);
        keys.push(key);
      }
    }
    where.set(item, keys);
  }

  function query(x, y, w, h) {
    const found = new Set(big);
    const c0 = Math.floor(x / cellSize);
    const c1 = Math.floor((x + w) / cellSize);
    const r0 = Math.floor(y / cellSize);
    const r1 = Math.floor((y + h) / cellSize);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > where.size + BIG) {
      for (const item of where.keys()) found.add(item); // huge box: cheaper to return everything
    } else {
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const set = cells.get(c + ',' + r);
          if (set) for (const item of set) found.add(item);
        }
      }
    }
    return [...found].sort((p, q) => p.id - q.id);
  }

  return { insert, remove, query, size: () => where.size };
}
