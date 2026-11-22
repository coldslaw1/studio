// The settings registry: every plugin declares the settings it understands, the settings screen is
// built from the list, and a change reaches every plugin that watches it. A plugin that starts
// late is told the current value at once, so nothing has to be "applied again" by hand.

const TYPES = ['toggle', 'slider', 'choice', 'key', 'text'];
const optionValue = (o) => (o !== null && typeof o === 'object' ? o.value : o);

/** Settings every game has, with one agreed meaning. Plugins watch these ids instead of inventing their own. */
export const SHARED_SETTINGS = Object.freeze([
  { id: 'sound', label: 'Sound', type: 'slider', value: 0.8, min: 0, max: 1, step: 0.1 },
  { id: 'music', label: 'Music', type: 'slider', value: 0.6, min: 0, max: 1, step: 0.1 },
  { id: 'detail', label: 'Detail', type: 'choice', value: 'medium', options: ['low', 'medium', 'high'] },
  { id: 'fps', label: 'Frame rate', type: 'choice', value: 'balanced', options: [{ value: 'low', label: 'low (30)' }, { value: 'balanced', label: 'balanced (72)' }, { value: 'full', label: 'full (screen rate)' }] },
  { id: 'reducedMotion', label: 'Reduced motion', type: 'toggle', value: false },
]);

/**
 * createSettingsRegistry(options) -> settings
 *   options.store   optional { get(key), set(key, value) } (core's saves.settings). Values load from and save to it.
 *   options.key     key in the store. Default 'base.settings'.
 *   options.bus     optional bus: 'settings:changed' { id, value, previous } after every change.
 * settings:
 *   declare(items, owner)   add settings. item: { id, label, type: 'toggle'|'slider'|'choice'|'key'|'text', value (the default),
 *                           options (choice), min, max, step (slider), group }. A 'key' value is an array of key codes. Declaring the same id twice with the same type is
 *                           allowed (two plugins share it); a different type throws. A value kept in the store from an earlier run is taken up here.
 *   get(id)                 the current value
 *   set(id, value)          validate, store, tell every watcher. Returns the value now set.
 *   watch(id, fn)           fn(value, id) now (if the setting is declared) and on every change. Returns a function that stops it.
 *                           Watching before the setting is declared is fine: fn runs when it is declared.
 *   watchAll(fn)            fn(id, value) on every change (not replayed)
 *   has(id), schema()       is it declared; a copy of every item with its current `value`, in declaration order
 *   values()                { id: value }
 *   reset()                 everything back to its default
 */
export function createSettingsRegistry(options = {}) {
  const { store = null, key = 'base.settings', bus = null } = options;
  const items = new Map(); const values = new Map(); const watchers = new Map(); const all = [];
  let kept = {};
  if (store) { const got = store.get(key); if (got && typeof got === 'object') kept = { ...got }; }
  const persist = () => { if (store) store.set(key, { ...kept, ...Object.fromEntries(values) }); };

  function valid(item, value, who) {
    const bad = (why) => new Error(`${who}: '${item.id}' ${why}, got ${JSON.stringify(value)}`);
    if (item.type === 'toggle') { if (typeof value !== 'boolean') throw bad('is a toggle and takes true or false'); return value; }
    if (item.type === 'slider') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw bad('is a slider and takes a number');
      return Math.min(item.max ?? 1, Math.max(item.min ?? 0, value));
    }
    if (item.type === 'choice') {
      const allowed = (item.options ?? []).map(optionValue);
      if (!allowed.includes(value)) throw bad(`must be one of ${allowed.map((v) => JSON.stringify(v)).join(', ')}`);
      return value;
    }
    if (item.type === 'key') { // the key codes bound to an action, as the ui kit keeps them
      if (!Array.isArray(value) || !value.length || value.some((k) => typeof k !== 'string' || !k)) throw bad('is a key setting and takes an array of key codes, e.g. ["KeyJ"]');
      return [...value];
    }
    if (typeof value !== 'string') throw bad('is a text setting and takes a string');
    return value;
  }
  function tell(id, value, previous) {
    for (const fn of (watchers.get(id) ?? []).slice()) fn(value, id);
    for (const fn of all.slice()) fn(id, value);
    bus?.emit('settings:changed', { id, value, previous });
  }
  const settings = {
    declare(list, owner = 'game') {
      if (!Array.isArray(list)) throw new Error(`settings.declare: expected an array of items, got ${typeof list}`);
      for (const item of list) {
        if (!item || typeof item.id !== 'string' || !item.id) throw new Error(`settings.declare: every item needs an id, got ${JSON.stringify(item)}`);
        if (!TYPES.includes(item.type)) throw new Error(`settings.declare: '${item.id}' type must be one of ${TYPES.join(', ')}, got ${JSON.stringify(item.type)}`);
        const had = items.get(item.id);
        if (had) {
          if (had.type !== item.type) throw new Error(`settings.declare: '${item.id}' is already declared by ${had.owner} as a ${had.type}, ${owner} wants a ${item.type}`);
          continue;
        }
        const made = { ...item, owner };
        valid(made, item.value, 'settings.declare');
        items.set(item.id, made);
        let value = item.value;
        if (Object.hasOwn(kept, item.id)) { try { value = valid(made, kept[item.id], 'settings'); } catch { /* a stored value that no longer fits: use the default */ } }
        values.set(item.id, value);
        for (const fn of (watchers.get(item.id) ?? []).slice()) fn(value, item.id); // those who watched before it existed
      }
    },
    get(id) {
      if (!items.has(id)) throw new Error(`settings.get: no setting '${id}' (declared: ${[...items.keys()].join(', ') || 'none'})`);
      return values.get(id);
    },
    set(id, value) {
      const item = items.get(id);
      if (!item) throw new Error(`settings.set: no setting '${id}' (declared: ${[...items.keys()].join(', ') || 'none'})`);
      const next = valid(item, value, 'settings.set');
      const previous = values.get(id);
      if (next === previous || (Array.isArray(next) && Array.isArray(previous) && next.join('|') === previous.join('|'))) return previous;
      values.set(id, next);
      persist();
      tell(id, next, previous);
      return next;
    },
    watch(id, fn) {
      if (typeof fn !== 'function') throw new Error(`settings.watch: listener for '${id}' must be a function`);
      if (!watchers.has(id)) watchers.set(id, []);
      watchers.get(id).push(fn);
      if (items.has(id)) fn(values.get(id), id);
      return () => { const l = watchers.get(id); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
    },
    watchAll(fn) { all.push(fn); return () => { const i = all.indexOf(fn); if (i >= 0) all.splice(i, 1); }; },
    has(id) { return items.has(id); },
    schema() { return [...items.values()].map((item) => ({ ...item, value: values.get(item.id) })); },
    values() { return Object.fromEntries(values); },
    reset() { for (const item of items.values()) settings.set(item.id, item.value); },
  };
  return settings;
}
