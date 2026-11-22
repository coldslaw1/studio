// The animator: a base state machine plus optional layers (for example an upper-body attack
// over a walk), shared parameters and triggers, and events for game code.
import { bindClip } from './clip.js';
import { createMachine } from './machine.js';
import { blendPose, addPose } from './rig.js';
import { clamp } from './math.js';

/**
 * @param {object} rig  From createRig.
 * @param {object} def
 * @param {Object<string,object>} def.clips  Clip descriptions by name (see bindClip).
 * @param {Object<string,object>} def.states  State name to one of:
 *   { clip: 'walk', loop?, speed?, next?, fade? }            play one clip
 *   { blend: { param: 'speed', points: [[0, 'idle'], [1, 'walk'], [2, 'run']] }, speed? }   mix clips by a parameter, in step
 *   {}                                                        play nothing (useful as the resting state of a layer)
 *   speed is a number or { param, scale } (playback rate from a parameter). next = state to go to when a non-looping clip ends.
 * @param {object[]} [def.transitions]  { from?: name | names | '*', to, when?, fade?: seconds, ease?: name }.
 *   `when` is { param, gt|gte|lt|lte|eq|ne }, { param } (truthy), { trigger }, { done: true }, { after: seconds },
 *   { all: [...] }, { any: [...] }, { not: cond }, or a function (params, state) => boolean. Checked in order each update.
 * @param {string} [def.initial]  First state (default: the first one listed).
 * @param {object[]} [def.layers]  { name, mask: [boneNames], mode?: 'override'|'add', weight?, states, transitions?, initial? }.
 *   A layer only moves the masked bones (each name includes the bones below it).
 * @param {object} [def.params]  Starting parameter values.
 * @returns {object} animator
 */
export function createAnimator(rig, def) {
  if (!def || typeof def.clips !== 'object' || typeof def.states !== 'object') throw new Error('createAnimator: needs "clips" and "states"');
  const clips = Object.fromEntries(Object.entries(def.clips).map(([name, c]) => [name, bindClip(rig, { name, ...c })]));
  const shared = { params: { ...(def.params ?? {}) }, triggers: new Set() };
  const base = createMachine(rig, clips, def, shared, 'createAnimator');
  const layers = (def.layers ?? []).map((l, i) => {
    if (!l.name || !Array.isArray(l.mask)) throw new Error(`createAnimator: layers[${i}] needs a "name" and a "mask" list of bone names`);
    if (l.mode && l.mode !== 'override' && l.mode !== 'add') throw new Error(`createAnimator: layer "${l.name}": mode must be "override" or "add", got "${l.mode}"`);
    return { name: l.name, mask: rig.mask(l.mask), mode: l.mode ?? 'override', weight: l.weight ?? 1, machine: createMachine(rig, clips, l, shared, `createAnimator layer "${l.name}"`), pose: rig.createPose() };
  });
  const layerNamed = (name, who) => {
    const l = layers.find((x) => x.name === name);
    if (!l) throw new Error(`${who}: no layer named "${name}". Layers: ${layers.map((x) => x.name).join(', ') || 'none'}`);
    return l;
  };
  const listeners = new Map();
  const pose = rig.createPose();
  base.output(pose);

  const animator = {
    rig,
    /** The blended pose after the last update. Hand it to puppet.update(dt, animator.pose). */
    pose,
    /** Bound clips by name (duration, meta, events). */
    clips,
    /** Parameters read by transitions and blends. Set them directly or with set(). */
    params: shared.params,
    /** Name of the base machine's current state. */
    get state() { return base.state; },
    /** Seconds spent in the current base state. */
    get age() { return base.age; },
    /** Current state of a layer. */
    layerState(name) { return layerNamed(name, 'animator.layerState').machine.state; },
    set(name, value) { shared.params[name] = value; return animator; },
    /** Raise a one-shot signal for `{ trigger: name }` conditions. It is dropped at the end of the next update if nothing used it. */
    trigger(name) { shared.triggers.add(name); return animator; },
    /** Jump to a state now. opts: { fade: seconds (default 0.15), ease, layer: name }. */
    play(state, opts = {}) {
      const m = opts.layer ? layerNamed(opts.layer, 'animator.play').machine : base;
      const events = [];
      m.go(state, opts.fade ?? 0.15, opts.ease ?? 'inOut', events);
      emit(events);
      return animator;
    },
    /** Set how strongly a layer shows, 0..1. */
    setLayerWeight(name, weight) { layerNamed(name, 'animator.setLayerWeight').weight = clamp(weight, 0, 1); return animator; },
    /**
     * Listen for events: clip events by their name, "enter:<state>", "exit:<state>", "done:<state>",
     * or "*" for everything. Returns a function that removes the listener.
     */
    on(name, fn) {
      if (typeof fn !== 'function') throw new Error(`animator.on("${name}"): the listener must be a function`);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    /**
     * Advance by dt seconds and rebuild animator.pose.
     * @returns {string[]} Events that happened during this step, in order.
     */
    update(dt) {
      if (!(dt >= 0)) throw new Error(`animator.update: dt must be seconds >= 0, got ${dt}`);
      const events = [];
      base.update(dt, events);
      for (const l of layers) l.machine.update(dt, events);
      base.output(pose);
      for (const l of layers) {
        const w = l.machine.output(l.pose) * l.weight;
        if (w <= 0) continue;
        if (l.mode === 'add') addPose(pose, pose, l.pose, w, l.mask);
        else blendPose(pose, pose, l.pose, w, l.mask);
      }
      shared.triggers.clear();
      emit(events);
      return events;
    },
  };
  function emit(events) {
    for (const e of events) {
      for (const fn of listeners.get(e) ?? []) fn(e, animator);
      for (const fn of listeners.get('*') ?? []) fn(e, animator);
    }
  }
  return animator;
}
