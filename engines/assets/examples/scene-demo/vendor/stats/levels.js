// Experience and levels: XP adds up, levels follow the curve, every level gives attribute points,
// refills resources and may unlock named things (skills, recipes, areas: the game decides what a name means).
import { need, own, names } from './util.js';
import { levelForXp } from './curve.js';
import { changeResource, maxOf } from './resources.js';

function unlock(sim, sheet, level, list) {
  for (const name of list) {
    if (sheet.unlocked.includes(name)) continue;
    sheet.unlocked.push(name);
    sim.emit({ type: 'unlock', id: sheet.id, name, level });
  }
}

/** raiseTo(sim, sheet, level) walks the sheet up to `level`, one level at a time, with points, unlocks and events. */
function raiseTo(sim, sheet, level) {
  const L = sim.rules.levels; const from = sheet.level;
  while (sheet.level < level) {
    const previous = sheet.level;
    sheet.level += 1; sheet.points += L.pointsPerLevel;
    const unlocked = (L.unlocks[sheet.level] ?? []).filter((n) => !sheet.unlocked.includes(n));
    sim.touch(sheet, 'level');
    sim.emit({ type: 'levelup', id: sheet.id, level: sheet.level, previous, points: sheet.points, unlocked });
    unlock(sim, sheet, sheet.level, unlocked);
  }
  if (sheet.level > from) for (const res of L.refill) changeResource(sim, sheet, res, maxOf(sim, sheet, res), 'levelup');
  return sheet.level - from;
}

/**
 * addXp(sim, sheet, amount, { source, raw }) -> { gained, level, levels }
 * `gained` is what was really added (after the XP gain stat, unless raw: true, and the top-level cap).
 */
export function addXp(sim, sheet, amount, o = {}) {
  need(Number.isFinite(amount) && amount >= 0, `stats.addXp: amount must be a number >= 0, got ${amount}`);
  const L = sim.rules.levels;
  const scale = o.raw || !L.gainStat ? 1 : sim.values(sheet)[L.gainStat];
  const cap = L.totals[L.maxLevel];
  const gained = Math.min(cap - sheet.xp, Math.round(amount * scale));
  if (gained <= 0) return { gained: 0, level: sheet.level, levels: 0 };
  sheet.xp += gained;
  sim.emit({ type: 'xp', id: sheet.id, amount: gained, xp: sheet.xp, source: o.source ?? null });
  const levels = raiseTo(sim, sheet, levelForXp(L.totals, L.maxLevel, sheet.xp));
  return { gained, level: sheet.level, levels };
}

/** setLevel(sim, sheet, level) puts a sheet at the start of a level (set-up, cheats, tests). Going down takes the points back. */
export function setLevel(sim, sheet, level) {
  const L = sim.rules.levels;
  need(Number.isInteger(level) && level >= 1 && level <= L.maxLevel, `stats.setLevel: level must be from 1 to ${L.maxLevel}, got ${level}`);
  if (level >= sheet.level) { sheet.xp = Math.max(sheet.xp, L.totals[level]); raiseTo(sim, sheet, level); return; }
  sheet.level = level; sheet.xp = L.totals[level];
  sheet.spent = {}; sheet.points = (level - 1) * L.pointsPerLevel;
  sheet.unlocked = sheet.unlocked.filter((n) => !Object.entries(L.unlocks).some(([at, list]) => Number(at) > level && list.includes(n)));
  sim.touch(sheet, 'level');
}

/** spendPoint(sim, sheet, stat, n) -> { ok: true, value, points } or { ok: false, reason: 'no-points' | 'max' }. */
export function spendPoint(sim, sheet, stat, n = 1) {
  const def = own(sim.rules.stats, stat) ? sim.rules.stats[stat] : null;
  need(def, `stats.spendPoint: no stat "${String(stat)}" (attributes: ${sim.rules.attributes.join(', ') || 'none'})`);
  need(def.attribute, `stats.spendPoint: "${stat}" is not an attribute; points go into: ${sim.rules.attributes.join(', ') || 'none'}`);
  need(Number.isInteger(n) && n >= 1, `stats.spendPoint: n must be a whole number >= 1, got ${n}`);
  if (sheet.points < n) return { ok: false, reason: 'no-points' };
  if ((sheet.base[stat] ?? def.base) + (sheet.spent[stat] ?? 0) + n > def.max) return { ok: false, reason: 'max' };
  sheet.points -= n; sheet.spent[stat] = (sheet.spent[stat] ?? 0) + n;
  sim.touch(sheet, 'points');
  sim.emit({ type: 'points', id: sheet.id, stat, spent: sheet.spent[stat], points: sheet.points });
  return { ok: true, value: sim.values(sheet)[stat], points: sheet.points };
}

/** respec(sim, sheet) gives every spent point back. Returns how many. */
export function respec(sim, sheet) {
  let back = 0;
  for (const n of Object.values(sheet.spent)) back += n;
  sheet.spent = {}; sheet.points += back;
  if (back) { sim.touch(sheet, 'points'); sim.emit({ type: 'points', id: sheet.id, stat: null, spent: 0, points: sheet.points }); }
  return back;
}

/** grantUnlock(sim, sheet, name) unlocks something by hand (a quest reward). Returns false when it was already unlocked. */
export function grantUnlock(sim, sheet, name) {
  need(typeof name === 'string' && name, `stats.unlock: name must be a non-empty string, got ${JSON.stringify(name)} (level unlocks: ${names(sim.rules.levels.unlocks)})`);
  if (sheet.unlocked.includes(name)) return false;
  unlock(sim, sheet, sheet.level, [name]);
  return true;
}
