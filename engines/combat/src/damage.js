// The one damage pipeline. Sword swings, thrown weapons and status ticks all
// end in hurt(), so factions, i-frames, blocking, resistances, knockback and
// hit-stop behave the same everywhere. Order: faction check, i-frames, parry,
// block, resistance and armour, health, knockback, hit-stop, stagger, statuses.
import { clamp, round, angleDiff, facingOf, need } from './util.js';
import { statusMods, applyStatus } from './status.js';

/** setAct(fighter, kind, fields) replaces what the fighter is doing (idle, attack, throw, stagger, dodge). */
export function setAct(f, kind, fields = {}) {
  f.act = { kind, t: 0, phase: null, move: 0, hit: [], buffered: false, dur: 0, dx: 0, dy: 0, aim: null, ...fields };
}

/** stagger(sim, fighter, seconds) knocks the fighter out of whatever it was doing for a moment. */
export function stagger(sim, f, seconds) {
  const dur = seconds - (f.poise || 0);
  if (!f.alive || dur <= 0) return false;
  setAct(f, 'stagger', { dur });
  f.guard.on = false;
  f.combo = { next: 0, t: 0 };
  sim.events.push({ type: 'stagger', id: f.id, time: round(dur) });
  return true;
}

/** guardOf(cfg, fighter) -> the shield (or the weapon's own guard) the fighter blocks with, or null. */
export function guardOf(cfg, f) {
  if (f.shield) return cfg.shields[f.shield] || null;
  const w = cfg.weapons[f.weapon];
  return w ? w.guard : null;
}

/** kill(sim, fighter, by) marks the fighter dead and reports it. */
export function kill(sim, f, by = null) {
  if (!f.alive) return;
  f.alive = false; f.hp = 0;
  setAct(f, 'idle');
  f.guard.on = false; f.statuses = []; f.iframes = 0;
  f.input.attack = false; f.input.block = false; f.input.throw = false; f.input.dodge = false; f.input.moveX = 0; f.input.moveY = 0;
  sim.events.push({ type: 'death', id: f.id, by, x: round(f.x), y: round(f.y) });
}

function roll(sim, chance, what) {
  if (chance >= 1) return true;
  if (chance <= 0) return false;
  need(typeof sim.rng === 'function', `combat: ${what} needs a random number. Pass "rng" to createCombat (core's createRng(seed) or net's ctx.rng)`);
  return sim.rng() < chance;
}

/**
 * hurt(sim, hit) -> { outcome, damage }. outcome: 'none' | 'friendly' | 'immune' | 'parried' | 'blocked' | 'hit' | 'killed'.
 * hit: { target, source, amount, type, via: 'melee' | 'projectile' | 'status', fromX, fromY (where the blow comes from),
 *        knockback, lift, hitstop, stagger, statuses, crit: { chance, mult }, blockable, parryable, weapon, move, proj, status }
 */
