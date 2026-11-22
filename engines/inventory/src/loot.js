// Loot tables: weighted, nestable, and repeatable from a seed.
//
//   tables = {
//     goblin: {
//       rolls: [1, 2],                              // how many picks (number or [min, max])
//       entries: [                                  // one is picked per roll, by weight
//         { item: 'coin-pouch', weight: 4 },
//         { item: 'arrow', n: [3, 8], weight: 3 },  // n: number or [min, max]
//         { item: 'sword', weight: 1, rarity: { common: 70, rare: 25, epic: 5 } },
//         { table: 'gems', weight: 1 },             // roll another table
//         { coins: [2, 12], weight: 3 },
//         { nothing: true, weight: 5 },
//       ],
//       always: [{ item: 'bone' }, { item: 'key', chance: 0.1 }],  // every time (chance optional)
//     },
//   }

import { own } from './catalog.js';
import { sameItem, checkData } from './stack.js';
import { randomInt, range } from './rng.js';
import { addItem } from './container.js';

const MAX_DEPTH = 8;

/**
 * createLoot({ catalog, tables }) -> loot
 *   loot.roll(tableId, rng, { luck = 0 }) -> { items: [{ id, n, data? }], coins }
 *     rng: function returning a float in [0, 1) (core createRng, net ctx.rng, seededRng).
 *     luck >= 0 makes "nothing" rarer and rolled rarities better.
 *   loot.fill(container, tableId, rng, options) -> { items, coins, left }  (puts the items in a chest)
 *   loot.has(id), loot.ids()
 * Tables are checked when created: unknown items, tables that loop, bad numbers all throw.
 */
