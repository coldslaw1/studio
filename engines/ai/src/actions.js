// The built-in vocabulary of behaviour trees: actions (things an agent does over time) and conditions
// (yes/no questions). A game adds its own through createAi({ actions, conditions }).
// An action is (ctx, agent, args, mem) => 'ok' | 'fail' | 'run'; mem is a plain object that lasts while it runs.
import { dist, facingOf, q, sortedKeys } from './util.js';
import { roll, rollRange } from './rng.js';
import { go, halt, arrived, navFailed } from './move.js';
import { engage, fleePoint } from './mob.js';
import { mostUrgent } from './needs.js';
import { relate } from './social.js';

const face = (agent, x, y) => { if (dist(agent.x, agent.y, x, y) > 1e-6) agent.intent.face = facingOf(x - agent.x, y - agent.y); };

// walk to a point: 'run' on the way, 'ok' there, 'fail' when it cannot be reached
function walkTo(agent, x, y, options) {
  go(agent, x, y, options);
  if (arrived(agent)) { halt(agent); return 'ok'; }
  if (navFailed(agent)) { halt(agent); return 'fail'; }
  return 'run';
}

function patrol(ctx, agent, args, mem) {
  const p = agent.patrol;
  if (!p || !p.points.length) return 'fail';
  agent.activity = 'patrol';
  if (mem.wait > 0) { mem.wait = q(mem.wait - ctx.dt); halt(agent); return 'run'; }
  const pt = p.points[p.i % p.points.length];
  const s = walkTo(agent, pt[0], pt[1], { arrive: agent.radius + 0.3 * ctx.unit });
  if (s !== 'run') { p.i = (p.i + 1) % p.points.length; mem.wait = q(rollRange(agent, 0.8, 2.5)); ctx.bark(agent, 'patrol', { again: 25 }); }
  return 'run';
}

/** leaderOf(ctx, agent) -> the living squad mate with the lowest id (the leader), or null when there is no squad or the agent leads it. */
export function leaderOf(ctx, agent) {
  if (!agent.squad) return null;
  const squad = ctx.state.squads[agent.squad];
  if (!squad) return null;
  for (const id of squad.members) {
    const m = ctx.state.agents[id];
    if (m && m.alive) return m.id === agent.id ? null : m;
  }
  return null;
}

