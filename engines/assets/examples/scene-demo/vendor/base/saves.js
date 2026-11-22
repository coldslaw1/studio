// One save for the whole game. Each plugin registers what it keeps; the base gathers every part
// into one versioned object and hands each part back on load. A plugin left out of a game simply
// has no part, and a part whose plugin is missing is kept untouched for when it comes back.

export const SAVE_VERSION = 1;

/**
 * createSaveRegistry(options) -> saves
 *   options.gameId   written into every save and checked on load
 *   options.slots    optional core saves object ({ save(slot, data), load(slot), info(slot) }) for saveSlot / loadSlot
 *   options.bus      optional bus: 'save:saved' { slot }, 'save:loaded' { slot, parts }
 * saves:
 *   register(name, { save(), load(data), version = 1, migrate(data, fromVersion) })   a part of the save
 *   unregister(name)
 *   collect()            -> { v, gameId, parts: { name: { v, data } } }
 *   restore(saved)       hand every part to its plugin. Returns { loaded: [names], missing: [names], skipped: [names] }.
 *   saveSlot(n), loadSlot(n)   through options.slots
 *   parts()              registered names
 */
export function createSaveRegistry(options = {}) {
  const { gameId = 'game', slots = null, bus = null } = options;
  const parts = new Map();
  let orphans = {}; // parts of the last loaded save whose plugin is not here
  const saves = {
    register(name, part) {
      if (typeof name !== 'string' || !name) throw new Error(`saves.register: name must be a non-empty string, got ${JSON.stringify(name)}`);
      if (typeof part?.save !== 'function' || typeof part?.load !== 'function') throw new Error(`saves.register: '${name}' needs save() and load(data) functions`);
      if (parts.has(name)) throw new Error(`saves.register: '${name}' is already registered`);
      parts.set(name, { version: 1, ...part });
    },
    unregister(name) { return parts.delete(name); },
    parts() { return [...parts.keys()]; },
    collect() {
      const out = { v: SAVE_VERSION, gameId, parts: { ...orphans } };
      for (const [name, part] of parts) {
        const data = part.save();
        if (data === undefined) continue;
        try { JSON.stringify(data); } catch (e) { throw new Error(`saves.collect: the '${name}' part is not plain JSON data (${e.message})`); }
        out.parts[name] = { v: part.version, data };
      }
      return out;
    },
    restore(saved) {
      if (!saved || typeof saved !== 'object' || typeof saved.parts !== 'object') throw new Error(`saves.restore: expected a save made by collect(), got ${JSON.stringify(saved)?.slice(0, 80)}`);
      if (saved.v > SAVE_VERSION) throw new Error(`saves.restore: this save is version ${saved.v}, newer than this game understands (${SAVE_VERSION})`);
      if (saved.gameId !== undefined && saved.gameId !== gameId) throw new Error(`saves.restore: this save belongs to '${saved.gameId}', not '${gameId}'`);
      const report = { loaded: [], missing: [], skipped: [] };
      orphans = {};
      for (const [name, entry] of Object.entries(saved.parts)) if (!parts.has(name)) { orphans[name] = entry; report.skipped.push(name); }
      for (const [name, part] of parts) {
        const entry = saved.parts[name];
        if (!entry) { report.missing.push(name); continue; }
        let data = entry.data;
        if (entry.v !== part.version) {
          if (typeof part.migrate !== 'function') throw new Error(`saves.restore: the '${name}' part is version ${entry.v}, the plugin wants ${part.version} and has no migrate()`);
          data = part.migrate(data, entry.v);
        }
        part.load(data);
        report.loaded.push(name);
      }
      return report;
    },
    saveSlot(n) {
      if (!slots) throw new Error('saves.saveSlot: the base was made without save slots (pass saves: core createSaves(...))');
      const ok = slots.save(n, saves.collect());
      bus?.emit('save:saved', { slot: n, ok });
      return ok;
    },
    loadSlot(n) {
      if (!slots) throw new Error('saves.loadSlot: the base was made without save slots (pass saves: core createSaves(...))');
      const data = slots.load(n);
      if (!data) return null;
      const report = saves.restore(data);
      bus?.emit('save:loaded', { slot: n, ...report });
      return report;
    },
  };
  return saves;
}
