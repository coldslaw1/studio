// Crafting: recipes turn inputs into outputs, all or nothing.
//
//   recipes = [{
//     id: 'iron-sword', name: 'Iron Sword',
//     inputs: [{ item: 'iron', n: 3 }, { tag: 'wood', n: 1 }],   // used up
//     tools: ['hammer'],                                          // needed, not used up
//     outputs: [{ item: 'sword', n: 1 }],
//     station: 'forge',                                           // optional: where it can be made
//     coins: 5,                                                   // optional: fee
//   }]

import { isId } from './catalog.js';
import { checkCount, checkData } from './stack.js';
import { countItem, countTag, takeItem, takeTag } from './container.js';

const fail = (reason, extra) => ({ ok: false, reason, ...extra });

/**
 * createCrafting({ catalog, recipes }) -> crafting
 *   crafting.get(id)                         the recipe (throws on unknown)
 *   crafting.has(id), crafting.ids(), crafting.all()
 *   crafting.check(inventory, id, { station, times = 1 })
 *       -> { ok: true } or { ok: false, reason, missing: [{ item | tag | tool | coins, need, have }] }
 *       reasons: 'station' 'missing'
 *   crafting.craft(inventory, id, { station, times = 1 })
 *       -> { ok: true, outputs: [{ id, n }] } or { ok: false, reason } (also 'full' / 'too-heavy'); nothing changes on failure
 *   crafting.list(inventory, { station })    every recipe for this station with its check result
 * Inputs are taken from the inventory's own bags (not from equipment).
 */
export function createCrafting(options = {}) {
  const { catalog, recipes } = options;
  if (!catalog || typeof catalog.get !== 'function') throw new Error('createCrafting: options.catalog is required');
  if (!Array.isArray(recipes) || recipes.length === 0) throw new Error('createCrafting: options.recipes must be a non-empty array');
  const byId = new Map();
  recipes.forEach((raw, i) => {
    const r = checkRecipe(raw, i);
    if (byId.has(r.id)) throw new Error(`createCrafting: two recipes share the id "${r.id}"`);
    byId.set(r.id, Object.freeze(r));
  });

  function checkRecipe(raw, index) {
    if (!raw || typeof raw !== 'object' || !isId(raw.id)) throw new Error(`createCrafting: recipe ${index} needs an "id"`);
    const where = `createCrafting: recipe "${raw.id}"`;
    if (!Array.isArray(raw.outputs) || raw.outputs.length === 0) throw new Error(`${where} needs "outputs"`);
    const outputs = raw.outputs.map((o) => {
      if (!o || typeof o !== 'object') throw new Error(`${where}: each output must be { item, n }`);
      return { item: catalog.get(o.item).id, n: checkCount(o.n ?? 1, where), data: checkData(o.data, where) };
    });
    const inputs = (raw.inputs ?? []).map((o) => {
      if (!o || typeof o !== 'object' || (o.item === undefined) === (o.tag === undefined)) throw new Error(`${where}: each input needs "item" or "tag"`);
      const n = checkCount(o.n ?? 1, where);
      if (o.tag !== undefined) {
        if (typeof o.tag !== 'string' || !o.tag) throw new Error(`${where}: bad tag ${JSON.stringify(o.tag)}`);
        return { tag: o.tag, n };
      }
      return { item: catalog.get(o.item).id, n };
    });
    const tools = (raw.tools ?? []).map((t) => catalog.get(t).id);
    const coins = raw.coins ?? 0;
    if (!Number.isInteger(coins) || coins < 0) throw new Error(`${where}: coins must be an integer >= 0`);
    if (raw.station !== undefined && (typeof raw.station !== 'string' || !raw.station)) throw new Error(`${where}: station must be a name`);
    const name = raw.name ?? catalog.get(outputs[0].item).name;
    return { id: raw.id, name, inputs, tools, outputs, coins, station: raw.station ?? null };
  }

  const bagsOf = (inv) => Object.values(inv.state.bags);
  const times = (o) => checkCount(o.times ?? 1, 'crafting');

  const crafting = {
    has: (id) => typeof id === 'string' && byId.has(id),
    ids: () => [...byId.keys()],
    all: () => [...byId.values()],
    get(id) {
      const r = byId.get(id);
      if (!r) throw new Error(`crafting.get: unknown recipe "${String(id)}"`);
      return r;
    },
    check(inv, id, o = {}) {
      const r = crafting.get(id);
      const k = times(o);
      if (r.station && o.station !== r.station) return fail('station', { station: r.station, missing: [] });
      const bags = bagsOf(inv);
      const missing = [];
      for (const input of r.inputs) {
        const have = bags.reduce((sum, b) => sum + (input.tag ? countTag(b, catalog, input.tag) : countItem(b, input.item)), 0);
        if (have < input.n * k) missing.push({ ...(input.tag ? { tag: input.tag } : { item: input.item }), need: input.n * k, have });
      }
      for (const tool of r.tools) {
        const equipped = Object.values(inv.state.equip).some((s) => s && s.id === tool);
        if (!equipped && !inv.has(tool)) missing.push({ tool, need: 1, have: 0 });
      }
      if (inv.coins < r.coins * k) missing.push({ coins: true, need: r.coins * k, have: inv.coins });
      return missing.length ? fail('missing', { missing }) : { ok: true };
    },
    craft(inv, id, o = {}) {
      const r = crafting.get(id);
      const k = times(o);
      const ready = crafting.check(inv, id, o);
      if (!ready.ok) return ready;
      return inv.transaction(() => {
        for (const input of r.inputs) {
          let todo = input.n * k;
          for (const b of bagsOf(inv)) {
            const have = input.tag ? countTag(b, catalog, input.tag) : countItem(b, input.item);
            const m = Math.min(todo, have);
            if (m > 0) { if (input.tag) takeTag(b, catalog, input.tag, m); else takeItem(b, input.item, m); }
            todo -= m;
          }
        }
        inv.state.coins -= r.coins * k;
        const outputs = [];
        for (const out of r.outputs) {
          const res = inv.add(out.item, out.n * k, { data: out.data });
          // A free slot that still could not take it means weight was the limit.
          if (res.left > 0) return fail(bagsOf(inv).some((b) => b.slots.includes(null)) ? 'too-heavy' : 'full');
          outputs.push({ id: out.item, n: out.n * k });
        }
        return { ok: true, recipe: r.id, outputs };
      });
    },
    list(inv, o = {}) {
      return crafting.all()
        .filter((r) => !r.station || r.station === o.station)
        .map((r) => ({ id: r.id, name: r.name, recipe: r, ...crafting.check(inv, r.id, o) }));
    },
  };
  return crafting;
}
