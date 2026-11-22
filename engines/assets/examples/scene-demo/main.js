// Smallest use of a 3D scene in a game: the rendered hamlet is the backdrop, two rigged
// characters from the puppet engine walk on it, animated live (walk and run blending, turning to
// face where they go, feet following the hills, a cape on springs), and pass behind the houses and
// trees (depth buffer from the renderer). The collision engine keeps them out of buildings and the sea.
// The camera engine zooms, turns and follows: the hamlet is baked from 24 angles and at 4 detail
// levels (a "scene orbit"), and the camera picks which picture to show and where to draw it.
// Build the art first: node examples/scene-demo/build.mjs
import { loadSceneOrbit } from '../../src/scene-orbit-view.js';
import { createCollisionWorld } from './vendor/collision/index.js'; // node ../vendor.mjs collision puppet camera --into examples/scene-demo
import { createCharacter, createAsciiSprite, projectionFromScene } from './vendor/puppet/index.js';
import { createCamera, createSceneCamera, attachCameraMouse, screenStep } from './vendor/camera/index.js';
import { drawSpriteCached } from './game/sprite-cache.js';
import { startShowcase } from './game/index.js'; // node ../vendor.mjs core audio dialogue ui levels physics playbot net --into examples/scene-demo

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const query = new URLSearchParams(location.search);
// every angle and detail level of the hamlet; pictures load when the camera first needs them
const orbit = await loadSceneOrbit('./assets/hamlet.orbit.json', { keep: 10 });
// The camera: Q and E turn it an eighth of a turn, the wheel zooms, dragging turns it freely and it
// settles on the nearest baked angle. Everything is eased, and it follows the player.
const CELL_PX = Number(query.get('cell')) || 2; // pixels per character on screen, the same at every zoom
// yawStep is negative because a rising Kiln yaw turns the view to the left: E (camera-right) must look right, as it does in the orbit view
const camera = createCamera({ yaws: orbit.yaws, x: 36.5, y: 50, yawStep: -45, maxZoom: 4 });
const sceneCamera = await createSceneCamera({ camera, orbit, width: canvas.width, height: canvas.height, cellPx: CELL_PX, ahead: 3 }).ready();
// `world` is the first picture. Ground facts (heights, water, outlines of the buildings) are the same
// from every angle, so they are read from it once; `view` and `rect` are what is on screen now.
const world = sceneCamera.frame().view;
let view = world;
let rect = sceneCamera.frame().rect;
// 1 draws the characters true to life: the rigs are 1.8 units tall and the scene is in metres, so a
// villager fits through the gate and under the eaves. Try ?scale=2 for easy-to-read giants. The
// collision below is sized from the picture, so it follows whatever scale is used.
const SPRITE_SCALE = Number(query.get('scale')) || 1.0;

// Characters: a rig animated by the puppet engine, shown as text cells made fresh every frame with
// the camera of the picture on screen, so they turn with it. DETAIL = how many times finer the
// character's cells are than the backdrop's at the widest zoom; zoomed in, the backdrop gets finer and
// the characters stop at MAX_FINE cells per unit, which keeps them cheap to draw.
let DETAIL = Number(query.get('detail')) || 3; // the game's Detail setting changes it (stage.detail)
let MAX_FINE = Math.max(8, DETAIL * orbit.details[0]);
const groundAt = (x, y) => world.heightAt(x, y) / 16; // scene heights are in sixteenths of a unit
let seed = 5;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function rigged(model, options = {}) {
  const actor = createCharacter({ model, groundAt, rng, wind: [0.8, 0.3, 0], gust: 0.7, ...options });
  actor.update(0); // stand in the rest pose, so the picture can be measured
  return { actor, sprites: new WeakMap() };
}
/** The character's text sprite for one picture of the orbit (made once per picture, then kept). */
function spriteFor(c, scene) {
  if (!c.sprites.has(scene)) {
    const detail = Math.min(scene.detail * DETAIL, MAX_FINE) / scene.detail;
    c.sprites.set(scene, createAsciiSprite(c.actor.puppet, { projection: projectionFromScene(scene), detail, text: 0.3 }));
  }
  return c.sprites.get(scene);
}
const walker = rigged('villager');
const guard = rigged('knight');

