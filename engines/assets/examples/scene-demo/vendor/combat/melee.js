// Melee: wind-up, active window, recovery, combos, plus the guard (block and
// parry) and the dodge roll. Timing lives in the weapon's move data in
// seconds, so the server can run it without any animation.
import { dirOf, facingOf, round } from './util.js';
import { setAct, hurt, guardOf } from './damage.js';
import { covers, heightBand, clearLine } from './hitbox.js';
import { statusMods } from './status.js';

/** currentMove(cfg, fighter) -> the move being performed, or null when the fighter is not attacking. */
export function currentMove(cfg, f) {
  return f.act.kind === 'attack' ? cfg.weapons[f.weapon].moves[f.act.move] : null;
}

/** faceInput(fighter) turns the fighter toward its input: an explicit face, else the aim point, else the movement (not while the guard is up, so backing away keeps the shield forward). */
export function faceInput(f) {
  const i = f.input;
  if (i.face !== null) f.facing = i.face;
  else if (i.aimX !== null && i.aimY !== null && (i.aimX !== f.x || i.aimY !== f.y)) f.facing = round(facingOf(i.aimX - f.x, i.aimY - f.y));
  else if ((i.moveX !== 0 || i.moveY !== 0) && !f.guard.on) f.facing = round(facingOf(i.moveX, i.moveY));
}

/** startAttack(sim, fighter, index) begins a move of the fighter's weapon. Reports an 'attack' event. */
export function startAttack(sim, f, index = 0) {
  const weapon = sim.cfg.weapons[f.weapon];
  const i = index < weapon.moves.length ? index : 0;
  const move = weapon.moves[i];
  faceInput(f);
  setAct(f, 'attack', { phase: 'windup', move: i });
  f.guard.on = false;
  sim.events.push({ type: 'attack', id: f.id, weapon: weapon.id, move: move.name, index: i, anim: move.anim, windup: move.windup, active: move.active, recovery: move.recovery });
}

function strikeTargets(sim, f, weapon, move, progress) {
  const { state, cfg } = sim;
  const [low, high] = heightBand(f, move);
  for (const id of Object.keys(state.fighters).sort()) {
    if (f.act.kind !== 'attack') return; // a parry staggered the attacker
    const t = state.fighters[id];
    if (id === f.id || !t.alive || f.act.hit.includes(id)) continue;
    if (!covers(cfg, f, move, progress, t)) continue;
    if (!clearLine(cfg, f.x, f.y, t.x, t.y, low, high)) continue;
    f.act.hit.push(id);
    hurt(sim, {
      target: id, source: f.id, via: 'melee', amount: (weapon.damage + f.stats.attack * weapon.scale) * move.damage,
      type: move.type ?? weapon.type, knockback: move.knockback, lift: move.lift, hitstop: move.hitstop, stagger: move.stagger,
      statuses: move.statuses, crit: weapon.crit, blockable: move.blockable, parryable: move.parryable, weapon: weapon.id, move: move.name,
    });
  }
}

/** stepAttack(sim, fighter, dt) advances a running attack through wind-up, active and recovery. */
export function stepAttack(sim, f, dt) {
  const weapon = sim.cfg.weapons[f.weapon];
  const move = weapon.moves[f.act.move];
  const a = f.act;
  a.t += dt * statusMods(sim.cfg, f).attackSpeed;
  a.dx = 0; a.dy = 0;
  if (a.phase === 'windup') {
    // timing 'event': the blow waits for combat.strike(id) (a puppet 'hit' event), with a timeout so it can never hang
    const ready = f.timing === 'event' ? (a.go === true || a.t >= Math.max(1, move.windup * 3)) : a.t >= move.windup;
    if (!ready) return;
    a.t = f.timing === 'event' ? 0 : a.t - move.windup;
    a.phase = 'active';
    sim.events.push({ type: 'swing', id: f.id, weapon: weapon.id, move: move.name, index: a.move });
  }
  if (a.phase === 'active') {
    if (move.lunge > 0) { const [fx, fy] = dirOf(f.facing); a.dx = fx * move.lunge / move.active; a.dy = fy * move.lunge / move.active; }
    strikeTargets(sim, f, weapon, move, a.t / move.active);
    if (f.act !== a || a.t < move.active) return;
    a.t -= move.active; a.phase = 'recovery'; a.dx = 0; a.dy = 0;
  }
  if (a.phase === 'recovery') {
    const next = a.move + 1;
    if (a.buffered && next < weapon.moves.length && a.t >= move.chainAt) { startAttack(sim, f, next); return; }
    if (a.t >= move.recovery) {
      f.combo = { next: next < weapon.moves.length ? next : 0, t: weapon.comboGrace };
      setAct(f, 'idle');
      sim.events.push({ type: 'recover', id: f.id });
    }
  }
}

