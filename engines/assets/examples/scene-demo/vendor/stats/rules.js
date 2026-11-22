// Rules: the definitions a game gives createStats (stats, resources, effects, levels, templates),
// checked once at start so a typo fails with a clear message instead of a NaN in the middle of a fight.
import { STATS, RESOURCES, EFFECTS, LEVELS } from './defaults.js';
import { buildCurve } from './curve.js';
import { need, own, isObject, names } from './util.js';

const fin = (n) => typeof n === 'number' && Number.isFinite(n);
function layer(builtin, extra, on) {
  const out = on ? { ...builtin } : {};
  for (const [id, def] of Object.entries(extra ?? {})) { if (def === null) delete out[id]; else out[id] = def; }
  return out;
}

function checkStat(id, raw) {
  const where = `createStats: stat "${id}"`;
  need(isObject(raw), `${where} must be an object like { base: 5 }, got ${JSON.stringify(raw)}`);
  const s = { id, label: raw.label ?? id, base: raw.base ?? 0, per: { ...(raw.per ?? {}) }, perLevel: raw.perLevel ?? 0, min: raw.min ?? -Infinity, max: raw.max ?? Infinity, round: raw.round ?? null, attribute: raw.attribute === true };
  need(fin(s.base) && fin(s.perLevel), `${where}: base and perLevel must be numbers, got ${raw.base}, ${raw.perLevel}`);
  need(s.min <= s.max, `${where}: min ${s.min} is above max ${s.max}`);
  need([null, 'floor', 'round', 'ceil'].includes(s.round), `${where}: round must be 'floor', 'round' or 'ceil', got ${JSON.stringify(raw.round)}`);
  for (const [k, v] of Object.entries(s.per)) need(fin(v), `${where}: per.${k} must be a number, got ${JSON.stringify(v)}`);
  need(!(s.attribute && Object.keys(s.per).length), `${where}: an attribute cannot be worked out from other stats (remove "per" or "attribute")`);
  return s;
}

/** Stats in an order where every stat comes after the stats it is worked out from. Throws on a circle. */
function sortStats(stats) {
  const order = []; const state = {};
  const visit = (id, trail) => {
    if (state[id] === 2) return;
    need(state[id] !== 1, `createStats: stats are worked out from each other in a circle: ${[...trail, id].join(' -> ')}`);
    state[id] = 1;
    for (const dep of Object.keys(stats[id].per)) {
      need(own(stats, dep), `createStats: stat "${id}" is worked out from "${dep}", which is not a stat (stats: ${names(stats)})`);
      visit(dep, [...trail, id]);
    }
    state[id] = 2; order.push(id);
  };
  for (const id of Object.keys(stats)) visit(id, []);
  return order;
}

function checkResource(id, raw, stats) {
  const where = `createStats: resource "${id}"`;
  need(isObject(raw), `${where} must be an object like { max: 'maxHp' }, got ${JSON.stringify(raw)}`);
  const r = { id, label: raw.label ?? id, max: raw.max, regen: raw.regen ?? 0, regenDelay: raw.regenDelay ?? 0, start: raw.start ?? 'full', whole: raw.whole !== false };
  for (const key of ['max', 'regen']) {
    const v = r[key];
    need(fin(v) || (typeof v === 'string' && own(stats, v)), `${where}: ${key} must be a number or the name of a stat, got ${JSON.stringify(v)} (stats: ${names(stats)})`);
  }
  need(fin(r.regenDelay) && r.regenDelay >= 0, `${where}: regenDelay must be seconds >= 0, got ${raw.regenDelay}`);
  need(r.start === 'full' || r.start === 'empty' || (fin(r.start) && r.start >= 0), `${where}: start must be 'full', 'empty' or a number >= 0, got ${JSON.stringify(raw.start)}`);
  return r;
}