export function hurt(sim, hit) {
  const { state, cfg } = sim;
  const t = state.fighters[hit.target];
  if (!t || !t.alive) return { outcome: 'none', damage: 0 };
  const src = hit.source ? state.fighters[hit.source] || null : null;
  const via = hit.via ?? 'melee';
  // a thrown weapon keeps its thrower's faction even after the thrower is gone
  const scale = cfg.factions.scale(src || (hit.faction ? { id: hit.source ?? '', faction: hit.faction } : null), t, via);
  if (scale <= 0) return { outcome: 'friendly', damage: 0 };
  const base = { source: src ? src.id : null, target: t.id, via, x: round(t.x), y: round(t.y), z: round(t.z + t.height * 0.6) };
  if (via !== 'status' && t.iframes > 0) {
    sim.events.push({ type: 'immune', ...base });
    return { outcome: 'immune', damage: 0 };
  }
  const fromX = hit.fromX ?? (src ? src.x : t.x); const fromY = hit.fromY ?? (src ? src.y : t.y);
  let dx = t.x - fromX; let dy = t.y - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist > 1e-9) { dx /= dist; dy /= dist; } else { dx = 0; dy = 0; }
  let amount = hit.amount * scale;
  let crit = false;
  if (hit.crit && hit.crit.chance > 0 && roll(sim, hit.crit.chance, 'a critical hit chance')) { crit = true; amount *= hit.crit.mult; }
  if (src) amount *= statusMods(cfg, src).dealt;

  // parry and block
  let blocked = false; let knock = hit.knockback || 0; let staggerTime = hit.stagger || 0;
  const shield = guardOf(cfg, t);
  if (via !== 'status' && hit.blockable !== false && t.guard.on && shield && dist > 1e-9
    && Math.abs(angleDiff(facingOf(-dx, -dy), t.facing)) <= shield.arc / 2 && (!shield.types || shield.types.includes(hit.type))) {
    const stop = hit.hitstop || 0;
    if (hit.parryable !== false && t.guard.t <= shield.parry) {
      t.hitstop = Math.max(t.hitstop, stop);
      if (src && via === 'melee') { src.hitstop = Math.max(src.hitstop, stop); stagger(sim, src, shield.parryStagger); }
      sim.events.push({ type: 'parry', ...base, weapon: hit.weapon ?? null, proj: hit.proj ?? null });
      return { outcome: 'parried', damage: 0 };
    }
    blocked = true;
    t.guard.meter -= amount;
    sim.events.push({ type: 'block', ...base, amount: round(amount), guard: round(Math.max(0, t.guard.meter)) });
    amount *= 1 - shield.reduce; knock *= shield.push; staggerTime = 0;
    if (t.guard.meter <= 0) {
      t.guard.meter = 0;
      sim.events.push({ type: 'guardbreak', id: t.id, by: base.source });
      stagger(sim, t, shield.breakStagger);
    }
  }

  // resistance by damage type, then armour (diminishing: defense 10 halves damage at armorK 10)
  const type = hit.type ?? 'blunt';
  amount *= statusMods(cfg, t).taken * (1 - clamp(t.stats.resist[type] ?? 0, -2, 1));
  if (type !== 'true') amount *= cfg.armorK / (cfg.armorK + Math.max(0, t.stats.defense));
  const damage = round(Math.max(0, amount));
  t.hp = round(Math.max(0, t.hp - damage));

  if (via !== 'status') {
    if (knock > 0) { t.kb.vx = dx * knock / t.weight; t.kb.vy = dy * knock / t.weight; }
    if (hit.lift > 0 && !blocked) t.vz = hit.lift / t.weight;
    const stop = hit.hitstop || 0;
    t.hitstop = Math.max(t.hitstop, stop);
    if (src && via === 'melee') src.hitstop = Math.max(src.hitstop, stop);
    if (!blocked && damage > 0) t.iframes = Math.max(t.iframes, t.hurtIframes);
  }
  if (t.ai && src && damage > 0) { t.ai.threat = t.ai.threat || {}; t.ai.threat[src.id] = round((t.ai.threat[src.id] || 0) + damage); }
  const killed = t.hp <= 0;
  if (damage > 0 || !blocked) {
    sim.events.push({ type: 'hit', ...base, damage, dtype: type, crit, blocked, killed, weapon: hit.weapon ?? null, move: hit.move ?? null, proj: hit.proj ?? null, status: hit.status ?? null });
  }
  if (killed) { kill(sim, t, base.source); return { outcome: 'killed', damage }; }
  if (!blocked && damage > 0) {
    if (staggerTime > 0) stagger(sim, t, staggerTime);
    for (const s of hit.statuses || []) {
      if (roll(sim, s.chance ?? 1, `the "${s.id}" status chance`)) applyStatus(sim, t, s.id, { duration: s.duration, stacks: s.stacks, source: base.source });
    }
  }
  return { outcome: blocked ? 'blocked' : 'hit', damage };
}

/** heal(sim, fighter, amount) -> health actually restored. Dead fighters are not healed; use revive. */
export function heal(sim, f, amount) {
  if (!f.alive || !(amount > 0)) return 0;
  const before = f.hp;
  f.hp = round(Math.min(f.maxHp, f.hp + amount));
  if (f.hp > before) sim.events.push({ type: 'heal', id: f.id, amount: round(f.hp - before) });
  return f.hp - before;
}
