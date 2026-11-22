// Thrown weapons in flight. A projectile has a ground position (x, y) and a
// height (z), falls under gravity, spins, and is swept every step so it never
// passes through a thin wall or a fighter. What it meets first this step
// (scenery, a fighter, the ground) decides what happens: stick, bounce, drop or break.
import { round } from './util.js';
import { hurt } from './damage.js';
import { sceneryBlocks } from './hitbox.js';
import { aimAt } from './aim.js';

/** launch(sim, fields) adds a flying projectile and returns it. fields: { kind, owner, faction, x, y, z, vx, vy, vz, amount, item }. */
export function launch(sim, o) {
  const p = {
    id: `p${sim.state.seq++}`, kind: o.kind, owner: o.owner ?? null, faction: o.faction ?? null,
    x: round(o.x), y: round(o.y), z: round(o.z), vx: round(o.vx), vy: round(o.vy), vz: round(o.vz),
    angle: 0, age: 0, mode: 'fly', in: null, off: null, bounces: 0, hit: [], ttl: null, amount: o.amount ?? 0, item: o.item ?? null,
  };
  sim.state.projectiles.push(p);
  return p;
}

function settle(sim, p, def, mode, into) {
  p.mode = mode; p.vx = 0; p.vy = 0; p.vz = 0; p.ttl = def.restTtl;
  sim.events.push({ type: mode === 'rest' ? 'rest' : 'stick', proj: p.id, kind: p.kind, into, x: p.x, y: p.y, z: p.z });
}

function shatter(sim, p, def) {
  p.mode = 'gone';
  sim.events.push({ type: 'break', proj: p.id, kind: p.kind, x: p.x, y: p.y, z: p.z });
  if (!def.splash) return;
  for (const id of Object.keys(sim.state.fighters).sort()) {
    const f = sim.state.fighters[id];
    if (!f.alive || Math.hypot(f.x - p.x, f.y - p.y) > def.splash.radius + f.radius || p.z > f.z + f.height + def.splash.radius) continue;
    hurt(sim, { target: id, source: p.owner, faction: p.faction, via: 'projectile', amount: def.splash.damage, type: def.splash.type, statuses: def.splash.statuses, fromX: p.x, fromY: p.y, blockable: false, proj: p.id });
  }
}

function bounceOff(sim, p, def, nx, ny, surface) {
  const into = p.vx * nx + p.vy * ny;
  if (into < 0) { p.vx -= 2 * into * nx; p.vy -= 2 * into * ny; }
  p.vx = round(p.vx * def.bounce); p.vy = round(p.vy * def.bounce);
  p.bounces += 1;
  sim.events.push({ type: 'bounce', proj: p.id, kind: p.kind, surface, x: p.x, y: p.y, z: p.z });
}

// what does the projectile meet first on its way (dx, dy, dz)? -> { t, what, ... } or null
function firstContact(sim, p, def, dx, dy, dz) {
  const { state, cfg } = sim;
  const circle = { x: p.x, y: p.y, r: def.radius };
  let best = null;
  const flat = dx !== 0 || dy !== 0;
  if (cfg.world && flat) {
    const ignore = [];
    for (let i = 0; i < 12; i++) {
      const hit = cfg.world.cast(circle, dx, dy, { mask: cfg.sceneryMask, ignore });
      if (!hit) break;
      const zc = p.z + dz * hit.t;
      if (sceneryBlocks(hit.body, zc - def.radius, zc + def.radius)) { best = { t: hit.t, what: 'wall', nx: hit.nx, ny: hit.ny }; break; }
      ignore.push(hit.body);
    }
  }
  for (const id of Object.keys(state.fighters).sort()) {
    const f = state.fighters[id];
    if (!f.alive || p.hit.includes(id) || (id === p.owner && p.age < def.grace)) continue;
    const target = { x: f.x, y: f.y, r: f.radius };
    const hit = flat ? cfg.collision.sweep(circle, dx, dy, target) : (cfg.collision.overlaps(circle, target) ? { t: 0, nx: 0, ny: 0 } : null);
    if (!hit || (best && hit.t >= best.t)) continue;
    const zc = p.z + dz * hit.t;
    if (zc + def.radius < f.z || zc - def.radius > f.z + f.height) continue;
    let nx = hit.nx; let ny = hit.ny;
    if (hit.overlap || (nx === 0 && ny === 0)) { const d = Math.hypot(p.x - f.x, p.y - f.y) || 1; nx = (p.x - f.x) / d; ny = (p.y - f.y) / d; }
    best = { t: hit.t, what: 'fighter', id, nx, ny };
  }
  const g0 = cfg.groundAt(p.x, p.y); const g1 = cfg.groundAt(p.x + dx, p.y + dy);
  const above0 = p.z - g0; const above1 = p.z + dz - g1;
  if (above1 <= 0) {
    const t = above0 <= 0 ? 0 : above0 / (above0 - above1);
    if (!best || t < best.t) best = { t, what: 'ground' };
  }
  return best;
}

