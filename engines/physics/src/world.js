// A small physics world: moving bodies, gravity, bouncing, sensors, tile maps.
// Bodies are rects and circles that never rotate.
import { collide, isCircle, pointIn, raycast } from './collide.js';
import { findPairs } from './broadphase.js';
import { pushOutOfTiles, raycastTiles } from './tilemap.js';

const SKIN = 0.5; // bodies this close (pixels) count as touching
const TYPES = ['dynamic', 'static', 'kinematic'];
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Create a physics world.
 * @param {object} [options]
 * @param {number} [options.gravityX=0]   pixels per second squared
 * @param {number} [options.gravityY=0]   pixels per second squared (980 feels like Earth)
 * @param {object} [options.tileMap=null] map from createTileMap; dynamic bodies collide with its solid tiles
 * @param {number} [options.cellSize=64]  broad-phase cell size, about as big as a typical body
 * @param {number} [options.iterations=8] solver passes per step; more = steadier stacks
 * @returns {object} world
 */
export function createWorld(options = {}) {
  const { gravityX = 0, gravityY = 0, tileMap = null, cellSize = 64, iterations = 8 } = options;
  if (!num(gravityX) || !num(gravityY)) throw new Error(`createWorld: gravity must be numbers, got ${gravityX}, ${gravityY}`);
  if (!(cellSize > 0)) throw new Error(`createWorld: cellSize must be > 0, got ${cellSize}`);
  let nextId = 1;
  let touchingNow = new Map();
  const listeners = { begin: [], end: [], tile: [] };
  const world = { gravityX, gravityY, tileMap, bodies: [], contacts: [], add, remove, step, on, touching, queryRect, queryPoint, raycast: castRay };

  /**
   * Add a body. Pass { x, y, w, h } for a rect (x,y = top-left) or { x, y, r } for a circle (x,y = center).
   * Optional fields: type ('dynamic' | 'static' | 'kinematic'), vx, vy, mass, bounce (0..1),
   * friction (0..1), sensor, gravityScale, damping, layer, mask. Any other fields are kept as-is.
   * @returns {object} the body; read and write body.x, body.y, body.vx, body.vy directly
   */
  function add(options) {
    const o = options || {};
    const circle = num(o.r);
    if (!num(o.x) || !num(o.y)) throw new Error(`world.add: x and y must be numbers, got ${o.x}, ${o.y}`);
    if (circle ? !(o.r > 0) : !(o.w > 0 && o.h > 0)) {
      throw new Error('world.add: give a rect { x, y, w, h } or a circle { x, y, r } with sizes > 0');
    }
    const body = { type: 'dynamic', vx: 0, vy: 0, mass: 1, bounce: 0, friction: 0, sensor: false, gravityScale: 1, damping: 0, layer: 1, mask: -1, ...o };
    if (!TYPES.includes(body.type)) throw new Error(`world.add: type must be one of ${TYPES.join(', ')}, got ${body.type}`);
    if (!(body.mass > 0)) throw new Error(`world.add: mass must be > 0, got ${body.mass}`);
    body.id = nextId++;
    body.touching = { left: false, right: false, up: false, down: false };
    world.bodies.push(body);
    return body;
  }

  /** Remove a body from the world. Safe to call inside event callbacks. */
  function remove(body) {
    const i = world.bodies.indexOf(body);
    if (i >= 0) world.bodies.splice(i, 1);
  }

  /**
   * Listen for events. Callbacks run at the end of step().
   *   'begin' (a, b)      two bodies started touching (also fires for sensors)
   *   'end'   (a, b)      two bodies stopped touching
   *   'tile'  (body, hit) a body hit a solid tile; hit = { nx, ny, depth, col, row }
   * @returns {function} call it to stop listening
   */
  function on(event, fn) {
    if (!listeners[event]) throw new Error(`world.on: unknown event "${event}", use begin, end or tile`);
    if (typeof fn !== 'function') throw new Error('world.on: callback must be a function');
    listeners[event].push(fn);
    return () => listeners[event].splice(listeners[event].indexOf(fn), 1);
  }

  const invMass = (b) => (b.type === 'dynamic' ? 1 / b.mass : 0);
  const wanted = (a, b) =>
    (a.type === 'dynamic' || b.type === 'dynamic' || a.sensor || b.sensor) &&
    (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0;

  function mark(a, b, nx, ny) {
    if (ny < -0.5) { a.touching.down = true; if (b) b.touching.up = true; }
    else if (ny > 0.5) { a.touching.up = true; if (b) b.touching.down = true; }
    if (nx < -0.5) { a.touching.right = true; if (b) b.touching.left = true; }
    else if (nx > 0.5) { a.touching.left = true; if (b) b.touching.right = true; }
  }

  // Stop velocity going into a surface with direction (nx, ny); bounce if fast enough.
  function bounceOff(a, b, nx, ny, ia, ib, restSpeed) {
    const rvx = a.vx - (b ? b.vx : 0);
    const rvy = a.vy - (b ? b.vy : 0);
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;
    const e = -vn > restSpeed ? Math.max(a.bounce, b ? b.bounce : 0) : 0;
    const j = (-(1 + e) * vn) / (ia + ib);
    a.vx += j * ia * nx;
    a.vy += j * ia * ny;
    if (b) { b.vx -= j * ib * nx; b.vy -= j * ib * ny; }
    const mu = Math.sqrt(a.friction * (b ? b.friction : a.friction));
    if (mu <= 0) return;
    const vt = rvx * -ny + rvy * nx;
    const jt = Math.max(-mu * j, Math.min(mu * j, -vt / (ia + ib)));
    a.vx += jt * ia * -ny;
    a.vy += jt * ia * nx;
    if (b) { b.vx -= jt * ib * -ny; b.vy -= jt * ib * nx; }
  }

  /**
   * Advance the world by dt seconds. Call once per fixed update (dt = 1/60).
   * @param {number} dt seconds, must be > 0
   */
  function step(dt) {
    if (!num(dt) || dt <= 0) throw new Error(`world.step: dt must be a number > 0 (seconds), got ${dt}`);
    const restSpeed = Math.max(10, 2 * Math.hypot(world.gravityX, world.gravityY) * dt);
    for (const b of world.bodies) {
      const t = b.touching;
      t.left = t.right = t.up = t.down = false;
      if (b.type === 'static') continue;
      if (b.type === 'dynamic') {
        b.vx += world.gravityX * b.gravityScale * dt;
        b.vy += world.gravityY * b.gravityScale * dt;
        if (b.damping > 0) {
          const k = Math.max(0, 1 - b.damping * dt);
          b.vx *= k;
          b.vy *= k;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    const found = new Map();
    const tileHits = [];
    world.contacts = [];
    for (let pass = 0; pass < iterations; pass++) {
      const pairs = findPairs(world.bodies, cellSize, wanted);
      let moved = false;
      for (const [a, b] of pairs) {
        const hit = collide(a, b);
        if (!hit) continue;
        const key = a.id + ':' + b.id;
        if (!found.has(key)) {
          found.set(key, [a, b]);
          world.contacts.push({ a, b, nx: hit.nx, ny: hit.ny, depth: hit.depth });
        }
        const ia = invMass(a);
        const ib = invMass(b);
        if (a.sensor || b.sensor || ia + ib === 0) continue;
        a.x += hit.nx * hit.depth * (ia / (ia + ib));
        a.y += hit.ny * hit.depth * (ia / (ia + ib));
        b.x -= hit.nx * hit.depth * (ib / (ia + ib));
        b.y -= hit.ny * hit.depth * (ib / (ia + ib));
        bounceOff(a, b, hit.nx, hit.ny, ia, ib, restSpeed);
        moved = true;
      }
      if (world.tileMap) {
        for (const b of world.bodies) {
          if (b.type !== 'dynamic' || b.sensor) continue;
          for (const hit of pushOutOfTiles(world.tileMap, b)) {
            bounceOff(b, null, hit.nx, hit.ny, 1, 0, restSpeed);
            if (pass === 0) tileHits.push([b, hit]);
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    markTouching();
    const before = touchingNow;
    touchingNow = found;
    for (const [key, pair] of found) if (!before.has(key)) emit('begin', pair[0], pair[1]);
    for (const [key, pair] of before) if (!found.has(key)) emit('end', pair[0], pair[1]);
    for (const [body, hit] of tileHits) emit('tile', body, hit);
  }

  // Set body.touching for everything within SKIN pixels of a solid surface.
  function markTouching() {
    const grown = (b) => (isCircle(b)
      ? { x: b.x, y: b.y, r: b.r + SKIN }
      : { x: b.x - SKIN, y: b.y - SKIN, w: b.w + SKIN * 2, h: b.h + SKIN * 2 });
    const solid = (a, b) => !a.sensor && !b.sensor && wanted(a, b);
    for (const [a, b] of findPairs(world.bodies, cellSize, solid, SKIN)) {
      const hit = collide(grown(a), b);
      if (hit) mark(a, b, hit.nx, hit.ny);
    }
    if (!world.tileMap) return;
    for (const b of world.bodies) {
      if (b.type !== 'dynamic' || b.sensor) continue;
      for (const hit of pushOutOfTiles(world.tileMap, grown(b))) mark(b, null, hit.nx, hit.ny);
    }
  }

  function emit(event, x, y) {
    for (const fn of listeners[event].slice()) fn(x, y);
  }

  /** True when bodies a and b were touching in the last step. */
  function touching(a, b) {
    return touchingNow.has(a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id);
  }

  /** All bodies that overlap the given shape (rect or circle). */
  function queryRect(shape) {
    return world.bodies.filter((b) => collide(b, shape) !== null);
  }

  /** All bodies that contain the point (x, y). */
  function queryPoint(x, y) {
    return world.bodies.filter((b) => pointIn(x, y, b));
  }

  /**
   * Cast a line from (x0, y0) to (x1, y1). Returns the nearest hit or null.
   * Hit: { t, x, y, nx, ny, body } where body is null when a tile was hit (then col,row are set).
   * @param {object} [opts] { mask: only bodies whose layer matches, ignore: a body to skip, sensors: false }
   */
  function castRay(x0, y0, x1, y1, opts = {}) {
    const { mask = -1, ignore = null, sensors = false } = opts;
    let best = world.tileMap ? raycastTiles(world.tileMap, x0, y0, x1, y1) : null;
    if (best) best.body = null;
    for (const b of world.bodies) {
      if (b === ignore || (b.layer & mask) === 0 || (b.sensor && !sensors)) continue;
      const hit = raycast(x0, y0, x1, y1, b);
      if (hit && (!best || hit.t < best.t)) {
        best = hit;
        best.body = b;
      }
    }
    return best;
  }

  return world;
}

