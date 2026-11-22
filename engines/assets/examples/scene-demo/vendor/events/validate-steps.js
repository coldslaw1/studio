// Checks of steps and conditions. Used by validate.js; see there for the report shape.
import { VERBS, STEP_COMMON, CONDITIONS, COMPARES, EASES, PARTS, QUEST_STATES, ID } from './spec.js';
import { hint } from './suggest.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isPoint = (v) => isObj(v) && isNum(v.x) && isNum(v.y);

/** An actor id: must be in `actors` (the player always is). */
export function checkActor(v, id, path) {
  if (typeof id !== 'string' || !id) return v.err('bad-value', path, `expected an actor id (a string), got ${JSON.stringify(id)}`);
  if (!v.actors.has(id)) v.err('unknown-actor', path, `"${id}" is not in "actors".${hint(id, v.actors)} Add it to the "actors" list at the top of the file.`);
}

/** A place: an area id or an actor id. */
export function checkPlace(v, id, path) {
  if (typeof id !== 'string' || !id) return v.err('bad-value', path, `expected an area id or an actor id, got ${JSON.stringify(id)}`);
  if (v.areas.has(id)) { v.usedAreas.add(id); return; }
  if (!v.actors.has(id)) v.err('unknown-place', path, `"${id}" is neither an area nor an actor.${hint(id, [...v.areas, ...v.actors])}`);
}

/** A target: a place, or a point { x, y }. */
function checkTarget(v, t, path) {
  if (isPoint(t)) return;
  if (isObj(t)) return v.err('bad-value', path, `a point needs numbers for x and y, got ${JSON.stringify(t)}`);
  checkPlace(v, t, path);
}

/** A variable name: one of this file's "vars", or one of the story's. Returns its starting value, or undefined. */
function checkVar(v, name, path) {
  if (typeof name !== 'string' || !name) { v.err('bad-value', path, `expected a variable name, got ${JSON.stringify(name)}`); return undefined; }
  if (Object.hasOwn(v.vars, name)) { v.usedVars.add(name); return v.vars[name]; }
  if (v.story && Object.hasOwn(v.story.vars ?? {}, name)) return v.story.vars[name];
  const known = [...Object.keys(v.vars), ...Object.keys(v.story?.vars ?? {})];
  v.storyRef('unknown-var', path, `variable "${name}" is not declared.${hint(name, known)} Add it to "vars" with its starting value.`, !v.story);
  return undefined;
}

function checkQuest(v, id, path) {
  if (typeof id !== 'string' || !id) return v.err('bad-value', path, `expected a quest id, got ${JSON.stringify(id)}`);
  v.needsStory = true;
  if (v.story && !Object.hasOwn(v.story.quests ?? {}, id)) v.err('unknown-quest', path, `the story has no quest "${id}".${hint(id, Object.keys(v.story.quests ?? {}))}`);
}

function checkObjective(v, ref, path) {
  if (typeof ref !== 'string' || !/^[^.]+\.[^.]+$/.test(ref)) return v.err('bad-value', path, `expected "quest_id.objective_id", got ${JSON.stringify(ref)}`);
  v.needsStory = true;
  if (!v.story) return;
  const [q, o] = ref.split('.');
  const quest = v.story.quests?.[q];
  if (!quest) return v.err('unknown-quest', path, `the story has no quest "${q}".${hint(q, Object.keys(v.story.quests ?? {}))}`);
  const ids = (quest.objectives ?? []).map((x) => x.id);
  if (!ids.includes(o)) v.err('unknown-objective', path, `quest "${q}" has no objective "${o}".${hint(o, ids)}`);
}

function checkDialogue(v, id, path) {
  if (typeof id !== 'string' || !id) return v.err('bad-value', path, `expected a dialogue id, got ${JSON.stringify(id)}`);
  v.needsStory = true;
  if (v.story && !Object.hasOwn(v.story.dialogues ?? {}, id)) v.err('unknown-dialogue', path, `the story has no dialogue "${id}".${hint(id, Object.keys(v.story.dialogues ?? {}))}`);
}

function checkHour(v, h, path) {
  if (!isNum(h) || h < 0 || h >= 24) v.err('bad-value', path, `an hour is a number from 0 up to (not including) 24, got ${JSON.stringify(h)}`);
}

function unknownKeys(v, obj, allowed, path, what) {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) v.err('unknown-key', `${path}.${key}`, `unknown key "${key}" in ${what}.${hint(key, allowed)}`);
}

