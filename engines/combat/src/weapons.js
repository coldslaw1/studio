// Weapon and shield definitions. A weapon is a list of moves; each move has a
// wind-up, an active window and a recovery, in SECONDS, and a hit shape (an
// arc that sweeps, or a box for thrusts). The moves in order are the combo.
// Definitions live in the combat config, never in the saved state.
import { need, positive, isId } from './util.js';

/** Damage types the built-in data uses. Any string works as a type; these are the ones with presets. */
export const DAMAGE_TYPES = ['slash', 'pierce', 'blunt', 'fire', 'frost', 'poison', 'magic', 'true'];

const MOVE_DEFAULTS = {
  name: 'swing', windup: 0.22, active: 0.1, recovery: 0.18, chainAt: null,
  damage: 1, knockback: 4, lift: 0, hitstop: 0.07, stagger: 0.25, type: null, statuses: [],
  lunge: 0, moveScale: 0.35, low: null, high: null, blockable: true, parryable: true, anim: 'attack',
};

function checkShape(shape, where) {
  need(shape && (shape.kind === 'arc' || shape.kind === 'box'), `${where}: shape.kind must be "arc" or "box"`);
  if (shape.kind === 'arc') {
    const from = shape.from ?? -(shape.angle ?? 110) / 2;
    const to = shape.to ?? (shape.angle ?? 110) / 2;
    need(Number.isFinite(from) && Number.isFinite(to) && Math.abs(to - from) <= 360 && from !== to, `${where}: arc needs "angle" or "from"/"to" in degrees (at most a full turn)`);
    return { kind: 'arc', reach: positive(shape.reach, `${where}: arc reach`), inner: positive(shape.inner ?? 0, `${where}: arc inner`), from, to, sweep: shape.sweep !== false };
  }
  return { kind: 'box', length: positive(shape.length, `${where}: box length`), width: positive(shape.width, `${where}: box width`), start: shape.start ?? 0 };
}

/** checkMove(move, where) -> the move with every default filled in. Throws on a bad value. */
export function checkMove(move, where = 'checkMove') {
  need(move && typeof move === 'object', `${where}: a move must be an object`);
  for (const key of Object.keys(move)) need(key in MOVE_DEFAULTS || key === 'shape', `${where}: unknown move field "${key}". Fields: shape, ${Object.keys(MOVE_DEFAULTS).join(', ')}`);
  const m = { ...MOVE_DEFAULTS, ...move };
  for (const key of ['windup', 'active', 'recovery', 'damage', 'knockback', 'lift', 'hitstop', 'stagger', 'lunge', 'moveScale']) positive(m[key], `${where}: ${key}`);
  need(m.active > 0, `${where}: active must be above 0 seconds`);
  m.shape = checkShape(move.shape, where);
  m.chainAt = m.chainAt === null ? m.recovery * 0.4 : positive(m.chainAt, `${where}: chainAt`);
  need(Array.isArray(m.statuses), `${where}: statuses must be a list of { id, chance?, duration?, stacks? }`);
  m.statuses = m.statuses.map((s) => (typeof s === 'string' ? { id: s } : { ...s }));
  return m;
}

/**
 * checkWeapon(def, id) -> the weapon with defaults filled in. Throws on a bad value.
 *   { damage = 2, scale = 1, type = 'blunt', crit: { chance = 0, mult = 1.5 }, comboGrace = 0.35,
 *     guard: null | shield fields (lets the weapon block without a shield), throws: null | throwable id, moves: [move, ...] }
 * Hit damage = (damage + attacker attack * scale) * move.damage.
 */