/** stepGuard(sim, fighter, dt) raises or lowers the guard from the block input and refills the guard meter. */
export function stepGuard(sim, f, dt) {
  const shield = guardOf(sim.cfg, f);
  const g = f.guard;
  if (!shield) { g.on = false; g.meter = 0; return; }
  if (g.meter < 0 || g.meter > shield.guard) g.meter = shield.guard;
  const want = f.input.block && f.act.kind === 'idle' && g.meter > 0;
  if (want && !g.on) { g.on = true; g.t = 0; sim.events.push({ type: 'guard', id: f.id, on: true }); }
  else if (!want && g.on) { g.on = false; sim.events.push({ type: 'guard', id: f.id, on: false }); }
  else if (g.on) g.t = round(g.t + dt);
  if (!g.on) g.meter = round(Math.min(shield.guard, g.meter + shield.regen * dt));
}

/** startDodge(sim, fighter) -> true when the roll started. Rolls along the movement input, or backward when standing still. */
export function startDodge(sim, f) {
  const d = f.dodge;
  if (!d || f.dodgeCd > 0) return false;
  if (f.act.kind !== 'idle' && !(f.act.kind === 'attack' && f.act.phase === 'recovery')) return false;
  let dx = f.input.moveX; let dy = f.input.moveY;
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) { dx /= len; dy /= len; } else { const [fx, fy] = dirOf(f.facing); dx = -fx; dy = -fy; }
  setAct(f, 'dodge', { dur: d.time, dx: dx * d.speed, dy: dy * d.speed });
  f.guard.on = false;
  f.combo = { next: 0, t: 0 };
  f.iframes = Math.max(f.iframes, d.iframes);
  f.dodgeCd = d.cooldown;
  sim.events.push({ type: 'dodge', id: f.id, dx: round(dx), dy: round(dy) });
  return true;
}

/**
 * stepIntent(sim, fighter, dt, startThrow) turns the fighter's input into actions: attack (with combo
 * buffering), dodge, throw. Buttons act on the press, so a held button does not repeat.
 */
export function stepIntent(sim, f, dt, startThrow) {
  const i = f.input; const h = f.held;
  const pressed = { attack: i.attack && !h.attack, dodge: i.dodge && !h.dodge, throw: i.throw && !h.throw };
  h.attack = i.attack; h.dodge = i.dodge; h.throw = i.throw;
  if (f.combo.t > 0 && f.act.kind === 'idle') { f.combo.t -= dt; if (f.combo.t <= 0) f.combo = { next: 0, t: 0 }; }
  if (statusMods(sim.cfg, f).stun || f.act.kind === 'stagger') return;
  if (pressed.dodge && startDodge(sim, f)) return;
  if (f.act.kind === 'idle') {
    faceInput(f);
    if (pressed.attack) startAttack(sim, f, f.combo.t > 0 ? f.combo.next : 0);
    else if (pressed.throw) startThrow(sim, f);
  } else if (f.act.kind === 'attack' && pressed.attack) {
    f.act.buffered = true;
  }
}
