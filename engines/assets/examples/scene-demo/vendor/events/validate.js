// Checks an events file before the game uses it. Never throws: every problem comes back as
// { code, path, message } so a card's check command can print them all at once.
import { ID, TOP_KEYS, AREA_KEYS, TRIGGER_KEYS, SEQUENCE_KEYS, WHEN, MODES, PARTS, RESERVED } from './spec.js';
import { areaShape } from './areas.js';
import { hint } from './suggest.js';
import { checkSteps, checkCondition, checkActor, checkPlace } from './validate-steps.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * validateEvents(data, options?) -> { ok, errors, warnings, stats }
 *   data             the events object (parsed JSON)
 *   options.story    the dialogue engine's story DATA (parsed story.json). With it, quest, objective,
 *                    dialogue and story variable names are checked too.
 *   options.actions  names the game registered for `call` steps (createEvents options.actions keys)
 *   options.lenient  true: unknown story names are warnings, not errors (used when the story's data is not at hand)
 * errors and warnings are lists of { code, path, message }. ok is true when errors is empty.
 */
export function validateEvents(data, options = {}) {
  const errors = []; const warnings = [];
  const v = {
    errors, warnings, story: options.story ?? null, actions: options.actions ?? null,
    areas: new Set(), poiAreas: new Set(), scenes: new Set(), actors: new Set(), sequences: new Set(), triggers: new Set(), vars: {},
    usedAreas: new Set(), usedSequences: new Set(), usedVars: new Set(), calls: new Set(), needsStory: false,
    err(code, path, message) { errors.push({ code, path, message }); },
    warn(code, path, message) { warnings.push({ code, path, message }); },
    storyRef(code, path, message, soft) { (soft && options.lenient ? warnings : errors).push({ code, path, message }); },
  };
  const stats = { areas: 0, triggers: 0, sequences: 0, steps: 0 };
  const done = () => ({ ok: errors.length === 0, errors, warnings, stats });
  if (!isObj(data)) { v.err('bad-file', '', `the events file must be an object, got ${Array.isArray(data) ? 'a list' : typeof data}`); return done(); }

  for (const key of Object.keys(data)) if (!TOP_KEYS.includes(key)) v.err('unknown-key', key, `unknown top-level key "${key}".${hint(key, TOP_KEYS)}`);
  if (typeof data.id !== 'string' || !ID.test(data.id)) v.err('bad-id', 'id', `"id" must be lower_snake_case, got ${JSON.stringify(data.id)}`);
  const player = data.player ?? 'player';
  if (typeof player !== 'string' || !player) v.err('bad-value', 'player', `"player" is the actor id of the player, got ${JSON.stringify(data.player)}`);
  else v.actors.add(player);
  if (data.actors !== undefined) {
    if (!Array.isArray(data.actors) || data.actors.some((a) => typeof a !== 'string' || !a)) v.err('bad-value', 'actors', '"actors" is a list of actor ids (strings)');
    else for (const a of data.actors) v.actors.add(a);
  }

  if (data.scenes !== undefined) {
    if (!Array.isArray(data.scenes) || data.scenes.some((n) => typeof n !== 'string' || !ID.test(n))) v.err('bad-value', 'scenes', '"scenes" is a list of lower_snake_case scene names, for example ["hamlet", "world"]');
    else for (const n of data.scenes) v.scenes.add(n);
  }
  v.checkScene = (name, path) => { if (!v.scenes.has(name)) v.err('unknown-scene', path, `"${name}" is not in "scenes".${hint(name, v.scenes)} List every scene at the top of the file: "scenes": [...]`); };

  if (data.vars !== undefined && !isObj(data.vars)) v.err('bad-value', 'vars', '"vars" is an object of name: starting value');
  for (const [name, value] of Object.entries(isObj(data.vars) ? data.vars : {})) {
    if (!ID.test(name)) v.err('bad-id', `vars.${name}`, `variable names are lower_snake_case, got "${name}"`);
    if (!['boolean', 'number', 'string'].includes(typeof value)) v.err('bad-value', `vars.${name}`, `a variable starts as true/false, a number or a string, got ${JSON.stringify(value)}`);
    else v.vars[name] = value;
  }

  if (data.areas !== undefined && !isObj(data.areas)) v.err('bad-value', 'areas', '"areas" is an object of id: shape');
  for (const [id, area] of Object.entries(isObj(data.areas) ? data.areas : {})) {
    const path = `areas.${id}`; stats.areas += 1;
    if (!ID.test(id)) v.err('bad-id', path, `area ids are lower_snake_case, got "${id}"`);
    if (RESERVED.includes(id)) v.err('bad-id', path, `"${id}" is a reserved word and cannot be an area id`);
    if (v.actors.has(id)) v.err('duplicate-id', path, `"${id}" is both an area and an actor; rename one`);
    v.areas.add(id);
    if (!isObj(area)) { v.err('bad-area', path, `an area is { x, y, radius }, { x, y, w, h } or { points }, got ${JSON.stringify(area)}`); continue; }
    for (const key of Object.keys(area)) if (!AREA_KEYS.includes(key)) v.err('unknown-key', `${path}.${key}`, `unknown key "${key}" in an area.${hint(key, AREA_KEYS)}`);
    if ('scene' in area) v.checkScene(area.scene, `${path}.scene`);
    if ('poi' in area) { // stands for every loaded point of interest of that kind
      v.poiAreas.add(id);
      if (typeof area.poi !== 'string' || !area.poi) v.err('bad-area', `${path}.poi`, `"poi" is the name of a kind of place, got ${JSON.stringify(area.poi)}`);
      if ('x' in area || 'y' in area || 'points' in area) v.err('bad-area', path, 'a "poi" area has no x, y or points: it sits on each place of that kind');
      if (!(area.radius > 0) && !(area.w > 0 && area.h > 0)) v.err('bad-area', path, `a "poi" area needs a radius above 0, or w and h above 0, got ${JSON.stringify(area)}`);
      continue;
    }
    const shape = areaShape(area);
    if (shape === 'polygon') {
      if (area.points.length < 3 || area.points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(isNum))) v.err('bad-area', path, '"points" needs three or more [x, y] pairs');
    } else if (shape === 'circle') {
      if (!isNum(area.x) || !isNum(area.y) || !(area.radius > 0)) v.err('bad-area', path, `a circle needs numbers x, y and a radius above 0, got ${JSON.stringify(area)}`);
    } else if (shape === 'box') {
      if (!isNum(area.x) || !isNum(area.y) || !(area.w > 0) || !(area.h > 0)) v.err('bad-area', path, `a box needs numbers x, y and w, h above 0, got ${JSON.stringify(area)}`);
    } else v.err('bad-area', path, `an area is { x, y, radius }, { x, y, w, h } or { points }, got ${JSON.stringify(area)}`);
  }

  const sequences = isObj(data.sequences) ? data.sequences : {};
  if (data.sequences !== undefined && !isObj(data.sequences)) v.err('bad-value', 'sequences', '"sequences" is an object of id: { steps: [...] }');
  for (const id of Object.keys(sequences)) v.sequences.add(id);
  const triggers = Array.isArray(data.triggers) ? data.triggers : [];
  if (data.triggers !== undefined && !Array.isArray(data.triggers)) v.err('bad-value', 'triggers', '"triggers" is a list');
  for (const t of triggers) if (isObj(t) && typeof t.id === 'string') v.triggers.add(t.id);

  const runsOf = new Map(); // sequence id -> ids of the sequences it runs
  for (const [id, seq] of Object.entries(sequences)) {
    const path = `sequences.${id}`; stats.sequences += 1;
    if (!ID.test(id)) v.err('bad-id', path, `sequence ids are lower_snake_case, got "${id}"`);
    if (!isObj(seq)) { v.err('bad-sequence', path, `a sequence is { "steps": [...] }, got ${JSON.stringify(seq)?.slice(0, 60)}`); continue; }
    for (const key of Object.keys(seq)) if (!SEQUENCE_KEYS.includes(key)) v.err('unknown-key', `${path}.${key}`, `unknown key "${key}" in a sequence.${hint(key, SEQUENCE_KEYS)}`);
    if ('mode' in seq && !MODES.includes(seq.mode)) v.err('bad-value', `${path}.mode`, `"mode" is one of ${MODES.join(', ')}, got ${JSON.stringify(seq.mode)}.${hint(seq.mode, MODES)}`);
    for (const key of ['skippable', 'bars']) if (key in seq && typeof seq[key] !== 'boolean') v.err('bad-value', `${path}.${key}`, `"${key}" must be true or false, got ${JSON.stringify(seq[key])}`);
    const runs = new Set(); runsOf.set(id, runs);
    checkSteps(v, seq.steps, `${path}.steps`, runs);
    stats.steps += Array.isArray(seq.steps) ? seq.steps.length : 0;
  }
  // a sequence that runs itself, directly or through others, would never end
  for (const start of runsOf.keys()) {
    const seen = new Set(); const stack = [[start, [start]]];
    while (stack.length) {
      const [id, trail] = stack.pop();
      for (const next of runsOf.get(id) ?? []) {
        if (next === start) { v.err('run-loop', `sequences.${start}`, `sequence "${start}" runs itself: ${[...trail, start].join(' -> ')}`); stack.length = 0; break; }
        if (!seen.has(next)) { seen.add(next); stack.push([next, [...trail, next]]); }
      }
    }
  }

  const seen = new Set();
  triggers.forEach((t, i) => {
    const path = `triggers[${i}]`; stats.triggers += 1;
    if (!isObj(t)) return v.err('bad-trigger', path, `a trigger is an object with "id", "when" and "run" or "do", got ${JSON.stringify(t)}`);
    for (const key of Object.keys(t)) if (!TRIGGER_KEYS.includes(key)) v.err('unknown-key', `${path}.${key}`, `unknown key "${key}" in a trigger.${hint(key, TRIGGER_KEYS)}`);
    if (typeof t.id !== 'string' || !ID.test(t.id)) v.err('bad-id', `${path}.id`, `trigger ids are lower_snake_case, got ${JSON.stringify(t.id)}`);
    else if (seen.has(t.id)) v.err('duplicate-id', `${path}.id`, `two triggers are called "${t.id}"`);
    seen.add(t.id);
    checkWhen(v, t.when, `${path}.when`);
    if ('if' in t) checkCondition(v, t.if, `${path}.if`);
    for (const key of ['repeat', 'enabled']) if (key in t && typeof t[key] !== 'boolean') v.err('bad-value', `${path}.${key}`, `"${key}" must be true or false, got ${JSON.stringify(t[key])}`);
    if ('cooldown' in t && !(isNum(t.cooldown) && t.cooldown >= 0)) v.err('bad-value', `${path}.cooldown`, `"cooldown" is a number of seconds, got ${JSON.stringify(t.cooldown)}`);
    if ('cooldown' in t && t.repeat !== true) v.warn('cooldown-without-repeat', path, '"cooldown" does nothing unless "repeat" is true');
    if ('prompt' in t && typeof t.prompt !== 'string') v.err('bad-value', `${path}.prompt`, `"prompt" is the text shown to the player, got ${JSON.stringify(t.prompt)}`);
    if ('prompt' in t && !(isObj(t.when) && 'interact' in t.when)) v.warn('prompt-without-interact', path, '"prompt" is only shown for an "interact" trigger');
    if ('scene' in t) v.checkScene(t.scene, `${path}.scene`);
    if ('each' in t) {
      const place = isObj(t.when) ? (t.when.enter ?? t.when.inside ?? t.when.interact) : undefined;
      if (typeof t.each !== 'boolean') v.err('bad-value', `${path}.each`, `"each" must be true or false, got ${JSON.stringify(t.each)}`);
      else if (t.each && !v.poiAreas.has(place)) v.err('bad-trigger', `${path}.each`, '"each": true only works with "enter", "inside" or "interact" on a "poi" area (it fires once per place)');
      if (t.each && t.repeat) v.warn('each-with-repeat', path, '"repeat" does nothing next to "each": the trigger fires once for each place');
    }
    if (('run' in t) === ('do' in t)) v.err('bad-trigger', path, 'a trigger needs exactly one of "run" (a sequence id) or "do" (a list of steps)');
    else if ('run' in t) {
      if (!v.sequences.has(t.run)) v.err('unknown-sequence', `${path}.run`, `there is no sequence "${t.run}".${hint(t.run, v.sequences)}`);
      else v.usedSequences.add(t.run);
    } else { checkSteps(v, t.do, `${path}.do`, new Set()); stats.steps += Array.isArray(t.do) ? t.do.length : 0; }
  });

  for (const id of v.sequences) if (!v.usedSequences.has(id)) v.warn('unused-sequence', `sequences.${id}`, `nothing runs sequence "${id}" (fine if game code starts it with events.run)`);
  for (const id of v.areas) if (!v.usedAreas.has(id)) v.warn('unused-area', `areas.${id}`, `area "${id}" is never used`);
  for (const name of Object.keys(v.vars)) if (!v.usedVars.has(name)) v.warn('unused-var', `vars.${name}`, `variable "${name}" is never used`);
  if (v.needsStory && !v.story && !options.lenient) v.warn('needs-story', '', 'this file uses quests or dialogues; pass the story data (options.story) so their names are checked too');
  return done();
}

