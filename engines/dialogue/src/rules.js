// Pure rules on a story state: evaluate conditions and apply effects.
// "state" is the plain object made by createState(); "emit" reports events.

import { COMPARE_OPS, TEXT_VAR_PATTERN } from './spec.js';

/**
 * Make the starting state for a story: variables at their starting values,
 * every quest inactive, nothing visited, no dialogue open.
 * @param {object} data the story data
 * @returns {object} { vars, quests, visited, chosen, at }
 */
export function createState(data) {
  const quests = {};
  for (const [id, quest] of Object.entries(data.quests || {})) {
    const objectives = {};
    for (const objective of quest.objectives) objectives[objective.id] = 0;
    quests[id] = { status: 'inactive', objectives };
  }
  return { vars: { ...(data.vars || {}) }, quests, visited: {}, chosen: {}, at: null };
}

function findObjective(data, ref, caller) {
  const [questId, objectiveId] = String(ref).split('.');
  const quest = (data.quests || {})[questId];
  const objective = quest ? quest.objectives.find((o) => o.id === objectiveId) : undefined;
  if (!objective) throw new Error(`${caller}: unknown objective "${ref}". Write it as "quest_id.objective_id".`);
  return { questId, objectiveId, quest, target: objective.count || 1, objective };
}

function needVar(state, name, caller) {
  if (!Object.hasOwn(state.vars, name)) throw new Error(`${caller}: unknown variable "${name}". Declare it in the story's "vars".`);
}

function needQuest(state, id, caller) {
  if (!Object.hasOwn(state.quests, id)) throw new Error(`${caller}: unknown quest "${id}".`);
}

/**
 * Is a "quest.objective" finished?
 * @returns {boolean}
 */
export function isObjectiveDone(data, state, ref) {
  const found = findObjective(data, ref, 'isObjectiveDone');
  return state.quests[found.questId].objectives[found.objectiveId] >= found.target;
}

/**
 * Evaluate a condition object against the state.
 * @param {object} data story data
 * @param {object} state story state
 * @param {object|undefined} cond condition; undefined counts as true
 * @returns {boolean}
 */
export function testCondition(data, state, cond) {
  if (cond === undefined) return true;
  if (cond === null || typeof cond !== 'object') throw new Error(`testCondition: a condition must be an object, got ${JSON.stringify(cond)}`);
  if ('all' in cond) return cond.all.every((inner) => testCondition(data, state, inner));
  if ('any' in cond) return cond.any.some((inner) => testCondition(data, state, inner));
  if ('not' in cond) return !testCondition(data, state, cond.not);
  if ('quest' in cond) { needQuest(state, cond.quest, 'testCondition'); return state.quests[cond.quest].status === cond.is; }
  if ('objectiveDone' in cond) return isObjectiveDone(data, state, cond.objectiveDone);
  if ('visited' in cond) return (state.visited[cond.visited] || 0) > 0;
  if ('var' in cond) {
    needVar(state, cond.var, 'testCondition');
    const value = state.vars[cond.var];
    const op = COMPARE_OPS.find((name) => name in cond);
    if (!op) return Boolean(value);
    const other = cond[op];
    if (op === 'eq') return value === other;
    if (op === 'ne') return value !== other;
    if (op === 'gt') return value > other;
    if (op === 'gte') return value >= other;
    if (op === 'lt') return value < other;
    return value <= other;
  }
  throw new Error(`testCondition: unknown condition ${JSON.stringify(cond)}`);
}

function finishQuestIfReady(data, state, questId, emit) {
  const quest = data.quests[questId];
  const ready = quest.objectives.every((o) => o.optional === true || state.quests[questId].objectives[o.id] >= (o.count || 1));
  if (!ready) return;
  state.quests[questId].status = 'done';
  emit('questDone', { quest: questId });
  applyEffects(data, state, quest.rewards || [], emit);
}

/**
 * Apply one effect object to the state (mutates state).
 * Quest effects on a quest that is not active are ignored on purpose.
 * @param {object} data story data
 * @param {object} state story state
 * @param {object} effect for example { "add": "coins", "by": 2 }
 * @param {function} emit called as emit(type, payload) for each thing that happened
 */
export function applyEffect(data, state, effect, emit) {
  if (effect === null || typeof effect !== 'object') throw new Error(`applyEffect: an effect must be an object, got ${JSON.stringify(effect)}`);
  if ('set' in effect || 'add' in effect) {
    const name = 'set' in effect ? effect.set : effect.add;
    needVar(state, name, 'applyEffect');
    const previous = state.vars[name];
    const value = 'set' in effect ? effect.to : previous + effect.by;
    if (typeof value !== typeof previous || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error(`applyEffect: variable "${name}" is a ${typeof previous}, cannot become ${JSON.stringify(value)}`);
    }
    state.vars[name] = value;
    if (value !== previous) emit('varChanged', { name, value, previous });
  } else if ('startQuest' in effect) {
    needQuest(state, effect.startQuest, 'applyEffect');
    if (state.quests[effect.startQuest].status !== 'inactive') return;
    state.quests[effect.startQuest].status = 'active';
    emit('questStarted', { quest: effect.startQuest });
  } else if ('failQuest' in effect) {
    needQuest(state, effect.failQuest, 'applyEffect');
    if (state.quests[effect.failQuest].status !== 'active') return;
    state.quests[effect.failQuest].status = 'failed';
    emit('questFailed', { quest: effect.failQuest });
  } else if ('progress' in effect) {
    const found = findObjective(data, effect.progress, 'applyEffect');
    const by = effect.by === undefined ? 1 : effect.by;
    if (!Number.isInteger(by) || by < 1) throw new Error(`applyEffect: progress "by" must be a whole number of 1 or more, got ${JSON.stringify(by)}`);
    const questState = state.quests[found.questId];
    const before = questState.objectives[found.objectiveId];
    if (questState.status !== 'active' || before >= found.target) return;
    const count = Math.min(found.target, before + by);
    questState.objectives[found.objectiveId] = count;
    emit('objectiveProgress', { quest: found.questId, objective: found.objectiveId, count, target: found.target });
    if (count >= found.target) {
      emit('objectiveDone', { quest: found.questId, objective: found.objectiveId });
      finishQuestIfReady(data, state, found.questId, emit);
    }
  } else if ('emit' in effect) {
    emit('event', { name: effect.emit });
  } else {
    throw new Error(`applyEffect: unknown effect ${JSON.stringify(effect)}`);
  }
}

/**
 * Apply a list of effects in order.
 * @param {object} data story data
 * @param {object} state story state
 * @param {object[]} effects list of effect objects
 * @param {function} emit called as emit(type, payload)
 */
export function applyEffects(data, state, effects, emit) {
  for (const effect of effects) applyEffect(data, state, effect, emit);
}

/**
 * Replace {name} placeholders in a text with variable values.
 * @param {object} state story state
 * @param {string} text for example "You have {coins} coins."
 * @returns {string}
 */
export function fillText(state, text) {
  return text.replace(TEXT_VAR_PATTERN, (whole, name) => (Object.hasOwn(state.vars, name) ? String(state.vars[name]) : whole));
}
