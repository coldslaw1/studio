// Loot tables: what a defeated enemy, a chest or a quest hands out. Weighted, nestable and
// repeatable from a seed. The table shape is the inventory engine's (rolls, entries, always,
// item / table / coins / nothing, n, weight, chance, rarity), so the same tables work in both, plus:
//   { xp: [5, 10] }                 an entry can give experience
//   minLevel / maxLevel on an entry it only counts for rolls made at that level
//
//   tables = {
//     goblin: {
//       rolls: [1, 2],
//       entries: [
//         { item: 'potion', weight: 3 },
//         { item: 'sword', weight: 1, rarity: { common: 70, rare: 25, epic: 5 }, minLevel: 3 },
//         { table: 'gems', weight: 1 }, { coins: [2, 12], weight: 3 }, { nothing: true, weight: 4 },
//       ],
//       always: [{ xp: 5 }, { item: 'key', chance: 0.1 }],
//     },
//   }
import { need, own, isObject, range, randomInt, pickWeighted, names, clone } from './util.js';

const MAX_DEPTH = 8;
const KINDS = ['item', 'table', 'coins', 'xp', 'nothing'];

/**
 * createLootTables({ tables, knows }) -> loot
 *   knows(itemId) -> boolean   optional check that an item exists (pass (id) => catalog.has(id)); unknown items throw at start.
 *   loot.roll(tableId, rng, { luck = 0, level = 1 }) -> { items: [{ id, n, data? }], coins, xp }
 *     rng: function returning a float in [0, 1). luck >= 0 makes "nothing" rarer and rolled rarities better.
 *   loot.has(id), loot.ids(), loot.tables (the checked definitions)
 * Tables are checked when created: unknown tables, tables that loop and bad numbers all throw.
 */
