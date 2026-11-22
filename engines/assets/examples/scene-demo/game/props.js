// Loose things in the hamlet: a ball, barrels and thrown stones moved by the physics engine, and
// still things (moonleaf, the cellar hatch). Each is a tiny rig from the puppet engine, so it is
// drawn as text cells by Kiln's drawSprite like the characters and hides behind houses too.
// Physics moves the loose ones against each other and the characters; the collision engine then
// keeps them out of buildings, fences and the sea, the same way it does for people.
import { createPuppet, createAsciiSprite, projectionFromScene } from '../vendor/puppet/index.js';
import { createWorld } from '../vendor/physics/index.js';
import { drawSpriteCached } from './sprite-cache.js';

const root = [{ name: 'root', parent: null, at: [0, 0, 0], tip: [0, 0, 0.5] }];
/** Rig descriptions of the props. All sizes in metres, like the scene. */
export const PROP_DEFS = {
  barrel: { name: 'barrel', bones: root, colors: { wood: '#9a6a3a', band: '#4a4a5a' }, parts: [
    { bone: 'root', shape: 'capsule', at: [0, 0, 0.3], to: [0, 0, 0.72], r: 0.34, color: 'wood' },
    { bone: 'root', shape: 'ball', at: [0, 0, 0.36], r: [0.37, 0.37, 0.05], color: 'band' },
    { bone: 'root', shape: 'ball', at: [0, 0, 0.72], r: [0.37, 0.37, 0.05], color: 'band' },
  ] },
  target: { name: 'target', bones: root, colors: { wood: '#b8483a', band: '#f0e0c0' }, parts: [
    { bone: 'root', shape: 'capsule', at: [0, 0, 0.3], to: [0, 0, 0.78], r: 0.36, color: 'wood' },
    { bone: 'root', shape: 'ball', at: [0, 0, 0.55], r: [0.39, 0.39, 0.09], color: 'band' },
    { bone: 'root', shape: 'ball', at: [0, 0, 1.0], r: [0.3, 0.3, 0.04], color: 'band' },
  ] },
  ball: { name: 'ball', bones: root, colors: { skin: '#e8d27a', patch: '#c0533a' }, parts: [
    { bone: 'root', shape: 'ball', at: [0, 0, 0.27], r: 0.27, color: 'skin' },
    { bone: 'root', shape: 'ball', at: [0, -0.1, 0.36], r: 0.17, color: 'patch' },
  ] },
  stone: { name: 'stone', bones: root, colors: { rock: '#c8c8d8' }, parts: [
    { bone: 'root', shape: 'ball', at: [0, 0, 0.11], r: [0.13, 0.11, 0.1], color: 'rock' },
  ] },
  herb: { name: 'herb', bones: root, colors: { leaf: '#3fae5a', bloom: '#c8f0ff', stem: '#2a7a3a' }, parts: [
    { bone: 'root', shape: 'capsule', at: [0, 0, 0], to: [0, 0, 0.42], r: 0.04, color: 'stem' },
    { bone: 'root', shape: 'ball', at: [-0.16, 0, 0.16], r: [0.16, 0.08, 0.07], color: 'leaf' },
    { bone: 'root', shape: 'ball', at: [0.16, 0.04, 0.24], r: [0.16, 0.08, 0.07], color: 'leaf' },
    { bone: 'root', shape: 'ball', at: [0, 0, 0.5], r: 0.13, color: 'bloom', flat: true },
  ] },
  sack: { name: 'sack', bones: root, colors: { cloth: '#c9a86a', tie: '#7a4a22', glint: '#ffe08a' }, parts: [
    { bone: 'root', shape: 'ball', at: [0, 0, 0.17], r: [0.22, 0.2, 0.17], color: 'cloth' },
    { bone: 'root', shape: 'ball', at: [0, 0, 0.36], r: [0.08, 0.08, 0.06], color: 'tie' },
    { bone: 'root', shape: 'ball', at: [0.05, -0.12, 0.3], r: 0.05, color: 'glint', flat: true },
  ] },
  hatch: { name: 'hatch', bones: root, colors: { wood: '#6a4a2a', iron: '#30303c', frame: '#a0a0b0' }, parts: [
    { bone: 'root', shape: 'box', at: [0, 0, 0.06], size: [1.5, 1.5, 0.12], color: 'frame' },
    { bone: 'root', shape: 'box', at: [0, 0, 0.14], size: [1.2, 1.2, 0.1], color: 'wood' },
    { bone: 'root', shape: 'box', at: [0, -0.3, 0.2], size: [0.9, 0.08, 0.06], color: 'iron' },
    { bone: 'root', shape: 'box', at: [0, 0.3, 0.2], size: [0.9, 0.08, 0.06], color: 'iron' },
  ] },
};

