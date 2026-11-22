// createNav: the one object a game talks to. It holds the ground (chunks and props), answers
// questions about it ("can a body stand here", "how do I get there") and walks agents along
// their paths. All of its state is plain JSON, and the same calls give the same result every run.
import { need, q, dist, isId } from './util.js';
import { createModel } from './model.js';
import { gridForRadius } from './field.js';
import { findGridPath } from './astar.js';
import { stringPull, roundPath, pathLength } from './smooth.js';
import { meshFromField, findMeshPath } from './mesh.js';
import { stepAgents } from './agents.js';

/**
 * createNav(options) -> nav
 *   cellSize      = 0.5 * unit: side of a cell. About the radius of the smallest walker works well.
 *   unit          = 1: game units per metre (1 in Kiln scenes, about 32 in pixel games); scales the defaults below
 *   bounds        { x, y, w, h }: a fixed level. Its ground starts open; add props and fill(). Leave it out
 *                 for a streamed world and load ground with setChunk as the world loads it.
 *   chunkCells    = 32: cells per chunk side
 *   unloaded      = 'blocked': ground whose chunk is not loaded cannot be walked ('open': it can)
 *   windowCells   = 192: in a world bigger than this many cells a side, the field covers this much around the focus
 *   radius, speed = 0.3 m, 1.4 m/s: defaults for agents
 *   planner       = 'grid': 'mesh' plans over the navmesh instead (best for long trips over open ground)
 *   round         = true: soften path corners;  avoid = true: agents steer round each other
 *   pathsPerStep  = 4, maxNodes = 8000: path-finding budget per step and per search
 *   stuckTime     = 0.8: seconds without progress before planning again (the third time in a row gives 'stuck')
 *   maxRadius     = 4 cells: the biggest body radius the field measures room for
 *   state         wrap an existing state (from nav.state)
 * See the README for the nav object's methods.
 */
