// Inputs for utility goals: each answers one question about an agent with a number from 0 to 1.
// A game adds its own through createAi({ inputs }). An input is (ctx, agent, args) => number.
import { dist, clamp, q, sortedKeys } from './util.js';
import { mostUrgent } from './needs.js';
import { crowd } from './perception.js';
import { leaderOf } from './actions.js';

/**
 * fearOf(ctx, agent) -> 0..1, where 0.5 and above means "run". It mixes three things:
 *   wounds   health under the agent's fleeAt share (a brave individual holds on longer)
 *   odds     being outnumbered, or a pack animal finding itself alone
 *   morale   how much of its squad has fallen (disciplined minds shrug it off)
 * Civilians (the 'npc' brain) are simply afraid of any enemy they know about. Agents with fleeAt 0 never fear.
 */
export function fearOf(ctx, agent) {
  if (!sortedKeys(agent.seen).length) return 0;
  const brave = agent.traits.bravery;
  if (agent.brain === 'npc') return q(1 - brave * 0.4);
  if (!(agent.fleeAt > 0)) return 0;
  const h = agent.hp / agent.maxHp;
  const limit = Math.min(0.95, agent.fleeAt * (1.4 - 0.8 * brave));
  const wounds = h < limit ? 0.6 + 0.4 * (1 - h / limit) : 0;
  const { allies, foes } = crowd(ctx, agent, 8 * ctx.unit);
  let odds = clamp((foes - allies - 1) / 3, 0, 1) * (1 - brave);
  const squad = agent.squad ? ctx.state.squads[agent.squad] : null;
  if (agent.pack && squad && squad.size > 1 && allies === 0) odds += 0.7 * (1 - brave);
  const morale = squad && squad.size > 0 ? squad.lost / squad.size * (1 - agent.traits.discipline) * 1.2 : 0;
  return q(clamp(Math.max(wounds, odds + morale), 0, 1));
}

/** INPUTS -> the built-in utility inputs, by name. */
export const INPUTS = {
  /** 1 while the agent has someone to fight */
  target: (ctx, agent) => (agent.target ? 1 : 0),
  /** the agent's fear (see fearOf); it sinks slowly once the danger is out of sight */
  fear: (ctx, agent) => agent.fear,
  /** 1 while there is a sound (or a lost target's last position) to look into */
  heard: (ctx, agent) => (agent.heard ? 1 : 0),
  /** 1 while it knows of any enemy */
  threatened: (ctx, agent) => (sortedKeys(agent.seen).length ? 1 : 0),
  /** share of health left, and its opposite */
  health: (ctx, agent) => agent.hp / agent.maxHp,
  hurt: (ctx, agent) => 1 - agent.hp / agent.maxHp,
  /** how far from home, as a share of the leash (1 = at the end of it) */
  awayFromHome: (ctx, agent) => clamp(dist(agent.x, agent.y, agent.home.x, agent.home.y) / Math.max(agent.leash, 1e-6), 0, 1),
  /** 1 when more than a few steps from home */
  notHome: (ctx, agent) => (dist(agent.x, agent.y, agent.home.x, agent.home.y) > agent.radius + 2 * ctx.unit ? 1 : 0),
  /** one need by name ({ input: 'need', name: 'hunger' }), 0 when the agent does not have it */
  need: (ctx, agent, args) => agent.needs[args?.name] ?? 0,
  /** 1 once any need is urgent, and it stays 1 while the agent is busy meeting a need (else 0) */
  urgentNeed: (ctx, agent) => { const w = mostUrgent(ctx.cfg.needs, agent.needs); return w && (w.urgent || (agent.goal === 'need' && agent.goalT > 0 && agent.activity !== 'idle')) ? 1 : 0; },
  /** 1 when the agent has a daily schedule */
  scheduled: (ctx, agent) => (agent.schedule ? 1 : 0),
  /** 1 while someone is talking to it */
  talking: (ctx, agent) => (agent.talk ? 1 : 0),
  /** 1 when it has patrol points */
  patrol: (ctx, agent) => (agent.patrol ? 1 : 0),
  /** 1 when it is in a squad led by someone else */
  hasLeader: (ctx, agent) => (leaderOf(ctx, agent) ? 1 : 0),
  /** a personality trait ({ input: 'trait', name: 'curiosity' }) */
  trait: (ctx, agent, args) => agent.traits[args?.name] ?? 0,
  /** a blackboard value ({ input: 'bb', key: 'angry' }): numbers are clamped, anything else truthy is 1 */
  bb: (ctx, agent, args) => { const v = agent.bb[args?.key]; return typeof v === 'number' ? clamp(v, 0, 1) : v ? 1 : 0; },
  /** a fixed number ({ input: 'const', value: 0.3 }) */
  const: (ctx, agent, args) => args?.value ?? 1,
  /** 1 at night (22:00 to 6:00) */
  night: (ctx) => (ctx.hour >= 22 || ctx.hour < 6 ? 1 : 0),
};
