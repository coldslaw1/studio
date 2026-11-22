// Save slots on top of localStorage (or any storage with getItem / setItem /
// removeItem). Data must be JSON-compatible. A broken or missing save loads
// as null; it never throws.

/** In-memory storage with the localStorage interface. For tests and as a fallback. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get length() { return map.size; },
  };
}

/**
 * createSaves(options) -> saves
 * options:
 *   gameId     required. Short unique string, e.g. 'mossback-mail'. Prefixes every key.
 *   slots      number of save slots. Default 3. Slots are numbered 1..slots.
 *   version    integer version of YOUR save data. Default 1.
 *   migrate    (data, fromVersion) => data. Called when a stored save is older than
 *              `version`. Without it, old saves load unchanged.
 *   storage    default: localStorage if usable, else in-memory (saves.persistent is false).
 *   now        () => milliseconds. Default Date.now.
 * saves:
 *   save(slot, data)   store data. Returns true, or false if the browser refused.
 *   load(slot)         the data, or null if empty/broken
 *   info(slot)         { slot, empty, savedAt, version } without the data
 *   list()             info for every slot, in order
 *   erase(slot)        empty the slot
 *   settings           store shared by all slots: get(key, fallback), set(key, value), all()
 *   slotStore(slot)    the same get/set/all store kept inside one slot's own area
 *   persistent         false when saves only live until the page closes
 */
export function createSaves(options = {}) {
  const { gameId, slots = 3, version = 1, migrate = null } = options;
  if (typeof gameId !== 'string' || !/^[a-z0-9_-]+$/i.test(gameId)) {
    throw new Error(`createSaves: gameId must be letters, digits, - or _, got ${JSON.stringify(gameId)}`);
  }
  if (!Number.isInteger(slots) || slots < 1) throw new Error(`createSaves: slots must be an integer >= 1, got ${slots}`);
  const now = options.now || Date.now;
  let storage = options.storage || null;
  let persistent = true;
  if (!storage) {
    storage = usableLocalStorage();
    if (!storage) { storage = createMemoryStorage(); persistent = false; }
  }
  const key = (name) => `${gameId}:${name}`;

  function checkSlot(slot, fn) {
    if (!Number.isInteger(slot) || slot < 1 || slot > slots) {
      throw new Error(`saves.${fn}: slot must be an integer from 1 to ${slots}, got ${slot}`);
    }
  }
  function readJson(name) {
    try {
      const raw = storage.getItem(key(name));
      if (raw === null || raw === undefined) return null;
      const value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }
  function writeJson(name, value) {
    try {
      storage.setItem(key(name), JSON.stringify(value));
      return true;
    } catch {
      return false; // storage full or blocked
    }
  }
  function readSlot(slot) {
    const env = readJson(`slot${slot}`);
    if (!env || !('data' in env) || !Number.isInteger(env.v)) return null;
    return env;
  }
  function makeStore(name) {
    const read = () => readJson(name) || {};
    return {
      get(k, fallback = null) {
        const all = read();
        return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : fallback;
      },
      set(k, value) {
        const all = read();
        if (value === undefined) delete all[k];
        else all[k] = value;
        return writeJson(name, all);
      },
      all: read,
    };
  }

  return {
    slots,
    persistent,
    save(slot, data) {
      checkSlot(slot, 'save');
      if (data === undefined) throw new Error('saves.save: data is undefined');
      return writeJson(`slot${slot}`, { v: version, savedAt: now(), data });
    },
    load(slot) {
      checkSlot(slot, 'load');
      const env = readSlot(slot);
      if (!env) return null;
      if (env.v < version && migrate) return migrate(env.data, env.v);
      return env.data;
    },
    info(slot) {
      checkSlot(slot, 'info');
      const env = readSlot(slot);
      return env
        ? { slot, empty: false, savedAt: env.savedAt ?? null, version: env.v }
        : { slot, empty: true, savedAt: null, version: null };
    },
    list() {
      const out = [];
      for (let s = 1; s <= slots; s++) out.push(this.info(s));
      return out;
    },
    erase(slot) {
      checkSlot(slot, 'erase');
      try { storage.removeItem(key(`slot${slot}`)); storage.removeItem(key(`slot${slot}:store`)); } catch { /* ignore */ }
    },
    settings: makeStore('settings'),
    slotStore(slot) {
      checkSlot(slot, 'slotStore');
      return makeStore(`slot${slot}:store`);
    },
  };
}

function usableLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    ls.setItem('__studio_core_probe__', '1');
    ls.removeItem('__studio_core_probe__');
    return ls;
  } catch {
    return null;
  }
}
