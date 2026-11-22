// Inventory demo on top of core + ui. Walk with the arrow keys or WASD.
//   I or Tab: bag     E: use what you stand next to (chest, shop, forge, goblin)     1 to 5: quick slots
// Items on the ground are picked up by walking over them. Everything is saved.
// Run:  node examples/serve.mjs   then open http://localhost:8140/inventory/examples/demo/
// In a real game the imports are '../vendor/core/index.js' and so on.
import { createGame, DEFAULT_ACTIONS } from '../../../core/src/index.js';
import { createUi } from '../../../ui/src/index.js';
import { createCharacter, createVectorRenderer, ITEMS } from '../../../puppet/src/index.js';
import {
  createCatalog, createInventory, createContainer, createShop, createCrafting, createLoot, createDrops, seededRng,
  scatterLoot, stepDrops, pickupNear, createInventoryUi, bindInventoryHud, stackRarity, addItem, checkContainer, syncPuppet,
} from '../../src/index.js';

const WIDTH = 640;
const HEIGHT = 360;
const catalog = createCatalog([
  { id: 'potion', name: 'Health Potion', stack: 10, weight: 0.5, value: 8, use: { heal: 5 }, description: 'Restores 5 health.' },
  { id: 'arrow', name: 'Arrow', stack: 50, weight: 0.05, value: 1, tags: ['ammo'] },
  { id: 'iron', name: 'Iron Ingot', stack: 20, weight: 2, value: 5 },
  { id: 'plank', name: 'Oak Plank', stack: 20, weight: 1, value: 2, tags: ['wood'] },
  { id: 'gem', name: 'Gem', stack: 10, value: 50, rarity: 'rare' },
  { id: 'sword', name: 'Iron Sword', weight: 4, value: 30, rarity: 'uncommon', stats: { attack: 5 }, equip: 'mainHand', puppet: 'sword', description: 'A plain, honest blade.' },
  { id: 'shield', name: 'Round Shield', weight: 5, value: 25, stats: { defense: 3 }, equip: 'offHand', puppet: 'shield' },
  { id: 'helm', name: 'Steel Helm', weight: 3, value: 20, stats: { defense: 2 }, equip: 'head', puppet: 'helm' },
  { id: 'hat', name: 'Straw Hat', weight: 0.2, value: 3, equip: 'head', puppet: 'strawHat' },
  { id: 'staff', name: 'Oak Staff', weight: 3, value: 18, rarity: 'rare', stats: { magic: 6 }, equip: 'mainHand', twoHanded: true, puppet: 'staff' },
]);
const crafting = createCrafting({ catalog, recipes: [
  { id: 'sword', inputs: [{ item: 'iron', n: 3 }, { tag: 'wood', n: 1 }], outputs: [{ item: 'sword' }], station: 'forge' },
  { id: 'arrows', name: 'Arrows', inputs: [{ tag: 'wood', n: 1 }], outputs: [{ item: 'arrow', n: 10 }], station: 'forge' },
] });
const loot = createLoot({ catalog, tables: { goblin: {
  rolls: [1, 3],
  entries: [{ item: 'arrow', n: [3, 8], weight: 3 }, { item: 'iron', n: [1, 2], weight: 3 }, { item: 'plank', weight: 3 },
    { item: 'gem', weight: 1 }, { item: 'helm', weight: 1, rarity: { common: 6, rare: 3, epic: 1 } }, { coins: [2, 9], weight: 3 }],
  always: [{ item: 'potion', chance: 0.4 }],
} } });

const PLACES = [
  { id: 'chest', label: 'Chest', x: 120, y: 90, color: '#c8903c' },
  { id: 'shop', label: 'Shop', x: 520, y: 90, color: '#5fd38d' },
  { id: 'forge', label: 'Forge', x: 120, y: 280, color: '#ff8a3d' },
  { id: 'goblin', label: 'Goblin', x: 520, y: 280, color: '#9a6bd6' },
];