/** Check a condition object (the value of an `if`). */
export function checkCondition(v, c, path) {
  if (!isObj(c)) return v.err('bad-condition', path, `a condition is an object such as { "var": "name" }, got ${JSON.stringify(c)}`);
  const kinds = Object.keys(c).filter((k) => Object.hasOwn(CONDITIONS, k));
  if (kinds.length !== 1) return v.err('bad-condition', path, `a condition needs exactly one of: ${Object.keys(CONDITIONS).join(', ')}; got keys ${JSON.stringify(Object.keys(c))}`);
  const kind = kinds[0]; const value = c[kind];
  unknownKeys(v, c, [kind, ...CONDITIONS[kind]], path, `a "${kind}" condition`);
  if (kind === 'var') {
    const start = checkVar(v, value, `${path}.var`);
    const used = COMPARES.filter((k) => k in c);
    if (used.length > 1) v.err('bad-condition', path, `use only one of ${COMPARES.join(', ')}; got ${used.join(', ')}`);
    if (used.length === 1 && start !== undefined) {
      const given = c[used[0]];
      if (typeof given !== typeof start) v.err('type-mismatch', `${path}.${used[0]}`, `variable "${value}" is a ${typeof start}, but it is compared with ${JSON.stringify(given)}`);
      else if (!['eq', 'ne'].includes(used[0]) && typeof start !== 'number') v.err('type-mismatch', `${path}.${used[0]}`, `"${used[0]}" only works on numbers; "${value}" is a ${typeof start}`);
    }
  } else if (kind === 'quest') {
    checkQuest(v, value, `${path}.quest`);
    if (!QUEST_STATES.includes(c.is)) v.err('bad-condition', `${path}.is`, `"is" must be one of ${QUEST_STATES.join(', ')}, got ${JSON.stringify(c.is)}`);
  } else if (kind === 'objectiveDone') checkObjective(v, value, `${path}.objectiveDone`);
  else if (kind === 'visited') { v.needsStory = true; if (typeof value !== 'string' || !value.includes('.')) v.err('bad-condition', `${path}.visited`, `expected "dialogue_id.node_id", got ${JSON.stringify(value)}`); }
  else if (kind === 'hour') {
    if (!isObj(value) || !('from' in value) || !('to' in value)) v.err('bad-condition', `${path}.hour`, `expected { "from": 20, "to": 5 }, got ${JSON.stringify(value)}`);
    else { checkHour(v, value.from, `${path}.hour.from`); checkHour(v, value.to, `${path}.hour.to`); }
  } else if (kind === 'part') { if (!PARTS.includes(value)) v.err('bad-condition', `${path}.part`, `expected one of ${PARTS.join(', ')}, got ${JSON.stringify(value)}.${hint(value, PARTS)}`); }
  else if (kind === 'inside') {
    checkPlace(v, value, `${path}.inside`);
    if ('who' in c) checkActor(v, c.who, `${path}.who`);
    if ('reach' in c && !(isNum(c.reach) && c.reach > 0)) v.err('bad-value', `${path}.reach`, `"reach" must be a number above 0, got ${JSON.stringify(c.reach)}`);
  } else if (kind === 'fired') {
    if (!v.triggers.has(value)) v.err('unknown-trigger', `${path}.fired`, `there is no trigger "${value}".${hint(value, v.triggers)}`);
  } else if (kind === 'scene') v.checkScene(value, `${path}.scene`);
  else if (kind === 'not') checkCondition(v, value, `${path}.not`);
  else if (kind === 'all' || kind === 'any') {
    if (!Array.isArray(value) || value.length === 0) v.err('bad-condition', `${path}.${kind}`, `"${kind}" needs a list of conditions, got ${JSON.stringify(value)}`);
    else value.forEach((sub, i) => checkCondition(v, sub, `${path}.${kind}[${i}]`));
  }
}

const seconds = (v, n, path, key) => { if (!(isNum(n) && n >= 0)) v.err('bad-value', path, `"${key}" is a number of seconds, 0 or more, got ${JSON.stringify(n)}`); };

/** Check a list of steps. `runs` collects the ids of sequences these steps run. */
export function checkSteps(v, steps, path, runs) {
  if (!Array.isArray(steps) || steps.length === 0) return v.err('bad-steps', path, `expected a list with at least one step, got ${JSON.stringify(steps)?.slice(0, 60)}`);
  steps.forEach((step, i) => checkStep(v, step, `${path}[${i}]`, runs));
}