/** checkMods(list, stats, where) -> clean modifier list [{ stat, add, inc, mult }]. */
export function checkMods(list, stats, where) {
  need(Array.isArray(list), `${where}: mods must be a list like [{ stat: 'attack', add: 2 }], got ${JSON.stringify(list)}`);
  return list.map((m, i) => {
    need(isObject(m) && typeof m.stat === 'string', `${where}: mods[${i}] needs a stat name, got ${JSON.stringify(m)}`);
    need(own(stats, m.stat), `${where}: mods[${i}] changes "${m.stat}", which is not a stat (stats: ${names(stats)})`);
    const out = { stat: m.stat };
    for (const key of ['add', 'inc', 'mult']) if (m[key] !== undefined) { need(fin(m[key]), `${where}: mods[${i}].${key} must be a number, got ${JSON.stringify(m[key])}`); out[key] = m[key]; }
    need(out.mult === undefined || out.mult >= 0, `${where}: mods[${i}].mult must be >= 0, got ${out.mult}`);
    need(Object.keys(out).length > 1, `${where}: mods[${i}] needs add, inc or mult`);
    return out;
  });
}

function checkEffect(id, raw, stats, resources) {
  const where = `createStats: effect "${id}"`;
  need(isObject(raw), `${where} must be an object, got ${JSON.stringify(raw)}`);
  const e = { id, name: raw.name ?? id, kind: raw.kind ?? 'buff', duration: raw.duration ?? 0, mods: checkMods(raw.mods ?? [], stats, where), every: raw.every ?? 0, change: { ...(raw.change ?? {}) }, stacking: raw.stacking ?? 'refresh', maxStacks: raw.maxStacks ?? 1, tags: [...(raw.tags ?? [])], icon: raw.icon ?? null };
  need(['buff', 'debuff'].includes(e.kind), `${where}: kind must be 'buff' or 'debuff', got ${JSON.stringify(raw.kind)}`);
  need(fin(e.duration) && e.duration >= 0, `${where}: duration must be seconds >= 0 (0 = until removed), got ${JSON.stringify(raw.duration)}`);
  need(['refresh', 'stack', 'extend'].includes(e.stacking), `${where}: stacking must be 'refresh', 'stack' or 'extend', got ${JSON.stringify(raw.stacking)}`);
  need(Number.isInteger(e.maxStacks) && e.maxStacks >= 1, `${where}: maxStacks must be a whole number >= 1, got ${raw.maxStacks}`);
  need(fin(e.every) && e.every >= 0, `${where}: every must be seconds >= 0, got ${raw.every}`);
  const changes = Object.entries(e.change);
  need(changes.length === 0 || e.every > 0, `${where}: "change" needs "every" (seconds between ticks)`);
  for (const [res, n] of changes) need(own(resources, res) && fin(n), `${where}: change.${res} must be a number for a resource (resources: ${names(resources)}), got ${JSON.stringify(n)}`);
  need(Array.isArray(e.tags) && e.tags.every((t) => typeof t === 'string'), `${where}: tags must be a list of strings`);
  return e;
}

function checkLevels(raw, stats, resources) {
  const l = { ...LEVELS, ...(raw ?? {}) };
  const { totals, maxLevel } = buildCurve(l.curve, l.maxLevel);
  need(Number.isInteger(l.pointsPerLevel) && l.pointsPerLevel >= 0, `createStats: levels.pointsPerLevel must be a whole number >= 0, got ${l.pointsPerLevel}`);
  const refill = l.refill === true ? Object.keys(resources) : l.refill === false || l.refill == null ? [] : l.refill;
  need(Array.isArray(refill) && refill.every((r) => own(resources, r)), `createStats: levels.refill must be true, false or a list of resources (${names(resources)}), got ${JSON.stringify(l.refill)}`);
  const gainStat = l.gainStat && own(stats, l.gainStat) ? l.gainStat : null;
  need(!raw?.gainStat || gainStat, `createStats: levels.gainStat "${raw?.gainStat}" is not a stat`);
  const unlocks = {};
  for (const [level, list] of Object.entries(l.unlocks ?? {})) {
    need(Number.isInteger(Number(level)) && Number(level) >= 1 && Array.isArray(list) && list.every((u) => typeof u === 'string'), `createStats: levels.unlocks must look like { 3: ['dash'] }, got ${JSON.stringify(level)}: ${JSON.stringify(list)}`);
    unlocks[Number(level)] = [...list];
  }
  return { totals, maxLevel, pointsPerLevel: l.pointsPerLevel, refill, gainStat, unlocks };
}

