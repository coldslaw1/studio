// Combat demo: a knight against waves of skeletons, on top of core, collision,
// puppet, inventory and audio. The world is in metres; +y is away from the camera.
//   Move: WASD / arrows     Attack: J or click (press again to chain the combo)
//   Block: K or Shift (raise it just before a blow lands to parry)     Dodge roll: Space
//   Throw an axe at the mouse: F     Swap weapon: Q     Restart: R     Hit shapes: H     Mute: M
// Axes stick in what they hit; walk over one to pick it up and throw it again.
// Run:  node examples/serve.mjs   then open http://localhost:8150/combat/examples/demo/
// In a real game the imports are '../vendor/core/index.js' and so on.
import { createGame, DEFAULT_ACTIONS, createRng } from '../../../core/src/index.js';
import * as collision from '../../../collision/src/index.js';
import { createCharacter, humanoidAnimator, ITEMS } from '../../../puppet/src/index.js';
import { createCatalog, createInventory, syncPuppet, adoptPuppet } from '../../../inventory/src/index.js';
import { createAudio } from '../../../audio/src/index.js';
import { createCombat, combatAnimator, bindPuppet, bindAudio, syncFighter, throwFromInventory, pickupToInventory } from '../../src/index.js';
import { createView } from './draw.js';

const catalog = createCatalog([
  { id: 'sword', name: 'Iron Sword', stats: { attack: 2 }, equip: 'mainHand', puppet: 'sword' },
  { id: 'staff', name: 'Oak Staff', stats: { attack: 1 }, equip: 'mainHand', twoHanded: true, puppet: 'staff' },
  { id: 'dagger', name: 'Dagger', stats: { attack: 1 }, equip: 'mainHand', puppet: 'rustyBlade' },
  { id: 'shield', name: 'Round Shield', stats: { defense: 3 }, equip: 'offHand', puppet: 'shield' },
  { id: 'helm', name: 'Steel Helm', stats: { defense: 2 }, equip: 'head', puppet: 'helm' },
  { id: 'axe', name: 'Throwing Axe', stack: 9 },
]);
const WALLS = [ // rects in metres; `height` lets thrown weapons fly over the low ones
  { x: -9.5, y: -6, w: 19, h: 0.5 }, { x: -9.5, y: 5.5, w: 19, h: 0.5 }, { x: -9.5, y: -6, w: 0.5, h: 12 }, { x: 9, y: -6, w: 0.5, h: 12 },
  { x: -4, y: 1.2, w: 1.2, h: 1.2, height: 2.4 }, { x: 3.2, y: -3, w: 1.2, h: 1.2, height: 2.4 }, { x: -7, y: -1.4, w: 3, h: 0.4, height: 0.9 },
];