/**
 * A prop that stands on the stage: add the result to stage.actors.
 * @param {object} stage  The stage from main.js.
 * @param {string} kind   A key of PROP_DEFS.
 * @param {{x:number, y:number}} body  Where it is (read every frame, so a physics body works).
 * @param {object} [more] Extra fields kept on the prop (name, hidden, colors).
 */
export function createProp(stage, kind, body, more = {}) {
  const paint = propSprite(kind, more.colors, () => stage.detail ?? 3);
  return {
    kind, body, z: 0, puppet: paint.puppet, ...more,
    draw(ctx, view, rect, occlude) { paint(ctx, view, rect, this.body.x, this.body.y, occlude, stage.spriteScale, this.z); },
  };
}

/**
 * The picture of a prop, for any Kiln view: returns draw(ctx, view, rect, x, y, occlude, scale = 1, z = 0)
 * where x, y are ground units of that view and z metres above the ground. `detailOf()` gives how
 * fine to draw it (2 coarse, 3 normal, 5 fine), read on every draw so a setting can change it.
 */
export function propSprite(kind, colors, detailOf = () => 3) {
  const def = PROP_DEFS[kind];
  if (!def) throw new Error(`propSprite: unknown prop ${JSON.stringify(kind)}, expected one of ${Object.keys(PROP_DEFS).join(', ')}`);
  const puppet = createPuppet(def, { colors });
  puppet.update(0, puppet.rig.createPose());
  const sprites = new Map(); // one text sprite per camera (projection), so pages of an open world share one
  const slots = new Map();
  const paint = (ctx, view, rect, x, y, occlude, scale = 1, z = 0) => {
    const fine = detailOf();
    const key = JSON.stringify(view.projection ?? null) + '|' + view.detail + '|' + fine;
    if (!sprites.has(key)) sprites.set(key, createAsciiSprite(puppet, { projection: projectionFromScene(view), detail: Math.min(view.detail * fine, Math.max(8, fine * 2)) / view.detail, text: 0.3 }));
    // one kept picture per place it is drawn at (a prop paints one spot; loot sacks paint several)
    const where = Math.round(x * 20) + ',' + Math.round(y * 20);
    let slot = slots.get(where);
    if (!slot) { if (slots.size > 64) slots.clear(); slot = {}; slots.set(where, slot); }
    drawSpriteCached(slot, ctx, view, rect, sprites.get(key), x, y, { scale, occlude, z: z * 16, bias: 1 }, key + ':' + puppet.version, ctx.canvas);
  };
  paint.puppet = puppet; // the 3D views (first person, orbit) draw the rig itself
  return paint;
}

const PROP = 4; // collision layer of loose props: scenery stops them, characters do not (physics pushes instead)
const SHAPES = {
  ball: { r: 0.27, mass: 0.4, bounce: 0.75, damping: 0.9 },
  barrel: { r: 0.36, mass: 3, bounce: 0.15, damping: 5 },
  target: { r: 0.38, mass: 8, bounce: 0.3, damping: 7 },
  stone: { r: 0.12, mass: 0.25, bounce: 0.35, damping: 0.5 },
};

/**
 * The loose props and the physics that moves them.
 * @param {object} stage
 * @param {{ onHit?: (a: object, b: object, speed: number) => void, onBump?: (prop: object, speed: number) => void }} [events]
 *   onHit: two loose props struck each other. onBump: a prop ran into scenery.
 */
