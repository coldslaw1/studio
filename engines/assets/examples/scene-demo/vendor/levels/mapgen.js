// Ready-made map builders. Each takes an rng and returns a grid ('#' wall,
// '.' floor) that is fully connected: every floor tile can be walked to from
// every other floor tile. Place your start, exit and items on top with placers.
import { withHelpers } from './rng.js';
import { makeGrid, get, set, inBounds, DIRS, regions, distanceMap, findAll } from './grid.js';

function checkSize(name, w, h, min) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < min || h < min) {
    throw new Error(`${name}: width and height must be integers >= ${min}, got ${w}x${h}`);
  }
}

/**
 * keepLargestRegion(grid, floor = '.', wall = '#') -> grid (changed in place).
 * Fills every floor area except the biggest one with wall, so the map is connected.
 */
export function keepLargestRegion(grid, floor = '.', wall = '#') {
  const all = regions(grid, (ch) => ch === floor);
  for (const region of all.slice(1)) {
    for (const t of region) set(grid, t.x, t.y, wall);
  }
  return grid;
}

/**
 * carveCave(rng, w, h, { fill = 0.45, smooth = 4 }) -> grid
 * Organic cave. fill = share of tiles that start as wall (0.35 open .. 0.5 tight).
 * The outer border is always wall.
 */
export function carveCave(rng, w, h, { fill = 0.45, smooth = 4 } = {}) {
  checkSize('carveCave', w, h, 5);
  rng = withHelpers(rng);
  let grid = makeGrid(w, h, '#');
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) set(grid, x, y, rng.chance(fill) ? '#' : '.');
  }
  for (let pass = 0; pass < smooth; pass++) {
    const next = makeGrid(w, h, '#');
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) if (get(grid, x + dx, y + dy) === '#') walls++;
        }
        set(next, x, y, walls >= 5 ? '#' : '.');
      }
    }
    grid = next;
  }
  if (findAll(grid, '.').length === 0) set(grid, Math.floor(w / 2), Math.floor(h / 2), '.');
  return keepLargestRegion(grid);
}

/**
 * carveMaze(rng, w, h, { loops = 0 }) -> grid
 * Perfect maze with 1-tile corridors. w and h should be ODD (an even size leaves
 * an extra wall row/column). loops = share of extra walls knocked out (0..1) to
 * add alternative routes; 0 means exactly one route between any two tiles.
 */
export function carveMaze(rng, w, h, { loops = 0 } = {}) {
  checkSize('carveMaze', w, h, 5);
  rng = withHelpers(rng);
  const grid = makeGrid(w, h, '#');
  const cols = Math.floor((w - 1) / 2);
  const rows = Math.floor((h - 1) / 2);
  const startX = 1 + 2 * rng.int(0, cols - 1);
  const startY = 1 + 2 * rng.int(0, rows - 1);
  set(grid, startX, startY, '.');
  const stack = [{ x: startX, y: startY }];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = DIRS.filter((d) => {
      const nx = cur.x + 2 * d.dx;
      const ny = cur.y + 2 * d.dy;
      return nx >= 1 && ny >= 1 && nx <= 2 * cols - 1 && ny <= 2 * rows - 1 && get(grid, nx, ny) === '#';
    });
    if (!options.length) { stack.pop(); continue; }
    const d = rng.pick(options);
    set(grid, cur.x + d.dx, cur.y + d.dy, '.');
    set(grid, cur.x + 2 * d.dx, cur.y + 2 * d.dy, '.');
    stack.push({ x: cur.x + 2 * d.dx, y: cur.y + 2 * d.dy });
  }
  if (loops > 0) {
    for (let y = 1; y < 2 * rows; y++) {
      for (let x = 1; x < 2 * cols; x++) {
        if (get(grid, x, y) !== '#') continue;
        const joinsAcross = get(grid, x - 1, y) === '.' && get(grid, x + 1, y) === '.';
        const joinsDown = get(grid, x, y - 1) === '.' && get(grid, x, y + 1) === '.';
        if ((joinsAcross || joinsDown) && rng.chance(loops)) set(grid, x, y, '.');
      }
    }
  }
  return grid;
}

/**
 * carveRooms(rng, w, h, { rooms = 6, minSize = 3, maxSize = 6 }) -> { grid, rooms }
 * Rectangular rooms joined by L-shaped corridors. rooms is the number TRIED;
 * overlapping ones are dropped, so fewer may be placed (always at least 1).
 * Returned rooms: [{ x, y, w, h, cx, cy }] where cx,cy is a floor tile at the centre.
 */
