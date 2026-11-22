// Hooks to the other engines. Nothing is imported: each hook takes the other engine's object.
//   bindCollision(nav, world)   collision bodies become props; agents are moved by world.move
//   bindWorld(nav, world)       the world engine's chunks become nav chunks as they load and unload
//   bindAi(nav, ai)             the ai engine plans on nav's grid and its bodies steer round props
import { need, q, dist } from './util.js';
import { steerAround } from './steer.js';

/**
 * bindCollision(nav, world, options) -> link
 *   world     a collision world (createCollisionWorld)
 *   bodies    = true: every nav agent gets a round body in the world and is moved with world.move, so it can
 *             never end inside anything solid. false: the world is only read (importBodies, los).
 *   layer = 1, mask = -1   layer of the agents' bodies, and what blocks them
 *   origin    = { x: 0, y: 0 }: where the world's (0, 0) lies in nav's units, for a world that keeps its own
 *             page-local coordinates. Props are placed at body position + origin, and los takes nav's units.
 *             With an origin, use bodies: false (the mover would mix the two kinds of units).
 * link: { importBodies({ filter, group = 'collision', pad = 0 }) -> how many, bodyOf(id), los(x0, y0, x1, y1), release() }
 *   importBodies  adds every solid body (not triggers, tile grids, one-way platforms or agents' own bodies) as a nav
 *                 prop with id 'c' + body.id. Call it after building the level; call it again after adding more.
 */
export function bindCollision(nav, world, options = {}) {
  need(nav && typeof nav.setMover === 'function', 'bindCollision: first argument must be a nav from createNav');
  need(world && typeof world.move === 'function' && Array.isArray(world.bodies), 'bindCollision: second argument must be a collision world (createCollisionWorld)');
  const { layer = 1, mask = -1 } = options;
  const ox = options.origin?.x ?? 0; const oy = options.origin?.y ?? 0;
  need(Number.isFinite(ox) && Number.isFinite(oy), `bindCollision: origin must be { x, y } numbers, got ${JSON.stringify(options.origin)}`);
  need(options.bodies === false || (ox === 0 && oy === 0), 'bindCollision: with an origin, pass bodies: false and move the agents yourself (nav.setMover)');
  const bodies = new Map();
  const bodyFor = (a) => {
    let b = bodies.get(a.id);
    if (!b) { b = world.add({ x: a.x, y: a.y, r: a.radius, layer, mask, name: a.id, navAgent: true }); bodies.set(a.id, b); }
    return b;
  };
  if (options.bodies !== false) {
    nav.setMover((a, dx, dy, ghost) => {
      const b = bodyFor(a);
      if (Math.abs(b.x - a.x) > 1e-4 || Math.abs(b.y - a.y) > 1e-4) world.teleport(b, a.x, a.y); // the game moved the agent
      world.move(b, dx, dy, { mask, ghost: !!ghost });
      return { x: b.x, y: b.y };
    });
  }
  const off = nav.on('remove', (e) => { const b = bodies.get(e.id); if (b) { world.remove(b); bodies.delete(e.id); } });
  return {
    importBodies(o = {}) {
      const group = o.group ?? 'collision';
      let count = 0;
      for (const b of world.bodies) {
        if (b.trigger || b.tiles || b.oneWay || b.navAgent || (o.filter && !o.filter(b))) continue;
        const id = `c${b.id}`;
        if (nav.hasObstacle(id)) continue;
        const x = b.x + ox; const y = b.y + oy; // the body is in the world's units, the prop in nav's
        const shape = Array.isArray(b.points) ? { x, y, points: b.points } : b.r > 0 ? { x, y, r: b.r } : { x, y, w: b.w, h: b.h };
        nav.addObstacle(shape, { id, group, pad: o.pad ?? 0 });
        count += 1;
      }
      return count;
    },
    bodyOf: (id) => bodies.get(id) ?? null,
    /** los(x0, y0, x1, y1) -> true when nothing solid lies on the line (agents' bodies do not count). */
    los: (x0, y0, x1, y1) => !world.raycast(x0 - ox, y0 - oy, x1 - ox, y1 - oy, { mask, ignore: [...bodies.values()] }),
    release() { off(); nav.setMover(null); for (const b of bodies.values()) world.remove(b); bodies.clear(); },
  };
}

