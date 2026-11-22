// Recipes: what goes in, what comes out, where, for how much and how long. The format is the
// inventory engine's recipe format plus `time`, `locked`, `currency` and a `chance` on outputs:
//   { id: 'iron-sword', name: 'Iron Sword',
//     inputs: [{ item: 'iron', n: 3 }, { tag: 'wood', n: 1 }],   // used up
//     tools: ['hammer'],                                          // needed, not used up
//     outputs: [{ item: 'sword', n: 1 }, { item: 'slag', chance: 0.25 }],
//     station: 'forge',     // the KIND of station it needs; left out = anywhere, also by hand
//     time: 2,              // game hours per unit; 0 or left out = at once
//     coins: 5, currency: 'coins',   // fee per unit
//     locked: true }        // must be learned first (economy.learn)

import { isId, clone, checkInt, checkNum } from './util.js';

/** checkRecipes(catalog, recipes, wallet) -> Map(id -> frozen recipe). Throws on any mistake. */
export function checkRecipes(catalog, recipes = [], wallet) {
  if (!Array.isArray(recipes)) throw new Error('createEconomy: recipes must be an array');
  const out = new Map();
  recipes.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || !isId(raw.id)) throw new Error(`createEconomy: recipe ${index} needs an "id"`);
    const where = `createEconomy: recipe "${raw.id}"`;
    if (out.has(raw.id)) throw new Error(`createEconomy: two recipes share the id "${raw.id}"`);
    if (!Array.isArray(raw.outputs) || raw.outputs.length === 0) throw new Error(`${where} needs "outputs"`);
    const outputs = raw.outputs.map((o) => {
      if (!o || typeof o !== 'object') throw new Error(`${where}: each output must be { item, n }`);
      const chance = o.chance ?? 1;
      if (!(chance > 0 && chance <= 1)) throw new Error(`${where}: output chance must be above 0 and at most 1, got ${chance}`);
      const made = { item: catalog.get(o.item).id, n: checkInt(o.n ?? 1, 1, `${where}: output n`), chance };
      if (o.data !== undefined && o.data !== null) {
        if (typeof o.data !== 'object' || Array.isArray(o.data)) throw new Error(`${where}: output data must be a plain object`);
        if (Object.keys(o.data).length) made.data = clone(o.data);
      }
      return made;
    });
    if (outputs[0].chance !== 1) throw new Error(`${where}: the first output is what the recipe makes and cannot have a chance`);
    const inputs = (raw.inputs ?? []).map((o) => {
      if (!o || typeof o !== 'object' || (o.item === undefined) === (o.tag === undefined)) throw new Error(`${where}: each input needs "item" or "tag"`);
      const n = checkInt(o.n ?? 1, 1, `${where}: input n`);
      if (o.tag !== undefined) {
        if (typeof o.tag !== 'string' || !o.tag) throw new Error(`${where}: bad tag ${JSON.stringify(o.tag)}`);
        return { tag: o.tag, n };
      }
      return { item: catalog.get(o.item).id, n };
    });
    const tools = (raw.tools ?? []).map((t) => catalog.get(t).id);
    const currency = raw.currency ?? wallet.primary;
    if (!wallet.has(currency)) throw new Error(`${where}: unknown currency "${currency}"`);
    if (raw.station !== undefined && raw.station !== null && !isId(raw.station)) throw new Error(`${where}: station must be a station kind such as 'forge', got ${JSON.stringify(raw.station)}`);
    out.set(raw.id, Object.freeze({
      id: raw.id, name: raw.name ?? catalog.get(outputs[0].item).name, inputs, tools, outputs,
      station: raw.station ?? null, coins: checkInt(raw.coins ?? 0, 0, `${where}: coins`), currency,
      time: checkNum(raw.time ?? 0, 0, `${where}: time`), locked: raw.locked === true,
    }));
  });
  return out;
}

/** The station every game has: crafting by hand, with no station at all. */
export const HANDS = 'hands';

/**
 * checkStations(stations) -> Map(id -> { id, kind, name, queue, speed })
 *   kind    which recipes it can make (recipe.station). Default: the id.
 *   queue   most jobs waiting and running. Default 4.
 *   speed   2 = twice as fast. Default 1.
 */
export function checkStations(stations = []) {
  if (!Array.isArray(stations)) throw new Error('createEconomy: stations must be an array of { id, kind, queue, speed }');
  const out = new Map([[HANDS, Object.freeze({ id: HANDS, kind: null, name: 'By hand', queue: 4, speed: 1 })]]);
  stations.forEach((raw, i) => {
    const s = typeof raw === 'string' ? { id: raw } : raw;
    if (!s || typeof s !== 'object' || !isId(s.id)) throw new Error(`createEconomy: stations[${i}] needs an "id"`);
    if (out.has(s.id)) throw new Error(`createEconomy: two stations share the id "${s.id}"`);
    const kind = s.kind ?? s.id;
    if (!isId(kind)) throw new Error(`createEconomy: station "${s.id}" kind must be a word such as 'forge', got ${JSON.stringify(kind)}`);
    const speed = s.speed ?? 1;
    if (!(speed > 0) || !Number.isFinite(speed)) throw new Error(`createEconomy: station "${s.id}" speed must be > 0, got ${speed}`);
    out.set(s.id, Object.freeze({ id: s.id, kind, name: s.name ?? s.id, queue: checkInt(s.queue ?? 4, 1, `createEconomy: station "${s.id}" queue`), speed }));
  });
  return out;
}
