// Simple quests: kill some creatures, fetch some things, deliver something to somebody. Each
// quest comes with a ready piece of story for the dialogue engine (the quest itself and what the
// giver says before, during and after), the game events that move it on, and its rewards.
import { createRng } from './rng.js';
import { PEOPLE_NAMES, FETCH_ITEMS, PARCELS, HUNT_KINDS, PLURALS, QUEST_LINES } from './names.js';

const need = (ok, message) => { if (!ok) throw new Error(message); };
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
const hex = (n) => (n >>> 0).toString(16).padStart(8, '0').slice(0, 4);
export const QUEST_TYPES = ['kill', 'fetch', 'deliver'];

/**
 * generateQuest(options) -> quest
 *   seed      required
 *   type      'kill', 'fetch' or 'deliver'. Default: picked from the seed.
 *   level     1..10: how much to do and how much it pays. Default 1.
 *   giver     { id, name } of who asks. Default: a name from the seed.
 *   to        deliver only: { id, name } of who receives. Default: a name from the seed.
 *   place     { name, x?, y? } where it happens. Default: taken from camp / dungeon, or a general hint.
 *   camp      kill: hunt the band of this camp (from generateCamp or campAt)
 *   dungeon   fetch: the thing lies in this dungeon's deepest chest (quest.plant says which)
 *   kind, item, count   override what to kill / fetch / carry: kind 'wolf', item { id, name, plural }, count 3
 *   rewardItems   item ids that may be added to the pay. Default ['potion'].
 *   coinsVar  name of the story's money variable. Default 'coins'.
 * quest: { id, type, seed, level, title, description, giver: { id, name, dialogue },
 *   to: null | { id, name, dialogue }, target, place, plant,
 *   objectives: [{ id, text, count }], rewards: { coins, xp, items: [{ id, n }] },
 *   hooks: [{ on: 'kill' | 'pickup', kind? | item?, progress: 'quest.objective' }],
 *   events: { reward, take?, give? },     names the story emits: pay out / remove the things / hand over the parcel
 *   story: { vars, events, quests, dialogues } }   a piece for the dialogue engine: see mergeStory
 */