function play(game) {
  const rng = createRng(20261122);
  const world = collision.createCollisionWorld({ cellSize: 4, skin: 0.005 });
  for (const w of WALLS) world.add(w);
  const combat = createCombat({ collision, world, rng, factions: { friendlyFire: 0 } });
  const audio = createAudio({ autoUnlock: false });
  game.input.onFirstGesture(() => audio.unlock());
  bindAudio(combat, audio, { listener: () => combat.fighter('hero'), sounds: { telegraph: null, aggro: null, status: null } });

  const actors = new Map(); // fighter id -> { character, bound, gone }
  const animator = () => combatAnimator(humanoidAnimator());
  function spawn(id, model, options) {
    combat.addFighter(id, options);
    const character = createCharacter({ model, animator: animator(), rng });
    actors.set(id, { character, bound: bindPuppet(combat, id, character), gone: null });
    return character;
  }

  // the hero: gear lives in the inventory; combat and the puppet both follow it
  const inventory = createInventory({ catalog, size: 8 });
  const hero = spawn('hero', 'knight', { faction: 'player', x: 0, y: -4, facing: 0, hp: 30, attack: 1, hurtIframes: 0.5 });
  adoptPuppet(hero, inventory);
  if (!inventory.equipped('mainHand')) { inventory.add('sword'); inventory.equip(inventory.list().find((s) => s.id === 'sword').index); }
  inventory.add('staff'); inventory.add('dagger'); inventory.add('axe', 4);
  const sync = () => { syncFighter(combat, 'hero', inventory, { weapons: { dagger: 'dagger' }, base: { attack: 1 } }); syncPuppet(hero, inventory, { ITEMS }); };
  inventory.on('change', sync);
  sync();

  const state = { wave: 0, kills: 0, parries: 0, rest: 1.5, shapes: false, shake: 0, floats: [], telegraphs: [], message: 'Wave 1' };
  const MOBS = [
    { model: 'skeleton', o: { hp: 12, weapon: 'rustyBlade', speed: 2.2, ai: { brain: 'melee', sight: 30, leash: 60, los: false, telegraph: 0.45, cooldown: 1 } } },
    { model: 'villager', o: { hp: 8, weapon: 'fists', speed: 2.6, throwable: 'rock', ai: { brain: 'thrower', sight: 30, leash: 60, los: false, keep: 6, telegraph: 0.5, cooldown: 1.4 } } },
    { model: 'knight', o: { hp: 22, weapon: 'sword', shield: 'shield', defense: 3, speed: 2, poise: 0.2, ai: { brain: 'guard', sight: 30, leash: 60, los: false, combo: 2, telegraph: 0.5, cooldown: 1.2 } } },
  ];
  function nextWave() {
    state.wave += 1; state.message = `Wave ${state.wave}`;
    const n = Math.min(5, 1 + state.wave);
    for (let i = 0; i < n; i++) {
      const kind = MOBS[state.wave >= 3 && i === 0 ? 2 : state.wave >= 2 && i === 1 ? 1 : 0];
      spawn(`mob${state.wave}-${i}`, kind.model, { faction: 'mob', x: -6 + i * 3, y: 4.2, facing: 0, ...kind.o });
    }
  }
  combat.on('hit', (e) => {
    const t = combat.fighter(e.target);
    state.floats.push({ x: t.x, y: t.y, z: t.z + t.height, text: `${e.crit ? '!' : ''}${Math.round(e.damage * 10) / 10}`, color: e.target === 'hero' ? '#ff6b6b' : e.via === 'status' ? '#c98bff' : '#fff2b3', t: 0 });
    if (e.via !== 'status') state.shake = Math.min(0.25, 0.08 + e.damage * 0.02);
  });
  combat.on('parry', (e) => { if (e.target === 'hero') state.parries += 1; state.floats.push({ x: e.x, y: e.y, z: e.z + 0.6, text: 'PARRY', color: '#7fd4ff', t: 0 }); });
  combat.on('block', (e) => state.floats.push({ x: e.x, y: e.y, z: e.z + 0.6, text: 'block', color: '#9fb4c8', t: 0 }));
  combat.on('telegraph', (e) => { if (e.shape) state.telegraphs.push({ shape: e.shape, t: e.time }); });
  combat.on('death', (e) => { if (e.id !== 'hero') { state.kills += 1; actors.get(e.id).gone = 2.5; } else state.message = 'You fell. Press R'; });

  window.demo = { combat, inventory, state }; // for play-tests and poking around in the console
  const view = createView({ combat, actors, state, inventory, walls: WALLS, width: game.width, height: game.height });
  function restart() {
    for (const [id, a] of actors) if (id !== 'hero') { a.bound.dispose(); combat.removeFighter(id); actors.delete(id); }
    combat.state.projectiles = [];
    combat.revive('hero'); combat.place('hero', 0, -4);
    inventory.add('axe', Math.max(0, 4 - inventory.count('axe')));
    Object.assign(state, { wave: 0, kills: 0, parries: 0, rest: 1.5, message: 'Wave 1', floats: [], telegraphs: [] });
  }

  return {
    get state() { // play-tests read this as window.game.state
      const h = combat.fighter('hero');
      return { hp: h.hp, alive: h.alive, x: h.x, y: h.y, doing: combat.view('hero').doing, weapon: h.weapon, shield: h.shield, axes: inventory.count('axe'), wave: state.wave, kills: state.kills, parries: state.parries, mobs: combat.fighters().filter((f) => f.faction === 'mob' && f.alive).length, projectiles: combat.projectiles.length, audio: audio.log.length };
    },
    combat, inventory,
    update(dt) {
      const input = game.input;
      if (input.pressed('restart')) restart();
      if (input.pressed('shapes')) state.shapes = !state.shapes;
      if (input.pressed('mute')) audio.toggleMute();
      if (input.pressed('swap')) { // put the next main-hand weapon from the bag in the hand
        const order = ['sword', 'staff', 'dagger'];
        const want = order[(order.indexOf(inventory.equipped('mainHand')?.id) + 1) % order.length];
        const next = inventory.list().find((s) => s.id === want);
        if (next && combat.fighter('hero').act.kind === 'idle') {
          inventory.equip(next.index);
          if (!inventory.equipped('offHand') && !catalog.get(next.id).twoHanded && inventory.count('shield')) inventory.equip(inventory.list().find((s) => s.id === 'shield').index);
        }
      }
      const aim = view.toGround(input.pointer.x, input.pointer.y);
      const usingMouse = input.lastDevice === 'pointer';
      combat.input('hero', {
        moveX: input.axis('left', 'right'), moveY: input.axis('down', 'up'), // +y is away from the camera
        attack: input.down('attack'), block: input.down('block'), dodge: input.down('dodge'),
        aimX: usingMouse ? aim.x : null, aimY: usingMouse ? aim.y : null,
      });
      if (input.pressed('throw')) {
        const slot = inventory.list().find((s) => s.id === 'axe');
        if (slot) throwFromInventory(combat, 'hero', inventory, slot.index, { aim });
      }
      combat.step(dt);
      pickupToInventory(combat, 'hero', inventory); // walking over a thrown axe picks it up
      for (const [id, a] of actors) {
        a.bound.update(dt);
        if (a.gone !== null && (a.gone -= dt) <= 0) { a.bound.dispose(); combat.removeFighter(id); actors.delete(id); }
      }
      if (!combat.fighters().some((f) => f.faction === 'mob' && f.alive) && combat.fighter('hero').alive && (state.rest -= dt) <= 0) { nextWave(); state.rest = 2.5; }
      state.shake = Math.max(0, state.shake - dt);
      for (const f of state.floats) f.t += dt;
      state.floats = state.floats.filter((f) => f.t < 0.9);
      for (const t of state.telegraphs) t.t -= dt;
      state.telegraphs = state.telegraphs.filter((t) => t.t > 0);
    },
    draw(ctx) { view.draw(ctx, game.input.pointer); },
  };
}

createGame({
  canvas: document.getElementById('game'),
  gameId: 'combat-demo',
  background: '#1b2130',
  actions: {
    ...DEFAULT_ACTIONS, confirm: ['Enter'], attack: ['KeyJ', 'pointer', 'pad:x'], block: ['KeyK', 'ShiftLeft', 'ShiftRight', 'pad:lb'], dodge: ['Space', 'KeyL', 'pad:a'],
    throw: ['KeyF', 'KeyU', 'pad:rb'], swap: ['KeyQ', 'pad:y'], restart: ['KeyR'], shapes: ['KeyH'], mute: ['KeyM'],
  },
  scenes: { play },
});