/**
 * navOptionsForWorld(world, { sub = 1 }) -> { cellSize, chunkCells } for createNav, so nav chunks line up with
 * the world engine's chunks. sub: nav cells per tile side (2 gives finer paths on big tiles).
 */
export function navOptionsForWorld(world, options = {}) {
  need(world && world.tileSize > 0 && world.chunkSize > 0, 'navOptionsForWorld: needs a world from the world engine (createWorld)');
  const sub = options.sub ?? 1;
  need(Number.isInteger(sub) && sub >= 1, `navOptionsForWorld: sub must be a whole number from 1, got ${String(sub)}`);
  return { cellSize: world.tileSize / sub, chunkCells: world.chunkSize * sub };
}

/**
 * bindWorld(nav, world, options) -> link. Keeps nav's ground in step with a streamed world: a chunk that
 * loads becomes a nav chunk, one that unloads is dropped, an edited tile is read again.
 *   solid   { layerName: [tile ids that block] }, for example { object: [OBJECT.tree, OBJECT.rock], ground: [GROUND.water, GROUND.deep] }
 *   cost    optional (chunk, tx, ty, index) -> 1..255 for slow ground (0 blocks)
 * The nav must be made with createNav(navOptionsForWorld(world)). link: { reload(chunk), release() }
 */
export function bindWorld(nav, world, options = {}) {
  need(nav && typeof nav.setChunk === 'function', 'bindWorld: first argument must be a nav from createNav');
  need(world && typeof world.on === 'function' && typeof world.forEachChunk === 'function', 'bindWorld: second argument must be a world from the world engine (createWorld)');
  const sub = world.tileSize / nav.cellSize;
  need(Number.isInteger(sub) && sub >= 1 && nav.chunkCells === world.chunkSize * sub, `bindWorld: the nav's cells do not line up with the world's chunks (tile ${world.tileSize}, chunk ${world.chunkSize} tiles; nav cell ${nav.cellSize}, chunk ${nav.chunkCells} cells). Make it with createNav(navOptionsForWorld(world))`);
  const solid = Object.entries(options.solid ?? {}).map(([layer, ids]) => [layer, new Set(ids)]);
  const cost = options.cost ?? null;
  const reload = (chunk) => {
    for (const [layer] of solid) need(chunk.layers[layer], `bindWorld: the world has no layer '${layer}' (it has: ${Object.keys(chunk.layers).join(', ')})`);
    nav.setChunk(chunk.cx, chunk.cy, (col, row) => {
      const tx = Math.floor(col / sub); const ty = Math.floor(row / sub);
      const i = (ty - chunk.y0) * chunk.size + (tx - chunk.x0);
      for (const [layer, ids] of solid) if (ids.has(chunk.layers[layer][i])) return 0;
      return cost ? cost(chunk, tx, ty, i) : 1;
    });
  };
  const offs = [world.on('load', reload), world.on('unload', (chunk) => nav.dropChunk(chunk.cx, chunk.cy)), world.on('edit', reload)];
  world.forEachChunk(reload);
  return { reload, release() { for (const off of offs) off(); } };
}

/**
 * bindAi(nav, ai, options) -> link. The ai engine keeps deciding where everyone wants to go; nav gives it
 * a grid on which every open cell has room for the body, and moves the bodies round props.
 *   radius   = the nav's default radius: the body size the ai's grid allows for
 *   mover    optional (agent, dx, dy) -> { x, y }: who really moves a body (a collision world.move). Default: slide on the field.
 * link: { grid(), move(agent, dx, dy), los(x0, y0, x1, y1), attach(ai), update(focus) -> true when the grid changed,
 *         snap(x, y) -> { x, y }, snapPlaces() -> how many moved }
 * Use: const link = bindAi(nav); const ai = createAi({ grid: link.grid(), move: link.move }); link.attach(ai);
 *      every tick, before ai.step: link.update(player);
 */