/** ACTIONS -> the built-in actions, by name. See the README table for what each does and its arguments. */
export const ACTIONS = {
  engage: (ctx, agent) => { agent.activity = 'fight'; return engage(ctx, agent); },
  idle: (ctx, agent) => { halt(agent); agent.activity = 'idle'; ctx.bark(agent, 'idle', { again: 40 }); return 'run'; },
  halt: (ctx, agent) => { halt(agent); return 'ok'; },
  bark: (ctx, agent, args) => { ctx.bark(agent, args.kind ?? 'idle', { force: args.force === true }); return 'ok'; },
  set: (ctx, agent, args) => { agent.bb[args.key] = args.value ?? true; return 'ok'; },
  goHome: (ctx, agent, args) => { agent.activity = 'travel'; return walkTo(agent, agent.home.x, agent.home.y, { run: args.run === true, arrive: agent.radius + 0.4 * ctx.unit }); },
  goTo: (ctx, agent, args) => {
    const p = args.place ? ctx.placeOf(agent, args.place) : args;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'fail';
    agent.activity = 'travel';
    return walkTo(agent, p.x, p.y, { run: args.run === true, arrive: args.arrive ?? agent.radius + 0.4 * ctx.unit });
  },
  patrol,
  wander(ctx, agent, args, mem) {
    agent.activity = 'wander';
    if (mem.x === undefined) {
      const r = (args.radius ?? 5) * ctx.unit;
      for (let i = 0; i < 4 && mem.x === undefined; i++) {
        const a = roll(agent) * Math.PI * 2; const d = r * (0.3 + 0.7 * roll(agent));
        const x = agent.home.x + Math.cos(a) * d; const y = agent.home.y + Math.sin(a) * d;
        if (!ctx.grid || ctx.grid.openAt(x, y)) { mem.x = q(x); mem.y = q(y); }
      }
      if (mem.x === undefined) return 'fail';
    }
    return walkTo(agent, mem.x, mem.y, { arrive: agent.radius + 0.2 * ctx.unit });
  },
  guard(ctx, agent, args, mem) {
    agent.activity = 'guard';
    if (mem.facing === undefined) mem.facing = agent.bb.postFacing ?? agent.facing;
    if (dist(agent.x, agent.y, agent.home.x, agent.home.y) > agent.radius + 0.5 * ctx.unit) { go(agent, agent.home.x, agent.home.y, { arrive: agent.radius }); return 'run'; }
    halt(agent); agent.intent.face = mem.facing;
    return 'run';
  },
  follow(ctx, agent, args) {
    const lead = leaderOf(ctx, agent);
    if (!lead) return 'fail';
    agent.activity = lead.activity === 'patrol' ? 'patrol' : 'follow';
    const gap = (args.gap ?? 1.6) * ctx.unit + agent.radius + lead.radius;
    const d = dist(agent.x, agent.y, lead.x, lead.y);
    if (d > gap) go(agent, lead.x, lead.y, { arrive: gap * 0.8, run: d > gap * 3 }); else halt(agent);
    return 'run';
  },
  flee(ctx, agent, args, mem) {
    agent.activity = 'flee';
    agent.heard = null; // nothing is worth a look while running away
    if (!sortedKeys(agent.seen).length) { halt(agent); return 'ok'; }
    mem.t = (mem.t ?? 0) - ctx.dt;
    if (mem.t <= 0 || arrived(agent) || navFailed(agent)) { const p = fleePoint(ctx, agent); mem.x = p[0]; mem.y = p[1]; mem.t = 0.6; }
    go(agent, mem.x, mem.y, { run: true });
    ctx.bark(agent, 'flee', { again: 6 });
    return 'run';
  },
  callHelp(ctx, agent, args) {
    const about = agent.target ?? sortedKeys(agent.seen)[0] ?? null;
    const at = about ? agent.seen[about] : null;
    ctx.sound({ x: agent.x, y: agent.y, kind: 'call', loud: (args.loud ?? 14) * ctx.unit, by: agent.id, about, ax: at ? at.x : undefined, ay: at ? at.y : undefined });
    ctx.bark(agent, 'call', { again: 10, gap: 0 });
    return 'ok';
  },
  investigate(ctx, agent, args, mem) {
    const h = agent.heard;
    if (!h) return 'fail';
    agent.activity = 'investigate';
    if (!mem.said) { mem.said = true; ctx.bark(agent, 'alert'); }
    if (mem.look === undefined) {
      const s = walkTo(agent, h.x, h.y, { run: h.kind === 'call' || h.kind === 'fight', arrive: agent.radius + 0.8 * ctx.unit });
      if (s === 'run') return 'run';
      mem.look = q(rollRange(agent, 1.5, 3)); mem.turn = agent.facing;
    }
    mem.look = q(mem.look - ctx.dt);
    agent.intent.face = q(mem.turn + Math.sin(mem.look * 2.5) * 70); // look left and right
    agent.alarm = ctx.time + 1;
    if (mem.look > 0) return 'run';
    agent.heard = null;
    ctx.bark(agent, 'lost');
    return 'ok';
  },
  talk(ctx, agent) {
    if (!agent.talk) return 'ok';
    halt(agent); agent.activity = 'talk';
    const other = ctx.actor(agent.talk.with);
    if (other) face(agent, other.x, other.y);
    return 'run';
  },
  // do what the daily schedule says: walk to the place, then carry out the activity there
  scheduled(ctx, agent, args, mem) {
    const plan = ctx.planOf(agent);
    if (!plan) return 'fail';
    if (plan.activity === 'patrol' && agent.patrol) return patrol(ctx, agent, args, mem);
    const p = ctx.placeOf(agent, plan.place) ?? agent.home;
    agent.place = plan.place;
    const near = (args.near ?? 1.2) * ctx.unit + agent.radius;
    if (dist(agent.x, agent.y, p.x, p.y) > near) {
      if (walkTo(agent, p.x, p.y, { arrive: near * 0.7 }) === 'fail') { agent.activity = 'idle'; return 'run'; }
      agent.activity = 'travel';
      return 'run';
    }
    halt(agent);
    if (agent.activity !== plan.activity) { agent.activity = plan.activity; ctx.bark(agent, plan.activity, { again: 20 }); ctx.emit({ type: 'activity', id: agent.id, activity: plan.activity, place: plan.place }); }
    if (plan.activity === 'chat' || plan.activity === 'drink') mingle(ctx, agent, mem);
    return 'run';
  },
  // deal with the most pressing need: go where it can be met and stay until it is
  satisfy(ctx, agent, args, mem) {
    if (!mem.name) { const worst = mostUrgent(ctx.cfg.needs, agent.needs); if (!worst) return 'fail'; mem.name = worst.name; } // stay with one need until it is met
    const def = ctx.cfg.needs[mem.name];
    if (!def || !(agent.needs[mem.name] > 0.12)) { agent.activity = 'idle'; return 'ok'; }
    const p = ctx.placeOf(agent, def.place) ?? agent.home;
    agent.place = def.place;
    const near = 1.2 * ctx.unit + agent.radius;
    if (dist(agent.x, agent.y, p.x, p.y) > near) { agent.activity = 'travel'; return walkTo(agent, p.x, p.y, { arrive: near * 0.7 }) === 'fail' ? 'fail' : 'run'; }
    halt(agent);
    if (agent.activity !== def.activity) { agent.activity = def.activity; ctx.bark(agent, def.activity, { again: 20 }); }
    return 'run';
  },
};