export function checkWeapon(def, id = def && def.id) {
  const where = `checkWeapon("${id}")`;
  need(isId(id), `checkWeapon: a weapon needs an id (letters, digits, _ . : -), got ${String(id)}`);
  need(def && Array.isArray(def.moves) && def.moves.length > 0, `${where}: needs a non-empty "moves" list`);
  const crit = { chance: 0, mult: 1.5, ...(def.crit || {}) };
  need(crit.chance >= 0 && crit.chance <= 1 && crit.mult >= 1, `${where}: crit needs chance 0..1 and mult >= 1`);
  return {
    id, damage: positive(def.damage ?? 2, `${where}: damage`), scale: positive(def.scale ?? 1, `${where}: scale`),
    type: def.type ?? 'blunt', crit, comboGrace: positive(def.comboGrace ?? 0.35, `${where}: comboGrace`),
    guard: def.guard ? checkShield(def.guard, `${id}.guard`) : null, throws: def.throws ?? null,
    moves: def.moves.map((m, i) => checkMove(m, `${where} move ${i}`)),
  };
}

/**
 * checkShield(def, id) -> the shield with defaults filled in.
 *   { arc = 130 (degrees covered in front), reduce = 0.85 (share of damage stopped), guard = 12 (damage it soaks before breaking),
 *     regen = 4 (guard per second while not blocking), parry = 0.14 (seconds after raising it that count as a parry),
 *     parryStagger = 0.7, breakStagger = 0.9, push = 0.35 (share of knockback kept), moveScale = 0.45, types: null | [damage types it stops] }
 */
export function checkShield(def, id = def && def.id) {
  const where = `checkShield("${id}")`;
  need(def && typeof def === 'object', `${where}: a shield must be an object`);
  const s = { arc: 130, reduce: 0.85, guard: 12, regen: 4, parry: 0.14, parryStagger: 0.7, breakStagger: 0.9, push: 0.35, moveScale: 0.45, types: null, ...def, id };
  for (const key of ['arc', 'reduce', 'guard', 'regen', 'parry', 'parryStagger', 'breakStagger', 'push', 'moveScale']) positive(s[key], `${where}: ${key}`);
  need(s.reduce <= 1 && s.arc <= 360, `${where}: reduce is 0..1 and arc at most 360`);
  return s;
}

/**
 * movesFromClip(clip, base) -> one move whose timing is read from a puppet clip.
 * The clip's "hit" event (seconds) becomes the wind-up, so the blow lands on the frame the
 * animation shows it. `clip` is a puppet clip description or bound clip: { duration, events: [[seconds, 'hit']] }.
 * `base` holds the other move fields (shape is required there).
 */
export function movesFromClip(clip, base = {}) {
  need(clip && clip.duration > 0, 'movesFromClip: clip needs a duration');
  const events = (clip.events || []).map((e) => (Array.isArray(e) ? { t: e[0], name: e[1] } : { t: e.t ?? e.time, name: e.name }));
  const hit = events.find((e) => e.name === (base.event ?? 'hit'));
  need(hit && Number.isFinite(hit.t), `movesFromClip: the clip has no "${base.event ?? 'hit'}" event`);
  const { event, ...rest } = base;
  const active = rest.active ?? 0.08;
  return { ...rest, windup: hit.t, active, recovery: Math.max(0.02, Math.round((clip.duration - hit.t - active) * 1000) / 1000) };
}

/**
 * WEAPONS(unit = 1) -> the built-in weapons, sized for a world where one metre is `unit` game units
 * (1 for Kiln scenes, about 32 for pixel games). Keys match puppet's items: sword, rustyBlade, staff, plus fists, dagger, spear.
 * The first sword and blade move uses the timing of puppet's attack clip (hit at 0.22 s of 0.5 s).
 */
