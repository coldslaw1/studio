// One agent's state: a plain JSON object. Everything an agent knows, wants and is doing is in here,
// so an agent can be saved, sent over the network, or put to sleep inside a world chunk and woken later.
import { need, isId, q, finite } from './util.js';
import { hashSeed, hashInts, rand2 } from './rng.js';
import { personality, TRAITS } from './archetypes.js';

/** emptyIntent() -> what an agent wants its body to do this step; the same fields as the combat engine's input, plus `run`. */
export const emptyIntent = () => ({ moveX: 0, moveY: 0, face: null, attack: false, block: false, dodge: false, throw: false, aimX: null, aimY: null, run: false });

const point = (p, what) => {
  const a = Array.isArray(p) ? { x: p[0], y: p[1] } : p;
  need(a && Number.isFinite(a.x) && Number.isFinite(a.y), `ai.add: ${what} must be { x, y } or [x, y], got ${JSON.stringify(p)}`);
  return { x: q(a.x), y: q(a.y) };
};

/**
 * makeAgent(cfg, options) -> agent. cfg is the ai's config (unit, archetypes, schedules, needs, brains).
 * Options (lengths in game units unless noted):
 *   id        required: letters, digits, _ . : -
 *   kind      = 'villager': an archetype name (wolf, boar, slime, goblin, guard, ...). It fills in every default below
 *   x, y      required position;  facing = 180 (degrees: 0 up, 90 right, 180 down)
 *   seed      = a hash of the id and the ai's seed: makes this individual's personality and all its random choices
 *   name      shown in barks about it;  faction, brain, voice, schedule, tactic, fleeAt, leash: override the archetype
 *   size      = 1: scales health, radius, damage and reach (Kiln's asset.size)
 *   hp, maxHp, speed, run, radius   override the archetype (speed and run in game units per second)
 *   traits, senses, attack          partial overrides, merged over the archetype's
 *   home      = { x, y } of the start;  places: { work: { x, y }, home, post, ... } for schedules
 *   patrol    [[x, y], ...] points to walk in a loop;  squad: id of the group it fights and travels with
 *   needs     { hunger: 0.2, ... } starting values (default: the archetype's needs at seeded values)
 *   dialogue  id handed to the game when someone talks to it;  rel: { otherId: -1..1 } personal feelings
 *   driven    = false: true when something else moves the body (the combat engine); the ai then only writes agent.intent
 *   bb        starting blackboard values;  tags: free data for the game
 */
