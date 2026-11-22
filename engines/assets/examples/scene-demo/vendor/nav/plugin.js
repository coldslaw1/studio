// The nav engine as a plugin for the base engine (createBase({ plugins: [navPlugin()] })).
// It imports only its own engine; everything else comes through `base` or `options`.
import { createNav, bindCollision, bindAi, drawNav } from './index.js';

/**
 * navPlugin(options) -> plugin
 *   options   everything createNav takes (cellSize, bounds, chunkCells, planner, ...), plus:
 *     nav         a nav you made yourself, instead of the plugin making one
 *     focus       = 'player': id of the actor the field follows in a streamed world
 *     collision   = true: when a 'collision' plugin is installed, its scenery becomes nav props (at install, at
 *                 'base:started', on every 'collision:scenery' and after every 'collision:world' swap) and walkers
 *                 that are actors are moved with its move(). base.plugin('nav').collision is the current link
 *                 (null without a collision plugin); it changes when the world is swapped, so do not keep it.
 *                 Everything nav takes and gives stays in the game's metres: props are placed at body position +
 *                 the collision plugin's origin, and los() uses its space.raycast.
 *     scenery     (body) => boolean: which collision bodies are props. Default: every body without an `actor` field
 *                 (the collision plugin marks the bodies it makes for actors). A game that makes people's bodies
 *                 itself passes its own test, for example (b) => b.layer === 1.
 * base.plugin('nav') -> { nav, walk(actorId, x, y, opts), stop(actorId), link, collision, los(x0, y0, x1, y1), save, load }
 *   walk    sends a base actor somewhere: it gets a nav agent (radius and speed from the actor) and its x, y and
 *           facing follow the agent every tick
 *   link    bindAi(nav) for the ai: createAi({ grid: link.grid(), move: link.move }), link.attach(ai)
 * Bus events: 'nav:arrive', 'nav:stuck', 'nav:blocked', 'nav:repath', 'nav:path' with the nav event as payload.
 * Setting: 'nav.debug' (toggle) draws what the walkers know on the overlay layer.
 */
export function navPlugin(options = {}) {
  return {
    name: 'nav',
    requires: [],
    uses: ['collision', 'world'],
    settings: [{ id: 'nav.debug', label: 'Show navigation', type: 'toggle', value: false, group: 'Debug' }],
    install(base) {
      const { nav: given, focus = 'player', collision = true, scenery = (b) => b.actor === undefined, ...navOptions } = options;
      if (typeof scenery !== 'function') throw new Error(`navPlugin: scenery must be a function (body) => boolean, got ${typeof scenery}`);
      const nav = given ?? createNav(navOptions);
      let debug = false; let palette = null;
      // With a collision plugin: its scenery becomes nav props (now, when the game starts, whenever scenery is
      // added, and again when the game swaps the world), and walkers that are actors are moved by its move(),
      // so they use the body the collision plugin already gave them. The world is never kept: it is read
      // from the plugin each time, because the game may swap it.
      let solid = null;
      const col = collision && base.has('collision') ? base.plugin('collision') : null;
      const isWorld = (w) => !!w && typeof w.move === 'function' && Array.isArray(w.bodies);
      const bindWorldNow = () => {
        nav.removeGroup('collision');
        // bodies are in the world's own metres, actors and nav in the game's: props go at body position + origin
        solid = isWorld(col.world) ? bindCollision(nav, col.world, { bodies: false, origin: col.origin ?? { x: 0, y: 0 } }) : null;
        if (solid) solid.importBodies({ filter: scenery });
      };
      if (col) {
        bindWorldNow();
        const again = () => { if (solid) solid.importBodies({ filter: scenery }); };
        base.bus.on('collision:scenery', again);
        base.bus.on('base:started', again);
        base.bus.on('collision:world', (e) => {
          const off = e?.offset ?? { x: 0, y: 0 };
          if (off.x || off.y) nav.shift(off.x, off.y); // the ground moved under everyone: goals and paths move with it
          bindWorldNow();                              // the old world's props go, the new world's come in
          for (const a of nav.agents()) if (a.goal) nav.setPosition(a.id, a.x, a.y); // plan again on the new ground
        });
        if (typeof col.move === 'function') {
          nav.setMover((agent, dx, dy, ghost) => {
            const actor = base.actors.get(agent.id);
            if (!actor) return null; // not an actor: nav slides it on its own field
            if (ghost && typeof col.teleport === 'function') col.teleport(actor, actor.x + dx, actor.y + dy); else col.move(actor, dx, dy);
            return { x: actor.x, y: actor.y };
          });
        }
      }
      const link = bindAi(nav);
      const walking = new Set();
      base.on('sim', (dt) => {
        for (const id of walking) { // the actor is the truth: someone else may have moved it since the last tick
          const actor = base.actors.get(id); const a = nav.has(id) ? nav.get(id) : null;
          if (!actor || !a) { walking.delete(id); if (a) nav.remove(id); continue; }
          if (Math.abs(actor.x - a.x) > 1e-4 || Math.abs(actor.y - a.y) > 1e-4) nav.setPosition(id, actor.x, actor.y);
        }
        const f = typeof focus === 'string' ? base.actors.get(focus) : focus;
        nav.step(dt, f ? { focus: f } : {});
        for (const id of walking) { const actor = base.actors.get(id); const a = nav.get(id); actor.x = a.x; actor.y = a.y; if (a.goal) actor.facing = a.facing; }
      }, { order: -10 });
      base.on('draw:overlay', (ctx) => {
        if (!debug) return;
        drawNav(ctx, nav, { toScreen: (x, y) => base.views.toScreen(x, y, 0), colours: palette ? { path: palette.danger, agent: palette.accent, goal: palette.good } : {} });
      });
      base.settings.watch('nav.debug', (on) => { debug = !!on; });
      base.style.watch((tokens) => { palette = tokens?.palette ?? null; });
      base.bus.on('actors:removed', (e) => { const id = e?.actor?.id; if (id !== undefined && walking.delete(id)) nav.remove(id); });
      nav.on('*', (e) => { if (e.type !== 'remove') base.bus.emit(`nav:${e.type}`, e); });
      const agentFor = (actorId, who) => {
        const actor = base.actors.get(actorId);
        if (!actor) throw new Error(`${who}: no actor with id ${JSON.stringify(actorId)}`);
        if (!nav.has(actorId)) nav.add({ id: actorId, x: actor.x, y: actor.y, radius: Math.min(actor.radius ?? nav.config.radius, nav.config.maxRadius), speed: actor.speed ?? nav.config.speed });
        walking.add(actorId);
        return actor;
      };
      return {
        nav, link, get collision() { return solid; },
        /** los(x0, y0, x1, y1) -> true when no scenery lies on the line (game metres). Without a collision plugin: nav's own field. */
        los(x0, y0, x1, y1) {
          if (col?.space && typeof col.space.raycast === 'function') return !col.space.raycast(x0, y0, x1, y1, { mask: col.layers?.SCENERY ?? -1 });
          return solid ? solid.los(x0, y0, x1, y1) : nav.field().lineClear(x0, y0, x1, y1, 0);
        },
        walk(actorId, x, y, o) { const actor = agentFor(actorId, 'nav.walk'); nav.setPosition(actorId, actor.x, actor.y); return nav.goTo(actorId, x, y, o); },
        stop(actorId) { if (nav.has(actorId)) nav.stop(actorId); },
        save: () => ({ ...nav.toJSON(), walking: [...walking].sort() }),
        load(data) { nav.load(data); walking.clear(); for (const id of data.walking ?? []) if (nav.has(id)) walking.add(id); },
      };
    },
  };
}
