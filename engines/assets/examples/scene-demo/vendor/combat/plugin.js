// The combat engine as a base plugin. Actors join a fight; the hero is driven by the game
// layer's input (so not under a menu or a dialogue, in any view), everyone is moved through the
// collision plugin, and blows, blocks and deaths go out on the bus.
//   plugins: [collisionPlugin(), combatPlugin()]
//   base.plugin('combat').join('hero', { faction: 'player', hp: 20, weapon: 'sword' });
import { createCombat } from './combat.js';
import { facingOf } from './index.js';
import { bindPuppet } from './puppet.js';

/**
 * combatPlugin(options) -> plugin (requires 'collision'; uses 'puppet', 'audio')
 *   options: createCombat options (weapons, shields, throwables, statuses, factions, brains, unit, rng ...), plus
 *   hero      id of the actor the player controls (default 'hero')
 *   actions   input action names: { left, right, up, down, attack, block, dodge, throw } (defaults are those names)
 *   hitStop   seconds the whole game freezes on a kill or a critical hit (default 0.08; 0 = never). Needs the clock engine.
 *   pickup    true: the hero picks up thrown weapons it walks over (its ammo count goes up). Default false.
 *   drive     false: the plugin does not move actors or read input; the game calls combat.input / place itself.
 * base.plugin('combat') -> { combat, join(actor, fighterOptions), adopt(actor), leave(actor), fighter(id), aim, aimAt, save, load }
 *   join() adds the actor to the fight (`external`: the collision plugin moves it). actor.hp follows the fighter.
 *   aim: set { x, y } (a ground direction) to make the hero face that way instead of where it walks.
 *   aimAt: set { x, y } (a ground POINT in game metres, the mouse) and the hero faces it and throws at it. Wins over aim.
 *   Facing is left to combat: the hero does not turn in the middle of a swing, and walking with the guard up
 *   keeps the shield forward.
 * Rigged actors (the puppet plugin) act the fight out through bindPuppet: the swing starts with the wind-up so the
 * blade lands on the hit, and a rig made with `animator: combatAnimator(humanoidAnimator())` also shows block, throw and thrust.
 * Bus: 'combat:<type>' for every combat event (hit, death, block, parry, dodge, swing, throw, status, ...).
 */
