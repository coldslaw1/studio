// Getting about. Behaviours only say WHERE to go (go / halt); this file turns that into a velocity each
// step: straight there when the way is clear, along an A* path or a shared flow field when it is not,
// nudged apart from neighbours, and finally into the agent's intent and (unless something else moves the
// body) its position.
import { dist, len, q, clamp, facingOf } from './util.js';
import { arrive, separation, avoidWalls, blend, followPath } from './steering.js';

/**
 * go(agent, x, y, options) asks the agent to walk to a point. Call it every tick while the wish holds;
 * the path is only re-planned when the point has moved a fair way.
 *   run = false (use the running speed), arrive = the agent's radius (stop this close), flow = false
 *   (true: may share a flow field with others heading for the same target)
 */
export function go(agent, x, y, options = {}) {
  let nav = agent.nav;
  if (!nav) nav = agent.nav = { tx: 0, ty: 0, run: false, arrive: 0, path: null, pending: false, asked: 0, gx: null, gy: null, tries: 0, failed: false, flow: null, see: false, seeT: 0 };
  if (dist(nav.tx, nav.ty, x, y) > agent.radius * 2) { nav.seeT = 0; if (nav.failed) { nav.failed = false; nav.tries = 0; } }
  nav.tx = q(x); nav.ty = q(y);
  nav.run = options.run === true;
  nav.arrive = q(options.arrive ?? agent.radius);
  nav.flow = options.flow ?? null;
  return nav;
}

/** halt(agent) forgets where the agent was going. */
export function halt(agent) {
  agent.nav = null;
}

/** arrived(agent) -> true when the agent has no destination or is within its arrive distance of it. */
export function arrived(agent) {
  const nav = agent.nav;
  return !nav || dist(agent.x, agent.y, nav.tx, nav.ty) <= nav.arrive + 1e-6;
}

/** navFailed(agent) -> true when the destination turned out to be unreachable (no path, or stuck three times). */
export const navFailed = (agent) => !!agent.nav && agent.nav.failed;

// The point to walk at right now, or null to stand still.
function waypoint(ctx, agent, nav) {
  const { grid } = ctx;
  if (!grid) return [nav.tx, nav.ty, true];
  // "can I walk straight there?" is asked five times a second, not every step: tracing a long line is the
  // most expensive thing a walking agent does. Beyond 40 cells it goes by path anyway.
  const fresh = ctx.time >= nav.seeT;
  if (fresh) {
    nav.see = dist(agent.x, agent.y, nav.tx, nav.ty) <= grid.cellSize * 40 && grid.lineClear(agent.x, agent.y, nav.tx, nav.ty);
    nav.seeT = q(ctx.time + 0.2);
  }
  if (nav.see) { nav.path = null; nav.pending = false; return [nav.tx, nav.ty, true]; }
  if (nav.flow) {
    const field = ctx.field(nav.flow);
    const dir = field && field.dirAt(agent.x, agent.y);
    if (dir) return [agent.x + dir[0] * grid.cellSize, agent.y + dir[1] * grid.cellSize, false];
  }
  const d = dist(agent.x, agent.y, nav.tx, nav.ty);
  const stale = nav.gx === null || dist(nav.gx, nav.gy, nav.tx, nav.ty) > Math.max(grid.cellSize * 1.5, d * 0.25);
  if ((!nav.path || stale) && !nav.pending && !nav.failed) { nav.pending = true; nav.asked = ctx.tick; }
  if (!nav.path || !nav.path.length) return null;
  const f = followPath(agent, nav.path, Math.max(grid.cellSize * 0.45, agent.radius));
  // skip ahead when the waypoint after next is already in a clear line
  while (fresh && nav.path.length > 1 && grid.lineClear(agent.x, agent.y, nav.path[1][0], nav.path[1][1])) nav.path.shift();
  return f.target ? [nav.path[0][0], nav.path[0][1], nav.path.length === 1 && !stale] : null;
}

/**
 * locomote(ctx, agent, dt, tier) works out this step's movement, writes agent.intent.moveX / moveY / run
 * and agent.vx / vy, and moves the agent unless agent.driven is true. Tier 0 agents also keep apart from
 * their neighbours; tiers 1 and 2 skip that to stay cheap.
 */
