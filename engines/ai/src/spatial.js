// A uniform spatial hash, rebuilt each step, so "who is near me?" costs the same with fifty agents or
// five thousand. Results come back sorted by id so every loop over neighbours is deterministic.

/**
 * createSpatialHash(cellSize) -> hash
 *   clear(), insert(item) (any object with id, x, y), query(x, y, radius, out = [], sorted = true) -> items
 *   within radius, sorted by id (unsorted is faster and still in a fixed order: cell by cell, each cell in
 *   the order its items were inserted), count
 */
export function createSpatialHash(cellSize) {
  if (!(cellSize > 0)) throw new Error(`createSpatialHash: cellSize must be above 0, got ${String(cellSize)}`);
  const cells = new Map();
  const key = (c, r) => (c + 32768) * 65536 + (r + 32768);
  const hash = {
    count: 0,
    clear() { cells.clear(); hash.count = 0; },
    insert(item) {
      const k = key(Math.floor(item.x / cellSize), Math.floor(item.y / cellSize));
      const list = cells.get(k);
      if (list) list.push(item); else cells.set(k, [item]);
      hash.count++;
    },
    query(x, y, radius, out = [], sorted = true) {
      out.length = 0;
      const c0 = Math.floor((x - radius) / cellSize); const c1 = Math.floor((x + radius) / cellSize);
      const r0 = Math.floor((y - radius) / cellSize); const r1 = Math.floor((y + radius) / cellSize);
      const r2 = radius * radius;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const list = cells.get(key(c, r));
          if (!list) continue;
          for (const item of list) {
            const dx = item.x - x; const dy = item.y - y;
            if (dx * dx + dy * dy <= r2) out.push(item);
          }
        }
      }
      if (sorted && out.length > 1) out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return out;
    },
  };
  return hash;
}
