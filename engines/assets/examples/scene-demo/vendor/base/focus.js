// The focus stack: who owns the player's input right now. The game is the bottom layer and is
// always there. A menu, the bag, a shop or a dialogue pushes a layer on top; while it is there,
// every layer under it receives no input at all (see router.js), in every view, for every engine.

/** How a layer wants the mouse: moving freely, dragging on the picture, or caught (first person). */
export const POINTER_MODES = Object.freeze(['free', 'drag', 'locked']);
/** The id of the bottom layer. */
export const GAME_LAYER = 'game';

/**
 * createFocus(options) -> focus
 *   options.bus        optional bus; 'focus:changed' { top, previous, depth, tick } is emitted on every change
 *   options.getTick    () => the current tick number (the router uses it to swallow the key that closed a menu)
 * focus:
 *   push(layer)        layer: { id, pausesSim = true, pointer = 'free', kind = 'modal' }. An id already on
 *                      the stack is moved to the top. Returns the layer.
 *   pop(id)            remove a layer (wherever it is). Returns true when it was there. 'game' cannot be popped.
 *   clear()            remove everything above the game.
 *   top                the layer that owns input
 *   owns(id)           true when `id` is the top layer
 *   has(id)            true when `id` is anywhere on the stack
 *   free               true when nothing is above the game
 *   simPaused          true when any layer on the stack pauses the simulation
 *   depth, ids()       how many layers, and their ids bottom to top
 *   changedTick        the tick of the last change (-1 before any)
 *   epoch              a number that goes up with every change
 *   subscribe(fn)      fn(topLayer, previousId) on every change
 *   setGamePointer(mode)  how the game layer wants the mouse (the showing view decides)
 */
export function createFocus(options = {}) {
  const { bus = null, getTick = () => 0 } = options;
  const game = { id: GAME_LAYER, pausesSim: false, pointer: 'free', kind: 'game' };
  const stack = [game];
  let changedTick = -1; let epoch = 0;
  const subscribers = [];
  const changed = (previous) => {
    changedTick = getTick(); epoch += 1;
    for (const fn of subscribers.slice()) fn(focus.top, previous);
    bus?.emit('focus:changed', { top: focus.top.id, previous, depth: stack.length, tick: changedTick });
  };
  const checkMode = (mode, who) => { if (!POINTER_MODES.includes(mode)) throw new Error(`${who}: pointer must be one of ${POINTER_MODES.join(', ')}, got ${JSON.stringify(mode)}`); };
  const focus = {
    push(layer) {
      if (!layer || typeof layer.id !== 'string' || !layer.id) throw new Error(`focus.push: layer.id must be a non-empty string, got ${JSON.stringify(layer?.id)}`);
      if (layer.id === GAME_LAYER) throw new Error("focus.push: 'game' is the bottom layer and is always there");
      const made = { id: layer.id, pausesSim: layer.pausesSim !== false, pointer: layer.pointer ?? 'free', kind: layer.kind ?? 'modal' };
      checkMode(made.pointer, 'focus.push');
      const previous = focus.top.id;
      const at = stack.findIndex((l) => l.id === made.id);
      if (at >= 0) stack.splice(at, 1);
      stack.push(made);
      if (at !== stack.length - 1 || previous !== made.id) changed(previous);
      return made;
    },
    pop(id) {
      if (id === GAME_LAYER) throw new Error("focus.pop: 'game' is the bottom layer and cannot be popped");
      const at = stack.findIndex((l) => l.id === id);
      if (at < 0) return false;
      const previous = focus.top.id;
      stack.splice(at, 1);
      changed(previous);
      return true;
    },
    clear() {
      if (stack.length === 1) return;
      const previous = focus.top.id;
      stack.length = 1;
      changed(previous);
    },
    get top() { return stack[stack.length - 1]; },
    owns(id) { return focus.top.id === id; },
    has(id) { return stack.some((l) => l.id === id); },
    get free() { return stack.length === 1; },
    get simPaused() { return stack.some((l) => l.pausesSim); },
    get depth() { return stack.length; },
    ids() { return stack.map((l) => l.id); },
    get changedTick() { return changedTick; },
    get epoch() { return epoch; },
    /** Call fn(topLayer, previousId) on every change, before the bus event. Returns a function that stops it. */
    subscribe(fn) { subscribers.push(fn); return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); }; },
    setGamePointer(mode) {
      checkMode(mode, 'focus.setGamePointer');
      if (game.pointer === mode) return;
      game.pointer = mode;
      if (focus.free) changed(GAME_LAYER);
    },
  };
  return focus;
}
