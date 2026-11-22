// Fills a dungeon with life: who stands where, where the chests are and what scenery there is.
// Nothing here can block the way: every solid thing is checked against a walk of the whole map.
import { TILE, distances, isWalkable, freeTiles, tileAt } from './grid.js';
import { SOLID_PROPS } from './themes.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * createPlacer(layout, from) -> placer   keeps track of what stands on which tile.
 *   placer.taken              Set of tile indexes something stands on
 *   placer.solid              Set of tile indexes nobody can walk through
 *   placer.take(x, y)         mark a tile used (not solid)
 *   placer.trySolid(x, y, needsReach)   mark a tile solid if every other walkable tile can still be
 *                             reached from `from`; returns true when it stands. needsReach: this thing
 *                             (a chest, a bed) must keep a free tile beside it for good
 */
export function createPlacer(layout, from) {
  const { cols } = layout;
  const taken = new Set(); const solid = new Set(); const keepFree = new Set(); const reach = new Set();
  let walkable = 0;
  const touched = (i, dist) => [1, -1, cols, -cols].some((d) => dist[i + d] !== undefined && dist[i + d] !== -1 && (Math.abs(d) !== 1 || Math.floor((i + d) / cols) === Math.floor(i / cols)));
  for (let i = 0; i < layout.tiles.length; i++) {
    if (!isWalkable(layout.tiles[i])) continue;
    walkable++;
    if (layout.tiles[i] !== TILE.floor) { // doors, entrance, exit: never stand anything on or right next to them
      const x = i % cols; const y = (i - x) / cols;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) keepFree.add((y + dy) * cols + x + dx);
    }
  }
  // corridor mouths: floor tiles on the edge of a room that open onto a corridor without a door
  for (const room of layout.rooms) {
    for (let x = room.x; x < room.x + room.w; x++) for (const [y, oy] of [[room.y, -1], [room.y + room.h - 1, 1]]) if (isWalkable(tileAt(layout, x, y + oy))) keepFree.add(y * cols + x);
    for (let y = room.y; y < room.y + room.h; y++) for (const [x, ox] of [[room.x, -1], [room.x + room.w - 1, 1]]) if (isWalkable(tileAt(layout, x + ox, y))) keepFree.add(y * cols + x);
  }
  return {
    taken, solid, keepFree,
    take(x, y) { taken.add(y * cols + x); },
    reserve(x, y) { keepFree.add(y * cols + x); },
    free(x, y) { const i = y * cols + x; return layout.tiles[i] === TILE.floor && !taken.has(i) && !keepFree.has(i); },
    trySolid(x, y, needsReach = false) {
      const i = y * cols + x;
      if (layout.tiles[i] !== TILE.floor || taken.has(i) || keepFree.has(i)) return false;
      solid.add(i);
      const dist = distances(layout, from, solid);
      let reached = 0;
      for (let k = 0; k < dist.length; k++) if (dist[k] !== -1) reached++;
      let ok = reached === walkable - solid.size && (!needsReach || touched(i, dist));
      for (const r of reach) if (ok && !touched(r, dist)) ok = false;
      if (!ok) { solid.delete(i); return false; }
      taken.add(i);
      if (needsReach) reach.add(i);
      return true;
    },
  };
}

/**
 * populateDungeon(layout, theme, rng, { boss }) - fills layout.spawns, layout.loot and layout.props.
 *   spawn: { id, kind, x, y, room, squad, faction, boss?, guard?, size?, seed }
 *   loot:  { id, x, y, room, container: 'chest' | 'sack', table, tier, seed, item? }   item: a key id
 *   prop:  { id, prop, x, y, room, solid, yaw }
 */