function hitFighter(sim, p, def, c) {
  const target = sim.state.fighters[c.id];
  p.hit.push(c.id);
  // a spinning blade only bites while its edge leads; otherwise the handle lands a weaker blow
  const edge = def.blade === null || Math.abs((((p.angle % 360) + 540) % 360) - 180) <= def.blade / 2;
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const res = hurt(sim, {
    target: c.id, source: p.owner, faction: p.faction, via: 'projectile', amount: p.amount * (edge ? 1 : def.blunt), type: edge ? def.type : 'blunt',
    fromX: p.x - p.vx / speed, fromY: p.y - p.vy / speed, knockback: def.knockback, hitstop: def.hitstop, stagger: def.stagger,
    statuses: edge ? def.statuses : [], crit: def.crit, blockable: def.blockable, parryable: def.parryable, weapon: p.kind, proj: p.id,
  });
  if (res.outcome === 'none' || res.outcome === 'friendly' || res.outcome === 'immune') return false; // flies on
  if (res.outcome === 'parried') {
    // sent back at whoever threw it (straight back when they are gone): it now belongs to the fighter who parried it
    const thrower = sim.state.fighters[p.owner];
    const back = thrower && thrower.alive && thrower.id !== target.id
      ? aimAt(p, { x: thrower.x, y: thrower.y, z: thrower.z + thrower.height * 0.5 }, def.speed, sim.cfg.gravity * def.gravity) : null;
    if (back) { p.vx = round(back.vx); p.vy = round(back.vy); p.vz = round(back.vz); } else { p.vx = round(-p.vx); p.vy = round(-p.vy); p.vz = round(Math.max(p.vz, 0)); }
    p.owner = target.id; p.faction = target.faction; p.hit = []; p.age = 0;
    sim.events.push({ type: 'reflect', proj: p.id, kind: p.kind, by: target.id, x: p.x, y: p.y, z: p.z });
    return true;
  }
  const how = res.outcome === 'blocked' ? 'bounce' : (def.onHit === 'stick' && !edge ? 'bounce' : def.onHit);
  if (how === 'break') shatter(sim, p, def);
  else if (how === 'bounce') bounceOff(sim, p, def, c.nx, c.ny, res.outcome === 'blocked' ? 'shield' : 'fighter');
  else if (how === 'drop' || (how === 'stick' && !target.alive)) { p.vx = 0; p.vy = 0; p.vz = Math.min(p.vz, 0); }
  else if (how === 'stick') {
    p.mode = 'stuck'; p.in = target.id; p.off = { x: round(p.x - target.x), y: round(p.y - target.y), z: round(p.z - target.z) };
    p.vx = 0; p.vy = 0; p.vz = 0; p.ttl = def.stuckTtl;
    sim.events.push({ type: 'stick', proj: p.id, kind: p.kind, into: 'fighter', id: target.id, x: p.x, y: p.y, z: p.z });
  }
  return true;
}

