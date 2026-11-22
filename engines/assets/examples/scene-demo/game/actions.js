// The demo's input map for core's input: every key the game reads is an action here.
// Codes are KeyboardEvent.code, 'pad:<button>' for a gamepad. The pointer is left out of walking
// and of confirm on purpose: dragging on the picture turns the camera, and a click walks there.

import { CHOICE_ACTIONS } from '../vendor/dialogue/index.js';

/** Action name to the codes that fire it. Give it to core's createGame as `actions`. */
export const ACTIONS = Object.freeze({
  up: ['ArrowUp', 'KeyW', 'pad:up'],
  down: ['ArrowDown', 'KeyS', 'pad:down'],
  left: ['ArrowLeft', 'KeyA', 'pad:left'],
  right: ['ArrowRight', 'KeyD', 'pad:right'],
  confirm: ['Enter', 'Space', 'pad:a'],
  cancel: ['Escape', 'Backspace', 'pad:b'],
  pause: ['KeyP', 'pad:start'],
  run: ['ShiftLeft', 'ShiftRight', 'pad:rt'],
  attack: ['KeyJ', 'pad:x'],
  // fighting, as in the combat engine's demo (its Shift, Space, F and Q are this game's run, talk, quest stone and camera):
  block: ['KeyK', 'KeyH', 'pad:lb'],
  dodge: ['KeyL', 'KeyN', 'pad:lt'], // (Ctrl cannot be an action key: core leaves Ctrl combinations to the browser)
  axe: ['KeyU', 'pad:rb'],
  swap: ['KeyZ', 'pad:y'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'], slot6: ['Digit6'],
  // in a conversation the number keys (top row or number pad) pick the answer with that number: the dialogue box reads them
  ...CHOICE_ACTIONS,
  throw: ['KeyF'],
  wave: ['KeyG'],
  fall: ['KeyY'],
  log: ['KeyM', 'pad:select'],
  bot: ['KeyB'],
  inventory: ['KeyI', 'Tab'],
  fly: ['KeyX'],
  reset: ['KeyR'],
  hint: ['KeyH'],
  depth: ['KeyO'],
  crt: ['KeyC'],
  'camera-left': ['KeyQ'],
  'camera-right': ['KeyE'],
  'zoom-in': ['Equal', 'NumpadAdd'],
  'zoom-out': ['Minus', 'NumpadSubtract'],
  'camera-reset': ['Digit0', 'Numpad0'],
});

/** The controls list shown in the game's Controls menu: [keys, what they do]. */
export const CONTROLS = [
  ['Arrows / WASD', 'Walk (Shift: run)'],
  ['Click the ground', 'Walk there, or attack toward the mouse when an enemy is near'],
  ['J or click', 'Attack. Again while the blow lands: the next blow of the combo'],
  ['K, H or right click', 'Hold to block. Raised just before a blow lands: a parry'],
  ['L, N or Space', 'Dodge roll the way you walk (Space only in a fight, when there is nothing to talk to)'],
  ['U', 'Throw an axe at the mouse. Walk over it to take it back'],
  ['Z', 'Swap the weapon in hand'],
  ['1 to 6 or the wheel', 'Pick a hotbar slot: a weapon to swing, or food and tea for F'],
  ['1 to 9 while talking', 'Pick the answer with that number'],
  ['Space / Enter', 'Talk, pick up, use'],
  ['F', 'Use the picked food or tea; else throw an axe at an enemy near by; in the hamlet, else throw a stone'],
  ['G / Y', 'Wave / fall down and get up'],
  ['Q, E or drag', 'Turn the camera'],
  ['Shift + wheel, + and -', 'Zoom (0: first view)'],
  ['V', 'Next view: isometric, first person, orbit'],
  ['I / Tab', 'Bag: use, equip, drop'],
  ['L', 'Quest log'],
  ['X (open world)', 'Fly through everything'],
  ['B', 'Auto-play on and off (the quest in the hamlet, wandering in the open world)'],
  ['R / H (cellar)', 'Start the room again / hint'],
  ['O', 'Depth sorting on and off'],
  ['C', 'CRT filter on and off'],
  ['P / Esc', 'Pause menu'],
];
