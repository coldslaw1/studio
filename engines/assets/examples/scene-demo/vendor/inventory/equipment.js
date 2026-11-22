// Equipment: one item per named slot (mainHand, offHand, head, body, back by
// default). These functions change a state in place and may leave it half
// changed when they return { ok: false }; the inventory wraps them so a
// refused change is always rolled back. Games call inventory.equip() instead.

import { own } from './catalog.js';
import { accepts, addItem, checkIndex } from './container.js';
import { clone, stackStats } from './stack.js';

const fail = (reason) => ({ ok: false, reason });

/** checkSlot(state, slot, fn) -> slot, or throws when the inventory has no such equipment slot. */
export function checkSlot(state, slot, fn) {
  if (typeof slot !== 'string' || !own(state.equip, slot)) {
    throw new Error(`${fn}: no equipment slot "${String(slot)}". Slots: ${Object.keys(state.equip).join(', ') || 'none'}`);
  }
  return slot;
}

function stow(state, catalog, stack, first) {
  let left = stack.n;
  for (const bag of [first, ...Object.values(state.bags).filter((b) => b !== first)]) {
    if (left === 0) break;
    left = addItem(bag, catalog, stack.id, left, stack.data).left;
  }
  return left === 0;
}

/**
 * equipFrom(state, catalog, container, index, slot) -> { ok, slot, unequipped } or { ok: false, reason }
 * Equips the item in a container slot. Without `slot` the first free slot the
 * item allows is used. Whatever it replaces or blocks (a two-handed weapon
 * empties offHand) goes back to the container. reasons: 'empty'
 * 'not-equippable' 'no-slot' 'wrong-slot' 'full'
 */
export function equipFrom(state, catalog, container, index, slot) {
  checkIndex(container, index, 'equip');
  const s = container.slots[index];
  if (!s) return fail('empty');
  const def = catalog.get(s.id);
  if (!def.equip) return fail('not-equippable');
  const allowed = def.equip.filter((name) => own(state.equip, name));
  if (allowed.length === 0) return fail('no-slot');
  let target = slot;
  if (target === undefined || target === null) target = allowed.find((name) => !state.equip[name]) ?? allowed[0];
  else if (!allowed.includes(checkSlot(state, target, 'equip'))) return fail('wrong-slot');

  const out = new Set();
  if (state.equip[target]) out.add(target);
  for (const b of def.blocks) if (own(state.equip, b) && state.equip[b]) out.add(b);
  for (const [name, st] of Object.entries(state.equip)) {
    if (st && name !== target && catalog.get(st.id).blocks.includes(target)) out.add(name);
  }
  const unit = { ...clone(s), n: 1 };
  s.n -= 1;
  if (s.n === 0) container.slots[index] = null;
  const displaced = [...out].map((name) => {
    const st = state.equip[name];
    state.equip[name] = null;
    return st;
  });
  state.equip[target] = unit;
  for (const st of displaced) {
    if (container.slots[index] === null && accepts(container, catalog, st.id)) container.slots[index] = st;
    else if (!stow(state, catalog, st, container)) return fail('full');
  }
  return { ok: true, slot: target, id: unit.id, unequipped: displaced.map((st) => st.id) };
}

/**
 * unequipTo(state, catalog, slot, container, index) -> { ok, id } or { ok: false, reason }
 * Takes the item out of an equipment slot. With `index` it goes to that exact
 * (empty) container slot, otherwise to the first free place.
 * reasons: 'empty' 'occupied' 'not-accepted' 'full'
 */
export function unequipTo(state, catalog, slot, container, index) {
  checkSlot(state, slot, 'unequip');
  const st = state.equip[slot];
  if (!st) return fail('empty');
  if (index !== undefined && index !== null) {
    checkIndex(container, index, 'unequip');
    if (container.slots[index]) return fail('occupied');
    if (!accepts(container, catalog, st.id)) return fail('not-accepted');
    container.slots[index] = st;
  } else if (!stow(state, catalog, st, container)) return fail('full');
  state.equip[slot] = null;
  return { ok: true, id: st.id };
}

/**
 * swapEquip(state, catalog, a, b) -> { ok } or { ok: false, reason: 'empty' | 'wrong-slot' }
 * Moves the item in equipment slot a to slot b (swapping with what is there).
 */
export function swapEquip(state, catalog, a, b) {
  checkSlot(state, a, 'move');
  checkSlot(state, b, 'move');
  const sa = state.equip[a];
  const sb = state.equip[b];
  if (!sa) return fail('empty');
  const fits = (st, slot) => !st || (catalog.get(st.id).equip.includes(slot) && catalog.get(st.id).blocks.length === 0);
  if (!fits(sa, b) || !fits(sb, a)) return fail('wrong-slot');
  state.equip[a] = sb;
  state.equip[b] = sa;
  return { ok: true };
}

/**
 * equipStats(state, catalog, base = {}) -> { stat: number }
 * The base stats plus the stats of every equipped item.
 */
export function equipStats(state, catalog, base = {}) {
  const total = { ...base };
  for (const st of Object.values(state.equip)) {
    if (!st) continue;
    for (const [k, v] of Object.entries(stackStats(catalog, st))) total[k] = (total[k] ?? 0) + v;
  }
  return total;
}