export function generateQuest(options = {}) {
  need(options.seed !== undefined && options.seed !== null, 'generateQuest: options.seed is required');
  const rng = createRng(options.seed, 'quest');
  const type = options.type ?? (options.camp ? 'kill' : options.dungeon ? 'fetch' : rng.pick(QUEST_TYPES));
  need(QUEST_TYPES.includes(type), `generateQuest: type must be one of ${QUEST_TYPES.join(', ')}, got ${JSON.stringify(type)}`);
  const level = options.level ?? options.camp?.level ?? options.dungeon?.level ?? 1;
  need(Number.isFinite(level) && level >= 1 && level <= 10, `generateQuest: level must be 1..10, got ${level}`);
  const names = rng.shuffle(options.names ?? PEOPLE_NAMES);
  const person = (given, fallback) => ({ id: slug(given?.id ?? given?.name ?? fallback), name: given?.name ?? given?.id ?? fallback });
  const giver = person(options.giver, names[0]);
  const coinsVar = options.coinsVar ?? 'coins';
  const pay = { kill: 1.2, fetch: 1, deliver: 0.8 }[type];
  const coins = Math.round((8 + level * 7) * pay * rng.range(0.85, 1.2));
  const rewards = { coins, xp: Math.round(level * 15 * pay), items: [] };
  const rewardItems = options.rewardItems ?? ['potion'];
  if (rewardItems.length && rng.chance(0.25 + level * 0.05)) rewards.items.push({ id: rng.pick(rewardItems), n: 1 });

  let target; let place = options.place ?? null; let plant = null; let to = null; let words;
  if (type === 'kill') {
    let kind = options.kind; let most = 0;
    if (!kind && options.camp) { // the commonest kind of the band
      const tally = {};
      for (const s of options.camp.spawns) { tally[s.kind] = (tally[s.kind] ?? 0) + 1; if (tally[s.kind] > most) { most = tally[s.kind]; kind = s.kind; } }
    }
    const hunt = HUNT_KINDS.find((h) => h[0] === kind) ?? (kind ? [kind, kind, PLURALS[kind] ?? `${kind}s`] : rng.pick(HUNT_KINDS));
    const count = options.count ?? (most || Math.min(8, 2 + Math.round(level * 0.6) + rng.int(0, 2)));
    target = { kind: hunt[0], count };
    if (!place) place = options.camp ? { name: options.camp.name, ...(options.camp.at ?? {}) } : { name: rng.pick(['the old road', 'the north wood', 'the mill pond', 'the high pasture', 'the river ford']) };
    words = { things: hunt[2], thing: hunt[1], n: count };
  } else if (type === 'fetch') {
    const picked = options.item ? [options.item.id, options.item.name ?? options.item.id, options.item.plural ?? `${options.item.name ?? options.item.id}s`, 'nearby'] : rng.pick(FETCH_ITEMS);
    const chest = options.dungeon ? options.dungeon.loot.filter((l) => !l.item).sort((a, b) => depthOf(options.dungeon, b) - depthOf(options.dungeon, a))[0] : null;
    const count = options.count ?? (chest ? 1 : Math.min(8, 2 + Math.round(level * 0.5) + rng.int(0, 2)));
    target = { item: slug(picked[0]), name: picked[1], count };
    if (chest) plant = { dungeon: options.dungeon.id, loot: chest.id, item: target.item, n: count };
    if (!place) place = options.dungeon ? { name: `in the ${options.dungeon.theme} below` } : { name: picked[3] };
    words = { things: count === 1 ? picked[1] : picked[2], thing: picked[1], n: count };
  } else {
    to = person(options.to, names[1] === giver.name ? names[2] : names[1]);
    const picked = options.item ? [options.item.id, options.item.name ?? options.item.id] : rng.pick(PARCELS);
    target = { item: slug(picked[0]), name: picked[1], count: 1, to: to.id };
    if (!place) place = { name: rng.pick(['the mill', 'the inn', 'the well', 'the chapel', 'the market cross', 'the smithy']) };
    words = { item: picked[1], to: to.name, n: 1 };
  }
  const id = options.id ?? `q_${type}_${slug(target.kind ?? target.item)}_${hex(rng.seed)}`;
  need(/^[a-z][a-z0-9_]*$/.test(id), `generateQuest: id must be lower_snake_case, got ${JSON.stringify(id)}`);
  const lines = QUEST_LINES[type];
  const fill = (text) => text.replace(/\$(\w+)/g, (all, w) => ({ ...words, place: place.name, giver: giver.name, coins }[w] ?? all));
  const say = (list) => fill(rng.pick(list));
  const title = say(lines.title).replace(/^./, (c) => c.toUpperCase());
  giver.dialogue = `${id}_giver`;
  const quest = { id, type, seed: rng.seed, level, title, description: '', giver, to, target, place, plant, objectives: [], rewards, hooks: [], events: { reward: `${id}_reward` } };

  const main = type === 'kill' ? 'kill' : type === 'fetch' ? 'collect' : 'deliver';
  const one = type === 'fetch' && target.count === 1;
  const offer = say(one ? lines.offerOne : lines.offer);
  quest.description = offer;
  const goals = [];
  if (type === 'kill') { goals.push({ id: 'kill', text: fill('Kill $n $things at $place'), count: target.count }, { id: 'report', text: `Tell ${giver.name}` }); quest.hooks.push({ on: 'kill', kind: target.kind, progress: `${id}.kill` }); }
  if (type === 'fetch') { goals.push({ id: 'collect', text: fill(target.count === 1 ? 'Find the $thing' : 'Collect $n $things'), count: target.count }, { id: 'report', text: `Bring ${target.count === 1 ? 'it' : 'them'} to ${giver.name}` }); quest.hooks.push({ on: 'pickup', item: target.item, progress: `${id}.collect` }); quest.events.take = `${id}_take`; }
  if (type === 'deliver') { goals.push({ id: 'deliver', text: fill('Take the $item to $to') }); quest.events.give = `${id}_give`; quest.events.take = `${id}_take`; }
  quest.objectives = goals.map((g) => ({ count: 1, ...g }));

  const reward = [{ add: coinsVar, by: coins }, { emit: quest.events.reward }];
  const speaker = giver.name;
  const nodes = {
    start: { branch: [{ if: { quest: id, is: 'done' }, goto: 'thanks' }, ...(type === 'deliver' ? [] : [{ if: { all: [{ quest: id, is: 'active' }, { objectiveDone: `${id}.${main}` }] }, goto: 'turn_in' }]), { if: { quest: id, is: 'active' }, goto: 'waiting' }, { goto: 'offer' }] },
    offer: { speaker, text: offer, choices: [{ text: rng.pick(['I will do it.', 'Leave it to me.', 'Consider it done.']), goto: 'accepted', do: [{ startQuest: id }, ...(quest.events.give ? [{ emit: quest.events.give }] : [])] }, { text: rng.pick(['Not now.', 'Another time.', 'I cannot, sorry.']), end: true }] },
    accepted: { speaker, text: rng.pick(QUEST_LINES.accepted), end: true },
    waiting: { speaker, text: say(one ? lines.waitingOne : lines.waiting), end: true },
    thanks: { speaker, text: type === 'deliver' ? say(lines.done) : rng.pick(QUEST_LINES.thanks), end: true },
  };
  if (type !== 'deliver') nodes.turn_in = { speaker, text: say(lines.done), do: [...(quest.events.take ? [{ emit: quest.events.take }] : []), { progress: `${id}.report` }], end: true };
  const dialogues = { [giver.dialogue]: { start: 'start', nodes } };
  if (to) {
    to.dialogue = `${id}_to`;
    dialogues[to.dialogue] = { start: 'start', nodes: {
      start: { branch: [{ if: { quest: id, is: 'active' }, goto: 'hand_over' }, { if: { quest: id, is: 'done' }, goto: 'after' }, { goto: 'stranger' }] },
      hand_over: { speaker: to.name, text: say(lines.handOver), do: [{ emit: quest.events.take }, { progress: `${id}.deliver` }], end: true },
      after: { speaker: to.name, text: say(lines.after), end: true },
      stranger: { speaker: to.name, text: say(lines.stranger), end: true },
    } };
  }
  quest.story = {
    vars: { [coinsVar]: 0 }, events: Object.values(quest.events),
    quests: { [id]: { title, description: offer, objectives: quest.objectives.map((o) => (o.count > 1 ? { id: o.id, text: o.text, count: o.count } : { id: o.id, text: o.text })), rewards: reward } },
    dialogues,
  };
  return quest;
}