function play(game) {
  const store = game.saves.slotStore(1);
  const ui = createUi({ width: WIDTH, height: HEIGHT, theme: new URLSearchParams(location.search).get('theme') ?? 'moss' });
  const inventory = createInventory({ catalog, size: 12, maxWeight: 40, coins: 25, hotbar: 5 });
  if (!inventory.restore(store).loaded) { for (const [id, n] of [['potion', 2], ['hat', 1], ['plank', 2], ['sword', 1], ['arrow', 12], ['gem', 1], ['helm', 1]]) inventory.add(id, n); }
  const savedChest = store.get('chest');
  const chest = savedChest ? checkContainer(savedChest, catalog, { size: 6 }).container : createContainer({ size: 6 });
  if (!savedChest) { addItem(chest, catalog, 'iron', 4); addItem(chest, catalog, 'shield', 1); }
  inventory.attach('chest', chest);
  const shop = createShop({ catalog, stock: [{ item: 'potion' }, { item: 'arrow', n: 40 }, { item: 'staff', n: 1 }] });
  const drops = createDrops({ ttl: 60 });
  const state = { x: WIDTH / 2, y: HEIGHT / 2, hp: 5, kills: store.get('kills') ?? 0, near: null };
  const env = () => ({ shops: { shop }, drops, position: { x: state.x, y: state.y + 14 }, station: state.near });
  const onResult = (action, result) => { // runs after every inventory action, from the panel or a quick slot
    if (result.ok && result.effect) { state.hp = Math.min(10, state.hp + result.effect.heal); ui.hud.set('hp', state.hp); }
    if (action.type === 'inv.craft' && result.ok) ui.toast('Crafted');
  };
  // The player's character wears what is equipped, and stands between the equipment slots.
  const hero = createCharacter({ model: 'villager', equipment: { head: null } });
  const dress = () => syncPuppet(hero, inventory, { ITEMS });
  inventory.on('change', dress);
  dress();
  let doll = null;
  const drawDoll = (ctx, r) => {
    const unit = r.h / (hero.rig.meta.height * 1.25);
    if (!doll || doll.unit !== unit) doll = { unit, renderer: createVectorRenderer({ unit }) };
    doll.renderer.draw(ctx, hero.puppet, r.x + r.w / 2, r.y + r.h * 0.93);
  };
  const view = createInventoryUi({ ui, inventory, crafting, env, onResult, drawDoll });
  inventory.on('change', () => { inventory.save(store); store.set('chest', chest); }); // save on every change
  ui.hud.add({ id: 'hp', type: 'bar', label: 'HP', value: state.hp, max: 10 })
    .add({ id: 'bag', type: 'button', label: 'Bag', anchor: 'bottom-right', onPress: () => view.open() });
  const hud = bindInventoryHud(ui, inventory, { env, onResult }); // coins, weight and the quick slots
  Object.assign(window, { demo: { hero, inventory, view, ui, drops, chest, shop, state, interact: () => interact() } });

  function interact() {
    if (state.near === 'chest') view.openChest('chest');
    else if (state.near === 'shop') view.openShop(shop, { title: 'Travelling Shop' });
    else if (state.near === 'forge') view.openCrafting({ station: 'forge', title: 'Forge' });
    else if (state.near === 'goblin') {
      state.kills += 1;
      store.set('kills', state.kills);
      const p = PLACES[3];
      const rng = seededRng('demo-world', 'goblin', state.kills); // the same kill number always drops the same loot
      const result = loot.roll('goblin', rng);
      scatterLoot(drops, catalog, result.items, p.x - 60, p.y - 30, rng, 40);
      inventory.addCoins(result.coins);
      if (result.coins) ui.toast(`+${result.coins} coins`);
    }
  }
  return {
    state,
    update(dt) {
      hero.update(dt, {}); // keeps breathing while the bag is open
      if (ui.update(dt, game.input)) return;
      state.x = Math.max(10, Math.min(WIDTH - 10, state.x + game.input.axis('left', 'right') * 170 * dt));
      state.y = Math.max(10, Math.min(HEIGHT - 10, state.y + game.input.axis('up', 'down') * 170 * dt));
      state.near = PLACES.find((p) => Math.hypot(p.x - state.x, p.y - state.y) < 42)?.id ?? null;
      stepDrops(drops, dt);
      for (const got of pickupNear(drops, inventory, state.x, state.y, 16)) ui.toast(`Picked up ${catalog.get(got.id).name}${got.added > 1 ? ` x${got.added}` : ''}`, 1.2);
      for (let i = 0; i < 5; i++) if (game.input.pressed(`slot${i + 1}`)) hud.quick(i);
      if (game.input.pressed('inventory')) view.open();
      else if (game.input.pressed('interact')) interact();
    },
    draw(ctx) {
      ctx.fillStyle = ui.theme.bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const p of PLACES) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 16, p.y - 16, 32, 32);
        ctx.fillStyle = ui.theme.text;
        ctx.fillText(state.near === p.id ? `${p.label}: press E` : p.label, p.x, p.y + 32);
      }
      for (const d of drops.items) {
        ctx.fillStyle = catalog.rarity(stackRarity(catalog, d)).color;
        ctx.fillRect(d.x - 4, d.y - 4, 8, 8);
      }
      ctx.fillStyle = ui.theme.accent;
      ctx.fillRect(state.x - 9, state.y - 9, 18, 18);
      ui.draw(ctx);
    },
  };
}

createGame({
  canvas: document.getElementById('game'), gameId: 'inventory-demo', width: WIDTH, height: HEIGHT,
  actions: { ...DEFAULT_ACTIONS, inventory: ['KeyI', 'Tab', 'pad:y'], interact: ['KeyE', 'pad:x'],
    slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'] },
  scenes: { play },
});
