// Daily schedules: where an NPC should be and what it should be doing at each hour of the game day.
// A schedule is plain data; the hour comes from the ai's clock, so nothing here keeps state.
import { need, sortedKeys } from './util.js';
import { hashInts } from './rng.js';

/**
 * SCHEDULES -> the built-in daily plans. Each entry: { from, to, activity, place }. Hours are 0..24 and
 * an entry may run past midnight (from 22 to 6). The first entry that covers the hour wins; hours no
 * entry covers use `rest` (default: idle at home).
 */
export const SCHEDULES = {
  villager: { entries: [
    { from: 22, to: 6, activity: 'sleep', place: 'home' }, { from: 6, to: 7, activity: 'eat', place: 'home' },
    { from: 7, to: 12, activity: 'work', place: 'work' }, { from: 12, to: 13, activity: 'eat', place: 'home' },
    { from: 13, to: 18, activity: 'work', place: 'work' }, { from: 18, to: 22, activity: 'drink', place: 'inn' }] },
  farmer: { entries: [
    { from: 21, to: 5, activity: 'sleep', place: 'home' }, { from: 5, to: 6, activity: 'eat', place: 'home' },
    { from: 6, to: 12, activity: 'work', place: 'work' }, { from: 12, to: 13, activity: 'eat', place: 'home' },
    { from: 13, to: 19, activity: 'work', place: 'work' }, { from: 19, to: 21, activity: 'chat', place: 'inn' }] },
  merchant: { entries: [
    { from: 22, to: 7, activity: 'sleep', place: 'home' }, { from: 7, to: 8, activity: 'eat', place: 'home' },
    { from: 8, to: 18, activity: 'trade', place: 'work' }, { from: 18, to: 22, activity: 'drink', place: 'inn' }] },
  innkeeper: { entries: [
    { from: 2, to: 9, activity: 'sleep', place: 'home' }, { from: 9, to: 10, activity: 'eat', place: 'home' },
    { from: 10, to: 2, activity: 'trade', place: 'inn' }] },
  guard: { entries: [
    { from: 6, to: 20, activity: 'patrol', place: 'post' }, { from: 20, to: 21, activity: 'eat', place: 'inn' },
    { from: 21, to: 5, activity: 'sleep', place: 'home' }, { from: 5, to: 6, activity: 'eat', place: 'home' }] },
  nightwatch: { entries: [
    { from: 19, to: 7, activity: 'patrol', place: 'post' }, { from: 7, to: 8, activity: 'eat', place: 'inn' },
    { from: 8, to: 16, activity: 'sleep', place: 'home' }, { from: 16, to: 19, activity: 'chat', place: 'inn' }] },
};

const REST = { activity: 'idle', place: 'home' };

/** checkSchedules(defs, where) -> defs. Throws on a malformed schedule. */
export function checkSchedules(defs, where = 'checkSchedules') {
  for (const name of sortedKeys(defs)) {
    const s = defs[name];
    need(s && Array.isArray(s.entries), `${where}: schedule "${name}" must be { entries: [...] }`);
    for (const e of s.entries) {
      need(e && e.from >= 0 && e.from <= 24 && e.to >= 0 && e.to <= 24, `${where}: schedule "${name}" entry needs from and to in 0..24, got ${JSON.stringify(e)}`);
      need(typeof e.activity === 'string' && typeof e.place === 'string', `${where}: schedule "${name}" entry needs an activity and a place, got ${JSON.stringify(e)}`);
    }
  }
  return defs;
}

const covers = (e, h) => (e.from <= e.to ? h >= e.from && h < e.to : h >= e.from || h < e.to);

/**
 * scheduleAt(schedule, hour) -> { activity, place, from, to } for an hour of the day (0..24, wraps).
 */
export function scheduleAt(schedule, hour) {
  const h = ((hour % 24) + 24) % 24;
  for (const e of schedule.entries) if (covers(e, h)) return e;
  return schedule.rest || REST;
}

/**
 * hourOffset(seed, spread) -> a fixed shift in hours (-spread..spread) for one agent, so a village does
 * not get up and walk to work on the same tick. Pass the agent's seed.
 */
export function hourOffset(seed, spread = 0.4) {
  return (hashInts(seed, 7919) / 4294967296 * 2 - 1) * spread;
}

/** hourOfDay(time, dayLength, startHour = 8) -> 0..24 for a time in seconds and a game day of dayLength seconds. */
export function hourOfDay(time, dayLength, startHour = 8) {
  const h = (time / dayLength * 24 + startHour) % 24;
  return h < 0 ? h + 24 : h;
}
