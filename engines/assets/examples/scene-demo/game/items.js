// What the player can own: the inventory engine's catalog, the bag, its screen, and loot on the
// ground. Equipping something shows on the player's puppet (hat, sword, shield, staff, helm).
import { inventoryPlugin } from '../vendor/inventory/plugin.js';
import { createInventory, dropItem, pickupDrop, nearbyDrops, syncPuppet, seededRng, setHotbar, bindInventoryHud } from '../vendor/inventory/index.js';
import { ITEMS } from '../vendor/puppet/index.js';

/** Every item of the demo. */
export const CATALOG = [
  { id: 'hat', name: 'Straw Hat', weight: 0.3, value: 4, equip: 'head', puppet: 'strawHat' },
  { id: 'helm', name: 'Watch Helm', weight: 2, value: 30, rarity: 'uncommon', stats: { defense: 2 }, equip: 'head', puppet: 'helm' },
  { id: 'sword', name: 'Iron Sword', weight: 3, value: 40, rarity: 'uncommon', stats: { attack: 5 }, equip: 'mainHand', puppet: 'sword' },
  { id: 'blade', name: 'Rusty Blade', weight: 3, value: 8, stats: { attack: 2 }, equip: 'mainHand', puppet: 'rustyBlade' },
  { id: 'staff', name: 'Walking Staff', weight: 2, value: 10, stats: { attack: 1 }, equip: 'mainHand', twoHanded: true, puppet: 'staff' },
  { id: 'shield', name: 'Round Shield', weight: 4, value: 25, stats: { defense: 3 }, equip: 'offHand', puppet: 'shield' },
  { id: 'tea', name: 'Moonleaf Tea', description: 'Warm. Puts you back on your feet.', stack: 10, weight: 0.3, value: 6, use: { cheer: 1 } },
  { id: 'moonleaf', name: 'Moonleaf', stack: 20, weight: 0.1, value: 2, tags: ['herb'] },
  { id: 'axe', name: 'Throwing Axe', description: 'U throws it at the mouse. Walk over it to take it back.', stack: 9, weight: 0.6, value: 5 },
  { id: 'apple', name: 'Apple', stack: 10, weight: 0.2, value: 1, use: { cheer: 1 } },
];
const HOTBAR = 6; // quick slots, picked with 1 to 6 or the mouse wheel
const TABLES = {
  roadside: { rolls: [1, 2], entries: [
    { item: 'apple', n: [1, 3], weight: 4 }, { item: 'tea', weight: 2 }, { item: 'blade', weight: 1 }, { item: 'staff', weight: 1 },
    { item: 'shield', weight: 1 }, { item: 'helm', weight: 0.5 }, { coins: [1, 6], weight: 3 },
  ] },
};

/**
 * @param {object} o
 * @param {object} o.ui     The ui kit instance.
 * @param {object} o.sound  The demo's sound.
 * @param {() => object[]} o.heroes  The player's characters (one per stage) that wear the equipment.
 * @returns {object} items: { catalog, inventory, view, drops, loot, lootAt(seed, x, y), update(dt, x, y), reset(saved), save() }
 */
