// What each step verb does. makeStep(step, c) starts a step and returns its task, or null when
// the step is over at once. `c` is the run's context: { e, mode, skipping, advance, side }.
// `c.e` is the engine's inner toolbox (see world.js). While c.skipping is true the player is
// skipping the cutscene: steps still leave the world in its end state, but show and play nothing.
import { verbOf } from './spec.js';
import { tween, timer, listTask, together, lerp, lerpAngle } from './tasks.js';

const snap = (shot) => ({ x: shot.x, y: shot.y, zoom: shot.zoom, yaw: shot.yaw, pitch: shot.pitch, height: shot.height, distance: shot.distance });
/** The 3D parts of a shot (pitch, height above the ground, distance): null means "the view decides". */
const SPACE = ['pitch', 'height', 'distance'];
const blend = (from, to, k) => (to === null || to === undefined ? null : from === null || from === undefined ? to : lerp(from, to, k));
const angleTo = (ax, ay, bx, by) => (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;

const make = {
  wait: (s) => timer(s.wait),

  fade(s, c) {
    const fade = c.e.stage.fade; const from = fade.alpha; const to = s.fade === 'out' ? 1 : 0;
    if (s.color) fade.color = s.color;
    return tween(s.time ?? 0.5, 'linear', (k) => { fade.alpha = lerp(from, to, k); });
  },

  bars(s, c) {
    const stage = c.e.stage; const from = stage.bars; const to = s.bars === 'on' ? 1 : 0;
    return tween(s.time ?? 0.4, 'inout', (k) => { stage.bars = lerp(from, to, k); });
  },

  camera(s, c) {
    const e = c.e; const shot = e.stage.shot; const time = s.time ?? 1; const easing = s.ease ?? 'inout';
    if (s.camera === 'release') {
      if (!shot.active) return null;
      const from = snap(shot); shot.follow = null; shot.pov = null;
      e.emit('camera', { release: true, time });
      return tween(time, easing, (k) => {
        const now = e.cameraNow();
        shot.x = lerp(from.x, now.x, k); shot.y = lerp(from.y, now.y, k); shot.zoom = lerp(from.zoom, now.zoom ?? 1, k);
        for (const key of SPACE) if (from[key] !== null && now[key] !== null) shot[key] = lerp(from[key], now[key], k);
        if (k >= 1) { shot.active = false; shot.yaw = null; for (const key of SPACE) shot[key] = null; }
      });
    }
    const from = shot.active ? snap(shot) : e.cameraNow();
    const actorId = typeof s.camera === 'string' && !e.isArea(s.camera) ? s.camera : null;
    const fixed = actorId ? null : e.point(s.camera, 'camera');
    const to = { zoom: s.zoom ?? from.zoom ?? 1, yaw: s.yaw ?? from.yaw ?? null };
    for (const key of SPACE) to[key] = s[key] ?? from[key] ?? null;
    const pov = s.pov && actorId ? actorId : null;
    // through an actor's eyes: yaw and pitch are the look direction (null = where the actor faces, level), the eye is the actor
    if (pov) { to.yaw = s.yaw ?? null; to.pitch = s.pitch ?? null; to.height = null; to.distance = null; }
    Object.assign(shot, { active: true, follow: null, pov, x: from.x, y: from.y, zoom: from.zoom ?? 1, yaw: from.yaw ?? null });
    for (const key of SPACE) shot[key] = from[key] ?? null;
    const first = fixed ?? e.point(actorId, 'camera');
    e.emit('camera', { x: first.x, y: first.y, ...to, actor: actorId, follow: !!s.follow || !!pov, pov, time });
    return tween(time, easing, (k) => {
      const p = fixed ?? e.point(actorId, 'camera'); // an actor is tracked while the camera travels
      shot.x = lerp(from.x, p.x, k); shot.y = lerp(from.y, p.y, k); shot.zoom = lerp(from.zoom ?? 1, to.zoom, k);
      shot.yaw = to.yaw === null ? null : from.yaw === null || from.yaw === undefined ? to.yaw : lerpAngle(from.yaw, to.yaw, k);
      for (const key of SPACE) shot[key] = blend(from[key], to[key], k);
      if (k >= 1 && (s.follow || pov)) shot.follow = actorId;
    });
  },

  shake(s, c) {
    const shot = c.e.stage.shot; const strength = s.strength ?? 0.3; let seconds = 0;
    const task = tween(s.shake, 'linear', (k) => {
      const left = (1 - k) * strength; seconds = k * s.shake;
      shot.shakeX = left * Math.sin(seconds * 47); shot.shakeY = left * Math.cos(seconds * 31);
      if (k >= 1) { shot.shakeX = 0; shot.shakeY = 0; }
    });
    return c.skipping ? null : task;
  },

  move(s, c) {
    const e = c.e; const actor = e.need(s.move, 'move');
    let end = e.point(s.to, 'move');
    const sx = actor.x; const sy = actor.y;
    const other = typeof s.to === 'string' && !e.isArea(s.to) ? e.need(s.to, 'move') : null;
    let dist = Math.hypot(end.x - sx, end.y - sy);
    if (other && dist > 0) { // walking up to someone: stop in front of them, not on top
      const gap = Math.min(dist, (actor.radius ?? 0.3) + (other.radius ?? 0.3) + e.options.personalSpace);
      end = { x: end.x - ((end.x - sx) / dist) * gap, y: end.y - ((end.y - sy) / dist) * gap };
      dist -= gap;
    }
    const clip = s.clip === undefined ? 'walk' : s.clip;
    if (dist > 1e-9) e.face(actor, angleTo(sx, sy, end.x, end.y), s.move);
    if (clip && !c.skipping && dist > 1e-9) e.animate(s.move, clip);
    const seconds = s.time ?? dist / (s.speed ?? e.options.walkSpeed);
    return tween(seconds, s.ease ?? 'linear', (k) => {
      e.moveActor(actor, lerp(sx, end.x, k), lerp(sy, end.y, k), s.move, false);
      if (k >= 1 && clip && dist > 1e-9) e.animate(s.move, 'idle');
    });
  },

  face(s, c) {
    const actor = c.e.need(s.face, 'face'); const p = c.e.point(s.to, 'face');
    if (Math.hypot(p.x - actor.x, p.y - actor.y) > 1e-9) c.e.face(actor, angleTo(actor.x, actor.y, p.x, p.y), s.face);
    return null;
  },

  place(s, c) {
    const actor = c.e.need(s.place, 'place'); const p = c.e.point(s.at, 'place');
    c.e.moveActor(actor, p.x, p.y, s.place, true);
    if (typeof s.facing === 'number') c.e.face(actor, s.facing, s.place);
    return null;
  },

  show(s, c) { c.e.need(s.show, 'show').hidden = false; c.e.emit('shown', { actor: s.show, hidden: false }); return null; },
  hide(s, c) { c.e.need(s.hide, 'hide').hidden = true; c.e.emit('shown', { actor: s.hide, hidden: true }); return null; },

  animate(s, c) {
    c.e.need(s.animate, 'animate');
    if (c.skipping) return null;
    c.e.animate(s.animate, s.clip);
    return s.time ? timer(s.time) : null;
  },

  say(s, c) {
    if (c.skipping) return null;
    const e = c.e; const stage = e.stage; const text = e.text(s.text);
    const caption = { speaker: s.say, text, shown: 0, bark: c.mode !== 'cutscene' };
    stage.caption = caption;
    e.emit('line', { speaker: s.say, text, bark: caption.bark });
    const hold = caption.bark ? (s.time ?? Math.max(2, text.length / 15)) : s.time; // a bark never waits for a key
    const speed = e.options.charsPerSecond; let held = 0;
    const end = () => { if (stage.caption === caption) stage.caption = null; return true; };
    return {
      update(dt) {
        if (caption.shown < text.length) caption.shown = speed > 0 ? Math.min(text.length, caption.shown + speed * dt) : text.length;
        if (c.advance && !caption.bark) { // the player pressed confirm: first show the whole line, then move on
          c.advance = false;
          if (caption.shown < text.length) caption.shown = text.length; else return end();
        }
        if (caption.shown >= text.length && hold !== undefined) { held += dt; if (held >= hold) return end(); }
        return false;
      },
      finish: end,
    };
  },

  dialogue(s, c) {
    const active = c.e.startDialogue(s.dialogue);
    if (!active) return null;
    c.skipping = false; // a conversation has choices to make: skipping stops here
    return { update: () => !active(), finish: () => !active() };
  },

  sound(s, c) { if (!c.skipping) c.e.drive('sound', { name: s.sound, volume: s.volume ?? 1 }); return null; },
  music(s, c) { c.e.drive('music', { name: s.music, time: s.time ?? 1 }); return null; },
  setHour(s, c) { c.e.setHour(s.setHour); return null; },
  set(s, c) { c.e.setVar(s.set, s.to); return null; },
  add(s, c) { c.e.setVar(s.add, c.e.getVar(s.add) + (s.by ?? 1)); return null; },
  startQuest(s, c) { c.e.quest({ startQuest: s.startQuest }); return null; },
  progress(s, c) { c.e.quest({ progress: s.progress, by: s.by ?? 1 }); return null; },
  failQuest(s, c) { c.e.quest({ failQuest: s.failQuest }); return null; },
  emit(s, c) { c.e.emit('event', { name: s.emit, data: s.data ?? null }); return null; },

  call(s, c) {
    const fn = c.e.actions[s.call];
    if (typeof fn !== 'function') throw new Error(`events: step { "call": "${s.call}" } has no action; pass options.actions.${s.call} to createEvents (actions: ${Object.keys(c.e.actions).join(', ') || 'none'})`);
    const result = fn(s.args ?? {}, c.e.api, { skipping: c.skipping, mode: c.mode });
    if (typeof result === 'number') return c.skipping ? null : timer(result);
    if (result && typeof result.update === 'function') return { update: (dt) => !!result.update(dt), finish: () => (result.finish ? result.finish() !== false : true) };
    return null;
  },

  run(s, c, resume) { return listTask(c.e.sequence(s.run).steps, c, makeStep, resume); },
  together(s, c, resume) { return together(s.together.map((lane) => (r) => (Array.isArray(lane) ? listTask(lane, c, makeStep, r) : makeStep(lane, c, r))), resume); },
  if(s, c, resume) { // the branch taken is part of the saved position, so a load never changes sides
    const branch = resume?.branch ?? (c.e.check(s.if) ? 'then' : 'else');
    const steps = s[branch];
    if (!steps) return null;
    const task = listTask(steps, c, makeStep, resume?.sub);
    return { update: (dt) => task.update(dt), finish: () => task.finish(), position: () => ({ branch, sub: task.position() }) };
  },
  enable(s, c) { c.e.setEnabled(s.enable, true); return null; },
  disable(s, c) { c.e.setEnabled(s.disable, false); return null; },
};

/** Start one step (or carry on inside it from a saved position). Returns its task, or null when the step is already over. */
export function makeStep(step, c, resume) {
  const verb = verbOf(step);
  if (!verb) throw new Error(`events: not a step (it needs exactly one verb): ${JSON.stringify(step)}`);
  return make[verb](step, c, resume);
}
