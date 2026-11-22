// Fixed-step game loop. update() always gets the same dt, so game logic is
// deterministic and testable; draw() runs once per display frame.

/**
 * createLoop(options) -> loop
 * options:
 *   update(dt)      required. Called zero or more times per frame. dt is `step` seconds.
 *   draw(alpha)     optional. Called once per frame. alpha (0..1) is how far we are
 *                   between two updates; ignore it unless you interpolate.
 *   step            seconds per update. Default 1/60.
 *   maxFrame        longest frame, in seconds, that is simulated. Longer frames
 *                   (tab was hidden, breakpoint) are cut to this. Default 0.25.
 *   raf, cancelRaf  frame scheduler. Default requestAnimationFrame / cancelAnimationFrame.
 * loop:
 *   start()         begin running (no effect if already running)
 *   stop()          stop running
 *   running         true while started
 *   paused          set true to skip update() but keep draw()
 *   tick(seconds)   advance by hand: runs the updates that fit, then one draw.
 *                   For tests and for stepping a stopped loop.
 *   frames, updates counters
 */
export function createLoop(options = {}) {
  const { update, draw = null, step = 1 / 60, maxFrame = 0.25 } = options;
  if (typeof update !== 'function') throw new Error('createLoop: options.update must be a function');
  if (!(step > 0)) throw new Error(`createLoop: step must be > 0, got ${step}`);
  const raf = options.raf || ((fn) => globalThis.requestAnimationFrame(fn));
  const cancelRaf = options.cancelRaf || ((id) => globalThis.cancelAnimationFrame(id));

  let acc = 0;
  let last = null;
  let handle = null;

  const loop = {
    running: false,
    paused: false,
    frames: 0,
    updates: 0,
    step,
    start() {
      if (loop.running) return;
      loop.running = true;
      last = null;
      handle = raf(onFrame);
    },
    stop() {
      if (!loop.running) return;
      loop.running = false;
      if (handle !== null) cancelRaf(handle);
      handle = null;
    },
    tick(seconds) {
      if (!(seconds >= 0)) throw new Error(`loop.tick: seconds must be >= 0, got ${seconds}`);
      if (!loop.paused) {
        acc += Math.min(seconds, maxFrame);
        // The small epsilon stops 0.1 + 0.2 style rounding from dropping an update.
        while (acc >= step - 1e-9) {
          update(step);
          loop.updates++;
          acc -= step;
        }
        if (acc < 0) acc = 0;
      }
      loop.frames++;
      if (draw) draw(loop.paused ? 0 : acc / step);
    },
  };

  function onFrame(timeMs) {
    if (!loop.running) return;
    const seconds = last === null ? 0 : (timeMs - last) / 1000;
    last = timeMs;
    handle = raf(onFrame);
    loop.tick(Math.max(0, seconds));
  }

  return loop;
}