function checkWhen(v, when, path) {
  if (!isObj(when)) return v.err('bad-trigger', path, `"when" is an object such as { "enter": "area_id" }, got ${JSON.stringify(when)}`);
  const kinds = Object.keys(when).filter((k) => Object.hasOwn(WHEN, k));
  if (kinds.length !== 1) {
    const guess = Object.keys(when).map((k) => hint(k, Object.keys(WHEN))).find(Boolean) ?? '';
    return v.err('bad-trigger', path, `"when" needs exactly one of: ${Object.keys(WHEN).join(', ')}; got keys ${JSON.stringify(Object.keys(when))}.${guess}`);
  }
  const kind = kinds[0]; const spec = WHEN[kind]; const value = when[kind]; const at = `${path}.${kind}`;
  for (const key of Object.keys(when)) if (key !== kind && !spec.extra.includes(key)) v.err('unknown-key', `${path}.${key}`, `unknown key "${key}" in a "${kind}" trigger.${hint(key, spec.extra)}`);
  if (spec.value === 'true') { if (value !== true) v.err('bad-value', at, `write "${kind}": true, got ${JSON.stringify(value)}`); }
  else if (spec.value === 'place') checkPlace(v, value, at);
  else if (spec.value === 'hour') { if (!isNum(value) || value < 0 || value >= 24) v.err('bad-value', at, `an hour is a number from 0 up to (not including) 24, got ${JSON.stringify(value)}`); }
  else if (spec.value === 'part') { if (!PARTS.includes(value)) v.err('bad-value', at, `expected one of ${PARTS.join(', ')}, got ${JSON.stringify(value)}.${hint(value, PARTS)}`); }
  else if (spec.value === 'name') { if (typeof value !== 'string' || !value) v.err('bad-value', at, `expected a name (a string), got ${JSON.stringify(value)}`); }
  else if (spec.value === 'scene') v.checkScene(value, at);
  else if (spec.value === 'sequence') { if (!v.sequences.has(value)) v.err('unknown-sequence', at, `there is no sequence "${value}".${hint(value, v.sequences)}`); }
  else if (spec.value === 'quest') { v.needsStory = true; if (typeof value !== 'string' || !value) v.err('bad-value', at, `expected a quest id, got ${JSON.stringify(value)}`); else if (v.story && !Object.hasOwn(v.story.quests ?? {}, value)) v.err('unknown-quest', at, `the story has no quest "${value}".${hint(value, Object.keys(v.story.quests ?? {}))}`); }
  else if (spec.value === 'objective') {
    v.needsStory = true;
    if (typeof value !== 'string' || !/^[^.]+\.[^.]+$/.test(value)) v.err('bad-value', at, `expected "quest_id.objective_id", got ${JSON.stringify(value)}`);
    else if (v.story) { const [q, o] = value.split('.'); const ids = (v.story.quests?.[q]?.objectives ?? []).map((x) => x.id); if (!ids.includes(o)) v.err('unknown-objective', at, `the story has no objective "${value}".${hint(o, ids)}`); }
  } else if (spec.value === 'dialogue') { v.needsStory = true; if (typeof value !== 'string' || !value) v.err('bad-value', at, `expected a dialogue id, got ${JSON.stringify(value)}`); else if (v.story && !Object.hasOwn(v.story.dialogues ?? {}, value)) v.err('unknown-dialogue', at, `the story has no dialogue "${value}".${hint(value, Object.keys(v.story.dialogues ?? {}))}`); }
  if ('who' in when) checkActor(v, when.who, `${path}.who`);
  if ('reach' in when && !(isNum(when.reach) && when.reach > 0)) v.err('bad-value', `${path}.reach`, `"reach" must be a number above 0, got ${JSON.stringify(when.reach)}`);
  if ('for' in when && !(isNum(when.for) && when.for >= 0)) v.err('bad-value', `${path}.for`, `"for" is a number of seconds, got ${JSON.stringify(when.for)}`);
  if ('match' in when && !isObj(when.match)) v.err('bad-value', `${path}.match`, `"match" is an object of fields the event must carry, got ${JSON.stringify(when.match)}`);
}

/** formatReport(report) -> string: one line per problem and a summary line, for the terminal. */
export function formatReport(report) {
  const lines = [];
  for (const e of report.errors) lines.push(`ERROR ${e.code} at ${e.path || '(file)'}: ${e.message}`);
  for (const w of report.warnings) lines.push(`warning ${w.code} at ${w.path || '(file)'}: ${w.message}`);
  const s = report.stats ?? {};
  lines.push(`${report.ok ? 'OK' : 'INVALID'}: ${report.errors.length} error(s), ${report.warnings.length} warning(s); ${s.areas ?? 0} areas, ${s.triggers ?? 0} triggers, ${s.sequences ?? 0} sequences, ${s.steps ?? 0} steps`);
  return lines.join('\n');
}
