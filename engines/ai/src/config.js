// The ai config: every definition and setting that is NOT saved state (archetypes, brains, actions,
// schedules, needs, barks, factions, the nav grid, hooks). Built once by createAi; the simulation only reads it.
import { need, sortedKeys } from './util.js';
import { hashSeed } from './rng.js';
import { ARCHETYPES, checkArchetype } from './archetypes.js';
import { BRAINS } from './brains.js';
import { ACTIONS, CONDITIONS } from './actions.js';
import { INPUTS } from './inputs.js';
import { SCHEDULES, checkSchedules } from './schedule.js';
import { NEEDS, checkNeeds } from './needs.js';
import { BARKS, checkBarks } from './barks.js';
import { checkGoals } from './utility.js';
import { compileTree } from './bt.js';
import { createSocial } from './social.js';

// built-ins plus the game's own; { name: null } removes a built-in
const merged = (builtIn, extra) => {
  const out = { ...builtIn };
  for (const k of sortedKeys(extra || {})) { if (extra[k] === null) delete out[k]; else out[k] = extra[k]; }
  return out;
};
const seconds = (v, name) => { need(v > 0, `createAi: ${name} must be seconds above 0, got ${String(v)}`); return v; };

/** compileBrain(def, name, registry) -> { goals, byId, inertia } with every goal's tree compiled and checked. */
export function compileBrain(def, name, registry) {
  need(def && Array.isArray(def.goals), `createAi: brain "${name}" must be { goals: [...] }`);
  checkGoals(def.goals, registry.inputs, `createAi: brain "${name}"`);
  const goals = def.goals.map((g) => {
    need(g.tree !== undefined, `createAi: brain "${name}" goal "${g.id}" needs a tree`);
    return { ...g, compiled: compileTree(g.tree, registry, `createAi: brain "${name}" goal "${g.id}"`) };
  });
  return { goals, byId: Object.fromEntries(goals.map((g) => [g.id, g])), inertia: def.inertia ?? 0.1 };
}

/**
 * createConfig(options) -> cfg. See createAi for the options. Throws when a definition is malformed or
 * names something that does not exist, so mistakes show up at start-up and not mid-game.
 */
export function createConfig(options = {}) {
  const unit = options.unit ?? 1;
  need(unit > 0, `createAi: unit must be above 0 (game units per metre), got ${String(unit)}`);
  for (const k of ['los', 'move', 'visible']) if (options[k] != null) need(typeof options[k] === 'function', `createAi: options.${k} must be a function`);
  if (options.grid != null) need(options.grid.cost && typeof options.grid.lineClear === 'function', 'createAi: options.grid must be a nav grid (createNavGrid, navFromTiles or navFromShapes)');
  const registry = { actions: merged(ACTIONS, options.actions), conditions: merged(CONDITIONS, options.conditions), inputs: merged(INPUTS, options.inputs) };
  for (const kind of ['actions', 'conditions', 'inputs']) for (const k of sortedKeys(registry[kind])) need(typeof registry[kind][k] === 'function', `createAi: ${kind}.${k} must be a function`);
  const archetypes = merged(ARCHETYPES, options.archetypes);
  for (const k of sortedKeys(archetypes)) checkArchetype(archetypes[k], k);
  const brainDefs = merged(BRAINS, options.brains);
  const brains = {};
  for (const k of sortedKeys(brainDefs)) brains[k] = compileBrain(brainDefs[k], k, registry);
  const f = options.factions;
  const ownSocial = !(f && typeof f.relation === 'function');
  const places = {};
  for (const k of sortedKeys(options.places || {})) {
    const p = options.places[k];
    need(p && Number.isFinite(p.x) && Number.isFinite(p.y), `createAi: places.${k} must be { x, y }, got ${JSON.stringify(p)}`);
    places[k] = { x: p.x, y: p.y };
  }
  const cfg = {
    unit, seed: typeof options.seed === 'number' ? options.seed | 0 : hashSeed(options.seed ?? 0),
    grid: options.grid ?? null, los: options.los ?? null, move: options.move ?? null, visible: options.visible ?? null,
    dayLength: seconds(options.dayLength ?? 1200, 'dayLength'), startHour: options.startHour ?? 8,
    senseEvery: seconds(options.senseEvery ?? 0.25, 'senseEvery'), thinkEvery: seconds(options.thinkEvery ?? 0.2, 'thinkEvery'),
    nearEvery: seconds(options.nearEvery ?? 0.25, 'nearEvery'), farEvery: seconds(options.farEvery ?? 2, 'farEvery'),
    activeRadius: options.activeRadius ?? 30 * unit, nearRadius: options.nearRadius ?? 70 * unit, autoTier: options.autoTier !== false,
    attackers: options.attackers ?? 2, flowAt: options.flowAt ?? 6, pathsPerStep: options.pathsPerStep ?? 6, maxNodes: options.maxNodes ?? 4000,
    spread: options.spread ?? 0.18, scheduleSpread: options.scheduleSpread ?? 0.4,
    resolveHits: options.resolveHits !== false, keepDead: options.keepDead === true,
    reputation: { kill: -0.3, hurt: -0.04, witness: true, ...(options.reputation || {}) },
    archetypes, brains, registry, places,
    schedules: checkSchedules(merged(SCHEDULES, options.schedules), 'createAi'),
    needs: checkNeeds(merged(NEEDS, options.needs), 'createAi'),
    barks: checkBarks(merged(BARKS, options.barks), 'createAi'),
    factions: ownSocial ? createSocial(f || {}) : f, ownSocial,
  };
  need(cfg.nearRadius >= cfg.activeRadius && cfg.activeRadius >= 0, `createAi: need 0 <= activeRadius (${cfg.activeRadius}) <= nearRadius (${cfg.nearRadius})`);
  need(Number.isInteger(cfg.attackers) && cfg.attackers >= 1, `createAi: attackers must be a whole number >= 1, got ${String(cfg.attackers)}`);
  need(Number.isInteger(cfg.pathsPerStep) && cfg.pathsPerStep >= 1, `createAi: pathsPerStep must be a whole number >= 1, got ${String(cfg.pathsPerStep)}`);
  return cfg;
}
