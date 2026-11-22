// The combat engine hook. The two engines never import each other: this file talks to a combat object
// by its public shape only. Division of work: the ai decides who to fight, where to stand and when to
// press the buttons; combat owns swing timing, damage, statuses and moving the bodies.
//
// Per tick:  link.sync();  ai.step(dt, { focus });  combat.step(dt);
import { need, q, sortedKeys } from './util.js';
import { addThreat } from './perception.js';

/**
 * bindCombat(ai, combat, options) -> link
 *   name = 'studio'   the brain name fighters use: createCombat({ brains: { studio: link.brain } }) and
 *                     addFighter(id, { ai: { brain: 'studio' } }). Because createCombat needs the brain before
 *                     the link exists, bindCombat may be called with combat = null first and link.attach(combat) later.
 *   reach(fighter)    optional: how far the fighter's weapon reaches, e.g. (f) => reachOf(combat.config, f) * 0.85;
 *                     keeps a melee agent's attack.range in step with its weapon
 *   outline(fighter, facing)  optional: the shape for 'telegraph' events, e.g. combat's moveOutline
 * link: { brain, attach(combat), sync(), add(id, fighterOptions, agentOptions), dispose() }
 *   brain   (sim, fighter, input) => void, the function to register with combat
 *   sync()  copies fighter bodies into the ai (positions, health, busy and stagger flags, threat from damage) and
 *           mirrors fighters the ai does not control (players) as bodies. Call it before ai.step.
 *   add()   makes the agent and its fighter together, with matching speed, radius and health
 */
export function bindCombat(ai, combat = null, options = {}) {
  need(ai && typeof ai.step === 'function' && typeof ai.setBody === 'function', 'bindCombat: first argument must be an ai from createAi');
  const name = options.name ?? 'studio';
  let pending = []; // ai events to hand to combat's event stream, in order
  let offs = [];
  const mirrored = new Set();

  function attach(c) {
    need(c && typeof c.fighters === 'function' && typeof c.on === 'function', 'bindCombat: combat must be a combat object from createCombat');
    for (const off of offs) off();
    combat = c;
    offs = [
      ai.on('telegraph', (e) => pending.push(e)), ai.on('aggro', (e) => pending.push(e)), ai.on('deaggro', (e) => pending.push(e)),
      combat.on('death', (e) => {
        if (ai.has(e.id)) { if (ai.get(e.id).alive) ai.kill(e.id, e.by ?? null); } else if (ai.state.bodies[e.id]) ai.setBody(e.id, { x: e.x, y: e.y, alive: false });
      }),
      combat.on('hit', (e) => { if (Number.isFinite(e.x) && Number.isFinite(e.y)) ai.sound({ x: e.x, y: e.y, loud: 10 * ai.config.unit, kind: 'fight', by: e.source ?? null }); }),
    ];
    return link;
  }

  const link = {
    name,
    attach,
    brain(sim, fighter, input) {
      const a = ai.state.agents[fighter.id];
      if (!a || !a.alive) return;
      const i = a.intent;
      input.moveX = i.moveX; input.moveY = i.moveY; input.face = i.face;
      input.attack = i.attack; input.block = i.block; input.dodge = i.dodge; input.throw = i.throw; input.aimX = i.aimX; input.aimY = i.aimY;
      i.attack = false; i.throw = false; i.dodge = false; // buttons are presses: one combat step each
      if (pending.length) {
        const mine = pending.filter((e) => e.id === fighter.id);
        if (mine.length) pending = pending.filter((e) => e.id !== fighter.id);
        for (const e of mine) {
          if (e.type === 'telegraph') sim.events.push({ type: 'telegraph', id: e.id, target: e.target, time: e.time, attack: e.attack, shape: e.attack === 'melee' && options.outline ? options.outline(fighter, e.facing) : null });
          else if (e.type === 'aggro') sim.events.push({ type: 'aggro', id: e.id, target: e.target });
          else sim.events.push({ type: 'deaggro', id: e.id });
        }
      }
    },
    sync() {
      need(combat, 'bindCombat: call link.attach(combat) before link.sync()');
      pending.length = 0; // anything combat did not pick up last tick belongs to an agent without a fighter
      const seen = new Set();
      for (const f of combat.fighters()) {
        seen.add(f.id);
        const a = ai.state.agents[f.id];
        if (!a) {
          ai.setBody(f.id, { x: f.x, y: f.y, facing: f.facing, radius: f.radius, hp: f.hp, maxHp: f.maxHp, alive: f.alive, faction: f.faction });
          mirrored.add(f.id);
          continue;
        }
        a.driven = true;
        a.x = q(f.x); a.y = q(f.y); a.facing = f.facing; a.hp = f.hp; a.maxHp = f.maxHp;
        if (f.speed > 0) { a.run = f.speed; if (a.speed > a.run) a.speed = a.run; }
        a.busy = f.act.kind === 'attack' || f.act.kind === 'throw';
        a.staggered = f.act.kind === 'stagger' || f.act.kind === 'dodge';
        if (options.reach && a.attack.style === 'melee') a.attack.range = q(options.reach(f));
        const threat = f.ai && f.ai.threat;
        if (threat) { // combat notes who hurt this fighter; move those notes into the agent's own table
          for (const src of sortedKeys(threat)) {
            const s = combat.has(src) ? combat.fighter(src) : null;
            if (threat[src] > 0 && s) { addThreat(a, src, 1 + threat[src] * 2, { x: s.x, y: s.y, t: ai.time }); a.alarm = q(ai.time + 6); }
          }
          f.ai.threat = {};
        }
      }
      for (const id of [...mirrored]) if (!seen.has(id)) { ai.removeBody(id); mirrored.delete(id); }
      for (const a of ai.agents()) if (a.driven && !seen.has(a.id)) ai.remove(a.id); // its fighter was removed
      return link;
    },
    add(id, fighterOptions = {}, agentOptions = {}) {
      need(combat, 'bindCombat: call link.attach(combat) before link.add()');
      const a = ai.add({ ...agentOptions, id, x: fighterOptions.x ?? agentOptions.x, y: fighterOptions.y ?? agentOptions.y, driven: true });
      const f = combat.addFighter(id, { faction: a.faction, radius: a.radius, speed: a.run, hp: a.maxHp, maxHp: a.maxHp, ...fighterOptions, ai: { ...(typeof fighterOptions.ai === 'object' ? fighterOptions.ai : {}), brain: name } });
      a.faction = f.faction;
      return a;
    },
    dispose() { for (const off of offs) off(); offs = []; pending = []; },
  };
  if (combat) attach(combat);
  return link;
}
