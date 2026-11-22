// The demo's world, with no drawing in it, so it runs the same in a browser and under Node (tests).
// A walled village with an inn and fields, a forest, a wolf pack, a goblin camp, a boar, some slimes,
// and a player the caller moves. Everything is in metres; the page draws 8 pixels to the metre.
import { createAi, navFromShapes, findPath } from '../../src/index.js';

export const W = 120; export const H = 75;

const HOUSES = [ // x, y, w, h, and what it is
  { x: 20, y: 22, w: 7, h: 5, name: 'Ann' }, { x: 31, y: 22, w: 7, h: 5, name: 'Bob' }, { x: 20, y: 44, w: 7, h: 5, name: 'Cat' },
  { x: 31, y: 44, w: 7, h: 5, name: 'Dan' }, { x: 42, y: 44, w: 6, h: 5, name: 'Eve' }, { x: 42, y: 21, w: 9, h: 7, name: 'inn' },
  { x: 14, y: 33, w: 5, h: 5, name: 'smithy' },
];

/**
 * buildTown(options) -> { ai, grid, shapes, houses, trees, places, player, movePlayer(dx, dy, dt, sneak), strike(), talk(), events(fn) }
 *   seed = 1   scatters the trees and makes every individual
 */
export function buildTown(options = {}) {
  const seed = options.seed ?? 1;
  let s = (seed * 2654435761) >>> 0;
  const rng = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  const shapes = HOUSES.map((h) => ({ x: h.x, y: h.y, w: h.w, h: h.h }));
  // the village wall, with gates east (to the forest) and south (to the fields)
  const wall = (x, y, w, h) => shapes.push({ x, y, w, h, wall: true });
  wall(10, 16, 46, 1); wall(10, 54, 20, 1); wall(36, 54, 20, 1); wall(10, 16, 1, 39); wall(55, 16, 1, 15); wall(55, 37, 1, 18);
  const trees = [];
  for (let i = 0; i < 70; i++) {
    const x = 62 + rng() * 54; const y = 4 + rng() * 66; const r = 0.6 + rng() * 0.7;
    if (Math.hypot(x - 100, y - 14) < 7 || Math.hypot(x - 96, y - 58) < 6 || (Math.abs(y - 34) < 2.5 && x < 80)) continue; // keep the camps and the road clear
    trees.push({ x, y, r }); shapes.push({ x, y, r });
  }
  const grid = navFromShapes({ shapes, bounds: { x: 0, y: 0, w: W, h: H }, cellSize: 1, padding: 0.35 });
  for (let c = 40; c < 60; c++) for (let r = 62; r < 72; r++) if (grid.open(c, r)) grid.setCost(c, r, 4); // the swamp is slow going

  const places = { inn: { x: 46.5, y: 30 }, well: { x: 30, y: 36 }, gate: { x: 57, y: 34 } };
  const ai = createAi({
    grid, seed, places, dayLength: options.dayLength ?? 240, startHour: 7,
    activeRadius: 28, nearRadius: 50,
    factions: { neutral: [['player', 'villagers'], ['player', 'guards'], ['wild', 'vermin'], ['wild', 'monsters'], ['goblins', 'monsters']], allies: [['villagers', 'guards']] },
  });

  const jobs = [['Ann', 'farmer', [18, 62]], ['Bob', 'farmer', [26, 64]], ['Cat', 'merchant', [34, 34]], ['Dan', 'smith', [20.5, 39.5]], ['Eve', 'villager', [28, 31]]];
  jobs.forEach(([name, kind, work], i) => {
    const h = HOUSES[i];
    ai.add({ id: name.toLowerCase(), name, kind, x: h.x + h.w / 2, y: h.y + h.h + 1.2, places: { work }, dialogue: `${name.toLowerCase()}.hello` });
  });
  ai.add({ id: 'innkeeper', name: 'Olaf', kind: 'innkeeper', x: 46.5, y: 29.5, home: { x: 49, y: 30 }, dialogue: 'olaf.hello' });
  ai.add({ id: 'guard1', name: 'Gerd', kind: 'guard', x: 53, y: 34, patrol: [[53, 34], [53, 19], [13, 19], [13, 52], [53, 52]], places: { home: [52, 40] } });
  ai.add({ id: 'guard2', name: 'Hale', kind: 'guard', schedule: 'nightwatch', x: 52, y: 40, patrol: [[57.5, 34], [33, 56], [57.5, 34], [30, 36]], places: { home: [52, 40] } });
  for (let i = 0; i < 5; i++) ai.add({ id: `wolf${i + 1}`, kind: 'wolf', x: 94 + (i % 3) * 1.6, y: 57 + Math.floor(i / 3) * 1.6, squad: 'pack', patrol: i === 0 ? [[96, 58], [82, 48], [74, 60], [90, 68]] : undefined });
  for (let i = 0; i < 4; i++) ai.add({ id: `gob${i + 1}`, kind: 'goblin', x: 98 + (i % 2) * 2.5, y: 12 + Math.floor(i / 2) * 2.5, squad: 'camp', bb: { guard: i === 0 }, facing: -90 });
  ai.add({ id: 'shaman', kind: 'imp', faction: 'goblins', voice: 'goblin', x: 102, y: 15, squad: 'camp', home: { x: 102, y: 15 } });
  ai.add({ id: 'boar', kind: 'boar', x: 76, y: 22 });
  for (let i = 0; i < 3; i++) ai.add({ id: `slime${i + 1}`, kind: 'slime', x: 44 + i * 5, y: 66 + (i % 2) * 2 });
  ai.add({ id: 'ogre', kind: 'ogre', x: 112, y: 40, bb: { guard: true }, facing: -90 });

  const player = { id: 'hero', x: 30, y: 36, facing: 90, hp: 30, maxHp: 30, alive: true, swing: 0, deaths: 0, talking: null };
  const sync = (sneak = false, moving = false) => ai.setBody('hero', { x: player.x, y: player.y, facing: player.facing, faction: 'player', hp: player.hp, maxHp: player.maxHp, alive: player.alive, name: 'you', stealth: sneak ? 0.45 : 1, noise: moving && !sneak ? 7 : 0 });
  sync();

  return {
    ai, grid, shapes, houses: HOUSES, trees, places, player,
    /** movePlayer(dx, dy, dt, sneak) walks the player (dx, dy in -1..1), sliding along walls. */
    movePlayer(dx, dy, dt, sneak = false) {
      const body = ai.state.bodies.hero;
      player.hp = body.hp; // the ai settles hits on the player
      if (player.hp <= 0 && player.alive) { player.alive = false; player.deaths += 1; player.respawn = 3; }
      if (!player.alive) {
        player.respawn -= dt;
        if (player.respawn <= 0) { player.alive = true; player.hp = player.maxHp; player.x = 30; player.y = 36; ai.setBody('hero', { x: 30, y: 36, hp: player.maxHp, alive: true }); }
        sync(); return;
      }
      player.swing = Math.max(0, player.swing - dt);
      const l = Math.hypot(dx, dy);
      if (l > 0.01 && !player.talking) {
        const speed = sneak ? 2 : 5;
        const nx = player.x + dx / Math.max(1, l) * speed * dt; const ny = player.y + dy / Math.max(1, l) * speed * dt;
        if (grid.openAt(nx, player.y)) player.x = nx;
        if (grid.openAt(player.x, ny)) player.y = ny;
        player.facing = Math.atan2(dx, -dy) * 180 / Math.PI;
      }
      sync(sneak, l > 0.01);
    },
    /** strike() swings at whatever stands within 1.8 m in front of the player. Returns the ids hit. */
    strike() {
      if (!player.alive || player.swing > 0) return [];
      player.swing = 0.45;
      ai.sound({ x: player.x, y: player.y, loud: 9, kind: 'fight', by: 'hero' });
      const r = player.facing * Math.PI / 180; const fx = Math.sin(r); const fy = -Math.cos(r);
      const hit = [];
      for (const a of ai.agents()) {
        const dx = a.x - player.x; const dy = a.y - player.y; const d = Math.hypot(dx, dy);
        if (d > 1.8 + a.radius || (d > 0.4 && (dx * fx + dy * fy) / d < 0.3)) continue;
        hit.push(a.id);
      }
      for (const id of hit) ai.hurt(id, 3, 'hero');
      return hit;
    },
    /** talk() starts or ends a chat with the nearest person within 2.5 m. Returns { id, dialogue } or null. */
    talk() {
      if (player.talking) { if (ai.has(player.talking)) ai.endTalk(player.talking); player.talking = null; return null; }
      let best = null; let bd = 2.5;
      for (const a of ai.agents()) { const d = Math.hypot(a.x - player.x, a.y - player.y); if (a.role === 'npc' && d < bd) { bd = d; best = a; } }
      if (!best) return null;
      const r = ai.talk(best.id, 'hero');
      if (!r.ok) return null;
      player.talking = best.id;
      return { id: best.id, name: best.name, dialogue: r.dialogue };
    },
  };
}

