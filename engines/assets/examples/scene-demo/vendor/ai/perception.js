// Perception: what an agent knows about the world. Sight is a cone with a range, blocked by walls;
// hearing picks up sounds the game or other agents made; memory keeps the last known position of what
// was seen for a while after it is lost. Threat is how much each known enemy matters right now.
import { dist, facingOf, angleDiff, q, sortedKeys } from './util.js';

/**
 * canSee(ctx, agent, other) -> true when `other` is inside the agent's sight range and cone with a clear
 * line between them. Anything touching distance away is noticed whatever the facing. other.stealth
 * (0..1, default 1) scales the range: 0.5 means it must come twice as close. An alarmed agent looks all around.
 */
export function canSee(ctx, agent, other) {
  const d = dist(agent.x, agent.y, other.x, other.y);
  const range = agent.senses.sight * (other.stealth ?? 1);
  // anything this near is noticed whichever way the agent faces: touching distance, or a quarter of its sight
  const close = Math.max(agent.radius + (other.radius || 0) + 0.6 * ctx.unit, range * 0.25);
  if (d > Math.max(range, close)) return false;
  if (d > close && agent.senses.fov < 360 && agent.alarm <= ctx.time) {
    const off = Math.abs(angleDiff(facingOf(other.x - agent.x, other.y - agent.y), agent.facing));
    if (off > agent.senses.fov / 2) return false;
  }
  return ctx.los(agent.x, agent.y, other.x, other.y);
}

/**
 * sense(ctx, agent, dt) refreshes agent.seen, agent.heard and agent.threat. dt is the time since this
 * agent last sensed. Only hostiles are remembered. Emits 'spotted' the moment a hostile comes into view.
 */
export function sense(ctx, agent, dt) {
  const { time } = ctx;
  const around = ctx.near(agent.x, agent.y, agent.senses.sight + ctx.unit);
  for (const other of around) {
    if (other.id === agent.id || !other.alive) continue;
    if (ctx.relation(agent, other) !== 'hostile') continue;
    if (!canSee(ctx, agent, other)) continue;
    const known = agent.seen[other.id];
    const d = dist(agent.x, agent.y, other.x, other.y);
    if (!known || time - known.t > 1.5) ctx.emit({ type: 'spotted', id: agent.id, who: other.id, x: other.x, y: other.y });
    agent.seen[other.id] = { x: other.x, y: other.y, t: time };
    // being in view builds threat, faster up close and for aggressive minds
    const gain = (0.5 + agent.traits.aggression) * (1.3 - Math.min(1, d / agent.senses.sight));
    agent.threat[other.id] = q((agent.threat[other.id] || 0) + (known ? gain * dt : gain));
  }
  for (const id of sortedKeys(agent.seen)) {
    const other = ctx.actor(id);
    if (!other || !other.alive || time - agent.seen[id].t > agent.senses.memory) { delete agent.seen[id]; delete agent.threat[id]; }
  }
  for (const id of sortedKeys(agent.threat)) {
    if (!agent.seen[id]) { delete agent.threat[id]; continue; }
    if (agent.seen[id].t < time) agent.threat[id] = q(agent.threat[id] * Math.max(0, 1 - 0.12 * dt)); // out of view: cools off
  }
  hear(ctx, agent);
}

function hear(ctx, agent) {
  let best = null; let bestScore = 0;
  for (const s of ctx.state.sounds) {
    if (s.n <= agent.heardT || s.by === agent.id) continue;
    const d = dist(agent.x, agent.y, s.x, s.y);
    const reach = s.loud * agent.senses.hearing;
    if (d > reach) continue;
    const range = reach * (ctx.los(agent.x, agent.y, s.x, s.y) ? 1 : 0.6); // walls muffle
    if (d > range) continue;
    const maker = s.by ? ctx.actor(s.by) : null;
    const rel = maker ? ctx.relation(agent, maker) : 'neutral';
    if (s.kind === 'call' && rel === 'friendly' && s.about) { // a friend calling for help: learn where its enemy is
      const foe = ctx.actor(s.about);
      if (foe && foe.alive && ctx.relation(agent, foe) === 'hostile') {
        agent.seen[foe.id] = { x: s.ax ?? foe.x, y: s.ay ?? foe.y, t: ctx.time };
        agent.threat[foe.id] = q((agent.threat[foe.id] || 0) + 1 + agent.traits.aggression);
        agent.alarm = ctx.time + 6;
      }
    }
    if (maker && rel !== 'hostile' && s.kind !== 'call' && s.kind !== 'fight') continue; // friends and neutrals pottering about are not worth a look
    const score = (range - d) / range + (s.kind === 'call' || s.kind === 'fight' ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  agent.heardT = ctx.state.soundN;
  if (best) agent.heard = { x: best.x, y: best.y, t: ctx.time, kind: best.kind, by: best.by ?? null };
  else if (agent.heard && ctx.time - agent.heard.t > Math.max(6, agent.senses.memory)) agent.heard = null;
}

/**
 * pickTarget(ctx, agent) -> the id of the enemy to deal with, or null. The highest threat wins, but the
 * current target is kept until another is 30% higher, so agents do not dither. An agent that has chased
 * further than its leash from where the fight began (agent.anchor) gives up everything and is calm for
 * a few seconds.
 */
export function pickTarget(ctx, agent) {
  if (agent.calm > ctx.time) return null;
  const locked = agent.combat.state === 'telegraph' || agent.combat.state === 'attack' || agent.combat.state === 'charge';
  if (locked && agent.target && ctx.actor(agent.target)?.alive) return agent.target;
  if (agent.anchor && dist(agent.x, agent.y, agent.anchor.x, agent.anchor.y) > agent.leash) { // chased too far from where the fight began
    agent.threat = {}; agent.seen = {}; agent.calm = q(ctx.time + 8);
    return null;
  }
  let best = null; let bestThreat = 0;
  for (const id of sortedKeys(agent.threat)) {
    const t = agent.threat[id];
    if (t > bestThreat) { bestThreat = t; best = id; }
  }
  const cur = agent.target;
  if (cur && cur !== best && agent.threat[cur] > 0 && bestThreat < agent.threat[cur] * 1.3) return cur;
  return best;
}

/**
 * addThreat(agent, sourceId, amount, at) raises how much the agent cares about someone (damage taken, a
 * taunt, a healer's spell) and makes sure it knows roughly where they are.
 */
export function addThreat(agent, sourceId, amount, at) {
  agent.threat[sourceId] = q((agent.threat[sourceId] || 0) + amount);
  if (at) agent.seen[sourceId] = { x: q(at.x), y: q(at.y), t: at.t };
}

/**
 * crowd(ctx, agent, radius) -> { allies, foes } counts of living friendly and hostile actors within radius
 * (the agent itself is not counted). Used for fear and for "am I alone?".
 */
export function crowd(ctx, agent, radius) {
  let allies = 0; let foes = 0;
  for (const other of ctx.near(agent.x, agent.y, radius)) {
    if (other.id === agent.id || !other.alive) continue;
    const rel = ctx.relation(agent, other);
    if (rel === 'friendly') allies++; else if (rel === 'hostile') foes++;
  }
  return { allies, foes };
}
