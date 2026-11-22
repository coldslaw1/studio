// Menu items: validation and value changes. Pure, no drawing.
//
// Item shapes (plain objects):
//   { id, label }                                         button (type: 'button')
//   { id, label, type: 'toggle', value: true }
//   { id, label, type: 'slider', value: 0.5, min: 0, max: 1, step: 0.1 }
//   { id, label, type: 'choice', value: 'easy', options: ['easy', 'hard'] }
//       options may also be [{ value: 'easy', label: 'Easy' }, ...]
//   { id, label, type: 'key', value: ['KeyW'] }           a key binding the player can change
//   { id, type: 'grid', cells: [{ id, label, icon, count }] }   a grid of slots (inventory)
//   { label, value?, type: 'text' }                       a line of text, not selectable
// Any item may add: disabled: true, icon: 'play', danger: true, hint: 'shown when focused',
//   onSelect(item) (buttons), onChange(value, item) (toggle/slider/choice/key).
// Buttons may add: detail: 'second line', badge: 'short text on the right'.

import { clamp } from './geometry.js';
import { keyLabel } from './keys.js';

const TYPES = ['button', 'toggle', 'slider', 'choice', 'text', 'grid', 'key'];

/** normalizeItem(raw, index) -> a checked copy of the item with defaults filled in. Throws on bad input. */
export function normalizeItem(raw, index) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`menu item ${index}: expected an object, got ${String(raw)}`);
  }
  const item = { type: 'button', disabled: false, ...raw };
  if (!TYPES.includes(item.type)) {
    throw new Error(`menu item ${index}: unknown type "${item.type}". Use one of: ${TYPES.join(', ')}`);
  }
  if (item.type === 'grid' && item.label === undefined) item.label = '';
  if (typeof item.label !== 'string') {
    throw new Error(`menu item ${index}: "label" must be a string, got ${String(item.label)}`);
  }
  if (item.type === 'text') {
    item.id = item.id ?? `text-${index}`;
    return item;
  }
  if (typeof item.id !== 'string' || !item.id) {
    throw new Error(`menu item ${index} ("${item.label}"): "id" must be a non-empty string`);
  }
  if (item.type === 'toggle') item.value = !!item.value;
  if (item.type === 'slider') {
    item.min = item.min ?? 0;
    item.max = item.max ?? 1;
    item.step = item.step ?? (item.max - item.min) / 10;
    if (!(item.max > item.min) || !(item.step > 0)) {
      throw new Error(`menu item "${item.id}": slider needs max > min and step > 0`);
    }
    item.value = snap(item, Number.isFinite(item.value) ? item.value : item.min);
  }
  if (item.type === 'choice') {
    if (!Array.isArray(item.options) || item.options.length === 0) {
      throw new Error(`menu item "${item.id}": choice needs a non-empty "options" array`);
    }
    item.options = item.options.map((o) => (o && typeof o === 'object'
      ? { value: o.value, label: String(o.label ?? o.value) }
      : { value: o, label: String(o) }));
    if (!item.options.some((o) => o.value === item.value)) item.value = item.options[0].value;
  }
  if (item.type === 'key') item.value = cleanKeys(item.value);
  if (item.type === 'grid') normalizeGrid(item);
  return item;
}

/** cleanKeys(value) -> an array of code strings ('KeyW' -> ['KeyW'], bad data -> []). */
export function cleanKeys(value) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  return [...new Set(list.filter((c) => typeof c === 'string' && c !== ''))];
}

function normalizeGrid(item) {
  if (!Array.isArray(item.cells)) {
    throw new Error(`menu item "${item.id}": grid needs a "cells" array`);
  }
  if (item.columns !== undefined && !(Number.isInteger(item.columns) && item.columns > 0)) {
    throw new Error(`menu item "${item.id}": grid "columns" must be a whole number above 0, got ${item.columns}`);
  }
  item.cellSize = item.cellSize ?? 2.6;
  if (!(item.cellSize > 0)) throw new Error(`menu item "${item.id}": grid "cellSize" must be above 0`);
  item.cells = item.cells.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) {
      throw new Error(`menu item "${item.id}": grid cell ${i} needs a string "id"`);
    }
    return { label: '', ...raw };
  });
  item.cursor = clamp(Number.isInteger(item.cursor) ? item.cursor : 0, 0, Math.max(0, item.cells.length - 1));
}

function snap(item, value) {
  const steps = Math.round((clamp(value, item.min, item.max) - item.min) / item.step);
  return clamp(Number((item.min + steps * item.step).toFixed(6)), item.min, item.max);
}

/** isFocusable(item) -> true when the item can be selected (not text, not disabled, not an empty grid). */
export function isFocusable(item) {
  if (item.type === 'grid') return !item.disabled && item.cells.length > 0;
  return item.type !== 'text' && !item.disabled;
}

/**
 * adjustItem(item, dir) -> true when the value changed.
 * dir is -1 (left) or +1 (right). Sliders move one step, choices cycle,
 * toggles flip. Buttons, keys and grids do nothing.
 */
export function adjustItem(item, dir) {
  if (item.disabled) return false;
  const before = item.value;
  if (item.type === 'slider') item.value = snap(item, item.value + dir * item.step);
  if (item.type === 'toggle') item.value = !item.value;
  if (item.type === 'choice') {
    const n = item.options.length;
    const i = item.options.findIndex((o) => o.value === item.value);
    item.value = item.options[(i + dir + n) % n].value;
  }
  return item.value !== before;
}

/** setSliderFraction(item, f) -> true when changed. f is 0..1 along the track. */
export function setSliderFraction(item, f) {
  const before = item.value;
  item.value = snap(item, item.min + clamp(f, 0, 1) * (item.max - item.min));
  return item.value !== before;
}

/** sliderFraction(item) -> 0..1 position of the slider's value. */
export function sliderFraction(item) {
  return (item.value - item.min) / (item.max - item.min);
}

/** displayValue(item) -> the text shown for the item's value ('' for buttons and grids). */
export function displayValue(item) {
  if (item.type === 'toggle') return item.value ? 'On' : 'Off';
  if (item.type === 'choice') return item.options.find((o) => o.value === item.value).label;
  if (item.type === 'slider') {
    if (typeof item.format === 'function') return String(item.format(item.value));
    if (item.min === 0 && item.max === 1) return `${Math.round(item.value * 100)}%`;
    return String(item.value);
  }
  if (item.type === 'key') return item.value.length ? item.value.map(keyLabel).join(' / ') : 'Not set';
  if (item.type === 'text') return item.value === undefined ? '' : String(item.value);
  return '';
}
