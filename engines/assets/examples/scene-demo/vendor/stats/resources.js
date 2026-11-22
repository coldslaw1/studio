// Resources: health, mana, stamina and anything else that is spent and comes back. A resource has
// a value from 0 to its max (a stat, or a fixed number), an optional regeneration per second and a
// pause before regeneration starts again after a loss.
import { tidy } from './util.js';

const numberOr = (sim, sheet, v) => (typeof v === 'string' ? sim.values(sheet)[v] : v);

/** maxOf(sim, sheet, res) -> the top value of a resource right now. */
export const maxOf = (sim, sheet, res) => Math.max(0, numberOr(sim, sheet, sim.rules.resources[res].max));
/** regenOf(sim, sheet, res) -> units per second (negative drains). */
export const regenOf = (sim, sheet, res) => numberOr(sim, sheet, sim.rules.resources[res].regen);

/** initResources(sim, sheet, starts) fills in the resources a new sheet does not have yet. */
export function initResources(sim, sheet, starts = {}) {
  for (const [res, def] of Object.entries(sim.rules.resources)) {
    if (sheet.res[res]) continue;
    const max = maxOf(sim, sheet, res);
    const start = starts[res] ?? def.start;
    const v = start === 'full' ? max : start === 'empty' ? 0 : Math.min(max, start);
    sheet.res[res] = { v: def.whole ? Math.floor(v) : tidy(v), frac: 0, wait: 0 };
  }
}

/**
 * changeResource(sim, sheet, res, delta, cause) -> the change that really happened (after the 0..max limits).
 * Whole-number resources keep the fraction aside, so 0.4 a second still adds up to 2 after 5 seconds.
 */
export function changeResource(sim, sheet, res, delta, cause = 'game') {
  const def = sim.rules.resources[res]; const r = sheet.res[res];
  const max = maxOf(sim, sheet, res);
  const before = r.v;
  const exact = Math.min(max, Math.max(0, r.v + r.frac + delta));
  const edge = exact >= max || exact <= 0;
  const shown = def.whole ? Math.floor(exact + 1e-9) : tidy(exact);
  r.frac = edge ? 0 : def.whole ? Math.max(0, exact - shown) : exact - shown; // the part not shown yet, kept exactly
  r.v = edge && !def.whole ? tidy(exact) : shown;
  if (delta < 0 && cause !== 'regen' && def.regenDelay > 0) r.wait = def.regenDelay;
  if (r.v !== before) {
    sim.emit({ type: 'resource', id: sheet.id, resource: res, value: r.v, previous: before, delta: tidy(r.v - before), max, cause });
    if (r.v === 0) sim.emit({ type: 'depleted', id: sheet.id, resource: res, cause });
  }
  return tidy(r.v - before);
}

/** settleResources(sim, sheet, cause) keeps every resource inside 0..max after the stats changed. */
export function settleResources(sim, sheet, cause) {
  for (const res of Object.keys(sim.rules.resources)) {
    if (!sheet.res[res]) continue;
    if (sheet.res[res].v > maxOf(sim, sheet, res)) changeResource(sim, sheet, res, 0, cause);
  }
}

/** stepResources(sim, sheet, dt) regenerates (or drains) every resource for dt seconds. */
export function stepResources(sim, sheet, dt) {
  for (const res of Object.keys(sim.rules.resources)) {
    const r = sheet.res[res];
    if (r.wait > 0) { r.wait = tidy(Math.max(0, r.wait - dt)); continue; }
    const regen = regenOf(sim, sheet, res);
    if (regen === 0) continue;
    if (regen > 0 && r.v >= maxOf(sim, sheet, res)) continue;
    if (regen < 0 && r.v <= 0) continue;
    changeResource(sim, sheet, res, regen * dt, 'regen');
  }
}

/** resourceView(sim, sheet, res) -> { id, label, value, max, ratio, regen } for HUD bars. */
export function resourceView(sim, sheet, res) {
  const max = maxOf(sim, sheet, res); const value = sheet.res[res].v;
  return { id: res, label: sim.rules.resources[res].label, value, max, ratio: max > 0 ? Math.min(1, value / max) : 0, regen: regenOf(sim, sheet, res) };
}
