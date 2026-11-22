// A container is a row of slots: a bag, a chest, a quiver. Plain JSON state:
//   { size, columns, slots: [null | { id, n, data? }], maxWeight: null | number, accepts: null | [tags] }
// Functions here change the container in place. Bad arguments throw; things the
// game may refuse (full, too heavy) come back as { ok: false, reason }.

import { own } from './catalog.js';
import { checkCount, checkData, sameItem, stackWeight, checkStack, clone } from './stack.js';

const EPS = 1e-9;

/**
 * createContainer(options) -> container state
 *   size = 20      number of slots
 *   columns        slots per row when drawn as a grid (default: up to 5 or 8)
 *   maxWeight      weight limit, or null for none
 *   accepts        list of tags; only items with one of them fit. null = anything
 */
export function createContainer(options = {}) {
  const size = options.size ?? 20;
  if (!Number.isInteger(size) || size < 1 || size > 1000) throw new Error(`createContainer: size must be an integer from 1 to 1000, got ${size}`);
  const columns = options.columns ?? Math.min(size, size > 20 ? 8 : 5);
  if (!Number.isInteger(columns) || columns < 1) throw new Error(`createContainer: columns must be an integer >= 1, got ${columns}`);
  const maxWeight = options.maxWeight ?? null;
  if (maxWeight !== null && !(maxWeight >= 0 && Number.isFinite(maxWeight))) throw new Error(`createContainer: maxWeight must be a number >= 0 or null, got ${maxWeight}`);
  const accepts = options.accepts ?? null;
  if (accepts !== null && (!Array.isArray(accepts) || accepts.some((t) => typeof t !== 'string'))) throw new Error('createContainer: accepts must be a list of tags or null');
  return { size, columns, slots: new Array(size).fill(null), maxWeight, accepts: accepts ? [...accepts] : null };
}

function checkContainerArg(c, fn) {
  if (!c || !Array.isArray(c.slots)) throw new Error(`${fn}: expected a container (from createContainer), got ${String(c)}`);
}

/** checkIndex(container, index, fn) -> index, or throws when it is not a slot of the container. */
export function checkIndex(container, index, fn) {
  checkContainerArg(container, fn);
  if (!Number.isInteger(index) || index < 0 || index >= container.slots.length) {
    throw new Error(`${fn}: slot index must be an integer from 0 to ${container.slots.length - 1}, got ${String(index)}`);
  }
  return index;
}

/** containerWeight(container, catalog) -> total weight of everything inside. */
export function containerWeight(container, catalog) {
  let w = 0;
  for (const s of container.slots) w += stackWeight(catalog, s);
  return w;
}

/** accepts(container, catalog, id) -> true when the item's tags allow it in this container. */
export function accepts(container, catalog, id) {
  if (!container.accepts) return true;
  return catalog.get(id).tags.some((t) => container.accepts.includes(t));
}

function weightUnits(container, catalog, id, weightRoom) {
  const w = catalog.get(id).weight;
  if (w <= 0) return Infinity;
  let room = weightRoom ?? Infinity;
  if (container.maxWeight !== null) room = Math.min(room, container.maxWeight - containerWeight(container, catalog));
  return room === Infinity ? Infinity : Math.max(0, Math.floor(room / w + EPS));
}

/**
 * roomFor(container, catalog, id, data, weightRoom) -> how many units of the item still fit
 * (free stack space, empty slots, weight limit). weightRoom is extra weight allowed by the owner.
 */
export function roomFor(container, catalog, id, data, weightRoom) {
  checkContainerArg(container, 'roomFor');
  const def = catalog.get(id);
  if (!accepts(container, catalog, id)) return 0;
  const probe = { id, n: 1, data: checkData(data, 'roomFor') };
  let units = 0;
  for (const s of container.slots) {
    if (!s) units += def.stack;
    else if (sameItem(s, probe)) units += def.stack - s.n;
  }
  return Math.min(units, weightUnits(container, catalog, id, weightRoom));
}

/**
 * addItem(container, catalog, id, n = 1, data, options) -> { added, left }
 * Fills matching stacks first, then empty slots. Never loses items: what does
 * not fit is reported in `left`. options: { weightRoom, at } (`at` = preferred slot).
 */
