// The stats state: plain JSON that holds every character sheet. Save it, send it, load it back.
// The rules (what a stat or an effect IS) are not in the state; it only holds ids and numbers.
import { need, own, isObject, clone, names } from './util.js';

export const STATE_VERSION = 1;

/** createStatsState() -> { kind: 'stats', v, time, sheets: {} }   an empty state. */
export function createStatsState() {
  return { kind: 'stats', v: STATE_VERSION, time: 0, sheets: {} };
}

/** isStatsState(value) -> true when it looks like a stats state. */
export function isStatsState(s) {
  return isObject(s) && s.kind === 'stats' && isObject(s.sheets) && typeof s.time === 'number';
}

/** newSheet(id, fields) -> a blank character sheet (the shape kept in state.sheets[id]). */
export function newSheet(id, fields = {}) {
  return { id, template: null, level: 1, xp: 0, points: 0, base: {}, spent: {}, res: {}, effects: [], mods: {}, immune: [], tags: [], unlocked: [], xpReward: 0, loot: null, ...fields };
}

/**
 * checkStatsState(data, rules) -> { state, problems }
 * Makes a loaded save safe to use with the current rules: things the rules no longer know (a stat
 * that was removed, an effect that was renamed) are dropped and listed in `problems`, never crashed on.
 * Throws only when `data` is not a stats state at all.
 */
export function checkStatsState(data, rules) {
  need(isStatsState(data), `stats.load: expected data made by stats.toJSON(), got ${JSON.stringify(data)?.slice(0, 80)}`);
  need(!(data.v > STATE_VERSION), `stats.load: this save is version ${data.v}, newer than this engine understands (${STATE_VERSION})`);
  const problems = [];
  const state = { kind: 'stats', v: STATE_VERSION, time: Number.isFinite(data.time) ? data.time : 0, sheets: {} };
  const num = (v, fallback, min = -Infinity) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback);
  for (const [id, raw] of Object.entries(data.sheets)) {
    if (!isObject(raw)) { problems.push(`sheet "${id}" is not an object and was dropped`); continue; }
    const s = newSheet(id);
    s.template = typeof raw.template === 'string' ? raw.template : null;
    if (s.template && !own(rules.templates, s.template)) problems.push(`sheet "${id}": template "${s.template}" no longer exists (kept its saved numbers)`);
    s.xp = Math.min(Math.floor(num(raw.xp, 0, 0)), rules.levels.totals[rules.levels.maxLevel]);
    s.level = Math.min(rules.levels.maxLevel, Math.floor(num(raw.level, 1, 1)));
    s.points = Math.floor(num(raw.points, 0, 0));
    s.xpReward = num(raw.xpReward, 0, 0);
    s.loot = typeof raw.loot === 'string' ? raw.loot : null;
    for (const key of ['immune', 'tags', 'unlocked']) s[key] = Array.isArray(raw[key]) ? raw[key].filter((t) => typeof t === 'string') : [];
    for (const key of ['base', 'spent']) {
      for (const [stat, v] of Object.entries(isObject(raw[key]) ? raw[key] : {})) {
        if (!own(rules.stats, stat) || !Number.isFinite(v)) { problems.push(`sheet "${id}": ${key}.${stat} is not a stat any more and was dropped`); continue; }
        s[key][stat] = v;
      }
    }
    for (const [res, r] of Object.entries(isObject(raw.res) ? raw.res : {})) {
      if (!own(rules.resources, res)) { problems.push(`sheet "${id}": resource "${res}" no longer exists and was dropped`); continue; }
      s.res[res] = { v: num(r?.v, 0, 0), frac: num(r?.frac, 0, -1), wait: num(r?.wait, 0, 0) };
    }
    for (const e of Array.isArray(raw.effects) ? raw.effects : []) {
      if (!isObject(e) || !own(rules.effects, e.id)) { problems.push(`sheet "${id}": effect "${e?.id}" no longer exists and was dropped`); continue; }
      s.effects.push({ id: e.id, stacks: Math.max(1, Math.min(rules.effects[e.id].maxStacks, Math.floor(num(e.stacks, 1, 1)))), left: e.left === null ? null : num(e.left, 0, 0), total: e.total === null ? null : num(e.total, 0, 0), tick: num(e.tick, 0, 0), source: typeof e.source === 'string' ? e.source : null });
    }
    for (const [source, list] of Object.entries(isObject(raw.mods) ? raw.mods : {})) {
      const kept = (Array.isArray(list) ? list : []).filter((m) => isObject(m) && own(rules.stats, m.stat));
      if (kept.length !== (Array.isArray(list) ? list.length : 0)) problems.push(`sheet "${id}": some "${source}" modifiers name stats that no longer exist and were dropped`);
      if (kept.length) s.mods[source] = clone(kept);
    }
    state.sheets[id] = s;
  }
  return { state, problems };
}

/** sheetOf(state, id, fn) -> the sheet, or throws naming the function and the known ids. */
export function sheetOf(state, id, fn) {
  const s = own(state.sheets, id) ? state.sheets[id] : null;
  need(s, `stats.${fn}: no character "${String(id)}" (have: ${names(state.sheets)}). Add one with stats.add(id, options)`);
  return s;
}
