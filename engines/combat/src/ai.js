// Mob AI hooks. A fighter with an `ai` block gets its input written every
// step by a brain: find a hostile in sight (aggro), walk into attack range,
// telegraph, strike, cool down, and give up past the leash. Brains only fill
// in the same input a player would send, so mobs obey every combat rule.
import { emptyInput } from './state.js';
import { facingOf, round } from './util.js';
import { clearLine, moveOutline } from './hitbox.js';
import { throwableOf } from './throwing.js';

const AI_DEFAULTS = { brain: 'melee', sight: 8, leash: 16, range: null, keep: 6, telegraph: 0.35, cooldown: 0.8, combo: 1, los: true };

/** makeBrain(cfg, fighter, options) -> the fighter's ai block. Lengths not given are the defaults in metres times cfg.unit. */
export function makeBrain(cfg, f, options = {}) {
  const ai = { ...AI_DEFAULTS, ...options };
  for (const key of ['sight', 'leash', 'keep']) if (!(key in options)) ai[key] = AI_DEFAULTS[key] * cfg.unit;
  if (!cfg.brains[ai.brain]) throw new Error(`addFighter("${f.id}"): unknown ai brain "${ai.brain}". Known: ${Object.keys(cfg.brains).join(', ')}`);
  return { ...ai, state: 'idle', t: 0, target: null, home: ai.home ?? { x: f.x, y: f.y }, threat: {}, swings: 0, swinging: false };
}

/** reachOf(cfg, fighter) -> how far the fighter's first move reaches from its centre. */
export function reachOf(cfg, f) {
  const shape = cfg.weapons[f.weapon].moves[0].shape;
  return shape.kind === 'arc' ? shape.reach : shape.start + shape.length;
}

/**
 * pickTarget(sim, fighter) -> the id of the hostile to go for, or null. Whoever hurt it most comes first,
 * then the nearest; ties go to the lower id. A target must be alive, within sight (1.5 times sight once it
 * has drawn blood) and, with `los`, not hidden behind scenery.
 */
export function pickTarget(sim, f) {
  const { state, cfg } = sim;
  const ai = f.ai;
  let best = null; let bestThreat = -1; let bestD = Infinity;
  for (const id of Object.keys(state.fighters).sort()) {
    const t = state.fighters[id];
    if (id === f.id || !t.alive || !cfg.factions.hostile(f.faction, t.faction)) continue;
    const d = Math.hypot(t.x - f.x, t.y - f.y);
    const threat = ai.threat[id] || 0;
    if (d > ai.sight * (threat > 0 ? 1.5 : 1)) continue;
    if (ai.los && threat === 0 && !clearLine(cfg, f.x, f.y, t.x, t.y, f.z + f.height * 0.8, f.z + f.height * 0.9)) continue;
    if (threat > bestThreat || (threat === bestThreat && d < bestD)) { best = id; bestThreat = threat; bestD = d; }
  }
  return best;
}

function walk(sim, f, input, tx, ty, away = false) {
  let dx = tx - f.x; let dy = ty - f.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  if (sim.cfg.steer) { const s = sim.cfg.steer(f, tx, ty); if (s) { dx = s[0]; dy = s[1]; } }
  const n = Math.hypot(dx, dy) || 1;
  input.moveX = round((away ? -1 : 1) * dx / n); input.moveY = round((away ? -1 : 1) * dy / n);
}

