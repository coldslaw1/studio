// createInventory: the object a game talks to. It wraps one plain-JSON state
// (see state.js) and a catalog. Every change either happens completely or not
// at all, and fires a 'change' event.

import { own } from './catalog.js';
import { clone, checkCount, stackRarity, stackStats } from './stack.js';
import { addItem, roomFor, countItem, removeAt, firstEmpty, checkIndex, takeItem } from './container.js';
import { moveItem, transferAll, sortContainer } from './move.js';
import { createInventoryState, isInventoryState, carriedWeight, checkInventoryState, replaceState } from './state.js';
import { equipFrom, unequipTo, swapEquip, equipStats, checkSlot } from './equipment.js';

const EPS = 1e-9;
const fail = (reason, extra) => ({ ok: false, reason, ...extra });

/**
 * createInventory(options) -> inventory
 *   catalog      required, from createCatalog
 *   state        wrap an existing state (multiplayer, or one made by createInventoryState)
 *   size, columns, bags, equipSlots, maxWeight, coins   used to make a new state (see createInventoryState)
 * A slot is named by a "ref": a number (slot of the 'main' bag),
 * { bag: 'main', index: 3 } or { equip: 'head' }. See README.md for every method.
 */
export function createInventory(options = {}) {
  const { catalog } = options;
  if (!catalog || typeof catalog.get !== 'function') throw new Error('createInventory: options.catalog is required (use createCatalog)');
  if (options.state !== undefined && !isInventoryState(options.state)) throw new Error('createInventory: options.state is not an inventory state');
  let state = options.state ?? createInventoryState(options);
  const template = clone(state);
  const attached = new Map();
  const listeners = new Set();

  let held = null; // events raised inside a change wait here until it is known to succeed
  const emit = (type, detail = {}) => {
    if (held) { held.push([type, detail]); return; }
    for (const fn of [...listeners]) fn({ type, ...detail });
  };
  const container = (name, fn) => {
    if (typeof name === 'string' && own(state.bags, name)) return state.bags[name];
    if (attached.has(name)) return attached.get(name);
    throw new Error(`${fn}: no bag "${String(name)}". Bags: ${[...Object.keys(state.bags), ...attached.keys()].join(', ')}`);
  };
  const firstBag = () => Object.keys(state.bags)[0];
  function parse(ref, fn) {
    if (Number.isInteger(ref)) ref = { index: ref };
    if (!ref || typeof ref !== 'object') throw new Error(`${fn}: a slot ref must be a number, { bag, index } or { equip }, got ${String(ref)}`);
    if (ref.equip !== undefined) return { equip: checkSlot(state, ref.equip, fn) };
    const name = ref.bag ?? firstBag();
    const c = container(name, fn);
    return { bag: name, c, index: checkIndex(c, ref.index, fn) };
  }
  // Run a change. If it is refused, throws, or pushes the carried weight over
  // the limit, everything it touched is put back.
  function attempt(type, fn, extra = []) {
    const others = extra.filter((c) => c && !Object.values(state.bags).includes(c));
    const before = { state: clone(state), others: others.map(clone), weight: carriedWeight(state, catalog) };
    const undo = () => {
      replaceState(state, before.state);
      others.forEach((c, i) => Object.assign(c, before.others[i]));
    };
    const outer = held;
    held = [];
    let result;
    try { result = fn(); } catch (err) { held = outer; undo(); throw err; }
    if (!result || typeof result.ok !== 'boolean') { held = outer; undo(); throw new Error('inventory.transaction: the function must return { ok: true } or { ok: false, reason }'); }
    if (result.ok && state.maxWeight !== null) {
      const now = carriedWeight(state, catalog);
      if (now > state.maxWeight + EPS && now > before.weight + EPS) result = fail('too-heavy');
    }
    const inner = held;
    held = outer;
    if (!result.ok) { undo(); return result; }
    for (const [t, d] of inner) emit(t, d);
    emit(type, result);
    return result;
  }
  const weightRoom = () => (state.maxWeight === null ? Infinity : Math.max(0, state.maxWeight - carriedWeight(state, catalog)));

  const inv = {
    catalog,
    get state() { return state; },
    get coins() { return state.coins; },
    get weight() { return carriedWeight(state, catalog); },
    get maxWeight() { return state.maxWeight; },
    set maxWeight(v) {
      if (v !== null && !(v >= 0 && Number.isFinite(v))) throw new Error(`inventory.maxWeight: must be a number >= 0 or null, got ${v}`);
      state.maxWeight = v;
      emit('limits');
    },
    bag: (name = firstBag()) => container(name, 'inventory.bag'),
    bags: () => [...Object.keys(state.bags), ...attached.keys()],

    add(id, n = 1, o = {}) {
      checkCount(n, 'inventory.add');
      catalog.get(id);
      let left = n;
      const targets = o.bag !== undefined ? [container(o.bag, 'inventory.add')] : Object.values(state.bags);
      for (const c of targets) {
        if (left === 0) break;
        const mine = Object.values(state.bags).includes(c);
        left = addItem(c, catalog, id, left, o.data, { weightRoom: mine ? weightRoom() : undefined, at: o.at }).left;
      }
      const result = { added: n - left, left };
      if (result.added > 0) emit('add', { id, ...result });
      return result;
    },
    give: (stack) => inv.add(stack.id, stack.n, { data: stack.data }),
    room(id, data) {
      let units = 0;
      for (const c of Object.values(state.bags)) units += roomFor(c, catalog, id, data);
      const w = catalog.get(id).weight;
      return w > 0 ? Math.min(units, Math.floor(weightRoom() / w + EPS)) : units;
    },
    count(id) {
      let n = 0;
      for (const c of Object.values(state.bags)) n += countItem(c, id);
      return n;
    },
    has: (id, n = 1) => inv.count(id) >= n,
    remove(id, n = 1) {
      checkCount(n, 'inventory.remove');
      const have = inv.count(id);
      if (have < n) return fail('missing', { have });
      let todo = n;
      for (const c of Object.values(state.bags)) {
        const m = Math.min(todo, countItem(c, id));
        if (m > 0) { takeItem(c, id, m); todo -= m; }
      }
      emit('remove', { id, removed: n });
      return { ok: true, removed: n };
    },
    at(ref) {
      const r = parse(ref, 'inventory.at');
      return clone(r.equip ? state.equip[r.equip] : r.c.slots[r.index]) ?? null;
    },
    list(name = firstBag()) {
      const out = [];
      container(name, 'inventory.list').slots.forEach((s, index) => {
        if (!s) return;
        const def = catalog.get(s.id);
        out.push({ index, id: s.id, n: s.n, data: clone(s.data), name: def.name, rarity: stackRarity(catalog, s), stats: stackStats(catalog, s), def });
      });
      return out;
    },

    move(from, to, n) {
      const a = parse(from, 'inventory.move');
      const b = parse(to, 'inventory.move');
      if (a.equip && b.equip) return attempt('equip', () => swapEquip(state, catalog, a.equip, b.equip));
      if (b.equip) return attempt('equip', () => equipFrom(state, catalog, a.c, a.index, b.equip), [a.c]);
      if (a.equip) {
        const t = b.c.slots[b.index];
        const swap = t && (catalog.get(t.id).equip || []).includes(a.equip);
        return attempt('equip', () => (swap ? equipFrom(state, catalog, b.c, b.index, a.equip) : unequipTo(state, catalog, a.equip, b.c, b.index)), [b.c]);
      }
      return attempt('move', () => moveItem(a.c, a.index, b.c, b.index, catalog, n), [a.c, b.c]);
    },
    transfer(from, toName = firstBag(), n) {
      const a = parse(from, 'inventory.transfer');
      const target = container(toName, 'inventory.transfer');
      if (a.equip) return attempt('equip', () => unequipTo(state, catalog, a.equip, target), [target]);
      const s = a.c.slots[a.index];
      if (!s) return fail('empty');
      const count = n === undefined || n === null ? s.n : checkCount(n, 'inventory.transfer');
      if (count > s.n) return fail('missing');
      if (a.c === target) return { ok: true, moved: 0, left: 0 };
      return attempt('move', () => {
        const r = addItem(target, catalog, s.id, count, s.data);
        if (r.added === 0) return fail('full');
        removeAt(a.c, a.index, r.added);
        return { ok: true, moved: r.added, left: r.left };
      }, [a.c, target]);
    },
    split(from, n) {
      const a = parse(from, 'inventory.split');
      if (a.equip) throw new Error('inventory.split: cannot split an equipment slot');
      const free = firstEmpty(a.c);
      if (free < 0) return fail('full');
      const r = inv.move(from, { bag: a.bag, index: free }, n);
      return r.ok ? { ...r, to: free } : r;
    },
    sort(name = firstBag(), by = 'rarity') {
      sortContainer(container(name, 'inventory.sort'), catalog, by);
      emit('sort', { bag: name });
      return inv;
    },
    takeAll(fromName, toName = firstBag()) {
      const from = container(fromName, 'inventory.takeAll');
      const to = container(toName, 'inventory.takeAll');
      const mine = Object.values(state.bags).includes(to) && !Object.values(state.bags).includes(from);
      const r = transferAll(from, to, catalog, { weightRoom: mine ? weightRoom() : undefined });
      if (r.moved > 0) emit('move', r);
      return r;
    },

    equip(from, slot) {
      const a = parse(from, 'inventory.equip');
      if (a.equip) throw new Error('inventory.equip: give a bag slot, not an equipment slot');
      return attempt('equip', () => equipFrom(state, catalog, a.c, a.index, slot), [a.c]);
    },
    unequip(slot, to) {
      const b = to === undefined ? { c: container(firstBag(), 'inventory.unequip') } : parse(to, 'inventory.unequip');
      if (b.equip) throw new Error('inventory.unequip: "to" must be a bag slot');
      return attempt('equip', () => unequipTo(state, catalog, slot, b.c, b.index), [b.c]);
    },
    equipped: (slot) => clone(state.equip[checkSlot(state, slot, 'inventory.equipped')]) ?? null,
    equipment: () => clone(state.equip),
    hotbar: () => (Array.isArray(state.hotbar) ? [...state.hotbar] : []),
    stats: (base) => equipStats(state, catalog, base),

    use(ref) {
      const r = parse(ref, 'inventory.use');
      const s = r.equip ? state.equip[r.equip] : r.c.slots[r.index];
      if (!s) return fail('empty');
      const def = catalog.get(s.id);
      if (def.use === undefined) return fail('not-usable');
      const result = { ok: true, id: s.id, effect: clone(def.use), consumed: def.consume !== false };
      if (result.consumed) {
        if (r.equip) state.equip[r.equip] = null;
        else removeAt(r.c, r.index, 1);
      }
      emit('use', result);
      return result;
    },
    take(ref, n, type = 'take') {
      const r = parse(ref, `inventory.${type}`);
      if (n !== undefined) checkCount(n, `inventory.${type}`);
      let stack;
      if (r.equip) { stack = state.equip[r.equip]; state.equip[r.equip] = null; } else stack = removeAt(r.c, r.index, n);
      if (!stack) return fail('empty');
      emit(type, { stack });
      return { ok: true, stack };
    },
    drop: (ref, n) => inv.take(ref, n, 'drop'),

    addCoins(n) {
      if (!Number.isInteger(n) || n < 0) throw new Error(`inventory.addCoins: amount must be an integer >= 0, got ${String(n)}`);
      state.coins += n;
      if (n > 0) emit('coins', { coins: state.coins });
      return state.coins;
    },
    spend(n) {
      if (!Number.isInteger(n) || n < 0) throw new Error(`inventory.spend: amount must be an integer >= 0, got ${String(n)}`);
      if (state.coins < n) return fail('coins', { have: state.coins });
      state.coins -= n;
      if (n > 0) emit('coins', { coins: state.coins });
      return { ok: true, coins: state.coins };
    },

    attach(name, c) {
      if (typeof name !== 'string' || !name || own(state.bags, name)) throw new Error(`inventory.attach: "${String(name)}" is empty or already the name of a bag`);
      if (!c || !Array.isArray(c.slots)) throw new Error('inventory.attach: expected a container (from createContainer)');
      attached.set(name, c);
      return inv;
    },
    detach(name) { attached.delete(name); return inv; },
    transaction: (fn, containers = []) => attempt('change', fn, containers),

    on(event, fn) {
      if (event !== 'change') throw new Error(`inventory.on: unknown event "${String(event)}". Use 'change'`);
      if (typeof fn !== 'function') throw new Error('inventory.on: listener must be a function');
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    changed: (type = 'change', detail) => emit(type, detail),

    toJSON: () => clone(state),
    load(data) {
      const r = checkInventoryState(data, catalog, template);
      replaceState(state, { ...r.state, maxWeight: state.maxWeight });
      emit('load', { problems: r.problems });
      return r.problems;
    },
    setState(next) {
      if (!isInventoryState(next)) throw new Error('inventory.setState: not an inventory state');
      state = next;
      emit('load', { problems: [] });
      return inv;
    },
    save(store, key = 'inventory') {
      if (!store || typeof store.set !== 'function') throw new Error('inventory.save: store must have set(key, value)');
      return store.set(key, clone(state)) !== false;
    },
    restore(store, key = 'inventory') {
      if (!store || typeof store.get !== 'function') throw new Error('inventory.restore: store must have get(key)');
      const data = store.get(key);
      if (data === null || data === undefined) return { loaded: false, problems: [] };
      return { loaded: true, problems: inv.load(data) };
    },
    snapshot() {
      const bags = {};
      for (const name of Object.keys(state.bags)) bags[name] = inv.list(name).map(({ index, id, n, name: label, rarity }) => ({ index, id, n, name: label, rarity }));
      const equip = {};
      for (const [slot, s] of Object.entries(state.equip)) equip[slot] = s ? s.id : null;
      return { coins: state.coins, weight: inv.weight, maxWeight: state.maxWeight, bags, equip, stats: inv.stats() };
    },
  };
  return inv;
}
