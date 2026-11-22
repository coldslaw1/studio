// Key rebinding glue between settings (createSettings) and core's input.
// The settings menu shows a "key" row per action; these helpers build those
// rows from the input's current bindings and push changes back into it.

import { isKeyboardCode } from './keys.js';

const PREFIX = 'key:';

/**
 * controlsSchema(input, labels) -> array of key settings, one per action.
 *   input: core's input (needs input.bindings()).
 *   labels: { actionName: 'Label shown in the menu' }, e.g. { jump: 'Jump', left: 'Move left' }
 * Spread the result into createSettings({ schema: [...] }). Setting ids are 'key:<action>'.
 */
export function controlsSchema(input, labels) {
  if (!input || typeof input.bindings !== 'function') throw new Error('controlsSchema: input must have bindings() (core\'s input)');
  if (!labels || typeof labels !== 'object') throw new Error('controlsSchema: labels must be an object like { jump: "Jump" }');
  const bound = input.bindings();
  return Object.entries(labels).map(([action, text]) => {
    if (!bound[action]) throw new Error(`controlsSchema: the input has no action "${action}". Known: ${Object.keys(bound).join(', ')}`);
    return { id: PREFIX + action, label: String(text), type: 'key', value: bound[action].filter(isKeyboardCode) };
  });
}

/**
 * applyControls(settings, input) -> stop()
 * Binds every 'key:<action>' setting into the input now and again whenever
 * one changes. Gamepad, swipe and tap codes of each action are kept as they are.
 */
export function applyControls(settings, input) {
  if (!settings || typeof settings.values !== 'function') throw new Error('applyControls: settings must come from createSettings');
  if (!input || typeof input.bind !== 'function' || typeof input.bindings !== 'function') {
    throw new Error('applyControls: input must have bind(action, codes) and bindings() (core\'s input)');
  }
  function bind(id, keys) {
    if (!id.startsWith(PREFIX) || !Array.isArray(keys)) return;
    const action = id.slice(PREFIX.length);
    const others = (input.bindings()[action] || []).filter((code) => !isKeyboardCode(code));
    input.bind(action, [...keys, ...others]);
  }
  for (const [id, value] of Object.entries(settings.values())) bind(id, value);
  return settings.onChange((id, value) => bind(id, value));
}
