// A general puzzle solver. You describe your game as three small functions and
// it searches every reachable position, breadth-first, so the path it returns is
// the SHORTEST possible win. Use it to prove a generated level can be beaten.

/**
 * solve(puzzle) -> result
 *
 * puzzle = {
 *   start,                  the starting state: any plain value (object, array, string)
 *   actions,                array of action names, e.g. ['U', 'R', 'D', 'L'],
 *                           OR a function (state) -> array of action names
 *   step(state, action),    returns the NEW state after the action, or null when
 *                           the action is not allowed. MUST NOT change `state`.
 *   isWon(state),           true when the state is a win
 *   isLost(state),          optional. true = stop searching past this state
 *   key(state),             optional. A string that is equal for equal states.
 *                           Default: JSON.stringify(state). Leave counters such
 *                           as "moves made" OUT of the key or nothing ever repeats.
 *   maxStates,              optional. Give up after this many states (default 200000)
 * }
 *
 * result = {
 *   solved,     true when a win was found
 *   path,       array of actions that wins ([] when the start is already won), or null
 *   steps,      path.length, or -1
 *   explored,   how many different states were looked at
 *   deadEnds,   states that were not a win and had no way forward (or were lost)
 *   gaveUp,     true when maxStates was hit. solved:false + gaveUp:false means
 *               the level is PROVEN impossible; gaveUp:true means "don't know".
 * }
 */
export function solve(puzzle) {
  const { start, actions, step, isWon, isLost, key = JSON.stringify, maxStates = 200000 } = puzzle;
  if (typeof step !== 'function' || typeof isWon !== 'function') {
    throw new Error('solve: puzzle needs step(state, action) and isWon(state)');
  }
  if (!Array.isArray(actions) && typeof actions !== 'function') {
    throw new Error('solve: puzzle.actions must be an array or a function');
  }
  const actionsFor = typeof actions === 'function' ? actions : () => actions;

  // Each node remembers how it was reached, so the path can be rebuilt at the end.
  const nodes = [{ state: start, parent: -1, action: null }];
  const seen = new Set([key(start)]);
  let deadEnds = 0;

  const finish = (winIndex, gaveUp) => {
    let path = null;
    if (winIndex !== -1) {
      path = [];
      for (let i = winIndex; nodes[i].parent !== -1; i = nodes[i].parent) path.push(nodes[i].action);
      path.reverse();
    }
    return {
      solved: path !== null,
      path,
      steps: path ? path.length : -1,
      explored: nodes.length,
      deadEnds,
      gaveUp,
    };
  };

  for (let head = 0; head < nodes.length; head++) {
    const { state } = nodes[head];
    if (isWon(state)) return finish(head, false);
    if (isLost && isLost(state)) { deadEnds++; continue; }
    let children = 0;
    for (const action of actionsFor(state)) {
      const next = step(state, action);
      if (next === null || next === undefined) continue;
      children++;
      const k = key(next);
      if (seen.has(k)) continue;
      if (nodes.length >= maxStates) return finish(-1, true);
      seen.add(k);
      nodes.push({ state: next, parent: head, action });
    }
    if (children === 0) deadEnds++;
  }
  return finish(-1, false);
}

/**
 * replay(puzzle, path) -> the state after doing every action in `path` from puzzle.start.
 * Throws when an action in the path is not allowed. Use it in tests:
 *   assert.ok(puzzle.isWon(replay(puzzle, result.path)))
 */
export function replay(puzzle, path) {
  let state = puzzle.start;
  [...path].forEach((action, i) => {
    const next = puzzle.step(state, action);
    if (next === null || next === undefined) {
      throw new Error(`replay: action ${i} ("${action}") is not allowed`);
    }
    state = next;
  });
  return state;
}
