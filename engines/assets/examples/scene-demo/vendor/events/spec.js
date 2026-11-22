// The words of the events format in one place: every key a file may use. The validator checks
// files against these lists and the runtime reads the same lists, so the two cannot drift apart.

/** Ids of areas, triggers, sequences and vars: lower_snake_case. */
export const ID = /^[a-z][a-z0-9_]*$/;
/** How a timed step speeds up and slows down. */
export const EASES = Object.freeze(['linear', 'in', 'out', 'inout']);
/** The four parts of a day (the same names as the base and the sky engine). */
export const PARTS = Object.freeze(['night', 'dawn', 'day', 'dusk']);
/** Comparison words in a `var` condition. */
export const COMPARES = Object.freeze(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']);
/** Quest states (owned by the dialogue engine's story). */
export const QUEST_STATES = Object.freeze(['inactive', 'active', 'done', 'failed']);
/** Sequence modes: a cutscene takes the player's input, a background sequence does not. */
export const MODES = Object.freeze(['cutscene', 'background']);
/** Words that cannot be the id of an area (the camera step uses them). */
export const RESERVED = Object.freeze(['release']);

export const TOP_KEYS = Object.freeze(['id', 'title', 'player', 'scenes', 'vars', 'actors', 'areas', 'triggers', 'sequences']);
export const AREA_KEYS = Object.freeze(['x', 'y', 'radius', 'w', 'h', 'points', 'poi', 'scene']);
export const TRIGGER_KEYS = Object.freeze(['id', 'when', 'if', 'scene', 'repeat', 'each', 'cooldown', 'enabled', 'run', 'do', 'prompt']);
export const SEQUENCE_KEYS = Object.freeze(['title', 'mode', 'skippable', 'bars', 'steps']);

/**
 * Trigger kinds: the one key inside `when`, what its value must be, and the extra keys allowed.
 * value: 'place' (area id, or actor id), 'hour', 'part', 'name', 'true', 'quest', 'objective',
 * 'dialogue', 'sequence'.
 */
export const WHEN = Object.freeze({
  start: { value: 'true', extra: [] },
  enter: { value: 'place', extra: ['who', 'reach'] },
  leave: { value: 'place', extra: ['who', 'reach'] },
  inside: { value: 'place', extra: ['who', 'reach', 'for'] },
  interact: { value: 'place', extra: ['reach'] },
  hour: { value: 'hour', extra: [] },
  part: { value: 'part', extra: [] },
  event: { value: 'name', extra: ['match'] },
  questStarted: { value: 'quest', extra: [] },
  questDone: { value: 'quest', extra: [] },
  questFailed: { value: 'quest', extra: [] },
  objectiveDone: { value: 'objective', extra: [] },
  dialogueEnded: { value: 'dialogue', extra: [] },
  storyEvent: { value: 'name', extra: [] },
  sequenceEnded: { value: 'sequence', extra: [] },
  scene: { value: 'scene', extra: [] },
});

/** Keys any step may carry besides its verb. */
export const STEP_COMMON = Object.freeze(['background', 'note']);

/**
 * Step verbs: a step is an object with exactly ONE of these keys. `value` says what the verb's
 * value must be, `extra` lists the other keys the step may have, `needs` the ones it must have.
 */
export const VERBS = Object.freeze({
  wait: { value: 'seconds', extra: [] },
  fade: { value: 'fade', extra: ['time', 'color'] },
  bars: { value: 'onoff', extra: ['time'] },
  camera: { value: 'camera', extra: ['zoom', 'yaw', 'pitch', 'height', 'distance', 'time', 'ease', 'follow', 'pov'] },
  shake: { value: 'seconds', extra: ['strength'] },
  move: { value: 'actor', extra: ['to', 'speed', 'time', 'clip', 'ease'], needs: ['to'] },
  face: { value: 'actor', extra: ['to'], needs: ['to'] },
  place: { value: 'actor', extra: ['at', 'facing'], needs: ['at'] },
  show: { value: 'actor', extra: [] },
  hide: { value: 'actor', extra: [] },
  animate: { value: 'actor', extra: ['clip', 'time'], needs: ['clip'] },
  say: { value: 'speaker', extra: ['text', 'time'], needs: ['text'] },
  dialogue: { value: 'dialogue', extra: [] },
  sound: { value: 'name', extra: ['volume'] },
  music: { value: 'name', extra: ['time'] },
  setHour: { value: 'hour', extra: [] },
  set: { value: 'var', extra: ['to'], needs: ['to'] },
  add: { value: 'var', extra: ['by'] },
  startQuest: { value: 'quest', extra: [] },
  progress: { value: 'objective', extra: ['by'] },
  failQuest: { value: 'quest', extra: [] },
  emit: { value: 'name', extra: ['data'] },
  call: { value: 'name', extra: ['args'] },
  run: { value: 'sequence', extra: [] },
  together: { value: 'lanes', extra: [] },
  if: { value: 'condition', extra: ['then', 'else'], needs: ['then'] },
  enable: { value: 'trigger', extra: [] },
  disable: { value: 'trigger', extra: [] },
});

/** Condition kinds: the one key that names the kind, and the other keys allowed with it. */
export const CONDITIONS = Object.freeze({
  var: COMPARES,
  quest: ['is'],
  objectiveDone: [],
  visited: [],
  hour: [],
  part: [],
  inside: ['who', 'reach'],
  fired: [],
  scene: [],
  all: [],
  any: [],
  not: [],
});

/** The verb of a step object, or null when it has none or more than one. */
export function verbOf(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
  const found = Object.keys(step).filter((k) => Object.hasOwn(VERBS, k));
  return found.length === 1 ? found[0] : null;
}

/** 'night', 'dawn', 'day' or 'dusk' for an hour 0..24 (the same table as the base engine). */
export function partOfHour(hour) {
  if (hour < 5) return 'night';
  if (hour < 8) return 'dawn';
  if (hour < 17) return 'day';
  if (hour < 20) return 'dusk';
  return 'night';
}
