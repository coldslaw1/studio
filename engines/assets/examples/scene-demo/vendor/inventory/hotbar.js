// Quick slots (a hotbar): each slot remembers an item KIND, not a bag slot, so
// it keeps working when the bag is sorted, and shows how many the player has.
// Kept in the inventory state as `hotbar: [itemId | null, ...]`.
// Make one with createInventory({ hotbar: 5 }).

import { own } from './catalog.js';

const fail = (reason) => ({ ok: false, reason });

function slotOf(inv, slot, fn) {
  const bar = inv.state.hotbar;
  if (!Array.isArray(bar) || bar.length === 0) throw new Error(`${fn}: this inventory has no quick slots. Create it with { hotbar: 5 }`);
  if (!Number.isInteger(slot) || slot < 0 || slot >= bar.length) throw new Error(`${fn}: quick slot must be an integer from 0 to ${bar.length - 1}, got ${String(slot)}`);
  return bar;
}

/**
 * setHotbar(inventory, slot, id, swap) -> { ok: true }
 * Puts an item kind in a quick slot (id: null empties it). The same kind is
 * never in two slots: it moves. With `swap` (another slot number) what was in
 * `slot` goes there. Throws on an unknown item or slot.
 */
export function setHotbar(inv, slot, id, swap) {
  const bar = slotOf(inv, slot, 'setHotbar');
  const before = bar[slot];
  if (swap !== undefined && swap !== null) slotOf(inv, swap, 'setHotbar');
  if (id !== null && id !== undefined) {
    inv.catalog.get(id);
    for (let i = 0; i < bar.length; i++) if (bar[i] === id) bar[i] = null;
  }
  bar[slot] = id ?? null;
  if (swap !== undefined && swap !== null && swap !== slot) bar[swap] = before === id ? null : before;
  inv.changed('hotbar', { slot, id: id ?? null });
  return { ok: true };
}

/**
 * useHotbar(inventory, slot) -> the result of using or equipping that item
 * A usable item is used ({ ok, id, effect, consumed }); an equippable one is
 * equipped, or taken off when it is already worn. reasons: 'empty' (nothing
 * in the slot) 'missing' (none left in the bags) plus those of use / equip.
 */
export function useHotbar(inv, slot) {
  const bar = slotOf(inv, slot, 'useHotbar');
  const id = bar[slot];
  if (!id || !inv.catalog.has(id)) return fail('empty');
  const def = inv.catalog.get(id);
  const worn = Object.entries(inv.state.equip).find(([, s]) => s && s.id === id);
  if (def.equip && def.use === undefined && worn) return inv.unequip(worn[0]);
  for (const name of Object.keys(inv.state.bags)) {
    const entry = inv.list(name).find((e) => e.id === id);
    if (!entry) continue;
    const ref = { bag: name, index: entry.index };
    if (def.use !== undefined) return inv.use(ref);
    if (def.equip) return inv.equip(ref);
    return fail('not-usable');
  }
  return fail('missing');
}

/** checkHotbar(raw, catalog, size) -> { hotbar, problems }: a clean quick-slot list from saved data. */
export function checkHotbar(raw, catalog, size) {
  const hotbar = new Array(size).fill(null);
  const problems = [];
  if (Array.isArray(raw)) {
    raw.slice(0, size).forEach((id, i) => {
      if (id === null || id === undefined) return;
      if (typeof id === 'string' && catalog.has(id) && !hotbar.includes(id)) hotbar[i] = id;
      else problems.push(`quick slot ${i + 1}: dropped unusable item ${JSON.stringify(id)}`);
    });
  }
  return { hotbar, problems };
}

/** hasHotbar(state) -> true when the state has quick slots. */
export function hasHotbar(state) {
  return own(state, 'hotbar') && Array.isArray(state.hotbar) && state.hotbar.length > 0;
}
