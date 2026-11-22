// Roam: the smallest game-shaped use of the world engine. An endless seeded land you can walk or
// fly across in three looks (top-down, isometric, characters), with wandering hares, a keeper
// at every camp, and pillars you can build that are still there after a reload.
import {
  createWorld, createTerrain, createEntities, createView, visitChunks, createChunkCache, createTileMap,
  createGridMapper, createKeyStore, createMemoryStore, stampRows, rand2, GROUND, OBJECT,
} from '../../src/index.js';
import { paintOrtho, paintIso, ISO_HEAD, LEGEND, drawGridPlain } from './draw.js';

const TILE = 16; const CHUNK = 32; const SEED = 'roam-1';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

// Kiln's character renderer, when the assets engine sits next to this one (optional)
let kiln = null;
try { const [a, b] = await Promise.all([import('../../../assets/src/scene-draw.js'), import('../../../assets/src/ascii.js')]); kiln = { drawGrid: a.drawGrid, ramp: b.RAMP ?? [] }; } catch { /* plain text fallback */ }

const camp = {
  name: 'camp', spacing: 72, chance: 0.7, radius: 9, // the path below reaches 9 tiles from the centre biomes: ['meadow', 'steppe', 'forest'],
  stamp(poi, put) {
    stampRows(poi, put, ['  #####  ', ' #.....# ', '#.......#', '#...f....', '#.......#', ' #.....# ', '  #####  '],
      { '#': { object: OBJECT.wall }, '.': { ground: GROUND.floor, object: OBJECT.none }, f: { ground: GROUND.floor, object: OBJECT.fire }, ' ': null });
    for (let i = 1; i < 6; i++) put(poi.tx + 4 + i, poi.ty, 'ground', GROUND.path); // a short path out of the gate
    put(poi.tx + poi.rng.int(-2, 2), poi.ty + 2, 'object', OBJECT.chest);
  },
};
const terrain = createTerrain({ seed: SEED, pois: [camp] });
let storage = null;
try { storage = globalThis.localStorage; storage.getItem('x'); } catch { storage = null; }
const store = storage ? createKeyStore(storage, 'world-roam:') : createMemoryStore();
const world = createWorld({ generate: terrain.generate, chunkSize: CHUNK, tileSize: TILE, layers: { ground: 'u8', object: 'u8', height: 'u8' }, loadRadius: 3, maxLoadsPerUpdate: 2, store, seed: SEED });
const solid = createTileMap(world, { solid: { ground: [GROUND.deep, GROUND.water, GROUND.rock], object: [OBJECT.wall, OBJECT.tree, OBJECT.pine, OBJECT.boulder, OBJECT.pillar] } });

const ents = createEntities({
  world, activeRadius: 520, nearRadius: 1000,
  update(e, dt, tier) {
    e.turn -= dt;
    if (e.turn <= 0) { // pick a new heading; keepers drift back toward their camp
      e.turn = 1 + rand2(e.seed, e.n++, 0) * 3;
      const a = e.home && Math.hypot(e.x - e.home[0], e.y - e.home[1]) > 40 ? Math.atan2(e.home[1] - e.y, e.home[0] - e.x) : rand2(e.seed, e.n++, 1) * 6.283;
      e.vx = Math.cos(a) * e.speed; e.vy = Math.sin(a) * e.speed;
    }
    const nx = e.x + e.vx * dt; const ny = e.y + e.vy * dt;
    // far entities skip the wall check: nobody can see them, and it keeps them cheap
    if (tier < 2 && solid.isSolid(Math.floor(nx / TILE), Math.floor(ny / TILE))) { e.vx = -e.vx; e.vy = -e.vy; } else { e.x = nx; e.y = ny; }
  },
  spawn(chunk, info, add) {
    for (let i = 0; i < 6; i++) { // hares: not saved, the same ones appear whenever the chunk loads
      const tx = chunk.x0 + Math.floor(rand2(11, chunk.key % 99991, i) * CHUNK); const ty = chunk.y0 + Math.floor(rand2(12, chunk.key % 99991, i) * CHUNK);
      if (!solid.isSolid(tx, ty)) add({ kind: 'hare', x: tx * TILE + 8, y: ty * TILE + 8, vx: 0, vy: 0, speed: 26, turn: 0, seed: chunk.key % 99991 + i, n: 0 });
    }
    if (!info.spawned) for (const f of chunk.features) { // one keeper per camp: saved, so made only once
      const x = f.tx * TILE + 8; const y = (f.ty + 1) * TILE + 8;
      add({ kind: 'keeper', persist: true, x, y, home: [x, y], vx: 0, vy: 0, speed: 14, turn: 0, seed: f.seed, n: 0 });
    }
  },
});

