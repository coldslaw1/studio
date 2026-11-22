// Adapters: generated data in the shapes the other engines take. procgen imports none of them;
// these return plain objects that you pass on (ai.add, navFromTiles, createEntities, loot.fill).
import { TILE, isWalkable } from './grid.js';

const need = (ok, message) => { if (!ok) throw new Error(message); };
const q = (n) => Math.round(n * 100) / 100;
const isLayout = (s) => s && (s.kind === 'dungeon' || s.kind === 'interior');

/**
 * positionOf(source, thing, options) -> { x, y } in world units.
 * For a dungeon or interior: the middle of the thing's tile, origin + (tile + 0.5) * cell * unit.
 * For a camp: origin + metres * unit (a camp from campAt / placeAt is already in world units).
 *   options.origin  { x, y } world position of the map's top-left corner (camp: of its centre). Default 0, 0.
 *   options.unit    world units per metre. Default 1 (Kiln scenes); about 32 in pixel games.
 */
export function positionOf(source, thing, options = {}) {
  const ox = options.origin?.x ?? 0; const oy = options.origin?.y ?? 0; const unit = options.unit ?? 1;
  if (isLayout(source)) return { x: q(ox + (thing.x + 0.5) * source.cell * unit), y: q(oy + (thing.y + 0.5) * source.cell * unit) };
  return { x: q(ox + thing.x * unit), y: q(oy + thing.y * unit) };
}

/**
 * toTileMap(layout, options) -> { tileSize, cols, rows, isSolid(col, row) }
 * The tile map shape of the collision and physics engines and of ai's navFromTiles.
 *   options.unit        world units per metre; tileSize = layout.cell * unit. Default 1.
 *   options.props       true: solid furniture and chests block too. Default true.
 *   options.unlocked    a Set (or array) of door ids that are open; other locked doors are solid. Default none.
 * Outside the map is solid.
 */
export function toTileMap(layout, options = {}) {
  need(isLayout(layout), 'toTileMap: the first argument must be a dungeon or an interior');
  const { cols, rows, tiles } = layout;
  const solid = new Uint8Array(cols * rows);
  for (let i = 0; i < tiles.length; i++) solid[i] = isWalkable(tiles[i]) ? 0 : 1;
  if (options.props ?? true) {
    for (const p of layout.props) if (p.solid) solid[p.y * cols + p.x] = 1;
    for (const l of layout.loot) if (l.container === 'chest') solid[l.y * cols + l.x] = 1;
  }
  const unlocked = new Set(options.unlocked ?? []);
  const doors = layout.doors.filter((d) => d.locked);
  return {
    tileSize: layout.cell * (options.unit ?? 1), cols, rows,
    isSolid(col, row) {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return true;
      if (solid[row * cols + col]) return true;
      for (const d of doors) if (d.x === col && d.y === row && !unlocked.has(d.id)) return true;
      return false;
    },
    /** Open a locked door for good (the player used the key). */
    unlock(doorId) { unlocked.add(doorId); },
  };
}

/**
 * toAiAgents(source, options) -> [options for ai.add, ...]
 * source: a dungeon (its monsters), an interior (its people) or a camp (its band).
 *   options.origin, options.unit   as in positionOf
 *   options.dialogue   { spawnOrPersonId: dialogueId } to give someone a dialogue
 * Every agent has id, kind, x, y, seed, faction and tags { procgen, room?, boss?, leader?, role? }.
 * Guards get bb.guard, bands share a squad, sentries get a patrol, people get home and places.work.
 */
export function toAiAgents(source, options = {}) {
  need(source && (isLayout(source) || source.kind === 'camp'), 'toAiAgents: the first argument must be a dungeon, an interior or a camp');
  const at = (thing) => positionOf(source, thing, options);
  const out = [];
  for (const s of source.spawns ?? []) {
    const agent = { id: s.id, kind: s.kind, ...at(s), seed: s.seed, faction: s.faction, squad: s.squad, home: at(s), tags: { procgen: source.id } };
    if (s.size) agent.size = s.size;
    if (s.guard) agent.bb = { guard: true };
    if (s.patrol) agent.patrol = s.patrol.map(([x, y]) => { const p = at({ x, y }); return [p.x, p.y]; });
    if (s.room) agent.tags.room = s.room;
    if (s.boss) agent.tags.boss = true;
    if (s.leader) agent.tags.leader = true;
    if (source.kind === 'camp' && !source.hostile) delete agent.squad;
    if (options.dialogue?.[s.id]) agent.dialogue = options.dialogue[s.id];
    out.push(agent);
  }
  for (const p of source.people ?? []) {
    const work = at(p.work); const home = at(p.home);
    const agent = { id: p.id, kind: p.kind, ...at(p), seed: p.seed, faction: source.faction, home, places: { work: [work.x, work.y] }, tags: { procgen: source.id, role: p.role } };
    if (options.dialogue?.[p.id]) agent.dialogue = options.dialogue[p.id];
    out.push(agent);
  }
  return out;
}

/**
 * toWorldEntities(source, options) -> [entity, ...] for the world engine's entities.add:
 * { x, y, persist: true, procgen: id of the spawn, ai: { options for ai.add without id, x, y } }.
 * Use it in the entities' spawn(chunk, info, add) when info.spawned is false.
 */
export function toWorldEntities(source, options = {}) {
  return toAiAgents(source, options).map(({ id, x, y, ...ai }) => ({ x, y, persist: true, procgen: id, ai }));
}

/**
 * lootTables(...sources) -> ['crypt_chest', 'crypt_boss', ...] every loot table name the sources
 * use, so a game can check its inventory loot tables cover them before play.
 */
export function lootTables(...sources) {
  const names = new Set();
  for (const source of sources.flat()) for (const l of source.loot ?? []) names.add(l.table);
  return [...names].sort();
}

/**
 * toAscii(layout) -> string picture of a dungeon or interior for logs and tests: walls '#',
 * floor '.', doors '+' (locked 'L'), entrance '<', exit '>', monsters 'm' (boss 'B'), people 'p',
 * chests '$' (with a key 'k'), solid scenery 'o', other scenery ','.
 */
export function toAscii(layout) {
  need(isLayout(layout), 'toAscii: the first argument must be a dungeon or an interior');
  const chars = [' ', '.', '#', '+', '<', '>'];
  const grid = [];
  for (let y = 0; y < layout.rows; y++) grid.push(Array.from({ length: layout.cols }, (_, x) => chars[layout.tiles[y * layout.cols + x]] ?? '?'));
  for (const d of layout.doors) if (d.locked) grid[d.y][d.x] = 'L';
  for (const p of layout.props) grid[p.y][p.x] = p.solid ? 'o' : ',';
  for (const l of layout.loot) grid[l.y][l.x] = l.item ? 'k' : '$';
  for (const s of layout.spawns) grid[s.y][s.x] = s.boss ? 'B' : 'm';
  for (const p of layout.people ?? []) grid[p.y][p.x] = 'p';
  return grid.map((row) => row.join('')).join('\n');
}

export { TILE };