export function createNav(options = {}) {
  const unit = options.unit ?? 1;
  need(unit > 0, `createNav: unit must be above 0, got ${String(unit)}`);
  const cellSize = options.cellSize ?? 0.5 * unit;
  need(cellSize > 0, `createNav: cellSize must be above 0, got ${String(cellSize)}`);
  const chunkCells = options.chunkCells ?? 32;
  need(Number.isInteger(chunkCells) && chunkCells >= 4 && chunkCells <= 512, `createNav: chunkCells must be a whole number 4..512, got ${String(chunkCells)}`);
  need(['grid', 'mesh'].includes(options.planner ?? 'grid'), `createNav: planner must be 'grid' or 'mesh', got ${JSON.stringify(options.planner)}`);
  need(['blocked', 'open'].includes(options.unloaded ?? 'blocked'), `createNav: unloaded must be 'blocked' or 'open', got ${JSON.stringify(options.unloaded)}`);
  let bounds = null;
  if (options.bounds) {
    const b = options.bounds;
    need(b.w > 0 && b.h > 0 && Number.isFinite(b.x) && Number.isFinite(b.y), `createNav: bounds must be { x, y, w, h } with a size, got ${JSON.stringify(b)}`);
    bounds = { ...b, c0: Math.floor(b.x / cellSize), r0: Math.floor(b.y / cellSize), c1: Math.ceil((b.x + b.w) / cellSize), r1: Math.ceil((b.y + b.h) / cellSize) };
  }
  const cfg = {
    unit, cellSize, chunkCells, bounds, unloaded: options.unloaded ?? 'blocked', windowCells: options.windowCells ?? 192,
    radius: options.radius ?? 0.3 * unit, speed: options.speed ?? 1.4 * unit, planner: options.planner ?? 'grid',
    round: options.round !== false, avoid: options.avoid !== false, pathsPerStep: options.pathsPerStep ?? 4, maxNodes: options.maxNodes ?? 8000,
    stuckTime: options.stuckTime ?? 0.8, retryTicks: options.retryTicks ?? 90, maxRadius: options.maxRadius ?? cellSize * 4,
  };
  cfg.maxClear = cfg.maxRadius + cellSize;
  const model = createModel(cfg);
  let state = options.state ?? { tick: 0, agents: {}, order: [] };
  const listeners = new Map();
  let events = [];
  let mover = options.mover ?? null;
  const counts = { paths: 0, expanded: 0 };

  function emit(e) {
    events.push(e);
    for (const fn of listeners.get(e.type) ?? []) fn(e);
    for (const fn of listeners.get('*') ?? []) fn(e);
  }
  const agentOf = (id, who) => { const a = state.agents[id]; need(a, `${who}: no agent with id ${JSON.stringify(id)}`); return a; };
  const revive = (a) => { if (!a.mem) Object.defineProperty(a, 'mem', { value: { side: 0, hold: 0 }, enumerable: false, writable: true }); return a; };

  // Mesh corners lie on cell edges. Move any that landed on the wrong side onto standing room, and
  // re-plan (over cells) the rare leg that then touches something, so every leg can be walked.
  function repair(field, from, points, radius) {
    const pts = points.map((p, i) => { if (i === points.length - 1 || field.openAt(p[0], p[1], radius)) return p; const n = field.nearestOpen(p[0], p[1], radius, 2); return n ? [q(n[0]), q(n[1])] : p; });
    const out = []; let px = from.x; let py = from.y;
    for (const p of pts) {
      if (!field.lineClear(px, py, p[0], p[1], radius)) {
        const sub = findGridPath(field, { x: px, y: py }, { x: p[0], y: p[1] }, { radius, maxNodes: 1500 });
        if (sub.complete && sub.points.length > 1) out.push(...stringPull(field, [[px, py], ...sub.points], radius).slice(1, -1));
      }
      out.push(p); px = p[0]; py = p[1];
    }
    return out;
  }

  function findPath(from, to, o = {}) {
    need(from && Number.isFinite(from.x) && Number.isFinite(from.y), `nav.findPath: from must be { x, y }, got ${JSON.stringify(from)}`);
    need(to && Number.isFinite(to.x) && Number.isFinite(to.y), `nav.findPath: to must be { x, y }, got ${JSON.stringify(to)}`);
    const field = model.field();
    const radius = o.radius ?? cfg.radius;
    need(radius <= cfg.maxRadius, `nav.findPath: radius ${radius} is above maxRadius ${cfg.maxRadius}; raise createNav({ maxRadius })`);
    const inside = (p) => field.inside(field.colOf(p.x), field.rowOf(p.y));
    if (!inside(from)) return { points: [[q(to.x), q(to.y)]], complete: false, expanded: 0, snapped: false, goal: [q(to.x), q(to.y)], length: dist(from.x, from.y, to.x, to.y), outside: true };
    let target = to; let cut = false;
    if (!inside(to)) { // the goal is beyond the field: head for where the straight line leaves it
      const x0 = field.originX + field.cellSize * 0.5; const y0 = field.originY + field.cellSize * 0.5;
      const x1 = field.originX + (field.cols - 0.5) * field.cellSize; const y1 = field.originY + (field.rows - 0.5) * field.cellSize;
      let t = 1; const dx = to.x - from.x; const dy = to.y - from.y;
      if (dx > 0) t = Math.min(t, (x1 - from.x) / dx); else if (dx < 0) t = Math.min(t, (x0 - from.x) / dx);
      if (dy > 0) t = Math.min(t, (y1 - from.y) / dy); else if (dy < 0) t = Math.min(t, (y0 - from.y) / dy);
      target = { x: from.x + dx * Math.max(0, t), y: from.y + dy * Math.max(0, t) }; cut = true;
    }
    const planner = o.planner ?? cfg.planner;
    let res;
    if (planner === 'mesh') {
      res = findMeshPath(nav.mesh(radius), from, target, { maxNodes: o.maxNodes ?? cfg.maxNodes });
      res.points = repair(field, from, res.points, radius);
    } else {
      res = findGridPath(field, from, target, { radius, maxNodes: o.maxNodes ?? cfg.maxNodes });
      if (o.smooth !== false && res.points.length > 1) res.points = stringPull(field, [[from.x, from.y], ...res.points], radius + field.cellSize * 0.25).slice(1);
    }
    if ((o.round ?? cfg.round) && o.smooth !== false && res.points.length > 1) res.points = roundPath(field, [[from.x, from.y], ...res.points], { radius: radius * 0.85 }).slice(1);
    counts.paths += 1; counts.expanded += res.expanded;
    return { ...res, complete: res.complete && !cut, snapped: res.snapped && !cut, length: pathLength(res.points, from) };
  }

  const nav = {
    cellSize, chunkCells, unit,
    get version() { return model.version; },
    get state() { return state; },
    config: cfg,
    // the ground
    setChunk: (cx, cy, source) => { model.setChunk(cx, cy, source); return nav; },
    dropChunk: model.dropChunk, hasChunk: model.hasChunk, chunkCount: model.chunkCount,
    setCell: (col, row, value) => { model.setCell(col, row, value); return nav; },
    fill: (fn) => { model.fill(fn); return nav; },
    addObstacle: model.addObstacle, removeObstacle: model.removeObstacle, removeGroup: model.removeGroup, hasObstacle: model.hasObstacle, obstacles: model.obstacles,
    moveObstacle: (id, x, y) => { model.moveObstacle(id, x, y); return nav; },
    focus: (x, y) => { model.focus(x, y); return nav; },
    field: model.field,
    /** mesh(radius) -> the navmesh for bodies of that radius, built from the field when first asked for. */
    mesh(radius = cfg.radius) {
      const field = model.field();
      if (!field.meshes) field.meshes = new Map();
      const k = q(radius);
      if (!field.meshes.has(k)) field.meshes.set(k, meshFromField(field, radius));
      return field.meshes.get(k);
    },
    /** gridFor(radius) -> the field as an ai-engine nav grid in which a body of that radius fits on every open cell. */
    gridFor: (radius = cfg.radius) => gridForRadius(model.field(), radius),
    // questions
    /** openAt(x, y, radius) -> true when a body of that radius may stand exactly there. */
    openAt: (x, y, radius = cfg.radius) => model.field().fitsAt(x, y, radius),
    /** clearAt(x, y) -> how far that point is from the nearest thing in the way. */
    clearAt: (x, y) => model.field().roomAt(x, y),
    lineClear: (x0, y0, x1, y1, radius = cfg.radius) => model.field().lineClear(x0, y0, x1, y1, radius),
    /** nearestOpen(x, y, radius, reach) -> { x, y } the nearest point a body of that radius can stand on, or null within `reach` cells. */
    nearestOpen(x, y, radius = cfg.radius, reach = 16) { const p = model.field().nearestOpen(x, y, radius, reach); return p ? { x: q(p[0]), y: q(p[1]) } : null; },
    findPath,
    // agents
    add(o = {}) {
      need(isId(o.id), `nav.add: id must be letters, digits or _ . : -, got ${JSON.stringify(o.id)}`);
      need(!state.agents[o.id], `nav.add: there is already an agent with id '${o.id}'`);
      need(Number.isFinite(o.x) && Number.isFinite(o.y), `nav.add: agent '${o.id}' needs numbers for x and y, got ${o.x}, ${o.y}`);
      const radius = o.radius ?? cfg.radius; const speed = o.speed ?? cfg.speed;
      need(radius > 0 && radius <= cfg.maxRadius, `nav.add: radius must be above 0 and at most maxRadius (${cfg.maxRadius}), got ${String(radius)}`);
      need(speed > 0, `nav.add: speed must be above 0, got ${String(speed)}`);
      let n = 0; for (let i = 0; i < o.id.length; i++) n = (n * 31 + o.id.charCodeAt(i)) % 9973;
      const a = revive({ id: o.id, x: q(o.x), y: q(o.y), radius, speed, vx: 0, vy: 0, facing: o.facing ?? 180, status: 'idle', goal: null, path: null, pathV: -1, complete: false, snapped: false, asked: -1, planned: 0, stuck: 0, tries: 0, n, tags: o.tags ?? null });
      state.agents[a.id] = a;
      state.order.push(a.id); state.order.sort();
      return a;
    },
    remove(id) { if (!state.agents[id]) return false; delete state.agents[id]; state.order.splice(state.order.indexOf(id), 1); emit({ type: 'remove', id }); return true; },
    has: (id) => !!state.agents[id],
    get: (id) => agentOf(id, 'nav.get'),
    agents: () => state.order.map((id) => state.agents[id]),
    count: () => state.order.length,
    /** goTo(id, x, y, { arrive, speed }) sends an agent somewhere. Calling it again with nearly the same point keeps the path. */
    goTo(id, x, y, o = {}) {
      const a = agentOf(id, 'nav.goTo');
      need(Number.isFinite(x) && Number.isFinite(y), `nav.goTo: x and y must be numbers, got ${x}, ${y}`);
      const arrive = o.arrive ?? Math.max(a.radius * 0.5, cellSize * 0.3);
      if (a.goal && dist(a.goal.x, a.goal.y, x, y) <= cellSize * 0.5) { a.goal.arrive = arrive; a.goal.speed = o.speed ?? null; return a; }
      a.goal = { x: q(x), y: q(y), arrive, speed: o.speed ?? null };
      a.path = null; a.asked = state.tick; a.status = 'moving'; a.stuck = 0; a.tries = 0; a.snapped = false;
      return a;
    },
    stop(id) { const a = agentOf(id, 'nav.stop'); a.goal = null; a.path = null; a.status = 'idle'; a.vx = 0; a.vy = 0; a.asked = -1; return a; },
    /** setPosition(id, x, y) puts an agent somewhere at once (a teleport, a cutscene). Its path is planned again. */
    setPosition(id, x, y) { const a = agentOf(id, 'nav.setPosition'); need(Number.isFinite(x) && Number.isFinite(y), `nav.setPosition: x and y must be numbers, got ${x}, ${y}`); a.x = q(x); a.y = q(y); if (a.goal) { a.path = null; a.asked = state.tick; } return a; },
    /**
     * shift(dx, dy) moves every agent, its goal and the path it is on by the same offset: the ground moved
     * under everyone (an open world stepped to its next page). Move the props and ground yourself.
     */
    shift(dx, dy) {
      need(Number.isFinite(dx) && Number.isFinite(dy), `nav.shift: dx and dy must be numbers, got ${dx}, ${dy}`);
      for (const id of state.order) {
        const a = state.agents[id];
        a.x = q(a.x + dx); a.y = q(a.y + dy);
        if (a.goal) { a.goal.x = q(a.goal.x + dx); a.goal.y = q(a.goal.y + dy); }
        if (a.path) for (const p of a.path) { p[0] = q(p[0] + dx); p[1] = q(p[1] + dy); }
      }
      return nav;
    },
    setMover(fn) { need(fn === null || typeof fn === 'function', 'nav.setMover: needs a function (agent, dx, dy, ghost) -> { x, y } or null'); mover = fn; return nav; },
    /** step(dt, { focus }) -> events of this step. Call once per tick. */
    step(dt, o = {}) {
      need(Number.isFinite(dt) && dt >= 0, `nav.step: dt must be seconds, 0 or more, got ${String(dt)}`);
      if (o.focus) model.focus(o.focus.x, o.focus.y);
      events = []; counts.paths = 0; counts.expanded = 0;
      stepAgents({ cfg, state, field: model.field(), findPath, emit, mover }, dt);
      return events;
    },
    on(type, fn) {
      need(typeof fn === 'function', 'nav.on: the listener must be a function');
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      return () => { const l = listeners.get(type); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
    },
    /** stats() -> { agents, moving, paths, expanded, chunks, obstacles, cells } (paths and expanded: the last step). */
    stats() { const f = model.field(); return { agents: state.order.length, moving: state.order.filter((id) => state.agents[id].goal).length, paths: counts.paths, expanded: counts.expanded, chunks: model.chunkCount(), obstacles: model.obstacles().length, cells: f.cols * f.rows }; },
    /** toJSON() -> the agents (where they are, where they are going, the path they are on). The ground and props come from your level, not the save. */
    toJSON: () => JSON.parse(JSON.stringify({ version: 1, tick: state.tick, agents: state.agents })),
    load(data) {
      need(data && data.version === 1 && data.agents && typeof data.agents === 'object', 'nav.load: not a nav save (expected { version: 1, agents })');
      const copy = JSON.parse(JSON.stringify(data));
      state = { tick: copy.tick ?? 0, agents: copy.agents, order: Object.keys(copy.agents).sort() };
      for (const id of state.order) revive(state.agents[id]); // a loaded path is checked against the ground as soon as the ground differs
      return nav;
    },
  };
  for (const id of state.order) revive(state.agents[id]);
  return nav;
}
