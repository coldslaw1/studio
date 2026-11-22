// Walking. An agent with a goal asks for a path (a few per step, so a crowd never stalls a frame),
// follows it with a look ahead for things in the way, and notices when it is getting nowhere:
// first it plans again, and after three tries it says so ('stuck') instead of walking into a wall forever.
import { dist, q } from './util.js';
import { steerAround } from './steer.js';

const facingOf = (dx, dy) => q(Math.atan2(dx, -dy) * 180 / Math.PI); // 0 up, 90 right, 180 down (as ai, combat, puppet)

function plan(ctx, a) {
  const res = ctx.findPath(a, a.goal, { radius: a.radius });
  a.asked = -1; a.pathV = ctx.field.version; a.planned = ctx.state.tick;
  if (!res.points.length) {
    a.path = null;
    if (a.status !== 'blocked') { a.status = 'blocked'; ctx.emit({ type: 'blocked', id: a.id, x: a.goal.x, y: a.goal.y }); }
    return;
  }
  a.path = res.points; a.complete = res.complete; a.snapped = res.snapped; a.status = 'moving';
  ctx.emit({ type: 'path', id: a.id, complete: res.complete, snapped: res.snapped, points: res.points.length });
}

// Is the rest of the path still walkable (after the ground or a prop changed)?
function pathStillClear(field, a) {
  let px = a.x; let py = a.y;
  for (const p of a.path) {
    if (!field.lineClear(px, py, p[0], p[1], a.radius * 0.85)) return false;
    px = p[0]; py = p[1];
  }
  return true;
}

function moveBody(ctx, a, dx, dy, ghost) {
  if (ctx.mover) {
    const p = ctx.mover(a, dx, dy, ghost);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { a.x = q(p.x); a.y = q(p.y); return; }
    // the mover returned nothing: it does not handle this agent, so slide on the field as usual
  }
  const f = ctx.field; const r = a.radius * 0.9;
  let nx = a.x + dx; let ny = a.y + dy;
  if (!ghost && !f.mayStep(a.x, a.y, nx, ny, r)) { // slide along it instead of stopping dead
    if (f.mayStep(a.x, a.y, nx, a.y, r)) ny = a.y; else if (f.mayStep(a.x, a.y, a.x, ny, r)) nx = a.x; else { nx = a.x; ny = a.y; }
  }
  a.x = q(nx); a.y = q(ny);
}

function arriveAt(ctx, a) {
  const snapped = a.snapped;
  a.goal = null; a.path = null; a.status = 'arrived'; a.vx = 0; a.vy = 0; a.stuck = 0; a.tries = 0;
  ctx.emit({ type: 'arrive', id: a.id, x: a.x, y: a.y, snapped });
}

