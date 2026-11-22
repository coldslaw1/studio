// Shows the inventory's equipment on a puppet character (the `puppet` engine).
// Nothing is imported from puppet: the game passes the character and puppet's
// ITEMS in, so this file also works with any object that has
// equip(slot, item), unequip(slot) and equipped(slot).
//
// An item definition says how it looks:  { equip: 'offHand', puppet: 'shield' }
// `puppet` is a key of puppet's ITEMS (sword, shield, helm, strawHat, staff,
// rustyBlade) or a full puppet item object { name, parts }.

import { own } from './catalog.js';

/** Which puppet slot shows each inventory equipment slot. Override per item with `puppetSlot`. */
export const PUPPET_SLOTS = { mainHand: 'handR', offHand: 'armL', head: 'head', body: 'body', back: 'back' };

const body = (target) => (target && target.puppet && typeof target.puppet.equipped === 'function' ? target.puppet : target);

function checkTarget(target, fn) {
  const p = body(target);
  if (!p || typeof p.equip !== 'function' || typeof p.unequip !== 'function' || typeof p.equipped !== 'function') {
    throw new Error(`${fn}: expected a puppet character or puppet (needs equip, unequip and equipped)`);
  }
  return p;
}

/**
 * puppetLoadout(inventory, options) -> { puppetSlot: { id, look, equipSlot } }
 * What the puppet should wear for the current equipment. `look` is the item's
 * `puppet` value. options.slots replaces PUPPET_SLOTS.
 */
export function puppetLoadout(inv, options = {}) {
  const map = options.slots ?? PUPPET_SLOTS;
  const out = {};
  for (const [equipSlot, stack] of Object.entries(inv.state.equip)) {
    if (!stack) continue;
    const def = inv.catalog.get(stack.id);
    if (def.puppet === undefined) continue;
    const slot = def.puppetSlot ?? (own(map, equipSlot) ? map[equipSlot] : null);
    if (slot) out[slot] = { id: stack.id, look: def.puppet, equipSlot, colors: def.puppetColors };
  }
  return out;
}

function managedSlots(inv, map) {
  const slots = new Set();
  for (const equipSlot of Object.keys(inv.state.equip)) if (own(map, equipSlot)) slots.add(map[equipSlot]);
  for (const def of inv.catalog.all()) if (def.puppet !== undefined && def.puppetSlot) slots.add(def.puppetSlot);
  return slots;
}

/**
 * syncPuppet(target, inventory, options) -> list of changes [{ slot, equipped | unequipped }]
 *   target    a puppet character (createCharacter) or a puppet (createPuppet)
 *   options   { ITEMS (puppet's ITEMS export; needed when items use names), height, slots }
 * Makes the puppet wear exactly what the inventory has equipped. THE INVENTORY
 * WINS: a puppet slot it manages (handR, armL, head, body, back by default) is
 * emptied when the matching equipment slot is empty, including gear the model
 * started with. Call adoptPuppet first to keep a model's starting gear.
 * Safe to call every frame or on every 'change': it only touches slots that differ.
 */
export function syncPuppet(target, inv, options = {}) {
  const p = checkTarget(target, 'syncPuppet');
  const map = options.slots ?? PUPPET_SLOTS;
  const height = options.height ?? target.rig?.meta?.height ?? p.rig?.meta?.height ?? 1.8;
  const want = puppetLoadout(inv, options);
  const changes = [];
  for (const slot of managedSlots(inv, map)) {
    const now = p.equipped(slot);
    const w = own(want, slot) ? want[slot] : null;
    if (!w) {
      if (now) { p.unequip(slot); changes.push({ slot, unequipped: now.inventoryId ?? now.name ?? null }); }
      continue;
    }
    if (now && now.inventoryId === w.id) continue;
    // Gear the model came with (no inventoryId) that already looks right is left alone, colours and all.
    const lookName = typeof w.look === 'string' ? w.look : w.look.name;
    if (now && now.inventoryId === undefined && now.name === lookName) continue;
    let item;
    if (typeof w.look === 'string') {
      const make = options.ITEMS && own(options.ITEMS, w.look) ? options.ITEMS[w.look] : null;
      if (typeof make !== 'function') throw new Error(`syncPuppet: item "${w.id}" looks like puppet item "${w.look}" but options.ITEMS has no such entry. Pass puppet's ITEMS as options.ITEMS`);
      item = make(height);
    } else item = w.look;
    item = { ...item, colors: { ...(item.colors ?? {}), ...(w.colors ?? {}) }, inventoryId: w.id };
    p.equip(slot, item);
    changes.push({ slot, equipped: w.id });
  }
  return changes;
}

/**
 * adoptPuppet(target, inventory, options) -> list of adopted [{ slot, id }]
 * The other direction, for the start of a game: whatever the puppet model
 * already wears (the knight's helm, sword and shield) is put into the
 * inventory's empty equipment slots, when the catalog has an item with that
 * `puppet` name. After this, syncPuppet keeps the gear instead of removing it.
 */
export function adoptPuppet(target, inv, options = {}) {
  const p = checkTarget(target, 'adoptPuppet');
  const map = options.slots ?? PUPPET_SLOTS;
  const adopted = [];
  for (const equipSlot of Object.keys(inv.state.equip)) {
    if (inv.state.equip[equipSlot]) continue;
    const def = inv.catalog.all().find((d) => {
      if (d.puppet === undefined || !d.equip.includes(equipSlot)) return false;
      const slot = d.puppetSlot ?? (own(map, equipSlot) ? map[equipSlot] : null);
      const worn = slot ? p.equipped(slot) : null;
      const name = typeof d.puppet === 'string' ? d.puppet : d.puppet.name;
      return !!worn && worn.name === name;
    });
    if (!def) continue;
    inv.state.equip[equipSlot] = { id: def.id, n: 1 };
    adopted.push({ slot: equipSlot, id: def.id });
  }
  if (adopted.length) inv.changed('equip', { adopted });
  return adopted;
}
