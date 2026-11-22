// The built-in brains. A brain is plain data: a list of goals, each with the considerations that score
// it (see utility.js) and the behaviour tree that carries it out (see bt.js). Copy one, change the
// weights or trees, and register it under a new name with createAi({ brains: { mine: ... } }).

const AFRAID = { input: 'fear', curve: { type: 'step', at: 0.5 } };
const stroll = { repeat: 'forever', then: { seq: [{ always: 'ok', then: { do: 'wander', radius: 5 } }, { wait: [2, 6] }, { always: 'ok', then: { do: 'bark', kind: 'idle' } }] } };
// with nothing to do: stand guard at home when the blackboard says so (bb: { guard: true }), else stroll about
const atEase = { sel: [{ seq: [{ if: 'bb', key: 'guard' }, 'guard'] }, stroll] };
// shout for help at most every 10 seconds, then get on with it
const shout = { always: 'ok', then: { cooldown: 10, then: 'callHelp' } };

/**
 * BRAINS -> { name: { goals, inertia } }.
 *   mob     hostile creatures: fight what they see, flee when afraid, look into noises, follow the pack
 *           leader, patrol, drift back home, otherwise wander near home (or stand guard there, facing the
 *           way they were placed, when made with bb: { guard: true })
 *   guard   people who fight: as mob, but with a daily schedule, needs, and a post to stand at
 *   npc     civilians: flee and call for help, keep their daily schedule, see to urgent needs, stop to talk
 *   prey    harmless animals: graze near home and bolt from anything hostile
 */
export const BRAINS = {
  mob: {
    inertia: 0.1,
    goals: [
      { id: 'flee', weight: 1, when: [AFRAID], tree: { seq: [shout, 'flee'] } },
      { id: 'fight', weight: 0.8, when: ['target'], tree: { seq: [shout, 'engage'] } },
      { id: 'investigate', weight: 0.5, when: ['heard', { input: 'trait', name: 'curiosity', curve: { type: 'linear', m: 0.5, b: 0.5 } }], tree: 'investigate' },
      { id: 'follow', weight: 0.3, when: ['hasLeader'], tree: 'follow' },
      { id: 'patrol', weight: 0.25, when: ['patrol'], tree: 'patrol' },
      { id: 'return', weight: 0.22, when: [{ input: 'awayFromHome', curve: { type: 'step', at: 0.45 } }], tree: 'goHome' },
      { id: 'idle', weight: 0.1, when: [], tree: atEase },
    ],
  },
  guard: {
    inertia: 0.1,
    goals: [
      { id: 'talk', weight: 2, when: ['talking'], tree: 'talk' },
      { id: 'flee', weight: 1, when: [AFRAID], tree: { seq: [shout, 'flee'] } },
      { id: 'fight', weight: 0.9, when: ['target'], tree: { seq: [{ always: 'ok', then: { do: 'bark', kind: 'aggro' } }, shout, 'engage'] } },
      { id: 'investigate', weight: 0.6, when: ['heard'], tree: 'investigate' },
      { id: 'need', weight: 0.55, when: ['urgentNeed'], tree: 'satisfy' },
      { id: 'schedule', weight: 0.5, when: ['scheduled'], tree: 'scheduled' },
      { id: 'patrol', weight: 0.3, when: ['patrol'], tree: 'patrol' },
      { id: 'idle', weight: 0.1, when: [], tree: 'guard' },
    ],
  },
  npc: {
    inertia: 0.1,
    goals: [
      { id: 'talk', weight: 2, when: ['talking'], tree: 'talk' },
      { id: 'flee', weight: 1.5, when: [AFRAID], tree: { seq: [shout, 'flee'] } },
      { id: 'need', weight: 0.7, when: ['urgentNeed'], tree: 'satisfy' },
      { id: 'schedule', weight: 0.5, when: ['scheduled'], tree: 'scheduled' },
      { id: 'idle', weight: 0.1, when: [], tree: stroll },
    ],
  },
  prey: {
    inertia: 0.1,
    goals: [
      { id: 'flee', weight: 1, when: ['threatened'], tree: 'flee' },
      { id: 'return', weight: 0.3, when: [{ input: 'awayFromHome', curve: { type: 'step', at: 0.5 } }], tree: 'goHome' },
      { id: 'idle', weight: 0.1, when: [], tree: stroll },
    ],
  },
};