// one view and one picture cache per look
const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const mapper = createGridMapper(LEGEND);
const looks = {
  ortho: { view: createView({ mode: 'ortho', tileSize: TILE, width: canvas.width, height: canvas.height }), dx: 0, dy: 0,
    cache: createChunkCache(world, { build(chunk) { const c = makeCanvas(CHUNK * TILE, CHUNK * TILE); paintOrtho(chunk, c.getContext('2d'), TILE); return c; } }) },
  iso: { view: createView({ mode: 'iso', tileSize: TILE, tileW: 32, tileH: 16, width: canvas.width, height: canvas.height }), dx: -CHUNK * 16, dy: -ISO_HEAD,
    cache: createChunkCache(world, { build(chunk) { const c = makeCanvas(CHUNK * 32, CHUNK * 16 + ISO_HEAD); paintIso(chunk, c.getContext('2d'), 32, 16); return c; } }) },
  chars: { view: createView({ mode: 'ortho', tileSize: TILE, width: canvas.width, height: canvas.height }), dx: 0, dy: 0,
    cache: createChunkCache(world, { build(chunk) {
      const c = makeCanvas(CHUNK * TILE, CHUNK * TILE); const grid = mapper.toGrid(chunk);
      if (kiln) kiln.drawGrid(c.getContext('2d'), grid, mapper.palette, TILE / 8, 0, kiln.ramp); else drawGridPlain(c.getContext('2d'), grid, mapper.palette, TILE);
      return c;
    } }) },
};
let look = 'iso';

const saved = store.get('player', null);
const player = { x: saved?.x ?? 8, y: saved?.y ?? 8 };
const keys = new Set();
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === '1') look = 'ortho'; if (k === '2') look = 'iso'; if (k === '3') look = 'chars';
  if (k === ' ') { const tx = Math.floor(player.x / TILE); const ty = Math.floor(player.y / TILE) + 1; world.setTile('object', tx, ty, world.getTile('object', tx, ty) === OBJECT.pillar ? OBJECT.none : OBJECT.pillar); }
  if (k === 't') { player.x += 4e6; player.y -= 1.5e6; }
  if (k === 'r' && storage) { for (const key of Object.keys(storage)) if (key.startsWith('world-roam:')) storage.removeItem(key); location.reload(); }
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const demo = { world, ents, player, terrain, auto: false, updateMs: 0, drawMs: 0, frames: 0, samples: [], get look() { return look; }, set look(v) { look = v; } };
window.demo = demo;

function update(dt) {
  let dx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  let dy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  const fly = keys.has('shift') || demo.auto;
  if (demo.auto) { dx = 1; dy = 0.2; }
  if (look === 'iso' && !demo.auto) { const sx = dx; dx = sx + dy; dy = dy - sx; } // screen directions -> ground directions
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const speed = fly ? 1400 : 90;
    const nx = player.x + dx / len * speed * dt; const ny = player.y + dy / len * speed * dt;
    const free = (x, y) => fly || !solid.isSolid(Math.floor(x / TILE), Math.floor(y / TILE));
    if (free(nx, ny)) { player.x = nx; player.y = ny; } else if (free(nx, player.y)) player.x = nx; else if (free(player.x, ny)) player.y = ny;
  }
  world.update(dt, player);
  ents.update(dt, player);
}

