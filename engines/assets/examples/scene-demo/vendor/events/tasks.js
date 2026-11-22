// Tasks: the small running pieces a sequence is made of. A task is { update(dt), finish() }.
//   update(dt)  advance by dt seconds; returns true when the task is over
//   finish()    jump straight to the end state (used when the player skips a cutscene);
//               returns false when the task cannot be skipped and must go on running

const EASE = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inout: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
};

/** ease(name, t) -> t reshaped: 'linear', 'in', 'out' or 'inout'. t is 0..1. */
export function ease(name, t) {
  const fn = EASE[name];
  if (!fn) throw new Error(`ease: unknown ease ${JSON.stringify(name)} (use ${Object.keys(EASE).join(', ')})`);
  return fn(Math.min(1, Math.max(0, t)));
}

/** a + (b - a) * t */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Blend two angles in degrees the short way round. */
export function lerpAngle(a, b, t) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

/** A task that only waits. */
export function timer(seconds) {
  let left = seconds;
  return { update(dt) { left -= dt; return left <= 1e-9; }, finish() { left = 0; return true; } };
}

/**
 * tween(seconds, easeName, apply) -> task. Calls apply(k) with k going 0..1 (already eased) on every
 * update, and exactly once with k = 1 at the end.
 */
export function tween(seconds, easeName, apply) {
  let elapsed = 0; let over = false;
  const end = () => { if (!over) { over = true; apply(1); } return true; };
  return {
    update(dt) {
      if (over) return true;
      elapsed += dt;
      if (seconds <= 0 || elapsed >= seconds - 1e-9) return end();
      apply(ease(easeName, elapsed / seconds));
      return false;
    },
    finish: end,
  };
}

/**
 * listTask(steps, c, make, resume?) -> task that runs steps one after another. make(step, c, resume)
 * returns a task, or null for a step that is over at once. A step with "background": true is started
 * and not waited for: its task goes to c.side (tagged with its step), which the owner of the run
 * keeps updating. Time left over in an update is not carried into the next step, so runs are exact.
 * task.position() says where the list is ({ i, sub }); pass that back as `resume` to carry on from
 * there: the step that was running starts again, the steps before it are not repeated.
 */
export function listTask(steps, c, make, resume) {
  let i = Math.min(steps.length, Math.max(0, resume?.i ?? 0)); let cur = null; let at = i;
  let sub = resume?.sub;
  const next = () => {
    while (i < steps.length) {
      const step = steps[i]; at = i; i += 1;
      const task = make(step, c, sub); sub = undefined;
      if (!task) continue;
      if (step.background) { task.step = step; c.side.push(task); continue; }
      return task;
    }
    return null;
  };
  return {
    update(dt) {
      let left = dt;
      for (;;) {
        if (!cur) { cur = next(); if (!cur) return true; }
        if (!cur.update(left)) return false;
        cur = null; left = 0;
      }
    },
    finish() {
      for (;;) {
        if (!cur) { cur = next(); if (!cur) return true; }
        if (cur.finish() === false) return false;
        cur = null;
      }
    },
    position() { return cur ? { i: at, sub: cur.position?.() } : { i }; },
  };
}

/**
 * together(lanes, resume?) -> task that runs several tasks at the same time and is over when all of
 * them are. `lanes` is a list of functions (resumeOfLane) => task | null, so a saved position can
 * leave out the lanes that were already over.
 */
export function together(lanes, resume) {
  const live = lanes.map((start, k) => (resume && resume.lanes?.[k] === null ? null : start(resume?.lanes?.[k] ?? undefined)));
  const each = (fn) => { for (let k = 0; k < live.length; k += 1) if (live[k] && fn(live[k])) live[k] = null; return live.every((t) => !t); };
  return {
    update: (dt) => each((t) => t.update(dt)),
    finish: () => each((t) => t.finish() !== false),
    position: () => ({ lanes: live.map((t) => (t ? t.position?.() ?? {} : null)) }),
  };
}
