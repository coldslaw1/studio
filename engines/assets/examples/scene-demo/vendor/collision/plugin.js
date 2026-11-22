// The collision engine as a base plugin: one collision world for the game. Actors that should
// block and be blocked get a body by themselves; everything that moves an actor goes through
// move(), so nobody walks through a wall whichever engine did the moving.
//   plugins: [collisionPlugin({ cellSize: 4, skin: 0.005 })]
//   const col = base.plugin('collision');  col.scenery({ x: 4, y: -3, w: 0.5, h: 6 });  col.move('hero', dx, dy);
import * as collisionModule from './index.js';

/** Layer bits: scenery (walls, trees, water) and actors (people, mobs, solid props). */
export const LAYERS = Object.freeze({ SCENERY: 1, ACTOR: 2 });

/**
 * collisionPlugin(options) -> plugin
 *   options: createCollisionWorld options (cellSize default 4, skin default 0.005: ground metres).
 *   options.solid   (actor) => boolean: which actors get a body. Default: kind 'person' or 'mob', or actor.solid === true.
 *   options.world   a collision world the game already has (a stage's own): the plugin adopts it instead of making one.
 *   options.origin  { x, y }: where that world's (0, 0) lies in the game's metres. Default { x: 0, y: 0 }.
 * base.plugin('collision') -> { world, origin, space, module, layers, scenery(shape), move(actor, dx, dy),
 *                               teleport(actor, x, y), bodyOf(actor), setWorld, toLocal, toWorld }
 *   move / teleport take an actor or its id, keep actor.x and actor.y in step with the body, and return the world's result.
 *   An actor moved by writing actor.x / actor.y (a load, a script) is picked up at the end of the tick.
 *
 * Two kinds of metres. Actors, and everything this plugin takes or gives (move, teleport, scenery, space), are in the
 * GAME's metres. The bodies inside `world` are in the WORLD's own metres: game metres minus `origin`. With the default
 * origin the two are the same and nothing here matters. An open world that builds one collision world per page, each
 * starting at its own (0, 0), sets the origin to the page's corner: actors keep their open-world metres for good.
 *   space     the world seen in game metres: cast, raycast, raycastAll, query, queryPoint with the world's own
 *             signatures. Points go in and hits come out in game metres. It always reads the current world, so it
 *             may be kept (combat keeps it). Use it instead of `world` whenever your numbers come from actors.
 *   toLocal(x, y) / toWorld(x, y)  game metres -> the world's metres and back, as { x, y }.
 *   world     the raw world (its metres). Read it each time; never keep it in a variable. Bodies read from it
 *             (world.bodies, bodyOf(actor), the hits of move()) are in the world's metres: add `origin` to place them.
 *
 * setWorld(world, { origin, offset, moveActors }) swaps the world (a new level, the next page of an open world). Every
 * actor's body is made again in the new world.
 *   origin   { x, y }: the new world's (0, 0) in game metres. Left out, the origin stays as it was. Actors do not move.
 *   offset   { x, y }: for games WITHOUT an origin, whose actors live in page metres: how far the ground moved under
 *            everyone. It is added to every actor's x and y, unless moveActors is false because the game moved them.
 *   The bus gets 'collision:world' { world, previous, offset, origin, previousOrigin }; plugins that keep the world
 *   follow it. Calling setWorld with the same world and only a new origin is allowed (the bodies are put again).
 */
