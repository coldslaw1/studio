// Dungeons: rooms joined by corridors, with doors, one locked door whose key is always findable,
// monsters, chests and scenery. Pure data out; the same seed always gives the same dungeon.
import { createRng } from './rng.js';
import { TILE, makeTiles, addWalls, distances, tileAt, roomAt, isWalkable } from './grid.js';
import { DUNGEON_THEMES } from './themes.js';
import { populateDungeon } from './populate.js';

const need = (ok, message) => { if (!ok) throw new Error(message); };
const hex = (n) => (n >>> 0).toString(16).padStart(8, '0').slice(0, 6);

/**
 * generateDungeon(options) -> layout
 *   seed      required (string or number). Same seed and options -> the same dungeon.
 *   cols, rows   size of the map in tiles. Default 48 x 32. Minimum 16 x 12.
 *   rooms     how many rooms to aim for. Default: one per 190 tiles (8 for 48 x 32).
 *   roomMin, roomMax   room side lengths in tiles. Default 4 and 9.
 *   theme     a name in DUNGEON_THEMES ('crypt', 'cave', 'hideout', 'temple', 'warren') or a theme object. Default 'crypt'.
 *   level     1..10: how many and how nasty the monsters are, and how good the loot. Default 1.
 *   loops     0..1 chance of an extra corridor between near rooms. Default 0.15.
 *   lock      true puts one locked door on the way to the exit, with its key in a room before it. Default true.
 *   boss      true puts a boss in the exit room. Default true.
 *   id        prefix of every id inside. Default 'dungeon_' + 6 hex digits of the seed.
 *   cell      metres per tile, used by the adapters. Default 1.
 * layout: { kind: 'dungeon', id, theme, style, faction, seed, level, cols, rows, cell, tiles,
 *   rooms: [{ id, x, y, w, h, cx, cy, role, depth, links }], links: [[roomId, roomId]],
 *   doors: [{ id, x, y, room, locked, key }], keys: [{ id, door, loot }],
 *   entrance: { x, y, room }, exit: { x, y, room },
 *   spawns, loot, props }      (see populate.js for the last three)
 * Positions are tile coordinates (whole numbers). tiles[y * cols + x] is a TILE id.
 */
export function generateDungeon(options = {}) {
  need(options.seed !== undefined && options.seed !== null, 'generateDungeon: options.seed is required');
  const cols = options.cols ?? 48; const rows = options.rows ?? 32;
  need(Number.isInteger(cols) && Number.isInteger(rows) && cols >= 16 && rows >= 12 && cols <= 256 && rows <= 256, `generateDungeon: cols x rows must be whole numbers from 16 x 12 to 256 x 256, got ${cols} x ${rows}`);
  const themeName = typeof options.theme === 'object' ? (options.theme.name ?? 'custom') : (options.theme ?? 'crypt');
  const theme = typeof options.theme === 'object' ? options.theme : DUNGEON_THEMES[themeName];
  need(theme && Array.isArray(theme.mobs), `generateDungeon: unknown theme ${JSON.stringify(options.theme)} (known: ${Object.keys(DUNGEON_THEMES).join(', ')})`);
  const level = options.level ?? 1;
  need(Number.isFinite(level) && level >= 1 && level <= 10, `generateDungeon: level must be 1..10, got ${level}`);
  const roomMin = options.roomMin ?? 4; const roomMax = options.roomMax ?? 9;
  need(Number.isInteger(roomMin) && Number.isInteger(roomMax) && roomMin >= 3 && roomMax >= roomMin && roomMax <= Math.min(cols, rows) - 4, `generateDungeon: roomMin..roomMax must be whole numbers with 3 <= roomMin <= roomMax <= ${Math.min(cols, rows) - 4}, got ${roomMin}..${roomMax}`);
  const want = options.rooms ?? Math.max(3, Math.round((cols * rows) / 190));
  need(Number.isInteger(want) && want >= 2, `generateDungeon: rooms must be a whole number of at least 2, got ${want}`);

  const rng = createRng(options.seed, 'dungeon');
  const layout = {
    kind: 'dungeon', id: options.id ?? `dungeon_${hex(rng.seed)}`, theme: themeName, style: theme.style ?? 'crypt', faction: theme.faction ?? 'monsters',
    seed: rng.seed, level, cols, rows, cell: options.cell ?? 1, tiles: makeTiles(cols, rows),
    rooms: [], links: [], doors: [], keys: [], entrance: null, exit: null, spawns: [], loot: [], props: [],
  };
  placeRooms(layout, rng.fork('rooms'), want, roomMin, roomMax);
  need(layout.rooms.length >= 2, `generateDungeon: only ${layout.rooms.length} room(s) fit in ${cols} x ${rows} with rooms of ${roomMin}..${roomMax}; make the map bigger or the rooms smaller`);
  const paths = linkRooms(layout, rng.fork('links'), options.loops ?? 0.15);
  addWalls(layout);
  placeDoors(layout, rng.fork('doors'), paths);
  pickEnds(layout);
  if (options.lock ?? true) lockTheWay(layout);
  populateDungeon(layout, theme, rng.fork('life'), { boss: options.boss ?? true });
  return layout;
}

function placeRooms(layout, rng, want, min, max) {
  const { cols, rows, tiles } = layout;
  for (let tries = 0; tries < want * 60 && layout.rooms.length < want; tries++) {
    const w = rng.int(min, max); const h = rng.int(min, Math.max(min, Math.min(max, Math.round(w * 1.6))));
    if (w > cols - 2 || h > rows - 2) continue;
    const x = rng.int(1, cols - w - 1); const y = rng.int(1, rows - h - 1);
    if (layout.rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
    layout.rooms.push({ id: `r${layout.rooms.length}`, x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), role: 'normal', depth: 0, links: [] });
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) tiles[ty * cols + tx] = TILE.floor;
  }
}

