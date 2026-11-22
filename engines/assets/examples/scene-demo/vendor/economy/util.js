// Small helpers shared by the economy files: refusals, checks, copies, the seeded random number.

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

/** fail(reason, extra) -> { ok: false, reason, ...extra }: a refusal the game can show. */
export const fail = (reason, extra) => ({ ok: false, reason, ...extra });

/** isId(value) -> true for a usable id: letters, digits, _ . : - and not starting with a symbol. */
export function isId(value) {
  return typeof value === 'string' && ID.test(value) && value !== '__proto__';
}

/** own(object, key) -> true when the object has the key itself. */
export function own(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

/** clone(value) -> a deep copy of plain JSON data. */
export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** canonical(value) -> JSON text with sorted keys, so equal data gives equal text. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** sameItem(a, b) -> true when two stacks hold the same item with the same data. */
export function sameItem(a, b) {
  return !!a && !!b && a.id === b.id && canonical(a.data) === canonical(b.data);
}

/** checkInt(value, min, what) -> value, or throws unless it is an integer >= min. */
export function checkInt(value, min, what) {
  if (!Number.isInteger(value) || value < min) throw new Error(`${what} must be an integer >= ${min}, got ${String(value)}`);
  return value;
}

/** checkNum(value, min, what) -> value, or throws unless it is a finite number >= min. */
export function checkNum(value, min, what) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new Error(`${what} must be a number >= ${min}, got ${String(value)}`);
  return value;
}

/** checkCatalog(catalog, fn) -> catalog, or throws unless it looks like the inventory engine's catalog. */
export function checkCatalog(catalog, fn) {
  if (!catalog || typeof catalog.get !== 'function' || typeof catalog.has !== 'function') throw new Error(`${fn}: options.catalog is required (from the inventory engine's createCatalog)`);
  return catalog;
}

/** unitValue(catalog, stack) -> value of one unit in the main currency (a rolled rarity scales it). */
export function unitValue(catalog, stack) {
  const def = catalog.get(stack.id);
  const rolled = stack.data && stack.data.rarity;
  let scale = 1;
  if (typeof rolled === 'string' && own(catalog.rarities, rolled)) scale = catalog.rarities[rolled].scale;
  return Math.round(def.value * scale);
}

/** hashSeed(seed) -> a 32-bit integer from a number or a string. */
export function hashSeed(seed) {
  if (Number.isInteger(seed)) return seed | 0;
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h | 0;
}

/**
 * nextRandom(holder) -> float in [0, 1). The generator's whole state is the integer `holder.rng`,
 * so it is saved with the game and the same save always gives the same next number.
 */
export function nextRandom(holder) {
  holder.rng = (holder.rng + 0x6D2B79F5) | 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** hourOfDay(hours) -> 0 <= hour < 24 from a count of game hours. */
export function hourOfDay(hours) {
  return ((hours % 24) + 24) % 24;
}

/** inHours(hour, [open, close]) -> true when the hour is inside; a range like [20, 4] runs over midnight. */
export function inHours(hour, range) {
  if (!range) return true;
  const [a, b] = range;
  return a <= b ? hour >= a && hour < b : hour >= a || hour < b;
}
