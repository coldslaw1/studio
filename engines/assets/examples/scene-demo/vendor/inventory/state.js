// The whole inventory of one owner as plain JSON, so it can be saved with core
// and sent through net (Parley) unchanged:
//   { v: 1, bags: { main: container, ... }, equip: { slot: null | stack }, coins, maxWeight }

import { EQUIP_SLOTS, isId, own } from './catalog.js';
import { createContainer, containerWeight, checkContainer } from './container.js';
import { stackWeight, checkStack, clone } from './stack.js';
import { checkHotbar } from './hotbar.js';

/**
 * createInventoryState(options) -> state
 *   size = 20, columns     size of the 'main' bag (ignored when `bags` is given)
 *   bags                   { name: { size, columns, maxWeight, accepts } } for several bags
 *   equipSlots             list of equipment slot names (default EQUIP_SLOTS; [] for none)
 *   maxWeight = null       carry limit over all bags and equipment, null = none
 *   coins = 0              starting coins
 *   hotbar = 0             number of quick slots (see hotbar.js)
 */
export function createInventoryState(options = {}) {
  const bagSpecs = options.bags ?? { main: { size: options.size ?? 20, columns: options.columns } };
  if (!bagSpecs || typeof bagSpecs !== 'object' || Object.keys(bagSpecs).length === 0) {
    throw new Error('createInventoryState: bags must be an object with at least one bag, e.g. { main: { size: 20 } }');
  }
  const bags = {};
  for (const [name, spec] of Object.entries(bagSpecs)) {
    if (!isId(name)) throw new Error(`createInventoryState: bad bag name ${JSON.stringify(name)}`);
    bags[name] = createContainer(spec || {});
  }
  const slots = options.equipSlots ?? EQUIP_SLOTS;
  if (!Array.isArray(slots) || slots.some((s) => !isId(s))) throw new Error('createInventoryState: equipSlots must be a list of slot names');
  const equip = {};
  for (const s of slots) equip[s] = null;
  const maxWeight = options.maxWeight ?? null;
  if (maxWeight !== null && !(maxWeight >= 0 && Number.isFinite(maxWeight))) throw new Error(`createInventoryState: maxWeight must be a number >= 0 or null, got ${maxWeight}`);
  const coins = options.coins ?? 0;
  if (!Number.isInteger(coins) || coins < 0) throw new Error(`createInventoryState: coins must be an integer >= 0, got ${coins}`);
  const hotbar = options.hotbar ?? 0;
  if (!Number.isInteger(hotbar) || hotbar < 0 || hotbar > 12) throw new Error(`createInventoryState: hotbar must be an integer from 0 to 12, got ${hotbar}`);
  return { v: 1, bags, equip, coins, maxWeight, hotbar: new Array(hotbar).fill(null) };
}

/** isInventoryState(value) -> true when the value has the shape of an inventory state. */
export function isInventoryState(value) {
  return !!value && typeof value === 'object' && !!value.bags && typeof value.bags === 'object'
    && !!value.equip && typeof value.equip === 'object'
    && Object.values(value.bags).every((b) => b && Array.isArray(b.slots));
}

/** carriedWeight(state, catalog) -> weight of every bag plus the equipment. */
export function carriedWeight(state, catalog) {
  let w = 0;
  for (const bag of Object.values(state.bags)) w += containerWeight(bag, catalog);
  for (const s of Object.values(state.equip)) w += stackWeight(catalog, s);
  return w;
}

/**
 * checkInventoryState(raw, catalog, like) -> { state, problems }
 * Rebuilds a state from saved data. `like` is a fresh state that gives the
 * bags, slots and limits the game expects now: missing bags come back empty,
 * unknown items are dropped, and every repair is listed in `problems`.
 * Never throws on bad saved data.
 */
export function checkInventoryState(raw, catalog, like) {
  const problems = [];
  const state = clone(like);
  for (const bag of Object.values(state.bags)) bag.slots.fill(null);
  for (const slot of Object.keys(state.equip)) state.equip[slot] = null;
  state.coins = 0;
  const slots = Array.isArray(state.hotbar) ? state.hotbar.length : 0;
  state.hotbar = new Array(slots).fill(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { state, problems: ['no usable save data; started empty'] };
  const rawBags = raw.bags && typeof raw.bags === 'object' ? raw.bags : {};
  for (const [name, bag] of Object.entries(state.bags)) {
    if (!own(rawBags, name)) { problems.push(`bag "${name}" missing from the save; started empty`); continue; }
    const r = checkContainer(rawBags[name], catalog, bag);
    // Keep the size the game expects now. Items saved beyond it move to free
    // slots; what still does not fit is reported, never silently lost.
    const overflow = [];
    r.container.slots.forEach((s, i) => {
      if (!s) return;
      if (i < bag.size) bag.slots[i] = s;
      else overflow.push(s);
    });
    for (const s of overflow) {
      const free = bag.slots.indexOf(null);
      if (free >= 0) bag.slots[free] = s;
      else problems.push(`bag "${name}": no room for ${s.id} x${s.n} (the bag is smaller than when it was saved)`);
    }
    r.problems.forEach((p) => problems.push(`bag "${name}": ${p}`));
  }
  for (const name of Object.keys(rawBags)) {
    if (!own(state.bags, name)) problems.push(`bag "${name}" is not used by the game any more; its items were dropped`);
  }
  const rawEquip = raw.equip && typeof raw.equip === 'object' ? raw.equip : {};
  for (const slot of Object.keys(state.equip)) {
    const s = own(rawEquip, slot) ? rawEquip[slot] : null;
    if (s === null || s === undefined) continue;
    const stack = checkStack(catalog, s);
    const def = stack && catalog.get(stack.id);
    if (stack && def.equip && def.equip.includes(slot)) state.equip[slot] = { ...stack, n: 1 };
    else problems.push(`equipment slot "${slot}": dropped unusable item ${JSON.stringify(s && s.id)}`);
  }
  for (const [slot, s] of Object.entries(rawEquip)) {
    if (s && !own(state.equip, slot)) problems.push(`equipment slot "${slot}" is not used by the game any more; its item was dropped`);
  }
  if (Number.isInteger(raw.coins) && raw.coins >= 0) state.coins = raw.coins;
  else if (raw.coins !== undefined) problems.push(`coins value ${JSON.stringify(raw.coins)} unusable; set to 0`);
  const bar = checkHotbar(raw.hotbar, catalog, slots);
  state.hotbar = bar.hotbar;
  problems.push(...bar.problems);
  return { state, problems };
}

/** replaceState(target, source) copies source's content into target, keeping the target object (and its bag objects). */
export function replaceState(target, source) {
  const copy = clone(source);
  for (const name of Object.keys(target.bags)) if (!own(copy.bags, name)) delete target.bags[name];
  for (const [name, bag] of Object.entries(copy.bags)) {
    if (own(target.bags, name)) Object.assign(target.bags[name], bag);
    else target.bags[name] = bag;
  }
  target.equip = copy.equip;
  target.coins = copy.coins;
  target.hotbar = Array.isArray(copy.hotbar) ? copy.hotbar : [];
  target.maxWeight = copy.maxWeight ?? null;
  target.v = copy.v ?? 1;
  return target;
}
