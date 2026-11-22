// The demo page: draws the town from town.js and lets you walk through it.
// Keys: arrows or WASD walk, Shift sneaks, Space swings, E talks, T speeds up time, O shows what the
// agents see and plan, P pauses. Add ?auto to the address to let a scripted player walk the loop.
import { buildTown, botInput, W, H } from './town.js';
import { animOf } from '../../src/index.js';

const PX = 8; // pixels per metre
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const auto = params.has('auto');
const town = buildTown({ seed: Number(params.get('seed') ?? 1) });
const { ai, player } = town;

const keys = new Set();
let overlay = params.has('overlay'); let fast = false; let paused = false;
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.key.toLowerCase());
  if (e.key === ' ') swing();
  if (e.key.toLowerCase() === 'e') chat();
  if (e.key.toLowerCase() === 'o') overlay = !overlay;
  if (e.key.toLowerCase() === 't') fast = !fast;
  if (e.key.toLowerCase() === 'p') paused = !paused;
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const COLORS = { villagers: '#e8c170', guards: '#7fb2e5', wild: '#b0a08a', goblins: '#7fc46b', monsters: '#c77dd6', orcs: '#d0803c', vermin: '#9a8f86', undead: '#d9d9d9', demons: '#e06c75' };
const LETTER = { wolf: 'w', boar: 'b', slime: 's', goblin: 'g', imp: 'i', ogre: 'O', guard: 'G', farmer: 'f', merchant: 'm', smith: 'k', villager: 'v', innkeeper: 'n' };
const bubbles = []; // { id, text, until }
const flashes = []; // { x, y, r, until, color }
const log = { barks: 0, attacks: 0, deaths: 0, aggro: 0, last: [] };
let line = null; // what an NPC said to the player

function note(e) {
  if (e.type === 'bark') { log.barks++; const old = bubbles.findIndex((b) => b.id === e.id); if (old >= 0) bubbles.splice(old, 1); bubbles.push({ id: e.id, text: e.text, until: ai.time + 2.4, x: e.x, y: e.y }); }
  if (e.type === 'telegraph') flashes.push({ x: e.x, y: e.y, r: e.range, until: ai.time + e.time, from: ai.time, color: e.style === 'charge' ? '#ff9f43' : '#ff5252', facing: e.facing, style: e.style });
  if (e.type === 'attack') log.attacks++;
  if (e.type === 'aggro') log.aggro++;
  if (e.type === 'death') { log.deaths++; flashes.push({ x: e.x, y: e.y, r: 1.2, until: ai.time + 0.6, from: ai.time, color: '#ffffff', style: 'death' }); }
  if (['aggro', 'death', 'standing', 'talk'].includes(e.type)) { log.last.push(e); if (log.last.length > 30) log.last.shift(); }
}
function swing() { if (town.strike().length) flashes.push({ x: player.x, y: player.y, r: 1.8, until: ai.time + 0.15, from: ai.time, color: '#8be9fd', style: 'swing', facing: player.facing }); }
function chat() {
  const r = town.talk();
  line = r ? { text: `${r.name}: (dialogue "${r.dialogue}") Good day to you. Press E to say goodbye.`, id: r.id } : null;
}

const DT = 1 / 60;
let acc = 0; let last = performance.now(); let stepMs = 0; let frames = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  let n = 0;
  while (acc >= DT && n < 4) {
    acc -= DT; n++;
    if (paused) continue;
    for (let k = 0; k < (fast ? 12 : 1); k++) tick();
  }
  draw();
  frames++;
  requestAnimationFrame(frame);
}
function tick() {
  let dx = 0; let dy = 0; let sneak = keys.has('shift');
  if (auto) { const b = botInput(town, ai.time); dx = b.dx; dy = b.dy; sneak = b.sneak; if (b.strike) swing(); } else {
    if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
    if (keys.has('arrowright') || keys.has('d')) dx += 1;
    if (keys.has('arrowup') || keys.has('w')) dy -= 1;
    if (keys.has('arrowdown') || keys.has('s')) dy += 1;
  }
  town.movePlayer(dx, dy, DT, sneak);
  const t0 = performance.now();
  const events = ai.step(DT, { focus: player });
  stepMs = stepMs * 0.95 + (performance.now() - t0) * 0.05;
  for (const e of events) note(e);
}

