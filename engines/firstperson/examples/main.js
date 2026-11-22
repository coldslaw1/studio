// Smallest use of the first-person engine: rolling ground, a sea, a few boxes and one figure made
// of capsules. Click the picture to look with the mouse, W A S D to walk. Serve this folder's parent
// over http (node examples/serve.mjs) and open examples/index.html.
import { createFpWorld, createFirstPerson, createFpCamera, createMouseLook, walkDirection } from '../src/index.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ground: 60 x 60 m, a height every 2 m
const cols = 31; const rows = 31;
const heights = [];
for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) heights.push(1.2 + Math.sin(i / 3) * Math.cos(j / 4) * 1.4);
// one material for every metre: sand near the water, grass above
const data = new Uint8Array(60 * 60);
const heightOf = (x, y) => 1.2 + Math.sin(x / 6) * Math.cos(y / 8) * 1.4;
for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) data[y * 60 + x] = heightOf(x + 0.5, y + 0.5) < 0.5 ? 1 : 0;

/** A box as triangles. */
function box(out, x0, y0, z0, x1, y1, z1, rgb) {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  for (const [a, b, c, d] of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]) {
    out.triangles.push(...p[a], ...p[b], ...p[c], ...p[a], ...p[c], ...p[d]); out.colors.push(...rgb, ...rgb);
  }
}
const objects = { triangles: [], colors: [] };
for (const [x, y, w, h, rgb] of [[30, 34, 4, 3, [216, 200, 160]], [38, 28, 2, 6, [140, 140, 150]], [24, 26, 1, 1, [154, 106, 58]]]) {
  const z = heightOf(x, y) - 0.3;
  box(objects, x - w / 2, y - w / 2, z, x + w / 2, y + w / 2, z + h, rgb);
}

const world = createFpWorld({
  ground: { step: 2, cols, rows, heights, materials: { cols: 60, rows: 60, data } },
  materials: [{ glyph: ',', fg: '#66cc66', bg: '#339933' }, { glyph: ':', fg: '#ffff99', bg: '#cccc66' }],
  triangles: objects.triangles, colors: objects.colors,
  water: { level: 0.2 },
  light: { dir: [1, -0.5, 1], ambient: 0.55 },
});
const view = createFirstPerson({ world, cols: 240, rows: 160, cellPx: 4 });
const camera = createFpCamera({ x: 30, y: 22, yaw: 90 });
const look = createMouseLook(camera, canvas);
canvas.addEventListener('click', () => look.lock());

// a figure: the same shape list a puppet-engine rig gives from puppet.shapes()
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const figure = (t) => [
  { shape: 'capsule', a: [-0.12, 0, 0.1], b: [-0.12, Math.sin(t * 6) * 0.25, 0.85], r0: 0.09, r1: 0.11, color: '#5a4630' },
  { shape: 'capsule', a: [0.12, 0, 0.1], b: [0.12, -Math.sin(t * 6) * 0.25, 0.85], r0: 0.09, r1: 0.11, color: '#5a4630' },
  { shape: 'capsule', a: [0, 0, 0.9], b: [0, 0, 1.4], r0: 0.2, r1: 0.22, color: '#3a5fc8' },
  { shape: 'ball', c: [0, 0, 1.66], m: I, r: [0.15, 0.15, 0.17], color: '#e8c8a0' },
  { shape: 'box', c: [0, 0, 1.84], m: I, half: [0.24, 0.24, 0.03], color: '#c8a040', flat: true },
];

const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
const stats = document.getElementById('stats');
let last = performance.now(); let cost = 0; let time = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0); const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const [dx, dy] = walkDirection(camera.yaw, forward, strafe);
  // a real game moves a body through the collision engine here: collision.move(body, dx * speed * dt, dy * speed * dt)
  camera.x = Math.min(59, Math.max(1, camera.x + dx * 3 * dt)); camera.y = Math.min(59, Math.max(1, camera.y + dy * 3 * dt));
  camera.z = world.heightAt(camera.x, camera.y) + 1.62;
  const fx = 30 + Math.cos(time * 0.4) * 5; const fy = 30 + Math.sin(time * 0.4) * 5;
  const t0 = performance.now();
  view.render(camera, { solids: [{ at: [fx, fy, world.heightAt(fx, fy)], shapes: figure(time) }], casters: [{ x: fx, y: fy, r: 0.3, h: 1.8 }] });
  view.draw(ctx, 0, 0, canvas.width, canvas.height);
  cost += (performance.now() - t0 - cost) * 0.05;
  stats.textContent = `${view.cols} x ${view.rows} characters, ${cost.toFixed(1)} ms a frame${look.locked ? '' : ' - click the picture to look around'}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
