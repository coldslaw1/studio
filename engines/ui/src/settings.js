// Game settings: a schema of items, current values, and saving through a store.
// Never touches localStorage itself: pass a store with get(key) / set(key, value)
// (core's saves.settings is one).

import { normalizeItem, cleanKeys } from './items.js';

/** Ready-made settings most games want. Spread into your schema and add your own. */
export const STANDARD_SETTINGS = [
  { id: 'sound', label: 'Sound', type: 'slider', value: 0.8, min: 0, max: 1, step: 0.1 },
  { id: 'music', label: 'Music', type: 'slider', value: 0.6, min: 0, max: 1, step: 0.1 },
  { id: 'reducedMotion', label: 'Reduce motion', type: 'toggle', value: false },
];

/**
 * Accessibility settings that createUi applies by itself: `uiScale` makes
 * everything bigger or smaller, `highContrast` switches to the high contrast
 * theme. Spread into your schema next to STANDARD_SETTINGS.
 */
export const ACCESS_SETTINGS = [
  { id: 'uiScale', label: 'Text size', type: 'slider', value: 1, min: 0.8, max: 1.4, step: 0.1, format: (v) => `${Math.round(v * 100)}%` },
  { id: 'highContrast', label: 'High contrast', type: 'toggle', value: false },
];

/**
 * createSettings(options) -> settings
 *   options: {
 *     schema = STANDARD_SETTINGS,  array of toggle / slider / choice / key items; `value` is the default
 *     store,                       optional { get(key), set(key, value) }; values load from and save to it
 *     key = 'settings',            key used in the store
 *     onChange(id, value, all),    called after every change
 *   }
 * Returns:
 *   settings.get(id)          current value
 *   settings.set(id, value)   change (validated against the schema), saves, calls onChange
 *   settings.values()         a copy of all values, e.g. { sound: 0.8, music: 0.6 }
 *   settings.reset()          back to the defaults
 *   settings.items()          menu items with the current values (used by ui.showSettings)
 *   settings.onChange(fn)     add another listener; returns a function that removes it
 */
export function createSettings(options = {}) {
  const schema = (options.schema ?? STANDARD_SETTINGS).map((raw, i) => {
    const item = normalizeItem(raw, i);
    if (!['toggle', 'slider', 'choice', 'key'].includes(item.type)) {
      throw new Error(`createSettings: setting "${item.id}" must be a toggle, slider or choice (or a key), got "${item.type}"`);
    }
    return item;
  });
  const ids = schema.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new Error('createSettings: two settings share an id');
  const { store, key = 'settings' } = options;
  if (store && (typeof store.get !== 'function' || typeof store.set !== 'function')) {
    throw new Error('createSettings: store must have get(key) and set(key, value)');
  }
  const listeners = [];
  if (typeof options.onChange === 'function') listeners.push(options.onChange);

  const values = {};
  for (const item of schema) values[item.id] = item.value;
  const saved = store ? store.get(key) : null;
  if (saved && typeof saved === 'object') {
    for (const item of schema) {
      if (saved[item.id] !== undefined) values[item.id] = clean(item, saved[item.id]);
    }
  }

  // Run a value through the schema so bad saved data cannot break the game.
  function clean(item, value) {
    if (item.type === 'slider' && !Number.isFinite(value)) return item.value;
    if (item.type === 'key') { const keys = cleanKeys(value); return keys.length ? keys : [...item.value]; }
    return normalizeItem({ ...item, value }, 0).value;
  }
  function find(id, who) {
    const item = schema.find((s) => s.id === id);
    if (!item) throw new Error(`${who}: no setting with id "${id}". Settings: ${ids.join(', ')}`);
    return item;
  }
  function save() {
    if (store) store.set(key, { ...values });
  }

  const settings = {
    get(id) {
      find(id, 'settings.get');
      return values[id];
    },
    set(id, value) {
      const item = find(id, 'settings.set');
      const next = clean(item, value);
      if (next === values[id] || (item.type === 'key' && next.join('|') === values[id].join('|'))) return;
      values[id] = next;
      save();
      for (const fn of [...listeners]) fn(id, next, { ...values });
    },
    values() { return { ...values }; },
    reset() {
      for (const item of schema) settings.set(item.id, item.value);
    },
    items() {
      return schema.map((item) => ({ ...item, value: values[item.id] }));
    },
    onChange(fn) {
      if (typeof fn !== 'function') throw new Error('settings.onChange: expected a function');
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  return settings;
}
