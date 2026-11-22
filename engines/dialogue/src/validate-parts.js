// Validation of the small pieces of a story: unknown keys, conditions,
// effects and {var} placeholders in text. Used by validate.js.

import {
  CONDITION_KINDS, COMPARE_OPS, NUMBER_ONLY_OPS, QUEST_STATUSES, EFFECT_KINDS,
  EFFECT_EXTRA_KEYS, TEXT_VAR_PATTERN, isObject,
} from './spec.js';
import { didYouMean } from './suggest.js';

/**
 * Make the collector that every check reports into.
 * @param {object} data the story data (used to look up vars and quests)
 * @returns {object} context with error(), warn() and "used" sets
 */
export function createContext(data) {
  const ctx = {
    data,
    errors: [],
    warnings: [],
    used: { vars: new Set(), started: new Set(), progressed: new Set(), emitted: new Set() },
    error(code, path, message) { ctx.errors.push({ code, path, message }); },
    warn(code, path, message) { ctx.warnings.push({ code, path, message }); },
  };
  return ctx;
}

/** Report keys that the format does not know, with a spelling hint. */
export function checkKeys(ctx, object, allowed, path) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      ctx.error('unknown-key', `${path}.${key}`,
        `Unknown key "${key}".${didYouMean(key, allowed)} Allowed keys: ${allowed.join(', ')}.`);
    }
  }
}

function hasVar(ctx, name) {
  return isObject(ctx.data.vars) && Object.hasOwn(ctx.data.vars, name);
}

function varNames(ctx) {
  return isObject(ctx.data.vars) ? Object.keys(ctx.data.vars) : [];
}

function questNames(ctx) {
  return isObject(ctx.data.quests) ? Object.keys(ctx.data.quests) : [];
}

function checkVarRef(ctx, name, path) {
  if (typeof name !== 'string' || !hasVar(ctx, name)) {
    ctx.error('unknown-var', path,
      `Variable "${name}" is not declared in "vars".${didYouMean(name, varNames(ctx))}`);
    return false;
  }
  ctx.used.vars.add(name);
  return true;
}

function checkQuestRef(ctx, name, path) {
  if (typeof name !== 'string' || !questNames(ctx).includes(name)) {
    ctx.error('unknown-quest', path,
      `Quest "${name}" does not exist in "quests".${didYouMean(name, questNames(ctx))}`);
    return false;
  }
  return true;
}

/** Check a "quest.objective" reference. Returns true when it exists. */
export function checkObjectiveRef(ctx, ref, path) {
  const parts = typeof ref === 'string' ? ref.split('.') : [];
  if (parts.length !== 2) {
    ctx.error('bad-objective-ref', path, `Objective must be written "quest_id.objective_id", got ${JSON.stringify(ref)}.`);
    return false;
  }
  if (!checkQuestRef(ctx, parts[0], path)) return false;
  const objectives = ctx.data.quests[parts[0]].objectives;
  const ids = Array.isArray(objectives) ? objectives.filter(isObject).map((o) => o.id) : [];
  if (!ids.includes(parts[1])) {
    ctx.error('unknown-objective', path,
      `Quest "${parts[0]}" has no objective "${parts[1]}".${didYouMean(parts[1], ids)}`);
    return false;
  }
  return true;
}

function checkNodeRef(ctx, ref, path) {
  const parts = typeof ref === 'string' ? ref.split('.') : [];
  const dialogue = parts.length === 2 && isObject(ctx.data.dialogues) ? ctx.data.dialogues[parts[0]] : null;
  if (!isObject(dialogue) || !isObject(dialogue.nodes) || !Object.hasOwn(dialogue.nodes, parts[1])) {
    ctx.error('unknown-node', path, `"visited" must be "dialogue_id.node_id" of an existing node, got ${JSON.stringify(ref)}.`);
  }
}

/** Check one condition object (used in "if"). */
export function checkCondition(ctx, cond, path) {
  if (!isObject(cond)) {
    ctx.error('bad-condition', path, 'A condition must be an object like { "var": "coins", "gte": 5 }.');
    return;
  }
  const kinds = CONDITION_KINDS.filter((kind) => Object.hasOwn(cond, kind));
  if (kinds.length !== 1) {
    ctx.error('bad-condition', path, `A condition needs exactly one of: ${CONDITION_KINDS.join(', ')}. Found: ${kinds.join(', ') || 'none'}.`);
    return;
  }
  const kind = kinds[0];
  const extra = kind === 'var' ? COMPARE_OPS : kind === 'quest' ? ['is'] : [];
  checkKeys(ctx, cond, [kind, ...extra], path);
  if (kind === 'var') checkVarCondition(ctx, cond, path);
  if (kind === 'quest') {
    checkQuestRef(ctx, cond.quest, path);
    if (!QUEST_STATUSES.includes(cond.is)) {
      ctx.error('bad-condition', path, `A quest condition needs "is" set to one of: ${QUEST_STATUSES.join(', ')}.`);
    }
  }
  if (kind === 'objectiveDone') checkObjectiveRef(ctx, cond.objectiveDone, path);
  if (kind === 'visited') checkNodeRef(ctx, cond.visited, path);
  if (kind === 'not') checkCondition(ctx, cond.not, `${path}.not`);
  if (kind === 'all' || kind === 'any') {
    if (!Array.isArray(cond[kind]) || cond[kind].length === 0) {
      ctx.error('bad-condition', path, `"${kind}" must be a non-empty list of conditions.`);
    } else {
      cond[kind].forEach((inner, i) => checkCondition(ctx, inner, `${path}.${kind}[${i}]`));
    }
  }
}