// Collision, all in ground units, sized from the pictures so nothing is ever drawn cutting into
// something else: each character is a circle as wide as its sprite, and scenery is blocked
// wherever it is lower than the characters' heads (so also under eaves and tree tops). It is measured
// once, on the first picture: the ground does not change when the camera turns, so neither does this.
const SCENERY = 1; const CHARACTER = 2;
const sizes = new Map([walker, guard].map((c) => [c, world.spriteExtent(spriteFor(c, world), { scale: SPRITE_SCALE })]));
const headHeight = Math.max(...[...sizes.values()].map((e) => e.height));
const collision = createCollisionWorld({ cellSize: 4, skin: 0.005 });
// every object's real ground outline (walls, trunks, posts), turned and scaled like the object
for (const outline of world.footprints({ maxZ: headHeight })) collision.add({ ...outline, layer: SCENERY });
// the sea and the edge of the map, as a grid of half-unit tiles worked out on demand
const TILE = 0.5; const solidTiles = new Map();
collision.addTiles({
  tileSize: TILE,
  isSolid(col, row) {
    const key = col + ',' + row;
    if (!solidTiles.has(key)) {
      const x = (col + 0.5) * TILE; const y = (row + 0.5) * TILE;
      solidTiles.set(key, x < 2 || y < 2 || x > 78 || y > 78 || world.isWater(x, y));
    }
    return solidTiles.get(key);
  },
}, { layer: SCENERY });
const character = (c, x, y, more) => ({ ...c, body: collision.add({ x, y, r: sizes.get(c).radius, layer: CHARACTER }), vx: 0, vy: 0, ...more });

const player = character(walker, 36.5, 50);
// the patrol keeps clear of everything by more than the guard's own width, and its second stop is behind the tower
const npc = character(guard, 40, 28, { route: [[40, 28], [49.6, 30.5], [40, 31], [40, 54], [40, 47], [45, 47], [40, 44]], leg: 0, stuck: 0, dodge: 0 });
camera.follow(player.body).snap();
attachCameraMouse(camera, canvas, { degreesPerPixel: -0.4, threshold: 8, buttons: [0, 1], wheelKeys: 'held', enabled: () => stage.mouseOn() }); // right button and plain wheel belong to the game (guard, hotbar); Shift + wheel zooms // the wheel zooms; dragging turns, with the near scenery following the mouse

// This file is the stage: the scene, its camera, the characters and what blocks them. The game on
// top of it (game/index.js: the core loop and input, menus, sound, the quest, the cellar, props,
// auto-play and two-player) reads the keys and tells the stage what the player wants each step.
let occlude = true; // the game's O key and settings switch this, to compare with the old always-on-top drawing
const actors = [player, npc]; // everything drawn standing on the ground, sorted by depth each frame; the game adds more
/** Add a rigged character at a ground point. `more` is kept on it (a name, a route...). It is drawn and animated from then on. */
function addCharacter(model, x, y, more = {}, rigOptions = {}) {
  const c = rigged(model, rigOptions);
  sizes.set(c, world.spriteExtent(spriteFor(c, world), { scale: SPRITE_SCALE }));
  const made = character(c, x, y, { vx: 0, vy: 0, ...more });
  actors.push(made);
  return made;
}

