// Saving: only what CHANGED is stored. A chunk's save record ("delta") lists the tiles that
// differ from what the generator makes, plus the persistent entities resting there. Deltas are
// grouped into regions (regionSize x regionSize chunks) so one store write covers many chunks.

/** createMemoryStore() -> store with get(key, fallback) / set(key, value) / keys(). For tests and no-save games. */
export function createMemoryStore() {
  const map = new Map();
  return {
    get: (k, fallback = null) => (map.has(k) ? JSON.parse(map.get(k)) : fallback),
    set: (k, v) => { if (v === undefined) map.delete(k); else map.set(k, JSON.stringify(v)); return true; },
    keys: () => [...map.keys()],
    bytes: () => { let n = 0; for (const v of map.values()) n += v.length; return n; },
  };
}

/**
 * createKeyStore(storage, prefix) -> store that keeps every key as its own storage entry.
 * Use this for big worlds: a write costs only the region written. (core's slotStore rewrites
 * the whole slot on every set, which is fine for small worlds only.)
 * @param {{getItem:function, setItem:function, removeItem:function}} storage  e.g. localStorage
 * @param {string} prefix  e.g. 'my-game:slot1:'
 */
export function createKeyStore(storage, prefix) {
  if (!storage || typeof storage.getItem !== 'function') throw new Error('createKeyStore: storage needs getItem / setItem / removeItem');
  if (typeof prefix !== 'string' || !prefix) throw new Error(`createKeyStore: prefix must be a non-empty string, got ${JSON.stringify(prefix)}`);
  return {
    get(k, fallback = null) {
      try {
        const raw = storage.getItem(prefix + k);
        return raw === null || raw === undefined ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(k, v) {
      try {
        if (v === undefined) storage.removeItem(prefix + k); else storage.setItem(prefix + k, JSON.stringify(v));
        return true;
      } catch { return false; } // storage full or blocked
    },
  };
}

/**
 * createChunkSaves({ store, regionSize, prefix }) -> saves (used by createWorld; games rarely call it).
 *   get(cx, cy)         the chunk's delta or undefined
 *   put(cx, cy, delta)  set it (null removes it); nothing is written until flush
 *   flush(keep)         write changed regions; keep(regionId) says which to hold in memory.
 *                       Returns { written, failed } (region counts).
 *   meta(value?)        read or write the small world record (time, next entity id)
 */
export function createChunkSaves({ store = null, regionSize = 8, prefix = 'world:' } = {}) {
  if (!Number.isInteger(regionSize) || regionSize < 1) throw new Error(`createChunkSaves: regionSize must be an integer >= 1, got ${regionSize}`);
  if (store && (typeof store.get !== 'function' || typeof store.set !== 'function')) throw new Error('createChunkSaves: store needs get(key) and set(key, value)');
  const regions = new Map(); // id -> { data: { "cx,cy": delta }, dirty }
  const index = new Set(store ? store.get(prefix + 'index', []) ?? [] : []);
  let indexDirty = false;
  const regionId = (cx, cy) => Math.floor(cx / regionSize) + ',' + Math.floor(cy / regionSize);

  function region(id, create) {
    let r = regions.get(id);
    if (r) return r;
    if (store && index.has(id)) r = { data: store.get(prefix + 'r:' + id, null) ?? {}, dirty: false };
    else if (create) r = { data: {}, dirty: false };
    else return null;
    regions.set(id, r);
    return r;
  }

  return {
    regionId,
    get(cx, cy) {
      const r = region(regionId(cx, cy), false);
      return r ? r.data[cx + ',' + cy] : undefined;
    },
    put(cx, cy, delta) {
      const id = regionId(cx, cy);
      const r = region(id, delta !== null);
      if (!r) return;
      const k = cx + ',' + cy;
      if (delta === null) { if (!(k in r.data)) return; delete r.data[k]; } else r.data[k] = delta;
      r.dirty = true;
    },
    flush(keep = null) {
      const out = { written: 0, failed: 0 };
      for (const [id, r] of regions) {
        if (r.dirty && store) {
          const empty = Object.keys(r.data).length === 0;
          if (store.set(prefix + 'r:' + id, empty ? undefined : r.data) === false) { out.failed++; continue; }
          r.dirty = false;
          out.written++;
          if (empty ? index.delete(id) : !index.has(id) && index.add(id)) indexDirty = true;
        }
        if (store && !r.dirty && !(keep && keep(id))) regions.delete(id);
      }
      if (store && indexDirty && store.set(prefix + 'index', [...index]) !== false) indexDirty = false;
      return out;
    },
    meta(value) {
      if (value === undefined) return store ? store.get(prefix + 'meta', null) : null;
      return store ? store.set(prefix + 'meta', value) !== false : true;
    },
    /** Regions held in memory right now (for stats and tests). */
    held: () => regions.size,
  };
}
