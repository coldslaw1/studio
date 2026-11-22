// The event bus: every engine's events under one roof, named 'engine:event' (for example
// 'combat:hit', 'time:jump', 'focus:changed'). Listeners run in the order they were added.

/**
 * createBus() -> bus
 *   bus.on(name, fn)     call fn(payload, name) for every emit of `name`. '*' hears everything.
 *                        Returns a function that removes the listener.
 *   bus.once(name, fn)   the same, for the next emit only.
 *   bus.off(name, fn)    remove a listener.
 *   bus.emit(name, payload)  returns how many listeners heard it.
 *   bus.count(name)      listeners on a name (tests).
 * A listener that throws does not stop the others; the error is re-thrown after all have run.
 */
export function createBus() {
  const map = new Map();
  const check = (name, fn, who) => {
    if (typeof name !== 'string' || !name) throw new Error(`${who}: event name must be a non-empty string, got ${JSON.stringify(name)}`);
    if (typeof fn !== 'function') throw new Error(`${who}: listener for '${name}' must be a function, got ${typeof fn}`);
  };
  const bus = {
    on(name, fn) {
      check(name, fn, 'bus.on');
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(fn);
      return () => bus.off(name, fn);
    },
    once(name, fn) {
      check(name, fn, 'bus.once');
      const off = bus.on(name, (payload, n) => { off(); fn(payload, n); });
      return off;
    },
    off(name, fn) {
      const list = map.get(name);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit(name, payload) {
      if (typeof name !== 'string' || !name) throw new Error(`bus.emit: event name must be a non-empty string, got ${JSON.stringify(name)}`);
      let heard = 0; let failed = null;
      for (const key of [name, '*']) {
        const list = map.get(key);
        if (!list) continue;
        for (const fn of list.slice()) {
          try { fn(payload, name); } catch (e) { failed ??= e; }
          heard += 1;
        }
      }
      if (failed) throw failed;
      return heard;
    },
    count(name) { return map.get(name)?.length ?? 0; },
  };
  return bus;
}