export function makeAgent(cfg, o = {}) {
  need(isId(o.id), `ai.add: id must be a string of letters, digits, _ . : -, got ${JSON.stringify(o.id)}`);
  const kind = o.kind ?? 'villager';
  const def = cfg.archetypes[kind];
  need(def, `ai.add("${o.id}"): unknown kind "${kind}". Known: ${Object.keys(cfg.archetypes).sort().join(', ')}`);
  need(Number.isFinite(o.x) && Number.isFinite(o.y), `ai.add("${o.id}"): x and y must be numbers, got ${String(o.x)}, ${String(o.y)}`);
  const u = cfg.unit;
  const size = o.size ?? 1;
  need(size > 0, `ai.add("${o.id}"): size must be above 0, got ${String(size)}`);
  const seed = o.seed === undefined ? hashInts(hashSeed(o.id), cfg.seed) | 0 : typeof o.seed === 'number' ? o.seed | 0 : hashSeed(o.seed);
  const brain = o.brain ?? def.brain;
  need(cfg.brains[brain], `ai.add("${o.id}"): unknown brain "${brain}". Known: ${Object.keys(cfg.brains).sort().join(', ')}`);
  const schedule = o.schedule === undefined ? def.schedule : o.schedule;
  if (schedule !== null) need(cfg.schedules[schedule], `ai.add("${o.id}"): unknown schedule "${schedule}". Known: ${Object.keys(cfg.schedules).sort().join(', ')}`);
  const traits = personality(seed, def.traits, cfg.spread);
  for (const t of TRAITS) if (o.traits && o.traits[t] !== undefined) { need(o.traits[t] >= 0 && o.traits[t] <= 1, `ai.add("${o.id}"): traits.${t} must be 0..1, got ${String(o.traits[t])}`); traits[t] = o.traits[t]; }
  const a = { ...def.attack, ...(o.attack || {}) };
  need(['melee', 'ranged', 'charge'].includes(a.style), `ai.add("${o.id}"): attack.style must be melee, ranged or charge, got "${a.style}"`);
  const fromDef = (k) => !(o.attack && k in o.attack); // archetype lengths are metres; overrides are game units
  const attack = { ...a, range: q(a.range * (fromDef('range') ? u * size : 1)), keep: q(a.keep * (fromDef('keep') ? u : 1)), damage: q(a.damage * (fromDef('damage') ? size : 1)) };
  const s = { ...def.senses, ...(o.senses || {}) };
  const senses = { ...s, sight: q(s.sight * (o.senses && 'sight' in o.senses ? 1 : u)) };
  const maxHp = o.maxHp ?? o.hp ?? Math.max(1, Math.round(def.hp * size));
  let needs = {};
  if (o.needs && !Array.isArray(o.needs)) needs = { ...o.needs };
  else (o.needs ?? def.needs).forEach((n, i) => { needs[n] = q(rand2(seed, 31 + i) * 0.4); });
  for (const n of Object.keys(needs)) need(cfg.needs[n], `ai.add("${o.id}"): unknown need "${n}". Known: ${Object.keys(cfg.needs).sort().join(', ')}`);
  const places = {};
  for (const [name, p] of Object.entries(o.places || {})) places[name] = point(p, `places.${name}`);
  const home = o.home ? point(o.home, 'home') : places.home ?? { x: q(o.x), y: q(o.y) };
  return {
    id: o.id, kind, role: def.role, brain, name: o.name ?? o.id, faction: o.faction ?? def.faction, voice: o.voice ?? def.voice,
    x: q(o.x), y: q(o.y), lx: q(o.x), ly: q(o.y), vx: 0, vy: 0, facing: finite(o.facing, 180),
    radius: q(o.radius ?? def.radius * u * size), speed: q(o.speed ?? def.speed * u), run: q(o.run ?? def.run * u),
    hp: Math.min(maxHp, o.hp ?? maxHp), maxHp, alive: true,
    seed, n: 0, tier: 0, acc: q(rand2(seed, 3)), senseT: q(rand2(seed, 5) * cfg.senseEvery), thinkT: q(rand2(seed, 6) * cfg.thinkEvery),
    traits, senses, attack, leash: q(o.leash ?? def.leash * u), fleeAt: o.fleeAt ?? def.fleeAt, tactic: o.tactic ?? def.tactic, pack: o.pack ?? def.pack,
    home, places, patrol: o.patrol ? { points: o.patrol.map((p) => { const v = point(p, 'patrol point'); return [v.x, v.y]; }), i: 0 } : null,
    squad: o.squad ?? null, schedule, needs, rel: { ...(o.rel || {}) }, dialogue: o.dialogue ?? null,
    goal: null, goalT: 0, bt: {}, bb: { ...(o.bb || {}) }, nav: null, intent: emptyIntent(),
    target: null, threat: {}, seen: {}, lastSeen: null, heard: null, needsT: 0, heardT: 0, alarm: 0, calm: 0, fear: 0, anchor: null,
    combat: { state: 'idle', t: 0, token: false, slotX: null, slotY: null, last: -100, dirX: 0, dirY: 0, plan: 'bite', hit: false, swung: false },
    activity: 'idle', place: null, talk: null, said: { t: -100, kinds: {}, last: {} },
    anim: 'idle', driven: o.driven === true, busy: false, staggered: false, stuck: 0, tags: { ...(o.tags || {}) },
  };
}

/** isAgent(value) -> true when the value looks like an agent made by makeAgent (used when loading saves). */
export function isAgent(value) {
  return !!value && typeof value === 'object' && isId(value.id) && Number.isFinite(value.x) && Number.isFinite(value.y) && !!value.intent && !!value.combat && !!value.traits;
}

/**
 * agentView(agent) -> a small copy for HUDs, debug overlays and play-tests: id, kind, faction, position,
 * health, goal, activity, anim, target, tier and the nearest thing it is walking to.
 */
export function agentView(a) {
  return {
    id: a.id, kind: a.kind, faction: a.faction, x: a.x, y: a.y, facing: a.facing, hp: a.hp, maxHp: a.maxHp, alive: a.alive,
    goal: a.goal, activity: a.activity, anim: a.anim, target: a.target, tier: a.tier, squad: a.squad,
    state: a.combat.state, going: a.nav ? { x: a.nav.tx, y: a.nav.ty } : null,
  };
}
