// Interiors: the inside of a house, inn, smithy, shop, chapel or cellar. One rectangle of outer
// wall cut into rooms, a door in every inner wall, a front door, furniture that never blocks the
// way, and the people who live and work there. Same data shape as a dungeon.
import { createRng } from './rng.js';
import { TILE, makeTiles, freeTiles, tileAt } from './grid.js';
import { INTERIOR_TYPES, ROOM_FURNITURE } from './themes.js';
import { createPlacer } from './populate.js';

const need = (ok, message) => { if (!ok) throw new Error(message); };
const hex = (n) => (n >>> 0).toString(16).padStart(8, '0').slice(0, 6);
const MIN = 2; // smallest room side, tiles

/**
 * generateInterior(options) -> layout
 *   seed      required
 *   type      a name in INTERIOR_TYPES ('cottage', 'farmhouse', 'inn', 'smithy', 'shop', 'chapel', 'cellar') or a type object. Default 'cottage'.
 *   cols, rows   outer size in tiles, walls included. Default: the type's size.
 *   id        prefix of every id inside. Default '<type>_' + 6 hex digits of the seed.
 *   cell      metres per tile for the adapters. Default 1.
 *   level     loot tier of the chests, 1..10. Default 1.
 * layout: { kind: 'interior', type, id, seed, cols, rows, cell, tiles, rooms, links, doors,
 *   entrance: { x, y, room, side },   the front door, on the outer wall ('south', 'east', 'west' or 'north')
 *   exit: null, keys: [], spawns: [],
 *   people: [{ id, kind, role, x, y, work: { x, y }, home: { x, y }, bed }],
 *   loot, props }   as in a dungeon; prop yaw turns furniture to face into the room
 */
