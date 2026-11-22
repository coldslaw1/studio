// Action input. Games ask "is `jump` down?", never "is the space key down?".
// Keyboard, touch/mouse and gamepad all turn into string CODES, and each
// action is bound to a list of codes.
//
// Codes:
//   keyboard  KeyboardEvent.code: 'ArrowLeft', 'KeyA', 'Space', 'Enter', 'Escape', 'Digit1' ...
//   pointer   'pointer' (held while a finger or mouse button is down),
//             'tap', 'swipe:left', 'swipe:right', 'swipe:up', 'swipe:down' (one update long)
//   gamepad   (standard-mapping pads only, see pollGamepad)
//             'pad:a' 'pad:b' 'pad:x' 'pad:y' 'pad:lb' 'pad:rb' 'pad:lt' 'pad:rt'
//             'pad:select' 'pad:start' 'pad:ls' 'pad:rs'
//             'pad:up' 'pad:down' 'pad:left' 'pad:right' (d-pad OR left stick pushed past half)
//   custom    anything you feed with input.press(code) / input.release(code),
//             e.g. an on-screen button 'btn:jump'

/** Ready-made bindings for the standard action names. Spread and extend them. */
export const DEFAULT_ACTIONS = Object.freeze({
  up: ['ArrowUp', 'KeyW', 'pad:up', 'swipe:up'],
  down: ['ArrowDown', 'KeyS', 'pad:down', 'swipe:down'],
  left: ['ArrowLeft', 'KeyA', 'pad:left', 'swipe:left'],
  right: ['ArrowRight', 'KeyD', 'pad:right', 'swipe:right'],
  confirm: ['Enter', 'Space', 'pad:a', 'tap'],
  cancel: ['Escape', 'Backspace', 'pad:b'],
  pause: ['KeyP', 'pad:start'],
});

const STICK_CENTRE = 0.2; // a stick this close to the middle counts as centred
const PAD_BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'select', 'start', 'ls', 'rs', 'up', 'down', 'left', 'right'];

/**
 * createInput(options) -> input
 * options:
 *   actions   { actionName: [code, ...] }. Default DEFAULT_ACTIONS.
 *   deadzone  stick values smaller than this read as 0. Default 0.25.
 * Reading (call inside scene.update):
 *   input.down(action)       true while any bound code is held
 *   input.pressed(action)    true only in the first update after it went down
 *   input.released(action)   true only in the first update after it went up
 *   input.axis(neg, pos)     -1, 0 or 1 from two actions, e.g. axis('left', 'right')
 *   input.stick              { x, y } left gamepad stick, -1..1, y down is positive
 *   input.pointer            { x, y, down, pressed, released } in logical pixels
 *   input.lastDevice         'keyboard' | 'pointer' | 'gamepad' | null
 * Setup:
 *   input.bind(action, codes)    replace the codes of one action (key rebinding)
 *   input.bindings()             copy of { action: [codes] }
 *   input.onFirstGesture(fn)     fn() runs once, on the first key/tap/button (start audio here)
 * Feeding (done for you by attachInput / createGame; use directly in tests):
 *   input.press(code), input.release(code), input.pulse(code), input.releaseAll()
 *   input.movePointer(x, y), input.setStick(x, y)
 *   input.endUpdate()            call after every update: clears pressed/released
 */
