// Barks: the short lines and noises agents come out with ("Who goes there?", "*growls*"). The engine
// only decides WHEN and WHICH line; showing it (a ui toast, a speech bubble, a sound) is the game's job,
// through the 'bark' event.
import { need, sortedKeys } from './util.js';
import { roll } from './rng.js';

/**
 * BARKS -> the built-in lines: { voice: { kind: [lines] } }. An agent's voice is agent.voice (set by its
 * archetype). Kinds the engine uses: aggro, lost, flee, hurt, allyDown, alert, call, taunt, idle, greet,
 * chat, work, eat, sleep, drink, trade, patrol. {name} is replaced by the name of whoever the line is about.
 */
export const BARKS = {
  beast: { aggro: ['*growls*', '*snarls*'], lost: ['*sniffs the air*'], flee: ['*yelps*', '*whimpers*'], hurt: ['*yelp*'], allyDown: ['*howls*'], alert: ['*ears prick up*'], call: ['*howls*'], idle: ['*pants*', '*scratches*'] },
  boar: { aggro: ['*snorts*', '*squeals*'], lost: ['*grunts*'], flee: ['*squeals*'], hurt: ['*squeal*'], alert: ['*huffs*'], idle: ['*roots in the dirt*'], taunt: ['*paws the ground*'] },
  slime: { aggro: ['*blorp*'], lost: ['*gurgle*'], hurt: ['*splat*'], idle: ['*bubbles*'], alert: ['*quivers*'] },
  flyer: { aggro: ['*screech*'], flee: ['*flutter*'], hurt: ['*squeak*'], idle: ['*chitters*'] },
  goblin: { aggro: ['Get it!', 'Fresh meat!', 'Stab it!'], lost: ['Where did it go?', 'Come out!'], flee: ['Run away!', 'Not worth it!'], hurt: ['Ow!', 'That hurt!'], allyDown: ['They got {name}!', 'Too strong!'], alert: ['What was that?', 'You hear that?'], call: ['Over here!', 'Help!'], taunt: ['Stand still!', 'Hold it down!'], idle: ['Hungry...', 'Bored.'] },
  brute: { aggro: ['Crush!', 'Smash you!'], lost: ['Huh?'], hurt: ['Grr!'], allyDown: ['RAAGH!'], alert: ['Hm?'], taunt: ['Come here!'], idle: ['*grunts*'] },
  undead: { aggro: ['*rattles*', '*hisses*'], lost: ['*creaks*'], hurt: ['*clack*'], alert: ['*turns its head*'], idle: ['*groans*'] },
  rogue: { aggro: ['Your money or your life!', 'Get them!'], lost: ['They slipped away.', 'Spread out.'], flee: ['Fall back!', 'Not today!'], hurt: ['Argh!'], allyDown: ['{name} is down!'], alert: ['Someone is there.', 'Quiet. Listen.'], call: ['To me!'], taunt: ['Nowhere to run.'], idle: ['Slow day.'] },
  person: { flee: ['Help! Help!', 'Guards!', 'Somebody help!'], hurt: ['Ow!', 'Stop!'], allyDown: ['No! {name}!'], alert: ['Did you hear that?'], call: ['Guards! Guards!'], greet: ['Good day.', 'Hello there.', 'Morning.'], chat: ['Heard the news?', 'Fine weather.', 'How is the family?'], work: ['Back to work.', 'So much to do.'], eat: ['I am starving.'], sleep: ['Time for bed.', '*yawns*'], drink: ['A pint, please.', 'To the inn!'], trade: ['Fresh goods!', 'Best prices in town.'], idle: ['Hm hm hm.'] },
  guard: { aggro: ['Halt!', 'Drop your weapon!', 'In the name of the law!'], lost: ['Must have been the wind.', 'Keep your eyes open.'], hurt: ['Ngh!'], allyDown: ['Guard down!'], alert: ['Who goes there?', 'Show yourself!'], call: ['To arms!'], taunt: ['Give up!'], greet: ['Citizen.', 'Move along.'], patrol: ['All quiet.', 'Nothing to report.'], eat: ['Finally, a break.'], sleep: ['Off duty.'], chat: ['Quiet night?'], idle: ['*stands watch*'] },
};

/** checkBarks(table, where) -> table. Throws when it is not { voice: { kind: [strings] } }. */
export function checkBarks(table, where = 'checkBarks') {
  for (const voice of sortedKeys(table)) {
    need(table[voice] && typeof table[voice] === 'object', `${where}: barks.${voice} must be { kind: [lines] }`);
    for (const kind of sortedKeys(table[voice])) {
      const lines = table[voice][kind];
      need(Array.isArray(lines) && lines.every((l) => typeof l === 'string'), `${where}: barks.${voice}.${kind} must be a list of strings`);
    }
  }
  return table;
}

/**
 * pickBark(table, agent, kind, time, options) -> the line to say, or null. It returns null when the voice
 * has no line of that kind, the agent spoke less than `gap` seconds ago (default 2.5), or said this
 * kind less than `again` seconds ago (default 8). It never picks the same line twice in a row.
 * The agent keeps its notes in agent.said ({ t, kinds: { kind: time }, last: { kind: index } }).
 */
export function pickBark(table, agent, kind, time, options = {}) {
  const lines = table[agent.voice]?.[kind];
  if (!lines || !lines.length) return null;
  const said = agent.said;
  if (!options.force) {
    if (time - said.t < (options.gap ?? 2.5)) return null;
    if (said.kinds[kind] !== undefined && time - said.kinds[kind] < (options.again ?? 8)) return null;
  }
  let i = Math.floor(roll(agent) * lines.length);
  if (lines.length > 1 && said.last[kind] === i) i = (i + 1) % lines.length;
  said.t = time; said.kinds[kind] = time; said.last[kind] = i;
  return lines[i].replace('{name}', options.name ?? 'them');
}
