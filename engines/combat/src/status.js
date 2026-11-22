// Status effects: burn, poison, stun and friends. A definition says what the
// effect does; a fighter's state only holds { id, t, stacks, tick, source }.
import { need, positive } from './util.js';

/**
 * STATUSES -> the built-in status effects. A definition:
 *   { duration (seconds), every (seconds between ticks), damage (per tick, per stack), type (damage type),
 *     heal (per tick, per stack), maxStacks = 1, stacking: 'refresh' | 'stack' | 'extend',
 *     stun (cannot act or move), mods: { speed, dealt, taken, attackSpeed } (multipliers) }
 */
export const STATUSES = {
  burn: { duration: 3, every: 0.5, damage: 1, type: 'fire', stacking: 'refresh' },
  poison: { duration: 5, every: 1, damage: 0.6, type: 'poison', maxStacks: 5, stacking: 'stack' },
  bleed: { duration: 4, every: 1, damage: 0.8, type: 'true', maxStacks: 3, stacking: 'stack' },
  stun: { duration: 1, stun: true, stacking: 'refresh' },
  slow: { duration: 3, mods: { speed: 0.5 }, stacking: 'refresh' },
  chill: { duration: 3, mods: { speed: 0.7, attackSpeed: 0.75 }, stacking: 'refresh' },
  weaken: { duration: 4, mods: { dealt: 0.7 }, stacking: 'refresh' },
  vulnerable: { duration: 4, mods: { taken: 1.3 }, stacking: 'refresh' },
  haste: { duration: 4, mods: { speed: 1.3, attackSpeed: 1.25 }, stacking: 'refresh' },
  regen: { duration: 5, every: 1, heal: 1, stacking: 'extend' },
};

/** checkStatus(def, id) -> the status definition with defaults filled in. Throws on a bad value. */
export function checkStatus(def, id) {
  const where = `checkStatus("${id}")`;
  need(def && typeof def === 'object', `${where}: a status must be an object`);
  const s = { duration: 3, every: 0, damage: 0, type: 'true', heal: 0, maxStacks: 1, stacking: 'refresh', stun: false, ...def, id };
  s.mods = { speed: 1, dealt: 1, taken: 1, attackSpeed: 1, ...(def.mods || {}) };
  for (const key of ['duration', 'every', 'damage', 'heal']) positive(s[key], `${where}: ${key}`);
  need(['refresh', 'stack', 'extend'].includes(s.stacking), `${where}: stacking must be refresh, stack or extend`);
  need(Number.isInteger(s.maxStacks) && s.maxStacks >= 1, `${where}: maxStacks must be a whole number >= 1`);
  need((s.damage === 0 && s.heal === 0) || s.every > 0, `${where}: damage or heal over time needs "every" above 0`);
  return s;
}

/**
 * applyStatus(sim, fighter, id, options) -> true when the status is now on the fighter.
 * options: { duration, stacks = 1, source: fighter id }. Fighters listed in `fighter.immune` shrug it off.
 */
export function applyStatus(sim, f, id, options = {}) {
  const def = sim.cfg.statuses[id];
  need(def, `applyStatus: unknown status "${String(id)}". Known: ${Object.keys(sim.cfg.statuses).join(', ')}`);
  if (!f.alive || f.immune.includes(id)) return false;
  const duration = options.duration ?? def.duration;
  const add = options.stacks ?? 1;
  let s = f.statuses.find((x) => x.id === id);
  if (!s) {
    s = { id, t: duration, stacks: Math.min(def.maxStacks, add), tick: def.every, source: options.source ?? null };
    f.statuses.push(s);
    f.statuses.sort((a, b) => (a.id < b.id ? -1 : 1));
  } else {
    if (def.stacking === 'extend') s.t += duration;
    else s.t = Math.max(s.t, duration);
    if (def.stacking === 'stack') s.stacks = Math.min(def.maxStacks, s.stacks + add);
    if (options.source) s.source = options.source;
  }
  sim.events.push({ type: 'status', id: f.id, status: id, stacks: s.stacks, source: s.source });
  return true;
}

/** clearStatus(sim, fighter, id) -> true when it was removed. With no id, every status goes. */
export function clearStatus(sim, f, id) {
  const before = f.statuses.length;
  for (const s of f.statuses) if (!id || s.id === id) sim.events.push({ type: 'statusEnd', id: f.id, status: s.id });
  f.statuses = id ? f.statuses.filter((s) => s.id !== id) : [];
  return f.statuses.length < before;
}

/** statusMods(cfg, fighter) -> { speed, dealt, taken, attackSpeed, stun } with every active status multiplied in. */
export function statusMods(cfg, f) {
  const out = { speed: 1, dealt: 1, taken: 1, attackSpeed: 1, stun: false };
  for (const s of f.statuses) {
    const def = cfg.statuses[s.id];
    if (!def) continue;
    out.speed *= def.mods.speed; out.dealt *= def.mods.dealt; out.taken *= def.mods.taken; out.attackSpeed *= def.mods.attackSpeed;
    if (def.stun) out.stun = true;
  }
  return out;
}

/** hasStatus(fighter, id) -> true while the status is on the fighter. */
export const hasStatus = (f, id) => f.statuses.some((s) => s.id === id);

/**
 * stepStatuses(sim, fighter, dt, hurt) advances the timers, applies damage and healing ticks
 * through hurt(hit) (the shared damage pipeline) and drops the ones that ran out.
 */
export function stepStatuses(sim, f, dt, hurt) {
  if (f.statuses.length === 0) return;
  for (const s of [...f.statuses]) {
    const def = sim.cfg.statuses[s.id];
    if (!def) continue;
    s.t -= dt;
    if (def.every > 0) {
      s.tick -= dt;
      while (s.tick <= 1e-9 && f.alive) {
        s.tick += def.every;
        if (def.damage > 0) hurt({ target: f.id, source: s.source, amount: def.damage * s.stacks, type: def.type, via: 'status', status: s.id });
        if (def.heal > 0 && f.alive) {
          const before = f.hp;
          f.hp = Math.min(f.maxHp, f.hp + def.heal * s.stacks);
          if (f.hp > before) sim.events.push({ type: 'heal', id: f.id, amount: f.hp - before, status: s.id });
        }
      }
    }
  }
  const ended = f.statuses.filter((s) => s.t <= 1e-9);
  if (ended.length) {
    f.statuses = f.statuses.filter((s) => s.t > 1e-9);
    for (const s of ended) sim.events.push({ type: 'statusEnd', id: f.id, status: s.id });
  }
}
