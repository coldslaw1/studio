// Crafting at stations. A recipe with no `time` is made at once, straight into the bag. A recipe
// with a `time` becomes a job in the station's queue: the inputs are taken now, the game clock
// does the work, and the finished things wait in the station's tray until the player collects
// them. Nothing is ever lost: a cancelled job gives its inputs back, and what does not fit in the
// bag stays in the tray.

import { fail, checkInt, sameItem, clone, isId, nextRandom } from './util.js';
import { HANDS } from './recipes.js';

/**
 * createCrafting(ctx) -> the crafting half of the economy (see createEconomy for the public calls).
 * ctx: { catalog, recipes (Map), stations (Map), state, wallet, inventory(), emit }
 */
export function createCrafting(ctx) {
  const { catalog, recipes, stations, state, wallet, emit } = ctx;

  const recipe = (id, fn) => {
    const r = recipes.get(id);
    if (!r) throw new Error(`${fn}: unknown recipe "${String(id)}". Recipes: ${[...recipes.keys()].join(', ') || 'none'}`);
    return r;
  };
  const inv = (fn) => {
    const i = ctx.inventory();
    if (!i) throw new Error(`${fn}: no inventory is bound. Pass { inventory } to createEconomy or call economy.bind(inventory)`);
    return i;
  };
  /** A station by id. A name that was never declared is a plain station of that kind. */
  const stationDef = (name) => {
    const id = name ?? HANDS;
    if (stations.has(id)) return stations.get(id);
    return isId(id) ? { id, kind: id, name: id, queue: 4, speed: 1 } : null;
  };
  const stationState = (id) => (state.stations[id] ??= { jobs: [], tray: [] });
  const known = (r) => !r.locked || state.known.includes(r.id);
  const ownBags = (bag) => Object.keys(bag.state.bags);
  const withTag = (bag, tag) => {
    const found = new Map();
    for (const name of ownBags(bag)) for (const e of bag.list(name)) if (e.def.tags.includes(tag)) found.set(e.id, (found.get(e.id) ?? 0) + e.n);
    return found;
  };
  const countTag = (bag, tag) => [...withTag(bag, tag).values()].reduce((a, b) => a + b, 0);
  const hasTool = (bag, tool) => bag.has(tool) || Object.values(bag.equipment()).some((s) => s && s.id === tool);
  const freeSlot = (bag) => Object.values(bag.state.bags).some((b) => b.slots.includes(null));
  const merge = (list, stack) => {
    const same = list.find((s) => sameItem(s, stack));
    if (same) same.n += stack.n; else list.push(stack);
  };
  /** Roll what `times` units of a recipe give (outputs with a `chance` may be missing). */
  const roll = (r, times) => {
    const out = [];
    for (let u = 0; u < times; u++) {
      for (const o of r.outputs) {
        if (o.chance < 1 && nextRandom(state) >= o.chance) continue;
        merge(out, { id: o.item, n: o.n, ...(o.data ? { data: clone(o.data) } : {}) });
      }
    }
    return out;
  };
  /** Take one unit's inputs out of the bag; returns what was used, for a refund. */
  const takeInputs = (bag, r) => {
    const used = [];
    for (const input of r.inputs) {
      if (input.item) { bag.remove(input.item, input.n); merge(used, { id: input.item, n: input.n }); continue; }
      let todo = input.n;
      for (const [id, have] of withTag(bag, input.tag)) {
        const m = Math.min(todo, have);
        if (m > 0) { bag.remove(id, m); merge(used, { id, n: m }); todo -= m; }
      }
    }
    return used;
  };

  const crafting = {
    recipe: (id) => recipe(id, 'economy.recipe'),
    hasRecipe: (id) => typeof id === 'string' && recipes.has(id),
    recipeIds: () => [...recipes.keys()],
    knows: (id) => known(recipe(id, 'economy.knows')),
    learn(id) {
      const r = recipe(id, 'economy.learn');
      if (known(r)) return false;
      state.known.push(r.id);
      emit('learned', { recipe: r.id });
      return true;
    },
    stationIds: () => [...new Set([...stations.keys(), ...Object.keys(state.stations)])],
    station(name) {
      const d = stationDef(name);
      if (!d) throw new Error(`economy.station: bad station name ${JSON.stringify(name)}`);
      const s = state.stations[d.id] ?? { jobs: [], tray: [] };
      let ahead = 0;
      const jobs = s.jobs.map((job, index) => {
        const r = recipes.get(job.recipe);
        const left = (r.time * job.left - job.progress) / d.speed;
        ahead += left;
        return { index, recipe: r.id, name: r.name, left: job.left, progress: r.time > 0 ? job.progress / r.time : 1, eta: ahead };
      });
      return { ...d, jobs, tray: clone(s.tray), busy: s.jobs.length >= d.queue, ready: s.tray.length > 0 };
    },
    check(id, o = {}) {
      const r = recipe(id, 'economy.canCraft');
      const times = checkInt(o.times ?? 1, 1, 'economy.canCraft: times');
      const bag = inv('economy.canCraft');
      const d = stationDef(o.station);
      if (!known(r)) return fail('locked', { missing: [] });
      if (!d || (r.station && d.kind !== r.station)) return fail('station', { station: r.station, missing: [] });
      if (r.time > 0 && (state.stations[d.id]?.jobs.length ?? 0) >= d.queue) return fail('busy', { missing: [] });
      const missing = [];
      for (const input of r.inputs) {
        const have = input.tag ? countTag(bag, input.tag) : bag.count(input.item);
        if (have < input.n * times) missing.push({ ...(input.tag ? { tag: input.tag } : { item: input.item }), need: input.n * times, have });
      }
      for (const tool of r.tools) if (!hasTool(bag, tool)) missing.push({ tool, need: 1, have: 0 });
      const have = wallet.balance(r.currency);
      if (have < r.coins * times) missing.push({ coins: true, currency: r.currency, need: r.coins * times, have });
      return missing.length ? fail('missing', { missing }) : { ok: true };
    },
    craft(id, o = {}) {
      const r = recipe(id, 'economy.craft');
      const times = checkInt(o.times ?? 1, 1, 'economy.craft: times');
      const ready = crafting.check(id, o);
      if (!ready.ok) return ready;
      const bag = inv('economy.craft');
      const d = stationDef(o.station);
      const main = r.currency === wallet.primary;
      const fee = r.coins * times;
      const rngBefore = state.rng;
      const units = [];
      let outputs = [];
      const done = bag.transaction(() => {
        for (let u = 0; u < times; u++) units.push(takeInputs(bag, r));
        if (main && fee > 0) { const paid = wallet.spend(r.currency, fee); if (!paid.ok) return paid; }
        if (r.time > 0) return { ok: true };
        outputs = roll(r, times);
        for (const stack of outputs) if (bag.give(stack).left > 0) return fail(freeSlot(bag) ? 'too-heavy' : 'full');
        return { ok: true };
      });
      if (!done.ok) { state.rng = rngBefore; return done; }
      if (!main && fee > 0) wallet.spend(r.currency, fee);
      if (r.time === 0) {
        emit('craftDone', { station: d.id, recipe: r.id, outputs: clone(outputs), instant: true });
        return { ok: true, recipe: r.id, station: d.id, outputs };
      }
      stationState(d.id).jobs.push({ recipe: r.id, left: times, progress: 0, units });
      const eta = crafting.station(d.id).jobs.at(-1).eta;
      emit('craftStarted', { station: d.id, recipe: r.id, times, eta });
      return { ok: true, recipe: r.id, station: d.id, queued: true, eta, outputs: [] };
    },
    collect(name) {
      const d = stationDef(name);
      const s = d && state.stations[d.id];
      if (!s || s.tray.length === 0) return fail('empty');
      const bag = inv('economy.collect');
      const items = [];
      s.tray = s.tray.filter((stack) => {
        const r = bag.give(clone(stack));
        if (r.added > 0) items.push({ id: stack.id, n: r.added });
        stack.n = r.left;
        return r.left > 0;
      });
      if (items.length === 0) return fail('full');
      const left = s.tray.reduce((sum, t) => sum + t.n, 0);
      emit('collected', { station: d.id, items: clone(items), left });
      return { ok: true, station: d.id, items, left };
    },
    cancel(name, index) {
      const d = stationDef(name);
      const s = d && state.stations[d.id];
      const at = index ?? (s ? s.jobs.length - 1 : -1);
      if (!s || !Number.isInteger(at) || at < 0 || at >= s.jobs.length) return fail('empty');
      const [job] = s.jobs.splice(at, 1);
      const r = recipes.get(job.recipe);
      const bag = inv('economy.cancel');
      const refunded = [];
      for (const unit of job.units) for (const stack of unit) merge(refunded, clone(stack));
      for (const stack of refunded) {
        const left = bag.give(clone(stack)).left;
        if (left > 0) merge(s.tray, { ...clone(stack), n: left }); // no room: it waits in the tray
      }
      const coins = r.coins * job.left;
      if (coins > 0) wallet.earn(r.currency, coins);
      emit('craftCancelled', { station: d.id, recipe: r.id, refunded: clone(refunded), coins });
      return { ok: true, station: d.id, recipe: r.id, refunded, coins, currency: r.currency };
    },
    /** Every recipe the player knows that this station can make, with whether it can be made now. */
    list(o = {}) {
      const d = stationDef(o.station);
      return [...recipes.values()]
        .filter((r) => known(r) && d && (!r.station || r.station === d.kind))
        .map((r) => ({ id: r.id, name: r.name, recipe: r, time: r.time / d.speed, ...crafting.check(r.id, o) }));
    },
    /** Called after the clock moved by `hours`: stations work through their queues. */
    update(hours) {
      for (const [id, s] of Object.entries(state.stations)) {
        const d = stationDef(id);
        let budget = hours * d.speed;
        while (s.jobs.length > 0 && budget > 0) {
          const job = s.jobs[0];
          const r = recipes.get(job.recipe);
          const need = r.time - job.progress;
          if (budget < need - 1e-9) { job.progress += budget; break; }
          budget -= Math.max(0, need);
          job.progress = 0;
          job.left -= 1;
          job.units.shift();
          const outputs = roll(r, 1);
          for (const stack of outputs) merge(s.tray, clone(stack));
          if (job.left === 0) s.jobs.shift();
          emit('craftDone', { station: id, recipe: r.id, outputs, instant: false });
        }
      }
    },
  };
  return crafting;
}
