// The catalog: every kind of item a game has, checked once at start-up.
// Item definitions live here. Inventory state only holds ids and counts.

/** Built-in rarities. `scale` multiplies the stats and value of an item rolled at that rarity. */
export const RARITIES = {
  common: { order: 0, label: 'Common', color: '#b8c0cc', scale: 1 },
  uncommon: { order: 1, label: 'Uncommon', color: '#5fd38d', scale: 1.15 },
  rare: { order: 2, label: 'Rare', color: '#4da3ff', scale: 1.35 },
  epic: { order: 3, label: 'Epic', color: '#b97aff', scale: 1.6 },
  legendary: { order: 4, label: 'Legendary', color: '#ffb347', scale: 2 },
};

/** Default equipment slots of an inventory, in display order. */
export const EQUIP_SLOTS = ['mainHand', 'offHand', 'head', 'body', 'back'];

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const KNOWN = ['id', 'name', 'description', 'stack', 'weight', 'value', 'rarity', 'tags', 'stats',
  'equip', 'twoHanded', 'blocks', 'puppet', 'puppetSlot', 'puppetColors', 'use', 'consume', 'icon', 'color'];

/** isId(value) -> true for a usable id: letters, digits, _ . : - and not starting with a symbol. */
export function isId(value) {
  return typeof value === 'string' && ID.test(value) && value !== '__proto__';
}

/** own(object, key) -> true when the object has the key itself (never from the prototype). */
export function own(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * createCatalog(items, options) -> catalog
 *   items: array of item definitions, or an object { id: definition }.
 *     { id, name, description, stack = 1, weight = 0, value = 0, rarity = 'common',
 *       tags = [], stats = {}, equip, twoHanded, blocks, puppet, puppetSlot,
 *       puppetColors, use, consume = true, icon, color }
 *     stack: most units in one slot.   value: price in coins.
 *     equip: equipment slot name, or a list of slots the item may go in.
 *     twoHanded: true also empties 'offHand'. blocks: list of slots it empties.
 *     puppet: name of a puppet ITEMS entry ('sword') or a full puppet item object.
 *     use: any JSON value handed back by inventory.use() (for example { heal: 5 }).
 *   options.rarities: extra or replaced rarities { name: { order, label, color, scale } }.
 * catalog: get(id) (throws on unknown), has(id), ids(), all(), rarity(name), rarities.
 */
export function createCatalog(items, options = {}) {
  const rarities = { ...RARITIES, ...(options.rarities || {}) };
  for (const [name, r] of Object.entries(rarities)) {
    if (!r || !Number.isFinite(r.order) || !(r.scale > 0) || typeof r.color !== 'string') {
      throw new Error(`createCatalog: rarity "${name}" needs { order, color, scale > 0 }`);
    }
  }
  const list = Array.isArray(items)
    ? items
    : (items && typeof items === 'object' ? Object.entries(items).map(([id, d]) => ({ id, ...d })) : null);
  if (!list || list.length === 0) throw new Error('createCatalog: items must be a non-empty array or object of item definitions');
  const defs = new Map();
  list.forEach((raw, i) => {
    const def = checkDef(raw, i, rarities);
    if (defs.has(def.id)) throw new Error(`createCatalog: two items share the id "${def.id}"`);
    defs.set(def.id, Object.freeze(def));
  });

  const catalog = {
    rarities,
    /** get(id) -> the item definition. Throws when the id is unknown. */
    get(id) {
      const def = defs.get(id);
      if (!def) throw new Error(`catalog.get: unknown item "${String(id)}"`);
      return def;
    },
    has: (id) => typeof id === 'string' && defs.has(id),
    ids: () => [...defs.keys()],
    all: () => [...defs.values()],
    /** rarity(name) -> { order, label, color, scale }. Throws when unknown. */
    rarity(name) {
      if (!own(rarities, name)) throw new Error(`catalog.rarity: unknown rarity "${String(name)}". Use one of: ${Object.keys(rarities).join(', ')}`);
      return rarities[name];
    },
  };
  return catalog;
}

function checkDef(raw, index, rarities) {
  if (!raw || typeof raw !== 'object') throw new Error(`createCatalog: item ${index} must be an object, got ${String(raw)}`);
  if (!isId(raw.id)) throw new Error(`createCatalog: item ${index} needs an "id" of letters, digits, _ . : or -, got ${JSON.stringify(raw.id)}`);
  const where = `createCatalog: item "${raw.id}"`;
  for (const key of Object.keys(raw)) {
    if (!KNOWN.includes(key)) throw new Error(`${where}: unknown field "${key}". Fields: ${KNOWN.join(', ')}`);
  }
  const def = {
    name: raw.id, description: '', stack: 1, weight: 0, value: 0, rarity: 'common',
    consume: true, ...raw,
  };
  if (typeof def.name !== 'string' || !def.name) throw new Error(`${where}: "name" must be a non-empty string`);
  if (!Number.isInteger(def.stack) || def.stack < 1) throw new Error(`${where}: "stack" must be an integer >= 1, got ${def.stack}`);
  if (!(def.weight >= 0) || !Number.isFinite(def.weight)) throw new Error(`${where}: "weight" must be a number >= 0, got ${def.weight}`);
  if (!(def.value >= 0) || !Number.isFinite(def.value)) throw new Error(`${where}: "value" must be a number >= 0, got ${def.value}`);
  if (!own(rarities, def.rarity)) throw new Error(`${where}: unknown rarity "${def.rarity}". Use one of: ${Object.keys(rarities).join(', ')}`);
  def.tags = Object.freeze(strings(def.tags ?? [], `${where}: "tags"`));
  def.stats = Object.freeze({ ...(def.stats ?? {}) });
  for (const [k, v] of Object.entries(def.stats)) {
    if (!Number.isFinite(v)) throw new Error(`${where}: stat "${k}" must be a number, got ${v}`);
  }
  def.equip = def.equip === undefined || def.equip === null
    ? null
    : Object.freeze(strings(Array.isArray(def.equip) ? def.equip : [def.equip], `${where}: "equip"`));
  if (def.equip && def.equip.length === 0) throw new Error(`${where}: "equip" must name at least one slot`);
  if (def.equip && def.stack !== 1) throw new Error(`${where}: an item that can be equipped must have stack 1`);
  def.blocks = Object.freeze([...strings(def.blocks ?? [], `${where}: "blocks"`), ...(def.twoHanded ? ['offHand'] : [])]);
  if (def.puppet !== undefined && typeof def.puppet !== 'string'
    && !(def.puppet && typeof def.puppet === 'object' && Array.isArray(def.puppet.parts))) {
    throw new Error(`${where}: "puppet" must be a puppet ITEMS name or an item object with "parts"`);
  }
  if (def.puppet !== undefined && !def.equip) throw new Error(`${where}: "puppet" needs "equip" too`);
  return def;
}

function strings(value, what) {
  if (!Array.isArray(value) || value.some((s) => typeof s !== 'string' || !s)) {
    throw new Error(`${what} must be a list of non-empty strings`);
  }
  return [...value];
}
