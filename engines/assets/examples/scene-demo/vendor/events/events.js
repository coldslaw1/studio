// createEvents: the director. It watches the triggers, runs sequences step by step, keeps the
// cutscene's picture state (fade, bars, caption, camera shot) and tells the game what happens.
import { validateEvents, formatReport } from './validate.js';
import { createToolbox } from './world.js';
import { createTriggers } from './triggers.js';
import { listTask, together } from './tasks.js';
import { makeStep } from './steps.js';
import { createStage, stageView } from './stage.js';

/**
 * createEvents(data, options?) -> events        Throws when the data has mistakes.
 * options (all optional):
 *   actors     where actors are found: an object or Map of id -> { x, y }, anything with get(id) (the base's
 *              actors), or a function (id) => actor. The player is the actor called data.player ('player').
 *   story      the dialogue engine's story (createStory). Quest steps, quest conditions and quest triggers use it.
 *   storyData  the story's JSON, so quest and dialogue names are checked when the events are made.
 *   playerId   the game's id of the player's actor when it is not the file's "player" (the base's 'hero')
 *   scene      the scene the game starts in, for files that use "scenes"
 *   clock      the day clock: { hour, part?, setHour(h) } (the base's time, or the sky engine).
 *   actions    { name(args, events, info) } for `call` steps. Return seconds to wait, a task { update(dt) }, or nothing.
 *   drivers    how steps reach the rest of the game; see README "Drivers". All optional.
 *   walkSpeed (1.5 units/s), charsPerSecond (45; 0 shows a line at once), skipHold (0.6 s), personalSpace (0.2)
 *   inputActions  { confirm: 'confirm', skip: 'cancel', interact: 'interact' }
 *   validate   false skips the check (not advised).
 */
