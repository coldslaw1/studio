// Glue to the `inventory` engine. Nothing is imported from it: pass in an
// inventory (createInventory) and its catalog. Weapon stats come from what is
// equipped, thrown items leave the bag and come back when picked up.
import { need } from './util.js';

/**
 * loadoutFromInventory(combat, inventory, options) -> { weapon, shield, attack, defense, resist }
 * Reads what is equipped and says how the fighter should be set up.
 *   weapons  { itemId: weaponId } which combat weapon an item is. Default: the item's `puppet` name when a
 *            weapon has that id (sword, staff, rustyBlade), else the item id itself when a weapon has that id
 *   shields  { itemId: shieldId }. Default: the same rule with the shields table (shield)
 *   mainHand = 'mainHand', offHand = 'offHand'   equipment slot names
 *   unarmed = 'fists'                            weapon with an empty main hand
 *   base = {}                                    the fighter's own stats before equipment ({ attack: 1 })
 * Stats come from inventory.stats(base), so rolled rarities count: `attack` adds to weapon damage,
 * `defense` is armour, and stats named "resist.fire" (any damage type) become resistances 0..1.
 */
export function loadoutFromInventory(combat, inventory, options = {}) {
  need(inventory && typeof inventory.equipped === 'function' && typeof inventory.stats === 'function', 'loadoutFromInventory: pass an inventory (createInventory(...))');
  const cfg = combat.config;
  const find = (slot, map, table) => {
    const stack = inventory.equipped(slot);
    if (!stack) return null;
    const mapped = map && map[stack.id];
    if (mapped) { need(table[mapped], `loadoutFromInventory: item "${stack.id}" maps to "${mapped}", which is not defined in combat`); return mapped; }
    const look = inventory.catalog?.get ? inventory.catalog.get(stack.id).puppet : null;
    if (typeof look === 'string' && table[look]) return look;
    return table[stack.id] ? stack.id : null;
  };
  const stats = inventory.stats(options.base || {});
  const resist = {};
  for (const [key, value] of Object.entries(stats)) if (key.startsWith('resist.') && Number.isFinite(value)) resist[key.slice(7)] = value;
  return {
    weapon: find(options.mainHand ?? 'mainHand', options.weapons, cfg.weapons) ?? options.unarmed ?? 'fists',
    shield: find(options.offHand ?? 'offHand', options.shields, cfg.shields),
    attack: Number.isFinite(stats.attack) ? stats.attack : 0,
    defense: Number.isFinite(stats.defense) ? stats.defense : 0,
    resist,
  };
}

/**
 * syncFighter(combat, id, inventory, options) -> the loadout applied. Call it once at start and again from
 * inventory.on('change', ...) so swapping the sword in the bag changes the fighter. Options as loadoutFromInventory.
 */
export function syncFighter(combat, id, inventory, options = {}) {
  const loadout = loadoutFromInventory(combat, inventory, options);
  combat.equip(id, { weapon: loadout.weapon, shield: loadout.shield });
  combat.setStats(id, { attack: loadout.attack, defense: loadout.defense, resist: loadout.resist });
  return loadout;
}

/**
 * throwFromInventory(combat, id, inventory, ref, options) -> { ok, kind } | { ok: false, reason }
 * Throws one unit of the item in slot `ref`. The stack rides on the projectile, so picking it up gives the
 * very same item back (rarity and all).
 *   throwables { itemId: throwableId }   default: a throwable with the item's id
 *   aim { x, y, z? }                     where to throw (default: the fighter's aim input, else straight ahead)
 * Reasons: combat's (dead, busy) plus 'empty' (nothing in that slot) and 'not-throwable'.
 */
export function throwFromInventory(combat, id, inventory, ref, options = {}) {
  const stack = inventory.at(ref);
  if (!stack) return { ok: false, reason: 'empty' };
  const kind = options.throwables?.[stack.id] ?? (combat.config.throwables[stack.id] ? stack.id : null);
  if (!kind) return { ok: false, reason: 'not-throwable' };
  const f = combat.fighter(id);
  if (!f.alive) return { ok: false, reason: 'dead' };
  if (f.act.kind !== 'idle' || combat.timeScale(id) === 0 || combat.moveScale(id) === 0) return { ok: false, reason: 'busy' };
  const taken = inventory.take(ref, 1);
  if (!taken.ok) return { ok: false, reason: taken.reason };
  const result = combat.throw(id, { kind, aim: options.aim, item: taken.stack });
  if (!result.ok) inventory.give(taken.stack); // could not throw after all: nothing is lost
  return result;
}

/**
 * pickupToInventory(combat, id, inventory, options) -> { ok, kind, item, added } | { ok: false, reason }
 * Picks up the nearest thrown weapon in reach and puts it in the bag.
 *   items { throwableId: itemId }   which item a projectile without a stack becomes (default: the throwable's
 *                                   `item`, else an item with the throwable's id; nothing when the catalog has none)
 *   proj, reach                     a specific projectile id; a custom reach
 * Reasons: combat's (dead, busy, none) plus 'full': the bag has no room, and the weapon stays on the ground.
 */
export function pickupToInventory(combat, id, inventory, options = {}) {
  const f = combat.fighter(id);
  const reach = options.reach ?? combat.config.pickupReach;
  const near = combat.projectiles
    .filter((p) => (options.proj ? p.id === options.proj : true) && !p.in && (p.mode === 'rest' || p.mode === 'stuck') && combat.config.throwables[p.kind]?.pickup
      && Math.hypot(p.x - f.x, p.y - f.y) <= f.radius + reach)
    .sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0];
  if (!near) return f.alive ? { ok: false, reason: 'none' } : { ok: false, reason: 'dead' };
  const def = combat.config.throwables[near.kind];
  const itemId = options.items?.[near.kind] ?? def.item ?? near.kind;
  const stack = near.item ?? (inventory.catalog?.has?.(itemId) ? { id: itemId, n: 1 } : null);
  if (stack && inventory.room(stack.id) < stack.n) return { ok: false, reason: 'full' };
  const result = combat.pickup(id, near.id, reach);
  if (!result.ok) return result;
  let added = 0;
  if (stack) added = inventory.give(stack).added;
  return { ...result, item: stack, added };
}

/**
 * landedToDrops(combat, drops, dropItem, catalog, options) -> how many thrown weapons became ground drops.
 * Moves every thrown weapon that lies still into the inventory engine's drops, so the bag's own pickup
 * (pickupNear) collects it. Pass inventory's `dropItem` function. options.items as in pickupToInventory.
 * Use this OR pickupToInventory, not both.
 */
export function landedToDrops(combat, drops, dropItem, catalog, options = {}) {
  need(typeof dropItem === 'function', 'landedToDrops: pass the inventory engine\'s dropItem function');
  let moved = 0;
  for (const p of [...combat.projectiles]) {
    const def = combat.config.throwables[p.kind];
    if (p.mode !== 'rest' || !def || !def.pickup) continue;
    const itemId = options.items?.[p.kind] ?? def.item ?? p.kind;
    const stack = p.item ?? (catalog.has(itemId) ? { id: itemId, n: 1 } : null);
    if (!stack) continue;
    dropItem(drops, catalog, stack, p.x, p.y);
    combat.state.projectiles = combat.state.projectiles.filter((q) => q !== p);
    moved += 1;
  }
  return moved;
}
