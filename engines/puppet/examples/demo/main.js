// Smallest complete use of the puppet engine: three characters on hilly ground, drawn twice
// from the same rigs (vector on the left, live ASCII on the right). The player is driven by the
// keyboard; the game owns movement and tells each character where it is every frame.
import { createCharacter, createVectorRenderer, createAsciiSprite, frontProjection, project, ITEMS } from '../../src/index.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const HALF = canvas.width / 2;
const UNIT = 92; // pixels per world unit
const CELL = 5; // pixels per ASCII cell
const PITCH = 32;
const camera = frontProjection({ unit: UNIT, pitch: PITCH });
const cells = frontProjection({ unit: UNIT / CELL, pitch: PITCH });
const groundAt = (x, y) => 0.32 * Math.sin(x * 0.8) * Math.cos(y * 0.6) + (x > 1.7 ? 0.3 : 0);
const toScreen = (p, ox) => { const s = project(p, camera); return [ox + HALF / 2 + s[0], 400 + s[1]]; };

// four looks, in the spirit of Kiln's styles (pass a real Kiln style object for an exact match)
const LOOKS = [
  { name: 'storybook', shading: 'cel', outline: 3.2, groundShadow: 0.22 },
  { name: 'nocturne', shading: 'glow', outline: 0, groundShadow: 0 },
  { name: 'papercut', shading: 'paper', outline: 0, groundShadow: 0.14 },
  { name: 'crypt', shading: 'painted', outline: 1.6, groundShadow: 0.3 },
];
let look = 0;
let vector = createVectorRenderer({ style: LOOKS[look], projection: camera });

let seed = 7;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function spawn(model, x, y) {
  const character = createCharacter({ model, groundAt, rng, wind: [0.6, 0, 0], gust: 0.8 });
  const sprite = createAsciiSprite(character.puppet, { projection: cells });
  const actor = { model, character, sprite, x, y, z: groundAt(x, y), vx: 0, vy: 0, vz: 0, grounded: true, log: [] };
  character.on('*', (e) => { actor.log.push(e); if (actor.log.length > 6) actor.log.shift(); });
  return actor;
}

const actors = [spawn('knight', 0, 0), spawn('villager', -1.9, -0.4), spawn('skeleton', 1.5, 0.5)];
const player = actors[0];
const npcs = [{ a: actors[1], route: [[-1.9, -0.4], [-2.6, 0.8], [-1, 1.1]], leg: 0 }, { a: actors[2], route: [[1.5, 0.5], [2.6, -0.5], [2.5, 0.9]], leg: 0 }];
const keys = new Set();
const mouse = { x: 0, y: 0, on: false };
let gear = 0;

function press(key) {
  const c = player.character;
  if (key === 'j') c.attack();
  if (key === 'h') c.hurt();
  if (key === 'k') { if (c.state === 'die') c.revive(); else c.die(); }
  if (key === 'g') c.wave(c.animator.layerState('upper') !== 'wave');
  if (key === ' ' && player.grounded && c.state !== 'die') { player.vz = 4.4; player.grounded = false; }
  if (key === 'l') { look = (look + 1) % LOOKS.length; vector = createVectorRenderer({ style: LOOKS[look], projection: camera }); }
  if (key === 'e') {
    gear = (gear + 1) % 3;
    if (gear === 1) { c.unequip('handR'); c.equip('handR', ITEMS.staff()); c.unequip('armL'); }
    else if (gear === 2) { c.unequip('handR'); c.unequip('head'); }
    else { c.equip('handR', ITEMS.sword()); c.equip('armL', ITEMS.shield()); c.equip('head', ITEMS.helm()); }
  }
  if ('123'.includes(key) && key !== '') {
    const model = ['villager', 'knight', 'skeleton'][Number(key) - 1];
    Object.assign(player, { ...spawn(model, player.x, player.y), z: player.z });
  }
}
addEventListener('keydown', (e) => { const k = e.key.toLowerCase(); if (!keys.has(k)) press(k); keys.add(k); if (k.startsWith('arrow') || k === ' ') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); mouse.x = (e.clientX - r.left) * canvas.width / r.width; mouse.y = (e.clientY - r.top) * canvas.height / r.height; mouse.on = true; });
canvas.addEventListener('mouseleave', () => { mouse.on = false; });