const visible = []; const at = { x: 0, y: 0 };
function draw() {
  const { view, cache, dx, dy } = looks[look];
  view.lookAt(player.x, player.y);
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const b = view.tileBounds(2);
  let builds = 0; // paint at most one new chunk picture per frame so no frame gets heavy
  visitChunks(world, b, (chunk) => {
    let pic = cache.peek(chunk);
    if (!pic && builds++ < 1) pic = cache.get(chunk);
    if (!pic) return;
    view.toScreen(chunk.x0 * TILE, chunk.y0 * TILE, at);
    ctx.drawImage(pic, Math.round(at.x + dx), Math.round(at.y + dy));
  });
  visible.length = 0;
  ents.queryRect(b.tx0 * TILE, b.ty0 * TILE, (b.tx1 - b.tx0 + 1) * TILE, (b.ty1 - b.ty0 + 1) * TILE, visible);
  visible.push(player);
  visible.sort((p, q) => view.depth(p.x, p.y) - view.depth(q.x, q.y));
  for (const e of visible) {
    view.toScreen(e.x, e.y, at);
    if (look === 'chars') { ctx.fillStyle = e === player ? '#ffffff' : e.kind === 'keeper' ? '#ffb347' : '#f2e6d0'; ctx.font = 'bold 16px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e === player ? '@' : e.kind === 'keeper' ? 'K' : 'h', at.x, at.y); continue; }
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(at.x, at.y, 6, 3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = e === player ? '#f5f1e6' : e.kind === 'keeper' ? '#d9822b' : '#c9b79a';
    const h = e === player ? 16 : e.kind === 'keeper' ? 14 : 6;
    ctx.fillRect(at.x - 3, at.y - h, 6, h);
    if (e === player) { ctx.fillStyle = '#c0392b'; ctx.fillRect(at.x - 4, at.y - 12, 8, 5); }
  }
}

let last = performance.now(); let acc = 0; let sinceSave = 0; let sumU = 0; let sumD = 0; let count = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  const t0 = performance.now();
  let ran = 0;
  while (acc >= 1 / 60) { update(1 / 60); acc -= 1 / 60; sinceSave += 1 / 60; ran++; }
  const t1 = performance.now();
  draw();
  const t2 = performance.now();
  demo.frames++; if (ran) demo.samples.push(t2 - t0); // only frames that ran a step count for the benchmark if (demo.samples.length > 6000) demo.samples.shift();
  sumU += t1 - t0; sumD += t2 - t1; count++;
  if (sinceSave > 5) { sinceSave = 0; store.set('player', { x: player.x, y: player.y }); demo.lastSave = world.save(); }
  if (count === 30) {
    demo.updateMs = sumU / count; demo.drawMs = sumD / count; sumU = sumD = count = 0;
    const w = world.stats(); const s = ents.stats(); const here = terrain.sample(Math.floor(player.x / TILE), Math.floor(player.y / TILE));
    hud.textContent = `tile ${Math.floor(player.x / TILE)}, ${Math.floor(player.y / TILE)}  ${here.biome ? here.biome.name : 'water / rock'}   look: ${look}${look === 'chars' ? (kiln ? ' (Kiln drawGrid)' : ' (plain text)') : ''}\n`
      + `chunks ${w.loaded} loaded, ${w.pooled} pooled, ${w.generated} made so far   entities ${s.count} (active ${s.active}, near ${s.near}, far ${s.far}), ${s.steps} updated this step\n`
      + `update ${demo.updateMs.toFixed(2)} ms   draw ${demo.drawMs.toFixed(2)} ms   of a 16.7 ms frame`;
  }
  requestAnimationFrame(frame);
}
world.loadAll(player);
requestAnimationFrame(frame);
