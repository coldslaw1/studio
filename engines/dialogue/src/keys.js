// Number keys for dialogue answers. The box numbers the choices "1. 2. 3.", and
// these actions let the player press that number (top row or number pad).

const names = [];
const table = {};
for (let n = 1; n <= 9; n++) { names.push(`choice${n}`); table[`choice${n}`] = Object.freeze([`Digit${n}`, `Numpad${n}`]); }

/**
 * The actions the dialogue box reads for number keys, with their default key codes:
 * { choice1: ['Digit1', 'Numpad1'], ..., choice9: ['Digit9', 'Numpad9'] }.
 * Core games get them bound automatically by the box; a game may also spread them into
 * its own actions to change the keys. On the base, the dialogue plugin declares them.
 */
export const CHOICE_ACTIONS = Object.freeze(table);

/**
 * Bind the choice actions on a core input object, leaving any the game already bound.
 * Does nothing for inputs that cannot bind (a base layer input, a test fake).
 * @param {object} input core's input object
 * @returns {string[]} the action names that were bound by this call
 */
export function bindChoiceActions(input) {
  if (!input || typeof input.bind !== 'function' || typeof input.bindings !== 'function') return [];
  const bound = input.bindings();
  const added = [];
  for (const name of names) {
    if (Object.hasOwn(bound, name)) continue;
    input.bind(name, [...CHOICE_ACTIONS[name]]);
    added.push(name);
  }
  return added;
}

/**
 * Which numbered choice was pressed this update?
 * @param {object} input an input object with pressed(action)
 * @param {number} count how many choices are on screen
 * @param {Set<string>} [unbound] names found unbound earlier; they are skipped (and added to)
 * @returns {number} 0-based index of the choice, or -1 when none was pressed
 */
export function pressedChoice(input, count, unbound = new Set()) {
  for (let i = 0; i < Math.min(names.length, count); i++) {
    if (unbound.has(names[i])) continue;
    try {
      if (input.pressed(names[i])) return i;
    } catch {
      unbound.add(names[i]); // this input has no such action (core throws for unknown ones)
    }
  }
  return -1;
}
