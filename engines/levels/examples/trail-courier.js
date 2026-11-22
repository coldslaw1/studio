// Example 1: a "never cross your own trail" delivery puzzle, in the same level
// format as Mossback Mail:
//   #  wall     .  floor     S  start     P  parcel     H  house
// Rules: every tile you leave becomes trail and can never be entered again.
// Stepping on P picks it up. A house can only be entered while carrying a
// parcel. Deliver to every house to win.
//
// Run:  node examples/trail-courier.js [seed] [count]
import { generatePack, solve, carveWalk, fromRows, toRows, find, findAll, get, set, DIRS } from '../src/index.js';

/** trailPuzzle(rows) -> the puzzle description that solve() needs. */
export function trailPuzzle(rows) {
  const grid = fromRows(rows);
  const start = find(grid, 'S');
  const houseCount = findAll(grid, 'H').length;
  return {
    // slime is a string with one character per tile: '1' = trail, '0' = clean.
    start: { x: start.x, y: start.y, slime: '0'.repeat(grid.w * grid.h), carrying: 0, delivered: 0 },
    actions: DIRS.map((d) => d.name),
    step(state, action) {
      const d = DIRS.find((dir) => dir.name === action);
      const x = state.x + d.dx;
      const y = state.y + d.dy;
      const tile = get(grid, x, y);
      if (tile === null || tile === '#') return null;
      if (state.slime[y * grid.w + x] === '1') return null;
      if (tile === 'H' && state.carrying === 0) return null;
      const from = state.y * grid.w + state.x;
      return {
        x,
        y,
        slime: state.slime.slice(0, from) + '1' + state.slime.slice(from + 1),
        carrying: state.carrying + (tile === 'P' ? 1 : 0) - (tile === 'H' ? 1 : 0),
        delivered: state.delivered + (tile === 'H' ? 1 : 0),
      };
    },
    isWon: (state) => state.delivered === houseCount,
    // Position + trail fully decide the rest, so they make a short, exact key.
    key: (state) => `${state.x},${state.y},${state.slime}`,
  };
}

/** Build one candidate: carve a winding route, drop parcels and houses along it, add side pockets. */
function buildTrailLevel(rng, info) {
  const w = 6 + Math.round(info.progress * 3); // later levels are bigger
  const h = 5 + Math.round(info.progress * 2);
  const houses = 1 + Math.round(info.progress * 2);
  const { grid, path } = carveWalk(rng, w, h, { steps: Math.floor(w * h * 0.4), selfAvoiding: true });
  if (path.length < houses * 3 + 1) return null; // too short to be interesting: skip

  // The carved route is itself a winning walk as long as each house comes after
  // its parcel. Choose 2 * houses route positions, in order; the last tile is a house.
  const middle = rng.shuffle(path.slice(1, -1).map((_, i) => i + 1)).slice(0, houses * 2 - 1);
  const spots = [...middle, path.length - 1].sort((a, b) => a - b);
  let carrying = 0;
  let parcelsLeft = houses;
  for (const pathIndex of spots) {
    // A house needs a parcel in hand; once the parcels run out only houses remain.
    const isHouse = carrying > 0 && (parcelsLeft === 0 || rng.chance(0.5));
    set(grid, path[pathIndex].x, path[pathIndex].y, isHouse ? 'H' : 'P');
    carrying += isHouse ? -1 : 1;
    if (!isHouse) parcelsLeft--;
  }
  set(grid, path[0].x, path[0].y, 'S');

  // Side pockets: extra floor next to the route. They are the traps and shortcuts.
  const pockets = Math.round(1 + info.progress * 4);
  for (let i = 0; i < pockets; i++) {
    const from = rng.pick(path);
    const d = rng.pick(DIRS);
    const x = from.x + d.dx;
    const y = from.y + d.dy;
    if (x >= 1 && y >= 1 && x <= w - 2 && y <= h - 2 && get(grid, x, y) === '#') set(grid, x, y, '.');
  }
  return toRows(grid);
}

/** generateTrailPack(seed, count) -> [{ level: rows, solution, seed, attempt }] every level proven winnable. */
export function generateTrailPack(seed, count) {
  return generatePack({
    seed,
    count,
    build: buildTrailLevel,
    solve: (rows) => solve(trailPuzzle(rows)),
    // Reject boring levels: need a few moves, and later levels need real traps.
    accept: (rows, solution, info) => solution.steps >= 5 && solution.deadEnds >= Math.round(info.progress * 6),
    levelKey: (rows) => rows.join('\n'),
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const seed = process.argv[2] ?? 'garden';
  const count = Number(process.argv[3] ?? 4);
  for (const { level, solution, index, attempt } of generateTrailPack(seed, count)) {
    console.log(`\nLevel ${index + 1}  (attempt ${attempt}, ${solution.steps} moves, ${solution.deadEnds} dead ends)`);
    console.log(level.join('\n'));
    console.log(`solution: ${solution.path.join('')}`);
  }
}
