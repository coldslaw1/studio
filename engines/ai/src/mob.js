// Fighting, from the mob's side: close in (or hold a bow's distance, or line up a charge), show the
// attack coming, strike, recover. The engine only decides intentions: with the combat engine bound, the
// 'attack' button it presses becomes a real swing there; on its own it settles hits with a simple
// reach-and-arc test (see strike in ai.js).
import { dist, facingOf, q } from './util.js';
import { roll } from './rng.js';
import { go, halt } from './move.js';

const lastKnown = (ctx, agent, target) => {
  const seen = agent.seen[target.id];
  const fresh = seen && ctx.time - seen.t <= ctx.cfg.senseEvery * 2 + 0.05;
  return { x: fresh ? target.x : seen ? seen.x : target.x, y: fresh ? target.y : seen ? seen.y : target.y, fresh: !!fresh };
};

// The way to a place on the far side of the target leads AROUND the target, not through it: when the
// straight line would pass close by, head for a point a part-turn round the ring instead.
function aroundTo(agent, at, sx, sy) {
  const ax = agent.x - at.x; const ay = agent.y - at.y;
  const bx = sx - at.x; const by = sy - at.y;
  const ra = Math.sqrt(ax * ax + ay * ay); const rb = Math.sqrt(bx * bx + by * by);
  if (ra < 1e-6 || rb < 1e-6 || ra > rb * 3) return [sx, sy];
  let turn = Math.atan2(by, bx) - Math.atan2(ay, ax);
  if (turn > Math.PI) turn -= Math.PI * 2; else if (turn < -Math.PI) turn += Math.PI * 2;
  if (Math.abs(turn) < 0.9) return [sx, sy];
  const a = Math.atan2(ay, ax) + Math.sign(turn) * 0.8;
  const r = Math.max(rb, ra * 0.9);
  return [q(at.x + Math.cos(a) * r), q(at.y + Math.sin(a) * r)];
}

function cool(ctx, agent, extra = 0) {
  const c = agent.combat;
  c.state = 'cooldown'; c.t = q(agent.attack.cooldown * (0.85 + 0.3 * roll(agent)) + extra); c.last = ctx.time; c.token = false;
}

/**
 * engage(ctx, agent) -> 'run' while there is a target to fight, 'ok' once it is gone. Call it every tick
 * (the built-in 'engage' action does). States in agent.combat.state: chase, telegraph, attack, charge, cooldown.
 * Events: 'telegraph' { id, target, time, attack: 'melee' | 'throw', style, x, y, facing, range } when a blow
 * is announced. The blow itself is ctx.strike (events 'attack' and 'hurt' when the ai settles hits).
 */
