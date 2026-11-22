// Movement that combat owns: walking from the input, knockback, lunges, the
// dodge roll, falling after being launched, and keeping fighters from standing
// inside each other. Scenery comes from the collision world's cast(); fighters
// are never bodies in that world, so the whole state stays plain JSON.
import { round } from './util.js';
import { guardOf } from './damage.js';
import { sceneryBlocks } from './hitbox.js';
import { statusMods } from './status.js';

/**
 * slide(cfg, shape, dx, dy, low, high) -> { x, y, hit } moves a circle { x, y, r } through the scenery,
 * sliding along what it runs into. `hit` is the first thing that stopped it ({ nx, ny, body }) or null.
 * Without a collision world the move is free.
 */
export function slide(cfg, shape, dx, dy, low, high) {
  const pos = { x: shape.x, y: shape.y, r: shape.r };
  let first = null;
  if (!cfg.world) return { x: pos.x + dx, y: pos.y + dy, hit: null };
  const ignore = [];
  for (let i = 0; i < 4 && (dx !== 0 || dy !== 0); i++) {
    const hit = cfg.world.cast(pos, dx, dy, { mask: cfg.sceneryMask, ignore });
    if (!hit) { pos.x += dx; pos.y += dy; break; }
    if (!sceneryBlocks(hit.body, low, high)) { ignore.push(hit.body); i--; if (ignore.length > 16) break; continue; }
    first = first || { nx: hit.nx, ny: hit.ny, body: hit.body };
    if (hit.overlap) {
      // started inside something (spawned in a wall, or pushed there): step out the shortest way
      pos.x += hit.nx * ((hit.depth || 0) + cfg.skin); pos.y += hit.ny * ((hit.depth || 0) + cfg.skin);
      continue;
    }
    const len = Math.hypot(dx, dy);
    const t = Math.max(0, hit.t - cfg.skin / len);
    pos.x += dx * t; pos.y += dy * t;
    const rx = dx * (1 - t); const ry = dy * (1 - t);
    const into = rx * hit.nx + ry * hit.ny;
    dx = rx - hit.nx * into; dy = ry - hit.ny * into;
    if (Math.hypot(dx, dy) < 1e-7) break;
  }
  return { x: pos.x, y: pos.y, hit: first };
}

/** moveScale(cfg, fighter) -> 0..1, how much of its walking speed the fighter has right now. */
export function moveScale(cfg, f) {
  if (!f.alive || f.hitstop > 0) return 0;
  const mods = statusMods(cfg, f);
  if (mods.stun) return 0;
  const a = f.act;
  let s = mods.speed;
  if (a.kind === 'stagger' || a.kind === 'dodge') return 0;
  if (a.kind === 'attack') s *= a.phase === 'recovery' ? 0.6 : cfg.weapons[f.weapon].moves[a.move].moveScale;
  else if (a.kind === 'throw') s *= 0.5;
  else if (f.guard.on) s *= guardOf(cfg, f)?.moveScale ?? 0.5;
  return s;
}

/** stepMotion(sim, fighter, dt) moves one fighter for this step. External fighters only get `push` filled in. */
export function stepMotion(sim, f, dt) {
  const { cfg } = sim;
  f.push.dx = 0; f.push.dy = 0;
  if (f.hitstop > 0) return;
  const scale = moveScale(cfg, f);
  let vx = f.kb.vx; let vy = f.kb.vy;
  if (f.alive && (f.act.kind === 'dodge' || f.act.kind === 'attack')) { vx += f.act.dx; vy += f.act.dy; }
  const decay = Math.exp(-cfg.knockbackDecay * dt);
  f.kb.vx = Math.abs(f.kb.vx * decay) < cfg.unit * 0.05 ? 0 : round(f.kb.vx * decay);
  f.kb.vy = Math.abs(f.kb.vy * decay) < cfg.unit * 0.05 ? 0 : round(f.kb.vy * decay);
  if (f.external) {
    f.push.dx = round(vx * dt); f.push.dy = round(vy * dt);
  } else {
    vx += f.input.moveX * f.speed * scale; vy += f.input.moveY * f.speed * scale;
    if (vx !== 0 || vy !== 0) {
      const to = slide(cfg, { x: f.x, y: f.y, r: f.radius }, vx * dt, vy * dt, f.z, f.z + f.height);
      f.x = round(to.x); f.y = round(to.y);
    }
  }
  const ground = cfg.groundAt(f.x, f.y);
  if (f.vz !== 0 || f.z > ground + 1e-6) {
    f.vz -= cfg.gravity * dt;
    f.z += f.vz * dt;
    if (f.z <= ground) { f.z = ground; f.vz = 0; } else { f.z = round(f.z); f.vz = round(f.vz); }
  } else if (!f.external) f.z = ground;
}

/** separate(sim) nudges living fighters apart when their circles overlap, in id order so every machine agrees. */
export function separate(sim) {
  const { state, cfg } = sim;
  if (!cfg.separate) return;
  const ids = Object.keys(state.fighters).sort();
  for (let i = 0; i < ids.length; i++) {
    const a = state.fighters[ids[i]];
    if (!a.alive) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const b = state.fighters[ids[j]];
      if (!b.alive || a.z > b.z + b.height || b.z > a.z + a.height) continue;
      let dx = b.x - a.x; let dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const gap = a.radius + b.radius - d;
      if (gap <= 0) continue;
      if (d < 1e-6) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
      const dodging = a.act.kind === 'dodge' || b.act.kind === 'dodge';
      if (dodging) continue; // a roll passes through
      for (const [f, sign, other] of [[a, -1, b], [b, 1, a]]) {
        if (f.external) { f.push.dx = round(f.push.dx + sign * dx * gap * 0.5); f.push.dy = round(f.push.dy + sign * dy * gap * 0.5); continue; }
        const share = other.external ? 1 : 0.5;
        const to = slide(cfg, { x: f.x, y: f.y, r: f.radius }, sign * dx * gap * share, sign * dy * gap * share, f.z, f.z + f.height);
        f.x = round(to.x); f.y = round(to.y);
      }
    }
  }
}
