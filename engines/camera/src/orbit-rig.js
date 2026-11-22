// An eased rig for a camera that circles a point in a live 3D view: yaw (round), pitch (tilt) and
// distance, each with a target and a current value, moved with the same easing, key steps and wheel
// steps as createCamera. It only holds numbers; the renderer reads yaw, pitch and distance.
import { angleDelta, smoothDamp, wrapDegrees } from './ease.js';

/**
 * @param {object} [options]
 * @param {number} [options.yaw]       Degrees round the point looked at (default 0).
 * @param {number} [options.pitch]     Degrees of tilt (default -25: looking down a little).
 * @param {number} [options.distance]  How far from the point (default 6).
 * @param {number} [options.minPitch]  Default -85 (almost straight down).
 * @param {number} [options.maxPitch]  Default 10.
 * @param {number} [options.minDistance]  Default 1.5.
 * @param {number} [options.maxDistance]  Default 16.
 * @param {number} [options.yawStep]   Degrees one rotateSteps(1) turns (default 45, as createCamera).
 * @param {number} [options.zoomStep]  What one zoomBy(1) divides the distance by (default 1.26, as createCamera).
 * @param {number} [options.turnTime]  Seconds a turn takes (default 0.55, as createCamera).
 * @param {number} [options.zoomTime]  Seconds a zoom takes (default 0.35, as createCamera).
 * @returns {object} rig
 */
export function createOrbitRig(options = {}) {
  const lim = { minPitch: options.minPitch ?? -85, maxPitch: options.maxPitch ?? 10, minDistance: options.minDistance ?? 1.5, maxDistance: options.maxDistance ?? 16 };
  if (!(lim.minPitch <= lim.maxPitch)) throw new Error(`createOrbitRig: need minPitch <= maxPitch, got ${lim.minPitch} and ${lim.maxPitch}`);
  if (!(lim.minDistance > 0 && lim.minDistance <= lim.maxDistance)) throw new Error(`createOrbitRig: need 0 < minDistance <= maxDistance, got ${lim.minDistance} and ${lim.maxDistance}`);
  const yawStep = options.yawStep ?? 45;
  const zoomStep = options.zoomStep ?? 1.26;
  if (!(zoomStep > 1)) throw new Error(`createOrbitRig: "zoomStep" must be above 1, got ${zoomStep}`);
  const times = { turn: options.turnTime ?? 0.55, zoom: options.zoomTime ?? 0.35 };
  const clampPitch = (p) => Math.min(lim.maxPitch, Math.max(lim.minPitch, p));
  const clampDist = (d) => Math.min(lim.maxDistance, Math.max(lim.minDistance, d));
  const number = (v, what) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`orbit rig ${what}: expected a number, got ${v}`); return v; };
  const now = { yaw: options.yaw ?? 0, pitch: clampPitch(options.pitch ?? -25), logDist: Math.log(clampDist(options.distance ?? 6)) };
  const goal = { ...now };
  const speed = { yaw: 0, pitch: 0, logDist: 0 };
  const rig = {
    /** Yaw now, degrees 0..360. */
    get yaw() { return wrapDegrees(now.yaw); },
    /** Tilt now, degrees. */
    get pitch() { return now.pitch; },
    /** Distance now. */
    get distance() { return Math.exp(now.logDist); },
    /** Where it is heading: { yaw, pitch, distance }. */
    get target() { return { yaw: wrapDegrees(goal.yaw), pitch: goal.pitch, distance: Math.exp(goal.logDist) }; },
    /** Degrees of turn still to go (0 when it is there). */
    get turnLeft() { return Math.abs(goal.yaw - now.yaw); },
    /** Degrees one rotateSteps(1) turns. */
    yawStep,
    /** True while anything is still easing. */
    get moving() { return Math.abs(goal.yaw - now.yaw) > 0.01 || Math.abs(goal.pitch - now.pitch) > 0.01 || Math.abs(goal.logDist - now.logDist) > 0.0005; },
    /** Turn by key steps (1 = one yawStep), eased; presses add up. */
    rotateSteps(steps) { goal.yaw += number(steps, 'rotateSteps') * yawStep; return rig; },
    /** Turn by degrees, eased. */
    rotateBy(degrees) { goal.yaw += number(degrees, 'rotateBy'); return rig; },
    /** Tilt by degrees, eased. */
    tiltBy(degrees) { goal.pitch = clampPitch(goal.pitch + number(degrees, 'tiltBy')); return rig; },
    /** Move nearer (steps above 0) or further by wheel steps, eased. */
    zoomBy(steps) { goal.logDist = Math.log(clampDist(Math.exp(goal.logDist - number(steps, 'zoomBy') * Math.log(zoomStep)))); return rig; },
    /** Turn and tilt right now with no easing, for dragging. */
    turn(yawDegrees, pitchDegrees = 0) {
      now.yaw += number(yawDegrees, 'turn'); goal.yaw = now.yaw; speed.yaw = 0;
      now.pitch = clampPitch(now.pitch + number(pitchDegrees, 'turn')); goal.pitch = now.pitch; speed.pitch = 0;
      return rig;
    },
    /** Ease to a yaw (the short way round), pitch or distance; leave out what should stay. */
    goTo({ yaw, pitch, distance } = {}) {
      if (yaw !== undefined) goal.yaw = now.yaw + angleDelta(now.yaw, number(yaw, 'goTo'));
      if (pitch !== undefined) goal.pitch = clampPitch(number(pitch, 'goTo'));
      if (distance !== undefined) goal.logDist = Math.log(clampDist(number(distance, 'goTo')));
      return rig;
    },
    /** Set yaw, pitch or distance directly (jump: both the value and its target). */
    set({ yaw, pitch, distance } = {}) {
      if (yaw !== undefined) { now.yaw = goal.yaw = number(yaw, 'set'); speed.yaw = 0; }
      if (pitch !== undefined) { now.pitch = goal.pitch = clampPitch(number(pitch, 'set')); speed.pitch = 0; }
      if (distance !== undefined) { now.logDist = goal.logDist = Math.log(clampDist(number(distance, 'set'))); speed.logDist = 0; }
      return rig;
    },
    /** Advance the easing; dt in seconds. */
    update(dt) {
      if (!(dt >= 0)) throw new Error(`orbit rig update: dt must be 0 or more seconds, got ${dt}`);
      [now.yaw, speed.yaw] = smoothDamp(now.yaw, goal.yaw, speed.yaw, times.turn, dt);
      [now.pitch, speed.pitch] = smoothDamp(now.pitch, goal.pitch, speed.pitch, times.turn, dt);
      [now.logDist, speed.logDist] = smoothDamp(now.logDist, goal.logDist, speed.logDist, times.zoom, dt);
      return rig;
    },
  };
  return rig;
}