export function generateInterior(options = {}) {
  need(options.seed !== undefined && options.seed !== null, 'generateInterior: options.seed is required');
  const typeName = typeof options.type === 'object' ? (options.type.name ?? 'custom') : (options.type ?? 'cottage');
  const type = typeof options.type === 'object' ? options.type : INTERIOR_TYPES[typeName];
  need(type && Array.isArray(type.rooms) && type.rooms.length, `generateInterior: unknown type ${JSON.stringify(options.type)} (known: ${Object.keys(INTERIOR_TYPES).join(', ')})`);
  const cols = options.cols ?? type.size?.[0] ?? 11; const rows = options.rows ?? type.size?.[1] ?? 9;
  need(Number.isInteger(cols) && Number.isInteger(rows) && cols >= 5 && rows >= 5 && cols <= 64 && rows <= 64, `generateInterior: cols x rows must be whole numbers from 5 x 5 to 64 x 64, got ${cols} x ${rows}`);
  const rng = createRng(options.seed, 'interior');
  const layout = {
    kind: 'interior', type: typeName, id: options.id ?? `${typeName}_${hex(rng.seed)}`, theme: typeName, style: type.style ?? 'storybook', faction: type.faction ?? 'villagers',
    seed: rng.seed, level: options.level ?? 1, cols, rows, cell: options.cell ?? 1, tiles: makeTiles(cols, rows, TILE.wall),
    rooms: [], links: [], doors: [], keys: [], entrance: null, exit: null, spawns: [], people: [], loot: [], props: [],
  };
  const { tiles } = layout;
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) tiles[y * cols + x] = TILE.floor;

  // cut the inside into rooms: always split the biggest piece that is big enough
  const splitRng = rng.fork('rooms');
  let parts = [{ x: 1, y: 1, w: cols - 2, h: rows - 2 }];
  const inner = []; // { x, y, a, b } doors between two pieces
  while (parts.length < type.rooms.length) {
    const order = parts.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    let done = false;
    for (const part of order) {
      const cut = splitPart(layout, part, splitRng, inner);
      if (!cut) continue;
      parts = parts.filter((p) => p !== part).concat(cut);
      done = true;
      break;
    }
    if (!done) break; // no piece is big enough: fewer rooms than the type asks for
  }
  parts.sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x);
  layout.rooms = parts.map((p, i) => ({ id: `r${i}`, x: p.x, y: p.y, w: p.w, h: p.h, cx: p.x + (p.w >> 1), cy: p.y + (p.h >> 1), role: type.rooms[Math.min(i, type.rooms.length - 1)], depth: 0, links: [] }));
  const roomOf = (x, y) => layout.rooms.find((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
  for (const d of inner) {
    const a = roomOf(d.ax, d.ay); const b = roomOf(d.bx, d.by);
    layout.doors.push({ id: `${layout.id}_door${layout.doors.length}`, x: d.x, y: d.y, room: a.id, locked: false, key: null });
    layout.links.push([a.id, b.id]); a.links.push(b.id); b.links.push(a.id);
  }
  frontDoor(layout, rng.fork('front'));
  furnish(layout, type, rng.fork('things'));
  return layout;
}

/** Splits a piece with a wall across its longer side and one door in it. Returns the two pieces or null. */
function splitPart(layout, part, rng, inner) {
  const { cols, tiles } = layout;
  const tryAxis = (vertical) => {
    const len = vertical ? part.w : part.h;
    if (len < MIN * 2 + 1) return null;
    const lo = (vertical ? part.x : part.y) + MIN; const hi = (vertical ? part.x : part.y) + len - MIN - 1;
    // a wall must not end against an earlier door
    const spots = [];
    for (let p = lo; p <= hi; p++) if (!inner.some((d) => (vertical ? d.x : d.y) === p)) spots.push(p);
    if (!spots.length) return null;
    const at = spots[Math.floor(spots.length / 2) + rng.int(-Math.min(1, spots.length >> 1), Math.min(1, (spots.length - 1) >> 1))];
    const from = vertical ? part.y : part.x; const span = vertical ? part.h : part.w;
    for (let i = 0; i < span; i++) tiles[vertical ? (from + i) * cols + at : at * cols + from + i] = TILE.wall;
    const k = from + rng.int(0, span - 1);
    const door = vertical ? { x: at, y: k, ax: at - 1, ay: k, bx: at + 1, by: k } : { x: k, y: at, ax: k, ay: at - 1, bx: k, by: at + 1 };
    tiles[door.y * cols + door.x] = TILE.door;
    inner.push(door);
    return vertical
      ? [{ x: part.x, y: part.y, w: at - part.x, h: part.h }, { x: at + 1, y: part.y, w: part.x + part.w - at - 1, h: part.h }]
      : [{ x: part.x, y: part.y, w: part.w, h: at - part.y }, { x: part.x, y: at + 1, w: part.w, h: part.y + part.h - at - 1 }];
  };
  const wide = part.w > part.h || (part.w === part.h && rng.chance(0.5));
  return tryAxis(wide) ?? tryAxis(!wide);
}

/** The front door: on the outer wall of the first room that touches one, south side first. */
function frontDoor(layout, rng) {
  const { cols, rows, tiles } = layout;
  const sides = [
    ['south', (r) => r.y + r.h === rows - 1, (r) => ({ x: rng.int(r.x, r.x + r.w - 1), y: rows - 1 })],
    ['east', (r) => r.x + r.w === cols - 1, (r) => ({ x: cols - 1, y: rng.int(r.y, r.y + r.h - 1) })],
    ['west', (r) => r.x === 1, (r) => ({ x: 0, y: rng.int(r.y, r.y + r.h - 1) })],
    ['north', (r) => r.y === 1, (r) => ({ x: rng.int(r.x, r.x + r.w - 1), y: 0 })],
  ];
  for (const room of layout.rooms) {
    for (const [side, touches, spot] of sides) {
      if (!touches(room)) continue;
      const at = spot(room);
      tiles[at.y * cols + at.x] = TILE.entrance;
      layout.entrance = { ...at, room: room.id, side };
      return;
    }
  }
}

function furnish(layout, type, rng) {
  const placer = createPlacer(layout, layout.entrance);
  const wallAt = (x, y) => tileAt(layout, x, y) === TILE.wall;
  const beds = [];
  for (const room of layout.rooms) {
    for (const [prop, where, solid] of ROOM_FURNITURE[room.role] ?? []) {
      const all = freeTiles(layout, room, placer.taken, 0);
      const edge = all.filter((t) => wallAt(t.x - 1, t.y) || wallAt(t.x + 1, t.y) || wallAt(t.x, t.y - 1) || wallAt(t.x, t.y + 1));
      const corner = edge.filter((t) => (wallAt(t.x - 1, t.y) || wallAt(t.x + 1, t.y)) && (wallAt(t.x, t.y - 1) || wallAt(t.x, t.y + 1)));
      const middle = all.filter((t) => !edge.includes(t));
      const pool = where === 'corner' ? (corner.length ? corner : edge) : where === 'wall' ? edge : (middle.length ? middle : all);
      for (const { x, y } of rng.shuffle(pool)) {
        if (!placer.free(x, y)) continue;
        if (solid ? !placer.trySolid(x, y, prop === 'bed' || prop === 'chest' || prop === 'counter') : (placer.take(x, y), false)) continue;
        const yaw = wallAt(x, y - 1) ? 180 : wallAt(x, y + 1) ? 0 : wallAt(x - 1, y) ? 90 : wallAt(x + 1, y) ? 270 : 0; // back to the wall
        const item = { id: `${layout.id}_prop${layout.props.length}`, prop, x, y, room: room.id, solid, yaw };
        layout.props.push(item);
        if (prop === 'bed') beds.push(item);
        if (prop === 'chest') layout.loot.push({ id: `${layout.id}_loot${layout.loot.length}`, x, y, room: room.id, container: 'chest', table: `${layout.type}_chest`, tier: Math.max(1, Math.min(4, 1 + Math.floor((layout.level - 1) / 3))), seed: rng.int(1, 0x7fffffff), prop: item.id });
        break;
      }
    }
  }
  // people: each works in one room and sleeps beside a bed
  const standBy = (room, near) => {
    const spots = freeTiles(layout, room, placer.taken, 0).filter((t) => placer.free(t.x, t.y) || !near);
    const pool = spots.length ? spots : freeTiles(layout, room, placer.taken, 0);
    if (!pool.length) return { x: room.cx, y: room.cy };
    const best = near ? pool.slice().sort((a, b) => Math.abs(a.x - near.x) + Math.abs(a.y - near.y) - Math.abs(b.x - near.x) - Math.abs(b.y - near.y))[0] : rng.pick(pool);
    placer.take(best.x, best.y);
    return { x: best.x, y: best.y };
  };
  (type.people ?? []).forEach((person, i) => {
    const workRoom = layout.rooms.find((r) => r.role === person.work) ?? layout.rooms[0];
    const bed = beds.length ? beds[i % beds.length] : null;
    const homeRoom = bed ? layout.rooms.find((r) => r.id === bed.room) : (layout.rooms.find((r) => r.role === person.home) ?? workRoom);
    const work = standBy(workRoom, null);
    const home = standBy(homeRoom, bed);
    layout.people.push({ id: `${layout.id}_${person.role}${i}`, kind: person.kind, role: person.role, x: work.x, y: work.y, work, home, bed: bed?.id ?? null, seed: rng.int(1, 0x7fffffff) });
  });
}
