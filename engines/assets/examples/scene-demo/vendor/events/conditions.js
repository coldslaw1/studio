// Conditions: the `if` of a trigger or of an "if" step. Data objects, never code strings, and the
// same shapes as the dialogue engine's conditions (var, quest, objectiveDone, visited, all, any,
// not) plus five of this engine's own (hour, part, inside, fired, scene).
import { COMPARES } from './spec.js';

const COMPARE = {
  eq: (a, b) => a === b, ne: (a, b) => a !== b,
  gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b,
};

/** True when `hour` lies in from..to, where the range may run over midnight (from 20 to 5). */
export function hourInRange(hour, from, to) {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/**
 * checkCondition(condition, env) -> boolean
 * env: { getVar(name), story (dialogue story or null), hour(), part(), inside(place, who, reach), fired(triggerId), player }
 * A quest condition without a story is false. An hour condition without a clock is false.
 */
export function checkCondition(c, env) {
  if (!c || typeof c !== 'object') throw new Error(`events.check: a condition is an object, got ${JSON.stringify(c)}`);
  if ('all' in c) return c.all.every((sub) => checkCondition(sub, env));
  if ('any' in c) return c.any.some((sub) => checkCondition(sub, env));
  if ('not' in c) return !checkCondition(c.not, env);
  if ('var' in c) {
    const value = env.getVar(c.var);
    const op = COMPARES.find((k) => k in c);
    return op ? COMPARE[op](value, c[op]) : Boolean(value);
  }
  if ('quest' in c || 'objectiveDone' in c || 'visited' in c) return env.story ? env.story.check(c) : false;
  if ('hour' in c) { const h = env.hour(); return h === null ? false : hourInRange(h, c.hour.from, c.hour.to); }
  if ('part' in c) return env.part() === c.part;
  if ('inside' in c) return env.inside(c.inside, c.who ?? env.player, c.reach);
  if ('fired' in c) return env.fired(c.fired);
  if ('scene' in c) return env.scene() === c.scene;
  throw new Error(`events.check: unknown condition ${JSON.stringify(c)}`);
}
