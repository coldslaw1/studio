// The demo's story for the dialogue engine: three people to talk to and two quests, written by hand,
// plus one side quest made by the procgen engine from a seed (the farmer wants the field's skeleton
// gone, twice): its title, lines, objectives and pay all come from generateQuest.
// Plain JSON-compatible data (checked by tests/showcase.test.js with validateStory).

import { generateQuest, mergeStory } from '../vendor/procgen/index.js';

/** The hand-written part. */
const WRITTEN = {
  id: 'hamlet',
  title: 'The hamlet watch',
  vars: { coins: 0, stones: 3, cellar_open: false, place: 'the green' },
  events: ['open_cellar', 'more_stones'],
  quests: {
    supplies: {
      title: 'Stock the watchtower',
      description: 'The guard needs the hamlet ready before nightfall.',
      objectives: [
        { id: 'ask_elder', text: 'Ask Elder Maren about the stores' },
        { id: 'herbs', text: 'Gather moonleaf around the hamlet', count: 3 },
        { id: 'cellar', text: 'Sort the crates in the cellar by the cottage' },
        { id: 'report', text: 'Report back to the guard' },
      ],
      rewards: [{ add: 'coins', by: 20 }],
    },
    neighbours: {
      title: 'Meet the neighbours',
      description: 'The open land is dotted with hamlets. Say hello.',
      objectives: [{ id: 'greet', text: 'Greet people in the hamlets you find', count: 4 }],
      rewards: [{ add: 'coins', by: 10 }],
    },
    practice: {
      title: 'Target practice',
      description: 'Tobin bets you cannot hit the old barrel in the yard.',
      objectives: [{ id: 'hits', text: 'Hit the practice barrel with thrown stones', count: 3 }],
      rewards: [{ add: 'coins', by: 5 }],
    },
  },
  dialogues: {
    guard: {
      start: 'gate',
      nodes: {
        gate: { branch: [
          { if: { quest: 'supplies', is: 'done' }, goto: 'after' },
          { if: { all: [{ objectiveDone: 'supplies.herbs' }, { objectiveDone: 'supplies.cellar' }] }, goto: 'report' },
          { if: { quest: 'supplies', is: 'active' }, goto: 'waiting' },
          { goto: 'hello' },
        ] },
        hello: {
          speaker: 'Guard',
          text: 'Halt. Oh, it is you. The watchtower stores are a mess and night is coming. Will you help?',
          choices: [
            { text: 'Tell me what you need.', goto: 'brief' },
            { text: 'What is this place?', goto: 'place' },
            { text: 'Not now.', end: true },
          ],
        },
        place: {
          speaker: 'Guard',
          text: 'A hamlet rendered as text, with every studio engine at work in it. I just walk the path.',
          goto: 'hello',
        },
        brief: {
          speaker: 'Guard',
          text: 'Elder Maren keeps the cellar key, by the well. Bring moonleaf for the lamps and get the crates in order.',
          do: [{ startQuest: 'supplies' }],
          end: true,
        },
        waiting: {
          speaker: 'Guard',
          text: 'Moonleaf and the cellar crates. Maren is by the well if you need her.',
          end: true,
        },
        report: {
          speaker: 'Guard',
          text: 'Lamps filled and crates in order. The watch is in your debt. Twenty coins, as promised.',
          do: [{ progress: 'supplies.report' }],
          end: true,
        },
        after: {
          speaker: 'Guard',
          text: 'Quiet night ahead, thanks to you. You hold {coins} coins.',
          end: true,
        },
      },
    },
    elder: {
      start: 'gate',
      nodes: {
        gate: { branch: [
          { if: { objectiveDone: 'supplies.ask_elder' }, goto: 'again' },
          { if: { quest: 'supplies', is: 'active' }, goto: 'key' },
          { goto: 'hello' },
        ] },
        hello: { speaker: 'Elder Maren', text: 'Good day. If you are looking for work, the guard at the gate always is short of hands.', end: true },
        key: {
          speaker: 'Elder Maren',
          text: 'The stores? The cellar hatch is beside the cottage. Here, it is unlocked now. Moonleaf grows where it is quiet: look near the trees.',
          do: [{ progress: 'supplies.ask_elder' }, { set: 'cellar_open', to: true }, { emit: 'open_cellar' }],
          end: true,
        },
        again: {
          speaker: 'Elder Maren',
          text: 'The hatch by the cottage is open. Push each crate onto a marked stone. You cannot pull them, so think first.',
          choices: [
            { text: 'Where does moonleaf grow?', goto: 'leaf' },
            { text: 'Thank you.', end: true },
          ],
        },
        leaf: { speaker: 'Elder Maren', text: 'Three patches: by the pines, north of the cottage, and down by the signpost.', end: true },
      },
    },
    watch: {
      start: 'hello',
      nodes: {
        hello: {
          speaker: 'Watchman',
          text: 'Well met, traveller. This is {place}. The land goes on in every direction and never ends.',
          do: [{ startQuest: 'neighbours' }],
          choices: [
            { text: 'Any work for me?', goto: 'work' },
            { text: 'Farewell.', end: true },
          ],
        },
        work: { speaker: 'Watchman', text: 'Folk like news. Greet people in the hamlets around, and pick up what lies by the road: I opens your bag.', end: true },
      },
    },
    folk: {
      start: 'hello',
      nodes: {
        hello: {
          speaker: 'Villager',
          text: 'Lovely day in {place}. Mind the water, and the forest gets thick to the north.',
          do: [{ startQuest: 'neighbours' }],
          choices: [
            { text: 'What lies beyond?', goto: 'beyond' },
            { text: 'Good day.', end: true },
          ],
        },
        beyond: { speaker: 'Villager', text: 'Meadow, forest, fen and steppe, and more hamlets like this one. Nobody has found the edge.', end: true },
      },
    },
    tobin: {
      start: 'gate',
      nodes: {
        gate: { branch: [
          { if: { quest: 'practice', is: 'done' }, goto: 'done' },
          { if: { quest: 'practice', is: 'active' }, goto: 'going' },
          { goto: 'hello' },
        ] },
        hello: {
          speaker: 'Tobin',
          text: 'See that barrel in the yard? Bet you cannot hit it three times. Throw with F. You can kick the ball about too.',
          choices: [
            { text: 'You are on.', goto: 'deal' },
            { text: 'Maybe later.', end: true },
          ],
        },
        deal: { speaker: 'Tobin', text: 'Three hits. Here are some stones.', do: [{ startQuest: 'practice' }, { add: 'stones', by: 5 }, { emit: 'more_stones' }], end: true },
        going: {
          speaker: 'Tobin',
          text: 'Not there yet. Need more stones?',
          choices: [
            { text: 'Yes please.', goto: 'stones' },
            { text: 'I am fine.', end: true },
          ],
        },
        stones: { speaker: 'Tobin', text: 'Here.', do: [{ add: 'stones', by: 5 }, { emit: 'more_stones' }], end: true },
        done: {
          speaker: 'Tobin',
          text: 'Three hits! You win the bet.',
          choices: [
            { text: 'More stones, please.', goto: 'stones' },
            { text: 'See you.', end: true },
          ],
        },
      },
    },
  },
};

/** The farmer's side quest: the same seed always gives the same quest. */
export const SIDE_QUEST = generateQuest({ seed: 'kiln-hamlet', type: 'kill', kind: 'skeleton', count: 2, level: 1, giver: { id: 'farmer', name: 'Farmer Odo' }, place: { name: 'the north-west field' } });

/** Story data for createStory. */
export const STORY = mergeStory(WRITTEN, SIDE_QUEST);
