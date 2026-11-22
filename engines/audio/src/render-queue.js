// Spreads sound rendering over several frames so the game never freezes while
// a song, a music stem or an ambience bed is being built. A "plan" is
// { jobs: [[cost, run], ...], done() -> [Float32Array, ...] } (see songPlan).

/**
 * createRenderQueue({ setTimeout, budget }?) -> queue
 *   setTimeout: the timer to use between slices. Without one (Node tests) every
 *               plan is rendered at once, inside render().
 *   budget:     samples of work per slice (default 80000, a few milliseconds)
 * queue.render(plan, onDone) -> runs the plan's jobs in order, then onDone(channels).
 * queue.pending -> how many plans are waiting or being rendered.
 */
export function createRenderQueue({ setTimeout: later = null, budget = 80000 } = {}) {
  const waiting = [];
  let scheduled = false;

  function finish(item) {
    item.onDone(item.plan.done());
  }
  function slice() {
    scheduled = false;
    let spent = 0;
    while (waiting.length) {
      const item = waiting[0];
      while (item.at < item.plan.jobs.length && spent < budget) {
        const [cost, run] = item.plan.jobs[item.at++];
        run();
        spent += cost;
      }
      if (item.at < item.plan.jobs.length) break; // out of budget in the middle of a plan
      waiting.shift();
      finish(item);
      if (spent >= budget) break;
    }
    if (waiting.length && !scheduled) { scheduled = true; later(slice, 0); }
  }

  return {
    get pending() { return waiting.length; },
    render(plan, onDone) {
      if (!plan || !Array.isArray(plan.jobs) || typeof plan.done !== 'function') {
        throw new Error('renderQueue.render: plan must be { jobs: [[cost, run], ...], done() }');
      }
      if (!later) {
        for (const [, run] of plan.jobs) run();
        onDone(plan.done());
        return;
      }
      waiting.push({ plan, onDone, at: 0 });
      if (!scheduled) { scheduled = true; later(slice, 0); }
    },
    /** Drops every plan that has not finished (their onDone is never called). */
    clear() { waiting.length = 0; },
  };
}