export function createItems({ base, ui, sound, heroes }) {
  // The inventory plugin makes the bag, the catalog, the loot tables, the things on the ground and the
  // bag screen, opens the bag on its key while the game has the input, and tells the bus what changes.
  // Picking up stays here (pickup: 0): this game leaves alone what the player has just put down.
  const position = { x: 0, y: 0 }; // where the player stands, so Drop puts things on the ground there
  let plug = null;
  const onResult = (action, result) => { base.bus.emit('inventory:result', { action, result }); afterAction(action, result); };
  base.use(inventoryPlugin({
    items: CATALOG, size: 12, maxWeight: 30, hotbar: HOTBAR, loot: { tables: TABLES }, drops: { delay: 0.4 }, pickup: 0,
    screen: { env: () => ({ drops: plug.drops, position }), onResult },
  }));
  plug = base.plugin('inventory');
  const { catalog, inventory, loot, drops, view } = plug;
  const dress = () => { for (const hero of heroes()) syncPuppet(hero, inventory, { ITEMS }); };
  inventory.on('change', dress);
  // the hotbar fills itself: each new kind of thing in the bag takes the first free slot
  let filling = false;
  inventory.on('change', () => {
    if (filling) return;
    filling = true;
    try {
      for (const s of inventory.list()) { const bar = inventory.hotbar(); if (bar.includes(s.id)) continue; const free = bar.indexOf(null); if (free < 0) break; setHotbar(inventory, free, s.id); }
      for (const s of Object.values(inventory.equipment())) { if (!s) continue; const bar = inventory.hotbar(); if (bar.includes(s.id)) continue; const free = bar.indexOf(null); if (free >= 0) setHotbar(inventory, free, s.id); }
    } finally { filling = false; }
  });
  const own = new Set(); // things the player just put down: left alone until the player has walked away from them
  const afterAction = (action, result) => {
      if (!result.ok) return;
      if (action.type === 'inv.drop') { for (const d of nearbyDrops(drops, position.x, position.y, 1.5)) own.add(d.uid); sound.play('thud', { volume: 0.4 }); return; }
      if (action.type === 'inv.use') { sound.play('powerup', { volume: 0.6 }); ui.toast('That hit the spot'); for (const hero of heroes()) if (hero.state === 'die') hero.revive(); } else if (action.type === 'inv.equip' || action.type === 'inv.unequip') sound.play('select', { volume: 0.6 });
  };
  const hud = bindInventoryHud(ui, inventory, { env: () => ({ drops, position }), onResult, coins: false, weight: false });
  const items = {
    catalog, inventory, view, drops, loot, hud,
    /** Put the loot of one place on the ground. The same seed and place always give the same things. */
    lootAt(seed, x, y, table = 'roadside') {
      const rng = seededRng(seed, table, Math.round(x), Math.round(y));
      const roll = loot.roll(table, rng);
      const made = roll.items.map((stack, i) => dropItem(drops, catalog, stack, x + Math.cos(i * 2.4) * 0.9, y + Math.sin(i * 2.4) * 0.9));
      return { made, coins: roll.coins };
    },
    /** Once per update: picks up what the player walks over. Returns the names picked up. */
    update(dt, x, y, reach = 0.9) {
      position.x = x; position.y = y; // the plugin steps the things on the ground
      const near = nearbyDrops(drops, x, y, 1.8).map((d) => d.uid);
      for (const uid of [...own]) if (!near.includes(uid)) own.delete(uid);
      const got = [];
      for (const d of nearbyDrops(drops, x, y, reach)) {
        if (own.has(d.uid)) continue;
        const r = pickupDrop(drops, inventory, d.uid);
        if (!r.ok && r.reason !== 'full') continue;
        const g = { id: d.id, added: r.ok ? (r.added ?? d.n) : 0, left: r.ok ? (r.left ?? 0) : d.n };
        if (g.added > 0) { got.push(catalog.get(g.id).name); sound.play('pickup', { volume: 0.6 }); items.onPickup?.(d.x, d.y); ui.toast(`Picked up ${catalog.get(g.id).name}${g.added > 1 ? ' x' + g.added : ''}`); } else if (g.left > 0) { ui.toast('Your bag is full'); own.add(d.uid); }
      }
      return got;
    },
    /** Plain data for a save slot. */
    save: () => inventory.toJSON(),
    /** A new game's bag (the villager's own straw hat, a flask of tea), or a saved one. */
    reset(saved = null) {
      drops.items.length = 0; own.clear();
      if (saved) { inventory.load(saved); dress(); return; }
      inventory.load(createInventory({ catalog, size: 12, maxWeight: 30, hotbar: HOTBAR }).toJSON());
      inventory.add('hat'); inventory.equip(0);
      inventory.add('tea', 2);
      inventory.add('axe', 3);
      dress();
    },
  };
  items.reset();
  return items;
}
