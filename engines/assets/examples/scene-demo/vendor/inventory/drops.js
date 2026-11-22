// Items lying in the world: dropped by a player, or scattered from loot.
// Plain JSON state, so it can live in a save or in a multiplayer room:
//   { next, ttl, delay, items: [{ uid, id, n, data?, x, y, age }] }
// Positions are logical pixels (or whatever unit the game uses for x and y).

import { checkCount, checkData, clone } from './stack.js';

const fail = (reason, extra) => ({ ok: false, reason, ...extra });

/**
 * createDrops(options) -> drops state
 *   ttl = null     seconds before a drop disappears, null = never
 *   delay = 0.5    seconds before a fresh drop can be picked up (so a dropped item is not grabbed back at once)
 */
export function createDrops(options = {}) {
  const ttl = options.ttl ?? null;
  if (ttl !== null && !(ttl > 0 && Number.isFinite(ttl))) throw new Error(`createDrops: ttl must be seconds > 0 or null, got ${ttl}`);
  const delay = options.delay ?? 0.5;
  if (!(delay >= 0 && Number.isFinite(delay))) throw new Error(`createDrops: delay must be seconds >= 0, got ${delay}`);
  return { next: 1, ttl, delay, items: [] };
}

function check(drops, fn) {
  if (!drops || !Array.isArray(drops.items)) throw new Error(`${fn}: expected drops (from createDrops)`);
}
function point(x, y, fn) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${fn}: x and y must be numbers, got ${x}, ${y}`);
}

/** dropItem(drops, catalog, stack, x, y) -> the new drop { uid, id, n, x, y, age }. */
export function dropItem(drops, catalog, stack, x, y) {
  check(drops, 'dropItem');
  point(x, y, 'dropItem');
  if (!stack || typeof stack !== 'object') throw new Error('dropItem: stack must be { id, n }');
  catalog.get(stack.id);
  const drop = { uid: drops.next, id: stack.id, n: checkCount(stack.n, 'dropItem'), x, y, age: 0 };
  const data = checkData(stack.data, 'dropItem');
  if (data) drop.data = data;
  drops.next += 1;
  drops.items.push(drop);
  return drop;
}

/**
 * scatterLoot(drops, catalog, stacks, x, y, rng, radius = 24) -> the new drops
 * Drops every stack (for example loot.roll(...).items) at a random spot within `radius` of (x, y).
 */
export function scatterLoot(drops, catalog, stacks, x, y, rng, radius = 24) {
  if (typeof rng !== 'function') throw new Error('scatterLoot: rng must be a function returning a float in [0, 1)');
  if (!Array.isArray(stacks)) throw new Error('scatterLoot: stacks must be an array of { id, n }');
  return stacks.map((s) => {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    return dropItem(drops, catalog, s, x + Math.cos(a) * r, y + Math.sin(a) * r);
  });
}

/** stepDrops(drops, dt) -> list of drops that expired this step (already removed). dt in seconds. */
export function stepDrops(drops, dt) {
  check(drops, 'stepDrops');
  if (!(dt >= 0)) throw new Error(`stepDrops: dt must be seconds >= 0, got ${dt}`);
  const gone = [];
  for (const d of drops.items) d.age += dt;
  if (drops.ttl !== null) {
    drops.items = drops.items.filter((d) => {
      if (d.age < drops.ttl) return true;
      gone.push(d);
      return false;
    });
  }
  return gone;
}

/** nearbyDrops(drops, x, y, radius) -> drops within radius that can be picked up, nearest first. */
export function nearbyDrops(drops, x, y, radius) {
  check(drops, 'nearbyDrops');
  point(x, y, 'nearbyDrops');
  if (!(radius >= 0)) throw new Error(`nearbyDrops: radius must be >= 0, got ${radius}`);
  return drops.items
    .filter((d) => d.age >= drops.delay)
    .map((d) => ({ d, dist: Math.hypot(d.x - x, d.y - y) }))
    .filter((e) => e.dist <= radius)
    .sort((a, b) => a.dist - b.dist || a.d.uid - b.d.uid)
    .map((e) => e.d);
}

/**
 * pickupDrop(drops, inventory, uid) -> { ok, id, added, left } or { ok: false, reason }
 * Puts the drop in the inventory. If only part fits, the rest stays on the
 * ground (left > 0). reasons: 'gone' 'not-ready' 'full'
 */
export function pickupDrop(drops, inv, uid) {
  check(drops, 'pickupDrop');
  const i = drops.items.findIndex((d) => d.uid === uid);
  if (i < 0) return fail('gone');
  const d = drops.items[i];
  if (d.age < drops.delay) return fail('not-ready');
  const r = inv.add(d.id, d.n, { data: d.data });
  if (r.added === 0) return fail('full');
  if (r.left === 0) drops.items.splice(i, 1);
  else d.n = r.left;
  return { ok: true, uid, id: d.id, added: r.added, left: r.left };
}

/** pickupNear(drops, inventory, x, y, radius) -> the successful pickups (see pickupDrop), nearest first. */
export function pickupNear(drops, inv, x, y, radius) {
  const out = [];
  for (const d of nearbyDrops(drops, x, y, radius)) {
    const r = pickupDrop(drops, inv, d.uid);
    if (r.ok) out.push(r);
  }
  return out;
}

/**
 * dropFromInventory(drops, inventory, ref, n, x, y) -> { ok, drop } or { ok: false, reason: 'empty' }
 * Takes n units (default: the whole stack) out of a slot and puts them on the ground at (x, y).
 */
export function dropFromInventory(drops, inv, ref, n, x, y) {
  check(drops, 'dropFromInventory');
  point(x, y, 'dropFromInventory');
  const r = inv.drop(ref, n ?? undefined);
  if (!r.ok) return r;
  return { ok: true, drop: clone(dropItem(drops, inv.catalog, r.stack, x, y)) };
}
