// Working out a character's numbers. For every stat:
//   raw   = base + points spent + sum(other stat * per) + perLevel * (level - 1)
//   value = (raw + all "add") * (1 + all "inc") * every "mult", then rounded and kept inside min..max
// Modifiers come from named sources kept on the sheet (equipment, a class, a curse) and from the
// buffs and debuffs that are on right now (multiplied by their stacks).
import { clamp, tidy } from './util.js';

/** modsOf(rules, sheet) -> every modifier in force: [{ stat, add, inc, mult, source }]. */
export function modsOf(rules, sheet) {
  const out = [];
  for (const [source, list] of Object.entries(sheet.mods)) for (const m of list) out.push({ ...m, source });
  for (const e of sheet.effects) {
    const def = rules.effects[e.id];
    for (const m of def.mods) {
      const scaled = { stat: m.stat, source: `effect:${e.id}` };
      if (m.add !== undefined) scaled.add = m.add * e.stacks;
      if (m.inc !== undefined) scaled.inc = m.inc * e.stacks;
      if (m.mult !== undefined) scaled.mult = m.mult ** e.stacks;
      out.push(scaled);
    }
  }
  return out;
}

function finish(def, n) {
  let v = n;
  if (def.round === 'floor') v = Math.floor(v + 1e-9);
  else if (def.round === 'ceil') v = Math.ceil(v - 1e-9);
  else if (def.round === 'round') v = Math.round(v);
  return tidy(clamp(v, def.min, def.max));
}

/**
 * compute(rules, sheet, detail) -> { stat: value } for every stat.
 * With detail = true each entry is { value, raw, base, spent, fromStats, fromLevel, add, inc, mult, sources } instead.
 */
export function compute(rules, sheet, detail = false) {
  const mods = modsOf(rules, sheet);
  const values = {}; const out = {};
  for (const id of rules.order) {
    const def = rules.stats[id];
    const base = sheet.base[id] ?? def.base;
    const spent = sheet.spent[id] ?? 0;
    let fromStats = 0;
    for (const [dep, k] of Object.entries(def.per)) fromStats += values[dep] * k;
    const fromLevel = def.perLevel * (sheet.level - 1);
    let add = 0; let inc = 0; let mult = 1; const sources = [];
    for (const m of mods) {
      if (m.stat !== id) continue;
      add += m.add ?? 0; inc += m.inc ?? 0; mult *= m.mult ?? 1;
      if (detail) sources.push(m);
    }
    const raw = base + spent + fromStats + fromLevel;
    values[id] = finish(def, (raw + add) * Math.max(0, 1 + inc) * mult);
    out[id] = detail ? { value: values[id], raw: tidy(raw), base, spent, fromStats: tidy(fromStats), fromLevel, add: tidy(add), inc: tidy(inc), mult: tidy(mult), sources } : values[id];
  }
  return out;
}