const depthOf = (dungeon, loot) => dungeon.rooms.find((r) => r.id === loot.room)?.depth ?? 0;

/**
 * generateQuests(options) -> [quest, ...] with different ids
 *   seed, count (default 3), level, types (default all three)
 *   givers    [{ id, name }] handed out in turn; camps, dungeons: used by kill and fetch quests in turn
 */
export function generateQuests(options = {}) {
  need(options.seed !== undefined && options.seed !== null, 'generateQuests: options.seed is required');
  const count = options.count ?? 3;
  need(Number.isInteger(count) && count >= 0 && count <= 200, `generateQuests: count must be a whole number 0..200, got ${count}`);
  const rng = createRng(options.seed, 'quests');
  const types = options.types ?? QUEST_TYPES;
  const camps = (options.camps ?? []).filter((c) => c.hostile && c.spawns.length); const dungeons = options.dungeons ?? [];
  const out = []; const used = new Set(); let campN = 0; let dungeonN = 0;
  for (let i = 0; out.length < count && i < count * 8; i++) {
    const type = types[(i + rng.int(0, types.length - 1)) % types.length];
    const quest = generateQuest({
      seed: `${rng.seed}/${i}`, type, level: options.level, names: options.names, rewardItems: options.rewardItems, coinsVar: options.coinsVar,
      giver: options.givers?.length ? options.givers[out.length % options.givers.length] : undefined,
      camp: type === 'kill' && camps.length ? camps[campN++ % camps.length] : undefined,
      dungeon: type === 'fetch' && dungeons.length ? dungeons[dungeonN++ % dungeons.length] : undefined,
    });
    if (used.has(quest.id)) continue;
    used.add(quest.id); out.push(quest);
  }
  return out;
}

/**
 * mergeStory(base, ...parts) -> a new story object for the dialogue engine's createStory.
 * parts are quests (their .story is used) or story pieces { vars, events, quests, dialogues }.
 * Variables already in the base keep their value. Throws when a quest or dialogue id is used twice.
 */
export function mergeStory(base, ...parts) {
  need(base && typeof base === 'object', 'mergeStory: the first argument must be a story object (at least { id })');
  const out = { ...base, vars: { ...(base.vars ?? {}) }, events: [...(base.events ?? [])], quests: { ...(base.quests ?? {}) }, dialogues: { ...(base.dialogues ?? {}) } };
  for (const part of parts.flat()) {
    const piece = part?.story ?? part;
    need(piece && typeof piece === 'object', `mergeStory: every part must be a quest or a story piece, got ${JSON.stringify(part)}`);
    for (const [name, value] of Object.entries(piece.vars ?? {})) if (!(name in out.vars)) out.vars[name] = value;
    for (const name of piece.events ?? []) if (!out.events.includes(name)) out.events.push(name);
    for (const key of ['quests', 'dialogues']) for (const [id, value] of Object.entries(piece[key] ?? {})) {
      need(!(id in out[key]), `mergeStory: ${key} id '${id}' is used twice`);
      out[key][id] = value;
    }
  }
  return out;
}

/**
 * createQuestTracker(quests) -> tracker   links game events to quest progress.
 *   tracker.match({ type: 'kill', kind }) / ({ type: 'pickup', item, n })  -> effects for story.apply(...)
 *   tracker.payout(eventName) -> { quest, kind: 'reward' | 'take' | 'give', rewards, target } or null,
 *                                for a name the story emitted (story.on('event', e => tracker.payout(e.name)))
 *   tracker.add(quest), tracker.quests()
 */
export function createQuestTracker(quests = []) {
  const list = [];
  const tracker = {
    add(quest) { need(quest?.id && Array.isArray(quest.hooks), 'questTracker.add: need a quest from generateQuest'); list.push(quest); return tracker; },
    quests: () => list.slice(),
    match(event) {
      need(event && typeof event.type === 'string', `questTracker.match: event must be { type, ... }, got ${JSON.stringify(event)}`);
      const out = [];
      for (const quest of list) for (const hook of quest.hooks) {
        if (hook.on !== event.type) continue;
        if ((hook.kind !== undefined && hook.kind !== event.kind) || (hook.item !== undefined && hook.item !== event.item)) continue;
        out.push({ progress: hook.progress, by: event.n ?? 1 });
      }
      return out;
    },
    payout(name) {
      for (const quest of list) for (const [kind, eventName] of Object.entries(quest.events)) if (eventName === name) return { quest, kind, rewards: quest.rewards, target: quest.target };
      return null;
    },
  };
  for (const quest of quests) tracker.add(quest);
  return tracker;
}
