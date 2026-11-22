// The environment: facts about the world right now that one plugin owns and many read, such as
// the weather, the wind, the region the hero is in or the danger level. One owner writes a key;
// everyone else reads it or watches it, without knowing which plugin it came from.

/**
 * createEnv(options) -> env
 *   options.bus   optional bus: 'env:changed' { key, value, previous } when a key gets a different value
 * env:
 *   provide(key, owner, value)   claim a key and give its first value. A key has one owner; a second claim throws.
 *   set(key, value)              the owner updates it. Setting the same object again (a sample refilled in place) is fine and silent.
 *   get(key, fallback)           read; `fallback` when nobody provides it
 *   has(key), keys(), owner(key)
 *   watch(key, fn)               fn(value, key) now (if provided) and whenever set() gives a different value. Returns a remover.
 */
export function createEnv(options = {}) {
  const { bus = null } = options;
  const values = new Map(); const owners = new Map(); const watchers = new Map();
  const tell = (key, value, previous) => {
    for (const fn of (watchers.get(key) ?? []).slice()) fn(value, key);
    bus?.emit('env:changed', { key, value, previous });
  };
  const env = {
    provide(key, owner, value) {
      if (typeof key !== 'string' || !key) throw new Error(`env.provide: key must be a non-empty string, got ${JSON.stringify(key)}`);
      if (typeof owner !== 'string' || !owner) throw new Error(`env.provide: '${key}' needs an owner name, got ${JSON.stringify(owner)}`);
      if (owners.has(key)) throw new Error(`env.provide: '${key}' is already provided by ${owners.get(key)}`);
      owners.set(key, owner); values.set(key, value);
      tell(key, value, undefined);
    },
    set(key, value) {
      if (!owners.has(key)) throw new Error(`env.set: nobody provides '${key}' yet (call env.provide first; provided: ${[...owners.keys()].join(', ') || 'none'})`);
      const previous = values.get(key);
      if (previous === value) return;
      values.set(key, value);
      tell(key, value, previous);
    },
    get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    has(key) { return owners.has(key); },
    keys() { return [...owners.keys()]; },
    owner(key) { return owners.get(key) ?? null; },
    watch(key, fn) {
      if (typeof fn !== 'function') throw new Error(`env.watch: listener for '${key}' must be a function`);
      if (!watchers.has(key)) watchers.set(key, []);
      watchers.get(key).push(fn);
      if (values.has(key)) fn(values.get(key), key);
      return () => { const l = watchers.get(key); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
    },
  };
  return env;
}
