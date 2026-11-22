// Inventory changes as plain JSON actions. The same action objects work
// single-player (applied directly), from the UI binding, and over the network
// (sent with room.send and applied by the rules on the server, see net.js).
// Actions are treated as hostile input: every field is checked, and a bad
// action is refused instead of throwing.
//
//   { type: 'inv.move', from, to, n }        { type: 'inv.split', from, n }
//   { type: 'inv.sort', bag, by }            { type: 'inv.takeAll', from: 'chest' }
//   { type: 'inv.equip', from, slot }        { type: 'inv.unequip', slot, to }
//   { type: 'inv.use', from }                { type: 'inv.drop', from, n }
//   { type: 'inv.pickup', uid }              { type: 'inv.craft', recipe, times }
//   { type: 'inv.buy', shop, index, n }      { type: 'inv.sell', shop, from, n }
//   { type: 'inv.transfer', from, to: 'chest', n }   (to the first free place of another bag)
//   { type: 'inv.discard', from, n }                 (destroys the items)
//   { type: 'inv.hotbar', slot, id, swap }           (put an item kind in a quick slot; id null empties it)
//   { type: 'inv.quick', slot }                      (use or equip what is in a quick slot)
// from / to are slot refs: a number, { bag, index } or { equip }.

import { own } from './catalog.js';
import { dropFromInventory, pickupDrop } from './drops.js';
import { buyFromShop, sellToShop } from './shop.js';
import { setHotbar, useHotbar } from './hotbar.js';

/** Every action type applyInventoryAction understands. */
export const INVENTORY_ACTIONS = ['inv.move', 'inv.split', 'inv.sort', 'inv.takeAll', 'inv.transfer', 'inv.discard',
  'inv.equip', 'inv.unequip', 'inv.use', 'inv.drop', 'inv.pickup', 'inv.craft', 'inv.buy', 'inv.sell', 'inv.hotbar', 'inv.quick'];

/** isInventoryAction(action) -> true when action.type is one of INVENTORY_ACTIONS. */
export function isInventoryAction(action) {
  return !!action && typeof action === 'object' && INVENTORY_ACTIONS.includes(action.type);
}

function ref(value, name) {
  if (Number.isInteger(value)) return value;
  if (value && typeof value === 'object') {
    if (typeof value.equip === 'string') return { equip: value.equip };
    if (Number.isInteger(value.index) && (value.bag === undefined || typeof value.bag === 'string')) {
      return value.bag === undefined ? { index: value.index } : { bag: value.bag, index: value.index };
    }
  }
  throw new Error(`"${name}" must be a slot ref`);
}
const optional = (v) => (v === undefined || v === null ? undefined : v);
const text = (v, name) => {
  if (typeof v !== 'string' || !v) throw new Error(`"${name}" must be a non-empty string`);
  return v;
};
const fail = (reason, extra) => ({ ok: false, reason, ...extra });

/**
 * applyInventoryAction(inventory, action, env) -> { ok: true, ... } or { ok: false, reason }
 *   env (all optional):
 *     crafting   from createCrafting, for 'inv.craft'       station   name of the station the player is at
 *     shops      { name: shop state }, for buy / sell       drops     drops state, for drop / pickup
 *     position   { x, y } of the player, for drop / pickup   reach     pickup distance, default 48
 *     onUse(result)   called after an item was used ('inv.use', or 'inv.quick' on a usable item) with { id, effect, consumed }
 * A malformed action gives { ok: false, reason: 'bad-action', message }. A part
 * of env that the action needs but is missing gives reason 'unavailable'.
 */
export function applyInventoryAction(inv, action, env = {}) {
  if (!isInventoryAction(action)) return fail('bad-action', { message: `unknown action type ${JSON.stringify(action && action.type)}` });
  let result;
  try {
    result = run(inv, action, env);
  } catch (err) {
    return fail('bad-action', { message: err.message });
  }
  // Outside the try: a bug in the game's own onUse must surface, not look like a bad action.
  if (result.ok && result.effect !== undefined && typeof env.onUse === 'function') env.onUse(result);
  return result;
}

function run(inv, a, env) {
  switch (a.type) {
    case 'inv.move': return inv.move(ref(a.from, 'from'), ref(a.to, 'to'), optional(a.n));
    case 'inv.split': return inv.split(ref(a.from, 'from'), a.n);
    case 'inv.sort': inv.sort(optional(a.bag), optional(a.by)); return { ok: true };
    case 'inv.takeAll': return { ok: true, ...inv.takeAll(text(a.from, 'from'), optional(a.to)) };
    case 'inv.transfer': return inv.transfer(ref(a.from, 'from'), text(a.to, 'to'), optional(a.n));
    case 'inv.discard': return inv.take(ref(a.from, 'from'), optional(a.n), 'discard');
    case 'inv.equip': return inv.equip(ref(a.from, 'from'), optional(a.slot));
    case 'inv.unequip': return inv.unequip(text(a.slot, 'slot'), a.to === undefined ? undefined : ref(a.to, 'to'));
    case 'inv.use': return inv.use(ref(a.from, 'from'));
    case 'inv.hotbar': {
      if (a.id !== null && typeof a.id !== 'string') throw new Error('"id" must be an item id or null');
      return setHotbar(inv, a.slot, a.id, optional(a.swap));
    }
    case 'inv.quick': return useHotbar(inv, a.slot);
    case 'inv.drop': {
      const from = ref(a.from, 'from');
      if (!env.drops || !env.position) return fail('unavailable');
      return dropFromInventory(env.drops, inv, from, optional(a.n), env.position.x, env.position.y);
    }
    case 'inv.pickup': {
      if (!Number.isInteger(a.uid)) throw new Error('"uid" must be an integer');
      if (!env.drops || !env.position) return fail('unavailable');
      const d = env.drops.items.find((x) => x.uid === a.uid);
      if (!d) return fail('gone');
      if (Math.hypot(d.x - env.position.x, d.y - env.position.y) > (env.reach ?? 48)) return fail('too-far');
      return pickupDrop(env.drops, inv, a.uid);
    }
    case 'inv.craft': {
      const id = text(a.recipe, 'recipe');
      if (!env.crafting) return fail('unavailable');
      if (!env.crafting.has(id)) throw new Error(`unknown recipe "${id}"`);
      return env.crafting.craft(inv, id, { station: env.station, times: optional(a.times) });
    }
    case 'inv.buy':
    case 'inv.sell': {
      const name = text(a.shop, 'shop');
      if (!env.shops || !own(env.shops, name) || !env.shops[name]) return fail('unavailable');
      const shop = env.shops[name];
      if (a.type === 'inv.buy') {
        if (!Number.isInteger(a.index) || a.index < 0 || a.index >= shop.stock.length) throw new Error('"index" is not a stock line');
        return buyFromShop(shop, inv, a.index, optional(a.n));
      }
      return sellToShop(shop, inv, ref(a.from, 'from'), optional(a.n));
    }
    default: throw new Error(`unknown action type ${a.type}`);
  }
}
