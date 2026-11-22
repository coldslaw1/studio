// The ai engine as a base plugin: people and mobs with minds. Agents are actors like everyone
// else, keep the same hour as the rest of the game, walk through the collision plugin, fight
// through the combat plugin and are animated by the puppet plugin, when those are in the game.
//   plugins: [aiPlugin({ grid })]
//   base.plugin('ai').add({ id: 'ann', kind: 'villager', x: 8, y: 8 }, { model: 'villager' });
import { createAi } from './ai.js';
import { bindCombat } from './bind-combat.js';

const AI_EVENTS = ['goal', 'anim', 'activity', 'bark', 'spotted', 'aggro', 'deaggro', 'telegraph', 'attack', 'hurt', 'death', 'standing', 'talk', 'talkEnd', 'chat'];
const MOBS = new Set(['wolf', 'boar', 'rat', 'bat', 'slime', 'goblin', 'orc', 'ogre', 'skeleton', 'ghoul', 'imp', 'golem', 'bandit', 'cultist']);

/**
 * aiPlugin(options) -> plugin (uses 'sky', 'collision', 'combat', 'puppet', 'ui')
 *   options: createAi options (grid, places, factions, archetypes, seed ...), plus
 *   hero       id of the player's actor (default 'hero'): the ai sees it, and simulates in full detail around it
 *   heroFaction  default 'player'
 *   modes      game modes in which the minds live (array of mode names, e.g. ['hamlet']). Default: every mode. In other
 *              modes the agents stand still; when the mode comes back they pick up at the game's current hour.
 *   barks      true: barks become ui toasts when the ui plugin is in (default false; the bus always gets them)
 * dayLength and startHour are taken from the game's clock, so schedules follow the sky.
 * base.plugin('ai') -> { ai, add(agentOptions, { model, fighter }), remove(id), save, load }
 *   add() makes the agent and its actor. `model` rigs it with the puppet plugin. `fighter` (combat
 *   fighter options) also puts it in the fight, with the ai pressing its buttons.
 * Bus: 'ai:<event>' for goal, anim, activity, bark, spotted, aggro, deaggro, telegraph, attack, hurt, death, standing, talk, talkEnd, chat.
 */
export function aiPlugin(options = {}) {
  return {
    name: 'ai',
    uses: ['sky', 'collision', 'combat', 'puppet', 'ui', 'nav'],
    install(base) {
      const { hero = 'hero', heroFaction = 'player', barks = false, modes, ...aiOptions } = options;
      if (modes !== undefined && !Array.isArray(modes)) throw new Error(`aiPlugin: modes must be an array of mode names, got ${JSON.stringify(modes)}`);
      const col = base.has('collision') ? base.plugin('collision') : null;
      const fight = base.has('combat') ? base.plugin('combat') : null;
      const clock = base.time.source.config ?? {};
      const navLink = base.has('nav') ? base.plugin('nav').link ?? null : null;
      const ai = createAi({
        dayLength: clock.dayLength ?? 1200, startHour: base.time.hour,
        ...(col ? { move(agent, dx, dy) { const actor = base.actors.get(agent.id); if (!actor) return { x: agent.x + dx, y: agent.y + dy }; col.move(actor, dx, dy); return { x: actor.x, y: actor.y }; } } : {}),
        // with the nav plugin in the game, its grid and its steering are used unless the game passed its own grid
        ...(navLink && !aiOptions.grid ? { grid: navLink.grid(), move: navLink.move } : {}),
        ...aiOptions,
      });
      if (navLink && !aiOptions.grid) navLink.attach(ai);
      let link = null;
      if (fight) { link = bindCombat(ai, fight.combat, {}); fight.combat.config.brains.studio = link.brain; }
      for (const name of AI_EVENTS) ai.on(name, (e) => base.bus.emit('ai:' + name, e));
      if (barks) ai.on('bark', (e) => { if (base.has('ui')) base.plugin('ui').ui.toast(`${e.id}: ${e.text}`, 2.5); });
      const mine = new Set();
      const setHour = () => { const gap = ((base.time.hour - ai.hour) % 24 + 36) % 24 - 12; if (Math.abs(gap) > 0.02) ai.setHour(base.time.hour); };
      base.bus.on('time:jump', setHour);
      // the ground moved under everyone (the collision plugin swapped its world with an offset): the minds move along
      base.bus.on('collision:world', ({ offset }) => { if (!offset || (!offset.x && !offset.y)) return; for (const id of mine) { if (!ai.has(id)) continue; const a = ai.get(id); a.x += offset.x; a.y += offset.y; } });
      const api = {
        ai,
        add(agentOptions, extra = {}) {
          const o = agentOptions ?? {};
          if (typeof o.id !== 'string') throw new Error(`ai.add: agent options need an id, got ${JSON.stringify(o.id)}`);
          const agent = extra.fighter && link ? link.add(o.id, { x: o.x, y: o.y, external: true, ...extra.fighter }, o) ?? ai.get(o.id) : ai.add(o);
          const a = ai.get(o.id);
          const actor = base.actors.get(o.id) ?? base.actors.add({ id: o.id, x: a.x, y: a.y, radius: a.radius ?? 0.3, kind: MOBS.has(a.kind) ? 'mob' : 'person', agent: true });
          mine.add(o.id);
          if (extra.fighter && fight) fight.adopt(actor);
          if (extra.model && base.has('puppet')) {
            const character = base.plugin('puppet').rig(actor, extra.model, extra.rig ?? {});
            const only = (fn) => (e) => { if (e.id === o.id) fn(e); };
            ai.on('anim', only((e) => { if (!extra.fighter && (e.anim === 'attack' || e.anim === 'charge')) character.attack(); }));
            ai.on('hurt', only(() => { if (!extra.fighter) character.hurt(); }));
            ai.on('death', only(() => character.die()));
            ai.on('talk', only(() => character.wave(true))); ai.on('talkEnd', only(() => character.wave(false)));
          }
          return agent ?? a;
        },
        remove(id) { if (ai.has(id)) ai.remove(id); mine.delete(id); base.actors.remove(id); },
        save: () => ({ state: ai.toJSON(), mine: [...mine] }),
        load(data) { ai.load(data.state); mine.clear(); for (const id of data.mine ?? []) if (ai.has(id)) mine.add(id); setHour(); },
      };
      base.on('sim', (dt) => {
        const h = base.actors.get(hero);
        if (h && !(fight && fight.has(hero))) ai.setBody(hero, { x: h.x, y: h.y, faction: heroFaction, radius: h.radius, ...(h.hp !== undefined ? { hp: h.hp, maxHp: h.maxHp ?? h.hp } : {}) });
        setHour();
        link?.sync();
        ai.step(dt, h ? { focus: h } : {});
        for (const id of mine) {
          const actor = base.actors.get(id);
          if (!ai.has(id)) { if (actor && !fight?.has(id)) { actor.alive = false; } continue; }
          if (!actor) continue;
          const a = ai.get(id);
          if (!fight?.has(id)) { actor.x = a.x; actor.y = a.y; actor.hp = a.hp; actor.alive = a.alive; }
          actor.facing = a.facing; actor.anim = a.anim; actor.goal = a.goal;
        }
        if (h && !fight && ai.state.bodies?.[hero]?.hp !== undefined && h.hp !== undefined) h.hp = ai.state.bodies[hero].hp;
      }, { order: 50, owner: 'ai', ...(modes ? { modes } : {}) });
      return api;
    },
  };
}
