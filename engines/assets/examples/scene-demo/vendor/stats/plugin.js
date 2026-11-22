// The stats engine as a base plugin: createBase({ plugins: [statsPlugin({ ... })] }).
// It imports nothing but this engine; combat and inventory are found through the base when they are there.
import { createStats } from './stats.js';
import { bindCombat } from './combat.js';
import { bindInventory, applyItemEffect, giveLoot } from './inventory.js';
import { hudView, drawHud } from './hud.js';

const isCombat = (c) => !!c && typeof c.setStats === 'function' && typeof c.fighter === 'function' && typeof c.on === 'function';
const isInventory = (i) => !!i && typeof i.stats === 'function' && typeof i.give === 'function' && typeof i.on === 'function';

/**
 * statsPlugin(options) -> plugin for createBase({ plugins: [...] })
 * options (all optional):
 *   rules       the createStats options: { stats, resources, effects, levels, templates, loot, builtins }
 *   rng         () => float in [0, 1) for loot
 *   player      id of the player's sheet and actor. Default 'player'.
 *   sheets      { id: options | templateName } sheets to add at start, for example { player: { level: 1 } }
 *   combat, inventory   the engine objects, when the game made them itself. Default: taken from the 'combat' and
 *               'inventory' plugins (their API itself, or its .combat / .inventory field).
 *   combatOptions   options for bindCombat (stat names, sheetOf, xp)
 *   autoLoot    true puts the loot of everything the player defeats straight into the inventory. Default false:
 *               listen for 'stats:defeat' on the bus and drop or give it yourself.
 *   hud         false draws nothing. Default: level, bars and effect timers in the top left corner, in mode 'play'.
 *               Or { x, y, width, scale, resources, modes }.
 *   order       place in the 'sim' phase. Default 50 (after combat's default 0, so health is settled first).
 * base.plugin('stats') -> { stats, player, combatLink, inventoryLink, view(), useItem(effect, id), save(), load(data) }
 * Bus events: every stats event as 'stats:<type>' ('stats:levelup', 'stats:xp', 'stats:effect', 'stats:effectEnd',
 * 'stats:resource', 'stats:depleted', 'stats:defeat', 'stats:unlock', 'stats:points', 'stats:change', ...).
 * Actors: base.actors.add({ id, x, y, stats: 'goblin' }) gives the actor a sheet (a template name, add options, or
 * true). The sheet goes when the actor is removed, unless the actor has keepStats: true or is the player.
 */
export function statsPlugin(options = {}) {
  return {
    name: 'stats',
    requires: [],
    uses: ['combat', 'inventory'],
    settings: options.hud === false ? [] : [{ id: 'stats.hud', label: 'Status bars', type: 'toggle', value: true }],
    install(base) {
      const stats = createStats({ ...(options.rules ?? {}), rng: options.rng ?? options.rules?.rng });
      const player = options.player ?? 'player';
      for (const [id, o] of Object.entries(options.sheets ?? {})) stats.add(id, o);

      let combatLink = null;
      base.on('sim', (dt) => { combatLink?.check(); stats.step(dt); }, { owner: 'stats', order: options.order ?? 50 }); // check: fighters that joined this tick get their sheet's numbers
      stats.on('*', (e) => base.bus.emit(`stats:${e.type}`, e));

      const adopt = (actor) => { if (actor.stats !== undefined && actor.stats !== null && actor.stats !== false && !stats.has(actor.id)) stats.add(actor.id, actor.stats === true ? {} : actor.stats); };
      for (const actor of base.actors.list()) adopt(actor);
      base.bus.on('actors:added', ({ actor }) => adopt(actor));
      base.bus.on('actors:removed', ({ actor }) => { if (actor.stats !== undefined && actor.stats !== null && actor.stats !== false && !actor.keepStats && actor.id !== player) stats.remove(actor.id); });

      const partner = (name, test) => {
        if (options[name]) return options[name];
        if (!base.has(name)) return null;
        const api = base.plugin(name);
        return test(api) ? api : test(api?.[name]) ? api[name] : null;
      };
      const combat = partner('combat', isCombat);
      combatLink = combat ? bindCombat(stats, combat, options.combatOptions) : null;
      if (combatLink) base.bus.on('*', (payload, name) => { if (name.startsWith('combat:') || name === 'actors:added') combatLink.check(); }); // a join announced on the bus is picked up at once
      const inventory = partner('inventory', isInventory);
      const inventoryLink = inventory ? bindInventory(stats, player, inventory) : null;
      if (inventory && options.autoLoot) stats.on('defeat', (e) => { if (e.by.includes(player)) base.bus.emit('stats:looted', { id: player, from: e.id, ...giveLoot(inventory, e.loot) }); });

      if (options.hud !== false) {
        const hud = options.hud && typeof options.hud === 'object' ? options.hud : {};
        let on = true; let palette = null; let font = 'sans-serif';
        base.settings.watch('stats.hud', (value) => { on = value; });
        base.style.watch((tokens) => { palette = tokens?.palette ?? null; font = tokens?.font?.ui ?? 'sans-serif'; });
        base.on('draw:ui', (ctx) => {
          if (!on || !stats.has(player)) return;
          drawHud(ctx, hudView(stats, player, { resources: hud.resources }), { x: hud.x, y: hud.y, width: hud.width, scale: hud.scale, palette, font });
        }, { owner: 'stats', modes: hud.modes ?? ['play'] });
      }

      return {
        stats, player, combatLink, inventoryLink,
        view: (id = player) => (stats.has(id) ? stats.view(id) : null),
        useItem: (effect, id = player) => applyItemEffect(stats, id, effect),
        save: () => stats.toJSON(),
        load: (data) => { stats.load(data); },
        saveVersion: 1,
      };
    },
  };
}
