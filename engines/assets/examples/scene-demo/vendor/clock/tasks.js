// Budgeted task scheduler: heavy work (baking a picture, building a page, decoding a sound) is
// cut into small steps and a few milliseconds of it run per frame, so no frame is ever long.
// It can only slice work that is written in steps. One call that takes 1.5 s still takes 1.5 s.

/**
 * createTasks(options) -> tasks
 * options:
 *   budgetMs   default time per run(). Default 4.
 *   now        () => milliseconds. Default performance.now.
 *   onError    optional (error, job) => void when a task throws. The job is dropped either way.
 * tasks:
 *   add(work, { label, priority }) -> job
 *       work is one of:
 *         a generator function  function* () { part1(); yield; part2(); yield; return value; }
 *         an iterator           anything with next()
 *         a plain function      (job) => true when finished, false to be called again
 *       priority: higher runs first, equal ones in the order added. Default 0.
 *       job: { label, priority, state: 'waiting'|'running'|'done'|'failed'|'cancelled', steps,
 *              spentMs, result, error, done: Promise<result>, cancel() }
 *   each(items, fn, { label, priority, chunk }) -> job   calls fn(item, index) for every item,
 *       `chunk` items per step (default 1). job.done resolves with the number of items.
 *   run(budgetMs?) -> { steps, spentMs, pending }   work until the budget is used up. Always
 *       makes at least one step when there is work, so tasks cannot starve.
 *   flush() -> number of steps   run everything to the end (tests, loading screens).
 *   pending    number of unfinished jobs
 *   stats      { steps, spentMs, finished, failed, worstStepMs, overruns: [{ label, ms }] }
 *       overruns lists the last 16 steps that took more than twice the budget: that work needs
 *       smaller steps (or a worker).
 */
export function createTasks(options = {}) {
  const { budgetMs = 4, onError = null } = options;
  if (!(budgetMs > 0)) throw new Error(`createTasks: budgetMs must be > 0, got ${budgetMs}`);
  const now = options.now || (() => globalThis.performance.now());
  const queue = [];
  let seq = 0;
  const stats = { steps: 0, spentMs: 0, finished: 0, failed: 0, worstStepMs: 0, overruns: [] };

  function toStepper(work) {
    if (typeof work === 'function') {
      const made = work.constructor && work.constructor.name === 'GeneratorFunction' ? work() : null;
      if (made) return toStepper(made);
      return (job) => (work(job) === true ? { done: true, value: undefined } : { done: false });
    }
    if (work && typeof work.next === 'function') return () => work.next();
    throw new Error(`tasks.add: work must be a generator function, an iterator or a function, got ${typeof work}`);
  }

  function finish(job, state) {
    job.state = state;
    const at = queue.indexOf(job);
    if (at >= 0) queue.splice(at, 1);
  }

  function stepOnce(job, budget) {
    const t0 = now();
    job.state = 'running';
    try {
      const r = job._step(job);
      if (job.state !== 'running') { /* it cancelled itself */ } else if (r && r.done) { job.result = r.value; finish(job, 'done'); stats.finished++; job._resolve(r.value); } else if (job.state === 'running') job.state = 'waiting';
    } catch (error) {
      job.error = error; finish(job, 'failed'); stats.failed++;
      job._reject(error);
      if (onError) onError(error, job);
    }
    const ms = now() - t0;
    job.steps++; job.spentMs += ms;
    stats.steps++; stats.spentMs += ms;
    if (ms > stats.worstStepMs) stats.worstStepMs = ms;
    if (ms > budget * 2) { stats.overruns.push({ label: job.label, ms }); if (stats.overruns.length > 16) stats.overruns.shift(); }
    return ms;
  }

  const tasks = {
    stats,
    get pending() { return queue.length; },
    add(work, opts = {}) {
      const job = {
        label: opts.label ?? `task ${seq + 1}`, priority: opts.priority ?? 0, state: 'waiting',
        steps: 0, spentMs: 0, result: undefined, error: null, _seq: seq++, _step: toStepper(work),
        cancel() { if (job.state === 'waiting' || job.state === 'running') { finish(job, 'cancelled'); job._resolve(undefined); } },
      };
      if (!Number.isFinite(job.priority)) throw new Error(`tasks.add: priority must be a number, got ${opts.priority}`);
      job.done = new Promise((resolve, reject) => { job._resolve = resolve; job._reject = reject; });
      job.done.catch(() => {}); // a failed task is reported through job.state and onError, not as an unhandled rejection
      queue.push(job);
      queue.sort((a, b) => b.priority - a.priority || a._seq - b._seq);
      return job;
    },
    each(items, fn, opts = {}) {
      if (!Array.isArray(items)) throw new Error('tasks.each: items must be an array');
      if (typeof fn !== 'function') throw new Error('tasks.each: fn must be a function');
      const chunk = opts.chunk ?? 1;
      if (!(chunk >= 1)) throw new Error(`tasks.each: chunk must be >= 1, got ${chunk}`);
      let i = 0;
      return tasks.add({
        next() {
          for (let n = 0; n < chunk && i < items.length; n++, i++) fn(items[i], i);
          return i >= items.length ? { done: true, value: items.length } : { done: false };
        },
      }, opts);
    },
    run(budget = budgetMs) {
      if (!(budget >= 0)) throw new Error(`tasks.run: budgetMs must be >= 0, got ${budget}`);
      let steps = 0; let spentMs = 0;
      while (queue.length > 0) {
        spentMs += stepOnce(queue[0], budget > 0 ? budget : budgetMs);
        steps++;
        if (spentMs >= budget) break;
      }
      return { steps, spentMs, pending: queue.length };
    },
    flush() {
      let steps = 0;
      while (queue.length > 0) { stepOnce(queue[0], Infinity); steps++; }
      return steps;
    },
  };

  return tasks;
}