function fly(sim, p, def, dt) {
  const { cfg } = sim;
  const g = cfg.gravity * def.gravity;
  p.age = round(p.age + dt);
  if (p.age > def.life) { p.mode = 'gone'; sim.events.push({ type: 'expire', proj: p.id, kind: p.kind }); return; }
  let left = dt;
  for (let pass = 0; pass < 4 && left > 1e-9 && p.mode === 'fly'; pass++) {
    const dx = p.vx * left; const dy = p.vy * left; const dz = p.vz * left - 0.5 * g * left * left;
    const c = firstContact(sim, p, def, dx, dy, dz);
    const t = c ? c.t : 1;
    p.x = round(p.x + dx * t); p.y = round(p.y + dy * t); p.z = round(p.z + dz * t);
    p.vz = round(p.vz - g * left * t);
    p.angle = round((p.angle + def.spin * left * t) % 360);
    left *= 1 - t;
    if (!c) break;
    if (c.what === 'fighter') { if (hitFighter(sim, p, def, c)) left = 0; continue; }
    if (c.what === 'wall') {
      if (def.onWall === 'break') shatter(sim, p, def);
      else if (def.onWall === 'stick') settle(sim, p, def, 'stuck', 'wall');
      else if (def.onWall === 'bounce' && p.bounces < def.maxBounces) bounceOff(sim, p, def, c.nx, c.ny, 'wall');
      else { const into = p.vx * c.nx + p.vy * c.ny; if (into < 0) { p.vx = 0; p.vy = 0; } }
      left = 0; continue;
    }
    p.z = round(cfg.groundAt(p.x, p.y));
    if (def.onGround === 'break') shatter(sim, p, def);
    else if (def.onGround === 'stick') settle(sim, p, def, 'stuck', 'ground');
    else if (def.onGround === 'bounce' && p.bounces < def.maxBounces && -p.vz * def.bounce > def.restSpeed) {
      p.vz = round(-p.vz * def.bounce); p.vx = round(p.vx * def.friction); p.vy = round(p.vy * def.friction);
      p.bounces += 1;
      sim.events.push({ type: 'bounce', proj: p.id, kind: p.kind, surface: 'ground', x: p.x, y: p.y, z: p.z });
    } else settle(sim, p, def, 'rest', 'ground');
    left = 0;
  }
  if (def.drag > 0 && p.mode === 'fly') { const k = Math.max(0, 1 - def.drag * dt); p.vx = round(p.vx * k); p.vy = round(p.vy * k); }
}

/** stepProjectiles(sim, dt) advances every projectile: flight, riding along in a fighter, lying on the ground, expiring. */
export function stepProjectiles(sim, dt) {
  const { state, cfg } = sim;
  for (const p of state.projectiles) {
    const def = cfg.throwables[p.kind];
    if (!def) { p.mode = 'gone'; continue; }
    if (p.mode === 'fly') fly(sim, p, def, dt);
    else if (p.mode === 'stuck' && p.in) {
      const host = state.fighters[p.in];
      p.ttl = round(p.ttl - dt);
      if (host) { p.x = round(host.x + p.off.x); p.y = round(host.y + p.off.y); p.z = round(host.z + p.off.z); }
      if (!host || !host.alive || p.ttl <= 0) { p.mode = 'fly'; p.in = null; p.off = null; p.ttl = null; p.age = 0; p.hit = host ? [host.id] : []; sim.events.push({ type: 'unstick', proj: p.id, kind: p.kind }); }
    } else if (p.ttl !== null) {
      p.ttl = round(p.ttl - dt);
      if (p.ttl <= 0) { p.mode = 'gone'; sim.events.push({ type: 'expire', proj: p.id, kind: p.kind }); }
    }
  }
  if (state.projectiles.some((p) => p.mode === 'gone')) state.projectiles = state.projectiles.filter((p) => p.mode !== 'gone');
}