export function createLoot(options = {}) {
  const { catalog, tables } = options;
  if (!catalog || typeof catalog.get !== 'function') throw new Error('createLoot: options.catalog is required');
  if (!tables || typeof tables !== 'object' || Object.keys(tables).length === 0) throw new Error('createLoot: options.tables must be an object of loot tables');
  const built = {};
  for (const [id, raw] of Object.entries(tables)) built[id] = checkTable(id, raw);
  for (const id of Object.keys(built)) checkLinks(id, [id]);

  function checkTable(id, raw) {
    const where = `createLoot: table "${id}"`;
    if (!raw || typeof raw !== 'object') throw new Error(`${where} must be an object`);
    const entries = (raw.entries ?? []).map((e, i) => checkEntry(e, `${where} entries[${i}]`, true));
    const always = (raw.always ?? []).map((e, i) => checkEntry(e, `${where} always[${i}]`, false));
    if (entries.length === 0 && always.length === 0) throw new Error(`${where} needs "entries" or "always"`);
    const rolls = range(raw.rolls ?? (entries.length ? 1 : 0), `${where} rolls`);
    if (rolls[1] > 0 && entries.length === 0) throw new Error(`${where} has rolls but no entries`);
    return { rolls, entries, always };
  }

  function checkEntry(raw, where, weighted) {
    if (!raw || typeof raw !== 'object') throw new Error(`${where} must be an object`);
    const kinds = ['item', 'table', 'coins', 'nothing'].filter((k) => raw[k] !== undefined);
    if (kinds.length !== 1) throw new Error(`${where} needs exactly one of: item, table, coins, nothing`);
    const e = { kind: kinds[0], weight: raw.weight ?? 1, chance: raw.chance };
    if (weighted && !(e.weight > 0 && Number.isFinite(e.weight))) throw new Error(`${where}: weight must be a number > 0, got ${raw.weight}`);
    if (e.chance !== undefined && !(e.chance >= 0 && e.chance <= 1)) throw new Error(`${where}: chance must be from 0 to 1, got ${raw.chance}`);
    if (e.kind === 'item') {
      e.item = catalog.get(raw.item).id;
      e.n = range(raw.n ?? 1, `${where} n`);
      e.data = checkData(raw.data, where);
      if (raw.rarity !== undefined) {
        const spec = typeof raw.rarity === 'string' ? { [raw.rarity]: 1 } : raw.rarity;
        if (!spec || typeof spec !== 'object' || Object.keys(spec).length === 0) throw new Error(`${where}: rarity must be a name or { name: weight }`);
        e.rarity = Object.entries(spec).map(([name, w]) => {
          if (!(w > 0 && Number.isFinite(w))) throw new Error(`${where}: rarity weight for "${name}" must be > 0`);
          return { name, weight: w, order: catalog.rarity(name).order };
        });
      }
    } else if (e.kind === 'table') {
      if (typeof raw.table !== 'string' || !own(tables, raw.table)) throw new Error(`${where}: unknown table "${String(raw.table)}"`);
      e.table = raw.table;
    } else if (e.kind === 'coins') {
      e.coins = range(raw.coins, `${where} coins`);
    }
    return e;
  }

  function checkLinks(id, path) {
    if (path.length > MAX_DEPTH) throw new Error(`createLoot: tables nest deeper than ${MAX_DEPTH}: ${path.join(' -> ')}`);
    for (const e of [...built[id].entries, ...built[id].always]) {
      if (e.kind !== 'table') continue;
      if (path.includes(e.table)) throw new Error(`createLoot: tables loop: ${[...path, e.table].join(' -> ')}`);
      checkLinks(e.table, [...path, e.table]);
    }
  }

  function pick(list, weightOf, rng) {
    let total = 0;
    for (const x of list) total += weightOf(x);
    let r = rng() * total;
    for (const x of list) {
      r -= weightOf(x);
      if (r < 0) return x;
    }
    return list[list.length - 1];
  }

  function grant(e, rng, luck, out) {
    if (e.kind === 'table') return rollInto(e.table, rng, luck, out);
    if (e.kind === 'coins') { out.coins += randomInt(rng, e.coins[0], e.coins[1]); return undefined; }
    if (e.kind === 'nothing') return undefined;
    const n = randomInt(rng, e.n[0], e.n[1]);
    let data = e.data ? { ...e.data } : undefined;
    if (e.rarity) {
      const r = pick(e.rarity, (x) => x.weight * (1 + luck * x.order), rng);
      if (r.name !== catalog.get(e.item).rarity) data = { ...(data || {}), rarity: r.name };
    }
    if (n === 0) return undefined;
    const stack = data ? { id: e.item, n, data } : { id: e.item, n };
    const same = out.items.find((s) => sameItem(s, stack));
    if (same) same.n += n;
    else out.items.push(stack);
    return undefined;
  }

  function rollInto(id, rng, luck, out) {
    const t = built[id];
    for (const e of t.always) if (e.chance === undefined || rng() < e.chance) grant(e, rng, luck, out);
    const rolls = randomInt(rng, t.rolls[0], t.rolls[1]);
    for (let i = 0; i < rolls; i++) {
      grant(pick(t.entries, (e) => (e.kind === 'nothing' ? e.weight / (1 + luck) : e.weight), rng), rng, luck, out);
    }
  }

  const loot = {
    has: (id) => typeof id === 'string' && own(built, id),
    ids: () => Object.keys(built),
    roll(tableId, rng, o = {}) {
      if (!loot.has(tableId)) throw new Error(`loot.roll: unknown table "${String(tableId)}". Tables: ${Object.keys(built).join(', ')}`);
      if (typeof rng !== 'function') throw new Error('loot.roll: rng must be a function returning a float in [0, 1), for example seededRng(seed)');
      const luck = o.luck ?? 0;
      if (!(luck >= 0 && Number.isFinite(luck))) throw new Error(`loot.roll: luck must be a number >= 0, got ${o.luck}`);
      const out = { items: [], coins: 0 };
      rollInto(tableId, rng, luck, out);
      return out;
    },
    fill(container, tableId, rng, o = {}) {
      const result = loot.roll(tableId, rng, o);
      const left = [];
      for (const s of result.items) {
        const r = addItem(container, catalog, s.id, s.n, s.data);
        if (r.left > 0) left.push({ ...s, n: r.left });
      }
      return { ...result, left };
    },
  };
  return loot;
}
