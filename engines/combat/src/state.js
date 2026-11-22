// The combat state: plain JSON, so it can be saved, sent over the network,
// rolled back and loaded again. Definitions (weapons, statuses) stay in the config.
import { need, num, clamp, isId, positive } from './util.js';

/** createCombatState() -> an empty state: { v, time, tick, seq, fighters: {}, projectiles: [] }. */
export function createCombatState() {
  return { v: 1, time: 0, tick: 0, seq: 1, fighters: {}, projectiles: [] };
}

/** isCombatState(value) -> true when the value looks like a combat state. */
export function isCombatState(value) {
  return !!value && typeof value === 'object' && value.v === 1 && !!value.fighters && typeof value.fighters === 'object' && Array.isArray(value.projectiles);
}

/** emptyInput() -> an input with nothing held. */
export const emptyInput = () => ({ moveX: 0, moveY: 0, attack: false, block: false, dodge: false, throw: false, aimX: null, aimY: null, face: null });

/**
 * cleanInput(raw) -> a safe input object. Anything from a player is hostile input:
 * numbers are clamped, everything else becomes false or null. Never throws.
 */
export function cleanInput(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let mx = clamp(num(r.moveX, 0), -1, 1);
  let my = clamp(num(r.moveY, 0), -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  return {
    moveX: mx, moveY: my, attack: r.attack === true, block: r.block === true, dodge: r.dodge === true, throw: r.throw === true,
    aimX: Number.isFinite(r.aimX) ? r.aimX : null, aimY: Number.isFinite(r.aimY) ? r.aimY : null, face: Number.isFinite(r.face) ? r.face : null,
  };
}

/**
 * makeFighter(cfg, id, options) -> a new fighter state. Options (all lengths in game units):
 *   faction = 'neutral', x, y, z (default: the ground), facing = 180 (down the screen),
 *   radius = 0.35 m, height = 1.8 m, weight = 1 (divides knockback), speed = 3 m/s,
 *   hp / maxHp = 10, attack = 0, defense = 0, resist: { fire: 0.5, ... } (share of that damage type removed; negative = weak to it),
 *   immune: ['poison'] (status ids), weapon = 'fists', shield = null, throwable = null (what the throw button throws),
 *   ammo: null (endless) or { knife: 3 }, hurtIframes = 0 (seconds of safety after being hit),
 *   dodge: { time = 0.32, speed = 7 m/s, iframes = 0.22, cooldown = 0.6 } or null (cannot dodge),
 *   poise = 0 (seconds taken off every stagger), timing = 'timer' ('event': blows wait for combat.strike, see bindPuppet),
 *   external = false (true: the game moves this fighter and calls combat.place), ai: brain options or null, tags: {}
 */
export function makeFighter(cfg, id, o = {}) {
  need(isId(id), `addFighter: id must be letters, digits, _ . : -, got ${String(id)}`);
  const u = cfg.unit;
  const maxHp = positive(o.maxHp ?? o.hp ?? 10, 'addFighter: maxHp');
  const weapon = o.weapon ?? 'fists';
  need(cfg.weapons[weapon], `addFighter("${id}"): unknown weapon "${weapon}". Known: ${Object.keys(cfg.weapons).join(', ')}`);
  if (o.shield != null) need(cfg.shields[o.shield], `addFighter("${id}"): unknown shield "${o.shield}". Known: ${Object.keys(cfg.shields).join(', ')}`);
  if (o.throwable != null) need(cfg.throwables[o.throwable], `addFighter("${id}"): unknown throwable "${o.throwable}". Known: ${Object.keys(cfg.throwables).join(', ')}`);
  const x = num(o.x, 0); const y = num(o.y, 0);
  const dodge = o.dodge === null ? null : { time: 0.32, speed: 7 * u, iframes: 0.22, cooldown: 0.6, ...(o.dodge || {}) };
  return {
    id, faction: o.faction ?? 'neutral', x, y, z: num(o.z, cfg.groundAt(x, y)), vz: 0, facing: num(o.facing, 180),
    radius: positive(o.radius ?? 0.35 * u, 'addFighter: radius'), height: positive(o.height ?? 1.8 * u, 'addFighter: height'),
    weight: o.weight ?? 1, poise: o.poise ?? 0, timing: o.timing === 'event' ? 'event' : 'timer', speed: positive(o.speed ?? 3 * u, 'addFighter: speed'),
    hp: clamp(num(o.hp, maxHp), 0, maxHp), maxHp, alive: true,
    stats: { attack: num(o.attack, 0), defense: num(o.defense, 0), resist: { ...(o.resist || {}) } },
    immune: [...(o.immune || [])], weapon, shield: o.shield ?? null, throwable: o.throwable ?? null,
    ammo: o.ammo ? { ...o.ammo } : null, hurtIframes: o.hurtIframes ?? 0, dodge,
    input: emptyInput(), held: { attack: false, dodge: false, throw: false, block: false },
    // act: what the body is doing. kind: idle | attack | throw | stagger | dodge
    act: { kind: 'idle', t: 0, phase: null, move: 0, hit: [], buffered: false, dur: 0, dx: 0, dy: 0, aim: null },
    combo: { next: 0, t: 0 }, guard: { on: false, t: 0, meter: -1 }, dodgeCd: 0,
    iframes: 0, hitstop: 0, kb: { vx: 0, vy: 0 }, push: { dx: 0, dy: 0 },
    statuses: [], carry: null, external: o.external === true, ai: o.ai ? { ...o.ai } : null, tags: { ...(o.tags || {}) },
  };
}

/** fighterView(f) -> a small copy for HUDs and play-tests: id, faction, position, hp, what it is doing. */
export function fighterView(f) {
  return {
    id: f.id, faction: f.faction, x: f.x, y: f.y, z: f.z, facing: f.facing, hp: f.hp, maxHp: f.maxHp, alive: f.alive,
    doing: f.act.kind === 'attack' || f.act.kind === 'throw' ? `${f.act.kind}:${f.act.phase}` : f.act.kind,
    blocking: f.guard.on, statuses: f.statuses.map((s) => s.id), weapon: f.weapon, shield: f.shield,
  };
}
