// Bot players. None of them use a language model: they are small search and
// dice-rolling routines, so thousands of runs cost seconds of CPU and no GPU.
//
// A bot is { name, spec, pick(state, actions, ctx) -> action }
//   ctx = { adapter, rng, memory }   memory is a fresh {} for every run
// A bot spec is plain data so it can be written in an adapter or sent to a
// worker thread:
//   { name, type: 'random' }
//   { name, type: 'greedy',    mistakes: 0.2 }
//   { name, type: 'lookahead', rollouts: 6, depth: 12, mistakes: 0 }
// "mistakes" is the chance, per decision, of pressing a random button instead.
import { stateValue } from './adapter.js';

/** The default skill ladder, weakest first. */
export const DEFAULT_BOTS = [
  { name: 'masher', type: 'random' },
  { name: 'casual', type: 'greedy', mistakes: 0.2 },
  { name: 'careful', type: 'lookahead', rollouts: 6, depth: 12, mistakes: 0 },
];

const same = (a, b) => a === b || (a !== null && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));

// On a tie the bot keeps doing what it did last step (ctx.memory.last), like a
// person who keeps walking the same way until there is a reason to turn.
function pickBest(actions, values, ctx) {
  const { rng } = ctx;
  let best = -Infinity;
  let ties = [];
  for (let i = 0; i < actions.length; i++) {
    if (values[i] > best + 1e-12) {
      best = values[i];
      ties = [actions[i]];
    } else if (Math.abs(values[i] - best) <= 1e-12) {
      ties.push(actions[i]);
    }
  }
  if (ties.length === 1) return ties[0];
  const last = ctx.memory ? ctx.memory.last : undefined;
  if (last !== undefined) {
    const keep = ties.find((a) => same(a, last));
    if (keep !== undefined) return keep;
  }
  return rng.pick(ties);
}

function randomPick(state, actions, ctx) {
  return ctx.rng.pick(actions);
}

function greedyPick(state, actions, ctx) {
  const { adapter, rng } = ctx;
  const values = actions.map((action) => {
    const next = adapter.step(adapter.clone(state), action, rng.fork('g'));
    return stateValue(adapter, next);
  });
  return pickBest(actions, values, ctx);
}

function lookaheadPick(spec) {
  const rollouts = Math.max(1, spec.rollouts ?? 6);
  const depth = Math.max(1, spec.depth ?? 12);
  return (state, actions, ctx) => {
    const { adapter, rng } = ctx;
    const values = actions.map((action) => {
      const first = adapter.step(adapter.clone(state), action, rng.fork('l'));
      if (adapter.status(first) !== 'playing') return stateValue(adapter, first);
      const first0 = adapter.clone(first);
      let total = 0;
      for (let r = 0; r < rollouts; r++) {
        let sim = r === rollouts - 1 ? first : adapter.clone(first);
        let best = Math.max(0, Math.min(1, stateValue(adapter, sim)));
        let value = null;
        for (let d = 0; d < depth; d++) {
          const options = adapter.actions(sim);
          const stuck = !options || options.length === 0;
          if (!stuck) sim = adapter.step(sim, rng.pick(options), rng);
          const status = stuck ? 'lost' : adapter.status(sim);
          if (status === 'won') { value = 2; break; }
          if (status === 'lost') {
            // Dying later and after more progress is less bad than dying at once.
            value = -1 + 0.5 * ((d + 1) / (depth + 1)) + 0.25 * best;
            break;
          }
          best = Math.max(best, Math.min(1, stateValue(adapter, sim)));
        }
        total += value === null ? best : value;
      }
      // Half what the move gives right away, half what tends to follow from it.
      return 0.5 * Math.min(1, stateValue(adapter, first0)) + 0.5 * (total / rollouts);
    });
    return pickBest(actions, values, ctx);
  };
}

/** createBot(spec) -> bot. Throws on an unknown type. */
export function createBot(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('bot spec must be an object');
  let think;
  if (spec.type === 'random') think = randomPick;
  else if (spec.type === 'greedy') think = greedyPick;
  else if (spec.type === 'lookahead') think = lookaheadPick(spec);
  else throw new Error(`unknown bot type "${spec.type}" (use random, greedy or lookahead)`);
  const mistakes = Math.max(0, Math.min(1, spec.mistakes ?? 0));
  const name = spec.name || spec.type;
  return {
    name,
    spec: { ...spec, name },
    pick(state, actions, ctx) {
      let action;
      if (actions.length === 1) action = actions[0];
      else if (mistakes > 0 && ctx.rng.chance(mistakes)) action = ctx.rng.pick(actions);
      else action = think(state, actions, ctx);
      if (ctx.memory) ctx.memory.last = action;
      return action;
    },
  };
}
