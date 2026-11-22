// Level of detail. An agent nobody is near does not need eyes, paths or steering: it only needs to be
// in roughly the right place, doing roughly the right thing, when someone does come near. Far agents
// are advanced in big steps with no perception at all, and an agent that was not in memory (a sleeping
// world chunk) is caught up in one go.
import { q } from './util.js';
import { travel } from './move.js';
import { stepNeeds, mostUrgent } from './needs.js';
import { scheduleAt, hourOffset, hourOfDay } from './schedule.js';
import { emptyIntent } from './agent.js';
import { leaderOf } from './actions.js';

/** calmDown(agent) drops everything to do with a fight: target, threat, memory of enemies, fear, the running tree. */
export function calmDown(agent) {
  agent.target = null; agent.anchor = null; agent.threat = {}; agent.seen = {}; agent.heard = null; agent.fear = 0; agent.alarm = 0;
  agent.combat.state = 'idle'; agent.combat.token = false; agent.combat.slotX = null; agent.combat.slotY = null;
  agent.goal = null; agent.goalT = 0; agent.bt = {}; agent.nav = null; agent.intent = emptyIntent(); agent.stuck = 0;
}

function wanted(ctx, agent, hour) {
  const worst = mostUrgent(ctx.cfg.needs, agent.needs);
  if (worst && worst.urgent) { const d = ctx.cfg.needs[worst.name]; return { activity: d.activity, place: d.place }; }
  if (!agent.schedule) return null;
  return scheduleAt(ctx.cfg.schedules[agent.schedule], hour + hourOffset(agent.seed, ctx.cfg.scheduleSpread));
}

/**
 * farStep(ctx, agent, seconds) advances a far-away agent by a big step: it forgets any fight, heals a
 * little, and moves straight toward where it belongs (its scheduled place, the next patrol point, its
 * pack leader, or home) with no path-finding. Needs are stepped by the caller.
 */
export function farStep(ctx, agent, seconds) {
  if (agent.target || agent.goal) calmDown(agent);
  agent.hp = Math.min(agent.maxHp, q(agent.hp + agent.maxHp * 0.02 * seconds));
  if (agent.talk || agent.driven) return;
  const plan = wanted(ctx, agent, ctx.hour);
  if (plan && !(plan.activity === 'patrol' && agent.patrol)) {
    const p = ctx.placeOf(agent, plan.place) ?? agent.home;
    agent.place = plan.place;
    agent.activity = travel(ctx, agent, p.x, p.y, seconds, agent.speed) ? plan.activity : 'travel';
  } else if (agent.patrol && agent.patrol.points.length) {
    const p = agent.patrol;
    const pt = p.points[p.i % p.points.length];
    if (travel(ctx, agent, pt[0], pt[1], seconds, agent.speed)) p.i = (p.i + 1) % p.points.length;
    agent.activity = 'patrol';
  } else {
    const lead = leaderOf(ctx, agent);
    const to = lead ?? agent.home;
    travel(ctx, agent, to.x, to.y, seconds, agent.speed);
    agent.activity = lead ? 'follow' : 'idle';
  }
  agent.anim = agent.activity === 'travel' || agent.activity === 'patrol' || agent.activity === 'follow' ? 'walk' : agent.activity === 'sleep' ? 'sleep' : 'idle';
}

/**
 * catchUp(ctx, agent, seconds) brings an agent up to date after `seconds` it spent out of memory (the
 * world engine's catchUp hook). Needs are replayed hour by hour against the schedule (two game days at
 * most, after that they have settled), mobs are healed and sent home, and people are put where their
 * schedule says they should be now.
 */
export function catchUp(ctx, agent, seconds) {
  if (!(seconds > 0)) return;
  calmDown(agent);
  const { dayLength, startHour } = ctx.cfg;
  const total = Math.min(48, seconds / dayLength * 24);
  let left = total;
  while (left > 1e-9) {
    const chunk = Math.min(1, left);
    const hour = hourOfDay(ctx.time - (left - chunk / 2) / 24 * dayLength, dayLength, startHour + ctx.state.hourShift);
    const plan = wanted(ctx, agent, hour);
    stepNeeds(ctx.cfg.needs, agent.needs, chunk, plan ? plan.activity : null);
    left -= chunk;
  }
  agent.needsT = ctx.time;
  agent.hp = Math.min(agent.maxHp, q(agent.hp + agent.maxHp * 0.02 * seconds));
  if (agent.driven) return;
  farStep(ctx, agent, Math.min(seconds, 1e6));
}
