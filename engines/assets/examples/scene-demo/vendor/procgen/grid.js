// The tile map every dungeon and interior is made of: a flat array of tile ids, row by row.
// tiles[y * cols + x]. One tile is `cell` metres wide (default 1).

/** Tile ids of a layout. */
export const TILE = { void: 0, floor: 1, wall: 2, door: 3, entrance: 4, exit: 5 };
/** One character per tile id, for toRows and for reading a map in a terminal. */
export const TILE_CHARS = [' ', '.', '#', '+', '<', '>'];

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** makeTiles(cols, rows, fill = TILE.void) -> number[] */
export function makeTiles(cols, rows, fill = TILE.void) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) throw new Error(`makeTiles: cols and rows must be whole numbers above 0, got ${cols} x ${rows}`);
  return new Array(cols * rows).fill(fill);
}

/** tileAt(layout, x, y) -> tile id, TILE.void outside the map. */
export function tileAt(layout, x, y) {
  if (x < 0 || y < 0 || x >= layout.cols || y >= layout.rows) return TILE.void;
  return layout.tiles[y * layout.cols + x];
}

/** isWalkable(tile) -> true for floor, doors, the entrance and the exit. */
export function isWalkable(tile) {
  return tile === TILE.floor || tile === TILE.door || tile === TILE.entrance || tile === TILE.exit;
}

/**
 * distances(layout, from, blocked?) -> Int32Array of walking steps from `from` ({ x, y }) to every
 * tile (4 directions), -1 where it cannot be reached. `blocked` is an optional Set of tile
 * indexes (y * cols + x) treated as walls: locked doors, solid furniture.
 */
export function distances(layout, from, blocked = null) {
  const { cols, rows, tiles } = layout;
  const dist = new Int32Array(cols * rows).fill(-1);
  const start = from.y * cols + from.x;
  if (!isWalkable(tiles[start])) return dist;
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]; const x = i % cols; const y = (i - x) / cols;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = ny * cols + nx;
      if (dist[n] !== -1 || !isWalkable(tiles[n]) || (blocked && blocked.has(n))) continue;
      dist[n] = dist[i] + 1;
      queue.push(n);
    }
  }
  return dist;
}

/** addWalls(layout) - turns every void tile that touches a walkable tile (8 directions) into a wall. */
export function addWalls(layout) {
  const { cols, rows, tiles } = layout;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (tiles[y * cols + x] !== TILE.void) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (isWalkable(tileAt(layout, x + dx, y + dy))) { near = true; break; }
      if (near) tiles[y * cols + x] = TILE.wall;
    }
  }
}

/** toRows(layout) -> ['#####', '#..+.', ...] one string per row (see TILE_CHARS). */
export function toRows(layout) {
  const out = [];
  for (let y = 0; y < layout.rows; y++) {
    let row = '';
    for (let x = 0; x < layout.cols; x++) row += TILE_CHARS[layout.tiles[y * layout.cols + x]] ?? '?';
    out.push(row);
  }
  return out;
}

/** roomAt(layout, x, y) -> the room whose floor holds tile x, y, or null (a corridor). */
export function roomAt(layout, x, y) {
  for (const room of layout.rooms) if (x >= room.x && y >= room.y && x < room.x + room.w && y < room.y + room.h) return room;
  return null;
}

/**
 * freeTiles(layout, room, taken, margin = 0) -> [{ x, y }] floor tiles of a room that nothing
 * stands on yet. `taken` is a Set of tile indexes. `margin` keeps away from the room's walls.
 */
export function freeTiles(layout, room, taken, margin = 0) {
  const out = [];
  for (let y = room.y + margin; y < room.y + room.h - margin; y++) {
    for (let x = room.x + margin; x < room.x + room.w - margin; x++) {
      const i = y * layout.cols + x;
      if (layout.tiles[i] === TILE.floor && !taken.has(i)) out.push({ x, y });
    }
  }
  return out;
}