export function combatPlugin(options = {}) {
  return {
    name: 'combat',
    requires: ['collision'],
    uses: ['puppet', 'audio'],
    actions: { attack: ['KeyJ', 'pad:x'], block: ['KeyH', 'pad:lb'], dodge: ['ControlLeft', 'pad:b'], throw: ['KeyF', 'pad:rb'] },
    install(base) {
      const { hero = 'hero', actions = {}, hitStop = 0.08, drive = true, pickup = false, ...combatOptions } = options;
      const col = base.plugin('collision');
      const names = { left: 'left', right: 'right', up: 'up', down: 'down', attack: 'attack', block: 'block', dodge: 'dodge', throw: 'throw', ...actions };
      const combat = createCombat({ collision: col.module, world: col.space, sceneryMask: col.layers.SCENERY, separate: false, ...combatOptions });
      // combat reads the world through the collision plugin's `space`: always the current world, in the game's metres
      // (fighters stand where their actors are, whatever the world's origin). After a swap the fighters are put again.
      base.bus.on('collision:world', () => { for (const id of joined) { const a = base.actors.get(id); if (a && combat.has(id)) combat.place(id, a.x, a.y); } });
      const joined = new Set();
      // rigs act the fight out. A binding is made as soon as a joined actor has a rig, and remade when the rig changes.
      const bound = new Map(); // actor id -> { character, binding }   (binding null: this rig cannot be bound, plain reactions are used)
      function bindRigs() {
        const puppets = base.has('puppet') ? base.plugin('puppet') : null;
        for (const [id, b] of bound) {
          if (joined.has(id) && combat.has(id) && puppets?.has(id) && puppets.character(id) === b.character) continue;
          b.binding?.dispose(); bound.delete(id);
        }
        if (!puppets) return;
        for (const id of joined) {
          if (bound.has(id) || !combat.has(id) || !puppets.has(id)) continue;
          const character = puppets.character(id);
          let binding = null;
          try { binding = bindPuppet(combat, id, character); } catch { /* a creature without the humanoid layers */ }
          bound.set(id, { character, binding });
        }
      }
      const api = {
        combat, aim: null, aimAt: null,
        join(a, fighterOptions = {}) {
          const actor = typeof a === 'string' ? base.actors.get(a) : a;
          if (!actor) throw new Error(`combat.join: no actor ${JSON.stringify(a)} (add it to base.actors first)`);
          combat.addFighter(actor.id, { x: actor.x, y: actor.y, external: true, ...fighterOptions });
          joined.add(actor.id);
          actor.hp = combat.fighter(actor.id).hp;
          bindRigs();
          return combat.fighter(actor.id);
        },
        /** Take in an actor whose fighter another plugin already added (the ai does this for its mobs). */
        adopt(a) { const actor = typeof a === 'string' ? base.actors.get(a) : a; if (!actor || !combat.has(actor.id)) throw new Error(`combat.adopt: no fighter for actor ${JSON.stringify(actor?.id ?? a)}`); joined.add(actor.id); actor.hp = combat.fighter(actor.id).hp; bindRigs(); },
        leave(a) { const id = typeof a === 'string' ? a : a?.id; if (joined.delete(id) && combat.has(id)) combat.removeFighter(id); bindRigs(); },
        fighter: (id) => combat.fighter(id),
        has: (id) => joined.has(id),
        save: () => ({ state: combat.toJSON(), joined: [...joined] }),
        load(data) { combat.load(data.state); joined.clear(); for (const id of data.joined ?? []) if (combat.has(id)) joined.add(id); },
      };
      base.bus.on('actors:removed', ({ actor }) => api.leave(actor.id));
      combat.on('*', (e) => {
        base.bus.emit('combat:' + e.type, e);
        const who = e.type === 'hit' ? e.target : e.id;
        const plain = who && bound.get(who);
        if (plain && !plain.binding) { // a rig bindPuppet could not take: the plain reactions
          const c = plain.character;
          if (e.type === 'attack' || e.type === 'throwStart') c.attack?.(); else if (e.type === 'hit' && e.damage > 0 && !e.blocked && !e.killed) c.hurt?.(); else if (e.type === 'death') c.die?.(); else if (e.type === 'revive') c.revive?.();
        }
        if (hitStop > 0 && (e.type === 'death' || (e.type === 'hit' && e.crit))) base.loop.hitStop?.(hitStop);
      });
      base.on('sim', bindRigs, { order: 99, owner: 'combat' }); // also with drive: false; a rig added later is picked up here
      if (drive) base.on('sim', (dt) => {
        if (joined.has(hero) && combat.has(hero)) {
          const input = base.input.game;
          let mx = input.axis(names.left, names.right); let my = input.axis(names.up, names.down);
          const ground = base.views.current?.toGround?.(mx, my); // a view may turn screen directions into ground directions
          if (ground) [mx, my] = ground;
          const size = Math.hypot(mx, my);
          if (size > 1) { mx /= size; my /= size; }
          const held = { moveX: mx, moveY: my, attack: input.down(names.attack) || input.pressed(names.attack), block: input.down(names.block), dodge: input.pressed(names.dodge), throw: input.pressed(names.throw) };
          // combat turns the fighter itself (toward the aim point, the aim direction, or where it walks) and only when it may turn
          if (api.aimAt && Number.isFinite(api.aimAt.x) && Number.isFinite(api.aimAt.y)) { held.aimX = api.aimAt.x; held.aimY = api.aimAt.y; }
          else if (api.aim && (api.aim.x || api.aim.y)) held.face = facingOf(api.aim.x, api.aim.y);
          combat.input(hero, held);
        }
        for (const id of joined) { const a = base.actors.get(id); if (a && combat.has(id)) { const f = combat.fighter(id); if (f.x !== a.x || f.y !== a.y) combat.place(id, a.x, a.y); } }
        combat.step(dt);
        if (pickup && joined.has(hero) && combat.has(hero) && combat.fighter(hero).alive && combat.projectiles.length) combat.pickup(hero);
        for (const id of joined) { // recipe 4 of the combat README: combat tells the push, the collision world moves
          const actor = base.actors.get(id);
          if (!actor || !combat.has(id)) continue;
          const f = combat.fighter(id); const push = combat.pushOf(id);
          const speed = (f.speed ?? 0) * combat.moveScale(id);
          col.move(actor, (f.input?.moveX ?? 0) * speed * dt + push.dx, (f.input?.moveY ?? 0) * speed * dt + push.dy);
          combat.place(id, actor.x, actor.y);
          actor.hp = f.hp; actor.alive = f.alive; actor.facing = f.facing;
        }
      }, { order: 100, owner: 'combat' });
      return api;
    },
  };
}