export function createInput(options = {}) {
  const deadzone = options.deadzone ?? 0.25;
  const actions = new Map();
  const held = new Set();      // codes down now
  const wentDown = new Set();  // codes pressed since last endUpdate
  const wentUp = new Set();    // codes released since last endUpdate
  const pulses = new Set();    // codes to auto-release at the next endUpdate
  const gestureFns = [];
  let hadGesture = false;

  const input = {
    stick: { x: 0, y: 0 },
    pointer: { x: 0, y: 0, down: false, pressed: false, released: false },
    lastDevice: null,
    _pads: new Map(), // private: what pollGamepad has learned about each gamepad

    bind(action, codes) {
      if (typeof action !== 'string' || !action) throw new Error('input.bind: action must be a non-empty string');
      if (!Array.isArray(codes) || codes.some((c) => typeof c !== 'string' || !c)) {
        throw new Error(`input.bind: codes for "${action}" must be an array of strings`);
      }
      actions.set(action, [...codes]);
    },
    bindings() {
      const out = {};
      for (const [a, codes] of actions) out[a] = [...codes];
      return out;
    },
    down: (action) => codesOf(action, 'down').some((c) => held.has(c)),
    pressed: (action) => codesOf(action, 'pressed').some((c) => wentDown.has(c)),
    released(action) {
      const codes = codesOf(action, 'released');
      return codes.some((c) => wentUp.has(c)) && !codes.some((c) => held.has(c));
    },
    axis: (neg, pos) => (input.down(pos) ? 1 : 0) - (input.down(neg) ? 1 : 0),
    isBound(code) {
      for (const codes of actions.values()) if (codes.includes(code)) return true;
      return false;
    },
    onFirstGesture(fn) {
      if (typeof fn !== 'function') throw new Error('input.onFirstGesture: fn must be a function');
      if (hadGesture) fn();
      else gestureFns.push(fn);
    },

    press(code) {
      gesture();
      if (held.has(code)) return; // key auto-repeat
      held.add(code);
      wentDown.add(code);
      if (code === 'pointer') { input.pointer.down = true; input.pointer.pressed = true; }
    },
    release(code) {
      if (!held.has(code)) return;
      held.delete(code);
      wentUp.add(code);
      if (code === 'pointer') { input.pointer.down = false; input.pointer.released = true; }
    },
    pulse(code) {
      input.press(code);
      pulses.add(code);
    },
    releaseAll() {
      for (const code of [...held]) input.release(code);
      input.stick.x = 0;
      input.stick.y = 0;
    },
    movePointer(x, y) {
      input.pointer.x = x;
      input.pointer.y = y;
    },
    setStick(x, y) {
      input.stick.x = Math.abs(x) < deadzone ? 0 : Math.max(-1, Math.min(1, x));
      input.stick.y = Math.abs(y) < deadzone ? 0 : Math.max(-1, Math.min(1, y));
    },
    endUpdate() {
      wentDown.clear();
      wentUp.clear();
      input.pointer.pressed = false;
      input.pointer.released = false;
      for (const code of pulses) {
        held.delete(code);
        wentUp.add(code);
      }
      pulses.clear();
    },
  };

  function codesOf(action, fn) {
    const codes = actions.get(action);
    if (!codes) {
      throw new Error(`input.${fn}: unknown action "${action}". Known: ${[...actions.keys()].join(', ')}`);
    }
    return codes;
  }
  function gesture() {
    if (hadGesture) return;
    hadGesture = true;
    for (const fn of gestureFns.splice(0)) fn();
  }

  const initial = options.actions || DEFAULT_ACTIONS;
  for (const name of Object.keys(initial)) input.bind(name, initial[name]);
  return input;
}

/**
 * attachInput(input, options) -> detach()
 * Connects real browser events to an input object. createGame calls this for you.
 * options:
 *   target      receives key events. Default window.
 *   document    watched for the page being hidden (all keys are released). Default target.document.
 *   canvas      receives pointer events. Optional (no touch/mouse without it).
 *   toLogical   (clientX, clientY) => { x, y } in logical pixels. Default: canvas-relative CSS pixels.
 *   swipeMin    logical pixels a drag must travel to count as a swipe. Default 30.
 *   tapMax      longest tap in milliseconds. Default 400.
 */
export function attachInput(input, options = {}) {
  const target = options.target || globalThis.window;
  const canvas = options.canvas || null;
  const swipeMin = options.swipeMin ?? 30;
  const tapMax = options.tapMax ?? 400;
  const toLogical = options.toLogical || ((cx, cy) => {
    const r = canvas.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  });
  const offs = [];
  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    offs.push(() => el.removeEventListener(type, fn, opts));
  };

  on(target, 'keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (input.isBound(e.code)) e.preventDefault();
    if (e.repeat) return;
    input.lastDevice = 'keyboard';
    input.press(e.code);
  });
  on(target, 'keyup', (e) => input.release(e.code));
  on(target, 'blur', () => input.releaseAll());
  // A hidden page gets no keyup events, so held keys would stay down forever.
  on(target, 'pagehide', () => input.releaseAll());
  const doc = options.document || target.document || null;
  if (doc && typeof doc.addEventListener === 'function') {
    on(doc, 'visibilitychange', () => { if (doc.hidden || doc.visibilityState === 'hidden') input.releaseAll(); });
  }

  if (canvas) {
    let start = null;
    on(canvas, 'pointerdown', (e) => {
      const p = toLogical(e.clientX, e.clientY);
      input.lastDevice = 'pointer';
      input.movePointer(p.x, p.y);
      input.press('pointer');
      start = { x: p.x, y: p.y, t: e.timeStamp, id: e.pointerId };
      // Capture keeps a drag alive outside the canvas. It throws InvalidStateError
      // while the pointer is locked (first-person view), where it is not needed.
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* pointer is locked */ }
      e.preventDefault();
    });
    on(canvas, 'pointermove', (e) => {
      const p = toLogical(e.clientX, e.clientY);
      input.movePointer(p.x, p.y);
    });
    const end = (e, cancelled) => {
      const p = toLogical(e.clientX, e.clientY);
      input.movePointer(p.x, p.y);
      input.release('pointer');
      if (start && !cancelled) {
        const gesture = classifyGesture(p.x - start.x, p.y - start.y, e.timeStamp - start.t, swipeMin, tapMax);
        if (gesture) input.pulse(gesture);
      }
      start = null;
    };
    on(canvas, 'pointerup', (e) => end(e, false));
    on(canvas, 'pointercancel', (e) => end(e, true));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  return () => { for (const off of offs.splice(0)) off(); };
}

