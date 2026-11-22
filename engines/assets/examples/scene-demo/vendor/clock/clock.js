// The clock: game logic runs at a steady 42 ticks per second whatever the screen does, and
// drawing gets an `alpha` to blend between two ticks so it stays smooth at any refresh rate.
// It has the same shape as core's createLoop (update, draw, start, stop, tick, paused), so a
// game swaps one for the other in one line.
import { createStats } from './stats.js';

/** Ticks per second every studio game runs at. */
export const DEFAULT_HZ = 42;
const EPS = 1e-9; // stops 0.1 + 0.2 style rounding from losing a tick

/**
 * createClock(options) -> clock
 * options:
 *   update(dt, tick)   required. One game tick. dt is always `clock.step` seconds, tick counts 0, 1, 2 ...
 *   draw(alpha, clock) optional. Once per frame. alpha (0..1) is how far we are between two ticks.
 *   steady(dt, tick)   optional. Same rate as update, but never paused, slowed or frozen. For
 *                      audio, menus and network keep-alive.
 *   hz                 ticks per second. Default 42. (Or `step`, seconds per tick, as in core.)
 *   maxCatchUp         most ticks run in one frame. Ticks beyond it are dropped and counted, so
 *                      a long stall slows the game down for a moment instead of freezing it. Default 5.
 *   maxUpdateMs        if the ticks of one frame have already taken this long, the rest of that
 *                      frame's ticks are dropped too (the game itself is too slow). Default 40.
 *   background         'pause' (default): nothing runs while the tab is hidden, and the time away
 *                      is not caught up. 'run': ticks keep going on a timer (multiplayer hosts).
 *   stallMs            a gap between frames this long is recorded as a stall. Default 50.
 *   onStall(stall)     optional, called for each stall. See stats.recentStalls.
 *   tasks, taskBudgetMs   a createTasks() scheduler to run after each draw, and its time per frame (default 4).
 *   now                () => milliseconds, for measuring cost. Default performance.now.
 *   raf, cancelRaf, document, setTimeout, clearTimeout   browser pieces; tests pass fakes.
 *                      `document: null` turns background-tab handling off.
 * clock:
 *   start(), stop(), running      run on the screen's frames
 *   tick(seconds)      one frame by hand: `seconds` of real time passed. Runs the ticks that fit, then draws.
 *   advance(n = 1)     exactly n ticks, no drawing, ignoring pause and time scale. For tests, bots and replays.
 *   paused             set true to stop update() (steady() and draw() go on)
 *   timeScale          1 = normal, 0.5 = slow motion, 2 = fast forward. dt never changes, only how often ticks come.
 *   hitStop(seconds), hitStopTicks(n), clearHitStop()   freeze update() for a moment. Longest request wins.
 *   frozen, hitStopLeft   true while frozen, and the ticks left
 *   ticks, simTime     updates run so far, and ticks * step in seconds (exact, never a running sum)
 *   alpha, step, hz, frames, updates (same as ticks)
 *   setTicks(n)        continue counting from n (loading a save, joining a net game)
 *   reset()            back to tick 0 with empty stats
 *   measure(label, fn) run fn() and record how long it took under `label` in stats.blocks
 *   stats              see createStats
 */