export function locomote(ctx, agent, dt, tier) {
  const intent = agent.intent;
  const c = agent.combat;
  let v = [0, 0];
  let top = agent.speed;
  const nav = agent.nav;
  if (c.state === 'charge') {
    top = agent.run * 1.5;
    v = [c.dirX * top, c.dirY * top];
  } else if (nav && !agent.talk && !agent.staggered) {
    top = nav.run ? agent.run : agent.speed;
    const d = dist(agent.x, agent.y, nav.tx, nav.ty);
    if (d > nav.arrive) {
      const w = waypoint(ctx, agent, nav);
      if (w) {
        v = arrive(agent, w[0], w[1], top, w[2] ? top * 0.25 : 0);
        // never step past the stopping distance
        if (w[2] && dt > 0) { const room = (d - nav.arrive) / dt; const s = len(v[0], v[1]); if (s > room && s > 0) v = [v[0] / s * room, v[1] / s * room]; }
      }
    }
  }
  if (tier === 0 && !agent.talk) {
    // keep apart from neighbours, but not from the one being attacked: a fighter must be free to close in
    const push = separation(agent, ctx.nearAny(agent.x, agent.y, agent.radius * 2.4), agent.radius * 2.4, agent.target);
    if (push[0] !== 0 || push[1] !== 0) {
      v = blend([[v, 1], [push, top * 0.8]], top);
      if (ctx.grid) v = avoidWalls(ctx.grid, agent, v, agent.radius * 2 + ctx.grid.cellSize * 0.5, agent.seed & 1 ? 1 : -1);
    }
  }
  const scale = agent.run > 0 ? 1 / agent.run : 0;
  const m = len(v[0], v[1]) * scale;
  const cut = m > 1 ? 1 / m : 1;
  intent.moveX = q(v[0] * scale * cut); intent.moveY = q(v[1] * scale * cut);
  intent.run = top > agent.speed + 1e-9;

  const wanted = len(v[0], v[1]);
  if (!agent.driven) {
    const k = tier === 0 ? Math.min(1, 12 * dt) : 1; // a little inertia up close, none for coarse steps
    agent.vx = q(agent.vx + (v[0] - agent.vx) * k); agent.vy = q(agent.vy + (v[1] - agent.vy) * k);
    if (Math.abs(agent.vx) < 1e-4 && Math.abs(agent.vy) < 1e-4) { agent.vx = 0; agent.vy = 0; }
    if (agent.vx !== 0 || agent.vy !== 0) step(ctx, agent, agent.vx * dt, agent.vy * dt);
  }
  // facing: what the behaviour asked for, else the way it is walking
  if (intent.face !== null) agent.facing = intent.face;
  else if (wanted > agent.speed * 0.15) agent.facing = facingOf(v[0], v[1]);

  // stuck: wanting to move but getting nowhere means the path is wrong
  const moved = dist(agent.x, agent.y, agent.lx ?? agent.x, agent.ly ?? agent.y);
  agent.lx = agent.x; agent.ly = agent.y;
  if (nav && wanted > top * 0.4 && dt > 0 && moved < wanted * dt * 0.2) {
    agent.stuck = q(agent.stuck + dt);
    if (agent.stuck > 1.2) {
      agent.stuck = 0; nav.path = null; nav.gx = null; nav.tries += 1;
      if (nav.tries >= 3) nav.failed = true;
    }
  } else agent.stuck = 0;
}

function step(ctx, agent, dx, dy) {
  if (ctx.cfg.move) { // the game moves the body (collision engine): it returns where the agent ended up
    const p = ctx.cfg.move(agent, dx, dy);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { agent.x = q(p.x); agent.y = q(p.y); }
    return;
  }
  const { grid } = ctx;
  let nx = agent.x + dx; let ny = agent.y + dy;
  if (grid && !grid.openAt(nx, ny)) { // slide along the wall instead of stopping dead
    if (grid.openAt(nx, agent.y)) ny = agent.y;
    else if (grid.openAt(agent.x, ny)) nx = agent.x;
    else { nx = agent.x; ny = agent.y; }
  }
  agent.x = q(nx); agent.y = q(ny);
}

/**
 * travel(ctx, agent, x, y, seconds, speed) moves a far-away agent toward a point without path-finding:
 * straight for as far as `seconds` of walking allows, then snapped to open ground. Returns true on arrival.
 */
export function travel(ctx, agent, x, y, seconds, speed) {
  const d = dist(agent.x, agent.y, x, y);
  const reach = speed * seconds;
  let nx = x; let ny = y;
  if (d > reach && d > 0) { nx = agent.x + (x - agent.x) / d * reach; ny = agent.y + (y - agent.y) / d * reach; }
  if (ctx.grid && !ctx.grid.openAt(nx, ny)) {
    const p = ctx.grid.nearestOpen(nx, ny, 6);
    if (p) { nx = p[0]; ny = p[1]; } else { nx = agent.x; ny = agent.y; }
  }
  if (nx !== agent.x || ny !== agent.y) agent.facing = facingOf(nx - agent.x, ny - agent.y);
  agent.x = q(clamp(nx, -1e9, 1e9)); agent.y = q(ny); agent.vx = 0; agent.vy = 0;
  agent.lx = agent.x; agent.ly = agent.y;
  return d <= reach + 1e-6;
}
