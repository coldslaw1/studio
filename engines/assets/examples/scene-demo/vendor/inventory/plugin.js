// The inventory engine as a base plugin: the hero's bag, equipment, loot on the ground and the
// bag screen. The screen is a ui-kit screen, so it pauses the game and owns the input like any
// menu; what is equipped shows on the hero's rig when the puppet plugin is in.
//   plugins: [uiPlugin(), inventoryPlugin({ items: [...], size: 12, hotbar: 6 })]
//   base.plugin('inventory').inventory.add('potion', 3);
import { createCatalog, createInventory, createLoot, createDrops, stepDrops, pickupNear, dropItem, createInventoryUi, syncPuppet, adoptPuppet, applyInventoryAction } from './index.js';

/**
 * inventoryPlugin(options) -> plugin (uses 'ui', 'puppet', 'audio')
 *   items      the item definitions (createCatalog), or pass a ready `catalog`
 *   size, columns, bags, maxWeight, coins, hotbar, equipSlots   createInventory options
 *   loot       { tables } for createLoot (optional)
 *   hero       id of the actor that carries it (default 'hero')
 *   pickup     metres within which the hero picks loot up by walking over it (default 0.9; 0 = never)
 *   screen     createInventoryUi options (style, cellSize, labels ...); false = no bag screen
 * base.plugin('inventory') -> { inventory, catalog, loot, drops, view, open(), drop(stack, x, y), save, load }
 * Action 'inventory' (I unless the game binds it) opens the bag while the game owns the input.
 * Bus: 'inventory:change' { type, ... }, 'inventory:pickup' [{ id, added, left }], 'inventory:result' { action, result }.
 */
export function inventoryPlugin(options = {}) {
  return {
    name: 'inventory',
    uses: ['ui', 'puppet', 'audio'],
    actions: { inventory: ['KeyI'] },
    install(base) {
      const { items, catalog: given, loot: lootOptions, hero = 'hero', pickup = 0.9, screen = {}, ...invOptions } = options;
      if (!given && !Array.isArray(items)) throw new Error('inventoryPlugin: options.items (an array of item definitions) or options.catalog is required');
      const catalog = given ?? createCatalog(items);
      const inventory = createInventory({ catalog, ...invOptions });
      const loot = lootOptions ? createLoot({ catalog, ...lootOptions }) : null;
      const drops = createDrops(options.drops ?? {});
      const heroActor = () => base.actors.get(hero);
      const dress = () => {
        const a = heroActor();
        if (a?.character && base.has('puppet')) syncPuppet(a.character, inventory, { ITEMS: base.plugin('puppet').ITEMS });
      };
      let adopted = false;
      inventory.on('change', (e) => { dress(); base.bus.emit('inventory:change', e); });
      const env = () => {
        const a = heroActor(); const e = { drops, position: a ? { x: a.x, y: a.y } : { x: 0, y: 0 } };
        if (base.has('economy')) { const eco = base.plugin('economy'); e.shops = eco.shops; e.crafting = eco.crafting; }
        return e;
      };
      let view = null;
      if (screen !== false && base.has('ui')) {
        view = createInventoryUi({
          ui: base.plugin('ui').ui, inventory,
          env,
          // with the economy plugin in the game, buying, selling and crafting go to it first (looked up when the action happens)
          send: (action) => (base.has('economy') ? base.plugin('economy').handle(action, env()) : null) ?? applyInventoryAction(inventory, action, env()),
          // ... and a shop that trades in another currency shows that currency's sign and balance
          money: (shop) => (base.has('economy') && typeof base.plugin('economy').money === 'function' ? base.plugin('economy').money(shop) : null),
          onResult: (action, result) => base.bus.emit('inventory:result', { action, result }),
          ...screen,
        });
      }
      const open = (o = { title: 'Bag' }) => { if (!view) throw new Error('inventory.open: there is no bag screen (add the ui plugin, and do not pass screen: false)'); if (!base.focus.free) return false; view.open(o); return true; };
      base.on('sim', (dt) => {
        const a = heroActor();
        if (a?.character && !adopted && base.has('puppet')) { adopted = true; adoptPuppet(a.character, inventory); dress(); } // the rig's starting gear becomes equipment
        stepDrops(drops, dt);
        if (a && pickup > 0 && drops.items.length) { const got = pickupNear(drops, inventory, a.x, a.y, pickup); if (got.length) base.bus.emit('inventory:pickup', got); }
        if (view && base.input.game.pressed('inventory')) open();
      }, { order: 150, owner: 'inventory' });
      return {
        inventory, catalog, loot, drops, view, open,
        /** Put a stack ({ id, n }) on the ground at a ground point. */
        drop: (stack, x, y) => dropItem(drops, catalog, stack, x, y),
        save: () => ({ inventory: inventory.toJSON(), drops: drops.items.map((d) => ({ id: d.id, n: d.n, x: d.x, y: d.y })) }),
        load(data) { inventory.load(data.inventory); drops.items.length = 0; for (const d of data.drops ?? []) dropItem(drops, catalog, { id: d.id, n: d.n }, d.x, d.y); dress(); },
      };
    },
  };
}
