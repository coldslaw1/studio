// Acoustic spaces: what the place a sound happens in does to it. A space is
// a reverb recipe (how much, how long, how dark, how late, any distinct echo).
// createAudio turns the current space into an impulse response and runs every
// effect, footstep and the music through it live, so one coin sounds like the
// same coin in a cellar, a hall or a field, and far sounds are more "roomy"
// than near ones. The offline renderers use the same recipe (see applySpace).

import { applyFx, createReverb, fxTail, validateFx } from './fx.js';
import { soundStyle } from './palettes.js';

/**
 * The built-in spaces. reverb: how much room is heard 0..1, room: its size 0..1, damp: how dark 0..1,
 * predelay: seconds before the room answers (big spaces), echo / echoTime: a distinct repeat,
 * distance: how much more room a far sound gets than a near one.
 */
export const SPACES = {
  none: { description: 'No room at all: completely dry.', reverb: 0, room: 0, damp: 0.5, predelay: 0, echo: 0, echoTime: 0.25, distance: 0 },
  field: { description: 'Open ground: almost nothing comes back, only a faint slap from far away.', reverb: 0.05, room: 0.15, damp: 0.7, predelay: 0.03, echo: 0.06, echoTime: 0.34, distance: 0.6 },
  forest: { description: 'Among trees: a short, soft, scattered answer.', reverb: 0.13, room: 0.32, damp: 0.6, predelay: 0.012, echo: 0, echoTime: 0.25, distance: 1.4 },
  room: { description: 'A furnished room indoors: small, warm and close.', reverb: 0.16, room: 0.2, damp: 0.55, predelay: 0, echo: 0, echoTime: 0.25, distance: 0.8 },
  hall: { description: 'A big stone or wooden hall: long and clear.', reverb: 0.3, room: 0.72, damp: 0.3, predelay: 0.018, echo: 0, echoTime: 0.25, distance: 1.6 },
  cave: { description: 'A cave: very long, wet, with a late echo.', reverb: 0.42, room: 0.92, damp: 0.5, predelay: 0.03, echo: 0.18, echoTime: 0.31, distance: 2 },
  crypt: { description: 'A low stone cellar: long but dark and dull.', reverb: 0.38, room: 0.8, damp: 0.85, predelay: 0.01, echo: 0, echoTime: 0.25, distance: 1.6 },
  canyon: { description: 'Rock walls far apart: little reverb, clear repeating echoes.', reverb: 0.12, room: 0.5, damp: 0.5, predelay: 0.05, echo: 0.5, echoTime: 0.42, distance: 1.2 },
};

/** Names of the built-in spaces. */
export const SPACE_NAMES = Object.keys(SPACES);

const KEYS = ['reverb', 'room', 'damp', 'predelay', 'echo', 'echoTime', 'distance'];

/**
 * spaceOf(value, fn?) -> a complete space { name, reverb, room, damp, predelay, echo, echoTime, distance }
 *   value: a name from SPACE_NAMES, 'style:<style name>' (the small room a sound style comes with),
 *          or your own object with any of those settings (the rest default to a plain room)
 * Throws on an unknown name or a setting out of range.
 */
