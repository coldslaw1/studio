// A stack is one slot's content: { id, n } plus optional `data` for things that
// make one item differ from another of the same kind (rolled rarity, bonus
// stats, durability). Stacks are plain JSON.

import { own } from './catalog.js';

/** clone(value) -> a deep copy of plain JSON data. */
export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** canonical(value) -> JSON text with object keys sorted, so equal data gives equal text. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** checkCount(n, fn) -> n, or throws unless n is an integer >= 1. */
export function checkCount(n, fn) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`${fn}: count must be an integer >= 1, got ${String(n)}`);
  return n;
}

/** checkData(data, fn) -> a clean copy of the instance data (undefined when there is none). */
export function checkData(data, fn) {
  if (data === undefined || data === null) return undefined;
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`${fn}: item data must be a plain object, got ${String(data)}`);
  const copy = clone(data);
  return Object.keys(copy).length ? copy : undefined;
}

/** makeStack(catalog, id, n = 1, data) -> { id, n, data? }. Throws on an unknown item or bad count. */
export function makeStack(catalog, id, n = 1, data) {
  catalog.get(id);
  checkCount(n, 'makeStack');
  const stack = { id, n };
  const d = checkData(data, 'makeStack');
  if (d) stack.data = d;
  return stack;
}

/** sameItem(a, b) -> true when two stacks hold the same item with the same data (so they can merge). */
export function sameItem(a, b) {
  return !!a && !!b && a.id === b.id && canonical(a.data) === canonical(b.data);
}

/** stackRarity(catalog, stack) -> rarity name: the rolled one in data.rarity, else the definition's. */
export function stackRarity(catalog, stack) {
  const rolled = stack.data && stack.data.rarity;
  return typeof rolled === 'string' && own(catalog.rarities, rolled) ? rolled : catalog.get(stack.id).rarity;
}

function scaleOf(catalog, stack) {
  const rolled = stack.data && stack.data.rarity;
  return typeof rolled === 'string' && own(catalog.rarities, rolled) ? catalog.rarities[rolled].scale : 1;
}

/**
 * stackStats(catalog, stack) -> { stat: number } for ONE unit of the stack:
 * the definition's stats times the rolled rarity's scale (rounded), plus data.stats.
 */
export function stackStats(catalog, stack) {
  const scale = scaleOf(catalog, stack);
  const out = {};
  for (const [k, v] of Object.entries(catalog.get(stack.id).stats)) out[k] = scale === 1 ? v : Math.round(v * scale);
  const bonus = stack.data && stack.data.stats;
  if (bonus && typeof bonus === 'object') {
    for (const [k, v] of Object.entries(bonus)) if (Number.isFinite(v)) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** unitValue(catalog, stack) -> coin value of one unit (definition value times the rolled rarity's scale). */
export function unitValue(catalog, stack) {
  return Math.round(catalog.get(stack.id).value * scaleOf(catalog, stack));
}

/** stackWeight(catalog, stack) -> weight of the whole stack. */
export function stackWeight(catalog, stack) {
  return stack ? catalog.get(stack.id).weight * stack.n : 0;
}

/** stackLabel(catalog, stack) -> text for lists, e.g. "Health Potion x3". */
export function stackLabel(catalog, stack) {
  const name = catalog.get(stack.id).name;
  return stack.n > 1 ? `${name} x${stack.n}` : name;
}

/**
 * checkStack(catalog, raw) -> a clean stack, or null when the saved value is unusable
 * (unknown item, bad count). Counts above the item's stack size are cut down.
 */
export function checkStack(catalog, raw) {
  if (!raw || typeof raw !== 'object' || !catalog.has(raw.id)) return null;
  if (!Number.isInteger(raw.n) || raw.n < 1) return null;
  const stack = { id: raw.id, n: Math.min(raw.n, catalog.get(raw.id).stack) };
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) && Object.keys(raw.data).length) {
    stack.data = clone(raw.data);
  }
  return stack;
}
