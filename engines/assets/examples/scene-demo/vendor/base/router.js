// The input router: every device comes in at one place and goes out only to the layer that owns
// the focus. A plugin never reads the raw input; it asks for its layer's view of it:
//     const input = base.input.for('game');      // or base.input.game
//     if (input.pressed('attack')) ...
// While a menu, the bag or a dialogue is on top, that view reads as "nothing held, nothing
// pressed, mouse still", so gameplay cannot react, whatever view is showing.
// The mouse parts core's input does not have (buttons, wheel, caught-mouse movement) live here.
import { GAME_LAYER } from './focus.js';

const NO_STICK = Object.freeze({ x: 0, y: 0 });
const BUTTONS = ['left', 'middle', 'right'];
const emptyButtons = () => ({ left: false, middle: false, right: false });

/** An input that never has anything: used when a game gives the base no input (tests, servers). */
export function createNullInput() {
  const pointer = { x: 0, y: 0, down: false, pressed: false, released: false };
  return { down: () => false, pressed: () => false, released: () => false, axis: () => 0, stick: NO_STICK, pointer, lastDevice: null, endUpdate() {} };
}

/**
 * createRouter(options) -> router
 *   options.input   core's input object (createInput). Default: an input with nothing on it.
 *   options.focus   the focus stack (createFocus).
 *   options.getTick () => current tick number.
 * router:
 *   for(layerId)    that layer's view of the input (see below). The same object every time.
 *   game            for('game')
 *   raw             the input given in options (never read it in gameplay code)
 *   mouse           the raw mouse state (tests and the router's own use)
 *   has(action)     is this action bound.   ensure({ action: [codes] })  bind the ones the game did not (plugins' default keys)
 *   attach({ canvas, window })  listen for mouse buttons, wheel, caught-mouse movement. Returns detach().
 *   feed.button(name, down), feed.wheel(steps), feed.move(dx, dy) (mouse movement since the last tick, caught or not), feed.locked(bool)   what attach calls; tests call them directly
 *   lock(layerId)   catch the mouse for a layer. Only the top layer may, and only if its pointer mode is 'locked'. Returns true when asked.
 *   unlock()        let the mouse go
 *   endTick()       call after every tick: clears pressed, released, wheel and movement
 * A layer's view has core's reading API: down(a), pressed(a), released(a), axis(neg, pos), stick,
 * pointer, lastDevice, plus:
 *   active          true while this layer owns the focus
 *   mouse           { left, middle, right: { down, pressed, released }, wheel, dx, dy, locked }
 * Two guards stop a key from leaking between layers: nothing reads as pressed on the tick the
 * focus changed, and a key that was held during the change reads as up until it is let go.
 */