export function createLootTables(options = {}) {
  const { tables, knows = null } = options;
  need(isObject(tables), `createLootTables: options.tables must be an object of loot tables, got ${JSON.stringify(tables)}`);
  const built = {};

  function checkEntry(raw, where, weighted) {
    need(isObject(raw), `${where} must be an object, got ${JSON.stringify(raw)}`);
    const kinds = KINDS.filter((k) => raw[k] !== undefined);
    need(kinds.length === 1, `${where} needs exactly one of: ${KINDS.join(', ')}`);
    const e = { kind: kinds[0], weight: raw.weight ?? 1, chance: raw.chance, minLevel: raw.minLevel ?? 1, maxLevel: raw.maxLevel ?? Infinity };
    need(!weighted || (e.weight > 0 && Number.isFinite(e.weight)), `${where}: weight must be a number > 0, got ${raw.weight}`);
    need(e.chance === undefined || (e.chance >= 0 && e.chance <= 1), `${where}: chance must be from 0 to 1, got ${raw.chance}`);
    need(e.minLevel <= e.maxLevel, `${where}: minLevel ${e.minLevel} is above maxLevel ${e.maxLevel}`);
    if (e.kind === 'item') {
      need(typeof raw.item === 'string' && raw.item, `${where}: item must be an item id`);
      need(!knows || knows(raw.item), `${where}: unknown item "${raw.item}"`);
      e.item = raw.item; e.n = range(raw.n ?? 1, `${where} n`);
      e.data = raw.data === undefined ? undefined : clone(raw.data);
      if (raw.rarity !== undefined) {
        const spec = typeof raw.rarity === 'string' ? { [raw.rarity]: 1 } : raw.rarity;
        need(isObject(spec) && Object.keys(spec).length > 0, `${where}: rarity must be a name or { name: weight }`);
        e.rarity = Object.entries(spec).map(([name, w], order) => { need(w > 0 && Number.isFinite(w), `${where}: rarity weight for "${name}" must be > 0`); return { name, weight: w, order }; });
      }
    } else if (e.kind === 'table') {
      need(typeof raw.table === 'string' && own(tables, raw.table), `${where}: unknown table "${String(raw.table)}" (tables: ${names(tables)})`);
      e.table = raw.table;
    } else if (e.kind === 'coins' || e.kind === 'xp') e[e.kind] = range(raw[e.kind], `${where} ${e.kind}`);
    return e;
  }
  for (const [id, raw] of Object.entries(tables)) {
    const where = `createLootTables: table "${id}"`;
    need(isObject(raw), `${where} must be an object`);
    const entries = (raw.entries ?? []).map((e, i) => checkEntry(e, `${where} entries[${i}]`, true));
    const always = (raw.always ?? []).map((e, i) => checkEntry(e, `${where} always[${i}]`, false));
    need(entries.length + always.length > 0, `${where} needs "entries" or "always"`);
    const rolls = range(raw.rolls ?? (entries.length ? 1 : 0), `${where} rolls`);
    need(!(rolls[1] > 0 && entries.length === 0), `${where} has rolls but no entries`);
    built[id] = { rolls, entries, always };
  }
  const checkLinks = (id, path) => {
    need(path.length <= MAX_DEPTH, `createLootTables: tables nest deeper than ${MAX_DEPTH}: ${path.join(' -> ')}`);
    for (const e of [...built[id].entries, ...built[id].always]) {
      if (e.kind !== 'table') continue;
      need(!path.includes(e.table), `createLootTables: tables loop: ${[...path, e.table].join(' -> ')}`);
      checkLinks(e.table, [...path, e.table]);
    }
  };
  for (const id of Object.keys(built)) checkLinks(id, [id]);

  function grant(e, rng, ctx, out) {
    if (e.kind === 'table') { rollInto(e.table, rng, ctx, out); return; }
    if (e.kind === 'coins') { out.coins += randomInt(rng, e.coins[0], e.coins[1]); return; }
    if (e.kind === 'xp') { out.xp += randomInt(rng, e.xp[0], e.xp[1]); return; }
    if (e.kind === 'nothing') return;
    const n = randomInt(rng, e.n[0], e.n[1]);
    let data = e.data ? clone(e.data) : undefined;
    if (e.rarity) data = { ...(data ?? {}), rarity: pickWeighted(e.rarity, (x) => x.weight * (1 + ctx.luck * x.order), rng).name };
    if (n === 0) return;
    const same = out.items.find((s) => s.id === e.item && JSON.stringify(s.data) === JSON.stringify(data));
    if (same) same.n += n; else out.items.push(data ? { id: e.item, n, data } : { id: e.item, n });
  }
  function rollInto(id, rng, ctx, out) {
    const t = built[id];
    const fits = (e) => ctx.level >= e.minLevel && ctx.level <= e.maxLevel;
    for (const e of t.always) if (fits(e) && (e.chance === undefined || rng() < e.chance)) grant(e, rng, ctx, out);
    const pool = t.entries.filter(fits);
    if (pool.length === 0) return;
    const rolls = randomInt(rng, t.rolls[0], t.rolls[1]);
    for (let i = 0; i < rolls; i += 1) grant(pickWeighted(pool, (e) => (e.kind === 'nothing' ? e.weight / (1 + ctx.luck) : e.weight), rng), rng, ctx, out);
  }

  return {
    tables: built,
    has: (id) => own(built, id),
    ids: () => Object.keys(built),
    roll(tableId, rng, o = {}) {
      need(own(built, tableId), `loot.roll: no loot table "${String(tableId)}" (tables: ${names(built)})`);
      need(typeof rng === 'function', 'loot.roll: pass rng, a function returning a float in [0, 1) (core createRng(seed))');
      const luck = o.luck ?? 0; const level = o.level ?? 1;
      need(Number.isFinite(luck) && luck >= 0, `loot.roll: luck must be a number >= 0, got ${o.luck}`);
      const out = { items: [], coins: 0, xp: 0 };
      rollInto(tableId, rng, { luck, level }, out);
      return out;
    },
  };
}
