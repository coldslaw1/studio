// One step of the simulation. Order: sort agents into tiers, rebuild the neighbour index, then for
// every agent that is due: sense, choose a target, choose a goal; plan group tactics; tick each
// agent's behaviour tree and move it; finally answer a few path requests. Agents are always visited
// in id order, so the same state and the same calls give the same result on every machine.
import { dist2, q, sortedKeys } from './util.js';
import { sense, pickTarget } from './perception.js';
import { pickGoal } from './utility.js';
import { tickTree, resetTree } from './bt.js';
import { planTactics } from './tactics.js';
import { locomote, halt } from './move.js';
import { farStep } from './lod.js';
import { fearOf } from './inputs.js';
import { stepNeeds } from './needs.js';
import { findPath } from './astar.js';
import { createFlowField } from './flow.js';

const POSES = { sleep: 'sleep', work: 'work', eat: 'eat', drink: 'drink', trade: 'trade', talk: 'talk', chat: 'talk' };

/** animOf(agent) -> the animation a body should play: idle, walk, run, telegraph, attack, charge, sleep, work, eat, drink, trade, talk or dead. */
export function animOf(agent) {
  if (!agent.alive) return 'dead';
  const s = agent.combat.state;
  if (s === 'telegraph' || s === 'attack' || s === 'charge') return s;
  // speed decides walk or run, with a dead band so a body being jostled does not flicker between poses
  const i = agent.intent;
  const v = agent.driven ? Math.sqrt(i.moveX * i.moveX + i.moveY * i.moveY) * agent.run : Math.sqrt(agent.vx * agent.vx + agent.vy * agent.vy);
  const moving = agent.anim === 'walk' || agent.anim === 'run';
  if (v > agent.speed * (moving ? 0.15 : 0.35)) return v > (agent.speed + agent.run) / 2 ? 'run' : 'walk';
  return POSES[agent.activity] ?? 'idle';
}

function classify(sim, focus) {
  const { cfg } = sim;
  const a2 = cfg.activeRadius * cfg.activeRadius; const n2 = cfg.nearRadius * cfg.nearRadius;
  for (const a of sim.list) {
    let best = Infinity;
    for (const f of focus) { const d = dist2(a.x, a.y, f.x, f.y); if (d < best) best = d; }
    a.tier = best <= a2 ? 0 : best <= n2 ? 1 : 2;
  }
}

function retarget(sim, a) {
  const { ctx } = sim;
  const prev = a.target;
  const next = pickTarget(ctx, a);
  if (next && a.seen[next]) a.lastSeen = { x: a.seen[next].x, y: a.seen[next].y };
  if (next === prev) return;
  a.target = next;
  a.combat.state = 'idle'; a.combat.token = false; a.combat.slotX = null; a.combat.slotY = null;
  if (!prev) a.anchor = { x: a.x, y: a.y }; // the leash is measured from where the fight began
  if (!next) a.anchor = null;
  if (next) {
    a.alarm = q(ctx.time + 5);
    ctx.emit({ type: 'aggro', id: a.id, target: next });
    if (a.fear < 0.5) ctx.bark(a, 'aggro');
  } else {
    ctx.emit({ type: 'deaggro', id: a.id, was: prev });
    const gone = ctx.actor(prev);
    // lost sight of a living enemy: go and look where it was last seen
    if (gone && gone.alive && a.lastSeen && !(a.calm > ctx.time) && a.fear < 0.3) a.heard = { x: a.lastSeen.x, y: a.lastSeen.y, t: ctx.time, kind: 'lost', by: prev };
    else ctx.bark(a, 'lost');
  }
}

function think(sim, a, since) {
  const { ctx, cfg } = sim;
  if (sortedKeys(a.needs).length) { stepNeeds(cfg.needs, a.needs, (ctx.time - a.needsT) / cfg.dayLength * 24, a.activity); }
  a.needsT = ctx.time;
  a.fear = q(Math.max(fearOf(ctx, a), a.fear - 0.15 * since));
  const brain = cfg.brains[a.brain];
  const pick = pickGoal(brain.goals, (name, c) => cfg.registry.inputs[name](ctx, a, c), a.goal, brain.inertia);
  if (pick.id !== a.goal) {
    const was = a.goal;
    a.goal = pick.id; a.goalT = 0;
    resetTree(a.bt); halt(a);
    if (a.combat.state !== 'idle') { a.combat.state = 'idle'; a.combat.token = false; }
    ctx.emit({ type: 'goal', id: a.id, goal: pick.id, was });
  }
}

function servePaths(sim, asking) {
  const { cfg } = sim;
  if (!asking.length || !cfg.grid) return;
  asking.sort((p, r) => p.nav.asked - r.nav.asked || (p.id < r.id ? -1 : 1));
  for (let i = 0; i < asking.length && i < cfg.pathsPerStep; i++) {
    const a = asking[i]; const nav = a.nav;
    const res = findPath(cfg.grid, a, { x: nav.tx, y: nav.ty }, { maxNodes: cfg.maxNodes });
    nav.pending = false; nav.gx = nav.tx; nav.gy = nav.ty;
    nav.path = res.points.length ? res.points : null;
    if (!res.points.length) nav.failed = true;
    sim.stats.paths += 1; sim.stats.expanded += res.expanded;
  }
  sim.stats.waiting = Math.max(0, asking.length - cfg.pathsPerStep);
}

