// The order of a tick and of a picture, fixed once for every game. Plugins hook into a phase
// instead of being called by hand from each scene, so nothing is forgotten and nothing runs twice.

/** What runs in one tick, in this order. 'sim' and 'late' are skipped while a menu pauses the game. */
export const TICK_PHASES = Object.freeze(['input', 'ui', 'sim', 'late', 'post']);
/** Phases that stop while the simulation is paused. */
export const PAUSABLE = Object.freeze(['sim', 'late']);
/** What is drawn in one picture, back to front. */
export const DRAW_LAYERS = Object.freeze(['draw:world', 'draw:actors', 'draw:effects', 'draw:overlay', 'draw:ui']);
/** Runs at the tick rate even while paused or frozen (audio, network keep-alive). */
export const STEADY = 'steady';

/**
 * createPhases() -> phases
 *   add(phase, fn, { order = 0, owner = 'game', modes })   hook fn into a phase. Lower order runs first; equal
 *        orders run in the order added. `modes` (array of mode names) limits it to those modes. Returns a function that removes it.
 *   run(phase, mode, ...args)   call every hook of the phase that is on in `mode`
 *   list(phase)                 [{ owner, order }] in running order (tests, debugging)
 */
export function createPhases() {
  const known = [...TICK_PHASES, ...DRAW_LAYERS, STEADY];
  const hooks = new Map(known.map((p) => [p, []]));
  let serial = 0;
  return {
    add(phase, fn, o = {}) {
      if (!hooks.has(phase)) throw new Error(`base.on: unknown phase ${JSON.stringify(phase)} (tick: ${TICK_PHASES.join(', ')}; draw: ${DRAW_LAYERS.join(', ')}; and ${STEADY})`);
      if (typeof fn !== 'function') throw new Error(`base.on: the hook for '${phase}' must be a function, got ${typeof fn}`);
      if (o.modes !== undefined && !Array.isArray(o.modes)) throw new Error(`base.on: modes must be an array of mode names, got ${JSON.stringify(o.modes)}`);
      const hook = { fn, order: o.order ?? 0, owner: o.owner ?? 'game', modes: o.modes ?? null, serial: serial++ };
      const list = hooks.get(phase);
      list.push(hook);
      list.sort((a, b) => a.order - b.order || a.serial - b.serial);
      return () => { const i = list.indexOf(hook); if (i >= 0) list.splice(i, 1); };
    },
    run(phase, mode, ...args) {
      for (const hook of hooks.get(phase).slice()) if (!hook.modes || hook.modes.includes(mode)) hook.fn(...args);
    },
    list(phase) { return hooks.get(phase).map((h) => ({ owner: h.owner, order: h.order })); },
  };
}