export function engage(ctx, agent) {
  const c = agent.combat; const A = agent.attack; const intent = agent.intent;
  const target = agent.target ? ctx.actor(agent.target) : null;
  if (!target || !target.alive) { c.state = 'idle'; c.token = false; halt(agent); return 'ok'; }
  const at = lastKnown(ctx, agent, target);
  const d = dist(agent.x, agent.y, at.x, at.y);
  const reach = (A.style === 'ranged' ? A.range : A.style === 'charge' ? agent.radius + 0.5 * ctx.unit : A.range) + (target.radius || 0);
  const flow = ctx.packed(target.id) ? target.id : null;
  if (d > 1e-6 && c.state !== 'charge') intent.face = facingOf(at.x - agent.x, at.y - agent.y);
  if (c.state === 'idle') c.state = 'chase';

  if (c.state === 'chase' || c.state === 'cooldown') {
    let can = false;
    if (A.style === 'ranged') {
      const keep = A.keep || A.range * 0.7;
      const clear = at.fresh && ctx.los(agent.x, agent.y, target.x, target.y);
      if (d < keep * 0.55 && d > 1e-6) go(agent, agent.x + (agent.x - at.x) / d * keep, agent.y + (agent.y - at.y) / d * keep, { run: true }); // kite: back away
      else if ((d > A.range * 0.95 || !clear) && c.slotX !== null) go(agent, c.slotX, c.slotY, { run: true, arrive: agent.radius });
      else if (d > A.range * 0.95 || !clear) go(agent, at.x, at.y, { run: true, arrive: A.range * 0.8 });
      else halt(agent);
      can = clear && d <= A.range;
      c.plan = 'bite';
    } else {
      const inReach = d <= reach * 0.95;
      const lineUp = A.style === 'charge' && d <= A.range && d > reach * 1.3 && at.fresh && ctx.los(agent.x, agent.y, target.x, target.y);
      if (c.slotX !== null && (!c.token || c.state === 'cooldown')) { const p = aroundTo(agent, at, c.slotX, c.slotY); go(agent, p[0], p[1], { run: d > reach * 2.5, arrive: agent.radius * 0.6, flow }); } // hold a place in the ring
      else if (lineUp) halt(agent);
      else if (!inReach) go(agent, at.x, at.y, { run: true, arrive: reach * 0.8, flow });
      else halt(agent);
      can = at.fresh && (inReach || lineUp);
      c.plan = lineUp && !inReach ? 'charge' : 'bite';
    }
    if (c.state === 'cooldown') {
      c.t = q(c.t - ctx.dt);
      if (c.t <= 0) c.state = 'chase';
    } else if (can && c.token && !agent.busy && !agent.staggered) {
      const charge = c.plan === 'charge';
      c.state = 'telegraph'; c.t = A.telegraph;
      halt(agent);
      ctx.emit({ type: 'telegraph', id: agent.id, target: target.id, time: A.telegraph, attack: A.style === 'ranged' ? 'throw' : 'melee', style: charge ? 'charge' : A.style === 'charge' ? 'melee' : A.style, x: agent.x, y: agent.y, facing: intent.face ?? agent.facing, range: q(charge ? A.range : reach) });
      ctx.bark(agent, 'taunt');
    }
    return 'run';
  }

  if (c.state === 'telegraph') {
    halt(agent);
    c.t = q(c.t - ctx.dt);
    if (agent.staggered) { cool(ctx, agent); return 'run'; }
    if (c.t > 0) return 'run';
    if (c.plan === 'charge') { // charge: commit to the line toward where the target is now
      const dd = d || 1;
      c.dirX = q((at.x - agent.x) / dd); c.dirY = q((at.y - agent.y) / dd);
      c.state = 'charge'; c.t = q(A.range * 1.25 / (agent.run * 1.5)); c.hit = false;
      intent.face = facingOf(c.dirX, c.dirY);
      return 'run';
    }
    c.state = 'attack'; c.t = A.recover; c.swung = false;
    if (A.style === 'ranged') { intent.throw = true; intent.aimX = q(target.x); intent.aimY = q(target.y); } else intent.attack = true;
    ctx.strike(agent, target, A.style === 'ranged' ? 'ranged' : 'melee');
    return 'run';
  }

  if (c.state === 'charge') {
    halt(agent);
    c.t = q(c.t - ctx.dt);
    intent.face = facingOf(c.dirX, c.dirY);
    if (!c.hit && dist(agent.x, agent.y, target.x, target.y) <= reach) { c.hit = true; intent.attack = true; ctx.strike(agent, target, 'charge'); }
    const wall = ctx.grid && !ctx.grid.openAt(agent.x + c.dirX * (agent.radius + ctx.grid.cellSize * 0.5), agent.y + c.dirY * (agent.radius + ctx.grid.cellSize * 0.5));
    if (c.t <= 0 || wall || agent.staggered) { c.dirX = 0; c.dirY = 0; cool(ctx, agent, wall && !c.hit ? A.recover * 2 : A.recover); }
    return 'run';
  }

  // 'attack': wait for the swing to finish (the combat engine reports busy; on its own the recover time decides)
  c.t = q(c.t - ctx.dt);
  if (agent.busy) c.swung = true;
  if ((c.t <= 0 && !agent.busy) || c.t <= -2) cool(ctx, agent);
  return 'run';
}

/**
 * fleePoint(ctx, agent) -> [x, y] to run to: away from the known enemies, bending toward home when home
 * is not in their direction, and never into a wall.
 */
export function fleePoint(ctx, agent) {
  let fx = 0; let fy = 0; let n = 0;
  for (const id of Object.keys(agent.seen).sort()) {
    const s = agent.seen[id];
    const d = dist(agent.x, agent.y, s.x, s.y) || 0.01;
    fx += (agent.x - s.x) / d / d; fy += (agent.y - s.y) / d / d; n++;
  }
  if (!n) return [agent.home.x, agent.home.y];
  const fl = Math.sqrt(fx * fx + fy * fy) || 1;
  fx /= fl; fy /= fl;
  const hx = agent.home.x - agent.x; const hy = agent.home.y - agent.y;
  const hl = Math.sqrt(hx * hx + hy * hy);
  if (hl > ctx.unit && (hx * fx + hy * fy) / hl > -0.2) { fx = fx * 0.5 + hx / hl * 0.5; fy = fy * 0.5 + hy / hl * 0.5; }
  const far = agent.senses.sight * 0.9;
  for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 2, -2]) {
    const cs = Math.cos(turn); const sn = Math.sin(turn);
    const x = agent.x + (fx * cs - fy * sn) * far; const y = agent.y + (fx * sn + fy * cs) * far;
    if (!ctx.grid || ctx.grid.openAt(x, y)) return [q(x), q(y)];
  }
  return [agent.home.x, agent.home.y];
}