function update(dt) {
  const ax = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const ay = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  const speed = player.character.walkSpeed * (keys.has('shift') ? 2.6 : 1);
  const n = Math.hypot(ax, ay) || 1;
  const alive = player.character.state !== 'die';
  player.vx = alive ? ax / n * speed : 0;
  player.vy = alive ? -ay / n * speed : 0; // screen down is toward the camera, which is -y
  for (const npc of npcs) {
    const [tx, ty] = npc.route[npc.leg];
    const d = Math.hypot(tx - npc.a.x, ty - npc.a.y);
    if (d < 0.15) npc.leg = (npc.leg + 1) % npc.route.length;
    const v = npc.a.character.walkSpeed * (npc.a.model === 'skeleton' ? 0.7 : 1);
    npc.a.vx = d < 0.15 ? 0 : (tx - npc.a.x) / d * v; npc.a.vy = d < 0.15 ? 0 : (ty - npc.a.y) / d * v;
  }
  for (const a of actors) {
    a.x = Math.max(-2.9, Math.min(2.9, a.x + a.vx * dt)); a.y = Math.max(-1.4, Math.min(1.6, a.y + a.vy * dt));
    const ground = groundAt(a.x, a.y);
    if (!a.grounded) { a.vz -= 14 * dt; a.z += a.vz * dt; if (a.z <= ground && a.vz <= 0) { a.z = ground; a.vz = 0; a.grounded = true; } } else a.z = ground;
    a.character.update(dt, { x: a.x, y: a.y, z: a.z, vx: a.vx, vy: a.vy, vz: a.vz, grounded: a.grounded });
  }
  // the player looks at the mouse (a point on the ground); the others look at the player
  if (mouse.on) { const s = [(mouse.x % HALF) - HALF / 2, mouse.y - 400]; player.character.lookAt([s[0] / UNIT, -s[1] / (UNIT * Math.sin(PITCH * Math.PI / 180)), 0.6]); } else player.character.lookAt(null);
  for (const npc of npcs) npc.a.character.lookAt([player.x, player.y, player.z + 1.6]);
}

function drawGround(ox) {
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, 0, HALF, canvas.height); ctx.clip();
  for (let y = 2.2; y >= -1.8; y -= 0.2) {
    ctx.beginPath();
    for (let x = -3.4; x <= 3.41; x += 0.1) { const s = toScreen([x, y, groundAt(x, y)], ox); if (x === -3.4) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]); }
    const e = toScreen([3.4, y, -3], ox); const b = toScreen([-3.4, y, -3], ox);
    ctx.lineTo(e[0], e[1]); ctx.lineTo(b[0], b[1]); ctx.closePath();
    ctx.fillStyle = `hsl(${look === 1 ? 250 : 130}, 28%, ${20 + (2.2 - y) * 3}%)`; ctx.fill();
  }
  ctx.restore();
}

function draw() {
  ctx.fillStyle = look === 1 ? '#12101f' : '#27304a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const order = actors.slice().sort((p, q) => q.y - p.y); // far (large y) first
  for (const [side, ox] of [['vector', 0], ['ascii', HALF]]) {
    drawGround(ox);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, 0, HALF, canvas.height); ctx.clip();
    for (const a of order) {
      const s = toScreen([a.x, a.y, a.z], ox);
      if (side === 'vector') vector.draw(ctx, a.character.puppet, s[0], s[1]);
      else a.sprite.draw(ctx, Math.round(s[0] - a.sprite.anchor.col * CELL), Math.round(s[1] - a.sprite.anchor.row * CELL), a.sprite.cols * CELL, a.sprite.rows * CELL);
    }
    ctx.restore();
    ctx.fillStyle = '#d8d4e8'; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(side === 'vector' ? `vector, ${LOOKS[look].name} look` : 'ASCII, rendered live from the same rig', ox + 12, 22);
  }
  ctx.fillStyle = '#9d98b8';
  ctx.fillText(`state: ${player.character.state}   upper: ${player.character.animator.layerState('upper')}   events: ${player.log.join(' ')}`, 12, canvas.height - 12);
}

let last = performance.now();
function frame(now) {
  if (!window.demo.paused) { update(Math.max(0, Math.min(0.05, (now - last) / 1000))); draw(); }
  last = now;
  requestAnimationFrame(frame);
}
// for play-tests and screenshots: pause the clock and drive time by hand
window.demo = { paused: false, actors, player, keys, press, advance(seconds, step = 1 / 60) { for (let t = 0; t < seconds; t += step) update(step); draw(); } };
window.game = { get state() { return { player: { x: player.x, y: player.y, z: player.z, state: player.character.state } }; } };
requestAnimationFrame(frame);
