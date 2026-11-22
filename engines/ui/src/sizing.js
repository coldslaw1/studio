// Which device the player is using, and how big the UI should be for it.
// Pure: reads only the input object it is given.

import { clamp, unitFor } from './geometry.js';

/** Devices the kit tells apart. */
export const DEVICES = ['touch', 'mouse', 'keyboard', 'gamepad'];

// Share of the finger-sized unit each device gets when the real screen size is not known.
const FACTOR = { touch: 1, gamepad: 0.8, mouse: 0.62, keyboard: 0.62 };
// Unit in CSS pixels when it is known: rows are 2.5 units, so 47, 42 and 36 pixels tall.
const CSS_UNIT = { touch: 19, gamepad: 17, mouse: 14.5, keyboard: 14.5 };

/**
 * autoUnit(width, height, device, displayScale) -> the UI unit in logical pixels.
 *   device: one of DEVICES. displayScale: CSS pixels per logical pixel (how much
 *   the canvas is stretched on screen), or undefined when not known.
 * Touch keeps finger-sized rows; mouse, keyboard and gamepad get smaller ones.
 */
export function autoUnit(width, height, device, displayScale) {
  if (!DEVICES.includes(device)) throw new Error(`autoUnit: unknown device "${device}". Use one of: ${DEVICES.join(', ')}`);
  const base = unitFor(width, height);
  if (displayScale > 0) return clamp(CSS_UNIT[device] / displayScale, base * 0.45, base * 1.25);
  return base * FACTOR[device];
}

/**
 * createDeviceTracker(options) -> tracker
 *   options.coarse: true when the main pointer is a finger, false for a mouse,
 *                   undefined when not known (createUi reads it from matchMedia).
 *   tracker.device              the device in use now
 *   tracker.read(input, names)  call once per update; returns true when the device changed.
 *                               names: action names to watch when input has no lastDevice.
 * A pointer that moves without being pressed is a mouse. A press that lands
 * somewhere new with no movement before it is a finger.
 */
export function createDeviceTracker(options = {}) {
  const coarse = options.coarse;
  let pointerKind = coarse === false ? 'mouse' : 'touch';
  let last = null; // last pointer position seen
  let lastDevice;
  const tracker = {
    device: pointerKind,
    read(input, names = []) {
      const before = tracker.device;
      const p = input.pointer;
      let usedPointer = false;
      if (p) {
        const movedTo = last && (p.x !== last.x || p.y !== last.y);
        if (p.pressed) {
          if (movedTo && coarse !== false) pointerKind = 'touch';
          usedPointer = true;
        } else if (!p.down && !p.released && movedTo) {
          pointerKind = 'mouse';
          usedPointer = true;
        }
        last = { x: p.x, y: p.y };
      }
      if (input.lastDevice !== undefined) {
        const now = input.lastDevice;
        if (usedPointer || (now === 'pointer' && now !== lastDevice)) tracker.device = pointerKind;
        else if ((now === 'keyboard' || now === 'gamepad') && (now !== lastDevice || names.some((n) => input.pressed(n)))) tracker.device = now;
        lastDevice = now;
      } else if (usedPointer) {
        tracker.device = pointerKind;
      } else if (names.some((n) => input.pressed(n))) {
        tracker.device = 'keyboard';
      }
      return tracker.device !== before;
    },
  };
  return tracker;
}