const IDLE = { dx: 0, dy: 0, run: false };
/** One step of the stage. `intent` is what the player wants: dx, dy (-1..1, screen directions) and run. */
let clock = 0; // seconds of game time
function update(dt, intent = IDLE) {
  clock += dt;
  const { dx, dy } = intent;
  if (!player.remote) { player.vx = 0; player.vy = 0; }
  if ((dx !== 0 || dy !== 0) && player.actor.state !== 'die' && dt > 0) {
    const speed = player.actor.walkSpeed * (intent.run ? 2.6 : 1) * Math.min(1, Math.hypot(dx, dy)); // walk, or run with Shift
    const [sx, sy] = screenStep(view, dx, dy, speed * dt); // right is right on screen, whatever the camera angle
    const res = collision.move(player.body, sx, sy); // stops at walls and slides along them
    player.vx = res.dx / dt; player.vy = res.dy / dt; // what really happened, so walking into a wall slows the legs
  }
  npc.vx = 0; npc.vy = 0;
  const [tx, ty] = npc.route[npc.leg];
  const d = Math.hypot(tx - npc.body.x, ty - npc.body.y);
  if (npc.halt) { /* the game stops the guard while someone talks to him */ } else if (d < 0.2 || npc.stuck > 1) { npc.leg = (npc.leg + 1) % npc.route.length; npc.stuck = 0; } else if (dt > 0) {
    const step = Math.min(d, npc.actor.walkSpeed * dt);
    // heading for the waypoint; for a moment after bumping into something, veer to one side to get round it
    let hx = (tx - npc.body.x) / d; let hy = (ty - npc.body.y) / d;
    if (npc.dodge > 0) { [hx, hy] = [hx * 0.5 - hy * 0.866, hx * 0.866 + hy * 0.5]; npc.dodge -= dt; }
    const res = collision.move(npc.body, hx * step, hy * step);
    if (res.hits.length && npc.dodge <= 0 && Math.hypot(res.dx, res.dy) < step * 0.5) npc.dodge = 0.6;
    // a guard that makes no headway toward its waypoint for a second gives up on it
    npc.stuck = Math.hypot(tx - npc.body.x, ty - npc.body.y) > d - step * 0.3 ? npc.stuck + dt : 0;
    npc.vx = res.dx / dt; npc.vy = res.dy / dt;
  }
  // the game owns movement; each character is told where it is and how fast it goes, and animates to match
  for (const c of actors) if (c.actor) c.events = c.actor.update(dt, { x: c.body.x, y: c.body.y, vx: c.vx, vy: c.vy });
  // the guard keeps an eye on the villager when they are close
  const close = Math.hypot(player.body.x - npc.body.x, player.body.y - npc.body.y) < 8;
  npc.actor.lookAt(close ? [player.body.x, player.body.y, groundAt(player.body.x, player.body.y) + 1.6] : null);
  if (!stage.cameraPerFrame) camera.update(dt); // eases the zoom and the turn, and keeps up with the player (the game does this per drawn frame instead, so it stays smooth between ticks)
}

/**
 * When a character's picture is made again. Painting a rig as text cells is the costly part of a
 * frame (near a millisecond each), so only the player is repainted on every tick; someone walking
 * is repainted every second tick, and someone standing (breathing, looking about) every third.
 */
function poseStamp(c) {
  const v = c.actor.puppet.version;
  if (c === player) return v;
  return Math.floor(v / (Math.hypot(c.vx || 0, c.vy || 0) < 0.05 ? 3 : 2));
}
function drawCharacter(c) {
  // drawSprite cuts away the parts of the character that are behind houses, trees and hills
  // (the finished cut-out picture is kept and reused until the character moves or its pose changes: game/sprite-cache.js)
  c.drawn = drawSpriteCached(c, ctx, view, rect, spriteFor(c, view), c.body.x, c.body.y, { scale: SPRITE_SCALE, occlude }, poseStamp(c) + ':' + DETAIL, canvas) ?? c.drawn;
}

