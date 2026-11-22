// The economy as a plugin of the base engine: createBase({ plugins: [inventoryPlugin(...), economyPlugin({ shops, recipes })] }).
// It follows the base's game time (shops restock and stations work while the day runs, and stand
// still under a menu), joins the game's one save, sends its events on the bus as 'economy:<event>'
// and draws a progress badge over every crafting station that is also an actor.

import { createEconomy, ECONOMY_EVENTS } from './economy.js';
import { drawStationBadge } from './draw.js';
import { ECONOMY_SAVE_VERSION } from './save.js';

/**
 * economyPlugin(options) -> plugin for createBase({ plugins: [...] })
 * options: everything createEconomy takes (shops, recipes, stations, currencies, exchangeFee, seed), plus
 *   inventory    the player's inventory. Left out: taken from the inventory plugin (base.plugin('inventory').inventory)
 *   catalog      the item catalog. Left out: inventory.catalog
 *   view         the inventory screens (createInventoryUi). Left out: base.plugin('inventory').view
 *   badgeHeight  metres above a station actor's feet where its badge is drawn. Default 2.2
 *   charisma     how the stats plugin's charisma moves prices, when that plugin is in the game:
 *                { stat = 'charisma', id = the stats plugin's player, base = 5, per = 0.02, max = 0.3 } means 2% better
 *                prices for every point above 5 (worse below), up to 30%. false = no effect. Ignored when `bargain` is passed.
 * base.plugin('economy') -> { economy, shops, crafting, handle(action, env), money(shop), openShop(id), openStation(id), save(), load(data) }
 */
export function economyPlugin(options = {}) {
  return {
    name: 'economy',
    requires: options.inventory ? [] : ['inventory'],
    uses: ['inventory', 'ui', 'stats'],
    // only a game with crafting stations has markers to switch off
    settings: Array.isArray(options.stations) && options.stations.length > 0 ? [{ id: 'economy.badges', label: 'Crafting progress markers', type: 'toggle', value: true }] : [],
    install(base) {
      const partner = base.has('inventory') ? base.plugin('inventory') : null;
      const inventory = options.inventory ?? partner?.inventory;
      if (!inventory || typeof inventory.transaction !== 'function') throw new Error('economyPlugin: no inventory. Pass { inventory } or list the inventory plugin first (its install must return { inventory })');
      const { view: ownView, badgeHeight = 2.2, charisma, ...rest } = options;
      const economy = createEconomy({ ...rest, catalog: options.catalog ?? inventory.catalog, inventory, startHour: base.time.hour });
      const screens = () => ownView ?? partner?.view ?? null;

      // Charisma (the stats plugin) is the bargaining hook, unless the game passed its own.
      let lastBargain = 0;
      const sheet = base.has('stats') && charisma !== false && !options.bargain ? base.plugin('stats') : null;
      if (sheet && typeof sheet.stats?.get === 'function') {
        const c = { stat: 'charisma', id: sheet.player ?? 'player', base: 5, per: 0.02, max: 0.3, ...(charisma && typeof charisma === 'object' ? charisma : {}) };
        const share = () => {
          if (typeof sheet.stats.has === 'function' && !sheet.stats.has(c.id)) return 0;
          const value = Number(sheet.stats.get(c.id, c.stat));
          return Number.isFinite(value) ? Math.max(-c.max, Math.min(c.max, (value - c.base) * c.per)) : 0;
        };
        economy.setBargain(share);
        lastBargain = share();
        // a new charisma (level up, a potion, a hat) reaches the price tags on the next tick
        base.on('sim', () => { const now = share(); if (now !== lastBargain) { lastBargain = now; economy.reprice(); } }, { owner: 'economy', order: 60 });
      }

      // One clock for everyone: the economy follows base.time. A jump of the hour (sleeping) counts as time passing.
      base.on('sim', () => {
        const passed = (((base.time.hour - economy.hour) % 24) + 24) % 24;
        if (passed > 1e-9 && passed < 24 - 1e-6) economy.advance(passed);
      }, { owner: 'economy' });

      for (const event of ECONOMY_EVENTS) economy.on(event, (payload) => base.bus.emit(`economy:${event}`, payload));

      let badges = true; let colors = {}; let font = 'sans-serif';
      base.settings.watch('economy.badges', (on) => { badges = on !== false; });
      base.style.watch((tokens) => {
        const p = tokens.palette ?? {};
        colors = { track: p.panel, accent: p.accent, good: p.good, text: p.text };
        for (const key of Object.keys(colors)) if (colors[key] === undefined) delete colors[key];
        font = tokens.font?.ui ?? 'sans-serif';
      });
      base.on('draw:overlay', (ctx) => {
        if (!badges) return;
        for (const id of economy.stationIds()) {
          const actor = base.actors.get(id);
          if (!actor || actor.hidden) continue;
          const at = base.views.toScreen(actor.x, actor.y, badgeHeight);
          if (at.visible) drawStationBadge(ctx, economy.station(id), at.x, at.y, { colors, font });
        }
      }, { owner: 'economy' });

      return {
        economy,
        get shops() { return economy.shops; },
        crafting: economy.crafting,
        handle: (action, env) => economy.handle(action, env),
        /** What the inventory screens show for a shop's currency (the inventory plugin asks for it). */
        money: (shop) => economy.money(shop),
        /** Open a shop's screen (the inventory panel). -> { ok } or { ok: false, reason: 'closed' | 'no-screen' } */
        openShop(id) {
          const info = economy.shopInfo(id);
          if (!info.open) return { ok: false, reason: 'closed', opensIn: info.opensIn };
          const view = screens();
          if (!view || typeof view.openShop !== 'function') return { ok: false, reason: 'no-screen' };
          view.openShop(economy.shop(id), { name: id, title: info.name });
          return { ok: true };
        },
        /** Open a station's recipe list (the inventory crafting menu). -> { ok } or { ok: false, reason: 'no-screen' } */
        openStation(id) {
          const station = economy.station(id);
          const view = screens();
          if (!view || typeof view.openCrafting !== 'function') return { ok: false, reason: 'no-screen' };
          view.openCrafting({ station: id, title: station.name });
          return { ok: true };
        },
        saveVersion: ECONOMY_SAVE_VERSION,
        save: () => economy.save(),
        load: (data) => { economy.load(data); },
      };
    },
  };
}