/** Joins every room to the rest (a spanning tree by distance) plus a few loops. Returns the corridor paths. */
function linkRooms(layout, rng, loops) {
  const { rooms } = layout;
  const gap = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
  const paths = [];
  const join = (a, b) => {
    layout.links.push([a.id, b.id]); a.links.push(b.id); b.links.push(a.id);
    paths.push(carve(layout, a, b, rng.chance(0.5)));
  };
  const inTree = new Set([0]);
  while (inTree.size < rooms.length) {
    let best = null;
    for (const i of inTree) for (let j = 0; j < rooms.length; j++) {
      if (inTree.has(j)) continue;
      const d = gap(rooms[i], rooms[j]);
      if (!best || d < best.d) best = { i, j, d };
    }
    join(rooms[best.i], rooms[best.j]);
    inTree.add(best.j);
  }
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    if (rooms[i].links.includes(rooms[j].id) || gap(rooms[i], rooms[j]) > (layout.cols + layout.rows) / 4) continue;
    if (rng.chance(loops)) join(rooms[i], rooms[j]);
  }
  return paths;
}

/** Cuts an L-shaped corridor between two room centres. Returns the tiles it passes: [[x, y], ...]. */
function carve(layout, a, b, horizontalFirst) {
  const path = []; const { cols, tiles } = layout;
  const cut = (x, y) => { path.push([x, y]); if (tiles[y * cols + x] === TILE.void) tiles[y * cols + x] = TILE.floor; };
  const runX = (y, x0, x1) => { for (let x = x0; x !== x1; x += Math.sign(x1 - x0)) cut(x, y); };
  const runY = (x, y0, y1) => { for (let y = y0; y !== y1; y += Math.sign(y1 - y0)) cut(x, y); };
  if (horizontalFirst) { runX(a.cy, a.cx, b.cx); runY(b.cx, a.cy, b.cy); } else { runY(a.cx, a.cy, b.cy); runX(b.cy, a.cx, b.cx); }
  cut(b.cx, b.cy);
  return path;
}

/** A door goes where a corridor meets a room, when there is wall on both sides of it. */
function placeDoors(layout, rng, paths) {
  const { cols, tiles } = layout;
  const wall = (x, y) => tileAt(layout, x, y) === TILE.wall;
  for (const path of paths) {
    for (let i = 1; i < path.length - 1; i++) {
      const [x, y] = path[i];
      if (tiles[y * cols + x] !== TILE.floor || roomAt(layout, x, y)) continue;
      const before = roomAt(layout, path[i - 1][0], path[i - 1][1]); const after = roomAt(layout, path[i + 1][0], path[i + 1][1]);
      const room = before ?? after;
      if (!room) continue;
      const alongX = path[i + 1][0] !== path[i - 1][0] && path[i + 1][1] === path[i - 1][1];
      const alongY = path[i + 1][1] !== path[i - 1][1] && path[i + 1][0] === path[i - 1][0];
      if (!(alongX && wall(x, y - 1) && wall(x, y + 1)) && !(alongY && wall(x - 1, y) && wall(x + 1, y))) continue;
      if (!rng.chance(0.8)) continue;
      tiles[y * cols + x] = TILE.door;
      layout.doors.push({ id: `${layout.id}_door${layout.doors.length}`, x, y, room: room.id, locked: false, key: null });
    }
  }
}

/** The entrance and the exit are the two rooms furthest apart on foot. Sets every room's depth. */
function pickEnds(layout) {
  const far = (from) => {
    const dist = distances(layout, { x: from.cx, y: from.cy });
    let best = from;
    for (const room of layout.rooms) if (dist[room.cy * layout.cols + room.cx] > dist[best.cy * layout.cols + best.cx]) best = room;
    return { best, dist };
  };
  const first = far(layout.rooms[0]).best;
  const { best: last, dist } = far(first);
  for (const room of layout.rooms) room.depth = dist[room.cy * layout.cols + room.cx];
  first.role = 'entrance'; last.role = 'exit';
  layout.entrance = { x: first.cx, y: first.cy, room: first.id };
  layout.exit = { x: last.cx, y: last.cy, room: last.id };
  layout.tiles[first.cy * layout.cols + first.cx] = TILE.entrance;
  layout.tiles[last.cy * layout.cols + last.cx] = TILE.exit;
}

/**
 * Locks the door nearest the exit that the whole way out depends on, and names the room the key
 * goes in: the deepest room that can still be reached with that door shut. No such door (the
 * corridors loop round it): no lock.
 */
function lockTheWay(layout) {
  const { cols } = layout;
  const open = distances(layout, layout.entrance);
  const byDepth = layout.doors.slice().sort((a, b) => open[b.y * cols + b.x] - open[a.y * cols + a.x]);
  for (const door of byDepth) {
    const shut = distances(layout, layout.entrance, new Set([door.y * cols + door.x]));
    if (shut[layout.exit.y * cols + layout.exit.x] !== -1) continue;
    const before = layout.rooms.filter((r) => r.role === 'normal' && shut[r.cy * cols + r.cx] > 0).sort((a, b) => shut[b.cy * cols + b.cx] - shut[a.cy * cols + a.cx]);
    if (!before.length) continue;
    door.locked = true; door.key = `${layout.id}_key`;
    before[0].role = 'key';
    layout.keys.push({ id: door.key, door: door.id, room: before[0].id, loot: null });
    return;
  }
}

/** walkableCount(layout) -> how many tiles can be stood on (tests and the README use it). */
export function walkableCount(layout) {
  let n = 0;
  for (const t of layout.tiles) if (isWalkable(t)) n++;
  return n;
}