export function createYard(stage, events = {}) {
  const world = createWorld({ cellSize: 2 });
  const { collision, layers } = stage;
  const loose = [];
  // people push props: each character has a kinematic twin in the physics world
  const twins = stage.actors.filter((c) => c.actor).map((c) => ({ c, body: world.add({ x: c.body.x, y: c.body.y, r: c.body.r, type: 'kinematic', mass: 50, person: true }) }));

  function add(kind, x, y, more = {}) {
    const shape = SHAPES[kind];
    const body = world.add({ x, y, r: shape.r, mass: shape.mass, bounce: shape.bounce, damping: shape.damping, kind });
    const prop = createProp(stage, kind, body, { ...more, vz: 0, age: 0 });
    prop.solid = collision.add({ x, y, r: shape.r, layer: PROP, mask: layers.SCENERY });
    body.prop = prop;
    loose.push(prop);
    stage.actors.push(prop);
    return prop;
  }
  function remove(prop) {
    world.remove(prop.body); collision.remove(prop.solid);
    loose.splice(loose.indexOf(prop), 1);
    stage.actors.splice(stage.actors.indexOf(prop), 1);
  }
  world.on('begin', (a, b) => {
    const person = a.person ? a : b.person ? b : null; const kicked = person === a ? b : a;
    if (person && kicked.prop && kicked.prop.kind === 'ball') { // walking into the ball kicks it ahead
      const speed = Math.hypot(person.vx, person.vy);
      if (speed > 0.5) { kicked.vx = person.vx * 1.8; kicked.vy = person.vy * 1.8; events.onBump?.(kicked.prop, speed * 2); }
      return;
    }
    if (!a.prop || !b.prop) return;
    const speed = Math.hypot(a.vx - b.vx, a.vy - b.vy);
    events.onHit?.(a.prop, b.prop, speed);
  });

  return {
    world, loose, add, remove,
    /** Add a character made after the yard (a second player) so it pushes props too. */
    addPerson(c) { twins.push({ c, body: world.add({ x: c.body.x, y: c.body.y, r: c.body.r, type: 'kinematic', mass: 50, person: true }) }); },
    /** Throw a stone from a ground point along a ground direction. Returns the stone. */
    throwStone(x, y, dirX, dirY, speed = 13) {
      const stone = add('stone', x + dirX * 0.6, y + dirY * 0.6);
      stone.body.vx = dirX * speed; stone.body.vy = dirY * speed;
      stone.z = 1.2; stone.vz = 3.2; stone.thrown = true;
      return stone;
    },
    /** Push every loose prop near a point away from it (a swing or a kick). Returns the props struck. */
    strike(x, y, dirX, dirY, reach = 1.5, speed = 7) {
      const struck = [];
      for (const prop of loose) {
        const dx = prop.body.x - x; const dy = prop.body.y - y; const d = Math.hypot(dx, dy);
        if (d > reach + prop.body.r || dx * dirX + dy * dirY < -0.2) continue;
        prop.body.vx += dirX * speed / Math.sqrt(prop.body.mass); prop.body.vy += dirY * speed / Math.sqrt(prop.body.mass);
        struck.push(prop);
      }
      return struck;
    },
    /** One step: physics first, then scenery stops whatever the physics moved. */
    update(dt) {
      if (!(dt > 0)) return;
      for (const t of twins) {
        t.body.vx = (t.c.body.x - t.body.x) / dt; t.body.vy = (t.c.body.y - t.body.y) / dt; // so that it ends this step where the character is
      }
      world.step(dt);
      for (let i = loose.length - 1; i >= 0; i--) {
        const prop = loose[i]; const b = prop.body;
        const res = collision.move(prop.solid, b.x - prop.solid.x, b.y - prop.solid.y, { mask: layers.SCENERY });
        if (res.hits.length) {
          const speed = Math.hypot(b.vx, b.vy);
          for (const hit of res.hits) { // bounce off the surface
            const into = b.vx * hit.nx + b.vy * hit.ny;
            if (into < 0) { b.vx -= (1 + b.bounce) * into * hit.nx; b.vy -= (1 + b.bounce) * into * hit.ny; }
          }
          if (speed > 1.5) events.onBump?.(prop, speed);
        }
        b.x = prop.solid.x; b.y = prop.solid.y;
        if (prop.z > 0 || prop.vz > 0) { // a thrown stone's arc; it only looks high, on the ground plane it flies straight
          prop.vz -= 14 * dt; prop.z = Math.max(0, prop.z + prop.vz * dt);
          if (prop.z === 0) { prop.vz = prop.vz < -3 ? -prop.vz * 0.3 : 0; b.damping = 4; if (prop.thrown) events.onBump?.(prop, 2); }
        }
        if (prop.kind === 'stone') { prop.age += dt; if (prop.age > 8) remove(prop); }
      }
    },
    /** Positions of the props that stay (not stones), for a save: [{ name, x, y }]. */
    save: () => loose.filter((p) => p.name).map((p) => ({ name: p.name, x: +p.body.x.toFixed(2), y: +p.body.y.toFixed(2) })),
    /** Put saved props back. Unknown names are ignored. */
    load(saved) {
      for (const s of Array.isArray(saved) ? saved : []) {
        const prop = loose.find((p) => p.name === s.name);
        if (!prop || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
        prop.body.x = s.x; prop.body.y = s.y; prop.body.vx = 0; prop.body.vy = 0;
        collision.teleport(prop.solid, s.x, s.y);
      }
    },
  };
}
