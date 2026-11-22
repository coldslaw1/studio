// createCombat: the object a game talks to. It wraps a plain JSON state and
// advances it in fixed steps. Same state + same inputs + same rng = same
// result on every machine, which is what makes it safe to run on a server.
import { need, num, round, sortedIds } from './util.js';
import { createConfig } from './config.js';
import { createCombatState, isCombatState, makeFighter, cleanInput, fighterView } from './state.js';
import { hurt, heal as healFighter, kill, setAct, stagger } from './damage.js';
import { applyStatus, clearStatus, hasStatus, stepStatuses, statusMods } from './status.js';
import { stepIntent, stepAttack, stepGuard, startAttack, startDodge, currentMove } from './melee.js';
import { stepMotion, separate, moveScale } from './motion.js';
import { stepProjectiles, launch } from './projectile.js';
import { startThrow, stepThrow, dropCarried, pickup as pickupProjectile } from './throwing.js';
import { stepAi, makeBrain } from './ai.js';
import { moveOutline } from './hitbox.js';

/**
 * createCombat(options) -> combat
 *   collision     required: the collision engine module (its sweep, overlaps and box are used for hit tests)
 *   world         a collision world holding the scenery (walls, trees). Fighters are NOT bodies in it
 *   sceneryMask   = -1: layers of `world` that block fighters, blows and thrown weapons
 *   unit          = 1: game units per metre (1 in Kiln scenes, about 32 in pixel games). Scales every built-in length
 *   groundAt      (x, y) => ground height. Default: flat ground at 0
 *   rng           () => float in [0, 1): needed for crits and status chances (core createRng, net ctx.rng)
 *   gravity       = 20 * unit (units per second squared), knockbackDecay = 9 (per second), armorK = 10,
 *   separate      = true (fighters push each other apart), pickupReach = 0.8 * unit
 *   weapons, shields, throwables, statuses   { id: definition } added to the built-in ones (null removes one)
 *   factions      createFactions options: { allies, neutral, hostile, other, friendlyFire, neutralFire, selfHit }
 *   brains        { name: (sim, fighter, input) => void } extra mob brains;  steer(fighter, x, y) => [dx, dy] path-finding hook
 *   state         wrap an existing combat state (multiplayer, loading a save)
 */