function draw() {
  const night = ai.hour < 6 || ai.hour >= 21 ? 0.45 : ai.hour < 7.5 || ai.hour >= 19 ? 0.22 : 0;
  ctx.fillStyle = '#2f4a3a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#3a5a44'; ctx.fillRect(10 * PX, 16 * PX, 46 * PX, 39 * PX); // village green
  ctx.fillStyle = '#6b5a3a'; ctx.fillRect(12 * PX, 58 * PX, 22 * PX, 12 * PX); // fields
  ctx.fillStyle = '#33503f'; ctx.fillRect(40 * PX, 62 * PX, 20 * PX, 10 * PX); // swamp
  ctx.fillStyle = '#4b6b52'; ctx.fillRect(56 * PX, 32.5 * PX, 24 * PX, 3 * PX); // road
  for (const s of town.shapes) {
    if (s.r) { ctx.fillStyle = '#1f3a2a'; ctx.beginPath(); ctx.arc(s.x * PX, s.y * PX, s.r * PX, 0, 7); ctx.fill(); } else { ctx.fillStyle = s.wall ? '#5b5b66' : '#8a6a4a'; ctx.fillRect(s.x * PX, s.y * PX, s.w * PX, s.h * PX); }
  }
  ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#2b2018';
  for (const h of town.houses) ctx.fillText(h.name, (h.x + h.w / 2) * PX, (h.y + h.h / 2) * PX + 3);

  if (overlay) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (const r of [ai.config.activeRadius, ai.config.nearRadius]) { ctx.beginPath(); ctx.arc(player.x * PX, player.y * PX, r * PX, 0, 7); ctx.stroke(); }
  }
  for (const f of flashes) {
    const k = Math.min(1, (ai.time - f.from) / Math.max(0.01, f.until - f.from));
    ctx.strokeStyle = f.color; ctx.fillStyle = f.color; ctx.globalAlpha = f.style === 'death' ? 1 - k : 0.25 + 0.5 * k;
    ctx.beginPath();
    if (f.style === 'charge') { const r = f.facing * Math.PI / 180; ctx.lineWidth = 6; ctx.moveTo(f.x * PX, f.y * PX); ctx.lineTo((f.x + Math.sin(r) * f.r) * PX, (f.y - Math.cos(r) * f.r) * PX); ctx.stroke(); ctx.lineWidth = 1; } else if (f.facing !== undefined && f.style !== 'ranged') { const a = (f.facing - 90) * Math.PI / 180; ctx.moveTo(f.x * PX, f.y * PX); ctx.arc(f.x * PX, f.y * PX, f.r * PX, a - 0.9, a + 0.9); ctx.fill(); } else { ctx.arc(f.x * PX, f.y * PX, f.r * PX, 0, 7); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].until < ai.time) flashes.splice(i, 1);

  for (const a of ai.agents()) {
    const x = a.x * PX; const y = a.y * PX;
    if (overlay && a.tier === 0) {
      const f = (a.facing - 90) * Math.PI / 180; const half = a.senses.fov * Math.PI / 360;
      ctx.fillStyle = a.target ? 'rgba(255,90,90,0.10)' : 'rgba(255,255,160,0.07)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, a.senses.sight * PX, f - half, f + half); ctx.fill();
      if (a.nav) { ctx.strokeStyle = 'rgba(140,220,255,0.6)'; ctx.beginPath(); ctx.moveTo(x, y); for (const p of a.nav.path || []) ctx.lineTo(p[0] * PX, p[1] * PX); ctx.lineTo(a.nav.tx * PX, a.nav.ty * PX); ctx.stroke(); }
      if (a.combat.slotX !== null) { ctx.strokeStyle = a.combat.token ? '#ff5252' : '#ffd166'; ctx.strokeRect(a.combat.slotX * PX - 2, a.combat.slotY * PX - 2, 4, 4); }
    }
    ctx.globalAlpha = a.tier === 2 ? 0.45 : a.tier === 1 ? 0.75 : 1;
    ctx.fillStyle = COLORS[a.faction] ?? '#cccccc';
    const rad = Math.max(5, a.radius * PX * 1.5);
    ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    if (a.anim === 'sleep') { ctx.fillStyle = '#9ad'; ctx.fillText('z', x + 6, y - 6); }
    const r = a.facing * Math.PI / 180;
    ctx.strokeStyle = '#111'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(r) * (rad + 4), y - Math.cos(r) * (rad + 4)); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = 'bold 10px monospace'; ctx.fillText(LETTER[a.kind] ?? '?', x, y + 3); ctx.font = '10px monospace';
    if (a.hp < a.maxHp) { ctx.fillStyle = '#400'; ctx.fillRect(x - 8, y - rad - 6, 16, 3); ctx.fillStyle = '#e44'; ctx.fillRect(x - 8, y - rad - 6, 16 * a.hp / a.maxHp, 3); }
    if (overlay && a.tier === 0) { ctx.fillStyle = '#dfe'; ctx.fillText(`${a.goal ?? '-'}${a.combat.state !== 'idle' ? ':' + a.combat.state : ''}`, x, y + rad + 10); }
    ctx.globalAlpha = 1;
  }
  // the player
  ctx.fillStyle = player.alive ? '#ffffff' : '#666'; ctx.beginPath(); ctx.arc(player.x * PX, player.y * PX, 5, 0, 7); ctx.fill();
  const pr = player.facing * Math.PI / 180;
  ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(player.x * PX, player.y * PX); ctx.lineTo(player.x * PX + Math.sin(pr) * 11, player.y * PX - Math.cos(pr) * 11); ctx.stroke();

  if (night) { ctx.fillStyle = `rgba(10,14,40,${night})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.font = '11px monospace';
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (b.until < ai.time) { bubbles.splice(i, 1); continue; }
    const a = ai.has(b.id) ? ai.get(b.id) : b;
    const w = ctx.measureText(b.text).width + 8;
    ctx.fillStyle = 'rgba(20,20,28,0.85)'; ctx.fillRect(a.x * PX - w / 2, a.y * PX - 26, w, 14);
    ctx.fillStyle = '#fff'; ctx.fillText(b.text, a.x * PX, a.y * PX - 15);
  }
  // HUD
  const hh = Math.floor(ai.hour); const mm = Math.floor((ai.hour - hh) * 60);
  const s = ai.stats();
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(15,15,22,0.8)'; ctx.fillRect(0, 0, canvas.width, 18);
  ctx.fillStyle = '#fff';
  ctx.fillText(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${fast ? ' x12' : ''}   hp ${Math.ceil(player.hp)}/${player.maxHp}   agents ${s.agents} (full ${s.active ?? 0}, light ${s.near ?? 0}, far ${s.far ?? 0})   ai step ${stepMs.toFixed(2)} ms   village standing ${ai.factions.standingOf('player', 'villagers').toFixed(2)}   ${auto ? 'AUTO' : 'WASD walk, Shift sneak, Space hit, E talk, T time, O overlay'}`, 6, 13);
  if (line) { ctx.fillStyle = 'rgba(15,15,22,0.9)'; ctx.fillRect(0, canvas.height - 26, canvas.width, 26); ctx.fillStyle = '#ffe9a8'; ctx.fillText(line.text, 8, canvas.height - 9); }
  if (!player.alive) { ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '22px monospace'; ctx.fillText('You fell. Back to the village...', canvas.width / 2, canvas.height / 2); }
}

// for play-tests: the same shape the other studio demos expose
window.game = {
  get state() {
    const agents = ai.snapshot().agents;
    return { ready: true, time: ai.time, hour: ai.hour, frames, player: { ...player }, stats: ai.stats(), log: { barks: log.barks, attacks: log.attacks, deaths: log.deaths, aggro: log.aggro }, agents, anims: Object.fromEntries(ai.agents().map((a) => [a.id, animOf(a)])), standing: ai.factions.standingOf('player', 'villagers'), stepMs };
  },
  ai, town,
};
void W; void H;
requestAnimationFrame(frame);
