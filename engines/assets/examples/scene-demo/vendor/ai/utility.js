// Utility AI: every goal an agent could follow gets a score from 0 to 1, and the best one wins.
// A score is the product of "considerations": an input (how hungry, how hurt, how close the enemy)
// passed through a response curve. Goals are plain data, so a game can add or re-weight them.
import { need, clamp } from './util.js';

const CURVES = {
  /** y = m * x + b */
  linear: (x, c) => (c.m ?? 1) * x + (c.b ?? 0),
  /** y = x ^ k (k above 1: only matters when high; below 1: matters early) */
  power: (x, c) => Math.pow(x, c.k ?? 2),
  /** 1 - x */
  inverse: (x) => 1 - x,
  /** an S shape: near 0 below `mid`, near 1 above it; k = steepness */
  logistic: (x, c) => 1 / (1 + Math.exp(-(c.k ?? 10) * (x - (c.mid ?? 0.5)))),
  /** 0 below `at`, 1 from `at` up */
  step: (x, c) => (x >= (c.at ?? 0.5) ? 1 : 0),
  /** 1 at `mid`, falling to 0 `width` away on both sides */
  bell: (x, c) => Math.max(0, 1 - Math.abs(x - (c.mid ?? 0.5)) / (c.width ?? 0.5)),
};

/** CURVE_TYPES -> the names of the built-in response curves. */
export const CURVE_TYPES = Object.keys(CURVES);

/**
 * curve(x, shape) -> 0..1. shape is a curve name ('linear', 'inverse', 'power', 'logistic', 'step',
 * 'bell') or { type, ...numbers } (linear: m, b; power: k; logistic: k, mid; step: at; bell: mid, width).
 */
export function curve(x, shape = 'linear') {
  const c = typeof shape === 'string' ? { type: shape } : shape;
  const fn = CURVES[c.type];
  need(fn, `curve: unknown curve type "${String(c.type)}". Known: ${CURVE_TYPES.join(', ')}`);
  return clamp(fn(clamp(x, 0, 1), c), 0, 1);
}

/**
 * checkGoals(goals, inputs, where) -> goals. Throws when a goal is malformed or names an unknown input,
 * so mistakes show up when the brain is registered and not in the middle of play.
 * A goal: { id, weight = 1, when: [consideration, ...], tree }
 * A consideration: 'inputName' or { input, curve = 'linear', ...args for the input }
 */
export function checkGoals(goals, inputs, where = 'checkGoals') {
  need(Array.isArray(goals) && goals.length > 0, `${where}: goals must be a non-empty list`);
  const seen = new Set();
  for (const g of goals) {
    need(g && typeof g.id === 'string' && g.id, `${where}: every goal needs an id, got ${JSON.stringify(g)}`);
    need(!seen.has(g.id), `${where}: two goals are called "${g.id}"`);
    seen.add(g.id);
    need(g.weight === undefined || g.weight >= 0, `${where}: goal "${g.id}" weight must be >= 0, got ${String(g.weight)}`);
    for (const c of g.when || []) {
      const name = typeof c === 'string' ? c : c && c.input;
      need(typeof name === 'string' && inputs[name], `${where}: goal "${g.id}" uses the unknown input "${String(name)}". Known: ${Object.keys(inputs).sort().join(', ')}`);
      if (typeof c === 'object' && c.curve !== undefined) curve(0, c.curve);
    }
  }
  return goals;
}

/**
 * scoreGoal(goal, read) -> 0..weight. read(name, consideration) returns the input's value (0..1).
 * With several considerations the product is nudged up a little (the usual "compensation"), so a goal
 * with five reasons is not punished against a goal with one.
 */
export function scoreGoal(goal, read) {
  const list = goal.when || [];
  let score = 1;
  for (const c of list) {
    const isName = typeof c === 'string';
    const v = curve(read(isName ? c : c.input, isName ? null : c), isName ? 'linear' : c.curve ?? 'linear');
    if (v <= 0) return 0;
    score *= v;
  }
  if (list.length > 1) {
    const mod = 1 - 1 / list.length;
    score += (1 - score) * mod * score;
  }
  return score * (goal.weight ?? 1);
}

/**
 * pickGoal(goals, read, current, inertia = 0.1) -> { id, score, scores }. The running goal gets `inertia`
 * added so agents do not flip-flop between two near-equal goals. Ties go to the goal listed first.
 */
export function pickGoal(goals, read, current = null, inertia = 0.1) {
  let best = null; let bestScore = -1;
  const scores = {};
  for (const g of goals) {
    const raw = scoreGoal(g, read);
    scores[g.id] = raw;
    const s = raw > 0 && g.id === current ? raw + inertia : raw;
    if (s > bestScore) { bestScore = s; best = g.id; }
  }
  return { id: best, score: bestScore, scores };
}