// chatting at the inn: now and then turn to a nearby friend, say something, and like each other a bit more
function mingle(ctx, agent, mem) {
  mem.chat = (mem.chat ?? rollRange(agent, 2, 6)) - ctx.dt;
  if (mem.chat > 0) return;
  mem.chat = q(rollRange(agent, 5, 12) * (1.4 - agent.traits.sociability));
  let best = null; let bd = Infinity;
  for (const o of ctx.near(agent.x, agent.y, 4 * ctx.unit)) {
    if (o.id === agent.id || !o.alive || !ctx.state.agents[o.id] || ctx.relation(agent, o) === 'hostile') continue;
    const d = dist(agent.x, agent.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return;
  face(agent, best.x, best.y);
  const first = agent.rel[best.id] === undefined;
  relate(agent, best.id, 0.03 + 0.04 * agent.traits.sociability);
  if (ctx.bark(agent, first ? 'greet' : 'chat', { again: 4 })) ctx.emit({ type: 'chat', id: agent.id, with: best.id });
}

/** CONDITIONS -> the built-in yes/no questions for { if: ... } and { while: ... } nodes. */
export const CONDITIONS = {
  hasTarget: (ctx, agent) => !!agent.target,
  seesTarget: (ctx, agent) => !!agent.target && !!agent.seen[agent.target] && ctx.time - agent.seen[agent.target].t <= ctx.cfg.senseEvery * 2,
  heard: (ctx, agent) => !!agent.heard,
  atHome: (ctx, agent) => dist(agent.x, agent.y, agent.home.x, agent.home.y) <= agent.radius + ctx.unit,
  lowHealth: (ctx, agent, args) => agent.hp / agent.maxHp < (args.below ?? 0.3),
  hasPatrol: (ctx, agent) => !!agent.patrol,
  hasLeader: (ctx, agent) => !!leaderOf(ctx, agent),
  talking: (ctx, agent) => !!agent.talk,
  afraid: (ctx, agent) => agent.fear >= 0.5,
  bb: (ctx, agent, args) => (args.is === undefined ? !!agent.bb[args.key] : agent.bb[args.key] === args.is),
  hour: (ctx, agent, args) => (args.from <= args.to ? ctx.hour >= args.from && ctx.hour < args.to : ctx.hour >= args.from || ctx.hour < args.to),
  activity: (ctx, agent, args) => agent.activity === args.is,
  need: (ctx, agent, args) => (agent.needs[args.name] ?? 0) >= (args.above ?? 0.7),
};
