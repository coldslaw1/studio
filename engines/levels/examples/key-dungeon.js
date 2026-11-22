// Example 2: a small dungeon with a locked door.
//   #  wall   .  floor   @  start   E  exit   k  key   D  door (needs one key)
// Shows the usual recipe: carve a map, place things, let the solver prove it.
//
// Run:  node examples/key-dungeon.js [seed]
import {
  generate, solve, carveRooms, fromRows, toRows, find, findAll, get, set,
  findPath, canReach, reachable, farthest, DIRS,
} from '../src/index.js';

/** dungeonPuzzle(rows) -> the puzzle description that solve() needs. */
export function dungeonPuzzle(rows) {
  const grid = fromRows(rows);
  const start = find(grid, '@');
  return {
    // taken / opened are sorted lists of tile numbers, so equal states get equal keys.
    start: { x: start.x, y: start.y, keys: 0, taken: [], opened: [] },
    actions: DIRS.map((d) => d.name),
    step(state, action) {
      const d = DIRS.find((dir) => dir.name === action);
      const x = state.x + d.dx;
      const y = state.y + d.dy;
      const tile = get(grid, x, y);
      if (tile === null || tile === '#') return null;
      const i = y * grid.w + x;
      let { keys, taken, opened } = state;
      if (tile === 'k' && !taken.includes(i)) {
        keys += 1;
        taken = [...taken, i].sort((a, b) => a - b);
      }
      if (tile === 'D' && !opened.includes(i)) {
        if (keys === 0) return null; // locked
        keys -= 1;
        opened = [...opened, i].sort((a, b) => a - b);
      }
      return { x, y, keys, taken, opened };
    },
    isWon: (state) => get(grid, state.x, state.y) === 'E',
  };
}

function buildDungeon(rng) {
  const { grid, rooms } = carveRooms(rng, 21, 13, { rooms: 5, minSize: 3, maxSize: 5 });
  const start = { x: rooms[0].cx, y: rooms[0].cy };
  const exit = farthest(grid, start);
  const route = findPath(grid, start, exit);
  if (route === null || route.length < 8) return null;

  // Walk the route and collect tiles where a door would really block the way.
  const chokepoints = [];
  let cur = { ...start };
  for (const letter of route.slice(0, -1)) {
    const d = DIRS.find((dir) => dir.name === letter);
    cur = { x: cur.x + d.dx, y: cur.y + d.dy };
    const blocked = (ch, x, y) => ch !== '#' && !(x === cur.x && y === cur.y);
    if (!canReach(grid, start, exit, blocked)) chokepoints.push({ ...cur });
  }
  if (!chokepoints.length) return null;
  const door = rng.pick(chokepoints);
  set(grid, door.x, door.y, 'D');

  // The key must be on the start side of the door.
  const startSide = reachable(grid, start, (ch) => ch !== '#' && ch !== 'D')
    .filter((t) => t.steps >= 3);
  if (!startSide.length) return null;
  const key = rng.pick(startSide);
  set(grid, key.x, key.y, 'k');
  set(grid, start.x, start.y, '@');
  set(grid, exit.x, exit.y, 'E');
  return toRows(grid);
}

/** generateDungeon(seed) -> { level: rows, solution, seed, attempt } proven winnable. */
export function generateDungeon(seed) {
  return generate({
    seed,
    build: buildDungeon,
    solve: (rows) => solve(dungeonPuzzle(rows)),
    accept: (rows, solution) => solution.steps >= 12 && findAll(fromRows(rows), 'D').length === 1,
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { level, solution, attempt } = generateDungeon(process.argv[2] ?? 'crypt');
  console.log(level.join('\n'));
  console.log(`attempt ${attempt}, ${solution.steps} moves: ${solution.path.join('')}`);
}