export function createRouter(options = {}) {
  const { focus, getTick = () => 0 } = options;
  if (!focus || typeof focus.owns !== 'function') throw new Error('createRouter: options.focus must be a focus stack (createFocus)');
  const raw = options.input ?? createNullInput();
  for (const m of ['down', 'pressed', 'released']) if (typeof raw[m] !== 'function') throw new Error(`createRouter: options.input.${m} must be a function (pass core's createInput())`);
  const mouse = { down: emptyButtons(), pressed: emptyButtons(), released: emptyButtons(), wheel: 0, dx: 0, dy: 0, locked: false };
  let canvas = null; let doc = null;
  const views = new Map();
  let router = null;
  const stillPointer = { x: 0, y: 0, down: false, pressed: false, released: false };

  // What was held at the moment the focus last changed. Those keys and buttons read as up for
  // every layer until they are let go, so the Enter that closed a menu is not also a "use" in the game.
  const known = new Set(["pointer", ...BUTTONS.map((b) => "mouse:" + b)]); // every name a layer has asked about
  const held = new Set();
  // An action nobody bound reads as "not pressed" instead of throwing, so a plugin's optional keys never break a game.
  const boundCache = new Map();
  const bound = (name) => {
    if (!boundCache.has(name)) boundCache.set(name, typeof raw.bindings === 'function' ? Object.hasOwn(raw.bindings(), name) : true);
    return boundCache.get(name);
  };
  const rawDown = (name) => bound(name) && !!raw.down(name);
  const isDownNow = (name) => (name.startsWith('mouse:') ? mouse.down[name.slice(6)] : name === 'pointer' ? !!raw.pointer?.down : rawDown(name));
  focus.subscribe((top) => {
    held.clear();
    for (const name of known) if (isDownNow(name)) held.add(name);
    if (top.pointer !== 'locked' && mouse.locked) router.unlock(); // a layer that does not want the mouse caught never keeps it
  });

  function makeView(id) {
    const active = () => focus.owns(id);
    const settled = () => focus.changedTick !== getTick();
    /** False while `name` (an action, 'mouse:left', 'pointer') is still held from before the last focus change. */
    function freed(name, isDown) {
      known.add(name);
      if (!held.has(name)) return true;
      if (isDown) return false;
      held.delete(name);
      return true;
    }
    const button = (b) => {
      const isDown = mouse.down[b];
      const ok = active() && freed('mouse:' + b, isDown);
      return { down: ok && isDown, pressed: ok && settled() && mouse.pressed[b], released: ok && mouse.released[b] };
    };
    const mouseView = {
      get left() { return button('left'); }, get middle() { return button('middle'); }, get right() { return button('right'); },
      get wheel() { return active() ? mouse.wheel : 0; },
      get dx() { return active() ? mouse.dx : 0; }, get dy() { return active() ? mouse.dy : 0; },
      get locked() { return active() && mouse.locked; },
    };
    const pointerOut = { x: 0, y: 0, down: false, pressed: false, released: false };
    return {
      id,
      get active() { return active(); },
      down(name) { const d = rawDown(name); return active() && freed(name, d) && d; },
      pressed(name) { return active() && settled() && bound(name) && freed(name, rawDown(name)) && !!raw.pressed(name); },
      released(name) { return active() && bound(name) && !!raw.released(name); },
      axis(neg, pos) { return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0); },
      get stick() { return active() ? (raw.stick ?? NO_STICK) : NO_STICK; },
      get pointer() {
        const p = raw.pointer ?? stillPointer;
        pointerOut.x = p.x; pointerOut.y = p.y; // where the mouse is stays known; what it does is gated
        const ok = active() && freed('pointer', !!p.down);
        pointerOut.down = ok && !!p.down; pointerOut.pressed = ok && settled() && !!p.pressed; pointerOut.released = ok && !!p.released;
        return pointerOut;
      },
      get lastDevice() { return raw.lastDevice ?? null; },
      mouse: mouseView,
    };
  }

  router = {
    raw, mouse,
    for(id) {
      if (typeof id !== 'string' || !id) throw new Error(`input.for: layer id must be a non-empty string, got ${JSON.stringify(id)}`);
      if (!views.has(id)) views.set(id, makeView(id));
      return views.get(id);
    },
    get game() { return router.for(GAME_LAYER); },
    /** True when the game's input has this action. */
    has(name) { return bound(name); },
    /** Bind actions the game has not bound itself: ensure({ 'zoom-in': ['Equal'] }). Existing bindings are kept. Returns the names added. */
    ensure(actions) {
      const added = [];
      if (typeof raw.bind !== 'function' || typeof raw.bindings !== 'function') return added;
      const have = raw.bindings();
      for (const [name, codes] of Object.entries(actions ?? {})) {
        if (Object.hasOwn(have, name)) continue;
        if (!Array.isArray(codes)) throw new Error(`input.ensure: codes for '${name}' must be an array of key codes, got ${JSON.stringify(codes)}`);
        raw.bind(name, codes); added.push(name);
      }
      boundCache.clear();
      return added;
    },
    feed: {
      button(name, down) {
        if (!BUTTONS.includes(name)) throw new Error(`input.feed.button: name must be one of ${BUTTONS.join(', ')}, got ${JSON.stringify(name)}`);
        if (down && !mouse.down[name]) mouse.pressed[name] = true;
        if (!down && mouse.down[name]) mouse.released[name] = true;
        mouse.down[name] = !!down;
      },
      wheel(steps) { mouse.wheel += Math.trunc(steps) || Math.sign(steps) || 0; },
      move(dx, dy) { mouse.dx += dx; mouse.dy += dy; },
      locked(on) { mouse.locked = !!on; },
    },
    lock(id) {
      const top = focus.top;
      if (top.id !== id || top.pointer !== 'locked') return false;
      if (canvas && typeof canvas.requestPointerLock === 'function') { try { const p = canvas.requestPointerLock(); p?.catch?.(() => {}); } catch { /* the browser said no: the game goes on with a free mouse */ } } else mouse.locked = true;
      return true;
    },
    unlock() {
      if (doc && typeof doc.exitPointerLock === 'function' && doc.pointerLockElement) doc.exitPointerLock(); else mouse.locked = false;
    },
    endTick() {
      for (const b of BUTTONS) { mouse.pressed[b] = false; mouse.released[b] = false; }
      mouse.wheel = 0; mouse.dx = 0; mouse.dy = 0;
      raw.endUpdate?.();
    },
    attach(o = {}) {
      const win = o.window ?? globalThis.window;
      canvas = o.canvas ?? null; doc = o.document ?? win?.document ?? null;
      if (!canvas || typeof canvas.addEventListener !== 'function') throw new Error('input.attach: options.canvas must be a <canvas> element');
      const offs = [];
      const on = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); offs.push(() => t.removeEventListener(type, fn, opt)); };
      on(canvas, 'pointerdown', (e) => { if (e.pointerType === 'mouse' || e.pointerType === undefined) router.feed.button(BUTTONS[e.button] ?? 'left', true); });
      on(win, 'pointerup', (e) => { if (e.pointerType === 'mouse' || e.pointerType === undefined) router.feed.button(BUTTONS[e.button] ?? 'left', false); });
      const letGo = () => { for (const b of BUTTONS) router.feed.button(b, false); }; // nothing stays held when nobody is looking
      on(win, 'blur', letGo);
      if (doc) on(doc, 'visibilitychange', () => { if (doc.hidden) letGo(); });
      on(canvas, 'contextmenu', (e) => e.preventDefault());
      let sum = 0; let at = -Infinity; // a trackpad sends many small scrolls: add them up to whole notches
      on(canvas, 'wheel', (e) => {
        // Chrome and Edge on Windows send a Shift + wheel as a sideways scroll (deltaX, with deltaY 0): it is still the wheel
        const raw = e.deltaY || (e.shiftKey ? e.deltaX : 0);
        const delta = raw * (e.deltaMode === 1 ? 100 / 3 : e.deltaMode === 2 ? 100 : 1);
        if (!delta) return;
        e.preventDefault();
        if (e.timeStamp - at > 250 || Math.sign(delta) !== Math.sign(sum)) sum = 0;
        at = e.timeStamp; const before = sum; sum += delta;
        const steps = before === 0 ? Math.sign(delta) : Math.trunc(sum / 100) - Math.trunc(before / 100);
        if (steps) router.feed.wheel(steps);
      }, { passive: false });
      on(win, 'mousemove', (e) => router.feed.move(e.movementX || 0, e.movementY || 0)); // caught or not: views and the camera use it for looking and dragging
      if (doc) on(doc, 'pointerlockchange', () => router.feed.locked(doc.pointerLockElement === canvas));
      return () => { for (const off of offs) off(); canvas = null; doc = null; };
    },
  };
  return router;
}