export function spaceOf(value, fn = 'spaceOf') {
  if (typeof value === 'string') {
    if (value.startsWith('style:')) {
      const fx = soundStyle(value.slice(6), fn).sfx.fx;
      return { name: value, reverb: fx.reverb ?? 0, room: fx.room ?? 0.3, damp: fx.damp ?? 0.5, predelay: 0, echo: 0, echoTime: 0.25, distance: 1 };
    }
    if (!Object.hasOwn(SPACES, value)) throw new Error(`${fn}: unknown space "${value}". Spaces: ${SPACE_NAMES.join(', ')}`);
    const { description, ...space } = SPACES[value];
    void description;
    return { name: value, ...space };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${fn}: a space must be a name (${SPACE_NAMES.join(', ')}) or an object like { reverb: 0.3, room: 0.7 }, got ${JSON.stringify(value)}`);
  const space = { name: value.name ?? 'custom', reverb: 0.2, room: 0.4, damp: 0.5, predelay: 0, echo: 0, echoTime: 0.25, distance: 1 };
  for (const key of Object.keys(value)) {
    if (key === 'name' || key === 'description') continue;
    if (!KEYS.includes(key)) throw new Error(`${fn}: unknown space setting "${key}". Valid settings: ${KEYS.join(', ')}`);
    space[key] = value[key];
  }
  validateFx({ reverb: space.reverb, room: space.room, damp: space.damp, echo: space.echo, echoTime: space.echoTime }, fn);
  if (!(space.predelay >= 0 && space.predelay <= 0.2)) throw new Error(`${fn}: space.predelay must be a number from 0 to 0.2, got ${JSON.stringify(space.predelay)}`);
  if (!(space.distance >= 0 && space.distance <= 4)) throw new Error(`${fn}: space.distance must be a number from 0 to 4, got ${JSON.stringify(space.distance)}`);
  return space;
}

const fxOf = (space) => {
  const fx = {};
  if (space.reverb > 0) { fx.reverb = space.reverb; fx.room = space.room; fx.damp = space.damp; }
  if (space.echo > 0) { fx.echo = space.echo; fx.echoTime = space.echoTime; }
  return fx;
};

/** spaceSeconds(space) -> how long the space rings on after a sound, in seconds */
export function spaceSeconds(space) {
  const s = spaceOf(space, 'spaceSeconds');
  return s.reverb > 0 || s.echo > 0 ? s.predelay + fxTail({ ...fxOf(s), reverb: Math.max(s.reverb, 0.01), room: s.room }) : 0;
}

/**
 * impulseResponse(space, sampleRate?) -> { left, right, seconds }
 * What the space answers to a single click, without the click itself: the buffer a
 * Web Audio ConvolverNode needs. The level already includes the space's `reverb` amount.
 */
export function impulseResponse(space, sampleRate = 44100) {
  const plan = impulsePlan(space, sampleRate);
  for (const [, run] of plan.jobs) run();
  const [left, right] = plan.done();
  return { left, right, seconds: left.length / sampleRate };
}

/**
 * impulsePlan(space, sampleRate?) -> { jobs: [[cost, run], ...], done() -> [left, right] }
 * The same work as impulseResponse in small jobs, so createAudio can build a big room's
 * response over a few frames instead of inside the call that changes the space.
 */
export function impulsePlan(space, sampleRate = 44100) {
  const s = spaceOf(space, 'impulsePlan');
  const seconds = Math.max(0.05, spaceSeconds(s));
  const n = Math.round(seconds * sampleRate), at = Math.round(s.predelay * sampleRate);
  const left = new Float32Array(n), right = new Float32Array(n);
  if (s.echo > 0) { // the distinct repeats, alternating sides, each quieter than the last
    const gap = Math.round(s.echoTime * sampleRate);
    let level = s.echo;
    for (let k = 1; at + k * gap < n && level > 0.01; k++) { (k % 2 ? left : right)[at + k * gap] += level; (k % 2 ? right : left)[at + k * gap] += level * 0.5; level *= 0.25 + s.echo * 0.4; }
  }
  const jobs = [];
  if (s.reverb > 0) {
    const dryL = left.slice(), dryR = right.slice();
    left[at] += 1; right[at] += 1;
    const inL = left.slice(), inR = right.slice(), reverb = createReverb(sampleRate, s), chunk = 8192;
    for (let from = 0; from < n; from += chunk) {
      const to = Math.min(n, from + chunk);
      jobs.push([(to - from) * 6, () => {
        reverb.process(left, right, from, to, 1);
        // process() mixes its input back in at 0.7; take that out again, keep only the room and the repeats.
        for (let i = from; i < to; i++) { left[i] = (left[i] - inL[i] * 0.7) * s.reverb + dryL[i]; right[i] = (right[i] - inR[i] * 0.7) * s.reverb + dryR[i]; }
      }]);
    }
  }
  jobs.push([1000, () => {
    const fade = Math.min(n, Math.round(sampleRate * 0.05));
    for (let i = 0; i < fade; i++) { left[n - 1 - i] *= i / fade; right[n - 1 - i] *= i / fade; }
  }]);
  return { jobs, done: () => [left, right] };
}

/**
 * applySpace(stereo, space, sampleRate?) -> { left, right } a new, longer pair with the space added.
 * For WAV files and tests; in a game call audio.setSpace(name) instead.
 */
export function applySpace(stereo, space, sampleRate = 44100) {
  if (!stereo || !(stereo.left instanceof Float32Array) || !(stereo.right instanceof Float32Array)) throw new Error('applySpace: expected { left, right } Float32Arrays');
  const s = spaceOf(space, 'applySpace'), fx = fxOf(s);
  const lead = Math.round(s.predelay * sampleRate), tail = Math.round(spaceSeconds(s) * sampleRate);
  const n = stereo.left.length + tail;
  const left = new Float32Array(n), right = new Float32Array(n);
  left.set(stereo.left); right.set(stereo.right);
  if (!fx.reverb && !fx.echo) return { left, right };
  if (lead > 0 && fx.reverb) { // the room answers late: process a delayed copy and add only what the room made
    const wl = new Float32Array(n), wr = new Float32Array(n);
    wl.set(stereo.left, lead); wr.set(stereo.right, lead);
    const il = wl.slice(), ir = wr.slice();
    applyFx(wl, wr, fx, sampleRate);
    for (let i = 0; i < n; i++) { left[i] += wl[i] - il[i]; right[i] += wr[i] - ir[i]; }
  } else applyFx(left, right, fx, sampleRate);
  return { left, right };
}