export function createCombat(options = {}) {
  const cfg = createConfig(options);
  if (options.state) need(isCombatState(options.state), 'createCombat: options.state is not a combat state (use createCombatState())');
  const sim = { state: options.state ?? createCombatState(), cfg, events: [], rng: options.rng ?? null, dt: 0 };
  const listeners = new Map();
  let carry = []; // events from direct calls (combat.attack, combat.damage) since the last step
  const get = (id, fn) => {
    const f = sim.state.fighters[id];
    need(f, `combat.${fn}: no fighter "${String(id)}". Fighters: ${sortedIds(sim.state.fighters).join(', ') || 'none'}`);
    return f;
  };
  // run fn, hand the events it produced to the listeners, and return fn's result
  const act = (fn) => {
    const mark = sim.events.length;
    const result = fn();
    const fresh = sim.events.splice(mark);
    carry.push(...fresh);
    flush(fresh);
    return result;
  };
  function flush(events) {
    for (const e of events) {
      for (const fn of listeners.get(e.type) ?? []) fn(e, combat);
      for (const fn of listeners.get('*') ?? []) fn(e, combat);
    }
  }

  function stepFighter(f, dt) {
    dropCarried(sim, f);
    if (!f.alive) return;
    if (f.hitstop > 0) { f.hitstop = round(Math.max(0, f.hitstop - dt)); return; } // frozen: nothing else advances
    f.iframes = round(Math.max(0, f.iframes - dt));
    f.dodgeCd = round(Math.max(0, f.dodgeCd - dt));
    stepStatuses(sim, f, dt, (hit) => hurt(sim, hit));
    if (!f.alive) return;
    if (statusMods(cfg, f).stun && (f.act.kind === 'attack' || f.act.kind === 'throw')) setAct(f, 'idle');
    stepIntent(sim, f, dt, startThrow);
    const a = f.act;
    if (a.kind === 'attack') stepAttack(sim, f, dt);
    else if (a.kind === 'throw') stepThrow(sim, f, dt);
    else if (a.kind === 'stagger' || a.kind === 'dodge') { a.t += dt; if (a.t >= a.dur) setAct(f, 'idle'); }
    f.act.t = round(f.act.t);
    stepGuard(sim, f, dt);
  }

  const combat = {
    /** The config in use: weapons, shields, throwables, statuses, factions (read only). */
    config: cfg,
    get state() { return sim.state; },
    /** setState(state) swaps the wrapped state (multiplayer: the server sent a new one). */
    setState(state) { need(isCombatState(state), 'combat.setState: not a combat state'); sim.state = state; return combat; },
    toJSON: () => structuredClone(sim.state),
    load(data) { return combat.setState(structuredClone(data)); },
    get rng() { return sim.rng; },
    set rng(fn) { need(fn === null || typeof fn === 'function', 'combat.rng must be a function or null'); sim.rng = fn; },
    /** setWorld(world) swaps the scenery (a new level). */
    setWorld(world) { cfg.world = world; return combat; },

    /** addFighter(id, options) -> the fighter state. See makeFighter for the options; ai: true | 'melee' | { brain, sight, ... } gives it a brain. */
    addFighter(id, o = {}) {
      need(!sim.state.fighters[id], `combat.addFighter: there already is a fighter "${id}"`);
      const f = makeFighter(cfg, id, { ...o, ai: null });
      if (o.ai) f.ai = makeBrain(cfg, f, o.ai === true ? {} : typeof o.ai === 'string' ? { brain: o.ai } : o.ai);
      sim.state.fighters[id] = f;
      return f;
    },
    removeFighter(id) { get(id, 'removeFighter'); delete sim.state.fighters[id]; return combat; },
    has: (id) => !!sim.state.fighters[id],
    /** fighter(id) -> the live fighter state (read it; change it through the methods). Throws when unknown. */
    fighter: (id) => get(id, 'fighter'),
    fighters: () => sortedIds(sim.state.fighters).map((id) => sim.state.fighters[id]),
    view: (id) => fighterView(get(id, 'view')),
    get projectiles() { return sim.state.projectiles; },

    /** input(id, input) sets what the fighter's controller holds: { moveX, moveY, attack, block, dodge, throw, aimX, aimY, face }. */
    input(id, input) { get(id, 'input').input = cleanInput(input); return combat; },
    /** attack(id) -> { ok } swings now, or queues the next combo move when already swinging. Reasons: dead, busy. */
    attack(id) {
      const f = get(id, 'attack');
      if (!f.alive) return { ok: false, reason: 'dead' };
      if (f.act.kind === 'attack') { f.act.buffered = true; return { ok: true, buffered: true }; }
      if (f.act.kind !== 'idle' || f.hitstop > 0 || statusMods(cfg, f).stun) return { ok: false, reason: 'busy' };
      return act(() => { startAttack(sim, f, f.combo.t > 0 ? f.combo.next : 0); return { ok: true }; });
    },
    /** strike(id) opens the active window of a fighter whose timing is 'event' (call it from the puppet's 'hit' event). */
    strike(id) { const f = get(id, 'strike'); if (f.act.kind === 'attack' && f.act.phase === 'windup') f.act.go = true; return combat; },
    dodge(id) { const f = get(id, 'dodge'); return act(() => (f.alive && f.hitstop <= 0 && startDodge(sim, f) ? { ok: true } : { ok: false, reason: f.alive ? 'busy' : 'dead' })); },
    /** throw(id, { kind, aim: { x, y, z? }, item }) -> { ok, kind } | { ok: false, reason: dead | busy | nothing | ammo }. */
    throw(id, o = {}) { const f = get(id, 'throw'); return act(() => startThrow(sim, f, o)); },
    /** pickup(id, projId = nearest, reach) -> { ok, proj, kind, item } | { ok: false, reason: dead | busy | none }. */
    pickup(id, projId = null, reach) { const f = get(id, 'pickup'); return act(() => pickupProjectile(sim, f, projId, reach ?? cfg.pickupReach)); },
    /** spawnProjectile({ kind, x, y, z, vx, vy, vz, owner, faction, amount }) -> projectile (traps, turrets). */
    spawnProjectile(o) {
      const def = cfg.throwables[o.kind];
      need(def, `combat.spawnProjectile: unknown throwable "${String(o.kind)}"`);
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) need(Number.isFinite(o[k]), `combat.spawnProjectile: ${k} must be a number, got ${String(o[k])}`);
      return launch(sim, { ...o, amount: o.amount ?? def.damage });
    },

    /** place(id, x, y, z) puts a fighter somewhere (external fighters: call it after the game moved them). */
    place(id, x, y, z) {
      const f = get(id, 'place');
      need(Number.isFinite(x) && Number.isFinite(y), `combat.place: x and y must be numbers, got ${x}, ${y}`);
      f.x = x; f.y = y; f.z = num(z, f.vz !== 0 ? f.z : cfg.groundAt(x, y));
      return combat;
    },
    face(id, facing) { need(Number.isFinite(facing), 'combat.face: facing must be degrees'); get(id, 'face').facing = facing; return combat; },
    /** equip(id, { weapon, shield, throwable, ammo }) changes the loadout (null empties shield or throwable). */
    equip(id, o = {}) {
      const f = get(id, 'equip');
      if ('weapon' in o) { need(cfg.weapons[o.weapon], `combat.equip: unknown weapon "${o.weapon}"`); if (f.weapon !== o.weapon) { f.weapon = o.weapon; f.combo = { next: 0, t: 0 }; if (f.act.kind === 'attack') setAct(f, 'idle'); } }
      if ('shield' in o) { need(o.shield === null || cfg.shields[o.shield], `combat.equip: unknown shield "${o.shield}"`); if (f.shield !== o.shield) { f.shield = o.shield; f.guard = { on: false, t: 0, meter: -1 }; } }
      if ('throwable' in o) { need(o.throwable === null || cfg.throwables[o.throwable], `combat.equip: unknown throwable "${o.throwable}"`); f.throwable = o.throwable; }
      if ('ammo' in o) f.ammo = o.ammo ? { ...o.ammo } : null;
      return combat;
    },
    /** setStats(id, { attack, defense, resist, maxHp, speed }) updates numbers (for example from inventory.stats()). */
    setStats(id, s = {}) {
      const f = get(id, 'setStats');
      if (Number.isFinite(s.attack)) f.stats.attack = s.attack;
      if (Number.isFinite(s.defense)) f.stats.defense = s.defense;
      if (s.resist) f.stats.resist = { ...s.resist };
      if (s.maxHp > 0) { f.maxHp = s.maxHp; f.hp = Math.min(f.hp, f.maxHp); }
      if (s.speed >= 0) f.speed = s.speed;
      return combat;
    },

    /** damage(id, amount, { type, source, via, knockback, fromX, fromY, statuses, ... }) -> { outcome, damage } through the full pipeline (traps, spells). */
    damage(id, amount, o = {}) { get(id, 'damage'); need(amount >= 0, `combat.damage: amount must be >= 0, got ${amount}`); return act(() => hurt(sim, { via: 'melee', ...o, target: id, amount })); },
    heal(id, amount) { const f = get(id, 'heal'); return act(() => healFighter(sim, f, amount)); },
    kill(id, by = null) { const f = get(id, 'kill'); act(() => kill(sim, f, by)); return combat; },
    /** revive(id, hp = maxHp) brings a dead fighter back where it lies. */
    revive(id, hp) {
      const f = get(id, 'revive');
      f.alive = true; f.hp = Math.min(f.maxHp, hp > 0 ? hp : f.maxHp); f.iframes = 0; f.hitstop = 0; f.kb = { vx: 0, vy: 0 };
      setAct(f, 'idle');
      act(() => sim.events.push({ type: 'revive', id }));
      return combat;
    },
    stagger(id, seconds) { const f = get(id, 'stagger'); return act(() => stagger(sim, f, seconds)); },
    applyStatus(id, status, o) { const f = get(id, 'applyStatus'); return act(() => applyStatus(sim, f, status, o)); },
    clearStatus(id, status) { const f = get(id, 'clearStatus'); return act(() => clearStatus(sim, f, status)); },
    hasStatus: (id, status) => hasStatus(get(id, 'hasStatus'), status),
    relation: (a, b) => cfg.factions.relation(get(a, 'relation').faction, get(b, 'relation').faction),
    hostile: (a, b) => combat.relation(a, b) === 'hostile',

    /** timeScale(id) -> 0 while the fighter is frozen by hit-stop, else 1. Multiply the puppet's dt by it. */
    timeScale(id) { const f = get(id, 'timeScale'); return f.hitstop > 0 ? 0 : 1; },
    /** attackSpeed(id) -> multiplier on swing and throw timers from statuses (chill 0.75, haste 1.25); 1 normally. */
    attackSpeed: (id) => statusMods(cfg, get(id, 'attackSpeed')).attackSpeed,
    /** moveScale(id) -> 0..1 share of walking speed available now (0 while staggered, less while blocking or swinging). */
    moveScale: (id) => moveScale(cfg, get(id, 'moveScale')),
    /** pushOf(id) -> { dx, dy }: how far knockback, lunge and crowding want to move an external fighter this step. */
    pushOf: (id) => ({ ...get(id, 'pushOf').push }),
    /** moveOf(id) -> { weapon, move, index, phase, progress, outline } of the running attack, or null. */
    moveOf(id) {
      const f = get(id, 'moveOf');
      const move = currentMove(cfg, f);
      if (!move) return null;
      const progress = f.act.phase === 'active' ? Math.min(1, f.act.t / move.active) : f.act.phase === 'windup' ? 0 : 1;
      return { weapon: f.weapon, move: move.name, index: f.act.move, phase: f.act.phase, progress, outline: moveOutline(cfg, f, move, f.act.phase === 'windup' ? 1 : progress) };
    },

    /**
     * step(dt) -> events[]. Advances everything by dt seconds (use the fixed 1/60 of core's loop). The list also
     * holds the events of direct calls (combat.attack, combat.damage, ...) made since the last step.
     * Order: brains, each fighter in id order (statuses, input, attack, guard), movement, crowding, projectiles.
     */
    step(dt) {
      need(dt > 0 && dt <= 0.25, `combat.step: dt must be seconds in (0, 0.25], got ${dt}`);
      const state = sim.state;
      sim.events = []; sim.dt = dt;
      state.tick += 1; state.time = round(state.time + dt);
      const ids = sortedIds(state.fighters);
      for (const id of ids) stepAi(sim, state.fighters[id]);
      for (const id of ids) stepFighter(state.fighters[id], dt);
      for (const id of ids) stepMotion(sim, state.fighters[id], dt);
      separate(sim);
      stepProjectiles(sim, dt);
      const events = sim.events;
      sim.events = [];
      flush(events);
      const all = carry.length ? carry.concat(events) : events;
      carry = [];
      return all;
    },
    /** drain() -> the events of direct calls made since the last step, and forgets them (multiplayer rules use this). */
    drain() { const out = carry; carry = []; return out; },
    /** on(type, fn) listens for events ('hit', 'death', ... or '*'). fn(event, combat). Returns a function that removes the listener. */
    on(type, fn) {
      need(typeof fn === 'function', `combat.on("${type}"): the listener must be a function`);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    /** snapshot() -> { time, tick, fighters: { id: view }, projectiles: n } for HUDs, tests and play-tests. */
    snapshot: () => ({ time: sim.state.time, tick: sim.state.tick, fighters: Object.fromEntries(sortedIds(sim.state.fighters).map((id) => [id, fighterView(sim.state.fighters[id])])), projectiles: sim.state.projectiles.length }),
  };
  return combat;
}