export function carveRooms(rng, w, h, { rooms = 6, minSize = 3, maxSize = 6 } = {}) {
  checkSize('carveRooms', w, h, minSize + 2);
  rng = withHelpers(rng);
  const grid = makeGrid(w, h, '#');
  const placed = [];
  const maxW = Math.min(maxSize, w - 2);
  const maxH = Math.min(maxSize, h - 2);
  for (let i = 0; i < rooms * 4 && placed.length < rooms; i++) {
    const rw = rng.int(minSize, Math.max(minSize, maxW));
    const rh = rng.int(minSize, Math.max(minSize, maxH));
    if (rw > w - 2 || rh > h - 2) continue;
    const rx = rng.int(1, w - 1 - rw);
    const ry = rng.int(1, h - 1 - rh);
    const overlaps = placed.some((r) => rx <= r.x + r.w && rx + rw >= r.x && ry <= r.y + r.h && ry + rh >= r.y);
    if (overlaps) continue;
    const room = { x: rx, y: ry, w: rw, h: rh, cx: rx + Math.floor(rw / 2), cy: ry + Math.floor(rh / 2) };
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) set(grid, x, y, '.');
    if (placed.length) { // corridor from the previous room's centre to this one
      const prev = placed[placed.length - 1];
      const bendFirstX = rng.chance(0.5);
      let { cx: x, cy: y } = prev;
      const walkX = () => { while (x !== room.cx) { x += Math.sign(room.cx - x); set(grid, x, y, '.'); } };
      const walkY = () => { while (y !== room.cy) { y += Math.sign(room.cy - y); set(grid, x, y, '.'); } };
      if (bendFirstX) { walkX(); walkY(); } else { walkY(); walkX(); }
    }
    placed.push(room);
  }
  if (!placed.length) throw new Error(`carveRooms: no room of size ${minSize} fits in ${w}x${h}`);
  return { grid, rooms: placed };
}

/**
 * carveWalk(rng, w, h, { steps, selfAvoiding = false, spaced = false, start }) -> { grid, path }
 * A wandering path carved out of solid wall. path is the list of { x, y } tiles
 * in the order they were visited (path[0] is the start).
 *   selfAvoiding: the walk never steps on a tile it already visited.
 *   spaced:       it also never runs side by side with itself, which gives one
 *                 clean winding corridor with wall between every bend.
 * With either option the walk may stop early when it boxes itself in, so check
 * path.length. Default steps: a third of the grid. The border stays wall.
 */
export function carveWalk(rng, w, h, { steps, selfAvoiding = false, spaced = false, start } = {}) {
  checkSize('carveWalk', w, h, 3);
  rng = withHelpers(rng);
  const grid = makeGrid(w, h, '#');
  const total = steps ?? Math.floor((w * h) / 3);
  let cur = start ?? { x: rng.int(1, w - 2), y: rng.int(1, h - 2) };
  if (!inBounds(grid, cur.x, cur.y)) throw new Error(`carveWalk: start ${cur.x},${cur.y} is outside the grid`);
  set(grid, cur.x, cur.y, '.');
  const path = [{ x: cur.x, y: cur.y }];
  const inside = (x, y) => x >= 1 && y >= 1 && x <= w - 2 && y <= h - 2;
  for (let i = 0; i < total; i++) {
    const options = DIRS.filter((d) => {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (!inside(nx, ny)) return false;
      if (!selfAvoiding && !spaced) return true;
      if (get(grid, nx, ny) === '.') return false;
      if (!spaced) return true;
      // the new tile may only touch the tile we are coming from
      return DIRS.every((e) => (nx + e.dx === cur.x && ny + e.dy === cur.y) || get(grid, nx + e.dx, ny + e.dy) !== '.');
    });
    if (!options.length) break;
    const d = rng.pick(options);
    cur = { x: cur.x + d.dx, y: cur.y + d.dy };
    set(grid, cur.x, cur.y, '.');
    path.push(cur);
  }
  return { grid, path };
}

/**
 * place(rng, grid, ch, options) -> [{ x, y }] the tiles that were changed to `ch`.
 *
 * options = {
 *   count = 1,        how many to place
 *   on = '.',         only tiles currently holding this character are used
 *   awayFrom,         optional { x, y }: keep at least minSteps walking steps from it
 *   minSteps = 0,
 *   passable,         optional (ch) => boolean used for the walking distance
 * }
 * Throws when there are not enough free tiles, so a generator can never
 * silently produce a level with a missing key or exit.
 */
export function place(rng, grid, ch, { count = 1, on = '.', awayFrom, minSteps = 0, passable } = {}) {
  rng = withHelpers(rng);
  let spots = findAll(grid, on);
  if (awayFrom) {
    const dist = distanceMap(grid, awayFrom, passable);
    spots = spots.filter((s) => dist[s.y * grid.w + s.x] >= minSteps);
  }
  if (spots.length < count) {
    throw new Error(`place: wanted ${count} "${ch}" but only ${spots.length} "${on}" tiles qualify`);
  }
  const chosen = rng.shuffle(spots).slice(0, count);
  for (const s of chosen) set(grid, s.x, s.y, ch);
  return chosen;
}

/**
 * farthest(grid, from, passable) -> { x, y, steps } the walkable tile farthest
 * from `from`. Handy for putting the exit far from the start.
 */
export function farthest(grid, from, passable) {
  const dist = distanceMap(grid, from, passable);
  let best = { x: from.x, y: from.y, steps: 0 };
  dist.forEach((steps, i) => {
    if (steps > best.steps) best = { x: i % grid.w, y: Math.floor(i / grid.w), steps };
  });
  return best;
}
