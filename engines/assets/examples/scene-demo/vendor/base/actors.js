// Actors: everyone and everything that stands in the world, in one shape, whatever view shows
// them. Views draw from this list; combat, the ai, the bag and bots find people in it.
//   { id, x, y, z = 0, radius = 0.3, kind = 'prop', puppet = null, hidden = false, ...your own fields }
// x and y are ground metres, z is metres above the ground.

/**
 * createActors(options) -> actors
 *   options.bus   optional bus: 'actors:added' { actor }, 'actors:removed' { actor }
 * actors:
 *   add(actor)       register (id must be new, x and y numbers). Returns the stored actor (the same object, defaults filled in).
 *   remove(id)       returns true when it was there
 *   get(id), has(id), list(kind?)   list is in the order added; `kind` filters
 *   near(x, y, reach, filter?)  the nearest actor within reach metres (not hidden), or null
 *   count, clear()
 */
export function createActors(options = {}) {
  const { bus = null } = options;
  const map = new Map();
  const actors = {
    add(actor) {
      if (!actor || typeof actor !== 'object') throw new Error(`actors.add: expected an actor object, got ${JSON.stringify(actor)}`);
      if (typeof actor.id !== 'string' || !actor.id) throw new Error(`actors.add: actor.id must be a non-empty string, got ${JSON.stringify(actor.id)}`);
      if (map.has(actor.id)) throw new Error(`actors.add: an actor with id '${actor.id}' is already there`);
      if (!Number.isFinite(actor.x) || !Number.isFinite(actor.y)) throw new Error(`actors.add: actor '${actor.id}' needs numbers for x and y, got ${actor.x}, ${actor.y}`);
      actor.z ??= 0; actor.radius ??= 0.3; actor.kind ??= 'prop'; actor.puppet ??= null; actor.hidden ??= false;
      map.set(actor.id, actor);
      bus?.emit('actors:added', { actor });
      return actor;
    },
    remove(id) {
      const actor = map.get(id);
      if (!actor) return false;
      map.delete(id);
      bus?.emit('actors:removed', { actor });
      return true;
    },
    get(id) { return map.get(id) ?? null; },
    has(id) { return map.has(id); },
    list(kind) { const all = [...map.values()]; return kind ? all.filter((a) => a.kind === kind) : all; },
    near(x, y, reach, filter) {
      let best = null; let bestD = reach;
      for (const a of map.values()) {
        if (a.hidden || (filter && !filter(a))) continue;
        const d = Math.hypot(a.x - x, a.y - y);
        if (d <= bestD) { best = a; bestD = d; }
      }
      return best;
    },
    get count() { return map.size; },
    clear() { for (const id of [...map.keys()]) actors.remove(id); },
  };
  return actors;
}
