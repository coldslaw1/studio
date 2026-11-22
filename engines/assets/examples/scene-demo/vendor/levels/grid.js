// A grid of single characters, plus the searches every level generator needs.
// Levels travel as "rows": an array of equal-length strings, e.g.
//   ['#####',
//    '#S.E#',
//    '#####']
// x goes right, y goes down, (0,0) is the top-left tile.

/** The four neighbours, in the order up, right, down, left. */
export const DIRS = [
  { name: 'U', dx: 0, dy: -1 },
  { name: 'R', dx: 1, dy: 0 },
  { name: 'D', dx: 0, dy: 1 },
  { name: 'L', dx: -1, dy: 0 },
];

/** makeGrid(5, 3, '#') -> { w, h, cells } where cells is a flat array of characters. */
export function makeGrid(w, h, fill = '#') {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new Error(`makeGrid(${w}, ${h}): width and height must be positive integers`);
  }
  return { w, h, cells: new Array(w * h).fill(fill) };
}

export function inBounds(grid, x, y) {
  return x >= 0 && y >= 0 && x < grid.w && y < grid.h;
}

/** get(grid, x, y) -> the character there, or null when x,y is outside the grid. */
export function get(grid, x, y) {
  return inBounds(grid, x, y) ? grid.cells[y * grid.w + x] : null;
}

/** set(grid, x, y, ch) changes one tile. Throws when x,y is outside the grid. */
export function set(grid, x, y, ch) {
  if (!inBounds(grid, x, y)) throw new Error(`set: ${x},${y} is outside the ${grid.w}x${grid.h} grid`);
  grid.cells[y * grid.w + x] = ch;
}

export function cloneGrid(grid) {
  return { w: grid.w, h: grid.h, cells: grid.cells.slice() };
}

/** toRows(grid) -> array of strings, ready to store as level data. */
export function toRows(grid) {
  const rows = [];
  for (let y = 0; y < grid.h; y++) {
    rows.push(grid.cells.slice(y * grid.w, (y + 1) * grid.w).join(''));
  }
  return rows;
}

/** fromRows(rows) -> grid. Throws when rows are missing or not all the same length. */
export function fromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('fromRows: no rows');
  const w = rows[0].length;
  const grid = makeGrid(w, rows.length);
  rows.forEach((row, y) => {
    if (typeof row !== 'string' || row.length !== w) {
      throw new Error(`fromRows: row ${y} must be ${w} characters long`);
    }
    for (let x = 0; x < w; x++) grid.cells[y * w + x] = row[x];
  });
  return grid;
}

/** findAll(grid, 'P') -> [{ x, y }] for every tile holding that character. */
export function findAll(grid, ch) {
  const found = [];
  grid.cells.forEach((c, i) => {
    if (c === ch) found.push({ x: i % grid.w, y: Math.floor(i / grid.w) });
  });
  return found;
}

/** find(grid, 'S') -> the first { x, y } holding that character, or null. */
export function find(grid, ch) {
  const i = grid.cells.indexOf(ch);
  return i === -1 ? null : { x: i % grid.w, y: Math.floor(i / grid.w) };
}

/** neighbors(grid, x, y) -> the in-bounds neighbours as [{ x, y, name }] (name is U/R/D/L). */
export function neighbors(grid, x, y) {
  const out = [];
  for (const d of DIRS) {
    if (inBounds(grid, x + d.dx, y + d.dy)) out.push({ x: x + d.dx, y: y + d.dy, name: d.name });
  }
  return out;
}

// "passable" below is a function (ch, x, y) -> boolean. Default: anything except '#'.
const notWall = (ch) => ch !== '#';

/**
 * distanceMap(grid, from, passable) -> flat array, one number per tile:
 * steps from `from` ({x, y}) walking over passable tiles, or -1 when unreachable.
 * Read it with dist[y * grid.w + x].
 */
export function distanceMap(grid, from, passable = notWall) {
  const dist = new Array(grid.w * grid.h).fill(-1);
  if (!inBounds(grid, from.x, from.y)) return dist;
  dist[from.y * grid.w + from.x] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = dist[cur.y * grid.w + cur.x];
    for (const n of neighbors(grid, cur.x, cur.y)) {
      const i = n.y * grid.w + n.x;
      if (dist[i] !== -1 || !passable(grid.cells[i], n.x, n.y)) continue;
      dist[i] = d + 1;
      queue.push({ x: n.x, y: n.y });
    }
  }
  return dist;
}

/** reachable(grid, from, passable) -> [{ x, y, steps }] every tile that can be walked to, nearest first. */
export function reachable(grid, from, passable = notWall) {
  const dist = distanceMap(grid, from, passable);
  const out = [];
  dist.forEach((steps, i) => {
    if (steps !== -1) out.push({ x: i % grid.w, y: Math.floor(i / grid.w), steps });
  });
  return out.sort((a, b) => a.steps - b.steps);
}

/** canReach(grid, from, to, passable) -> true when `to` can be walked to from `from`. */
export function canReach(grid, from, to, passable = notWall) {
  return distanceMap(grid, from, passable)[to.y * grid.w + to.x] !== -1;
}

/**
 * findPath(grid, from, to, passable) -> shortest path as a string of U/R/D/L
 * ('' when from equals to), or null when there is no path.
 */
export function findPath(grid, from, to, passable = notWall) {
  const dist = distanceMap(grid, from, passable);
  if (!inBounds(grid, to.x, to.y) || dist[to.y * grid.w + to.x] === -1) return null;
  let path = '';
  let cur = { x: to.x, y: to.y };
  while (dist[cur.y * grid.w + cur.x] > 0) {
    const want = dist[cur.y * grid.w + cur.x] - 1;
    for (const d of DIRS) { // step backwards along decreasing distance
      const px = cur.x - d.dx;
      const py = cur.y - d.dy;
      if (inBounds(grid, px, py) && dist[py * grid.w + px] === want) {
        path = d.name + path;
        cur = { x: px, y: py };
        break;
      }
    }
  }
  return path;
}

/**
 * regions(grid, passable) -> array of regions, biggest first. Each region is a
 * list of { x, y } tiles that are connected to each other.
 */
export function regions(grid, passable = notWall) {
  const seen = new Array(grid.w * grid.h).fill(false);
  const out = [];
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const i = y * grid.w + x;
      if (seen[i] || !passable(grid.cells[i], x, y)) continue;
      const tiles = reachable(grid, { x, y }, passable).map(({ x: tx, y: ty }) => ({ x: tx, y: ty }));
      for (const t of tiles) seen[t.y * grid.w + t.x] = true;
      out.push(tiles);
    }
  }
  return out.sort((a, b) => b.length - a.length);
}
