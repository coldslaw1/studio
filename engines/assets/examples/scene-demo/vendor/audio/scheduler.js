// Look-ahead scheduling. Timers in a browser are late by up to a frame (or a
// second in a background tab), so sounds are never started "now" from a timer.
// Instead a timer wakes up often, looks a short way ahead on the audio clock,
// and hands every event that falls inside that window its exact start time.
// The audio hardware then starts each one on the sample, however late the
// timer was.

/**
 * createScheduler({ now, setInterval, clearInterval, lookAhead, period }) -> scheduler
 *   now():      the audio clock in seconds (AudioContext.currentTime)
 *   setInterval, clearInterval: timers (injected; tests call pump() by hand instead)
 *   lookAhead:  how far ahead events are handed out, seconds (default 0.25)
 *   period:     how often the timer wakes, seconds (default 0.05)
 *
 * scheduler.at(time, fire)          -> task; fire(time) is called once, up to lookAhead early
 * scheduler.repeat(first, fire)     -> task; fire(time) returns the next time, or null to stop
 * scheduler.cancel(task)            scheduler.pump()  hands out everything that is due
 * scheduler.start() / stop()        turn the timer on and off      scheduler.size  tasks waiting
 */
export function createScheduler(options = {}) {
  const { now, lookAhead = 0.25, period = 0.05 } = options;
  if (typeof now !== 'function') throw new Error('createScheduler: now must be a function that returns the audio clock in seconds');
  const tick = options.setInterval ?? null, untick = options.clearInterval ?? null;
  const tasks = new Set();
  let timer = null;

  const scheduler = {
    get size() { return tasks.size; },
    at(time, fire) { return scheduler.repeat(time, (t) => { fire(t); return null; }); },
    repeat(first, fire) {
      if (!Number.isFinite(first)) throw new Error(`scheduler.repeat: first must be a time in seconds, got ${JSON.stringify(first)}`);
      const task = { next: first, fire };
      tasks.add(task);
      return task;
    },
    cancel(task) { tasks.delete(task); },
    pump() {
      const t = now(), horizon = t + lookAhead;
      for (const task of [...tasks]) {
        let guard = 0;
        while (tasks.has(task) && task.next < horizon && guard++ < 64) {
          // After a pause (hidden tab) do not replay what was missed: carry on from now.
          const time = Math.max(task.next, t);
          const next = task.fire(time);
          if (next === null || next === undefined || !Number.isFinite(next)) { tasks.delete(task); break; }
          task.next = Math.max(next, time + 0.001);
        }
      }
    },
    start() { if (timer === null && tick) timer = tick(() => scheduler.pump(), period * 1000); },
    stop() { if (timer !== null && untick) untick(timer); timer = null; },
    clear() { tasks.clear(); },
  };
  return scheduler;
}
