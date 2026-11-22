// The cellar puzzle: push every crate onto a marked stone. Pure rules plus a seeded generator
// built on the levels engine, which only hands out rooms its solver has proven winnable.
// Rows: '#' wall, '.' floor, 'S' where you start, 'C' crate, 'T' marked stone.
import { generatePack, solve, makeGrid, set, get, fromRows, toRows, find, findAll, DIRS, place } from '../vendor/levels/index.js';

/** How many rooms the cellar has, in order. */
export const CELLAR_ROOMS = 3;
const SEED = 'hamlet-cellar-1';

const sortCrates = (crates) => crates.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);

/**
 * The puzzle of one room, in the shape the levels solver and playbot use.
 * State: { x, y, crates: [[x, y], ...] } (crates sorted, so equal positions give equal states).
 * @param {string[]} rows
 */
export function cellarPuzzle(rows) {
  const grid = fromRows(rows);
  const marks = findAll(grid, 'T').map((p) => p.x + ',' + p.y);
  const wall = (x, y) => { const c = get(grid, x, y); return c === '#' || c === null; };
  const start = find(grid, 'S');
  if (!start) throw new Error('cellarPuzzle: the room has no start tile "S"');
  return {
    grid,
    marks,
    start: { x: start.x, y: start.y, crates: sortCrates(findAll(grid, 'C').map((p) => [p.x, p.y])) },
    actions: ['U', 'R', 'D', 'L'],
    /** One step or push. Returns the new state, or null when a wall or a second crate is in the way. */
    step(state, action) {
      const d = DIRS.find((dir) => dir.name === action);
      if (!d) throw new Error(`cellarPuzzle.step: unknown action ${JSON.stringify(action)}, expected U, R, D or L`);
      const x = state.x + d.dx; const y = state.y + d.dy;
      if (wall(x, y)) return null;
      const hit = state.crates.findIndex((c) => c[0] === x && c[1] === y);
      if (hit < 0) return { x, y, crates: state.crates };
      const bx = x + d.dx; const by = y + d.dy;
      if (wall(bx, by) || state.crates.some((c) => c[0] === bx && c[1] === by)) return null;
      const crates = state.crates.slice();
      crates[hit] = [bx, by];
      return { x, y, crates: sortCrates(crates), pushed: true };
    },
    isWon: (state) => state.crates.every((c) => marks.includes(c[0] + ',' + c[1])),
    key: (state) => state.x + ',' + state.y + ';' + state.crates.join(';'),
    /** Share of crates standing on a marked stone, 0..1. */
    progress: (state) => state.crates.filter((c) => marks.includes(c[0] + ',' + c[1])).length / Math.max(1, state.crates.length),
    maxStates: 400000,
  };
}

/** One random room: an open floor with a few pillars, crates away from the walls, marks anywhere. */
function buildRoom(rng, info) {
  const crates = info.index < 2 ? 1 : 2; // one crate in the first two rooms, two in the last
  const w = 7 + (info.index > 1 ? 1 : 0); const h = 6 + (info.index > 1 ? 1 : 0);
  const grid = makeGrid(w, h, '#');
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) set(grid, x, y, '.');
  for (let i = 0; i < 1 + Math.floor(info.index / 2); i++) set(grid, rng.int(2, w - 3), rng.int(2, h - 3), '#');
  try {
    place(rng, grid, 'T', { count: crates });
    // a crate on the outer ring of the floor can only slide along the wall, so keep them inside it
    const inner = (ch, x, y) => ch === '.' && x > 1 && y > 1 && x < w - 2 && y < h - 2;
    const free = [];
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (inner(get(grid, x, y), x, y)) free.push([x, y]);
    if (free.length < crates) return null;
    for (const [x, y] of rng.shuffle(free).slice(0, crates)) set(grid, x, y, 'C');
    place(rng, grid, 'S', { count: 1 });
  } catch { return null; }
  return toRows(grid);
}

/**
 * The cellar's rooms, the same every time: [{ rows, par, path }] where `par` is the fewest moves
 * that solve the room and `path` one such solution.
 */
export function cellarRooms() {
  return generatePack({
    seed: SEED,
    count: CELLAR_ROOMS,
    build: buildRoom,
    solve: (rows) => solve(cellarPuzzle(rows)),
    accept: (rows, solution, info) => solution.steps >= 6 + info.index * 4 && solution.steps <= 12 + info.index * 8,
    maxAttempts: 400,
  }).map((r) => ({ rows: r.level, par: r.solution.steps, path: r.solution.path }));
}

/** The next move of a shortest solution from `state`, or null when the room cannot be won from there. */
export function cellarHint(rows, state) {
  const puzzle = cellarPuzzle(rows);
  const result = solve({ ...puzzle, start: { x: state.x, y: state.y, crates: sortCrates(state.crates) } });
  return result.solved ? (result.path[0] ?? null) : null;
}