export function createEvents(data, options = {}) {
  if (options.validate !== false) {
    const report = validateEvents(data, { story: options.storyData, actions: options.actions ? Object.keys(options.actions) : null, lenient: !!options.story && !options.storyData });
    if (!report.ok) throw new Error(`createEvents: the events data has mistakes:\n${formatReport(report)}`);
  }
  const listeners = new Map();
  const unhandled = new Set();
  const keys = { confirm: 'confirm', skip: 'cancel', interact: 'interact', ...(options.inputActions ?? {}) };
  const skipHold = options.skipHold ?? 0.6;
  let runs = []; let queue = []; let cleanup = null; let wasBusy = false;
  let skipHeld = 0; let skipArmed = false; let triggers = null;

  const emit = (type, payload = {}) => {
    const event = { type, ...payload };
    for (const key of [type, '*']) for (const fn of (listeners.get(key) ?? []).slice()) fn(event);
  };
  const e = createToolbox(data, options, {
    emit,
    unhandled(verb) { if (!unhandled.has(verb)) { unhandled.add(verb); emit('unhandled', { verb }); } },
    notify: (kind, value, payload) => triggers.notify(kind, value, payload),
    fired: (id) => triggers.fired(id),
    setEnabled: (id, on) => triggers.setEnabled(id, on),
    timeJumped: () => triggers.timeJumped(),
  });
  const stage = e.stage = createStage();
  triggers = createTriggers(data.triggers ?? [], e);
  const cutsceneRun = () => runs.find((r) => r.mode === 'cutscene') ?? null;

  const stepsOf = (id) => (id.startsWith('trigger:') ? { steps: triggers.get(id.slice(8))?.do, mode: 'background', seq: {} } : { steps: data.sequences?.[id]?.steps, mode: data.sequences?.[id]?.mode ?? 'cutscene', seq: data.sequences?.[id] });
  function begin(id, steps, mode, seq, resume) {
    if (mode === 'cutscene' && !resume) {
      if (cutsceneRun()) { queue.push(id); return false; }
      cleanup = null;
    }
    const c = { e, mode, skipping: false, advance: false, side: [] };
    const run = { id, mode, seq, c, done: !!resume?.done, skipped: false, task: listTask(steps, c, makeStep, resume?.at) };
    runs.push(run);
    if (resume) { // a loaded game: carry on where the save was made, with the background steps that were still going
      for (const step of resume.side ?? []) { const task = makeStep(step, c); if (task) { task.step = step; c.side.push(task); } }
      emit('sequenceResumed', { id, mode });
      return true;
    }
    emit('sequenceStarted', { id, mode });
    if (mode === 'cutscene' && seq.bars !== false) { const bars = makeStep({ bars: 'on' }, c); bars.step = { bars: 'on' }; c.side.push(bars); }
    return true;
  }
  /** Leave the screen as the game expects it, whatever a sequence forgot to undo. */
  function tidy() {
    const c = { e, mode: 'background', skipping: false, advance: false, side: [] };
    const steps = [];
    if (stage.fade.alpha > 0) steps.push({ fade: 'in', time: 0.3 });
    if (stage.bars > 0) steps.push({ bars: 'off', time: 0.3 });
    if (stage.shot.active) steps.push({ camera: 'release', time: 0.4 });
    cleanup = steps.length ? together(steps.map((step) => () => makeStep(step, c))) : null;
  }
  function end(run) {
    emit('sequenceEnded', { id: run.id, mode: run.mode, skipped: run.skipped });
    triggers.notify('sequenceEnded', run.id);
    if (run.mode !== 'cutscene') return;
    stage.caption = null;
    if (queue.length) { const next = queue.shift(); begin(next, e.sequence(next).steps, 'cutscene', e.sequence(next)); return; }
    tidy();
  }
  function start(id) {
    const seq = e.sequence(id);
    return begin(id, seq.steps, seq.mode ?? 'cutscene', seq);
  }
  function fire(t, key = '') {
    triggers.fire(t, key);
    emit('trigger', { id: t.id, ...(key ? { place: key } : {}) });
    if (t.run) start(t.run); else begin(`trigger:${t.id}`, t.do, 'background', {});
  }
  const trigger = (id, who) => { const t = triggers.get(id); if (!t) throw new Error(`${who}: there is no trigger "${id}"`); return t; };

  const events = {
    data, unhandled,
    /** Advance by dt seconds. Pass the input (core's shape) to let the engine read confirm, skip and interact itself. */
    update(dt, input) {
      if (!(dt >= 0)) throw new Error(`events.update: dt must be seconds >= 0, got ${dt}`);
      if (input) { if (events.busy) events.cutsceneInput(input, dt); else events.worldInput(input); }
      for (const f of triggers.update(dt, !cutsceneRun())) fire(f.trigger, f.key);
      for (let i = 0; i < runs.length; i += 1) { // runs begun during this loop are updated too
        const run = runs[i]; const c = run.c;
        if (!run.done) run.done = run.task.update(dt);
        c.side = c.side.filter((task) => !task.update(dt));
        c.advance = false;
        if (run.done && c.side.length === 0) { runs.splice(i, 1); i -= 1; end(run); }
      }
      if (cleanup && cleanup.update(dt)) cleanup = null;
      const follow = stage.shot.follow && e.actor(stage.shot.follow);
      if (follow) { stage.shot.x = follow.x; stage.shot.y = follow.y; }
      if (events.busy !== wasBusy) { wasBusy = events.busy; skipHeld = 0; skipArmed = false; emit('cutscene', { active: wasBusy, id: events.cutscene }); }
    },
    /** While a cutscene runs: confirm (or a tap) moves a line on, skip held for options.skipHold seconds skips. */
    cutsceneInput(input, dt = 0) {
      if (input.pressed(keys.confirm) || input.pointer?.pressed) events.advance();
      if (input.pressed(keys.skip)) skipArmed = true; // a key held from before the scene does not count
      if (skipArmed && input.down(keys.skip)) { skipHeld += dt; if (skipHeld >= skipHold) { skipHeld = 0; skipArmed = false; events.skip(); } } else { skipHeld = 0; skipArmed = false; }
    },
    /** While the player walks around: the interact key fires the nearest interact trigger. */
    worldInput(input) { if (input.pressed(keys.interact)) events.interact(); },
    /** Start a sequence by id. A cutscene asked for while another runs waits its turn. Returns true when it started now. */
    run(id) { return start(id); },
    /** Fire a trigger by hand, whatever its `when` and `if` say. */
    fire(id) { fire(trigger(id, 'events.fire')); },
    /** Move the shown line on (finish typing it first). Returns true when a line was there. */
    advance() { const run = cutsceneRun(); if (!run || !stage.caption || stage.caption.bark) return false; run.c.advance = true; return true; },
    /** Skip the running cutscene: every step left is applied at once. Stops at a `dialogue` step. Returns true when it skipped. */
    skip() {
      const run = cutsceneRun();
      if (!run || run.seq.skippable === false) return false;
      const c = run.c;
      c.skipping = true;
      const whole = run.task.finish() !== false;
      c.side = c.side.filter((task) => task.finish() === false);
      c.skipping = false; run.skipped = true;
      if (whole) run.done = true;
      stage.caption = null;
      emit('skipped', { id: run.id, whole });
      return true;
    },
    /** The player pressed interact: fire the nearest interact trigger in reach. Returns its id, or null. */
    interact() {
      if (cutsceneRun()) return null;
      const found = triggers.interactable();
      if (!found) return null;
      fire(found.trigger, found.key);
      return found.trigger.id;
    },
    /** The nearest thing the player could interact with now: { id, text, x, y, distance }, or null. Draw a hint from it. */
    prompt() {
      if (cutsceneRun()) return null;
      const found = triggers.interactable();
      return found ? { id: found.trigger.id, text: found.trigger.prompt ?? 'Interact', x: found.x, y: found.y, distance: found.distance } : null;
    },
    /** Tell the engine something happened in the game: triggers with { "event": name } hear it. */
    notify(name, payload) { triggers.notify('event', name, payload); },
    /**
     * Open worlds: tell the engine where a point of interest is, as the world streams in. Areas written
     * { "poi": "tower", "radius": 6 } then exist at every place added under 'tower'. `key` names the place
     * (the same every time that place loads, for example "tx,ty"), so "each" triggers remember it.
     */
    addPlace(poi, key, at) {
      if (typeof poi !== 'string' || !poi) throw new Error(`events.addPlace: poi must be a name, got ${JSON.stringify(poi)}`);
      if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error(`events.addPlace: place "${poi}" needs numbers for x and y, got ${JSON.stringify(at)}`);
      if (!e.places.has(poi)) e.places.set(poi, new Map());
      e.places.get(poi).set(String(key), { x: at.x, y: at.y });
    },
    /** The place streamed out again. Returns true when it was there. */
    removePlace(poi, key) { return e.places.get(poi)?.delete(String(key)) ?? false; },
    /** Loaded places of one kind: [{ key, x, y }]. */
    places: (poi) => [...(e.places.get(poi) ?? [])].map(([key, at]) => ({ key, ...at })),
    /** Which scene the player is in ('hamlet', 'world' ...). Areas and triggers with a "scene" only live in theirs. */
    get scene() { return e.scene(); },
    setScene(name) {
      if (name !== null && data.scenes && !data.scenes.includes(name)) throw new Error(`events.setScene: "${name}" is not in "scenes" (${data.scenes.join(', ')})`);
      if (e.setScene(name) !== name && name !== null) triggers.notify('scene', name);
    },
    /** Call after setting the clock by hand, so the jump is not read as hours passing. */
    timeJumped() { triggers.timeJumped(); },
    /** True while a cutscene has the screen (the player has no control). */
    get busy() { return !!cutsceneRun() || queue.length > 0; },
    /** The id of the running cutscene, or null. */
    get cutscene() { return cutsceneRun()?.id ?? null; },
    /** Ids of everything running now, cutscene and background. */
    running: () => runs.map((r) => r.id),
    /** The cutscene shot: { active, x, y, zoom, yaw, pitch, height, distance, follow, pov, shakeX, shakeY }. The game's camera obeys it while active. */
    get shot() { return stage.shot; },
    /** Plain data for drawing and tests: { cutscene, busy, fade, fadeColor, bars, caption, shot, skip, prompt, running }. */
    view() { return stageView(stage, { cutscene: events.cutscene, busy: events.busy, skip: skipHold > 0 ? Math.min(1, skipHeld / skipHold) : 0, prompt: events.prompt(), running: events.running(), scene: e.scene() }); },
    getVar: (name) => e.getVar(name),
    setVar: (name, value) => e.setVar(name, value),
    check: (condition) => e.check(condition),
    enable(id) { triggers.setEnabled(id, true); },
    disable(id) { triggers.setEnabled(id, false); },
    /** How many times a trigger has fired. */
    fired: (id) => triggers.fired(id),
    /** Listen: fn({ type, ... }). '*' hears everything. Returns a function that stops listening. */
    on(type, fn) {
      if (typeof fn !== 'function') throw new Error(`events.on: listener for "${type}" must be a function, got ${typeof fn}`);
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      return () => { const list = listeners.get(type); const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
    },
    /**
     * Plain JSON of all progress, also of what is running: a save made in the middle of a cutscene
     * carries on from the step that was playing (that one step starts again; nothing before it repeats).
     */
    save() {
      const out = { v: 2, vars: e.vars(), triggers: triggers.save(), ...(e.scene() !== null ? { scene: e.scene() } : {}) };
      if (runs.length || queue.length) {
        out.runs = runs.map((r) => ({ id: r.id, done: r.done, at: r.done ? null : r.task.position(), side: r.c.side.map((t) => t.step).filter(Boolean) }));
        out.queue = [...queue];
      }
      const { fade, bars, shot } = stage;
      if (fade.alpha > 0 || bars > 0 || shot.active) out.stage = { fade: { ...fade }, bars, shot: { ...shot, shakeX: 0, shakeY: 0 } };
      return out;
    },
    load(saved) {
      if (!saved || typeof saved !== 'object' || (saved.v !== 1 && saved.v !== 2)) throw new Error(`events.load: expected data from events.save(), got ${JSON.stringify(saved)?.slice(0, 80)}`);
      events.stop();
      e.loadVars(saved.vars);
      triggers.load(saved.triggers);
      if (saved.scene !== undefined) e.setScene(saved.scene);
      if (saved.stage) { Object.assign(stage.fade, saved.stage.fade); stage.bars = saved.stage.bars ?? 0; Object.assign(stage.shot, saved.stage.shot); }
      for (const r of saved.runs ?? []) {
        const found = stepsOf(r.id);
        if (Array.isArray(found.steps)) begin(r.id, found.steps, found.mode, found.seq, { at: r.at ?? undefined, done: r.done, side: r.side });
      }
      queue = (saved.queue ?? []).filter((id) => data.sequences?.[id]);
      for (const id of saved.resume ?? []) if (data.sequences?.[id]) start(id); // version 1 saves replayed the cutscene
      if (!cutsceneRun() && !queue.length) tidy();
    },
    /** Stop everything that runs and clear the screen state. Progress (vars, fired triggers) is kept. */
    stop() {
      runs = []; queue = []; cleanup = null; skipHeld = 0; skipArmed = false;
      Object.assign(stage, createStage());
      e.stage = stage;
    },
    /** Back to a new game. */
    reset() { events.stop(); e.loadVars({}); triggers.reset(); e.setScene(options.scene ?? null); },
  };
  e.api = events;
  if (e.story && typeof e.story.on === 'function') {
    e.story.on('*', (ev) => {
      if (ev.type === 'questStarted' || ev.type === 'questDone' || ev.type === 'questFailed') triggers.notify(ev.type, ev.quest);
      else if (ev.type === 'objectiveDone') triggers.notify('objectiveDone', `${ev.quest}.${ev.objective}`);
      else if (ev.type === 'dialogueEnded') triggers.notify('dialogueEnded', ev.dialogue);
      else if (ev.type === 'event') triggers.notify('storyEvent', ev.name);
    });
  }
  return events;
}