function checkVarCondition(ctx, cond, path) {
  if (!checkVarRef(ctx, cond.var, path)) return;
  const ops = COMPARE_OPS.filter((op) => Object.hasOwn(cond, op));
  if (ops.length > 1) {
    ctx.error('bad-condition', path, `Use only one comparison per condition, found: ${ops.join(', ')}. Combine several with "all".`);
    return;
  }
  if (ops.length === 0) return; // { "var": "x" } alone means "x is truthy"
  const declared = typeof ctx.data.vars[cond.var];
  const given = typeof cond[ops[0]];
  if (NUMBER_ONLY_OPS.includes(ops[0]) && declared !== 'number') {
    ctx.error('type-mismatch', path, `"${ops[0]}" only works on number variables, but "${cond.var}" is a ${declared}.`);
  } else if (given !== declared) {
    ctx.error('type-mismatch', path, `Variable "${cond.var}" is a ${declared} but is compared with a ${given} (${JSON.stringify(cond[ops[0]])}).`);
  }
}

/** Check a list of effects (used in "do" and "rewards"). */
export function checkEffects(ctx, effects, path) {
  if (!Array.isArray(effects)) {
    ctx.error('bad-effect', path, 'Effects must be a list like [ { "add": "coins", "by": 1 } ].');
    return;
  }
  effects.forEach((effect, i) => checkEffect(ctx, effect, `${path}[${i}]`));
}

function checkEffect(ctx, effect, path) {
  const kinds = isObject(effect) ? EFFECT_KINDS.filter((kind) => Object.hasOwn(effect, kind)) : [];
  if (kinds.length !== 1) {
    ctx.error('bad-effect', path, `An effect needs exactly one of: ${EFFECT_KINDS.join(', ')}. Found: ${kinds.join(', ') || 'none'}.`);
    return;
  }
  const kind = kinds[0];
  checkKeys(ctx, effect, [kind, ...EFFECT_EXTRA_KEYS[kind]], path);
  if (kind === 'set' && checkVarRef(ctx, effect.set, path)) {
    const declared = typeof ctx.data.vars[effect.set];
    if (typeof effect.to !== declared) {
      ctx.error('type-mismatch', path, `Variable "${effect.set}" is a ${declared}, so "to" must be a ${declared} (got ${JSON.stringify(effect.to)}).`);
    }
  }
  if (kind === 'add' && checkVarRef(ctx, effect.add, path)) {
    if (typeof ctx.data.vars[effect.add] !== 'number') {
      ctx.error('type-mismatch', path, `"add" only works on number variables, but "${effect.add}" is a ${typeof ctx.data.vars[effect.add]}.`);
    }
    if (typeof effect.by !== 'number' || !Number.isFinite(effect.by)) {
      ctx.error('bad-effect', path, '"add" needs a number in "by", for example { "add": "coins", "by": -3 }.');
    }
  }
  if (kind === 'startQuest' && checkQuestRef(ctx, effect.startQuest, path)) ctx.used.started.add(effect.startQuest);
  if (kind === 'failQuest') checkQuestRef(ctx, effect.failQuest, path);
  if (kind === 'progress') {
    if (checkObjectiveRef(ctx, effect.progress, path)) ctx.used.progressed.add(effect.progress);
    if (Object.hasOwn(effect, 'by') && !(Number.isInteger(effect.by) && effect.by >= 1)) {
      ctx.error('bad-effect', path, '"by" on "progress" must be a whole number of 1 or more.');
    }
  }
  if (kind === 'emit') {
    const events = Array.isArray(ctx.data.events) ? ctx.data.events : [];
    if (!events.includes(effect.emit)) {
      ctx.error('unknown-event', path, `Event "${effect.emit}" is not listed in "events".${didYouMean(effect.emit, events)}`);
    } else {
      ctx.used.emitted.add(effect.emit);
    }
  }
}

/** Check that every {name} placeholder in a text is a declared variable. */
export function checkText(ctx, text, path) {
  for (const match of text.matchAll(TEXT_VAR_PATTERN)) checkVarRef(ctx, match[1], path);
}
