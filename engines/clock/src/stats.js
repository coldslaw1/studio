// What the clock measured: tick rate achieved, gaps between frames, dropped ticks and the cost
// of update, draw and tasks. Plain numbers, so a HUD or a play-test can read them as they are.

const round = (x) => Math.round(x * 100) / 100;

/**
 * createStats(options) -> stats
 * options:
 *   hz        ticks per second the clock aims for (only used by summary()).
 *   stallMs   a gap between two frames at least this long is a stall. Default 50.
 *   keep      how many recent stalls are kept in `recentStalls`. Default 16.
 *   onStall   optional (stall) => void, called for each stall as it is recorded.
 * stats (every time is in milliseconds):
 *   frames, ticks, steadyTicks, frozenTicks   counters since the last reset()
 *   tickRate, fps        achieved over the last full second of real time (0 until one has passed).
 *                        tickRate is measured against game time: pause, slow motion and hit-stop do
 *                        not lower it, only real lag does. 42 means the game keeps up.
 *   lowestTickRate       the worst of those seconds
 *   lastGapMs, worstGapMs   time between frames, as it really was (before any catch-up cap)
 *   stalls               how many gaps were >= stallMs
 *   recentStalls         [{ atMs, gapMs, tick, droppedTicks, cause }], newest last. cause is a
 *                        label given to clock.measure(), or 'update', 'draw', 'tasks' when the frame
 *                        before was that slow by itself, or 'outside' (work the clock never saw)
 *   droppedTicks         ticks thrown away because the game could not keep up
 *   overloadFrames       frames in which ticks were dropped
 *   updateMs, drawMs, taskMs, frameMs     { last, avg, worst } cost per frame
 *   blocks               { label: { count, totalMs, worstMs } } from clock.measure()
 *   hiddenCount, hiddenMs   times the tab went to the background, and for how long in all
 *   reset()              zero everything
 *   summary()            one line of text for a HUD or a log
 */
export function createStats(options = {}) {
  const { hz = 42, stallMs = 50, keep = 16, onStall = null } = options;
  if (!(stallMs > 0)) throw new Error(`createStats: stallMs must be > 0, got ${stallMs}`);
  const zero = () => ({ update: 0, draw: 0, tasks: 0 });
  const cost = () => ({ last: 0, avg: 0, worst: 0 });
  const add = (c, ms) => { c.last = round(ms); c.avg = round(c.avg + (ms - c.avg) * 0.1); if (ms > c.worst) c.worst = round(ms); };

  let win = { ms: 0, gameMs: 0, slots: 0, frames: 0 };
  let anyRate = false;
  // A browser can hand out one more frame with an old timestamp right after a long block, so the
  // gap shows up a frame late: blame and costs are remembered for two frames.
  let blame = null; // the longest measure() of the last two frames
  let prev = [zero(), zero()]; // cost of the two frames before, which is what the next gap pays for

  const stats = {
    reset() {
      Object.assign(stats, {
        frames: 0, ticks: 0, steadyTicks: 0, frozenTicks: 0,
        tickRate: 0, fps: 0, lowestTickRate: 0,
        lastGapMs: 0, worstGapMs: 0, stalls: 0, recentStalls: [],
        droppedTicks: 0, overloadFrames: 0,
        updateMs: cost(), drawMs: cost(), taskMs: cost(), frameMs: cost(),
        blocks: {}, hiddenCount: 0, hiddenMs: 0,
      });
      win = { ms: 0, gameMs: 0, slots: 0, frames: 0 };
      anyRate = false;
      blame = null;
      prev = [zero(), zero()];
    },
    summary() {
      const s = stats;
      return `${s.tickRate || '-'}/${hz} ticks/s, ${s.fps || '-'} fps, worst gap ${s.worstGapMs} ms, ${s.stalls} stalls, ` +
        `${s.droppedTicks} ticks dropped, update ${s.updateMs.avg} ms, draw ${s.drawMs.avg} ms`;
    },
    /** Used by the clock: one frame happened. */
    _frame(f) {
      stats.frames++;
      stats.ticks += f.ticks; stats.steadyTicks += f.steadyTicks; stats.frozenTicks += f.frozenTicks;
      if (f.dropped > 0) { stats.droppedTicks += f.dropped; stats.overloadFrames++; }
      add(stats.updateMs, f.updateMs); add(stats.drawMs, f.drawMs); add(stats.taskMs, f.taskMs);
      add(stats.frameMs, f.updateMs + f.drawMs + f.taskMs);
      if (!f.hidden) {
        stats.lastGapMs = round(f.gapMs);
        if (f.gapMs > stats.worstGapMs) stats.worstGapMs = round(f.gapMs);
        if (f.gapMs >= stallMs) {
          const stall = { atMs: round(f.atMs), gapMs: round(f.gapMs), tick: f.tick, droppedTicks: f.dropped, cause: cause(f.gapMs) };
          stats.stalls++;
          stats.recentStalls.push(stall);
          if (stats.recentStalls.length > keep) stats.recentStalls.shift();
          if (onStall) onStall(stall);
        }
        // game time is real time times the time scale, and none while paused; a frozen slot counts as kept up
        win.ms += f.gapMs; win.gameMs += f.gameMs; win.slots += f.ticks + f.frozenTicks; win.frames++;
        if (win.ms >= 1000) {
          stats.fps = round((win.frames * 1000) / win.ms);
          if (win.gameMs >= 500) { // too little game time (paused, nearly stopped) says nothing about lag
            stats.tickRate = round((win.slots * 1000) / win.gameMs);
            if (!anyRate || stats.tickRate < stats.lowestTickRate) stats.lowestTickRate = stats.tickRate;
            anyRate = true;
          }
          win = { ms: 0, gameMs: 0, slots: 0, frames: 0 };
        }
      }
      if (blame && ++blame.age >= 2) blame = null;
      prev = [prev[1], { update: f.updateMs, draw: f.drawMs, tasks: f.taskMs }];
    },
    /** Used by clock.measure(): a labelled piece of work took `ms`. */
    _block(label, ms) {
      const b = stats.blocks[label] || (stats.blocks[label] = { count: 0, totalMs: 0, worstMs: 0 });
      b.count++; b.totalMs = round(b.totalMs + ms); if (ms > b.worstMs) b.worstMs = round(ms);
      if (!blame || ms > blame.ms) blame = { label, ms, age: 0 };
    },
    /** Used by the clock: the tab was in the background for `ms`. */
    _hidden(ms) { stats.hiddenCount++; stats.hiddenMs = round(stats.hiddenMs + ms); },
  };

  function cause(gapMs) {
    if (blame && blame.ms >= gapMs / 2) { const { label } = blame; blame = null; return label; }
    const parts = Object.keys(prev[0]).map((name) => [name, Math.max(prev[0][name], prev[1][name])]);
    const [name, ms] = parts.sort((a, b) => b[1] - a[1])[0];
    return ms >= gapMs / 2 ? name : 'outside';
  }

  stats.reset();
  return stats;
}
