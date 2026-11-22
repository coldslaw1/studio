// XP curves: how much experience each level costs. A curve is plain data, never a formula string.
//   { kind: 'power', base: 50, power: 1.5 }       cost of level L -> L+1 is round(base * L^power)
//   { kind: 'linear', base: 100, step: 50 }       cost is base + step * (L - 1)
//   { kind: 'geometric', base: 100, growth: 1.2 } cost is round(base * growth^(L - 1))
//   { kind: 'table', table: [0, 100, 250, 500] }  TOTAL xp needed to be level 1, 2, 3, 4 (sets maxLevel)
import { need } from './util.js';

/**
 * buildCurve(curve, maxLevel) -> { totals, maxLevel }
 * totals[L] is the total XP needed to be level L (totals[1] is 0). Throws on a bad curve.
 */
export function buildCurve(curve, maxLevel) {
  need(curve && typeof curve === 'object', `createStats: levels.curve must be an object like { kind: 'power', base: 50, power: 1.5 }, got ${JSON.stringify(curve)}`);
  const totals = [0, 0];
  if (curve.kind === 'table') {
    const t = curve.table;
    need(Array.isArray(t) && t.length >= 1 && t[0] === 0, 'createStats: levels.curve.table must be a list of total XP per level starting with 0 (level 1)');
    for (let i = 1; i < t.length; i += 1) {
      need(Number.isFinite(t[i]) && t[i] > t[i - 1], `createStats: levels.curve.table must keep growing, but entry ${i} is ${t[i]} after ${t[i - 1]}`);
      totals[i + 1] = t[i];
    }
    return { totals, maxLevel: Math.min(maxLevel ?? t.length, t.length) };
  }
  need(Number.isInteger(maxLevel) && maxLevel >= 1, `createStats: levels.maxLevel must be a whole number >= 1, got ${maxLevel}`);
  const { base } = curve;
  need(base > 0 && Number.isFinite(base), `createStats: levels.curve.base must be a number > 0, got ${base}`);
  let cost;
  if (curve.kind === 'power') { const p = curve.power ?? 1.5; need(p >= 0 && Number.isFinite(p), `createStats: levels.curve.power must be >= 0, got ${p}`); cost = (L) => base * L ** p; }
  else if (curve.kind === 'linear') { const s = curve.step ?? 0; need(s >= 0 && Number.isFinite(s), `createStats: levels.curve.step must be >= 0, got ${s}`); cost = (L) => base + s * (L - 1); }
  else if (curve.kind === 'geometric') { const g = curve.growth ?? 1.2; need(g >= 1 && Number.isFinite(g), `createStats: levels.curve.growth must be >= 1, got ${g}`); cost = (L) => base * g ** (L - 1); }
  else throw new Error(`createStats: levels.curve.kind must be 'power', 'linear', 'geometric' or 'table', got ${JSON.stringify(curve.kind)}`);
  for (let L = 1; L < maxLevel; L += 1) totals[L + 1] = totals[L] + Math.max(1, Math.round(cost(L)));
  return { totals, maxLevel };
}

/** levelForXp(totals, maxLevel, xp) -> the level a total of `xp` experience gives. */
export function levelForXp(totals, maxLevel, xp) {
  let level = 1;
  while (level < maxLevel && xp >= totals[level + 1]) level += 1;
  return level;
}

/**
 * xpProgress(totals, maxLevel, xp) -> { level, xp, into, need, ratio, atMax }
 * `into` is XP earned inside the current level, `need` the size of the level, `ratio` into / need (1 at the top level).
 */
export function xpProgress(totals, maxLevel, xp) {
  const level = levelForXp(totals, maxLevel, xp);
  if (level >= maxLevel) return { level, xp, into: 0, need: 0, ratio: 1, atMax: true };
  const into = xp - totals[level]; const size = totals[level + 1] - totals[level];
  return { level, xp, into, need: size, ratio: into / size, atMax: false };
}