/**
 * classifyGesture(dx, dy, ms, swipeMin, tapMax) -> 'tap' | 'swipe:left' | ... | null
 * Pure helper behind tap and swipe detection.
 */
export function classifyGesture(dx, dy, ms, swipeMin = 30, tapMax = 400) {
  const dist = Math.hypot(dx, dy);
  if (dist >= swipeMin) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'swipe:left' : 'swipe:right';
    return dy < 0 ? 'swipe:up' : 'swipe:down';
  }
  return ms <= tapMax ? 'tap' : null;
}

/**
 * pollGamepad(input, pads) -> true if at least one usable gamepad was read
 * Call once per frame BEFORE the updates. createGame does this for you.
 * pads: the result of navigator.getGamepads().
 *
 * Rules that keep ghost and virtual pads (VR runtimes, emulated controllers)
 * from walking or confirming on their own:
 *   - only connected pads with mapping === 'standard' count; all of them are combined
 *   - a button counts only after that pad has shown it RELEASED once
 *   - the stick counts only after that pad has shown it CENTRED once
 *   - a pad that disappears stops counting at once: its buttons are released
 *     and its stick reads 0 on the same call
 */
export function pollGamepad(input, pads) {
  const seen = input._pads; // Map: pad.index -> { id, buttons: [armed...], stick: armed }
  const state = {};
  for (const name of PAD_BUTTONS) state[name] = false;
  let sx = 0;
  let sy = 0;
  let any = false;
  const present = new Set();

  for (const pad of pads || []) {
    if (!pad || pad.connected === false || pad.mapping !== 'standard') continue;
    any = true;
    const key = pad.index ?? 0;
    present.add(key);
    let mem = seen.get(key);
    if (!mem || mem.id !== pad.id) { // new pad in this slot: nothing is trusted yet
      mem = { id: pad.id, buttons: PAD_BUTTONS.map(() => false), stick: false };
      seen.set(key, mem);
    }
    PAD_BUTTONS.forEach((name, i) => {
      const b = pad.buttons?.[i];
      const isDown = !!b && (typeof b === 'object' ? !!b.pressed || b.value > 0.5 : b > 0.5);
      if (!isDown) mem.buttons[i] = true;
      else if (mem.buttons[i]) state[name] = true;
    });
    const lx = Number(pad.axes?.[0]) || 0;
    const ly = Number(pad.axes?.[1]) || 0;
    if (Math.abs(lx) < STICK_CENTRE && Math.abs(ly) < STICK_CENTRE) mem.stick = true;
    else if (mem.stick && Math.hypot(lx, ly) > Math.hypot(sx, sy)) { sx = lx; sy = ly; }
  }
  for (const key of [...seen.keys()]) if (!present.has(key)) seen.delete(key);

  input.setStick(sx, sy);
  state.left = state.left || sx < -0.5;
  state.right = state.right || sx > 0.5;
  state.up = state.up || sy < -0.5;
  state.down = state.down || sy > 0.5;
  let active = input.stick.x !== 0 || input.stick.y !== 0;
  for (const name of PAD_BUTTONS) {
    if (state[name]) { active = true; input.press(`pad:${name}`); }
    else input.release(`pad:${name}`);
  }
  if (active) input.lastDevice = 'gamepad';
  return any;
}