export function addItem(container, catalog, id, n = 1, data, options = {}) {
  checkCount(n, 'addItem');
  const def = catalog.get(id);
  const d = checkData(data, 'addItem');
  const probe = { id, n: 1, data: d };
  let todo = Math.min(n, roomFor(container, catalog, id, d, options.weightRoom));
  const added = todo;
  const order = container.slots.map((_, i) => i);
  if (Number.isInteger(options.at) && options.at >= 0 && options.at < order.length) {
    order.splice(options.at, 1);
    order.unshift(options.at);
  }
  for (const pass of ['merge', 'empty']) {
    for (const i of order) {
      if (todo === 0) break;
      const s = container.slots[i];
      if (pass === 'merge' && s && sameItem(s, probe) && s.n < def.stack) {
        const m = Math.min(todo, def.stack - s.n);
        s.n += m;
        todo -= m;
      } else if (pass === 'empty' && !s) {
        const m = Math.min(todo, def.stack);
        container.slots[i] = d ? { id, n: m, data: clone(d) } : { id, n: m };
        todo -= m;
      }
    }
  }
  return { added, left: n - added };
}

/** countItem(container, id) -> units of the item inside (every data variant counts). */
export function countItem(container, id) {
  checkContainerArg(container, 'countItem');
  let n = 0;
  for (const s of container.slots) if (s && s.id === id) n += s.n;
  return n;
}

/** countTag(container, catalog, tag) -> units of every item carrying the tag. */
export function countTag(container, catalog, tag) {
  checkContainerArg(container, 'countTag');
  let n = 0;
  for (const s of container.slots) if (s && catalog.get(s.id).tags.includes(tag)) n += s.n;
  return n;
}

function takeWhere(container, n, match) {
  let have = 0;
  for (const s of container.slots) if (s && match(s)) have += s.n;
  if (have < n) return { ok: false, reason: 'missing', have };
  let todo = n;
  for (let i = 0; i < container.slots.length && todo > 0; i++) {
    const s = container.slots[i];
    if (!s || !match(s)) continue;
    const m = Math.min(todo, s.n);
    s.n -= m;
    todo -= m;
    if (s.n === 0) container.slots[i] = null;
  }
  return { ok: true, removed: n };
}

/** takeItem(container, id, n = 1) -> { ok, removed } or { ok: false, reason: 'missing', have }. All or nothing. */
export function takeItem(container, id, n = 1) {
  checkContainerArg(container, 'takeItem');
  checkCount(n, 'takeItem');
  return takeWhere(container, n, (s) => s.id === id);
}

/** takeTag(container, catalog, tag, n = 1) -> like takeItem, for any items carrying the tag. */
export function takeTag(container, catalog, tag, n = 1) {
  checkContainerArg(container, 'takeTag');
  checkCount(n, 'takeTag');
  return takeWhere(container, n, (s) => catalog.get(s.id).tags.includes(tag));
}

/** removeAt(container, index, n) -> the removed stack (all of it by default), or null when the slot is empty. */
export function removeAt(container, index, n) {
  checkIndex(container, index, 'removeAt');
  const s = container.slots[index];
  if (!s) return null;
  const m = n === undefined ? s.n : Math.min(checkCount(n, 'removeAt'), s.n);
  const out = { ...clone(s), n: m };
  s.n -= m;
  if (s.n === 0) container.slots[index] = null;
  return out;
}

/** firstEmpty(container) -> index of the first empty slot, or -1. */
export function firstEmpty(container) {
  checkContainerArg(container, 'firstEmpty');
  return container.slots.indexOf(null);
}

/**
 * checkContainer(raw, catalog, like) -> { container, problems }
 * Rebuilds a container from saved data. Unknown items and broken slots are
 * dropped and listed in `problems`. `like` gives size and limits when the
 * saved value has none (or is not a container at all).
 */
export function checkContainer(raw, catalog, like = {}) {
  const problems = [];
  const ok = raw && typeof raw === 'object' && Array.isArray(raw.slots);
  if (!ok) problems.push('container data missing or broken; started empty');
  const pick = (key) => (ok && own(raw, key) && raw[key] !== undefined ? raw[key] : like[key]);
  let container;
  try {
    container = createContainer({ size: ok ? raw.slots.length : like.size, columns: pick('columns'), maxWeight: pick('maxWeight'), accepts: pick('accepts') });
  } catch (err) {
    problems.push(`container settings unusable (${err.message}); used defaults`);
    container = createContainer({ size: like.size, columns: like.columns, maxWeight: like.maxWeight, accepts: like.accepts });
  }
  if (ok) {
    raw.slots.slice(0, container.size).forEach((s, i) => {
      if (s === null || s === undefined) return;
      const stack = checkStack(catalog, s);
      if (stack) {
        container.slots[i] = stack;
        if (stack.n !== s.n) problems.push(`slot ${i}: ${stack.id} x${s.n} is over the stack limit; cut to ${stack.n}`);
      } else problems.push(`slot ${i}: dropped unusable item ${JSON.stringify(s && s.id)}`);
    });
  }
  return { container, problems };
}
