// validateStory(data): checks a story before it is used. It never throws on
// bad story data; it returns a report listing every problem it found.

import {
  ID_PATTERN, STORY_KEYS, DIALOGUE_KEYS, LINE_NODE_KEYS, BRANCH_NODE_KEYS, BRANCH_ENTRY_KEYS,
  CHOICE_KEYS, QUEST_KEYS, OBJECTIVE_KEYS, LIMITS, isObject,
} from './spec.js';
import { createContext, checkKeys, checkCondition, checkEffects, checkText } from './validate-parts.js';
import { checkGraph } from './validate-graph.js';
import { didYouMean } from './suggest.js';

const isText = (value) => typeof value === 'string' && value.trim().length > 0;

function checkId(ctx, id, path, what) {
  if (!ID_PATTERN.test(id)) {
    ctx.error('bad-id', path, `${what} id "${id}" must be lower_snake_case: start with a letter, then letters, digits or "_".`);
  }
}

function checkVars(ctx, data) {
  if (data.vars === undefined) return;
  if (!isObject(data.vars)) { ctx.error('bad-vars', 'vars', '"vars" must be an object of name: starting value.'); return; }
  for (const [name, value] of Object.entries(data.vars)) {
    checkId(ctx, name, `vars.${name}`, 'Variable');
    if (!['boolean', 'number', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
      ctx.error('bad-vars', `vars.${name}`, `Variable "${name}" must start as true/false, a number or a string.`);
    }
  }
}

function checkEvents(ctx, data) {
  if (data.events === undefined) return;
  if (!Array.isArray(data.events)) { ctx.error('bad-events', 'events', '"events" must be a list of event names.'); return; }
  data.events.forEach((name, i) => {
    if (typeof name !== 'string') ctx.error('bad-events', `events[${i}]`, 'Event names must be strings.');
    else checkId(ctx, name, `events[${i}]`, 'Event');
  });
}

function checkQuest(ctx, id, quest) {
  const path = `quests.${id}`;
  checkId(ctx, id, path, 'Quest');
  if (!isObject(quest)) { ctx.error('bad-quest', path, 'A quest must be an object with "title" and "objectives".'); return; }
  checkKeys(ctx, quest, QUEST_KEYS, path);
  if (!isText(quest.title)) ctx.error('missing-text', `${path}.title`, `Quest "${id}" needs a non-empty "title".`);
  if (quest.description !== undefined && typeof quest.description !== 'string') {
    ctx.error('bad-quest', `${path}.description`, '"description" must be a string.');
  }
  if (!Array.isArray(quest.objectives) || quest.objectives.length === 0) {
    ctx.error('bad-quest', `${path}.objectives`, `Quest "${id}" needs a non-empty "objectives" list.`);
    return;
  }
  const seen = new Set();
  let required = 0;
  quest.objectives.forEach((objective, i) => {
    const opath = `${path}.objectives[${i}]`;
    if (!isObject(objective)) { ctx.error('bad-quest', opath, 'An objective must be an object with "id" and "text".'); return; }
    checkKeys(ctx, objective, OBJECTIVE_KEYS, opath);
    if (typeof objective.id !== 'string') ctx.error('bad-id', opath, 'An objective needs a string "id".');
    else {
      checkId(ctx, objective.id, opath, 'Objective');
      if (seen.has(objective.id)) ctx.error('duplicate-id', opath, `Objective id "${objective.id}" is used twice in quest "${id}".`);
      seen.add(objective.id);
    }
    if (!isText(objective.text)) ctx.error('missing-text', `${opath}.text`, 'An objective needs a non-empty "text".');
    if (objective.count !== undefined && !(Number.isInteger(objective.count) && objective.count >= 1)) {
      ctx.error('bad-quest', `${opath}.count`, '"count" must be a whole number of 1 or more.');
    }
    if (objective.optional !== undefined && typeof objective.optional !== 'boolean') {
      ctx.error('bad-quest', `${opath}.optional`, '"optional" must be true or false.');
    }
    if (objective.optional !== true) required += 1;
  });
  if (required === 0) ctx.error('bad-quest', `${path}.objectives`, `Quest "${id}" needs at least one objective that is not optional, or it can never finish.`);
  if (quest.rewards !== undefined) checkEffects(ctx, quest.rewards, `${path}.rewards`);
}

function checkGoto(ctx, target, nodes, path) {
  if (typeof target !== 'string' || !Object.hasOwn(nodes, target)) {
    ctx.error('missing-node', path,
      `"goto" points to node "${target}", which does not exist in this dialogue.${didYouMean(target, Object.keys(nodes))}`);
  }
}

function checkBranchNode(ctx, node, nodes, path) {
  checkKeys(ctx, node, BRANCH_NODE_KEYS, path);
  if (!Array.isArray(node.branch) || node.branch.length === 0) {
    ctx.error('bad-branch', `${path}.branch`, '"branch" must be a non-empty list of { "if": ..., "goto": ... } entries.');
    return;
  }
  node.branch.forEach((entry, i) => {
    const epath = `${path}.branch[${i}]`;
    if (!isObject(entry)) { ctx.error('bad-branch', epath, 'A branch entry must be an object with "goto".'); return; }
    checkKeys(ctx, entry, BRANCH_ENTRY_KEYS, epath);
    checkGoto(ctx, entry.goto, nodes, `${epath}.goto`);
    const last = i === node.branch.length - 1;
    if (last && entry.if !== undefined) {
      ctx.error('dead-end', epath, 'The last branch entry must have no "if", so there is always somewhere to go.');
    } else if (!last && entry.if === undefined) {
      ctx.error('bad-branch', epath, 'Only the last branch entry may leave out "if"; entries after this one could never be used.');
    }
    if (entry.if !== undefined) checkCondition(ctx, entry.if, `${epath}.if`);
  });
}

function checkChoice(ctx, choice, nodes, path) {
  if (!isObject(choice)) { ctx.error('bad-choice', path, 'A choice must be an object with "text" and "goto" (or "end": true).'); return false; }
  checkKeys(ctx, choice, CHOICE_KEYS, path);
  if (!isText(choice.text)) ctx.error('missing-text', `${path}.text`, 'A choice needs a non-empty "text".');
  else {
    checkText(ctx, choice.text, `${path}.text`);
    if (choice.text.length > LIMITS.choiceTextLength) ctx.warn('long-text', `${path}.text`, `Choice text is ${choice.text.length} characters; keep it under ${LIMITS.choiceTextLength}.`);
  }
  if (choice.end !== undefined && choice.end !== true) ctx.error('bad-choice', `${path}.end`, '"end" can only be true. Remove it to keep the conversation going.');
  const ways = (choice.goto !== undefined ? 1 : 0) + (choice.end === true ? 1 : 0);
  if (ways !== 1) ctx.error('dead-end', path, 'A choice needs exactly one of "goto" (next node) or "end": true.');
  if (choice.goto !== undefined) checkGoto(ctx, choice.goto, nodes, `${path}.goto`);
  if (choice.once !== undefined && typeof choice.once !== 'boolean') ctx.error('bad-choice', `${path}.once`, '"once" must be true or false.');
  if (choice.if !== undefined) checkCondition(ctx, choice.if, `${path}.if`);
  if (choice.do !== undefined) checkEffects(ctx, choice.do, `${path}.do`);
  return choice.if === undefined && choice.once !== true;
}

function checkLineNode(ctx, id, node, nodes, path) {
  checkKeys(ctx, node, LINE_NODE_KEYS, path);
  if (!isText(node.text)) ctx.error('missing-text', `${path}.text`, `Node "${id}" needs a non-empty "text" (or a "branch" list).`);
  else {
    checkText(ctx, node.text, `${path}.text`);
    if (node.text.length > LIMITS.textLength) ctx.warn('long-text', `${path}.text`, `Text is ${node.text.length} characters; split lines longer than ${LIMITS.textLength} into two nodes.`);
  }
  if (node.speaker !== undefined && !isText(node.speaker)) ctx.error('missing-text', `${path}.speaker`, '"speaker" must be a non-empty string when present.');
  if (node.end !== undefined && node.end !== true) ctx.error('bad-node', `${path}.end`, '"end" can only be true.');
  const ways = ['choices', 'goto'].filter((key) => node[key] !== undefined).length + (node.end === true ? 1 : 0);
  if (ways === 0) ctx.error('dead-end', path, `Node "${id}" is a dead end. Give it "choices", a "goto", or "end": true.`);
  if (ways > 1) ctx.error('bad-node', path, `Node "${id}" must have only one of "choices", "goto" or "end": true.`);
  if (node.goto !== undefined) checkGoto(ctx, node.goto, nodes, `${path}.goto`);
  if (node.choices === undefined) return;
  if (!Array.isArray(node.choices) || node.choices.length === 0) {
    ctx.error('bad-choice', `${path}.choices`, '"choices" must be a non-empty list.');
    return;
  }
  if (node.choices.length > LIMITS.choicesPerNode) ctx.warn('many-choices', `${path}.choices`, `${node.choices.length} choices on one node; ${LIMITS.choicesPerNode} or fewer reads better.`);
  const alwaysShown = node.choices.map((choice, i) => checkChoice(ctx, choice, nodes, `${path}.choices[${i}]`));
  if (!alwaysShown.includes(true)) {
    ctx.error('dead-end', `${path}.choices`,
      `Every choice on node "${id}" has "if" or "once", so the player could be left with nothing to pick. Add one plain choice such as "Goodbye".`);
  }
}

function checkDialogue(ctx, id, dialogue) {
  const path = `dialogues.${id}`;
  checkId(ctx, id, path, 'Dialogue');
  if (!isObject(dialogue)) { ctx.error('bad-dialogue', path, 'A dialogue must be an object with "start" and "nodes".'); return 0; }
  checkKeys(ctx, dialogue, DIALOGUE_KEYS, path);
  if (!isObject(dialogue.nodes) || Object.keys(dialogue.nodes).length === 0) {
    ctx.error('bad-dialogue', `${path}.nodes`, `Dialogue "${id}" needs a non-empty "nodes" object.`);
    return 0;
  }
  const nodes = dialogue.nodes;
  if (typeof dialogue.start !== 'string' || !Object.hasOwn(nodes, dialogue.start)) {
    ctx.error('missing-node', `${path}.start`,
      `"start" is "${dialogue.start}", which is not a node in this dialogue.${didYouMean(String(dialogue.start), Object.keys(nodes))}`);
  }
  for (const [nodeId, node] of Object.entries(nodes)) {
    const npath = `${path}.nodes.${nodeId}`;
    checkId(ctx, nodeId, npath, 'Node');
    if (!isObject(node)) { ctx.error('bad-node', npath, 'A node must be an object.'); continue; }
    if (node.do !== undefined) checkEffects(ctx, node.do, `${npath}.do`);
    if (node.branch !== undefined) checkBranchNode(ctx, node, nodes, npath);
    else checkLineNode(ctx, nodeId, node, nodes, npath);
  }
  checkGraph(ctx, id, dialogue);
  return Object.keys(nodes).length;
}

function checkUnused(ctx, data) {
  for (const name of Object.keys(isObject(data.vars) ? data.vars : {})) {
    if (!ctx.used.vars.has(name)) ctx.warn('unused-var', `vars.${name}`, `Variable "${name}" is never used by the story. Fine if only game code uses it.`);
  }
  for (const name of Array.isArray(data.events) ? data.events : []) {
    if (!ctx.used.emitted.has(name)) ctx.warn('unused-event', 'events', `Event "${name}" is never emitted by the story.`);
  }
  for (const [id, quest] of Object.entries(isObject(data.quests) ? data.quests : {})) {
    if (!ctx.used.started.has(id)) ctx.warn('quest-never-started', `quests.${id}`, `No dialogue starts quest "${id}". Fine if game code calls story.startQuest("${id}").`);
    for (const objective of Array.isArray(quest?.objectives) ? quest.objectives : []) {
      const ref = `${id}.${objective?.id}`;
      if (isObject(objective) && !ctx.used.progressed.has(ref)) {
        ctx.warn('objective-never-progressed', `quests.${id}`, `No dialogue progresses objective "${ref}". Fine if game code calls story.progress("${ref}").`);
      }
    }
  }
}

/**
 * Check a story data object for mistakes. Never throws on bad story data.
 * @param {object} data the story (parsed JSON)
 * @returns {{ok: boolean, errors: object[], warnings: object[], stats: object}}
 *   errors and warnings are lists of { code, path, message }. ok is true when
 *   there are no errors (warnings are allowed).
 */
export function validateStory(data) {
  const ctx = createContext(isObject(data) ? data : {});
  const stats = { dialogues: 0, nodes: 0, quests: 0 };
  if (!isObject(data)) {
    ctx.error('bad-story', '', 'A story must be an object with "id" and "dialogues".');
    return { ok: false, errors: ctx.errors, warnings: ctx.warnings, stats };
  }
  checkKeys(ctx, data, STORY_KEYS, 'story');
  if (typeof data.id !== 'string') ctx.error('bad-id', 'id', 'A story needs a string "id".');
  else checkId(ctx, data.id, 'id', 'Story');
  if (data.title !== undefined && typeof data.title !== 'string') ctx.error('bad-story', 'title', '"title" must be a string.');
  checkVars(ctx, data);
  checkEvents(ctx, data);
  if (data.quests !== undefined && !isObject(data.quests)) ctx.error('bad-quest', 'quests', '"quests" must be an object of quest_id: quest.');
  for (const [id, quest] of Object.entries(isObject(data.quests) ? data.quests : {})) {
    checkQuest(ctx, id, quest);
    stats.quests += 1;
  }
  if (!isObject(data.dialogues) || Object.keys(data.dialogues).length === 0) {
    ctx.error('bad-dialogue', 'dialogues', 'A story needs a non-empty "dialogues" object.');
  } else {
    for (const [id, dialogue] of Object.entries(data.dialogues)) {
      stats.nodes += checkDialogue(ctx, id, dialogue);
      stats.dialogues += 1;
    }
  }
  checkUnused(ctx, data);
  return { ok: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings, stats };
}

/**
 * Turn a validateStory() report into text for a terminal or an error message.
 * @param {object} report the object returned by validateStory()
 * @returns {string} one line per problem, then a summary line
 */
export function formatReport(report) {
  const lines = [];
  for (const e of report.errors) lines.push(`ERROR   [${e.code}] ${e.path}: ${e.message}`);
  for (const w of report.warnings) lines.push(`warning [${w.code}] ${w.path}: ${w.message}`);
  const s = report.stats;
  lines.push(`${report.ok ? 'OK' : 'INVALID'}: ${report.errors.length} error(s), ${report.warnings.length} warning(s), `
    + `${s.dialogues} dialogue(s), ${s.nodes} node(s), ${s.quests} quest(s).`);
  return lines.join('\n');
}
