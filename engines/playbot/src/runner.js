// Plays episodes. One episode = one bot playing one level once, from a seed.
import { createRng } from './rng.js';

/**
 * runEpisode(adapter, bot, { level, seed, maxSteps }) -> result
 *   result = {
 *     outcome:  'won' | 'lost' | 'timeout'   (timeout = still playing at maxSteps;
 *                                              for an endless game that means "survived"),
 *     steps:    decisions made,
 *     progress: best progress reached, 0..1 (null when the adapter has no progress()),
 *     cause:    why it was lost (adapter.cause), or null,
 *     score:    adapter.score at the end, or null,
 *   }
 * The same adapter + bot spec + level + seed always gives the same result.
 */
export function runEpisode(adapter, bot, { level, seed, maxSteps }) {
  const limit = maxSteps ?? adapter.maxSteps;
  const envRng = createRng(`${seed}|env`);
  const botRng = createRng(`${seed}|bot|${bot.name}`);
  const ctx = { adapter, rng: botRng, level, memory: {} };
  let state = adapter.create({ level, seed, rng: envRng });
  let status = adapter.status(state);
  let steps = 0;
  let peak = adapter.progress ? adapter.progress(state) : null;
  let cause = null;

  while (status === 'playing' && steps < limit) {
    const actions = adapter.actions(state);
    if (!actions || actions.length === 0) {
      status = 'lost';
      cause = 'no action available';
      break;
    }
    state = adapter.step(state, bot.pick(state, actions, ctx), envRng);
    steps += 1;
    status = adapter.status(state);
    if (adapter.progress) {
      const p = adapter.progress(state);
      if (p > peak) peak = p;
    }
  }

  if (status === 'lost' && cause === null && adapter.cause) {
    cause = adapter.cause(state) ?? null;
  }
  return {
    outcome: status === 'playing' ? 'timeout' : status,
    steps,
    progress: peak,
    cause,
    score: adapter.score ? adapter.score(state) : null,
  };
}

/** Seed of run number i. The same for every bot, so bots face the same luck. */
export function runSeed(baseSeed, levelId, i) {
  return `${baseSeed}|${levelId}|${i}`;
}

/** runMany(adapter, bot, { level, baseSeed, from, to, maxSteps }) -> result[] */
export function runMany(adapter, bot, { level, baseSeed, from, to, maxSteps }) {
  const out = [];
  for (let i = from; i < to; i++) {
    out.push(runEpisode(adapter, bot, { level, seed: runSeed(baseSeed, level, i), maxSteps }));
  }
  return out;
}
