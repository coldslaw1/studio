// createAi: the object a game talks to. It wraps a plain JSON state (every agent, squad, sound and
// faction standing) and advances it step by step. Same state + same calls = same result.
import { need, dist, q, clamp, isId, sortedKeys, insertSorted, removeSorted, angleDiff, facingOf } from './util.js';
import { roll } from './rng.js';
import { createConfig } from './config.js';
import { makeAgent, isAgent, agentView } from './agent.js';
import { createSpatialHash } from './spatial.js';
import { stepSim, fieldFor } from './sim.js';
import { addThreat, canSee } from './perception.js';
import { pickBark } from './barks.js';
import { relate } from './social.js';
import { hourOfDay, scheduleAt, hourOffset } from './schedule.js';
import { catchUp as catchUpAgent, calmDown } from './lod.js';

/** createAiState() -> an empty state: { v, time, tick, hourShift, soundN, agents, bodies, squads, sounds, standing }. */
export function createAiState() {
  return { v: 1, time: 0, tick: 0, hourShift: 0, soundN: 0, agents: {}, bodies: {}, squads: {}, sounds: [], standing: {} };
}

/** isAiState(value) -> true when the value looks like an ai state. */
export function isAiState(value) {
  return !!value && typeof value === 'object' && value.v === 1 && !!value.agents && typeof value.agents === 'object' && Array.isArray(value.sounds) && !!value.squads && !!value.bodies;
}

/**
 * createAi(options) -> ai. Every option is optional.
 *   seed = 0             the world's seed: with another seed every individual gets another personality and other luck
 *   unit = 1             game units per metre (1 in Kiln scenes, about 32 in pixel games); scales every built-in length
 *   grid                 a nav grid (createNavGrid / navFromTiles / navFromShapes) for paths, flow fields and sight
 *   los(x0, y0, x1, y1)  line-of-sight test; default: the grid's lineClear, or always clear without a grid
 *   move(agent, dx, dy)  moves a body and returns { x, y } (the collision engine's world.move); default: slide on the grid
 *   factions             { allies, neutral, hostile, other, ... } (see createSocial), or any object with relation(a, b)
 *   places               { inn: { x, y }, ... } shared places for schedules; agents add their own home and work
 *   dayLength = 1200     seconds of play in one game day;  startHour = 8
 *   archetypes, brains, actions, conditions, inputs, schedules, needs, barks   { name: definition } added to the
 *                        built-in ones ({ name: null } removes one)
 *   activeRadius = 30 m, nearRadius = 70 m   distance from a focus for full and reduced simulation
 *   senseEvery = 0.25, thinkEvery = 0.2, nearEvery = 0.25, farEvery = 2   seconds between updates
 *   attackers = 2        how many of a surrounding group may strike at once;  flowAt = 6: group size that shares a flow field
 *   pathsPerStep = 6, maxNodes = 4000   path-finding budget per step and per search
 *   resolveHits = true   settle hits itself (false, or agent.driven, when a combat engine does it)
 *   keepDead = false     keep dead agents in the state instead of removing them at the end of the step
 *   reputation           { kill: -0.3, hurt: -0.04, witness: true }: standing lost with a faction for killing one of
 *                        its members (in sight of another, unless witness is false) and for striking one who was no enemy
 *   autoTier = true      pick tiers from step()'s focus (false: the game calls setTier, see createWorldLink)
 *   state                wrap an existing ai state (loading a save, multiplayer)
 */
