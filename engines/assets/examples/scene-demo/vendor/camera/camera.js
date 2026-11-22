// The camera itself: a point on the ground it looks at, a yaw (which way it looks from) and a zoom.
// Each has a target the game sets and a current value that eases toward it in update(dt).
// It knows nothing about drawing; scene-camera.js turns it into a picture and a rectangle.
import { angleDelta, nearestYawIndex, smoothDamp, wrapDegrees } from './ease.js';

/**
 * @param {object} [options]
 * @param {number} [options.x]         Ground point looked at (default 0).
 * @param {number} [options.y]
 * @param {number} [options.yaw]       Degrees (default: the first of `yaws`, or 0).
 * @param {number} [options.zoom]      1 = the normal view, 2 = twice as close (default 1).
 * @param {number} [options.minZoom]   Default 1.
 * @param {number} [options.maxZoom]   Default 8.
 * @param {number} [options.zoomStep]  How much one zoomBy(1) multiplies the zoom (default 2: with a scene orbit whose details double, every stop then shows a picture at a whole number of pixels per character, with no shimmer).
 * @param {number} [options.yawStep]   Degrees one rotateSteps(1) turns (default 45).
 * @param {number[]} [options.yaws]    Angles the camera may rest at, in degrees (for example the baked angles of a scene). Without it any angle is allowed.
 * @param {number} [options.moveTime]  Seconds the look-at point takes to catch up with its target (default 0.25; 0 = locked on).
 * @param {number} [options.zoomTime]  Seconds a zoom takes (default 0.3).
 * @param {number} [options.turnTime]  Seconds a turn takes (default 0.45).
 * @returns {object} camera
 */
