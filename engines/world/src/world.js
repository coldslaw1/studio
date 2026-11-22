// The streamed world: keeps the chunks near the focus points loaded, makes missing ones with
// the game's generator a few per update, and drops far ones back into a pool. Tile edits are
// tracked against the generated baseline so saving stores only what changed.
import { createChunkPool, chunkKey } from './chunk.js';
import { createChunkSaves } from './save.js';

/**
 * createWorld(options) -> world
 * options:
 *   generate(chunk, world)  required. Fill chunk.layers (and chunk.features) for chunk.cx, chunk.cy.
 *                           Must depend only on the seed and absolute tile coordinates.
 *   chunkSize          tiles per chunk side. Default 32.
 *   tileSize           pixels per tile. Default 16.
 *   layers             { name: 'u8' | 'u16' | 'i16' | 'f32' }. Default { ground: 'u8', object: 'u8' }.
 *   loadRadius         chunks kept loaded around each focus. Default 2.
 *   keepRadius         chunks beyond this are unloaded. Default loadRadius + 1 (stops flicker at edges).
 *   maxLoadsPerUpdate  chunks made per update() call. Default 2.
 *   store              { get(key, fallback), set(key, value) } for saves, or null (edits live in memory).
 *   seed               recorded in the save; loading a save made with another seed throws.
 *   regionSize         chunks per save region side. Default 8.   savePrefix  key prefix. Default 'world:'.
 * world: see README. Main calls: update(dt, focus), getTile, setTile, on, save.
 */