export function collisionPlugin(options = {}) {
  return {
    name: 'collision',
    install(base) {
      const { solid = (a) => a.solid === true || (a.solid !== false && (a.kind === 'person' || a.kind === 'mob')), world: given, origin: givenOrigin, ...worldOptions } = options;
      const isWorld = (w) => !!w && typeof w.add === 'function' && typeof w.move === 'function' && typeof w.teleport === 'function' && typeof w.remove === 'function';
      const point = (p, who, what) => {
        const out = { x: p?.x ?? 0, y: p?.y ?? 0 };
        if ((p !== undefined && (p === null || typeof p !== 'object')) || !Number.isFinite(out.x) || !Number.isFinite(out.y)) throw new Error(`${who}: ${what} must be { x, y } numbers, got ${JSON.stringify(p)}`);
        return out;
      };
      if (given !== undefined && !isWorld(given)) throw new Error(`collisionPlugin: options.world must be a collision world (createCollisionWorld), got ${typeof given}`);
      let world = given ?? collisionModule.createCollisionWorld({ cellSize: 4, skin: 0.005, ...worldOptions });
      let origin = point(givenOrigin, 'collisionPlugin', 'options.origin');
      const offs = []; // the world's own events, re-published on the bus; taken off the old world on a swap
      const listen = () => { for (const name of ['enter', 'exit']) { try { const off = world.on(name, (...args) => base.bus.emit('collision:' + name, args.length === 1 ? args[0] : args)); if (typeof off === 'function') offs.push(off); } catch { /* this world sends no such event */ } } };
      const bodies = new Map(); // actor id -> body (in the world's metres)
      const seen = new Map();   // actor id -> { x, y }: where the actor was (game metres) when its body was last put
      const actorOf = (a, who) => {
        const actor = typeof a === 'string' ? base.actors.get(a) : a;
        if (!actor) throw new Error(`collision.${who}: no actor ${JSON.stringify(a)}`);
        return actor;
      };
      const note = (actor) => { const s = seen.get(actor.id); if (s) { s.x = actor.x; s.y = actor.y; } else seen.set(actor.id, { x: actor.x, y: actor.y }); };
      const moved = (actor) => { const s = seen.get(actor.id); return !s || s.x !== actor.x || s.y !== actor.y; };
      const put = (actor, body) => { world.teleport(body, actor.x - origin.x, actor.y - origin.y); note(actor); };
      const follow = (actor, body) => { actor.x = body.x + origin.x; actor.y = body.y + origin.y; note(actor); };
      const give = (actor) => {
        if (bodies.has(actor.id) || !solid(actor)) return;
        bodies.set(actor.id, world.add({ x: actor.x - origin.x, y: actor.y - origin.y, r: actor.radius, layer: LAYERS.ACTOR, actor: actor.id }));
        note(actor);
      };
      for (const actor of base.actors.list()) give(actor);
      base.bus.on('actors:added', ({ actor }) => give(actor));
      base.bus.on('actors:removed', ({ actor }) => { const body = bodies.get(actor.id); if (body) { world.remove(body); bodies.delete(actor.id); } seen.delete(actor.id); });
      // someone wrote actor.x / actor.y directly: bring the body along
      base.on('post', () => {
        for (const [id, body] of bodies) { const a = base.actors.get(id); if (a && moved(a)) put(a, body); }
      }, { order: -500, owner: 'collision' });
      listen();

      // the world in game metres
      const local = (shape) => (shape && typeof shape.id === 'number' && world.bodies?.includes(shape)) ? shape : { ...shape, x: shape.x - origin.x, y: shape.y - origin.y };
      const out = (hit) => { if (hit && typeof hit.x === 'number' && typeof hit.y === 'number') { hit.x += origin.x; hit.y += origin.y; } return hit; };
      const space = Object.freeze({
        cast: (shape, dx, dy, opts) => out(world.cast(local(shape), dx, dy, opts)),
        raycast: (x0, y0, x1, y1, opts) => out(world.raycast(x0 - origin.x, y0 - origin.y, x1 - origin.x, y1 - origin.y, opts)),
        raycastAll: (x0, y0, x1, y1, opts) => world.raycastAll(x0 - origin.x, y0 - origin.y, x1 - origin.x, y1 - origin.y, opts).map(out),
        query: (shape, opts) => world.query(local(shape), opts),
        queryPoint: (x, y, opts) => world.queryPoint(x - origin.x, y - origin.y, opts),
      });

      return {
        get world() { return world; }, get origin() { return { x: origin.x, y: origin.y }; }, space, module: collisionModule, layers: LAYERS,
        toLocal: (x, y) => ({ x: x - origin.x, y: y - origin.y }),
        toWorld: (x, y) => ({ x: x + origin.x, y: y + origin.y }),
        setWorld(next, o = {}) {
          if (!isWorld(next)) throw new Error(`collision.setWorld: needs a collision world (createCollisionWorld), got ${typeof next}`);
          const offset = point(o.offset, 'collision.setWorld', 'offset');
          const previousOrigin = origin;
          const nextOrigin = o.origin === undefined ? origin : point(o.origin, 'collision.setWorld', 'origin');
          const previous = world;
          if (next !== previous) {
            for (const off of offs.splice(0)) off();
            for (const body of bodies.values()) { try { previous.remove(body); } catch { /* the old world is already gone */ } }
            bodies.clear(); world = next; listen();
          }
          origin = nextOrigin;
          for (const actor of base.actors.list()) {
            if (o.moveActors !== false && (offset.x || offset.y)) { actor.x += offset.x; actor.y += offset.y; }
            const body = bodies.get(actor.id);
            if (body) put(actor, body); else give(actor);
          }
          base.bus.emit('collision:world', { world, previous, offset, origin: { x: origin.x, y: origin.y }, previousOrigin: { x: previousOrigin.x, y: previousOrigin.y } });
          return world;
        },
        // a shape in game metres; heard by path finders (nav). The body it returns is in the world's metres.
        scenery(shape) { const body = world.add({ ...shape, x: shape.x - origin.x, y: shape.y - origin.y, layer: LAYERS.SCENERY }); base.bus.emit('collision:scenery', { body }); return body; },
        bodyOf(a) { return bodies.get(actorOf(a, 'bodyOf').id) ?? null; },
        move(a, dx, dy) {
          const actor = actorOf(a, 'move'); const body = bodies.get(actor.id);
          if (!body) { actor.x += dx; actor.y += dy; return { dx, dy, hits: [] }; }
          if (moved(actor)) put(actor, body);
          const res = world.move(body, dx, dy);
          follow(actor, body);
          return res;
        },
        teleport(a, x, y) {
          const actor = actorOf(a, 'teleport'); const body = bodies.get(actor.id);
          actor.x = x; actor.y = y;
          if (body) put(actor, body);
        },
      };
    },
  };
}