function checkTemplate(id, raw, rules) {
  const where = `createStats: template "${id}"`;
  need(isObject(raw), `${where} must be an object, got ${JSON.stringify(raw)}`);
  const t = { id, level: raw.level ?? 1, base: { ...(raw.base ?? {}) }, xpReward: raw.xpReward ?? 0, loot: raw.loot ?? null, immune: [...(raw.immune ?? [])], tags: [...(raw.tags ?? [])] };
  need(Number.isInteger(t.level) && t.level >= 1 && t.level <= rules.levels.maxLevel, `${where}: level must be from 1 to ${rules.levels.maxLevel}, got ${raw.level}`);
  for (const [stat, v] of Object.entries(t.base)) need(own(rules.stats, stat) && fin(v), `${where}: base.${stat} must be a number for a stat (stats: ${names(rules.stats)}), got ${JSON.stringify(v)}`);
  need(fin(t.xpReward) && t.xpReward >= 0, `${where}: xpReward (XP for defeating it) must be >= 0, got ${raw.xpReward}`);
  for (const key of Object.keys(raw)) need(['level', 'base', 'xpReward', 'loot', 'immune', 'tags'].includes(key), `${where}: unknown field "${key}" (fields: level, base, xpReward, loot, immune, tags)`);
  need(t.loot === null || typeof t.loot === 'string', `${where}: loot must be the name of a loot table`);
  return t;
}

/**
 * buildRules(options) -> rules   the checked definitions createStats works from.
 * options: { builtins = true, stats, resources, effects, levels, templates }
 * rules: { stats, order, attributes, resources, effects, levels, templates }
 */
export function buildRules(options = {}) {
  const on = options.builtins !== false;
  const stats = {};
  for (const [id, raw] of Object.entries(layer(STATS, options.stats, on))) stats[id] = checkStat(id, raw);
  const resources = {};
  const rawRes = layer(RESOURCES, options.resources, on);
  for (const [id, raw] of Object.entries(rawRes)) {
    // a built-in resource whose stats were removed goes with them
    if (on && !own(options.resources ?? {}, id) && [raw.max, raw.regen].some((v) => typeof v === 'string' && !own(stats, v))) continue;
    need(!own(stats, id), `createStats: "${id}" is both a stat and a resource; give them different names (for example maxHp and hp)`);
    resources[id] = checkResource(id, raw, stats);
  }
  const effects = {};
  for (const [id, raw] of Object.entries(layer(EFFECTS, options.effects, on))) {
    if (on && !own(options.effects ?? {}, id)) { // a built-in effect for stats or resources this game removed goes with them
      if ((raw.mods ?? []).some((m) => !own(stats, m.stat)) || Object.keys(raw.change ?? {}).some((r) => !own(resources, r))) continue;
    }
    effects[id] = checkEffect(id, raw, stats, resources);
  }
  const rules = { stats, order: sortStats(stats), attributes: Object.keys(stats).filter((id) => stats[id].attribute), resources, effects, levels: null, templates: {} };
  rules.levels = checkLevels(on ? options.levels : { gainStat: null, ...(options.levels ?? {}) }, stats, resources);
  for (const [id, raw] of Object.entries(options.templates ?? {})) rules.templates[id] = checkTemplate(id, raw, rules);
  return rules;
}