let debug = query.has('outlines'); // ?outlines draws the collision shapes
function drawOutlines() {
  ctx.save();
  ctx.strokeStyle = '#ff40c0'; ctx.lineWidth = 1.5;
  for (const b of collision.bodies) {
    if (!b.points && !b.r) continue;
    const pts = b.points ? b.points.map(([px, py]) => [b.x + px, b.y + py]) : Array.from({ length: 12 }, (_, i) => [b.x + b.r * Math.cos(i / 6 * Math.PI), b.y + b.r * Math.sin(i / 6 * Math.PI)]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const p = view.toPoint(x, y, rect); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

const stats = document.getElementById('stats');
let W = canvas.width; let H = canvas.height; // the canvas size in its own pixels; the game keeps it at one canvas pixel per screen pixel
/**
 * The window changed size: take as much of it as is useful. A stretched canvas makes characters
 * uneven and shimmer, so the canvas is never scaled; a bigger window simply shows more of the hamlet,
 * up to the whole picture at the widest zoom.
 * @returns {[number, number]} the canvas size to use, in canvas pixels
 */
function resize(w, h) {
  W = Math.max(320, Math.min(world.cols * CELL_PX, Math.round(w)));
  H = Math.max(240, Math.min(world.rows * CELL_PX, Math.round(h)));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  sceneCamera.resize(W, H);
  return [W, H];
}
let cost = 0; let shown = '';
/** Draw the stage: the backdrop for the camera's angle and zoom, then everything standing on it, far to near. */
function draw() {
  const t0 = performance.now();
  // the camera picks the picture (angle and detail level) and the rectangle that puts the player mid-screen
  ctx.fillStyle = '#10131f';
  ctx.fillRect(0, 0, W, H);
  // The camera draws the backdrop. While it turns, the baked picture is bent to the camera's true
  // angle and the next angle fades in, so the ground turns smoothly instead of jumping 15 degrees.
  // f.view places sprites and markers on the bent picture (its drawSprite and toPoint follow it).
  // An animated bake (water, grass) plays on the game clock.
  const f = sceneCamera.draw(ctx, { seconds: clock });
  view = f.view; rect = f.rect;
  // an actor with its own draw(ctx, view, rect, occlude) is a prop of the game; the others are rigged characters
  actors.filter((c) => !c.hidden).sort((p, q) => view.depthOf(p.body.x, p.body.y) - view.depthOf(q.body.x, q.body.y))
    .forEach((c) => (c.draw ? c.draw(ctx, view, rect, occlude) : drawCharacter(c)));
  if (debug) drawOutlines();
  cost += (performance.now() - t0 - cost) * 0.05;
  const text = `camera ${Math.round(orbit.yaws[f.yawIndex])} degrees, zoom ${camera.zoom.toFixed(2)}, detail ${orbit.details[f.level]}${f.waiting ? ' (loading)' : ''}, drawing ${cost.toFixed(1)} ms a frame`;
  if (stats && text !== shown) { stats.textContent = text; shown = text; }
}
const stage = {
  /** True while the mouse may steer this camera. The game replaces it (false under menus, dialogue, or in the open world). */
  mouseOn: () => true,
  canvas, get width() { return W; }, get height() { return H; }, resize, query, player, npc, actors, world, collision, camera, sceneCamera, orbit, update, draw, addCharacter, groundAt,
  layers: { SCENERY, CHARACTER }, spriteScale: SPRITE_SCALE, headHeight,
  get view() { return view; }, get rect() { return rect; }, get cost() { return cost; },
  get occlude() { return occlude; }, set occlude(v) { occlude = !!v; },
  /** How fine the characters are drawn: 2 coarse, 3 normal, 5 fine. Changing it remakes their sprites. */
  get detail() { return DETAIL; },
  set detail(v) {
    if (!(v >= 1 && v <= 8)) throw new Error(`stage.detail: expected a number from 1 to 8, got ${v}`);
    if (v === DETAIL) return;
    DETAIL = v; MAX_FINE = Math.max(8, DETAIL * orbit.details[0]);
    for (const c of actors) if (c.sprites) c.sprites = new WeakMap();
  },
  get outlines() { return debug; }, set outlines(v) { debug = !!v; },
};
window.demo = stage;
// The game: core's loop calls stage.update and stage.draw from its scenes (see game/index.js).
window.showcase = startShowcase(stage);
