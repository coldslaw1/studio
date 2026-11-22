// Entities in a streamed world, simulated in tiers so far-away ones cost almost nothing:
//   tier 0 "active"  within activeRadius of a focus: updated every step
//   tier 1 "near"    within nearRadius: updated every nearEvery steps, with the summed dt
//   tier 2 "far"     anywhere else in loaded chunks: updated every farEvery steps
//   dormant          in an unloaded chunk: not in memory at all. Entities with persist: true
//                    are written into that chunk's save record and come back when it loads.
import { createSpatialIndex } from './spatial.js';

/** Tier numbers passed to update(entity, dt, tier). */
export const TIER = { active: 0, near: 1, far: 2, dormant: -1 };

function defaultToRecord(e) {
  const rec = {};
  for (const k in e) if (k[0] !== '_' && typeof e[k] !== 'function') rec[k] = e[k];
  return rec;
}

/**
 * createEntities(options) -> entities
 * options:
 *   world          required, from createWorld
 *   update(e, dt, tier)  required. Advance one entity by dt seconds. dt is larger for tiers 1 and 2.
 *   activeRadius   pixels. Default 480.    nearRadius  pixels. Default 960.
 *   nearEvery      steps between tier 1 updates. Default 4.   farEvery  for tier 2. Default 30.
 *   cellSize       spatial index bucket size in pixels. Default 64.
 *   spawn(chunk, info, add)  called when a chunk loads; add({ x, y, ... }) puts entities in it.
 *                  info.spawned is true when this chunk's persist entities were already made once (it is
 *                  remembered in the save): spawn persist entities only when it is false.
 *   catchUp(e, seconds)  called for a persist entity coming back, with the time it was away.
 *   toRecord(e) / fromRecord(record)  custom save form. Default: a copy of the plain fields.
 * entities: add, remove, update(dt, focus), queryRect, queryRadius, tierOf, count, stats, on.
 */