function checkStep(v, step, path, runs) {
  if (!isObj(step)) return v.err('bad-step', path, `a step is an object such as { "wait": 1 }, got ${JSON.stringify(step)}`);
  const keys = Object.keys(step);
  const verbs = keys.filter((k) => Object.hasOwn(VERBS, k));
  if (verbs.length === 0) {
    const guess = keys.map((k) => hint(k, Object.keys(VERBS))).find(Boolean) ?? '';
    return v.err('unknown-step', path, `no step verb in ${JSON.stringify(keys)}.${guess} Verbs: ${Object.keys(VERBS).join(', ')}.`);
  }
  if (verbs.length > 1) return v.err('bad-step', path, `a step has exactly one verb, this one has ${verbs.length}: ${verbs.join(', ')}. Split it into ${verbs.length} steps.`);
  const verb = verbs[0]; const spec = VERBS[verb]; const value = step[verb];
  unknownKeys(v, step, [verb, ...spec.extra, ...STEP_COMMON], path, `a "${verb}" step`);
  for (const need of spec.needs ?? []) if (!(need in step)) v.err('missing-key', path, `a "${verb}" step needs "${need}"`);
  if ('background' in step && typeof step.background !== 'boolean') v.err('bad-value', `${path}.background`, `"background" must be true or false, got ${JSON.stringify(step.background)}`);
  if ('time' in step) seconds(v, step.time, `${path}.time`, 'time');
  if ('ease' in step && !EASES.includes(step.ease)) v.err('bad-value', `${path}.ease`, `"ease" must be one of ${EASES.join(', ')}, got ${JSON.stringify(step.ease)}.${hint(step.ease, EASES)}`);
  const at = `${path}.${verb}`;
  switch (spec.value) {
    case 'seconds': seconds(v, value, at, verb); break;
    case 'fade': if (value !== 'in' && value !== 'out') v.err('bad-value', at, `"fade" is "out" (to a dark screen) or "in" (back to the picture), got ${JSON.stringify(value)}`); break;
    case 'onoff': if (value !== 'on' && value !== 'off') v.err('bad-value', at, `"bars" is "on" or "off", got ${JSON.stringify(value)}`); break;
    case 'camera': if (value !== 'release') checkTarget(v, value, at); break;
    case 'actor': checkActor(v, value, at); break;
    case 'speaker': if (typeof value !== 'string') v.err('bad-value', at, `"say" is the speaker's name (a string, "" for a narrator), got ${JSON.stringify(value)}`); break;
    case 'dialogue': checkDialogue(v, value, at); break;
    case 'name': if (typeof value !== 'string' || !value) v.err('bad-value', at, `"${verb}" needs a name (a string), got ${JSON.stringify(value)}`); break;
    case 'hour': checkHour(v, value, at); break;
    case 'var': checkVarStep(v, step, verb, path); break;
    case 'quest': checkQuest(v, value, at); break;
    case 'objective': checkObjective(v, value, at); break;
    case 'sequence':
      if (!v.sequences.has(value)) v.err('unknown-sequence', at, `there is no sequence "${value}".${hint(value, v.sequences)}`);
      else { runs.add(value); v.usedSequences.add(value); }
      break;
    case 'trigger': if (!v.triggers.has(value)) v.err('unknown-trigger', at, `there is no trigger "${value}".${hint(value, v.triggers)}`); break;
    case 'lanes':
      if (!Array.isArray(value) || value.length < 2) v.err('bad-value', at, `"together" needs a list of two or more steps (or lists of steps), got ${JSON.stringify(value)?.slice(0, 60)}`);
      else value.forEach((lane, i) => (Array.isArray(lane) ? checkSteps(v, lane, `${at}[${i}]`, runs) : checkStep(v, lane, `${at}[${i}]`, runs)));
      break;
    case 'condition':
      checkCondition(v, value, at);
      if ('then' in step) checkSteps(v, step.then, `${path}.then`, runs);
      if ('else' in step) checkSteps(v, step.else, `${path}.else`, runs);
      break;
    default: break;
  }
  if (verb === 'move' || verb === 'face') { if ('to' in step) checkTarget(v, step.to, `${path}.to`); }
  if (verb === 'place' && 'at' in step) checkTarget(v, step.at, `${path}.at`);
  if (verb === 'move') {
    if ('speed' in step && !(isNum(step.speed) && step.speed > 0)) v.err('bad-value', `${path}.speed`, `"speed" must be a number above 0, got ${JSON.stringify(step.speed)}`);
    if ('speed' in step && 'time' in step) v.err('bad-step', path, 'a "move" step takes "speed" or "time", not both');
    if ('clip' in step && typeof step.clip !== 'string' && step.clip !== false) v.err('bad-value', `${path}.clip`, `"clip" is an animation name or false, got ${JSON.stringify(step.clip)}`);
  }
  if (verb === 'animate' && 'clip' in step && (typeof step.clip !== 'string' || !step.clip)) v.err('bad-value', `${path}.clip`, `"clip" is an animation name, got ${JSON.stringify(step.clip)}`);
  if (verb === 'say' && 'text' in step && (typeof step.text !== 'string' || !step.text)) v.err('bad-value', `${path}.text`, `"text" must be a non-empty string, got ${JSON.stringify(step.text)}`);
  if (verb === 'camera') {
    for (const k of ['zoom', 'yaw', 'pitch', 'height', 'distance']) if (k in step && !isNum(step[k])) v.err('bad-value', `${path}.${k}`, `"${k}" must be a number, got ${JSON.stringify(step[k])}`);
    if ('zoom' in step && isNum(step.zoom) && step.zoom <= 0) v.err('bad-value', `${path}.zoom`, `"zoom" must be above 0 (1 is normal, 2 is twice as close), got ${step.zoom}`);
    if (isNum(step.pitch) && (step.pitch < -89 || step.pitch > 89)) v.err('bad-value', `${path}.pitch`, `"pitch" is degrees from -89 (straight up) to 89 (straight down), got ${step.pitch}`);
    if (isNum(step.distance) && step.distance <= 0) v.err('bad-value', `${path}.distance`, `"distance" must be above 0, got ${step.distance}`);
    if ('pov' in step) {
      if (typeof step.pov !== 'boolean') v.err('bad-value', `${path}.pov`, `"pov" must be true or false, got ${JSON.stringify(step.pov)}`);
      else if (step.pov && !(typeof value === 'string' && v.actors.has(value))) v.err('bad-step', path, '"pov": true looks through an actor\'s eyes, so "camera" must name an actor');
      else if (step.pov) for (const k of ['height', 'distance']) if (k in step) v.err('bad-step', path, `"pov": true puts the camera in the actor's eyes: remove "${k}" (use "yaw" and "pitch" for where it looks)`);
    }
    if ('follow' in step) {
      if (typeof step.follow !== 'boolean') v.err('bad-value', `${path}.follow`, `"follow" must be true or false, got ${JSON.stringify(step.follow)}`);
      else if (step.follow && !(typeof value === 'string' && v.actors.has(value))) v.err('bad-step', path, '"follow": true only works when "camera" names an actor');
    }
  }
  if (verb === 'place' && 'facing' in step && !isNum(step.facing)) v.err('bad-value', `${path}.facing`, `"facing" is an angle in degrees, got ${JSON.stringify(step.facing)}`);
  if (verb === 'shake' && 'strength' in step && !(isNum(step.strength) && step.strength >= 0)) v.err('bad-value', `${path}.strength`, `"strength" must be a number, 0 or more, got ${JSON.stringify(step.strength)}`);
  if (verb === 'sound' && 'volume' in step && !(isNum(step.volume) && step.volume >= 0 && step.volume <= 1)) v.err('bad-value', `${path}.volume`, `"volume" is a number from 0 to 1, got ${JSON.stringify(step.volume)}`);
  if (verb === 'progress' && 'by' in step && !(Number.isInteger(step.by) && step.by > 0)) v.err('bad-value', `${path}.by`, `"by" must be a whole number above 0, got ${JSON.stringify(step.by)}`);
  if (verb === 'fade' && 'color' in step && typeof step.color !== 'string') v.err('bad-value', `${path}.color`, `"color" is a CSS colour string such as "#000", got ${JSON.stringify(step.color)}`);
  if (verb === 'emit' && typeof value === 'string' && !value.includes(':') && !ID.test(value)) v.err('bad-id', at, `an emitted name is lower_snake_case (or "plugin:event" for the base bus), got "${value}"`);
  if (verb === 'call' && typeof value === 'string') {
    v.calls.add(value);
    if (v.actions && !v.actions.includes(value)) v.err('unknown-action', at, `the game has no action "${value}".${hint(value, v.actions)} Actions: ${v.actions.join(', ') || 'none'}.`);
  }
}

function checkVarStep(v, step, verb, path) {
  const start = checkVar(v, step[verb], `${path}.${verb}`);
  if (verb === 'set' && 'to' in step) {
    if (!['boolean', 'number', 'string'].includes(typeof step.to)) v.err('bad-value', `${path}.to`, `"to" must be true/false, a number or a string, got ${JSON.stringify(step.to)}`);
    else if (start !== undefined && typeof step.to !== typeof start) v.err('type-mismatch', `${path}.to`, `variable "${step.set}" is a ${typeof start}, but "to" is ${JSON.stringify(step.to)}`);
  }
  if (verb === 'add') {
    if ('by' in step && !isNum(step.by)) v.err('bad-value', `${path}.by`, `"by" must be a number, got ${JSON.stringify(step.by)}`);
    if (start !== undefined && typeof start !== 'number') v.err('type-mismatch', `${path}.add`, `"add" only works on number variables; "${step.add}" is a ${typeof start}`);
  }
}
