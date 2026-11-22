// Multiplayer through the `net` engine (Parley). The combat state is plain
// JSON, so it lives inside the room state. Held controls travel as Parley
// inputs (room.input), one-off moves as actions (room.send); the server steps
// the fight and every client just draws the state. Nothing is imported from net.
//
//   // rules.js
//   const fight = createCombatRules({ collision, combatOf: (state) => state.combat });
//   export default {
//     tickRate: 30,
//     setup(ctx) { const state = { combat: createCombatState() }; fight.use(state, ctx).addFighter(...); return state; },
//     onAction(state, player, action, ctx) { if (fight.onAction(state, player, action, ctx)) return; ... },
//     tick(state, dt, ctx) { fight.tick(state, dt, ctx); },
//   };
import { createCombat } from './combat.js';
import { throwableOf } from './throwing.js';
import { own } from './util.js';

/** The action types applyCombatAction understands. */
export const COMBAT_ACTIONS = ['combat.attack', 'combat.dodge', 'combat.throw', 'combat.pickup'];

/** isCombatAction(action) -> true when the action's type is one of COMBAT_ACTIONS. */
export const isCombatAction = (action) => !!action && typeof action === 'object' && COMBAT_ACTIONS.includes(action.type);

/**
 * applyCombatAction(combat, id, action) -> { ok: true, ... } | { ok: false, reason }
 * Applies one action for fighter `id`. The action is treated as hostile input: a malformed one returns
 * reason 'bad-action' and never throws. Types:
 *   combat.attack {}                      swing, or queue the next combo move
 *   combat.dodge {}                       roll (direction from the held input)
 *   combat.throw { aimX, aimY, kind }     throw at a ground point; `kind` only if the fighter carries it
 *   combat.pickup { proj }                pick up a thrown weapon in reach (nearest when proj is left out)
 */
export function applyCombatAction(combat, id, action) {
  if (!isCombatAction(action) || !combat.has(id)) return { ok: false, reason: 'bad-action' };
  const f = combat.fighter(id);
  switch (action.type) {
    case 'combat.attack': return combat.attack(id);
    case 'combat.dodge': return combat.dodge(id);
    case 'combat.throw': {
      const aimed = own(action, 'aimX') || own(action, 'aimY');
      if (aimed && !(Number.isFinite(action.aimX) && Number.isFinite(action.aimY))) return { ok: false, reason: 'bad-action' };
      let kind;
      if (own(action, 'kind')) {
        const carried = f.ammo ? (f.ammo[action.kind] || 0) > 0 : action.kind === throwableOf(combat.config, f);
        if (typeof action.kind !== 'string' || !own(combat.config.throwables, action.kind) || !carried) return { ok: false, reason: 'bad-action' };
        kind = action.kind;
      }
      return combat.throw(id, { kind, aim: aimed ? { x: action.aimX, y: action.aimY } : undefined });
    }
    case 'combat.pickup': {
      if (own(action, 'proj') && typeof action.proj !== 'string') return { ok: false, reason: 'bad-action' };
      return combat.pickup(id, action.proj ?? null);
    }
    default: return { ok: false, reason: 'bad-action' };
  }
}

const LOUD = ['attack', 'swing', 'hit', 'block', 'parry', 'guardbreak', 'dodge', 'death', 'revive', 'throw', 'bounce', 'stick', 'break', 'reflect', 'pickup', 'status', 'telegraph', 'aggro'];

/**
 * createCombatRules(options) -> { combat, use(state, ctx), handles(action), onAction(state, player, action, ctx), tick(state, dt, ctx) }
 *   ...every createCombat option (collision is required; rng is taken from ctx.rng)
 *   combatOf(state)            required: returns the combat state inside the room state (from createCombatState)
 *   fighterOf(state, player)   the fighter id a player controls. Default: player.id
 *   worldOf(state, ctx)        the scenery for this room, when rooms differ. Default: options.world
 *   emit = 'combat'            name of the Parley event carrying each combat event (false: send none)
 *   events                     list of event types worth sending (default: the ones a client draws or hears)
 * use(state, ctx) returns the combat object pointed at this room (call it in setup, onJoin and your own actions).
 * tick() copies each seated player's held input (ctx.inputs) to their fighter and steps the fight.
 * onAction() returns false when the action is not a combat action; a refused one calls ctx.reject(reason).
 */
export function createCombatRules(options = {}) {
  const { combatOf, fighterOf, worldOf, emit = 'combat', events = LOUD, ...rest } = options;
  if (typeof combatOf !== 'function') throw new Error('createCombatRules: options.combatOf(state) is required');
  const combat = createCombat(rest);
  const idOf = (state, player) => (fighterOf ? fighterOf(state, player) : player.id);
  function use(state, ctx) {
    combat.setState(combatOf(state));
    if (ctx && ctx.rng) combat.rng = ctx.rng;
    if (worldOf) combat.setWorld(worldOf(state, ctx));
    combat.drain(); // one combat object serves every room: never carry events across
    return combat;
  }
  const send = (ctx, list) => { if (emit) for (const e of list) if (events.includes(e.type)) ctx.emit(emit, e); };
  return {
    combat, use,
    handles: isCombatAction,
    onAction(state, player, action, ctx) {
      if (!isCombatAction(action)) return false;
      use(state, ctx);
      const result = applyCombatAction(combat, idOf(state, player), action);
      const made = combat.drain();
      if (!result.ok) ctx.reject(result.reason);
      send(ctx, made);
      return true;
    },
    tick(state, dt, ctx) {
      use(state, ctx);
      for (const player of ctx.players) {
        const id = idOf(state, player);
        if (combat.has(id)) combat.input(id, ctx.inputs[player.id]);
      }
      const made = combat.step(dt);
      send(ctx, made);
      return made;
    },
  };
}
