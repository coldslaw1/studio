// Needs: numbers from 0 (satisfied) to 1 (desperate) that climb with game time and fall while the
// agent does the right activity. Everything is a straight line over time, so one big step (an agent
// far away, or one waking up after an hour) lands on the same value as many small ones.
import { need, clamp, q, sortedKeys } from './util.js';

/**
 * NEEDS -> the built-in needs. Rates are per GAME HOUR.
 *   rate     how fast the need grows
 *   relief   { activity: how fast it falls while doing that activity }
 *   urgent   above this the agent drops its schedule to deal with it
 *   activity / place   what to do about it and where (a name from the agent's places)
 */
export const NEEDS = {
  hunger: { rate: 0.06, relief: { eat: 2, drink: 0.5 }, urgent: 0.8, activity: 'eat', place: 'home' },
  rest: { rate: 0.055, relief: { sleep: 0.14, rest: 0.05 }, urgent: 0.9, activity: 'sleep', place: 'home' },
  social: { rate: 0.035, relief: { chat: 1.2, drink: 0.6, trade: 0.3, talk: 1.2 }, urgent: 0.9, activity: 'chat', place: 'inn' },
};

/** checkNeeds(defs, where) -> defs. Throws on a malformed need definition. */
export function checkNeeds(defs, where = 'checkNeeds') {
  for (const name of sortedKeys(defs)) {
    const d = defs[name];
    need(d && d.rate >= 0, `${where}: need "${name}" must have rate >= 0 (per game hour), got ${JSON.stringify(d)}`);
    need(typeof d.activity === 'string' && typeof d.place === 'string', `${where}: need "${name}" must name an activity and a place`);
    for (const a of sortedKeys(d.relief || {})) need(d.relief[a] >= 0, `${where}: need "${name}" relief "${a}" must be >= 0`);
  }
  return defs;
}

/**
 * stepNeeds(defs, needs, hours, activity) changes `needs` (a plain { name: 0..1 } object) in place for
 * `hours` game hours spent doing `activity` (or null), and returns it. Needs the agent does not have are skipped.
 */
export function stepNeeds(defs, needs, hours, activity = null) {
  for (const name of sortedKeys(needs)) {
    const d = defs[name];
    if (!d) continue;
    const relief = activity && d.relief ? d.relief[activity] || 0 : 0;
    needs[name] = q(clamp(needs[name] + (relief > 0 ? -relief : d.rate) * hours, 0, 1));
  }
  return needs;
}

/** mostUrgent(defs, needs) -> { name, value, urgent } for the highest need (ties: first by name), or null with no needs. */
export function mostUrgent(defs, needs) {
  let best = null;
  for (const name of sortedKeys(needs)) {
    if (!defs[name]) continue;
    if (!best || needs[name] > best.value) best = { name, value: needs[name], urgent: needs[name] >= (defs[name].urgent ?? 0.8) };
  }
  return best;
}
