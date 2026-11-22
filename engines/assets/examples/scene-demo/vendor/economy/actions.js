// How the economy plugs into the inventory engine's screens, and its own action objects.
//   - economy.handle(action, env): takes the inventory screens' 'inv.buy' and 'inv.sell' for an
//     economy shop, so opening hours, currencies, standing and market events apply.
//   - economy.crafting: an object shaped like the inventory engine's createCrafting(), so the
//     inventory's crafting menu lists the economy's recipes and queues timed jobs.
//   - 'eco.*' actions: every economy change as a plain object, checked as hostile input.

import { fail, own } from './util.js';

/** The economy's own action types, for economy.handle. */
export const ECONOMY_ACTIONS = Object.freeze(['eco.buy', 'eco.sell', 'eco.craft', 'eco.collect', 'eco.cancel', 'eco.exchange']);

const optionalCount = (v) => (v === undefined || v === null ? undefined : v);

/** createActions(economy) -> { handle, crafting }, mixed into the economy. */
export function createActions(economy) {
  const run = (fn) => { try { return fn(); } catch (err) { return fail('bad-action', { message: err.message }); } };
  return {
    /**
     * handle(action, env) -> result, or undefined when the action is not the economy's business
     * (pass it on to the inventory engine's applyInventoryAction then). Never throws.
     */
    handle(action, env = {}) {
      if (!action || typeof action !== 'object' || typeof action.type !== 'string') return undefined;
      const a = action;
      switch (a.type) {
        case 'inv.buy': case 'eco.buy':
          if (!economy.hasShop(a.shop)) return a.type === 'eco.buy' ? fail('bad-action', { message: `unknown shop "${String(a.shop)}"` }) : undefined;
          return run(() => economy.buy(a.shop, a.index, optionalCount(a.n) ?? 1));
        case 'inv.sell': case 'eco.sell':
          if (!economy.hasShop(a.shop)) return a.type === 'eco.sell' ? fail('bad-action', { message: `unknown shop "${String(a.shop)}"` }) : undefined;
          return run(() => economy.sell(a.shop, a.from, optionalCount(a.n)));
        case 'inv.craft':
          if (!economy.hasRecipe(a.recipe)) return undefined;
          return run(() => economy.craft(a.recipe, { times: optionalCount(a.times) ?? 1, station: env && own(env, 'station') ? env.station ?? undefined : undefined }));
        case 'eco.craft': return run(() => economy.craft(a.recipe, { times: optionalCount(a.times) ?? 1, station: a.station ?? undefined }));
        case 'eco.collect': return run(() => economy.collect(a.station ?? undefined));
        case 'eco.cancel': return run(() => economy.cancel(a.station ?? undefined, optionalCount(a.index)));
        case 'eco.exchange': return run(() => economy.exchange(a.from, a.to, a.n));
        default: return undefined;
      }
    },
    /** Shaped like the inventory engine's createCrafting(): pass it as `crafting` to createInventoryUi. */
    crafting: {
      has: (id) => economy.hasRecipe(id),
      ids: () => economy.recipeIds(),
      all: () => economy.recipeIds().map((id) => economy.recipe(id)),
      get: (id) => economy.recipe(id),
      check: (inv, id, o = {}) => economy.canCraft(id, { times: o.times, station: o.station ?? undefined }),
      craft: (inv, id, o = {}) => economy.craft(id, { times: o.times, station: o.station ?? undefined }),
      list: (inv, o = {}) => economy.recipes({ station: o.station ?? undefined }),
    },
  };
}
