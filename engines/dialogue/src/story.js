// createStory(data): the runtime. Walks dialogues, tracks variables and
// quests, reports events, and saves/loads as plain JSON.

import { validateStory, formatReport } from './validate.js';
import { createState, testCondition, applyEffects, isObjectiveDone, fillText } from './rules.js';

const MAX_BRANCH_HOPS = 100;
const SAVE_VERSION = 1;
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Create a story runtime from story data.
 * @param {object} data the story (parsed JSON). It is validated first.
 * @param {object} [options]
 * @param {boolean} [options.validate=true] set false to skip validation
 * @returns {object} the story object (see README "API reference")
 */
export function createStory(data, options = {}) {
  if (options.validate !== false) {
    const report = validateStory(data);
    if (!report.ok) throw new Error(`createStory: the story data is not valid.\n${formatReport({ ...report, warnings: [] })}`);
  }
  const listeners = new Map();
  let state = createState(data);

  function emit(type, payload) {
    for (const key of [type, '*']) {
      for (const fn of listeners.get(key) || []) fn({ type, ...payload });
    }
  }

  const nodeAt = () => data.dialogues[state.at.dialogue].nodes[state.at.node];

  function visibleChoices(node) {
    const base = `${state.at.dialogue}.${state.at.node}`;
    const list = [];
    node.choices.forEach((choice, i) => {
      if (choice.once === true && state.chosen[`${base}.${i}`]) return;
      if (testCondition(data, state, choice.if)) list.push({ choice, key: `${base}.${i}` });
    });
    return list;
  }

  function view() {
    if (!state.at) return { active: false, dialogue: null, node: null, speaker: null, text: '', choices: [], canContinue: false };
    const node = nodeAt();
    return {
      active: true,
      dialogue: state.at.dialogue,
      node: state.at.node,
      speaker: node.speaker === undefined ? null : node.speaker,
      text: fillText(state, node.text),
      choices: node.choices ? visibleChoices(node).map((entry) => ({ text: fillText(state, entry.choice.text) })) : [],
      canContinue: !node.choices,
    };
  }

  function enter(dialogueId, nodeId) {
    let target = nodeId;
    for (let hops = 0; hops < MAX_BRANCH_HOPS; hops++) {
      const node = data.dialogues[dialogueId].nodes[target];
      if (!node) throw new Error(`story: node "${target}" does not exist in dialogue "${dialogueId}"`);
      state.at = { dialogue: dialogueId, node: target };
      const key = `${dialogueId}.${target}`;
      state.visited[key] = (state.visited[key] || 0) + 1;
      if (node.do) applyEffects(data, state, node.do, emit);
      if (!node.branch) { emit('line', view()); return; }
      target = node.branch.find((entry) => testCondition(data, state, entry.if)).goto;
    }
    throw new Error(`story: more than ${MAX_BRANCH_HOPS} branch nodes in a row in dialogue "${dialogueId}"`);
  }

  function endDialogue() {
    const dialogue = state.at.dialogue;
    state.at = null;
    emit('dialogueEnded', { dialogue });
  }

  function needActive(caller) {
    if (!state.at) throw new Error(`${caller}: no dialogue is open. Call story.start(dialogueId) first.`);
  }

  const story = {
    /** Open a dialogue at its start node. Returns the first view. */
    start(dialogueId) {
      if (!Object.hasOwn(data.dialogues, dialogueId)) {
        throw new Error(`story.start: unknown dialogue "${dialogueId}". Known: ${Object.keys(data.dialogues).join(', ')}`);
      }
      enter(dialogueId, data.dialogues[dialogueId].start);
      return view();
    },
    /** What to show right now: { active, dialogue, node, speaker, text, choices, canContinue }. */
    view,
    /** Move past a line that has no choices. Returns the new view. */
    next() {
      needActive('story.next');
      const node = nodeAt();
      if (node.choices) throw new Error('story.next: this line has choices. Call story.choose(index) instead.');
      if (node.end === true) endDialogue(); else enter(state.at.dialogue, node.goto);
      return view();
    },
    /** Pick choice number `index` from view().choices (0 is the first). Returns the new view. */
    choose(index) {
      needActive('story.choose');
      const node = nodeAt();
      if (!node.choices) throw new Error('story.choose: this line has no choices. Call story.next() instead.');
      const visible = visibleChoices(node);
      if (!Number.isInteger(index) || index < 0 || index >= visible.length) {
        throw new Error(`story.choose: index ${JSON.stringify(index)} is out of range. There are ${visible.length} choices (0 to ${visible.length - 1}).`);
      }
      const { choice, key } = visible[index];
      const dialogue = state.at.dialogue;
      state.chosen[key] = true;
      emit('choice', { dialogue, node: state.at.node, index, text: fillText(state, choice.text) });
      if (choice.do) applyEffects(data, state, choice.do, emit);
      if (choice.end === true) endDialogue(); else enter(dialogue, choice.goto);
      return view();
    },
    /** Close the open dialogue early (for example when the player walks away). */
    close() { if (state.at) endDialogue(); },
    /** Read a variable. */
    getVar(name) {
      if (!Object.hasOwn(state.vars, name)) throw new Error(`story.getVar: unknown variable "${name}"`);
      return state.vars[name];
    },
    /** Set a variable from game code. The type must match its starting value. */
    setVar(name, value) { applyEffects(data, state, [{ set: name, to: value }], emit); },
    /** Apply one effect object or a list of them from game code. */
    apply(effects) { applyEffects(data, state, Array.isArray(effects) ? effects : [effects], emit); },
    /** Test a condition object from game code. Returns true or false. */
    check(condition) { return testCondition(data, state, condition); },
    /** Start a quest (does nothing if it already started). */
    startQuest(questId) { applyEffects(data, state, [{ startQuest: questId }], emit); },
    /** Add progress to "quest_id.objective_id". Ignored unless the quest is active. */
    progress(ref, by = 1) { applyEffects(data, state, [{ progress: ref, by }], emit); },
    /** One quest: { id, title, description, status, objectives: [{ id, text, count, target, done, optional }] }. */
    quest(questId) {
      const quest = (data.quests || {})[questId];
      if (!quest) throw new Error(`story.quest: unknown quest "${questId}"`);
      return {
        id: questId,
        title: quest.title,
        description: quest.description || '',
        status: state.quests[questId].status,
        objectives: quest.objectives.map((o) => ({
          id: o.id,
          text: fillText(state, o.text),
          count: state.quests[questId].objectives[o.id],
          target: o.count || 1,
          done: isObjectiveDone(data, state, `${questId}.${o.id}`),
          optional: o.optional === true,
        })),
      };
    },
    /** All quests, or only those with the given status ('inactive', 'active', 'done', 'failed'). */
    quests(status) {
      const all = Object.keys(data.quests || {}).map((id) => story.quest(id));
      return status === undefined ? all : all.filter((quest) => quest.status === status);
    },
    /** Listen for events. type is an event name or '*'. Returns a function that stops listening. */
    on(type, fn) {
      if (typeof fn !== 'function') throw new Error(`story.on: the listener for "${type}" must be a function`);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    /** Snapshot of all progress as a plain JSON-compatible object. */
    save() { return { version: SAVE_VERSION, storyId: data.id, ...clone(state) }; },
    /** Restore a snapshot made by save(). Unknown or missing entries fall back to defaults. */
    load(saved) {
      if (!saved || saved.version !== SAVE_VERSION || saved.storyId !== data.id) {
        throw new Error(`story.load: this is not a version ${SAVE_VERSION} save of story "${data.id}" (got ${JSON.stringify(saved && { version: saved.version, storyId: saved.storyId })})`);
      }
      const fresh = createState(data);
      for (const name of Object.keys(fresh.vars)) {
        if (saved.vars && typeof saved.vars[name] === typeof fresh.vars[name]) fresh.vars[name] = saved.vars[name];
      }
      for (const [id, quest] of Object.entries(fresh.quests)) {
        const old = saved.quests && saved.quests[id];
        if (!old) continue;
        if (['inactive', 'active', 'done', 'failed'].includes(old.status)) quest.status = old.status;
        for (const oid of Object.keys(quest.objectives)) {
          if (old.objectives && Number.isInteger(old.objectives[oid])) quest.objectives[oid] = old.objectives[oid];
        }
      }
      fresh.visited = clone(saved.visited || {});
      fresh.chosen = clone(saved.chosen || {});
      const at = saved.at;
      if (at && data.dialogues[at.dialogue] && data.dialogues[at.dialogue].nodes[at.node] && !data.dialogues[at.dialogue].nodes[at.node].branch) {
        fresh.at = { dialogue: at.dialogue, node: at.node };
      }
      state = fresh;
    },
    /** Write save() into a core-style store ({ get, set }). */
    saveTo(store, key = 'story') { store.set(key, story.save()); },
    /** Load from a core-style store. Returns false when nothing was saved there. */
    loadFrom(store, key = 'story') {
      const saved = store.get(key);
      if (saved === undefined || saved === null) return false;
      story.load(saved);
      return true;
    },
    /** Forget all progress and go back to the starting state. */
    reset() { state = createState(data); },
  };
  return story;
}
