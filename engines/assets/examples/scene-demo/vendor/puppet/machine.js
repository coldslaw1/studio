// One animation state machine: states that play a clip (or blend several by a parameter),
// transitions with conditions, and cross-fades between states. createAnimator stacks these.
import { blendPose, copyPose } from './rig.js';
import { clamp, ease } from './math.js';

const OPS = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, eq: (a, b) => a === b, ne: (a, b) => a !== b };

/**
 * @param {object} rig
 * @param {Object<string,object>} clips  Bound clips by name (from bindClip).
 * @param {{states:object, transitions?:object[], initial?:string}} def
 * @param {{params:object, triggers:Set<string>}} shared
 * @param {string} [label]  Used in error messages.
 */
export function createMachine(rig, clips, def, shared, label = 'animator') {
  const states = def.states ?? {};
  const names = Object.keys(states);
  if (!names.length) throw new Error(`${label}: "states" must have at least one state`);
  const clipOf = (name, state) => { if (!clips[name]) throw new Error(`${label}: state "${state}" uses unknown clip "${name}". Clips: ${Object.keys(clips).join(', ')}`); return clips[name]; };
  for (const [name, s] of Object.entries(states)) {
    if (s.clip) clipOf(s.clip, name);
    if (s.blend) {
      if (!Array.isArray(s.blend.points) || s.blend.points.length < 2 || typeof s.blend.param !== 'string') throw new Error(`${label}: state "${name}": blend needs "param" and at least two "points" as [value, clipName]`);
      s.blend.points.forEach(([, c]) => clipOf(c, name));
    }
    if (s.next && !states[s.next]) throw new Error(`${label}: state "${name}" has next "${s.next}", which is not a state`);
  }
  const transitions = def.transitions ?? [];
  transitions.forEach((t, i) => {
    if (!states[t.to]) throw new Error(`${label}: transitions[${i}] goes to unknown state "${t.to}"`);
    for (const f of [].concat(t.from ?? '*')) if (f !== '*' && !states[f]) throw new Error(`${label}: transitions[${i}] comes from unknown state "${f}"`);
  });
  const initial = def.initial ?? names[0];
  if (!states[initial]) throw new Error(`${label}: initial state "${initial}" is not a state`);

  const enter = (name) => ({ name, def: states[name], t: 0, phase: 0, done: false, age: 0 });
  const poseA = rig.createPose(); const poseB = rig.createPose(); const temp = rig.createPose(); const frozen = rig.createPose();
  let cur = enter(initial);
  let prev = null; // { ...runtime } still playing, or { frozen: true, weight }
  let fade = null; // { t, dur, ease }

  const rateOf = (s) => (typeof s.speed === 'number' ? s.speed : s.speed ? (shared.params[s.speed.param] ?? 0) * (s.speed.scale ?? 1) : 1);

  /** Blend-state weights: [[clip, weight], [clip, weight]] for the current parameter value. */
  function bracket(blend) {
    const pts = blend.points;
    const x = clamp(shared.params[blend.param] ?? 0, pts[0][0], pts[pts.length - 1][0]);
    let i = 0;
    while (i < pts.length - 2 && x > pts[i + 1][0]) i++;
    const k = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0] || 1);
    return [[clips[pts[i][1]], 1 - k], [clips[pts[i + 1][1]], k]];
  }

  function advance(rt, dt, events) {
    const s = rt.def;
    rt.age += dt;
    if (s.clip) {
      const c = clips[s.clip];
      const loop = s.loop ?? c.loop;
      const t0 = rt.t;
      rt.t += dt * rateOf(s);
      if (!loop && rt.t >= c.duration) rt.t = c.duration;
      if (events) for (const e of c.eventsBetween(t0, rt.t, loop)) events.push(e);
      if (!loop && rt.t >= c.duration && !rt.done) { rt.done = true; if (events) events.push(`done:${rt.name}`); }
    } else if (s.blend) {
      const [[ca, wa], [cb, wb]] = bracket(s.blend);
      const p0 = rt.phase;
      rt.phase += dt * rateOf(s) * (wa / ca.duration + wb / cb.duration);
      const lead = wa >= wb ? ca : cb;
      if (events) for (const e of lead.eventsBetween(p0 * lead.duration, rt.phase * lead.duration, true)) events.push(e);
    }
  }

  /** Write the state's pose; false when the state is empty (plays nothing). */
  function sample(rt, out) {
    const s = rt.def;
    if (s.clip) {
      const c = clips[s.clip];
      const loop = s.loop ?? c.loop;
      const t = loop ? rt.t % c.duration : Math.min(rt.t, c.loop ? c.duration - 1e-6 : c.duration);
      c.apply(out, t, shared.params);
      return true;
    }
    if (s.blend) {
      const [[ca, wa], [cb, wb]] = bracket(s.blend);
      const u = rt.phase % 1;
      if (wb <= 0) ca.apply(out, u * ca.duration, shared.params);
      else if (wa <= 0) cb.apply(out, u * cb.duration, shared.params);
      else { ca.apply(out, u * ca.duration, shared.params); cb.apply(temp, u * cb.duration, shared.params); blendPose(out, out, temp, wb); }
      return true;
    }
    return false;
  }

  function test(c, rt, used) {
    if (c === undefined || c === true) return true;
    if (typeof c === 'function') return Boolean(c(shared.params, rt));
    if (!c || typeof c !== 'object') throw new Error(`${label}: bad transition condition ${JSON.stringify(c)}`);
    if (c.all && !c.all.every((x) => test(x, rt, used))) return false;
    if (c.any && !c.any.some((x) => test(x, rt, used))) return false;
    if (c.not && test(c.not, rt, [])) return false;
    if (c.done && !rt.done) return false;
    if ('after' in c && rt.age < c.after) return false;
    if ('param' in c) {
      const v = shared.params[c.param] ?? 0;
      const ops = Object.keys(OPS).filter((k) => k in c);
      if (!ops.length ? !v : !ops.every((k) => OPS[k](v, c[k]))) return false;
    }
    if ('trigger' in c) { if (!shared.triggers.has(c.trigger)) return false; used.push(c.trigger); }
    return true;
  }

  const machine = {
    /** Name of the current state. */
    get state() { return cur.name; },
    /** Seconds spent in the current state. */
    get age() { return cur.age; },
    /** True while a cross-fade is running. */
    get fading() { return fade !== null; },
    /** Switch state now, cross-fading over `fade` seconds. */
    go(name, fadeTime = 0.15, easeName = 'inOut', events = null) {
      if (!states[name]) throw new Error(`${label}: play("${name}"): no such state. States: ${names.join(', ')}`);
      if (fadeTime > 0) {
        // interrupting a fade: keep what is on screen now as a still pose and fade from that
        if (fade) { const w = machine.output(frozen); prev = { frozen: true, weight: w }; } else prev = cur;
        fade = { t: 0, dur: fadeTime, ease: ease(easeName) };
      } else { prev = null; fade = null; }
      if (events) events.push(`exit:${cur.name}`, `enter:${name}`);
      cur = enter(name);
    },
    update(dt, events = []) {
      for (let hop = 0; hop < 4; hop++) {
        const tr = transitions.find((t) => {
          const from = [].concat(t.from ?? '*');
          if (!(from.includes('*') || from.includes(cur.name))) return false;
          if (t.to === cur.name && !from.includes(cur.name)) return false; // "*" never re-enters the same state
          const used = [];
          if (!test(t.when, cur, used)) return false;
          used.forEach((u) => shared.triggers.delete(u));
          return true;
        });
        if (tr) machine.go(tr.to, tr.fade ?? 0.15, tr.ease ?? 'inOut', events);
        else if (cur.done && cur.def.next) machine.go(cur.def.next, cur.def.fade ?? 0.15, 'inOut', events);
        else break;
      }
      advance(cur, dt, events);
      if (prev && !prev.frozen) advance(prev, dt, null);
      if (fade) { fade.t += dt; if (fade.t >= fade.dur) { fade = null; prev = null; } }
      return events;
    },
    /** Write the machine's pose into `out`. Returns its weight 0..1 (below 1 while fading to or from an empty state). */
    output(out) {
      const wCur = sample(cur, poseA) ? 1 : 0;
      if (!fade || !prev) { if (wCur) copyPose(out, poseA); return wCur; }
      const k = clamp(fade.ease(fade.t / fade.dur), 0, 1);
      const wPrev = prev.frozen ? prev.weight : (sample(prev, poseB) ? 1 : 0);
      const from = prev.frozen ? frozen : poseB;
      if (wCur && wPrev) blendPose(out, from, poseA, k);
      else if (wCur) copyPose(out, poseA);
      else if (wPrev) copyPose(out, from);
      return wPrev + (wCur - wPrev) * k;
    },
  };
  return machine;
}