/** fieldFor(sim, targetId) -> the shared flow field toward an actor (cached per target cell), or null. */
export function fieldFor(sim, targetId) {
  const grid = sim.cfg.grid;
  const t = sim.ctx.actor(targetId);
  if (!grid || !t) return null;
  const key = `${grid.colOf(t.x)},${grid.rowOf(t.y)},${grid.version}`;
  let field = sim.fields.get(key);
  if (!field) {
    field = createFlowField(grid, { x: t.x, y: t.y }, { maxCells: 12000 });
    sim.fields.set(key, field);
    sim.stats.fields += 1;
    if (sim.fields.size > 12) sim.fields.delete(sim.fields.keys().next().value);
  }
  return field;
}

/**
 * stepSim(sim, dt, focus) advances the simulation by dt seconds. `sim` is the runtime object createAi
 * keeps: { cfg, state, ctx, order, list, stale, hash, fields, stats, packs }. focus: list of { x, y } (may be empty).
 */
export function stepSim(sim, dt, focus) {
  const { cfg, state, ctx, hash } = sim;
  state.time = q(state.time + dt); state.tick += 1;
  ctx.time = state.time; ctx.tick = state.tick; ctx.hour = ctx.hourAt(state.time); ctx.grid = cfg.grid;
  sim.stats = { active: 0, near: 0, far: 0, thought: 0, paths: 0, expanded: 0, fields: 0, waiting: 0 };
  if (sim.list.length !== sim.order.length || sim.stale) { sim.list = sim.order.map((id) => state.agents[id]); sim.stale = false; } // agents in id order
  if (cfg.autoTier && focus.length) classify(sim, focus);

  // sounds live for a little longer than the slowest listener's interval
  const keep = Math.max(cfg.senseEvery, cfg.nearEvery) * 2 + dt;
  if (state.sounds.length) state.sounds = state.sounds.filter((s) => state.time - s.t <= keep);
  for (const id of sortedKeys(state.bodies)) { // bodies that make noise (a running player) are heard four times a second
    const b = state.bodies[id];
    if (!(b.noise > 0) || !b.alive) continue;
    b.noiseT = q((b.noiseT ?? 0) - dt);
    if (b.noiseT <= 0) { b.noiseT = 0.25; ctx.sound({ x: b.x, y: b.y, kind: 'step', loud: b.noise, by: b.id }); }
  }

  hash.clear();
  for (const a of sim.list) if (a.alive && a.tier <= 1) hash.insert(a);
  for (const id of sortedKeys(state.bodies)) if (state.bodies[id].alive) hash.insert(state.bodies[id]);

  // pass 1: who is due, what do they know, what do they want
  const due = []; const fighters = [];
  for (const a of sim.list) {
    if (!a.alive) continue;
    if (a.tier === 2) {
      sim.stats.far += 1;
      a.acc += dt;
      if (a.acc >= cfg.farEvery) {
        ctx.dt = a.acc;
        stepNeeds(cfg.needs, a.needs, (ctx.time - a.needsT) / cfg.dayLength * 24, a.activity); a.needsT = ctx.time;
        farStep(ctx, a, a.acc);
        a.acc = 0; sim.stats.thought += 1;
      }
      continue;
    }
    let adt = dt;
    if (a.tier === 1) {
      sim.stats.near += 1;
      a.acc += dt;
      if (a.acc < cfg.nearEvery) continue;
      adt = a.acc; a.acc = 0;
    } else { sim.stats.active += 1; a.acc = 0; }
    ctx.dt = adt;
    const i = a.intent;
    i.moveX = 0; i.moveY = 0; i.face = null; i.attack = false; i.block = false; i.dodge = false; i.throw = false; i.aimX = null; i.aimY = null; i.run = false;
    a.senseT = q(a.senseT - adt);
    if (a.senseT <= 0) {
      const since = cfg.senseEvery - a.senseT;
      a.senseT = q(Math.max(a.senseT + cfg.senseEvery, 0) || cfg.senseEvery);
      sense(ctx, a, since);
      retarget(sim, a);
    }
    a.thinkT = q(a.thinkT - adt);
    if (a.thinkT <= 0 || a.goal === null) {
      const since = cfg.thinkEvery - Math.min(a.thinkT, 0);
      a.thinkT = q(Math.max(a.thinkT + cfg.thinkEvery, 0) || cfg.thinkEvery);
      think(sim, a, since);
      sim.stats.thought += 1;
    }
    due.push(a, adt);
    if (a.target && a.activity === 'fight') fighters.push(a);
  }

  // pass 2: plan the groups, then act and move
  sim.packs.clear();
  for (const a of fighters) sim.packs.set(a.target, (sim.packs.get(a.target) || 0) + 1);
  planTactics(ctx, fighters);
  const asking = [];
  for (let k = 0; k < due.length; k += 2) {
    const a = due[k]; const adt = due[k + 1];
    if (!a.alive) continue; // killed earlier in this step
    ctx.dt = adt;
    const goal = cfg.brains[a.brain].byId[a.goal];
    const status = tickTree(goal.compiled, { ctx, agent: a, mem: a.bt, dt: adt, time: ctx.time });
    if (status !== 'run') resetTree(a.bt);
    a.goalT = q(a.goalT + adt);
    locomote(ctx, a, adt, a.tier);
    if (a.nav && a.nav.pending) asking.push(a);
    const anim = animOf(a);
    if (anim !== a.anim) { ctx.emit({ type: 'anim', id: a.id, anim, was: a.anim }); a.anim = anim; }
  }
  servePaths(sim, asking);
  ctx.dt = dt;
}
