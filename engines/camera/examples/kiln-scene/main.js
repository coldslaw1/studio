// The camera on a Kiln scene, and nothing else: the hamlet, two puppet characters, collision, and
// the camera zooming, turning and following. It loads the sibling engines straight from their
// folders, so serve the whole studio-engines folder:  node camera/examples/serve.mjs
// and open http://127.0.0.1:8140/camera/examples/kiln-scene/ . The hamlet's pictures come from the
// Kiln demo's bake:  node assets/examples/scene-demo/build.mjs
//
// Smallest use of a 3D scene in a game: the rendered hamlet is the backdrop, two rigged
// characters from the puppet engine walk on it, animated live (walk and run blending, turning to
// face where they go, feet following the hills, a cape on springs), and pass behind the houses and
// trees (depth buffer from the renderer). The collision engine keeps them out of buildings and the sea.
// The camera engine zooms, turns and follows: the hamlet is baked from 24 angles and at 2 detail
// levels (a "scene orbit"), and the camera picks which picture to show and where to draw it.
import { loadSceneOrbit } from '../../../assets/src/scene-orbit-view.js';
import { createCollisionWorld } from '../../../collision/src/index.js'; // a game imports its vendored copies instead: ./vendor/collision/index.js
import { createCharacter, createAsciiSprite, projectionFromScene } from '../../../puppet/src/index.js';
import { createCamera, createSceneCamera, attachCameraMouse, screenStep } from '../../src/index.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const query = new URLSearchParams(location.search);
// every angle and detail level of the hamlet; pictures load when the camera first needs them
const baked = await loadSceneOrbit('../../../assets/examples/scene-demo/assets/hamlet.orbit.json', { keep: 10 });
// ?every=3 uses only every third baked angle (8 angles, 45 degrees apart), to see how the smooth turn
// holds up on scenes baked from few angles, such as an open world's pages
const EVERY = Math.max(1, Number(query.get('every')) || 1);
const orbit = EVERY === 1 ? baked : {
  yaws: baked.yaws.filter((_, i) => i % EVERY === 0), details: baked.details,
  view: (yi, li) => baked.view(yi * EVERY, li), load: (yi, li) => baked.load(yi * EVERY, li), has: (yi, li) => baked.has(yi * EVERY, li),
  get pending() { return baked.pending; }, get loaded() { return baked.loaded; },
};
// The camera: Q and E turn it an eighth of a turn, the wheel zooms, dragging turns it freely and it
// settles on the nearest baked angle. Everything is eased, and it follows the player.
// Pixels per character on screen at zoom 1. The bake stores 2 pixels a character, so at 2 the first
// two zoom stops show the pictures exactly as stored and the last one doubles the finest.
const CELL_PX = Number(query.get('cell')) || 2;
const camera = createCamera({ yaws: orbit.yaws, x: 36.5, y: 50, yawStep: 45, maxZoom: 2 * orbit.details.at(-1) / orbit.details[0] });
const sceneCamera = await createSceneCamera({ camera, orbit, width: canvas.width, height: canvas.height, cellPx: CELL_PX, ahead: EVERY === 1 ? 3 : 1, dissolve: true }).ready(); // ahead 3: the angles one Q or E press passes are loaded while the camera rests
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
const DETAIL = Number(query.get('detail')) || 3;
const MAX_FINE = Number(query.get('fine')) || 8;
const groundAt = (x, y) => world.heightAt(x, y) / 16; // scene heights are in sixteenths of a unit
let seed = 5;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function rigged(model) {
  const actor = createCharacter({ model, groundAt, rng, wind: [0.8, 0.3, 0], gust: 0.7 });
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
attachCameraMouse(camera, canvas, { degreesPerPixel: -0.4 }); // the wheel zooms; dragging (any button) turns, with the near scenery following the mouse
// One canvas pixel per screen pixel, whatever the window size: a stretched canvas makes characters
// uneven and shimmer when the camera moves. A bigger window simply shows more of the hamlet.
function fitCanvas() {
  const ratio = globalThis.devicePixelRatio || 1;
  // as big as the window allows (leaving room for the text below), but never bigger than the
  // whole picture at the widest zoom, so there is no empty border round the island
  const w = Math.max(320, Math.min(world.cols * CELL_PX, Math.round(innerWidth * 0.96 * ratio)));
  const h = Math.max(200, Math.min(world.rows * CELL_PX, Math.round((innerHeight - 150) * ratio)));
  canvas.style.width = `${w / ratio}px`; canvas.style.height = `${h / ratio}px`;
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w; canvas.height = h;
  sceneCamera.resize(w, h);
}
fitCanvas();
addEventListener('resize', fitCanvas);

const keys = new Set();
let occlude = true; // press O to compare with the old always-on-top drawing
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (!keys.has(k)) {
    if (k === 'o') occlude = !occlude;
    if (k === 'j') player.actor.attack();
    if (k === 'g') player.actor.wave(player.actor.animator.layerState('upper') !== 'wave');
    if (k === 'k') { if (player.actor.state === 'die') player.actor.revive(); else player.actor.die(); }
    if (k === 'q') camera.rotateSteps(-1);
    if (k === 'e') camera.rotateSteps(1);
    if (k === '=' || k === '+') camera.zoomBy(1);
    if (k === '-') camera.zoomBy(-1);
    if (k === '0') camera.zoomTo(1).rotateTo(orbit.yaws[0]);
  }
  keys.add(k);
  if (e.key.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function update(dt) {
  const dx = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
  const dy = (keys.has('arrowdown') || keys.has('s') ? 1 : 0) - (keys.has('arrowup') || keys.has('w') ? 1 : 0);
  player.vx = 0; player.vy = 0;
  if ((dx !== 0 || dy !== 0) && player.actor.state !== 'die' && dt > 0) {
    const speed = player.actor.walkSpeed * (keys.has('shift') ? 2.6 : 1); // walk, or run with Shift
    const [sx, sy] = screenStep(view, dx, dy, speed * dt); // right is right on screen, whatever the camera angle
    const res = collision.move(player.body, sx, sy); // stops at walls and slides along them
    player.vx = res.dx / dt; player.vy = res.dy / dt; // what really happened, so walking into a wall slows the legs
  }
  npc.vx = 0; npc.vy = 0;
  const [tx, ty] = npc.route[npc.leg];
  const d = Math.hypot(tx - npc.body.x, ty - npc.body.y);
  if (d < 0.2 || npc.stuck > 1) { npc.leg = (npc.leg + 1) % npc.route.length; npc.stuck = 0; } else if (dt > 0) {
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
  for (const c of [player, npc]) c.events = c.actor.update(dt, { x: c.body.x, y: c.body.y, vx: c.vx, vy: c.vy });
  // the guard keeps an eye on the villager when they are close
  const close = Math.hypot(player.body.x - npc.body.x, player.body.y - npc.body.y) < 8;
  npc.actor.lookAt(close ? [player.body.x, player.body.y, groundAt(player.body.x, player.body.y) + 1.6] : null);
  camera.update(dt); // eases the zoom and the turn, and keeps up with the player
}

function drawCharacter(c) {
  // drawSprite cuts away the parts of the character that are behind houses, trees and hills
  // `view` is the camera's frame view: while the camera turns and the picture is bent to its true angle,
  // its drawSprite keeps the character on the ground it stands on
  c.drawn = view.drawSprite(ctx, rect, spriteFor(c, view), c.body.x, c.body.y, { scale: SPRITE_SCALE, occlude });
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
let last = performance.now(); let cost = 0; let shown = '';
function frame(now) {
  update(Math.max(0, Math.min(0.05, (now - last) / 1000)));
  last = now;
  const t0 = performance.now();
  ctx.fillStyle = '#10131f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // the camera picks the picture (angle and detail level) and where it goes, and draws it; while it
  // turns, the next angle fades in over the last one
  const f = sceneCamera.draw(ctx, { seconds: now / 1000 });
  view = f.view; rect = f.rect;
  [player, npc].sort((p, q) => view.depthOf(p.body.x, p.body.y) - view.depthOf(q.body.x, q.body.y)).forEach(drawCharacter);
  if (debug) drawOutlines();
  cost += (performance.now() - t0 - cost) * 0.05;
  const text = `camera ${Math.round(orbit.yaws[f.yawIndex])} degrees, zoom ${camera.zoom.toFixed(2)}, detail ${orbit.details[f.level]}${f.waiting ? ' (loading)' : ''}, drawing ${cost.toFixed(1)} ms a frame`;
  if (stats && text !== shown) { stats.textContent = text; shown = text; }
  requestAnimationFrame(frame);
}
window.demo = { player, npc, world, collision, update, camera, sceneCamera, orbit, get view() { return view; }, get rect() { return rect; }, get cost() { return cost; }, set outlines(v) { debug = v; } };
requestAnimationFrame(frame);