function engage(sim, f, input, kind) {
  const { cfg, state } = sim;
  const ai = f.ai;
  const t = state.fighters[ai.target];
  const d = Math.hypot(t.x - f.x, t.y - f.y);
  const throws = kind === 'thrower' && throwableOf(cfg, f) && !(f.ammo && !((f.ammo[throwableOf(cfg, f)] || 0) > 0));
  const range = throws ? ai.keep * 1.2 : (ai.range ?? reachOf(cfg, f) * 0.85) + t.radius;
  input.face = round(facingOf(t.x - f.x, t.y - f.y));
  // a guard stops what it is planning and raises its shield while its target winds up or swings nearby
  if (kind === 'guard' && ai.state !== 'attack' && t.act.kind === 'attack' && t.act.phase !== 'recovery' && d < range * 1.6) { input.block = true; return; }
  if (ai.state === 'chase') {
    if (throws && d < ai.keep * 0.6) walk(sim, f, input, t.x, t.y, true);
    else if (d > range) walk(sim, f, input, t.x, t.y);
    else if (f.act.kind === 'idle') {
      ai.state = 'telegraph'; ai.t = ai.telegraph; ai.swings = 0;
      const move = cfg.weapons[f.weapon].moves[0];
      sim.events.push({ type: 'telegraph', id: f.id, target: t.id, time: ai.telegraph, attack: throws ? 'throw' : 'melee', shape: throws ? null : moveOutline(cfg, { ...f, facing: input.face }, move) });
    }
  } else if (ai.state === 'telegraph') {
    ai.t -= sim.dt;
    if (f.act.kind === 'stagger') { ai.state = 'cooldown'; ai.t = ai.cooldown; }
    else if (ai.t <= 0) {
      ai.state = 'attack'; ai.swinging = false; ai.swings = 1; ai.t = 2;
      if (throws) { input.throw = true; input.aimX = round(t.x); input.aimY = round(t.y); } else input.attack = true;
    }
  } else if (ai.state === 'attack') {
    ai.t -= sim.dt;
    const busy = f.act.kind === 'attack' || f.act.kind === 'throw';
    if (busy) ai.swinging = true;
    // chain the combo: press again once per move, on a step where the button is up
    if (f.act.kind === 'attack' && ai.swings < ai.combo && f.act.phase !== 'windup' && !f.act.buffered && !f.held.attack) { input.attack = true; ai.swings += 1; }
    if ((ai.swinging && !busy) || ai.t <= 0) { ai.state = 'cooldown'; ai.t = ai.cooldown; }
  } else if (ai.state === 'cooldown') {
    ai.t -= sim.dt;
    if (ai.t <= 0) ai.state = 'chase';
  }
}

function standard(kind) {
  return (sim, f, input) => {
    const ai = f.ai;
    const home = Math.hypot(f.x - ai.home.x, f.y - ai.home.y);
    let target = ai.target && sim.state.fighters[ai.target]?.alive ? ai.target : null;
    const locked = ai.state === 'telegraph' || ai.state === 'attack';
    if (!locked) target = home > ai.leash ? null : pickTarget(sim, f) ?? null;
    if (target !== ai.target) {
      if (target) sim.events.push({ type: 'aggro', id: f.id, target });
      else { sim.events.push({ type: 'deaggro', id: f.id }); ai.threat = {}; }
      ai.target = target;
      ai.state = target ? 'chase' : 'return';
    }
    if (target) { if (ai.state === 'idle' || ai.state === 'return') ai.state = 'chase'; engage(sim, f, input, kind); return; }
    if (ai.state !== 'idle') {
      ai.state = 'return';
      if (home <= f.radius) ai.state = 'idle'; else walk(sim, f, input, ai.home.x, ai.home.y);
    }
  };
}

/**
 * BRAINS -> the built-in brains: melee (close in and swing), thrower (keep a distance and throw, melee when out of ammo),
 * guard (melee, but raises its shield when its target winds up). A brain is (sim, fighter, input) => void: it fills
 * in `input` (see emptyInput) and may keep notes in fighter.ai. It must not read the clock or Math.random.
 */
export const BRAINS = { melee: standard('melee'), thrower: standard('thrower'), guard: standard('guard') };

/** stepAi(sim, fighter) writes this step's input for a fighter that has a brain. */
export function stepAi(sim, f) {
  if (!f.ai) return;
  const input = emptyInput();
  if (f.alive) sim.cfg.brains[f.ai.brain](sim, f, input);
  f.input = input;
}
