// The demo's rules with nothing to draw: the quest (who to talk to, what to gather, when the
// cellar opens) and the cellar rooms. The game keeps its progress in one of these states, the
// auto-play bot thinks ahead on copies of it, and playbot plays it thousands of times under Node
// (playtest/bot-adapter.js). Pure: no clock, no page, no randomness.
import { createStory } from '../vendor/dialogue/index.js';
import { STORY } from './story.js';
import { cellarPuzzle, cellarRooms, CELLAR_ROOMS } from './cellar-rules.js';

/** How many moonleaf patches there are. */
export const HERBS = 3;
/** Who can be talked to: dialogue ids of the story. */
export const PEOPLE = ['guard', 'elder', 'tobin'];

/**
 * A fresh quest state. `story` is a live story from the dialogue engine; the rest is plain data.
 * @param {object} [saved]  What snapshot() returned, to continue from.
 */
export function createQuest(saved) {
  const story = createStory(STORY, { validate: !saved });
  const q = { kind: 'quest', story, herbs: new Array(HERBS).fill(false), room: 0 };
  if (saved) {
    if (saved.story) story.load(saved.story);
    if (Array.isArray(saved.herbs)) q.herbs = q.herbs.map((_, i) => saved.herbs[i] === true);
    if (Number.isInteger(saved.room)) q.room = Math.max(0, Math.min(CELLAR_ROOMS, saved.room));
  }
  return q;
}

/** Put a quest state back to the start, or to a snapshot. The story object stays the same, so listeners keep working. */
export function resetQuest(q, saved = null) {
  q.story.reset();
  if (saved && saved.story) q.story.load(saved.story);
  q.herbs = q.herbs.map((_, i) => Boolean(saved && Array.isArray(saved.herbs) && saved.herbs[i] === true));
  q.room = saved && Number.isInteger(saved.room) ? Math.max(0, Math.min(CELLAR_ROOMS, saved.room)) : 0;
  return q;
}

/** Plain JSON data of a quest state, for save slots and for copying. */
export function snapshot(q) {
  return { story: q.story.save(), herbs: q.herbs.slice(), room: q.room };
}

/** What the player may do now, as short strings: next, choose:N, talk:<who>, herb:N, cellar, throw. */
export function questActions(q) {
  const view = q.story.view();
  if (view.active) return view.canContinue ? ['next'] : view.choices.map((_, i) => 'choose:' + i);
  const out = PEOPLE.map((who) => 'talk:' + who);
  if (canGather(q)) q.herbs.forEach((taken, i) => { if (!taken) out.push('herb:' + i); });
  if (canEnterCellar(q)) out.push('cellar');
  if (q.story.check({ quest: 'practice', is: 'active' }) && q.story.getVar('stones') > 0) out.push('throw');
  return out;
}

/** Moonleaf only shows once the guard has asked for it, so none can be picked too early and lost. */
export function canGather(q) {
  return q.story.check({ quest: 'supplies', is: 'active' }) && !q.story.check({ objectiveDone: 'supplies.herbs' });
}

/** The hatch opens when the elder unlocks it, and stays shut again once the crates are sorted. */
export function canEnterCellar(q) {
  return q.story.getVar('cellar_open') && q.room < CELLAR_ROOMS;
}

/** Pick moonleaf patch i. Returns true when it was there to pick. */
export function gatherHerb(q, i) {
  if (!canGather(q) || q.herbs[i] !== false) return false;
  q.herbs[i] = true;
  q.story.progress('supplies.herbs');
  return true;
}

/** One cellar room was solved. The objective is done after the last room. */
export function finishRoom(q) {
  if (q.room >= CELLAR_ROOMS) return;
  q.room += 1;
  if (q.room === CELLAR_ROOMS) q.story.progress('supplies.cellar');
}

/** A stone left the hand. Returns false when there was none to throw. */
export function useStone(q) {
  const n = q.story.getVar('stones');
  if (n <= 0) return false;
  q.story.setVar('stones', n - 1);
  return true;
}

/** A thrown stone hit the practice barrel. */
export function stoneHit(q) { q.story.progress('practice.hits'); }

/** Apply one action from questActions. In this model the whole cellar is one action and every throw hits. */
export function questStep(q, action) {
  const [verb, arg] = String(action).split(':');
  if (verb === 'next') q.story.next();
  else if (verb === 'choose') q.story.choose(Number(arg));
  else if (verb === 'talk') q.story.start(arg);
  else if (verb === 'herb') gatherHerb(q, Number(arg));
  else if (verb === 'cellar') { while (q.room < CELLAR_ROOMS) finishRoom(q); } else if (verb === 'throw') { if (useStone(q)) stoneHit(q); } else throw new Error(`questStep: unknown action ${JSON.stringify(action)}`);
  return q;
}

/** 0..1: how much of the main quest is done. */
export function questProgress(q) {
  const quest = q.story.quest('supplies');
  if (quest.status === 'done') return 1;
  if (quest.status !== 'active') return 0;
  let done = 0.1; // the quest was taken
  for (const o of quest.objectives) done += 0.9 * (Math.min(o.count, o.target) / o.target) / quest.objectives.length;
  return done + (q.room / CELLAR_ROOMS) * 0.01;
}

/** True when the main quest is finished. */
export const questWon = (q) => q.story.check({ quest: 'supplies', is: 'done' });

/** The playbot adapter over both kinds of level: the quest, then each cellar room move by move. */
export function createAdapter() {
  let rooms = null;
  const room = (i) => (rooms ??= cellarRooms())[i];
  const puzzles = new Map();
  const puzzle = (i) => { if (!puzzles.has(i)) puzzles.set(i, cellarPuzzle(room(i).rows)); return puzzles.get(i); };
  return {
    name: 'Kiln scene demo',
    deterministic: true,
    maxSteps: 300,
    levels: () => [{ id: 'quest', name: 'The hamlet quest' }, ...Array.from({ length: CELLAR_ROOMS }, (_, i) => ({ id: 'cellar-' + i, name: `Cellar room ${i + 1}` }))],
    create({ level }) {
      if (level === 'quest') return createQuest();
      const i = Number(String(level).split('-')[1]);
      return { kind: 'cellar', i, ...puzzle(i).start };
    },
    actions: (s) => (s.kind === 'quest' ? questActions(s) : puzzle(s.i).actions.filter((a) => puzzle(s.i).step(s, a) !== null)),
    step(s, action) {
      if (s.kind === 'quest') return questStep(s, action);
      const next = puzzle(s.i).step(s, action);
      return next ? { kind: 'cellar', i: s.i, x: next.x, y: next.y, crates: next.crates } : s;
    },
    status: (s) => ((s.kind === 'quest' ? questWon(s) : puzzle(s.i).isWon(s)) ? 'won' : 'playing'),
    progress: (s) => (s.kind === 'quest' ? questProgress(s) : puzzle(s.i).progress(s)),
    clone: (s) => (s.kind === 'quest' ? createQuest(snapshot(s)) : { ...s, crates: s.crates.map((c) => c.slice()) }),
    key(s) {
      if (s.kind !== 'quest') return puzzle(s.i).key(s);
      const save = s.story.save();
      return JSON.stringify([save.vars, save.quests, save.at, save.chosen, s.herbs, s.room]);
    },
  };
}
