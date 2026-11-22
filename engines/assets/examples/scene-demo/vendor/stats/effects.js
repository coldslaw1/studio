// Buffs and debuffs: named effects on a character for a time. An effect changes stats through its
// modifiers while it is on, and can change resources every few seconds (poison, regeneration).
import { tidy } from './util.js';
import { changeResource } from './resources.js';

/** immuneTo(sheet, def) -> true when the sheet's `immune` list names the effect or one of its tags. */
export const immuneTo = (sheet, def) => sheet.immune.includes(def.id) || def.tags.some((t) => sheet.immune.includes(t));

/**
 * applyEffect(sim, sheet, def, { duration, stacks = 1, source }) -> { ok: true, stacks, left, fresh } or { ok: false, reason: 'immune' }
 * A second dose follows the effect's `stacking`: 'refresh' restarts the timer, 'stack' adds a stack
 * (up to maxStacks) and restarts the timer, 'extend' adds the duration on top of what is left.
 */
export function applyEffect(sim, sheet, def, o = {}) {
  if (immuneTo(sheet, def)) {
    sim.emit({ type: 'immune', id: sheet.id, effect: def.id, source: o.source ?? null });
    return { ok: false, reason: 'immune' };
  }
  const duration = o.duration ?? def.duration;
  const span = duration > 0 ? duration : null; // null = until removed
  const dose = Math.max(1, Math.floor(o.stacks ?? 1));
  let e = sheet.effects.find((x) => x.id === def.id);
  const fresh = !e;
  if (!e) {
    e = { id: def.id, stacks: Math.min(def.maxStacks, dose), left: span, total: span, tick: 0, source: o.source ?? null };
    sheet.effects.push(e);
  } else {
    if (def.stacking === 'stack') e.stacks = Math.min(def.maxStacks, e.stacks + dose);
    if (def.stacking === 'extend' && e.left !== null && span !== null) e.left = tidy(e.left + span);
    else e.left = span === null || e.left === null ? null : Math.max(e.left, span);
    e.total = e.left === null ? null : Math.max(e.total ?? 0, e.left);
    if (o.source) e.source = o.source;
  }
  sim.touch(sheet, `effect:${def.id}`);
  sim.emit({ type: 'effect', id: sheet.id, effect: def.id, kind: def.kind, stacks: e.stacks, left: e.left, source: e.source, fresh });
  return { ok: true, stacks: e.stacks, left: e.left, fresh };
}

/** removeEffect(sim, sheet, effectId, reason) -> true when it was on. */
export function removeEffect(sim, sheet, effectId, reason = 'removed') {
  const i = sheet.effects.findIndex((e) => e.id === effectId);
  if (i < 0) return false;
  sheet.effects.splice(i, 1);
  sim.touch(sheet, `effect:${effectId}`);
  sim.emit({ type: 'effectEnd', id: sheet.id, effect: effectId, reason });
  return true;
}

/**
 * dispel(sim, sheet, { kind, tag, limit }) -> the ids removed. `kind` 'buff' or 'debuff', `tag` one
 * of the effect's tags; both left out removes everything. `limit` stops after that many (oldest first).
 */
export function dispel(sim, sheet, o = {}) {
  const gone = [];
  for (const e of sheet.effects.slice()) {
    if (o.limit !== undefined && gone.length >= o.limit) break;
    const def = sim.rules.effects[e.id];
    if (o.kind && def.kind !== o.kind) continue;
    if (o.tag && !def.tags.includes(o.tag)) continue;
    if (removeEffect(sim, sheet, e.id, 'dispelled')) gone.push(e.id);
  }
  return gone;
}

/** stepEffects(sim, sheet, dt) ticks resource changes and ends effects whose time is up. */
export function stepEffects(sim, sheet, dt) {
  for (const e of sheet.effects.slice()) {
    const def = sim.rules.effects[e.id];
    const live = e.left === null ? dt : Math.min(dt, e.left); // an effect never ticks past its own end
    if (def.every > 0) {
      e.tick = tidy(e.tick + live);
      while (e.tick + 1e-9 >= def.every && sheet.effects.includes(e)) {
        e.tick = tidy(Math.max(0, e.tick - def.every));
        const change = {};
        for (const [res, n] of Object.entries(def.change)) change[res] = changeResource(sim, sheet, res, n * e.stacks, `effect:${e.id}`);
        sim.emit({ type: 'tick', id: sheet.id, effect: e.id, stacks: e.stacks, change });
      }
    }
    if (e.left !== null && sheet.effects.includes(e)) {
      e.left = tidy(e.left - dt);
      if (e.left <= 1e-9) removeEffect(sim, sheet, e.id, 'expired');
    }
  }
}

/** effectView(sim, e) -> { id, name, kind, stacks, left, total, ratio, tags, icon, source } for HUD icons. */
export function effectView(sim, e) {
  const def = sim.rules.effects[e.id];
  return { id: e.id, name: def.name, kind: def.kind, stacks: e.stacks, left: e.left, total: e.total, ratio: e.left === null || !e.total ? 1 : Math.max(0, Math.min(1, e.left / e.total)), tags: [...def.tags], icon: def.icon, source: e.source };
}