export function WEAPONS(unit = 1) {
  const u = unit;
  const arc = (reach, angle, extra) => ({ kind: 'arc', reach: reach * u, angle, ...extra });
  return {
    fists: { damage: 1, type: 'blunt', moves: [
      { name: 'jab', windup: 0.1, active: 0.07, recovery: 0.14, shape: arc(0.9, 70), knockback: 2 * u, hitstop: 0.04, stagger: 0.15 },
      { name: 'cross', windup: 0.12, active: 0.08, recovery: 0.22, shape: arc(1.0, 80), damage: 1.4, knockback: 4 * u, hitstop: 0.06 },
    ] },
    sword: { damage: 3, type: 'slash', crit: { chance: 0.1, mult: 1.5 }, guard: { arc: 90, reduce: 0.5, guard: 6, parry: 0.1 }, moves: [
      { name: 'chop', windup: 0.22, active: 0.08, recovery: 0.2, shape: arc(1.6, 110, { from: 55, to: -55 }), knockback: 4 * u, lunge: 0.25 * u },
      { name: 'backhand', windup: 0.18, active: 0.09, recovery: 0.22, shape: arc(1.6, 130, { from: -65, to: 65 }), damage: 1.15, knockback: 4.5 * u, lunge: 0.25 * u },
      { name: 'thrust', windup: 0.24, active: 0.08, recovery: 0.34, shape: { kind: 'box', length: 2.1 * u, width: 0.5 * u, start: 0.2 * u }, damage: 1.7, type: 'pierce', knockback: 7 * u, hitstop: 0.11, stagger: 0.4, lunge: 0.6 * u },
    ] },
    rustyBlade: { damage: 2, type: 'slash', moves: [
      { name: 'hack', windup: 0.3, active: 0.09, recovery: 0.3, shape: arc(1.5, 100, { from: 50, to: -50 }), knockback: 3.5 * u },
      { name: 'slash', windup: 0.26, active: 0.09, recovery: 0.4, shape: arc(1.5, 120, { from: -60, to: 60 }), damage: 1.2, knockback: 4 * u, statuses: [{ id: 'bleed', chance: 0.35 }] },
    ] },
    dagger: { damage: 1.5, type: 'pierce', crit: { chance: 0.25, mult: 2 }, throws: 'knife', moves: [
      { name: 'stab', windup: 0.09, active: 0.06, recovery: 0.12, shape: { kind: 'box', length: 1.1 * u, width: 0.4 * u }, knockback: 1.5 * u, hitstop: 0.04, stagger: 0.12 },
      { name: 'slice', windup: 0.1, active: 0.07, recovery: 0.12, shape: arc(1.0, 90), knockback: 1.5 * u, hitstop: 0.04, stagger: 0.12 },
      { name: 'lunge', windup: 0.14, active: 0.07, recovery: 0.26, shape: { kind: 'box', length: 1.5 * u, width: 0.4 * u }, damage: 1.6, knockback: 4 * u, lunge: 0.7 * u },
    ] },
    spear: { damage: 3, type: 'pierce', throws: 'spear', moves: [
      { name: 'poke', windup: 0.2, active: 0.08, recovery: 0.24, shape: { kind: 'box', length: 2.6 * u, width: 0.4 * u, start: 0.5 * u }, knockback: 5 * u },
      { name: 'sweep', windup: 0.32, active: 0.14, recovery: 0.4, shape: arc(2.4, 200, { from: -100, to: 100, inner: 0.6 * u }), damage: 0.8, type: 'blunt', knockback: 6 * u, stagger: 0.45 },
    ] },
    staff: { damage: 2, type: 'blunt', guard: { arc: 110, reduce: 0.65, guard: 8, parry: 0.12 }, moves: [
      { name: 'swat', windup: 0.2, active: 0.1, recovery: 0.22, shape: arc(2.0, 120, { from: 60, to: -60 }), knockback: 5 * u },
      { name: 'spin', windup: 0.3, active: 0.24, recovery: 0.42, shape: arc(2.0, 360, { from: 0, to: 360 }), damage: 0.9, knockback: 7 * u, stagger: 0.4 },
    ] },
  };
}

/** SHIELDS -> the built-in shields: shield (the round shield of puppet's knight) and buckler (small, wide parry window). */
export const SHIELDS = {
  shield: { arc: 130, reduce: 0.85, guard: 12, parry: 0.14 },
  buckler: { arc: 100, reduce: 0.6, guard: 7, parry: 0.22, moveScale: 0.7 },
};