export function createEntities(options = {}) {
  const { world, update, cellSize = 64, activeRadius = 480, nearRadius = 960, nearEvery = 4, farEvery = 30, spawn = null, catchUp = null, toRecord = defaultToRecord, fromRecord = (r) => ({ ...r }) } = options;
  if (!world || typeof world.on !== 'function') throw new Error('createEntities: options.world must be a world from createWorld');
  if (typeof update !== 'function') throw new Error('createEntities: options.update must be a function (entity, dt, tier) => void');
  if (!(nearRadius >= activeRadius) || !(activeRadius >= 0)) throw new Error(`createEntities: need 0 <= activeRadius (${activeRadius}) <= nearRadius (${nearRadius})`);
  for (const [k, v] of [['nearEvery', nearEvery], ['farEvery', farEvery]]) if (!Number.isInteger(v) || v < 1) throw new Error(`createEntities: ${k} must be an integer >= 1, got ${v}`);

  const index = createSpatialIndex(cellSize);
  const all = [];
  const tiers = [[], [], []];
  const every = [1, nearEvery, farEvery];
  const listeners = { wake: [], sleep: [], tier: [] };
  const steps = [0, 0, 0];
  const scratch = [];
  const px = world.chunkPx;
  let foci = [];
  let time = world.time;
  let tick = 0;
  let cursor = 0;
  let nextId = world.savedMeta?.nextId ?? 1;

  const emit = (name, a, b, c) => { for (const fn of listeners[name]) fn(a, b, c); };
  const record = (e) => { const rec = toRecord(e); rec._t = time; return rec; };

  function classify(e) {
    let best = Infinity;
    for (const f of foci) { const d = (e.x - f.x) * (e.x - f.x) + (e.y - f.y) * (e.y - f.y); if (d < best) best = d; }
    return best <= activeRadius * activeRadius ? 0 : best <= nearRadius * nearRadius ? 1 : 2;
  }
  function attach(e, tier) {
    e._tier = tier;
    e._slot2 = tiers[tier].push(e) - 1;
    e._all = all.push(e) - 1;
    e._last = time;
    index.insert(e);
  }
  function leaveTier(e) {
    const list = tiers[e._tier];
    const lastItem = list.pop();
    if (lastItem !== e) { list[e._slot2] = lastItem; lastItem._slot2 = e._slot2; }
  }
  function detach(e) {
    leaveTier(e);
    const lastItem = all.pop();
    if (lastItem !== e) { all[e._all] = lastItem; lastItem._all = e._all; }
    index.remove(e);
    e._tier = -1;
  }
  function sleep(e, deposit) {
    if (deposit && e.persist) world.deposit(Math.floor(e.x / px), Math.floor(e.y / px), record(e));
    detach(e);
    emit('sleep', e);
  }
  function step(e, tier) {
    const dt = time - e._last;
    if (dt <= 0) return;
    e._last = time;
    update(e, dt, tier);
    steps[tier]++;
    if (e._tier < 0) return; // removed itself
    index.update(e);
    if (!world.isLoadedAt(e.x, e.y)) sleep(e, true); // walked off the loaded area
  }

  function add(e) {
    if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y)) throw new Error(`entities.add: entity needs finite x and y, got ${JSON.stringify(e)}`);
    if (e._tier >= 0) throw new Error(`entities.add: entity ${e.id} is already added`);
    if (typeof e.id === 'number') nextId = Math.max(nextId, e.id + 1); else e.id = nextId++;
    if (!world.isLoadedAt(e.x, e.y)) { // straight to dormant
      e._tier = -1;
      if (e.persist) world.deposit(Math.floor(e.x / px), Math.floor(e.y / px), record(e));
      return e;
    }
    attach(e, classify(e));
    emit('wake', e);
    return e;
  }

  world.on('load', (chunk, info) => {
    for (const rec of info.records ?? []) {
      const e = fromRecord(rec);
      const away = time - (rec._t ?? time);
      delete e._t;
      e._tier = -1;
      add(e);
      if (catchUp && away > 0) catchUp(e, away);
    }
    if (spawn) spawn(chunk, info, (e) => { if (e.persist && !chunk.spawned) { chunk.spawned = true; chunk.dirty = true; } return add(e); });
  });
  const inChunk = (chunk) => { scratch.length = 0; return index.queryRect(chunk.cx * px, chunk.cy * px, px, px, scratch); };
  world.on('unload', (chunk, out) => {
    for (const e of inChunk(chunk)) { if (e.persist) out.records.push(record(e)); sleep(e, false); }
  });
  world.on('collect', (chunk, out) => { for (const e of inChunk(chunk)) if (e.persist) out.records.push(record(e)); });
  world.on('meta', (meta) => { meta.nextId = nextId; });

  return {
    add,
    /** Take an entity out for good. */
    remove(e) { if (e._tier >= 0) detach(e); },
    /** Advance the simulation. focus: { x, y } or an array of them (the same you give world.update). */
    update(dt, focus) {
      if (!(dt >= 0)) throw new Error(`entities.update: dt must be seconds >= 0, got ${dt}`);
      time += dt;
      tick++;
      foci = Array.isArray(focus) ? focus : [focus];
      steps[0] = steps[1] = steps[2] = 0;
      // re-sort a slice of the entities into tiers each step (all of them every 10 steps)
      let n = Math.min(all.length, Math.max(64, Math.ceil(all.length / 10)));
      while (n-- > 0) {
        if (cursor >= all.length) cursor = 0;
        const e = all[cursor++];
        const t = classify(e);
        if (t !== e._tier) { const old = e._tier; leaveTier(e); e._tier = t; e._slot2 = tiers[t].push(e) - 1; emit('tier', e, t, old); }
      }
      for (let t = 0; t < 3; t++) {
        const list = tiers[t];
        const k = every[t];
        if (!list.length) continue;
        const lastIndex = list.length - 1;
        let i = lastIndex - ((((lastIndex - tick) % k) + k) % k); // highest index in this step's stripe
        for (; i >= 0; i -= k) if (i < list.length) step(list[i], t);
      }
    },
    /** Entities whose centre is inside the box (pixels). Pushes into `out` and returns it. */
    queryRect: (x, y, w, h, out) => index.queryRect(x, y, w, h, out),
    /** Entities whose centre is within r pixels of (x, y). */
    queryRadius: (x, y, r, out) => index.queryRadius(x, y, r, out),
    /** 0 active, 1 near, 2 far, -1 dormant or removed. */
    tierOf: (e) => e._tier ?? -1,
    /** Entities in memory. */
    count: () => all.length,
    /** { count, active, near, far, steps: updates run in the last update() } */
    stats: () => ({ count: all.length, active: tiers[0].length, near: tiers[1].length, far: tiers[2].length, steps: steps[0] + steps[1] + steps[2] }),
    /** Listen: 'wake' (e) entered memory, 'sleep' (e) left memory, 'tier' (e, tier, oldTier). Returns an unsubscribe function. */
    on(name, fn) {
      if (!listeners[name]) throw new Error(`entities.on: unknown event "${name}" (use wake, sleep or tier)`);
      listeners[name].push(fn);
      return () => { const i = listeners[name].indexOf(fn); if (i >= 0) listeners[name].splice(i, 1); };
    },
  };
}
