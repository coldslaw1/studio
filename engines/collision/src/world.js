// The collision world: solid bodies, tile grids and trigger zones, with moves that stop and
// slide, shape casts, raycasts and overlap queries. No gravity or velocity in here: the game
// (or the physics engine) decides how far to move, this decides how far it can.
import { boundsOf, checkShape, isPolygon, shapeAt } from './shapes.js';
import { pointIn } from './narrow.js';
import { sweep } from './sweep.js';
import { createSpatialHash } from './hash.js';
import { castRay, castShape, overlapsOf, pairOk } from './cast.js';
import { moveBody } from './move.js';
import { convexParts } from './decompose.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Create a collision world.
 * @param {object} [options]
 * @param {number} [options.cellSize=64]  broad-phase cell size, about as big as a typical body.
 *   Use a small number (4 or so) when the world is measured in small units instead of pixels.
 * @param {number} [options.skin=0.01]    gap kept between a moved body and what it ran into.
 *   Keep it tiny compared with the bodies (the default suits pixels and Kiln ground units).
 * @param {number} [options.maxSlides=4]  how many surfaces one move may slide along
 * @returns {object} world
 */
export function createCollisionWorld(options = {}) {
  const { cellSize = 64, skin = 0.01, maxSlides = 4 } = options;
  if (!(skin > 0) || !num(skin)) throw new Error(`createCollisionWorld: skin must be > 0, got ${skin}`);
  if (!Number.isInteger(maxSlides) || maxSlides < 0) throw new Error(`createCollisionWorld: maxSlides must be a whole number >= 0, got ${maxSlides}`);
  const hash = createSpatialHash(cellSize);
  const ctx = { hash, skin, slop: skin * 1e-3, maxSlides };
  const listeners = { enter: [], exit: [] };
  const pairs = new Map(); // "triggerId:otherId" -> [trigger, other]
  const members = new Set();
  let nextId = 1;
  const world = { bodies: [], add, addOutline, addTiles, remove, move, teleport, cast, raycast, raycastAll, query, queryPoint, inside, on };

  const need = (body, fn) => {
    if (!members.has(body)) throw new Error(`${fn}: that body is not in this world (add it with world.add first)`);
  };
  const flags = (body, fn) => {
    if (!Number.isInteger(body.layer) || !Number.isInteger(body.mask)) throw new Error(`${fn}: layer and mask must be whole numbers (bit flags), got ${body.layer}, ${body.mask}`);
  };

  /**
   * Add a body: a rect { x, y, w, h } (x,y = top-left), a circle { x, y, r } (x,y = center) or a
   * convex polygon { x, y, points }. Optional fields: layer (bit flag, default 1), mask (layers
   * it interacts with, default -1 = all), trigger (true = a zone that blocks nothing and fires
   * enter / exit), oneWay (true = only stops things landing on it from above). Other fields are kept.
   * @returns {object} the body. Move it with world.move or world.teleport, never by writing x / y.
   */
  function add(options) {
    const body = { layer: 1, mask: -1, trigger: false, oneWay: false, ...checkShape(options, 'world.add') };
    if (isPolygon(body)) body.points = body.points.map((p) => [p[0], p[1]]);
    flags(body, 'world.add');
    body.id = nextId++;
    world.bodies.push(body);
    members.add(body);
    hash.insert(body, boundsOf(body));
    emit(refresh(body, []));
    return body;
  }

  /**
   * Add a polygon that may have dents (an L-shaped house, a generated outline): it is split
   * into convex pieces and each piece is added as its own body with the same fields.
   * A rect, a circle or a convex polygon is added as it is.
   * @returns {Array<object>} the bodies (one or more); each has `outline` = the first body
   */
  function addOutline(options) {
    if (!options || !Array.isArray(options.points)) return [add(options)];
    const bodies = convexParts(options.points).map((points) => add({ ...options, points }));
    for (const body of bodies) body.outline = bodies[0];
    return bodies;
  }

  /**
   * Add a whole tile grid as one solid body.
   * @param {object} map  anything with tileSize and isSolid(col, row), e.g. a physics createTileMap;
   *   an optional isOneWay(col, row) marks one-way platform tiles
   * @param {object} [options]  { x: 0, y: 0, layer: 1, mask: -1 }; x,y = top-left corner of the grid
   * @returns {object} the tile body; hits on it also carry col and row
   */
  function addTiles(map, options = {}) {
    if (!map || !(map.tileSize > 0) || typeof map.isSolid !== 'function') {
      throw new Error('world.addTiles: map needs tileSize > 0 and isSolid(col, row) (a physics createTileMap works)');
    }
    const body = { layer: 1, mask: -1, x: 0, y: 0, ...options, tiles: map, trigger: false };
    if (!num(body.x) || !num(body.y)) throw new Error(`world.addTiles: x and y must be numbers, got ${body.x}, ${body.y}`);
    flags(body, 'world.addTiles');
    body.id = nextId++;
    world.bodies.push(body);
    members.add(body);
    const endless = !num(map.cols) || !num(map.rows) || map.isSolid(-1, -1);
    body.finite = !endless;
    hash.insert(body, endless
      ? { x: -Infinity, y: -Infinity, w: Infinity, h: Infinity }
      : { x: body.x, y: body.y, w: map.cols * map.tileSize, h: map.rows * map.tileSize });
    return body;
  }

  /** Take a body out of the world. Safe inside enter / exit callbacks; fires no exit event. */
  function remove(body) {
    if (!members.delete(body)) return;
    world.bodies.splice(world.bodies.indexOf(body), 1);
    hash.remove(body);
    for (const [key, pair] of pairs) if (pair[0] === body || pair[1] === body) pairs.delete(key);
  }

  // Work out which trigger pairs started and stopped for one body. `legs` are the straight
  // pieces it just travelled, so a trigger crossed at high speed still counts.
  function refresh(body, legs) {
    const events = [];
    if (body.tiles) return events;
    const now = new Map();
    const crossed = new Map();
    const key = (trigger, other) => trigger.id + ':' + other.id;
    if (body.trigger) {
      for (const hit of overlapsOf(ctx, shapeAt(body), { self: body })) {
        if (!hit.body.tiles) now.set(key(body, hit.body), [body, hit.body]);
      }
    } else {
      for (const hit of overlapsOf(ctx, shapeAt(body), { self: body, triggers: true, solids: false })) {
        now.set(key(hit.body, body), [hit.body, body]);
      }
      for (const [x, y, dx, dy] of legs) {
        const shape = shapeAt(body, x, y);
        const b = boundsOf(shape);
        for (const other of hash.query(Math.min(b.x, b.x + dx), Math.min(b.y, b.y + dy), b.w + Math.abs(dx), b.h + Math.abs(dy))) {
          if (!other.trigger || other === body || !pairOk(body, other)) continue;
          const hit = sweep(shape, dx, dy, other, ctx.slop);
          if (hit && hit.t < 1 - 1e-9) crossed.set(key(other, body), [other, body]);
        }
      }
    }
    const mine = (pair) => pair[0] === body || pair[1] === body;
    for (const [k, pair] of [...crossed, ...now]) {
      if (!pairs.has(k) && !events.some((e) => e[0] === 'enter' && e[1] === pair[0] && e[2] === pair[1])) events.push(['enter', pair[0], pair[1]]);
    }
    for (const [k, pair] of [...pairs, ...crossed]) {
      if (mine(pair) && !now.has(k) && !events.some((e) => e[0] === 'exit' && e[1] === pair[0] && e[2] === pair[1])) events.push(['exit', pair[0], pair[1]]);
    }
    for (const [k, pair] of pairs) if (mine(pair) && !now.has(k)) pairs.delete(k);
    for (const [k, pair] of now) pairs.set(k, pair);
    return events;
  }

  function emit(events) {
    for (const [name, trigger, other] of events) {
      for (const fn of listeners[name].slice()) fn(trigger, other);
    }
  }

  /**
   * Move a body by up to (dx, dy) (distances for this update: speed * dt). It stops at solid
   * bodies and tiles, slides along them, never tunnels and never ends inside one.
   * @param {object} [opts]  { slide: true, mask: -1, ignore: null, ghost: false }. slide false =
   *   stop at the first hit (bullets). mask = only these layers block. ignore = a body or array
   *   of bodies to pass through. ghost = do not get blocked at all (triggers still fire).
   * @returns {{dx:number, dy:number, hits:Array, touching:object}} dx, dy = how far it really
   *   moved; hits = [{ body, nx, ny, col?, row? }] surfaces run into, (nx, ny) pointing back at
   *   the mover; touching = { left, right, up, down } sides that ran into something.
   */
  function move(body, dx, dy, opts = {}) {
    need(body, 'world.move');
    if (body.tiles) throw new Error('world.move: tile grids cannot be moved');
    if (!num(dx) || !num(dy)) throw new Error(`world.move: dx and dy must be finite numbers (velocity * dt), got ${dx}, ${dy}`);
    let result;
    if (body.trigger || opts.ghost) {
      result = { dx, dy, hits: [], legs: [[body.x, body.y, dx, dy]], touching: { left: false, right: false, up: false, down: false } };
      body.x += dx;
      body.y += dy;
    } else result = moveBody(ctx, body, dx, dy, opts);
    hash.insert(body, boundsOf(body));
    const events = refresh(body, result.legs);
    delete result.legs;
    emit(events);
    return result;
  }

  /**
   * Put a body at (x, y) with no collision checks and update triggers. Call it with no
   * position after changing a body's size or points.
   */
  function teleport(body, x = body.x, y = body.y) {
    need(body, 'world.teleport');
    if (body.tiles) throw new Error('world.teleport: tile grids cannot be moved');
    if (!num(x) || !num(y)) throw new Error(`world.teleport: x and y must be numbers, got ${x}, ${y}`);
    checkShape({ ...body, x, y }, 'world.teleport');
    body.x = x;
    body.y = y;
    hash.insert(body, boundsOf(body));
    emit(refresh(body, []));
  }

  /**
   * What would this shape hit first if it moved by (dx, dy)? Moves nothing. `shape` is a body
   * (it ignores itself) or any shape object. Ground check: world.cast(player, 0, 1) !== null.
   * @param {object} [opts]  { mask: -1, ignore: null, triggers: false }
   * @returns {null|object} { t, x, y, nx, ny, body, overlap }: t 0..1 = free part of the move,
   *   x,y = shape position there; overlap true = already inside body (then depth is set)
   */
  function cast(shape, dx, dy, opts = {}) {
    if (!num(dx) || !num(dy)) throw new Error(`world.cast: dx and dy must be finite numbers, got ${dx}, ${dy}`);
    const self = members.has(shape) ? shape : null;
    const hit = castShape(ctx, shapeAt(checkShape(shape, 'world.cast')), dx, dy, { self, ...opts });
    if (hit) {
      hit.x = shape.x + dx * hit.t;
      hit.y = shape.y + dy * hit.t;
    }
    return hit;
  }

  /** Like raycast, but returns every hit along the line, nearest first. */
  function raycastAll(x0, y0, x1, y1, opts = {}) {
    if (![x0, y0, x1, y1].every(num)) throw new Error(`world.raycast: needs four numbers x0, y0, x1, y1, got ${x0}, ${y0}, ${x1}, ${y1}`);
    return castRay(ctx, x0, y0, x1, y1, opts);
  }

  /**
   * Cast a line from (x0, y0) to (x1, y1) and return the nearest hit or null.
   * @param {object} [opts]  { mask: -1 (layers to look at), ignore: body or array, triggers: false }
   * @returns {null|object} { t, x, y, nx, ny, inside, body } plus col, row when a tile was hit
   */
  function raycast(x0, y0, x1, y1, opts = {}) {
    return raycastAll(x0, y0, x1, y1, opts)[0] ?? null;
  }

  /** All bodies overlapping a shape, sorted by id. opts: { mask: -1, ignore, triggers: true }. */
  function query(shape, opts = {}) {
    const self = members.has(shape) ? shape : null;
    const found = overlapsOf(ctx, shapeAt(checkShape(shape, 'world.query')), { self, triggers: true, ...opts });
    return [...new Set(found.map((hit) => hit.body))].sort((p, q) => p.id - q.id);
  }

  /** All bodies containing the point (x, y). opts: { mask: -1, triggers: true }. */
  function queryPoint(x, y, opts = {}) {
    if (!num(x) || !num(y)) throw new Error(`world.queryPoint: x and y must be numbers, got ${x}, ${y}`);
    const { mask = -1, triggers = true } = opts;
    return hash.query(x, y, 0, 0).filter((b) => (b.layer & mask) !== 0 && (triggers || !b.trigger) &&
      (b.tiles ? b.tiles.isSolid(Math.floor((x - b.x) / b.tiles.tileSize), Math.floor((y - b.y) / b.tiles.tileSize)) : pointIn(x, y, b)));
  }

  /** inside(trigger) = bodies inside the trigger now; inside(trigger, body) = true or false. */
  function inside(trigger, other) {
    if (other) return pairs.has(trigger.id + ':' + other.id);
    return [...pairs.values()].filter((pair) => pair[0] === trigger).map((pair) => pair[1]);
  }

  /**
   * Listen for 'enter' or 'exit': fn(trigger, other). A body that crosses a trigger within one
   * move still gets enter then exit. @returns {function} call it to stop listening
   */
  function on(event, fn) {
    if (!listeners[event]) throw new Error(`world.on: unknown event "${event}", use enter or exit`);
    if (typeof fn !== 'function') throw new Error('world.on: callback must be a function');
    listeners[event].push(fn);
    return () => {
      const i = listeners[event].indexOf(fn);
      if (i >= 0) listeners[event].splice(i, 1);
    };
  }

  return world;
}
