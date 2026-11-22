// The combat config: every definition and setting that is NOT saved state
// (weapons, shields, throwables, statuses, factions, brains, world hooks).
// Built once by createCombat; the simulation only reads it.
import { need, positive } from './util.js';
import { WEAPONS, SHIELDS, checkWeapon, checkShield } from './weapons.js';
import { THROWABLES, checkThrowable } from './throwables.js';
import { STATUSES, checkStatus } from './status.js';
import { createFactions } from './factions.js';
import { BRAINS } from './ai.js';

/**
 * createConfig(options) -> cfg. See createCombat for the options. Throws when something required is
 * missing or a definition is malformed, so mistakes show up at start-up and not mid-fight.
 */
export function createConfig(options = {}) {
  const c = options.collision;
  need(c && typeof c.sweep === 'function' && typeof c.overlaps === 'function' && typeof c.box === 'function',
    'createCombat: options.collision is required: pass the collision engine module (import * as collision from "./vendor/collision/index.js")');
  const world = options.world ?? null;
  if (world) need(typeof world.cast === 'function' && typeof world.raycastAll === 'function', 'createCombat: options.world must be a collision world (createCollisionWorld())');
  const unit = options.unit ?? 1;
  need(unit > 0, `createCombat: options.unit must be above 0 (game units per metre), got ${String(unit)}`);
  if (options.groundAt) need(typeof options.groundAt === 'function', 'createCombat: options.groundAt must be a function (x, y) => height');
  if (options.rng) need(typeof options.rng === 'function', 'createCombat: options.rng must be a function returning a float in [0, 1)');

  const table = (builtIn, extra, check, what) => {
    const out = {};
    for (const [id, def] of Object.entries({ ...builtIn, ...(extra || {}) })) {
      if (def === null) continue; // { sword: null } removes a built-in
      try { out[id] = check(def, id); } catch (err) { throw new Error(`createCombat: ${what} "${id}": ${err.message}`); }
    }
    return out;
  };
  const f = options.factions;
  const cfg = {
    collision: c, world, unit,
    sceneryMask: options.sceneryMask ?? -1,
    groundAt: options.groundAt ?? (() => 0),
    gravity: positive(options.gravity ?? 20 * unit, 'createCombat: gravity'),
    knockbackDecay: positive(options.knockbackDecay ?? 9, 'createCombat: knockbackDecay'),
    armorK: positive(options.armorK ?? 10, 'createCombat: armorK') || 10,
    skin: positive(options.skin ?? 0.005 * unit, 'createCombat: skin'),
    separate: options.separate !== false,
    pickupReach: positive(options.pickupReach ?? 0.8 * unit, 'createCombat: pickupReach'),
    steer: options.steer ?? null,
    weapons: table(WEAPONS(unit), options.weapons, checkWeapon, 'weapon'),
    shields: table(SHIELDS, options.shields, checkShield, 'shield'),
    throwables: table(THROWABLES(unit), options.throwables, (def, id) => checkThrowable(def, id, unit), 'throwable'),
    statuses: table(STATUSES, options.statuses, checkStatus, 'status'),
    factions: f && typeof f.scale === 'function' ? f : createFactions(f || {}),
    brains: { ...BRAINS, ...(options.brains || {}) },
  };
  // every status and throwable a definition names must exist
  const known = (list, where) => { for (const s of list) need(cfg.statuses[s.id], `createCombat: ${where} names the unknown status "${s.id}"`); };
  for (const w of Object.values(cfg.weapons)) {
    if (w.throws) need(cfg.throwables[w.throws], `createCombat: weapon "${w.id}" throws the unknown throwable "${w.throws}"`);
    for (const m of w.moves) known(m.statuses, `weapon "${w.id}" move "${m.name}"`);
  }
  for (const t of Object.values(cfg.throwables)) { known(t.statuses, `throwable "${t.id}"`); if (t.splash) known(t.splash.statuses, `throwable "${t.id}" splash`); }
  return cfg;
}
