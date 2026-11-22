// Exact analysis for turn-based, deterministic games whose adapter has key().
// It walks every reachable position (up to a cap) and answers the questions
// random play can only estimate: can this level be won at all, how short is the
// shortest win, and how many positions are already lost without saying so.
import { createRng } from './rng.js';

/**
 * explore(adapter, level, { maxStates }) -> {
 *   complete:     true when every reachable position was visited,
 *   states:       positions visited,
 *   solvable:     true | false | null (null = cap hit before a win was found),
 *   shortestWin:  fewest moves to win, or null,
 *   deadEnds:     playing positions from which a win is no longer possible (complete only),
 *   deadEndShare: deadEnds / all playing positions (complete only),
 *   traps:        moves that turn a still-winnable position into a doomed one (complete only),
 *   trapShare:    traps / all moves available from winnable positions (complete only),
 *   startMoves:   moves available at the start (complete only),
 *   startTraps:   how many of those already make the level unwinnable (complete only),
 * }
 */
export function explore(adapter, level, { maxStates = 200000 } = {}) {
  if (!adapter.key) throw new Error('explore needs adapter.key(state)');
  const rng = createRng('explore');
  const start = adapter.create({ level, seed: 'explore', rng });
  const ids = new Map([[adapter.key(start), 0]]);
  const states = [start];
  const status = [adapter.status(start)];
  const depth = [0];
  const children = [[]];
  let complete = true;
  let shortestWin = status[0] === 'won' ? 0 : null;

  for (let head = 0; head < states.length; head++) {
    const state = states[head];
    states[head] = null; // free memory as we go
    if (status[head] !== 'playing') continue;
    const actions = adapter.actions(state) || [];
    for (const action of actions) {
      const next = adapter.step(adapter.clone(state), action, rng);
      const k = adapter.key(next);
      let id = ids.get(k);
      if (id === undefined) {
        if (ids.size >= maxStates) { complete = false; continue; }
        id = ids.size;
        ids.set(k, id);
        states.push(next);
        const s = adapter.status(next);
        status.push(s);
        depth.push(depth[head] + 1);
        children.push([]);
        if (s === 'won' && shortestWin === null) shortestWin = depth[id];
      }
      children[head].push(id);
    }
  }

  const n = status.length;
  const result = {
    complete,
    states: n,
    solvable: shortestWin !== null ? true : (complete ? false : null),
    shortestWin,
    deadEnds: null,
    deadEndShare: null,
    traps: null,
    trapShare: null,
    startMoves: null,
    startTraps: null,
  };
  if (!complete) return result;

  // Which positions can still reach a win? Walk the graph backwards.
  const parents = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (const c of children[i]) parents[c].push(i);
  const alive = new Uint8Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) if (status[i] === 'won') { alive[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    for (const p of parents[i]) if (!alive[p]) { alive[p] = 1; stack.push(p); }
  }
  let playing = 0;
  let dead = 0;
  let moves = 0;
  let traps = 0;
  for (let i = 0; i < n; i++) {
    if (status[i] !== 'playing') continue;
    playing += 1;
    if (!alive[i]) { dead += 1; continue; }
    for (const c of children[i]) {
      moves += 1;
      if (!alive[c]) traps += 1;
    }
  }
  result.deadEnds = dead;
  result.deadEndShare = playing ? dead / playing : 0;
  result.traps = traps;
  result.trapShare = moves ? traps / moves : 0;
  result.startMoves = status[0] === 'playing' ? children[0].length : 0;
  result.startTraps = status[0] === 'playing' ? children[0].filter((c) => !alive[c]).length : 0;
  return result;
}