export function populateDungeon(layout, theme, rng, options = {}) {
  const placer = createPlacer(layout, layout.entrance);
  const lootRng = rng.fork('loot'); const mobRng = rng.fork('mobs'); const propRng = rng.fork('props');
  const tier = clamp(1 + Math.floor((layout.level - 1) / 3), 1, 4);
  const byId = Object.fromEntries(layout.rooms.map((r) => [r.id, r]));

  // treasure rooms: dead ends first, about one room in five
  const plain = layout.rooms.filter((r) => r.role === 'normal').sort((a, b) => a.links.length - b.links.length || b.depth - a.depth);
  for (const room of plain.slice(0, Math.max(1, Math.round(layout.rooms.length / 5)))) room.role = 'treasure';

  const addChest = (room, extra) => {
    const spots = lootRng.shuffle(freeTiles(layout, room, placer.taken, 1).concat(freeTiles(layout, room, placer.taken, 0)));
    for (const { x, y } of spots) {
      if (!placer.trySolid(x, y, true)) continue;
      const chest = { id: `${layout.id}_loot${layout.loot.length}`, x, y, room: room.id, container: 'chest', table: `${layout.theme}_chest`, tier, seed: lootRng.int(1, 0x7fffffff), ...extra };
      layout.loot.push(chest);
      return chest;
    }
    return null;
  };
  for (const key of layout.keys) {
    const chest = addChest(byId[key.room], { item: key.id });
    if (chest) key.loot = chest.id;
    else { // no tile for a chest: the key lies on the floor in the middle of the room
      const room = byId[key.room];
      const sack = { id: `${layout.id}_loot${layout.loot.length}`, x: room.cx, y: room.cy, room: room.id, container: 'sack', table: `${layout.theme}_sack`, tier, seed: lootRng.int(1, 0x7fffffff), item: key.id };
      placer.take(room.cx, room.cy); layout.loot.push(sack); key.loot = sack.id;
    }
  }
  for (const room of layout.rooms) {
    if (room.role === 'treasure') addChest(room, {});
    if (room.role === 'exit' && options.boss) addChest(room, { tier: clamp(tier + 1, 1, 5), table: `${layout.theme}_boss` });
  }

  // monsters: none in the entrance room, a boss and its guard in the exit room
  const allowed = theme.mobs.filter(([, , min = 1]) => min <= layout.level).map(([kind, weight]) => [kind, weight]);
  const addMob = (room, kind, extra) => {
    const spots = freeTiles(layout, room, placer.taken, 0).filter((t) => placer.free(t.x, t.y));
    if (!spots.length) return null;
    const { x, y } = mobRng.pick(spots);
    placer.take(x, y);
    const mob = { id: `${layout.id}_mob${layout.spawns.length}`, kind, x, y, room: room.id, squad: `${layout.id}_${room.id}`, faction: layout.faction, seed: mobRng.int(1, 0x7fffffff), ...extra };
    layout.spawns.push(mob);
    return mob;
  };
  for (const room of layout.rooms) {
    if (room.role === 'entrance' || !allowed.length) continue;
    if (room.role === 'exit' && options.boss && theme.boss) addMob(room, theme.boss, { boss: true, size: 1.4, guard: true });
    const busy = (room.w * room.h) / 16 * (0.55 + layout.level * 0.15) * mobRng.range(0.6, 1.3);
    const count = clamp(Math.round(busy), room.role === 'treasure' || room.role === 'key' ? 1 : 0, 6);
    const kind = mobRng.weighted(allowed); // one kind leads a room, with the odd stranger
    for (let i = 0; i < count; i++) addMob(room, mobRng.chance(0.75) ? kind : mobRng.weighted(allowed), room.role === 'treasure' ? { guard: true } : {});
  }

  // scenery
  for (const room of layout.rooms) {
    const count = clamp(Math.round((room.w * room.h) / 14 * propRng.range(0.5, 1.4)), 0, 6);
    for (let i = 0; i < count; i++) {
      const prop = propRng.weighted(theme.props);
      const solid = SOLID_PROPS.has(prop);
      const edge = freeTiles(layout, room, placer.taken, 0).filter((t) => t.x === room.x || t.y === room.y || t.x === room.x + room.w - 1 || t.y === room.y + room.h - 1);
      const inner = freeTiles(layout, room, placer.taken, 1);
      const spots = propRng.shuffle(prop === 'pillar' || prop === 'statue' || prop === 'campfire' || prop === 'altar' ? inner : edge).filter((t) => placer.free(t.x, t.y));
      for (const { x, y } of spots) {
        if (solid ? !placer.trySolid(x, y) : (placer.take(x, y), false)) continue;
        layout.props.push({ id: `${layout.id}_prop${layout.props.length}`, prop, x, y, room: room.id, solid, yaw: propRng.int(0, 3) * 90 });
        break;
      }
    }
  }
  return layout;
}