export function createClock(options = {}) {
  const { update, draw = null, steady = null, tasks = null, taskBudgetMs = 4, background = 'pause' } = options;
  if (typeof update !== 'function') throw new Error('createClock: options.update must be a function');
  const step = options.step ?? 1 / (options.hz ?? DEFAULT_HZ);
  if (!(step > 0) || !Number.isFinite(step)) throw new Error(`createClock: hz and step must be > 0, got hz ${options.hz}, step ${options.step}`);
  const hz = options.step ? 1 / step : (options.hz ?? DEFAULT_HZ);
  const maxCatchUp = options.maxCatchUp ?? (options.maxFrame ? Math.max(1, Math.floor(options.maxFrame / step + EPS)) : 5);
  if (!Number.isInteger(maxCatchUp) || maxCatchUp < 1) throw new Error(`createClock: maxCatchUp must be a whole number >= 1, got ${maxCatchUp}`);
  const maxUpdateMs = options.maxUpdateMs ?? 40;
  if (background !== 'pause' && background !== 'run') throw new Error(`createClock: background must be 'pause' or 'run', got ${background}`);
  const now = options.now || (() => globalThis.performance.now());
  const raf = options.raf || ((fn) => globalThis.requestAnimationFrame(fn));
  const cancelRaf = options.cancelRaf || ((id) => globalThis.cancelAnimationFrame(id));
  const setTimer = options.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = options.clearTimeout || ((id) => globalThis.clearTimeout(id));
  const doc = options.document === undefined ? globalThis.document : options.document;
  const stats = createStats({ hz, stallMs: options.stallMs, onStall: options.onStall });
  const hiddenCap = Math.ceil(hz * 1.1); // browsers wake a hidden tab about once a second

  let acc = 0; let steadyAcc = 0;
  let ticks = 0; let steadyTicks = 0; let frames = 0;
  let freeze = 0; // hit-stop ticks left
  let hold = false; // draw the newest state as it is until the next update (no blending back)
  let last = null; let handle = null; let timer = null;
  let hidden = false; let hiddenAt = 0;

  /** Runs `slots` tick slots. A frozen slot passes without update(). Returns what happened. */
  function simulate(slots, mayDrop) {
    const t0 = now();
    let ran = 0; let frozen = 0; let dropped = 0;
    for (let i = 0; i < slots; i++) {
      if (freeze > 0) { freeze--; frozen++; continue; }
      hold = false;
      update(step, ticks);
      ticks++; ran++;
      if (mayDrop && i < slots - 1 && now() - t0 >= maxUpdateMs) { dropped = slots - 1 - i; break; }
    }
    return { ran, frozen, dropped };
  }

  function runSteady(n) {
    for (let i = 0; i < n; i++) { if (steady) steady(step, steadyTicks); steadyTicks++; }
    return n;
  }

  /** Whole ticks in an accumulator, capped; returns [slots to run, slots dropped, what is left]. */
  function take(time, cap) {
    let slots = Math.floor((time + EPS) / step);
    const dropped = Math.max(0, slots - cap);
    const left = Math.max(0, time - slots * step);
    slots -= dropped;
    return [slots, dropped, left];
  }

  const clock = {
    running: false,
    paused: false,
    timeScale: 1,
    step,
    hz,
    stats,
    get ticks() { return ticks; },
    get updates() { return ticks; },
    get frames() { return frames; },
    get simTime() { return ticks * step; },
    get alpha() { return hold ? 1 : Math.min(1, acc / step); },
    get frozen() { return freeze > 0; },
    get hitStopLeft() { return freeze; },

    start() {
      if (clock.running) return;
      clock.running = true;
      last = null;
      if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);
      handle = raf(onFrame);
    },
    stop() {
      if (!clock.running) return;
      clock.running = false;
      if (handle !== null) cancelRaf(handle);
      if (timer !== null) clearTimer(timer);
      handle = null; timer = null; hidden = false;
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
    },
    tick(seconds) {
      if (!(seconds >= 0)) throw new Error(`clock.tick: seconds must be >= 0, got ${seconds}`);
      const scale = clock.timeScale;
      if (!(scale >= 0) || !Number.isFinite(scale)) throw new Error(`clock.tick: timeScale must be a number >= 0, got ${scale}`);
      const cap = hidden ? hiddenCap : maxCatchUp;
      const t0 = now();
      const tickAt = ticks;
      let sim = { ran: 0, frozen: 0, dropped: 0 };
      if (!clock.paused) {
        const [slots, dropped, left] = take(acc + seconds * scale, cap);
        acc = left;
        sim = simulate(slots, true);
        sim.dropped += dropped;
      }
      const [steadySlots, , steadyLeft] = take(steadyAcc + seconds, cap);
      steadyAcc = steadyLeft;
      runSteady(steadySlots);
      const t1 = now();
      frames++;
      if (draw && !hidden) draw(clock.alpha, clock);
      const t2 = now();
      if (tasks) tasks.run(taskBudgetMs);
      const t3 = now();
      stats._frame({
        gapMs: seconds * 1000, gameMs: clock.paused ? 0 : seconds * 1000 * scale, atMs: t0, tick: tickAt, hidden,
        ticks: sim.ran, frozenTicks: sim.frozen, dropped: sim.dropped, steadyTicks: steadySlots,
        updateMs: t1 - t0, drawMs: t2 - t1, taskMs: t3 - t2,
      });
    },
    advance(n = 1) {
      if (!Number.isInteger(n) || n < 0) throw new Error(`clock.advance: n must be a whole number >= 0, got ${n}`);
      const sim = simulate(n, false);
      runSteady(n);
      stats.ticks += sim.ran; stats.frozenTicks += sim.frozen; stats.steadyTicks += n;
      return ticks;
    },
    hitStop(seconds) {
      if (!(seconds >= 0) || !Number.isFinite(seconds)) throw new Error(`clock.hitStop: seconds must be >= 0, got ${seconds}`);
      if (seconds > 0) clock.hitStopTicks(Math.max(1, Math.round(seconds * hz)));
    },
    hitStopTicks(n) {
      if (!Number.isInteger(n) || n < 0) throw new Error(`clock.hitStopTicks: n must be a whole number >= 0, got ${n}`);
      if (n > 0) { freeze = Math.max(freeze, n); hold = true; }
    },
    clearHitStop() { freeze = 0; },
    setTicks(n) {
      if (!Number.isInteger(n) || n < 0) throw new Error(`clock.setTicks: n must be a whole number >= 0, got ${n}`);
      ticks = n;
    },
    reset() {
      acc = 0; steadyAcc = 0; ticks = 0; steadyTicks = 0; frames = 0; freeze = 0; hold = false; last = null;
      stats.reset();
    },
    measure(label, fn) {
      if (typeof fn !== 'function') throw new Error('clock.measure: fn must be a function');
      const t0 = now();
      try { return fn(); } finally { stats._block(String(label), now() - t0); }
    },
  };

  function onFrame(timeMs) {
    if (!clock.running) return;
    handle = raf(onFrame);
    if (hidden) { last = null; return; }
    const seconds = last === null ? 0 : (timeMs - last) / 1000;
    last = timeMs;
    clock.tick(Math.max(0, seconds)); // through the object: games wrap clock.tick (gamepad polling)
  }

  function onVisibility() {
    const nowHidden = doc.visibilityState === 'hidden' || doc.hidden === true;
    if (nowHidden === hidden) return;
    hidden = nowHidden;
    if (hidden) {
      hiddenAt = now();
      if (background === 'run') { let at = hiddenAt; const beat = () => { timer = setTimer(beat, step * 1000); const t = now(); clock.tick(Math.max(0, (t - at) / 1000)); at = t; }; timer = setTimer(beat, step * 1000); }
    } else {
      if (timer !== null) clearTimer(timer);
      timer = null;
      last = null; // the time away is not a stall and is not caught up
      stats._hidden(now() - hiddenAt);
    }
  }

  return clock;
}

/** lerp(a, b, alpha) -> the value `alpha` of the way from a to b. Draw with lerp(previous, current, alpha). */
export function lerp(a, b, alpha) { return a + (b - a) * alpha; }

/** lerpAngle(a, b, alpha) -> like lerp for angles in radians, turning the short way round. */
export function lerpAngle(a, b, alpha) {
  const turn = Math.PI * 2;
  const d = ((((b - a) % turn) + turn + Math.PI) % turn) - Math.PI;
  return a + d * alpha;
}