export function bindAi(nav, ai = null, options = {}) {
  need(nav && typeof nav.gridFor === 'function', 'bindAi: first argument must be a nav from createNav');
  const radius = options.radius ?? nav.config.radius;
  const mems = new Map();
  let grid = null; let gridOf = -1; let bound = null;
  const link = {
    /** grid() -> the nav grid for createAi({ grid }) / ai.setGrid: the same object until the ground changes. */
    grid() {
      const field = nav.field();
      if (!grid || gridOf !== field.version) { grid = nav.gridFor(radius); gridOf = field.version; }
      return grid;
    },
    /** move(agent, dx, dy) -> { x, y }: pass as createAi({ move }). Steers the step round props, then moves the body. */
    move(agent, dx, dy) {
      const field = nav.field(); const cs = field.cellSize;
      const r = Math.min(agent.radius ?? radius, nav.config.maxRadius);
      const go = (mx, my) => {
        if (options.mover) return options.mover(agent, mx, my);
        let nx = agent.x + mx; let ny = agent.y + my;
        if (!field.mayStep(agent.x, agent.y, nx, ny, r * 0.9)) { if (field.mayStep(agent.x, agent.y, nx, agent.y, r * 0.9)) ny = agent.y; else if (field.mayStep(agent.x, agent.y, agent.x, ny, r * 0.9)) nx = agent.x; else { nx = agent.x; ny = agent.y; } }
        return { x: nx, y: ny };
      };
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) return { x: agent.x, y: agent.y };
      if (!field.inside(field.colOf(agent.x), field.rowOf(agent.y))) return options.mover ? options.mover(agent, dx, dy) : { x: agent.x + dx, y: agent.y + dy };
      if (!field.fitsAt(agent.x, agent.y, r * 0.5)) { // inside something: out the short way
        const out = field.nearestOpen(agent.x, agent.y, r, 10);
        if (!out) return { x: agent.x, y: agent.y };
        const d = dist(agent.x, agent.y, out[0], out[1]) || 1;
        return { x: q(agent.x + (out[0] - agent.x) / d * Math.min(len, d)), y: q(agent.y + (out[1] - agent.y) / d * Math.min(len, d)) };
      }
      let mem = mems.get(agent.id);
      if (!mem) { mem = { side: 0, hold: 0 }; mems.set(agent.id, mem); }
      const toGoal = agent.nav ? dist(agent.x, agent.y, agent.nav.tx, agent.nav.ty) : Infinity;
      const dir = steerAround({ x: agent.x, y: agent.y, dx: dx / len, dy: dy / len, look: Math.max(len, Math.min(r + cs * 0.75, toGoal)) }, (px, py) => field.mayStep(agent.x, agent.y, px, py, r * 0.9), mem);
      if (dir.blocked) return go(dx, dy);
      return go(dir.x * len, dir.y * len);
    },
    /** los(x0, y0, x1, y1) -> true when nothing stands on the line: pass as createAi({ los }) for sight that ignores body size. */
    los: (x0, y0, x1, y1) => nav.field().lineClear(x0, y0, x1, y1, 0),
    attach(theAi) {
      need(theAi && typeof theAi.setGrid === 'function', 'bindAi: attach needs an ai from createAi');
      bound = theAi; bound.setGrid(link.grid());
      return link;
    },
    /** update(focus) follows the focus ({ x, y }) and hands the ai a fresh grid when the ground, a prop or the window changed. */
    update(focus) {
      if (focus) nav.focus(focus.x, focus.y);
      const before = grid;
      const now = link.grid();
      if (bound && now !== before) bound.setGrid(now);
      if (bound && mems.size > bound.count() * 2 + 64) for (const id of [...mems.keys()]) if (!bound.has(id)) mems.delete(id);
      return now !== before;
    },
    /** snap(x, y) -> { x, y } the nearest point the body can stand on (the point itself when it can). */
    snap(x, y) { return nav.nearestOpen(x, y, radius) ?? { x, y }; },
    /** snapPlaces() moves every shared place, home, own place and patrol point that lies inside a prop to the nearest standable point. */
    snapPlaces() {
      need(bound, 'bindAi: snapPlaces needs an attached ai (link.attach(ai))');
      let moved = 0;
      const fix = (p) => { const s = link.snap(p.x, p.y); if (s.x !== p.x || s.y !== p.y) { p.x = s.x; p.y = s.y; moved += 1; } };
      for (const p of Object.values(bound.config.places ?? {})) fix(p);
      for (const a of bound.agents()) {
        if (a.home) fix(a.home);
        for (const p of Object.values(a.places ?? {})) fix(p);
        for (const pt of a.patrol?.points ?? []) { const s = link.snap(pt[0], pt[1]); if (s.x !== pt[0] || s.y !== pt[1]) { pt[0] = s.x; pt[1] = s.y; moved += 1; } }
      }
      return moved;
    },
  };
  if (ai) link.attach(ai);
  return link;
}
