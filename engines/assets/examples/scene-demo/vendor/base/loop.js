// A small fixed-step loop with the same shape as the clock engine's createClock, so the base runs
// without any other engine (tests, servers). Games pass `createLoop: createClock` (the clock plugin
// file exports it) to get the full clock: catch-up limits, stall statistics, hit-stop, tasks.

/**
 * createFixedLoop(options) -> loop
 *   options: update(dt, tick), draw(alpha), steady(dt, tick), hz = 42, maxCatchUp = 5, raf, cancelRaf
 * loop: start(), stop(), running, tick(seconds), advance(n), paused, timeScale, ticks, alpha, step, hz
 */
export function createFixedLoop(options = {}) {
  const { update, draw = null, steady = null } = options;
  if (typeof update !== 'function') throw new Error('createFixedLoop: options.update must be a function');
  const hz = options.hz ?? 42; const step = 1 / hz; const maxCatchUp = options.maxCatchUp ?? 5;
  const raf = options.raf ?? ((fn) => globalThis.requestAnimationFrame(fn));
  const cancelRaf = options.cancelRaf ?? ((id) => globalThis.cancelAnimationFrame(id));
  let acc = 0; let ticks = 0; let last = null; let handle = null;
  const loop = {
    paused: false, timeScale: 1, alpha: 1, step, hz,
    get ticks() { return ticks; }, get running() { return handle !== null; },
    tick(seconds) {
      acc += Math.max(0, seconds);
      let n = Math.min(maxCatchUp, Math.floor(acc / step + 1e-9));
      acc = Math.min(acc - n * step, step); // time beyond the catch-up limit is dropped
      if (acc < 0) acc = 0;
      for (; n > 0; n--) {
        steady?.(step, ticks);
        if (!loop.paused && loop.timeScale > 0) { update(step, ticks); ticks += 1; }
      }
      loop.alpha = Math.min(1, acc / step);
      draw?.(loop.alpha, loop);
    },
    advance(n = 1) { for (let i = 0; i < n; i++) { steady?.(step, ticks); update(step, ticks); ticks += 1; } },
    start() {
      if (handle !== null) return;
      const frame = (ms) => { handle = raf(frame); const dt = last === null ? 0 : (ms - last) / 1000; last = ms; loop.tick(dt); };
      handle = raf(frame);
    },
    stop() { if (handle !== null) cancelRaf(handle); handle = null; last = null; },
  };
  return loop;
}