export function createWorld(options = {}) {
  const { chunkSize = 32, tileSize = 16, layers = { ground: 'u8', object: 'u8' }, generate, loadRadius = 2, maxLoadsPerUpdate = 2, store = null, regionSize = 8, savePrefix = 'world:', seed = null } = options;
  const keepRadius = options.keepRadius ?? loadRadius + 1;
  if (typeof generate !== 'function') throw new Error('createWorld: options.generate must be a function (chunk, world) => void');
  if (!(tileSize > 0)) throw new Error(`createWorld: tileSize must be > 0, got ${tileSize}`);
  if (!Number.isInteger(loadRadius) || loadRadius < 0) throw new Error(`createWorld: loadRadius must be an integer >= 0, got ${loadRadius}`);
  if (!(keepRadius >= loadRadius)) throw new Error(`createWorld: keepRadius (${keepRadius}) must be >= loadRadius (${loadRadius})`);
  if (!Number.isInteger(maxLoadsPerUpdate) || maxLoadsPerUpdate < 1) throw new Error(`createWorld: maxLoadsPerUpdate must be an integer >= 1, got ${maxLoadsPerUpdate}`);

  const pool = createChunkPool(chunkSize, layers);
  const saves = createChunkSaves({ store, regionSize, prefix: savePrefix });
  const savedMeta = saves.meta();
  if (savedMeta && savedMeta.seed !== undefined && savedMeta.seed !== seed) throw new Error(`createWorld: this save was made with seed ${JSON.stringify(savedMeta.seed)}, not ${JSON.stringify(seed)}`);
  const chunks = new Map();
  const listeners = { load: [], unload: [], collect: [], edit: [], meta: [] };
  const counters = { generated: 0, restored: 0, unloaded: 0 };
  const chunkPx = chunkSize * tileSize;
  const foci = [];
  let queue = [];
  let focusSig = null;
  let time = savedMeta?.time ?? 0;
  let last = null;

  const emit = (name, a, b, c, d) => { for (const fn of listeners[name]) fn(a, b, c, d); };
  const near = (cx, cy, radius) => {
    const lim = (radius + 0.5) * (radius + 0.5);
    for (const f of foci) if ((cx - f.cx) * (cx - f.cx) + (cy - f.cy) * (cy - f.cy) <= lim) return true;
    return false;
  };

  function setFocus(focus) {
    const list = Array.isArray(focus) ? focus : [focus];
    if (!list.length) throw new Error('world.update: need at least one focus { x, y }');
    let sig = '';
    foci.length = 0;
    for (const f of list) {
      if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.y)) throw new Error(`world.update: focus needs finite x and y, got ${JSON.stringify(f)}`);
      const c = { cx: Math.floor(f.x / chunkPx), cy: Math.floor(f.y / chunkPx) };
      foci.push(c);
      sig += c.cx + ',' + c.cy + ';';
    }
    if (sig === focusSig) return;
    focusSig = sig;
    const seen = new Set();
    const lim = (loadRadius + 0.5) * (loadRadius + 0.5);
    queue = [];
    for (const f of foci) {
      for (let dy = -loadRadius; dy <= loadRadius; dy++) {
        for (let dx = -loadRadius; dx <= loadRadius; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > lim) continue;
          const key = chunkKey(f.cx + dx, f.cy + dy);
          if (chunks.has(key) || seen.has(key)) continue;
          seen.add(key);
          queue.push({ cx: f.cx + dx, cy: f.cy + dy, key, d2 });
        }
      }
    }
    queue.sort((a, b) => b.d2 - a.d2); // nearest last, so pop() takes it
    const gone = [];
    for (const chunk of chunks.values()) if (!near(chunk.cx, chunk.cy, keepRadius)) gone.push(chunk);
    for (const chunk of gone) unloadChunk(chunk);
  }

  function loadChunk(cx, cy) {
    const chunk = pool.take(cx, cy);
    generate(chunk, world);
    const delta = saves.get(cx, cy);
    if (delta) {
      chunk.saved = true;
      chunk.savedEntities = !!(delta.e && delta.e.length);
      chunk.spawned = !!delta.s;
      for (const name in delta.l ?? {}) {
        const arr = chunk.layers[name];
        if (!arr) continue; // layer removed from the game since the save
        const pairs = delta.l[name];
        const e = ((chunk.edits ??= {})[name] = new Map());
        const b = ((chunk.base ??= {})[name] = new Map());
        for (let i = 0; i < pairs.length; i += 2) { b.set(pairs[i], arr[pairs[i]]); arr[pairs[i]] = pairs[i + 1]; e.set(pairs[i], pairs[i + 1]); }
      }
      counters.restored++;
    }
    counters.generated++;
    chunks.set(chunk.key, chunk);
    emit('load', chunk, { saved: !!delta, spawned: chunk.spawned, records: delta?.e ?? null });
    return chunk;
  }

  /** Store (or clear) the chunk's delta. Skips the write when nothing changed since it was read. */
  function writeDelta(chunk, records) {
    let l = null;
    for (const name in chunk.edits ?? {}) {
      const m = chunk.edits[name];
      if (!m.size) continue;
      const pairs = [];
      for (const [i, v] of m) pairs.push(i, v);
      (l ??= {})[name] = pairs;
    }
    const has = l !== null || records.length > 0 || chunk.spawned;
    if (!has) { if (chunk.saved) saves.put(chunk.cx, chunk.cy, null); } else if (chunk.dirty || records.length || chunk.savedEntities || !chunk.saved) {
      const delta = {};
      if (l) delta.l = l;
      if (records.length) delta.e = records;
      if (chunk.spawned) delta.s = 1; // its one-time spawns were made: never make them again
      saves.put(chunk.cx, chunk.cy, delta);
    }
    chunk.dirty = false;
    chunk.saved = has;
    chunk.savedEntities = records.length > 0;
  }

  function unloadChunk(chunk) {
    const out = { records: [] };
    emit('unload', chunk, out);
    writeDelta(chunk, out.records);
    chunks.delete(chunk.key);
    if (last === chunk) last = null;
    counters.unloaded++;
    pool.give(chunk);
  }

  function chunkAtTile(tx, ty) {
    const cx = Math.floor(tx / chunkSize);
    const cy = Math.floor(ty / chunkSize);
    if (last && last.cx === cx && last.cy === cy) return last;
    const chunk = chunks.get(chunkKey(cx, cy));
    if (chunk) last = chunk;
    return chunk ?? null;
  }

  const world = {
    chunkSize, tileSize, chunkPx, loadRadius, keepRadius, seed, savedMeta,
    /** Seconds of world time (sum of dt given to update). Saved and restored. */
    get time() { return time; },
    /** Advance time, follow the focus point(s) { x, y } in pixels, load a few chunks. Returns chunks loaded. */
    update(dt, focus) {
      if (!(dt >= 0)) throw new Error(`world.update: dt must be seconds >= 0, got ${dt}`);
      time += dt;
      setFocus(focus);
      let n = 0;
      while (queue.length && n < maxLoadsPerUpdate) { const q = queue.pop(); if (!chunks.has(q.key)) { loadChunk(q.cx, q.cy); n++; } }
      return n;
    },
    /** Load everything around the focus right now (game start, teleport, loading screen). */
    loadAll(focus) {
      setFocus(focus);
      let n = 0;
      while (queue.length) { const q = queue.pop(); if (!chunks.has(q.key)) { loadChunk(q.cx, q.cy); n++; } }
      return n;
    },
    /** The loaded chunk at chunk coordinates, or null. */
    getChunk(cx, cy) { return chunks.get(chunkKey(cx, cy)) ?? null; },
    /** The loaded chunk holding tile (tx, ty), or null. */
    chunkAtTile,
    /** True when the chunk holding pixel position (x, y) is loaded. */
    isLoadedAt(x, y) { return chunkAtTile(Math.floor(x / tileSize), Math.floor(y / tileSize)) !== null; },
    /** Tile value in a layer, or `fallback` when that chunk is not loaded. */
    getTile(layer, tx, ty, fallback = 0) {
      const chunk = chunkAtTile(tx, ty);
      if (!chunk) return fallback;
      const arr = chunk.layers[layer];
      if (!arr) throw new Error(`world.getTile: unknown layer "${layer}"`);
      return arr[(ty - chunk.y0) * chunkSize + (tx - chunk.x0)];
    },
    /** Change a tile. Returns true when the value changed. Throws when that chunk is not loaded. */
    setTile(layer, tx, ty, value) {
      const chunk = chunkAtTile(tx, ty);
      if (!chunk) throw new Error(`world.setTile: tile ${tx}, ${ty} is in a chunk that is not loaded`);
      const arr = chunk.layers[layer];
      if (!arr) throw new Error(`world.setTile: unknown layer "${layer}"`);
      const i = (ty - chunk.y0) * chunkSize + (tx - chunk.x0);
      const old = arr[i];
      arr[i] = value;
      if (arr[i] === old) return false;
      const e = ((chunk.edits ??= {})[layer] ??= new Map());
      const b = ((chunk.base ??= {})[layer] ??= new Map());
      if (!b.has(i)) b.set(i, old);
      if (arr[i] === b.get(i)) e.delete(i); else e.set(i, arr[i]); // back to the generated value = no edit
      chunk.dirty = true;
      chunk.version++;
      emit('edit', chunk, layer, tx, ty);
      return true;
    },
    /** Call fn(chunk) for every loaded chunk. */
    forEachChunk(fn) { for (const chunk of chunks.values()) fn(chunk); },
    /** Listen: 'load' (chunk, { saved, spawned, records }), 'unload' (chunk, out), 'edit' (chunk, layer, tx, ty). Returns an unsubscribe function. */
    on(name, fn) {
      if (!listeners[name]) throw new Error(`world.on: unknown event "${name}" (use load, unload, edit, collect or meta)`);
      listeners[name].push(fn);
      return () => { const i = listeners[name].indexOf(fn); if (i >= 0) listeners[name].splice(i, 1); };
    },
    /** Add a saved record to a chunk that is NOT loaded (used by the entity module). */
    deposit(cx, cy, record) {
      if (chunks.has(chunkKey(cx, cy))) throw new Error(`world.deposit: chunk ${cx}, ${cy} is loaded; add the entity instead`);
      const delta = saves.get(cx, cy) ?? {};
      (delta.e ??= []).push(record);
      saves.put(cx, cy, delta);
    },
    /** Write everything that changed to the store. Returns { written, failed, ok }. */
    save() {
      for (const chunk of chunks.values()) {
        const out = { records: [] };
        emit('collect', chunk, out);
        writeDelta(chunk, out.records);
      }
      const meta = { time, seed };
      emit('meta', meta);
      const loaded = new Set();
      for (const chunk of chunks.values()) loaded.add(saves.regionId(chunk.cx, chunk.cy));
      const res = saves.flush((id) => loaded.has(id));
      const metaOk = saves.meta(meta);
      return { ...res, ok: res.failed === 0 && metaOk };
    },
    /** Numbers for a debug HUD and the benchmarks. */
    stats() {
      return { loaded: chunks.size, pooled: pool.size(), queued: queue.length, regionsHeld: saves.held(), ...counters };
    },
  };
  return world;
}