export function createCamera(options = {}) {
  const yaws = options.yaws ? options.yaws.map(wrapDegrees) : null;
  if (yaws && yaws.length === 0) throw new Error('createCamera: "yaws" must have at least one angle');
  const minZoom = options.minZoom ?? 1;
  const maxZoom = options.maxZoom ?? 8;
  if (!(minZoom > 0 && maxZoom >= minZoom)) throw new Error(`createCamera: need 0 < minZoom <= maxZoom, got ${minZoom} and ${maxZoom}`);
  const zoomStep = options.zoomStep ?? 1.26;
  if (!(zoomStep > 1)) throw new Error(`createCamera: "zoomStep" must be above 1, got ${zoomStep}`);
  const yawStep = options.yawStep ?? 45;
  const times = { move: options.moveTime ?? 0.25, zoom: options.zoomTime ?? 0.35, turn: options.turnTime ?? 0.55 };
  const clampZoom = (z) => Math.min(maxZoom, Math.max(minZoom, z));
  const rest = (yaw) => (yaws ? yaws[nearestYawIndex(yaws, yaw)] : yaw); // nearest allowed angle
  const number = (v, what) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`camera.${what}: expected a number, got ${v}`); return v; };

  const startYaw = rest(options.yaw ?? yaws?.[0] ?? 0);
  // yaw is kept unwrapped (it may pass 360) so easing always takes the way the player asked for
  const now = { x: options.x ?? 0, y: options.y ?? 0, yaw: startYaw, logZoom: Math.log(clampZoom(options.zoom ?? 1)) };
  const goal = { ...now };
  const speed = { x: 0, y: 0, yaw: 0, logZoom: 0 };
  let followed = null;
  let time = 0;

  const camera = {
    /** Ground point at the middle of the view, now. */
    get x() { return now.x; },
    get y() { return now.y; },
    /** Yaw now, in degrees 0..360. */
    get yaw() { return wrapDegrees(now.yaw); },
    /** Zoom now. */
    get zoom() { return Math.exp(now.logZoom); },
    /** Where it is heading: { x, y, yaw, zoom }. */
    get target() { return { x: goal.x, y: goal.y, yaw: wrapDegrees(goal.yaw), zoom: Math.exp(goal.logZoom) }; },
    /** True while the yaw or zoom is still easing (the look-at point is not counted). */
    get moving() { return Math.abs(goal.yaw - now.yaw) > 0.01 || Math.abs(goal.logZoom - now.logZoom) > 0.0005; },
    /** Seconds this camera has been updated for (the sum of every dt). */
    get time() { return time; },
    /** Degrees of turn still to go (0 when it is there). */
    get turnLeft() { return Math.abs(goal.yaw - now.yaw); },
    /** Degrees one rotateSteps(1) turns. */
    yawStep,
    /** Which way the yaw still has to go: 1 = rising, -1 = falling, 0 = there. */
    get turning() { return Math.abs(goal.yaw - now.yaw) > 0.01 ? Math.sign(goal.yaw - now.yaw) : 0; },
    minZoom, maxZoom, yaws,

    /** Keep looking at an object with x and y (read every update), or pass null to stop. */
    follow(target) {
      if (target !== null && (typeof target !== 'object' || typeof target.x !== 'number' || typeof target.y !== 'number')) throw new Error('camera.follow: expected an object with numeric x and y, or null');
      followed = target;
      return camera;
    },
    /** Ease toward a ground point (ignored while following something). */
    lookAt(x, y) { goal.x = number(x, 'lookAt'); goal.y = number(y, 'lookAt'); return camera; },
    /** Zoom in (steps above 0) or out (below 0) by whole or part steps. */
    zoomBy(steps) { goal.logZoom = Math.log(clampZoom(Math.exp(goal.logZoom + number(steps, 'zoomBy') * Math.log(zoomStep)))); return camera; },
    /** Ease to a zoom value (kept within minZoom..maxZoom). */
    zoomTo(zoom) { if (!(number(zoom, 'zoomTo') > 0)) throw new Error(`camera.zoomTo: zoom must be above 0, got ${zoom}`); goal.logZoom = Math.log(clampZoom(zoom)); return camera; },
    /** Turn by a number of yawStep steps (1 = one step one way, -1 the other), easing through the angles between. */
    rotateSteps(steps) { return camera.rotateBy(number(steps, 'rotateSteps') * yawStep); },
    /** Turn by degrees from where it is heading; ends on the nearest allowed angle. */
    rotateBy(degrees) {
      const wanted = goal.yaw + number(degrees, 'rotateBy');
      goal.yaw = wanted + angleDelta(wanted, rest(wanted));
      return camera;
    },
    /** Turn to an absolute angle the short way round; ends on the nearest allowed angle. */
    rotateTo(degrees) { goal.yaw = now.yaw + angleDelta(now.yaw, rest(number(degrees, 'rotateTo'))); return camera; },
    /** Turn right now with no easing, for dragging: call it with the drag's degrees, then settle() on release. */
    turn(degrees) { now.yaw += number(degrees, 'turn'); goal.yaw = now.yaw; speed.yaw = 0; return camera; },
    /**
     * After turn(): ease onto the nearest allowed angle. `lean` (degrees, default 0) is added first, so a
     * drag that only went part of the way to the next angle still carries on to it instead of springing back.
     */
    settle(lean = 0) {
      const from = now.yaw + number(lean, 'settle');
      goal.yaw = from + angleDelta(from, rest(from));
      return camera;
    },
    /** Degrees between neighbouring allowed angles (0 when any angle is allowed). */
    get yawSpacing() { return yaws ? 360 / yaws.length : 0; },
    /** Jump to the targets with no easing (use it after a teleport or when a level starts). */
    snap() {
      if (followed) { goal.x = followed.x; goal.y = followed.y; }
      Object.assign(now, goal);
      speed.x = speed.y = speed.yaw = speed.logZoom = 0;
      return camera;
    },
    /** Advance the easing. Call once per update with dt in seconds. */
    update(dt) {
      if (!(dt >= 0)) throw new Error(`camera.update: dt must be 0 or more seconds, got ${dt}`);
      time += dt;
      if (followed) { goal.x = followed.x; goal.y = followed.y; }
      [now.x, speed.x] = smoothDamp(now.x, goal.x, speed.x, times.move, dt);
      [now.y, speed.y] = smoothDamp(now.y, goal.y, speed.y, times.move, dt);
      [now.yaw, speed.yaw] = smoothDamp(now.yaw, goal.yaw, speed.yaw, times.turn, dt);
      [now.logZoom, speed.logZoom] = smoothDamp(now.logZoom, goal.logZoom, speed.logZoom, times.zoom, dt);
      return camera;
    },
  };
  return camera;
}
