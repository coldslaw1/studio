// Generate-and-prove: build a random candidate, solve it, keep it only when the
// solver finds a win (and your own accept() rule agrees). Everything is driven
// by the seed, so the same seed always gives the same level.
import { createRng } from './rng.js';

/**
 * generate(options) -> { level, solution, seed, attempt, rejected }
 *
 * options = {
 *   seed,                       string or number
 *   build(rng, info),           returns a candidate level (any value), or null to skip.
 *                               Use ONLY rng for randomness. info = { attempt, index, count, progress }
 *   solve(level),               returns a solver result ({ solved, path, ... }), normally by
 *                               calling solve() from solver.js on the level's puzzle
 *   accept(level, solution, info), optional extra rule, e.g. (l, s) => s.steps >= 8.
 *                               Only called for levels that ARE solved.
 *   maxAttempts,                optional, default 200
 *   info,                       optional extra fields merged into info (used by generatePack)
 * }
 *
 * Returns the first candidate that is solved and accepted:
 *   level     what build() returned
 *   solution  what solve() returned (solution.path is a winning list of actions)
 *   attempt   which attempt succeeded (0 = first try)
 *   rejected  { unsolvable, gaveUp, notAccepted, skipped } counts of failed attempts
 * Throws an Error when maxAttempts candidates all fail. The message lists why,
 * which tells you whether to loosen build() or accept().
 */
export function generate(options) {
  const { seed = 0, build, solve, accept, maxAttempts = 200, info: extra = {} } = options;
  if (typeof build !== 'function' || typeof solve !== 'function') {
    throw new Error('generate: options need build(rng, info) and solve(level)');
  }
  const rejected = { unsolvable: 0, gaveUp: 0, notAccepted: 0, skipped: 0 };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const info = { index: 0, count: 1, progress: 0, ...extra, attempt };
    const level = build(createRng(`${seed}#${attempt}`), info);
    if (level === null || level === undefined) { rejected.skipped++; continue; }
    const solution = solve(level);
    if (!solution || !solution.solved) {
      if (solution && solution.gaveUp) rejected.gaveUp++; else rejected.unsolvable++;
      continue;
    }
    if (accept && !accept(level, solution, info)) { rejected.notAccepted++; continue; }
    return { level, solution, seed, attempt, rejected };
  }
  throw new Error(
    `generate: no level for seed "${seed}" in ${maxAttempts} attempts ` +
    `(unsolvable ${rejected.unsolvable}, solver gave up ${rejected.gaveUp}, ` +
    `not accepted ${rejected.notAccepted}, skipped ${rejected.skipped})`,
  );
}

/**
 * generatePack(options) -> array of `count` results from generate(), in order.
 *
 * Takes the same options as generate(), plus:
 *   count        how many levels
 *   levelKey     optional (level) -> string, used to refuse duplicate levels.
 *                Default: JSON.stringify(level)
 *
 * build() and accept() receive info.index (0..count-1), info.count and
 * info.progress (0 for the first level, 1 for the last). Use progress to make
 * later levels bigger or harder:
 *   const size = 5 + Math.round(info.progress * 4);
 */
export function generatePack(options) {
  const { seed = 0, count, levelKey = JSON.stringify, accept } = options;
  if (!Number.isInteger(count) || count < 1) throw new Error('generatePack: count must be a positive integer');
  const seenLevels = new Set();
  const pack = [];
  for (let index = 0; index < count; index++) {
    const progress = count === 1 ? 0 : index / (count - 1);
    const result = generate({
      ...options,
      seed: `${seed}/${index}`,
      info: { index, count, progress },
      accept: (level, solution, info) =>
        !seenLevels.has(levelKey(level)) && (!accept || accept(level, solution, info)),
    });
    seenLevels.add(levelKey(result.level));
    pack.push({ ...result, index });
  }
  return pack;
}