export function createAi(options = {}) {
  const cfg = createConfig(options);
  if (options.state) need(isAiState(options.state), 'createAi: options.state is not an ai state (use createAiState())');
  const sim = { cfg, state: options.state ?? createAiState(), ctx: null, order: [], list: [], stale: true, scratch: [], hash: createSpatialHash(8 * cfg.unit), fields: new Map(), packs: new Map(), stats: {}, events: [] };
  const listeners = new Map();
  let died = [];
  const get = (id, fn) => {
    const a = sim.state.agents[id];
    need(a, `ai.${fn}: no agent "${String(id)}". ${sim.order.length} agents${sim.order.length ? `, for example ${sim.order.slice(0, 5).join(', ')}` : ''}`);
    return a;
  };
  const adopt = () => {
    sim.order = sortedKeys(sim.state.agents); sim.stale = true;
    sim.fields.clear();
    if (cfg.ownSocial) cfg.factions.use(sim.state.standing);
  };

  const ctx = sim.ctx = {
    cfg, unit: cfg.unit, grid: cfg.grid, time: 0, tick: 0, hour: 0, dt: 0,
    get state() { return sim.state; },
    hourAt: (time) => hourOfDay(time, cfg.dayLength, cfg.startHour + sim.state.hourShift),
    actor: (id) => sim.state.agents[id] ?? sim.state.bodies[id] ?? null,
    near: (x, y, radius) => sim.hash.query(x, y, radius),
    nearAny: (x, y, radius) => sim.hash.query(x, y, radius, sim.scratch, false), // unsorted, into a shared list: use at once
    los: (x0, y0, x1, y1) => (cfg.los ? !!cfg.los(x0, y0, x1, y1) : cfg.grid ? cfg.grid.lineClear(x0, y0, x1, y1) : true),
    relation(a, b) {
      const p = a.rel ? a.rel[b.id] : undefined;
      if (p !== undefined) { if (p <= -0.5) return 'hostile'; if (p >= 0.5) return 'friendly'; }
      return cfg.factions.relation(a.faction, b.faction);
    },
    emit: (event) => { sim.events.push(event); },
    bark(agent, kind, o = {}) {
      const text = pickBark(cfg.barks, agent, kind, ctx.time, o);
      if (text === null) return false;
      sim.events.push({ type: 'bark', id: agent.id, kind, text, x: agent.x, y: agent.y });
      return true;
    },
    sound(s) { sim.state.soundN += 1; sim.state.sounds.push({ ...s, x: q(s.x), y: q(s.y), t: ctx.time, n: sim.state.soundN }); },
    placeOf(agent, name) {
      return agent.places[name] ?? cfg.places[name] ?? (name === 'home' ? agent.home : name === 'post' && agent.patrol ? { x: agent.patrol.points[0][0], y: agent.patrol.points[0][1] } : name === 'post' ? agent.home : null);
    },
    planOf: (agent) => (agent.schedule ? scheduleAt(cfg.schedules[agent.schedule], ctx.hour + hourOffset(agent.seed, cfg.scheduleSpread)) : null),
    packed: (targetId) => (sim.packs.get(targetId) || 0) >= cfg.flowAt,
    field: (targetId) => fieldFor(sim, targetId),
    // a blow lands: settle it here unless a combat engine does
    strike(agent, target, how) {
      ctx.sound({ x: agent.x, y: agent.y, kind: 'fight', loud: 10 * cfg.unit, by: agent.id });
      if (agent.driven || !cfg.resolveHits) return;
      const A = agent.attack;
      const d = dist(agent.x, agent.y, target.x, target.y);
      let hit;
      if (how === 'ranged') hit = d <= A.range * 1.1 && ctx.los(agent.x, agent.y, target.x, target.y) && roll(agent) < A.accuracy;
      else {
        const reach = (how === 'charge' ? agent.radius + 0.6 * cfg.unit : A.range) + (target.radius || 0);
        const off = d < 1e-6 ? 0 : Math.abs(angleDiff(facingOf(target.x - agent.x, target.y - agent.y), agent.intent.face ?? agent.facing));
        hit = d <= reach * 1.1 && off <= A.arc / 2;
      }
      const damage = A.damage;
      sim.events.push({ type: 'attack', id: agent.id, target: target.id, style: how, hit, damage: hit ? damage : 0, x: agent.x, y: agent.y });
      if (hit) hurt(target.id, damage, agent.id);
    },
  };

  function die(actor, by) {
    actor.alive = false; actor.hp = 0;
    sim.events.push({ type: 'death', id: actor.id, by: by ?? null, x: actor.x, y: actor.y });
    const agent = sim.state.agents[actor.id];
    if (agent) {
      calmDown(agent); agent.anim = 'dead';
      const squad = agent.squad ? sim.state.squads[agent.squad] : null;
      if (squad) squad.lost += 1;
      if (!cfg.keepDead) died.push(agent.id);
    }
    const killer = by ? ctx.actor(by) : null;
    let witnessed = !cfg.reputation.witness;
    for (const o of sim.hash.query(actor.x, actor.y, 14 * cfg.unit)) { // friends who saw it react
      const m = sim.state.agents[o.id];
      if (!m || !m.alive || m.id === actor.id || ctx.relation(m, actor) !== 'friendly') continue;
      if (!ctx.los(m.x, m.y, actor.x, actor.y)) continue;
      witnessed = true;
      ctx.bark(m, 'allyDown', { name: actor.name ?? actor.id });
      if (killer) { addThreat(m, killer.id, 1 + m.traits.aggression, { x: killer.x, y: killer.y, t: ctx.time }); m.alarm = q(ctx.time + 6); }
    }
    if (killer && witnessed && cfg.ownSocial && killer.faction !== actor.faction && cfg.reputation.kill !== 0) {
      for (const c of cfg.factions.addStanding(killer.faction, actor.faction, cfg.reputation.kill)) sim.events.push({ type: 'standing', ...c });
    }
  }

  function hurt(id, amount, by = null) {
    const actor = ctx.actor(id);
    need(actor, `ai.hurt: no agent or body "${String(id)}"`);
    need(amount >= 0, `ai.hurt: amount must be >= 0, got ${String(amount)}`);
    if (!actor.alive) return { hp: 0, killed: false };
    actor.hp = q(Math.max(0, (actor.hp ?? 1) - amount));
    sim.events.push({ type: 'hurt', id, by, amount, hp: actor.hp });
    const agent = sim.state.agents[id];
    const src = by ? ctx.actor(by) : null;
    if (agent && src) {
      if (ctx.relation(agent, src) !== 'hostile') { // attacked by a non-enemy: take it personally, and its faction thinks less of the attacker's
        relate(agent, src.id, -0.6);
        if (cfg.ownSocial && cfg.reputation.hurt !== 0 && src.faction !== agent.faction) for (const c of cfg.factions.addStanding(src.faction, agent.faction, cfg.reputation.hurt)) sim.events.push({ type: 'standing', ...c });
      }
      addThreat(agent, src.id, 1 + amount * 2, { x: src.x, y: src.y, t: ctx.time });
      agent.alarm = q(ctx.time + 6);
      ctx.bark(agent, 'hurt', { again: 4 });
    }
    if (actor.hp <= 0) { die(actor, by); return { hp: 0, killed: true }; }
    return { hp: actor.hp, killed: false };
  }

  function flush(events) {
    for (const e of events) {
      for (const fn of listeners.get(e.type) ?? []) fn(e, ai);
      for (const fn of listeners.get('*') ?? []) fn(e, ai);
    }
  }
  function remove(id) {
    const a = sim.state.agents[id];
    if (!a) return;
    const squad = a.squad ? sim.state.squads[a.squad] : null;
    if (squad) { removeSorted(squad.members, id); if (!squad.members.length) delete sim.state.squads[a.squad]; }
    delete sim.state.agents[id];
    removeSorted(sim.order, id); sim.stale = true;
  }
  function joinSquad(agent, squadId) {
    need(isId(squadId), `ai: squad id must be letters, digits, _ . : -, got ${JSON.stringify(squadId)}`);
    const squad = sim.state.squads[squadId] || (sim.state.squads[squadId] = { id: squadId, members: [], size: 0, lost: 0 });
    insertSorted(squad.members, agent.id);
    squad.size = Math.max(squad.size, squad.members.length);
    agent.squad = squadId;
  }

  const ai = {
    /** The config in use (read only): archetypes, brains, schedules, needs, barks, factions, grid. */
    config: cfg,
    /** factions: relation(a, b), hostile(a, b), standingOf(a, b), addStanding(a, b, delta), setStanding(a, b, value). Pass it to createCombat({ factions }) to share one table. */
    factions: cfg.factions,
    get state() { return sim.state; },
    setState(state) { need(isAiState(state), 'ai.setState: not an ai state'); sim.state = state; adopt(); return ai; },
    toJSON: () => structuredClone(sim.state),
    load(data) { need(isAiState(data), 'ai.load: not a saved ai state'); for (const id of sortedKeys(data.agents)) need(isAgent(data.agents[id]), `ai.load: agent "${id}" is damaged`); return ai.setState(structuredClone(data)); },
    get time() { return sim.state.time; },
    /** hour -> the hour of the game day, 0..24. setHour(h) jumps the clock (to follow the game's own time of day). */
    get hour() { return ctx.hourAt(sim.state.time); },
    setHour(h) { need(Number.isFinite(h), `ai.setHour: hour must be a number, got ${String(h)}`); sim.state.hourShift = q((((h - hourOfDay(sim.state.time, cfg.dayLength, cfg.startHour)) % 24) + 24) % 24); return ai; },

    /** add(options) -> the agent. See makeAgent for the options ({ id, kind, x, y, ... }). */
    add(o = {}) {
      need(!sim.state.agents[o.id] && !sim.state.bodies[o.id], `ai.add: there already is an agent or body "${o.id}"`);
      const agent = makeAgent(cfg, o);
      agent.needsT = sim.state.time;
      sim.state.agents[agent.id] = agent;
      insertSorted(sim.order, agent.id); sim.stale = true;
      if (agent.squad) joinSquad(agent, agent.squad);
      return agent;
    },
    /**
     * adopt(agent) puts back an agent object that was taken out with release() or saved by the world link
     * (a world chunk waking up, perhaps in a later session). It comes back calm, and every time stamp it
     * carries is reset to this ai's clock; its needs, blackboard, feelings, patrol and health are kept.
     */
    adopt(agent) {
      need(isAgent(agent), 'ai.adopt: not an agent (it must come from ai.release or a save)');
      need(!sim.state.agents[agent.id], `ai.adopt: there already is an agent "${agent.id}"`);
      calmDown(agent);
      agent.calm = 0; agent.heardT = sim.state.soundN; agent.needsT = sim.state.time; agent.talk = null; agent.lastSeen = null;
      agent.said = { t: -100, kinds: {}, last: agent.said?.last ?? {} }; agent.combat.last = -100; agent.acc = 0;
      sim.state.agents[agent.id] = agent;
      insertSorted(sim.order, agent.id); sim.stale = true;
      if (agent.squad) joinSquad(agent, agent.squad);
      return agent;
    },
    /** release(id) -> the agent's plain state, removed from the ai (a world chunk going to sleep). */
    release(id) { const a = get(id, 'release'); remove(id); return a; },
    remove(id) { get(id, 'remove'); remove(id); return ai; },
    has: (id) => !!sim.state.agents[id],
    /** get(id) -> the live agent state (read it; change it through the methods or its bb / tags). Throws when unknown. */
    get: (id) => get(id, 'get'),
    agents: () => sim.order.map((id) => sim.state.agents[id]),
    count: () => sim.order.length,
    view: (id) => agentView(get(id, 'view')),
    /**
     * setBody(id, body) tells the ai about someone it does not control (a player): { x, y, faction } are
     * required; vx, vy, facing, radius, hp, maxHp, alive, name, stealth (0..1) and noise (how far its
     * footsteps carry, 0 = silent) are optional. Call it whenever the body moves.
     */
    setBody(id, body) {
      need(isId(id) && !sim.state.agents[id], `ai.setBody: id must be a free id of letters, digits, _ . : -, got ${JSON.stringify(id)}`);
      need(body && Number.isFinite(body.x) && Number.isFinite(body.y), `ai.setBody("${id}"): x and y must be numbers`);
      const b = sim.state.bodies[id] || (sim.state.bodies[id] = { id, faction: 'player', radius: 0.35 * cfg.unit, alive: true, hp: 10, maxHp: 10, vx: 0, vy: 0 });
      for (const k of ['x', 'y', 'vx', 'vy', 'facing', 'radius', 'hp', 'maxHp', 'stealth', 'noise']) if (Number.isFinite(body[k])) b[k] = q(body[k]);
      if (typeof body.faction === 'string') b.faction = body.faction;
      if (typeof body.name === 'string') b.name = body.name;
      if (typeof body.alive === 'boolean') b.alive = body.alive;
      return ai;
    },
    removeBody(id) { delete sim.state.bodies[id]; return ai; },

    /** squad(id, memberIds) puts agents in one squad: they share targets, take turns attacking, and follow the lowest id. */
    squad(id, members) {
      need(Array.isArray(members), 'ai.squad: members must be a list of agent ids');
      for (const m of members) { const a = get(m, 'squad'); if (a.squad && a.squad !== id) { const old = sim.state.squads[a.squad]; if (old) removeSorted(old.members, m); } joinSquad(a, id); }
      return ai;
    },
    /** setTier(id, tier) 0 active, 1 near, 2 far. Only needed with autoTier: false. */
    setTier(id, tier) { need(tier === 0 || tier === 1 || tier === 2, `ai.setTier: tier must be 0, 1 or 2, got ${String(tier)}`); get(id, 'setTier').tier = tier; return ai; },
    /** catchUp(id, seconds) brings an agent up to date after time away (see lod.js). */
    catchUp(id, seconds) { ctx.time = sim.state.time; ctx.hour = ctx.hourAt(sim.state.time); catchUpAgent(ctx, get(id, 'catchUp'), seconds); return ai; },
    /** setGrid(grid) swaps the nav grid (a new level). setPlace(name, { x, y }) adds or moves a shared place. */
    setGrid(grid) { need(grid === null || (grid.cost && typeof grid.lineClear === 'function'), 'ai.setGrid: not a nav grid'); cfg.grid = grid; sim.fields.clear(); return ai; },
    setPlace(name, p) { need(p && Number.isFinite(p.x) && Number.isFinite(p.y), `ai.setPlace("${name}"): need { x, y }`); cfg.places[name] = { x: p.x, y: p.y }; return ai; },

    /** sound({ x, y, loud, kind = 'noise', by }) makes a noise agents within `loud` game units may hear and look into. */
    sound(s) {
      need(s && Number.isFinite(s.x) && Number.isFinite(s.y) && s.loud > 0, `ai.sound: need { x, y, loud } with loud above 0, got ${JSON.stringify(s)}`);
      ctx.time = sim.state.time;
      ctx.sound({ x: s.x, y: s.y, loud: s.loud, kind: s.kind ?? 'noise', by: s.by ?? null });
      return ai;
    },
    /** hurt(id, amount, by) -> { hp, killed }. Damages an agent or body, raises threat against `by`, may kill. */
    hurt(id, amount, by = null) { ctx.time = sim.state.time; return hurt(id, amount, by); },
    /** threat(id, sourceId, amount) makes an agent care more about someone (a taunt, damage dealt by another engine). */
    threat(id, sourceId, amount) {
      const src = ctx.actor(sourceId);
      need(src, `ai.threat: no agent or body "${String(sourceId)}"`);
      const a = get(id, 'threat');
      addThreat(a, sourceId, amount, { x: src.x, y: src.y, t: sim.state.time });
      a.alarm = q(sim.state.time + 6);
      return ai;
    },
    heal(id, amount) { const a = ctx.actor(id); need(a, `ai.heal: no agent or body "${String(id)}"`); if (a.alive) a.hp = q(clamp(a.hp + amount, 0, a.maxHp)); return ai; },
    kill(id, by = null) { const a = ctx.actor(id); need(a, `ai.kill: no agent or body "${String(id)}"`); ctx.time = sim.state.time; if (a.alive) die(a, by); return ai; },
    /** sees(id, otherId) -> true when the agent can see the other right now (range, cone, walls). */
    sees(id, otherId) { const o = ctx.actor(otherId); return !!o && canSee(ctx, get(id, 'sees'), o); },
    relation(idA, idB) { const a = ctx.actor(idA); const b = ctx.actor(idB); need(a && b, `ai.relation: unknown id "${String(a ? idB : idA)}"`); return ctx.relation(a, b); },
    /** like(id, otherId, delta) -> the agent's new personal feeling toward someone, -1..1 (at -0.5 it turns hostile, at 0.5 friendly). */
    like: (id, otherId, delta) => relate(get(id, 'like'), otherId, delta),

    /**
     * talk(id, withId) -> { ok, dialogue } starts a conversation: the agent stops, turns to `withId` and waits.
     * dialogue is the agent's dialogue id for the dialogue engine. Not ok when it is dead, fighting or fleeing.
     * endTalk(id) lets it go on with its day.
     */
    talk(id, withId) {
      const a = get(id, 'talk');
      if (!a.alive || a.target || a.fear >= 0.5) return { ok: false, reason: !a.alive ? 'dead' : 'busy', dialogue: null };
      a.talk = { with: withId, t: sim.state.time }; a.thinkT = 0;
      sim.events.push({ type: 'talk', id, with: withId, dialogue: a.dialogue });
      return { ok: true, dialogue: a.dialogue };
    },
    endTalk(id) { const a = get(id, 'endTalk'); if (a.talk) { a.talk = null; a.thinkT = 0; sim.events.push({ type: 'talkEnd', id }); } return ai; },

    /**
     * step(dt, { focus }) -> events[]. Advances everything by dt seconds. focus is { x, y } or a list of them
     * (the players, the camera): agents near a focus are simulated fully, the rest more and more coarsely.
     * Without a focus every agent keeps the tier it has (0 = full detail by default).
     */
    step(dt, o = {}) {
      need(dt > 0 && dt <= 1, `ai.step: dt must be seconds in (0, 1], got ${String(dt)}`);
      const focus = o.focus ? (Array.isArray(o.focus) ? o.focus : [o.focus]) : [];
      for (const f of focus) need(f && Number.isFinite(f.x) && Number.isFinite(f.y), `ai.step: focus must be { x, y } or a list of them, got ${JSON.stringify(f)}`);
      stepSim(sim, dt, focus);
      const events = sim.events;
      sim.events = [];
      for (const id of died) remove(id);
      died = [];
      flush(events);
      return events;
    },
    /** drain() -> events from direct calls (hurt, kill, talk, sound) made since the last step, and forgets them. */
    drain() { const out = sim.events; sim.events = []; flush(out); return out; },
    /** on(type, fn) listens for events ('bark', 'aggro', 'death', ... or '*'). fn(event, ai). Returns a function that removes the listener. */
    on(type, fn) {
      need(typeof fn === 'function', `ai.on("${type}"): the listener must be a function`);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    /** stats() -> counts from the last step: { agents, active, near, far, thought, paths, expanded, fields, waiting }. */
    stats: () => ({ agents: sim.order.length, ...sim.stats }),
    /** snapshot() -> { time, hour, agents: { id: view } } for debug overlays and play-tests. */
    snapshot: () => ({ time: sim.state.time, tick: sim.state.tick, hour: q(ctx.hourAt(sim.state.time)), agents: Object.fromEntries(sim.order.map((id) => [id, agentView(sim.state.agents[id])])) }),
  };
  adopt();
  return ai;
}