/**
 * botInput(town, t) -> { dx, dy, strike, sneak }: a scripted player for tests and the ?auto switch. It
 * walks a loop out of the east gate, past the wolves, the boar and the goblin camp, and back, swinging
 * at anything hostile that comes close.
 */
export function botInput(town, t) {
  const route = [[30, 36], [53, 34], [66, 34], [84, 52], [78, 24], [94, 16], [70, 34], [53, 34], [30, 36]];
  const p = town.player;
  const b = town.bot || (town.bot = { i: 1 });
  let [tx, ty] = route[b.i];
  if (Math.hypot(tx - p.x, ty - p.y) < 1.5) { b.i = (b.i + 1) % route.length; [tx, ty] = route[b.i]; }
  let foe = null; let fd = 2.2;
  for (const a of town.ai.agents()) { if (a.target !== 'hero') continue; const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < fd) { fd = d; foe = a; } }
  if (foe) return { dx: foe.x - p.x, dy: foe.y - p.y, strike: true, sneak: false };
  // walk to the next waypoint, going round what is in the way with the same path-finder the agents use
  if (!b.path || b.goal !== b.i || t - b.at > 1) { b.path = findPath(town.grid, p, { x: tx, y: ty }).points; b.goal = b.i; b.at = t; }
  while (b.path.length > 1 && Math.hypot(b.path[0][0] - p.x, b.path[0][1] - p.y) < 0.6) b.path.shift();
  const next = b.path[0] ?? [tx, ty];
  return { dx: next[0] - p.x, dy: next[1] - p.y, strike: false, sneak: false };
}
