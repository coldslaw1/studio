// Throwing and picking up. A throw is an action with a wind-up, like a
// swing; the projectile leaves the hand when the wind-up ends. Anything lying
// on the ground or stuck in a wall can be picked up and thrown again.
import { dirOf, round, need } from './util.js';
import { setAct } from './damage.js';
import { faceInput } from './melee.js';
import { aimAt, lob } from './aim.js';
import { launch } from './projectile.js';
import { statusMods } from './status.js';

/** throwableOf(cfg, fighter, kind) -> the id of what the fighter would throw: the given kind, its `throwable`, or its weapon's `throws`. */
export function throwableOf(cfg, f, kind) {
  return kind ?? f.throwable ?? cfg.weapons[f.weapon]?.throws ?? null;
}

/**
 * startThrow(sim, fighter, options) -> { ok: true, kind } or { ok: false, reason }.
 * options: { kind, aim: { x, y, z? } (a point to hit; default: the input's aim point, else straight ahead), item (a stack that rides along) }.
 * Reasons: 'dead', 'busy', 'nothing' (no throwable), 'ammo'.
 */
export function startThrow(sim, f, options = {}) {
  const { cfg } = sim;
  if (!f.alive) return { ok: false, reason: 'dead' };
  if (f.act.kind !== 'idle' || f.hitstop > 0 || statusMods(cfg, f).stun) return { ok: false, reason: 'busy' };
  const kind = throwableOf(cfg, f, options.kind);
  if (!kind) return { ok: false, reason: 'nothing' };
  need(cfg.throwables[kind], `combat.throw: unknown throwable "${kind}". Known: ${Object.keys(cfg.throwables).join(', ')}`);
  if (f.ammo && !options.item && !((f.ammo[kind] || 0) > 0)) {
    sim.events.push({ type: 'noammo', id: f.id, kind });
    return { ok: false, reason: 'ammo' };
  }
  let aim = options.aim ?? null;
  if (!aim && f.input.aimX !== null && f.input.aimY !== null) aim = { x: f.input.aimX, y: f.input.aimY };
  if (aim) need(Number.isFinite(aim.x) && Number.isFinite(aim.y), 'combat.throw: aim needs numbers x and y');
  faceInput(f);
  if (aim && (aim.x !== f.x || aim.y !== f.y)) f.facing = round(Math.atan2(aim.x - f.x, -(aim.y - f.y)) * 180 / Math.PI);
  setAct(f, 'throw', { phase: 'windup', aim: aim ? { x: aim.x, y: aim.y, z: aim.z ?? null } : null });
  f.act.kindId = kind;
  // the item being thrown is kept on the fighter, not the action, so an interrupted throw can drop it instead of losing it
  f.carry = options.item ? { kind, item: options.item } : null;
  f.guard.on = false;
  sim.events.push({ type: 'throwStart', id: f.id, kind, windup: cfg.throwables[kind].windup });
  return { ok: true, kind };
}

function release(sim, f, def) {
  const { cfg } = sim;
  const [fx, fy] = dirOf(f.facing);
  const from = { x: f.x + fx * (f.radius + def.radius), y: f.y + fy * (f.radius + def.radius), z: f.z + f.height * 0.75 };
  const g = cfg.gravity * def.gravity;
  let v = null;
  const aim = f.act.aim;
  if (aim) {
    // an aim point on the ground means "hit whoever stands there": aim at chest height
    const to = { x: aim.x, y: aim.y, z: aim.z ?? cfg.groundAt(aim.x, aim.y) + f.height * 0.5 };
    v = aimAt(from, to, def.speed, g) ?? lob(f.facing, def.speed, 40); // out of range: the longest throw that way
  } else v = lob(f.facing, def.speed, def.loft);
  const item = f.carry ? f.carry.item : null;
  f.carry = null;
  if (f.ammo && !item) f.ammo[def.id] = Math.max(0, (f.ammo[def.id] || 0) - 1);
  const p = launch(sim, {
    kind: def.id, owner: f.id, faction: f.faction, ...from, vx: v.vx, vy: v.vy, vz: v.vz,
    amount: def.damage + f.stats.attack * def.scale, item,
  });
  sim.events.push({ type: 'throw', id: f.id, proj: p.id, kind: def.id, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz });
}

/** dropCarried(sim, fighter) puts an item whose throw was interrupted (stagger, stun, death) on the ground at the fighter's feet. */
export function dropCarried(sim, f) {
  if (!f.carry || (f.act.kind === 'throw' && f.act.phase === 'windup')) return;
  const { kind, item } = f.carry;
  f.carry = null;
  const def = sim.cfg.throwables[kind];
  const p = launch(sim, { kind, owner: f.id, faction: f.faction, x: f.x, y: f.y, z: sim.cfg.groundAt(f.x, f.y), vx: 0, vy: 0, vz: 0, item });
  p.mode = 'rest'; p.ttl = def ? def.restTtl : null;
  sim.events.push({ type: 'rest', proj: p.id, kind, into: 'ground', x: p.x, y: p.y, z: p.z, dropped: true });
}

/** stepThrow(sim, fighter, dt) advances a throw: wind-up, release, recovery. */
export function stepThrow(sim, f, dt) {
  const def = sim.cfg.throwables[f.act.kindId];
  const a = f.act;
  a.t += dt * statusMods(sim.cfg, f).attackSpeed;
  if (a.phase === 'windup') {
    if (a.t < def.windup) return;
    a.t -= def.windup; a.phase = 'recovery';
    release(sim, f, def);
  }
  if (a.t >= def.recovery) { setAct(f, 'idle'); sim.events.push({ type: 'recover', id: f.id }); }
}

/** canPickup(cfg, fighter, projectile, reach) -> true when the projectile lies or sticks within reach of the fighter. */
export function canPickup(cfg, f, p, reach) {
  const def = cfg.throwables[p.kind];
  if (!def || !def.pickup || p.in || (p.mode !== 'rest' && p.mode !== 'stuck')) return false;
  return Math.hypot(p.x - f.x, p.y - f.y) <= f.radius + reach && p.z <= f.z + f.height + reach && p.z >= f.z - reach;
}

/**
 * pickup(sim, fighter, projId, reach) -> { ok: true, proj, kind, item } or { ok: false, reason }.
 * Takes the named projectile, or with projId null the nearest one in reach. The projectile leaves the world;
 * a fighter with an `ammo` count gets one more of that kind unless the projectile carries an inventory item.
 * Reasons: 'dead', 'busy', 'none' (nothing in reach).
 */
export function pickup(sim, f, projId = null, reach = sim.cfg.pickupReach) {
  const { state, cfg } = sim;
  if (!f.alive) return { ok: false, reason: 'dead' };
  if (f.act.kind === 'stagger' || statusMods(cfg, f).stun) return { ok: false, reason: 'busy' };
  let best = null; let bestD = Infinity;
  for (const p of state.projectiles) {
    if ((projId !== null && p.id !== projId) || !canPickup(cfg, f, p, reach)) continue;
    const d = Math.hypot(p.x - f.x, p.y - f.y);
    if (d < bestD) { best = p; bestD = d; }
  }
  if (!best) return { ok: false, reason: 'none' };
  state.projectiles = state.projectiles.filter((p) => p !== best);
  if (f.ammo && !best.item) f.ammo[best.kind] = (f.ammo[best.kind] || 0) + 1;
  sim.events.push({ type: 'pickup', id: f.id, proj: best.id, kind: best.kind, item: best.item });
  return { ok: true, proj: best.id, kind: best.kind, item: best.item };
}