function walk(ctx, a, dt, others) {
  const field = ctx.field; const cs = field.cellSize; const goal = a.goal;
  const speed = goal.speed ?? a.speed;
  const ox = a.x; const oy = a.y;
  let wanted = 0;
  if (!field.inside(field.colOf(a.x), field.rowOf(a.y))) {
    // far from play (outside the field): walk straight, as a far-off traveller would
    const d = dist(a.x, a.y, goal.x, goal.y);
    if (d <= goal.arrive) { arriveAt(ctx, a); return; }
    const s = Math.min(speed * dt, d);
    a.x = q(a.x + (goal.x - a.x) / d * s); a.y = q(a.y + (goal.y - a.y) / d * s); a.path = null; a.status = 'moving';
  } else if (!field.fitsAt(a.x, a.y, a.radius * 0.5)) {
    // standing inside something (it moved onto the agent, or the agent was put there): get out the short way
    const out = field.nearestOpen(a.x, a.y, a.radius, 10);
    if (out) { const d = dist(a.x, a.y, out[0], out[1]) || 1; const s = Math.min(speed * dt, d); moveBody(ctx, a, (out[0] - a.x) / d * s, (out[1] - a.y) / d * s, true); }
    wanted = 0;
  } else if (a.path && a.path.length) {
    const path = a.path;
    const reach = Math.max(a.radius * 0.5, cs * 0.3);
    while (path.length > 1 && dist(a.x, a.y, path[0][0], path[0][1]) <= reach) path.shift();
    if (path.length > 1 && (ctx.state.tick + a.n) % 5 === 0 && field.lineClear(a.x, a.y, path[1][0], path[1][1], a.radius)) path.shift();
    const t = path[0]; const final = path.length === 1 && a.complete;
    const d = dist(a.x, a.y, t[0], t[1]);
    if (final && d <= goal.arrive) { arriveAt(ctx, a); return; }
    if (path.length === 1 && !a.complete && d <= reach) { a.asked = ctx.state.tick; return; } // end of a part-way path: plan the next part
    if (d > 1e-9) {
      const len = Math.min(speed * dt, d);
      const probe = (px, py) => {
        if (!field.mayStep(a.x, a.y, px, py, a.radius * 0.9)) return false;
        for (const b of others) {
          if (b === a) continue;
          const gap = (a.radius + b.radius) * 0.9; const now = dist(a.x, a.y, b.x, b.y);
          const then = dist(px, py, b.x, b.y);
          if (then < gap && then < now) return false; // only moving closer counts, so two that overlap can part
        }
        return true;
      };
      const dir = steerAround({ x: a.x, y: a.y, dx: (t[0] - a.x) / d, dy: (t[1] - a.y) / d, look: Math.min(a.radius + cs * 0.75, d), first: 1 }, probe, a.mem);
      wanted = len;
      if (!dir.blocked) { moveBody(ctx, a, dir.x * len, dir.y * len, false); a.facing = facingOf(dir.x, dir.y); }
    }
  }
  const moved = dist(ox, oy, a.x, a.y);
  a.vx = dt > 0 ? q((a.x - ox) / dt) : 0; a.vy = dt > 0 ? q((a.y - oy) / dt) : 0;
  if (wanted > 0 && moved < wanted * 0.25) {
    a.stuck = q(a.stuck + dt);
    if (a.stuck >= ctx.cfg.stuckTime) {
      a.stuck = 0; a.tries += 1; a.mem.side = 0; a.mem.hold = 0;
      if (a.tries >= 3) {
        a.goal = null; a.path = null; a.status = 'stuck'; a.tries = 0; a.vx = 0; a.vy = 0;
        ctx.emit({ type: 'stuck', id: a.id, x: a.x, y: a.y });
      } else { a.asked = ctx.state.tick; ctx.emit({ type: 'repath', id: a.id, why: 'no progress' }); }
    }
  } else if (moved > 0) { a.stuck = 0; if (a.goal && ctx.state.tick - a.planned > 60) a.tries = 0; }
}

/**
 * stepAgents(ctx, dt) advances every agent by dt seconds, in id order. ctx is made by createNav:
 * { cfg, state, field, findPath, emit, mover }.
 */
export function stepAgents(ctx, dt) {
  const { state, cfg, field } = ctx;
  const list = state.order.map((id) => state.agents[id]);
  // 1. who needs a (new) path
  const asking = [];
  for (const a of list) {
    if (!a.goal) continue;
    if (a.path && a.pathV !== field.version) { // the ground or a prop changed since this path was made
      a.pathV = field.version;
      if (!a.complete || !pathStillClear(field, a)) { a.asked = state.tick; ctx.emit({ type: 'repath', id: a.id, why: 'world changed' }); }
    } else if (a.status === 'blocked' && (a.pathV !== field.version || state.tick - a.planned > cfg.retryTicks)) a.asked = state.tick;
    else if (!a.path && a.status !== 'blocked' && a.asked < 0) a.asked = state.tick;
    if (a.asked >= 0) asking.push(a);
  }
  asking.sort((p, r) => p.asked - r.asked || (p.id < r.id ? -1 : 1));
  for (let i = 0; i < asking.length && i < cfg.pathsPerStep; i++) plan(ctx, asking[i]);
  // 2. walk
  const walkers = cfg.avoid ? list : [];
  for (const a of list) {
    if (!a.goal) { a.vx = 0; a.vy = 0; continue; }
    let near = walkers;
    if (walkers.length > 24) near = walkers.filter((b) => Math.abs(b.x - a.x) < 4 * cfg.maxRadius && Math.abs(b.y - a.y) < 4 * cfg.maxRadius);
    walk(ctx, a, dt, near);
  }
  state.tick += 1;
}
