// createUi: the one object a game talks to. It owns a stack of menus, the HUD,
// the dialogue box, tooltips and toasts, reads input once per update, and draws
// everything on top of the game.

import { createTheme } from './theme.js';
import { createSkin } from './skin.js';
import { unitFor } from './geometry.js';
import { createMenu } from './menu.js';
import { createHud } from './hud.js';
import { createToasts } from './toast.js';
import { createTooltip } from './tooltip.js';
import { createDialogue } from './dialogue.js';
import { createDeviceTracker, autoUnit } from './sizing.js';
import { titleOptions, pauseOptions, settingsOptions, messageOptions, resultsOptions } from './screens.js';
import { openSaves } from './saves-screen.js';
import { createScreen } from './screen.js';
import { drawUi, describeFocus } from './ui-draw.js';
import { createWheelListener } from './wheel.js';
import { createInputReader, ACTIONS } from './ui-input.js';

const NO_SAFE = { top: 0, right: 0, bottom: 0, left: 0 };
const GHOST_TIME = 0.14; // seconds a closed menu takes to fade away

/**
 * createUi(options) -> ui
 *   options: {
 *     width, height,        logical canvas size in pixels (required; call ui.resize when it changes)
 *     theme = 'midnight',   theme name or object (see createTheme)
 *     skin,                 instead of theme: a look made for this game, { genre, style, palette, accent }
 *                           (see createSkin)
 *     game,                 what the game has, so screens offer it by themselves:
 *                           { saves, saveData(), onLoad(slot, data), slotName(slot), describe(data), skipSave: [1] }
 *     settings,             optional settings object (createSettings). Its 'theme', 'reducedMotion',
 *                           'uiScale' and 'highContrast' values, if present, are applied automatically.
 *     safeArea,             optional { top, right, bottom, left } pixels to keep clear (phone notches)
 *     sizing = 'fixed',     'fixed': finger-sized rows everywhere. 'auto': finger-sized for touch,
 *                           smaller for mouse, keyboard and gamepad, following the device in use.
 *     scale = 1,            multiplies every size (with 'fixed', 0.6 suits a mouse-and-keyboard game)
 *     displayScale,         with 'auto': CSS pixels per logical pixel (number, or function returning it)
 *     coarse,               with 'auto': true if the main pointer is a finger (default: asks matchMedia)
 *     hints = false,        true shows a line of control hints under menus (keyboard and gamepad)
 *     announce(text),       optional: called with what a screen reader should say (focus, toasts)
 *     keyTarget,            where key presses are heard while a key row waits (default: window)
 *     wheelTarget,          where the mouse wheel is heard while a menu or screen is open (default: window)
 *   }
 * See README.md for the full list of ui methods.
 */
export function createUi(options = {}) {
  const sizing = options.sizing ?? 'fixed';
  if (sizing !== 'fixed' && sizing !== 'auto') throw new Error(`createUi: sizing must be 'fixed' or 'auto', got "${sizing}"`);
  let scale = options.scale ?? 1;
  if (!(scale > 0)) throw new Error(`createUi: scale must be a number above 0, got ${scale}`);
  const media = globalThis.matchMedia;
  const coarse = options.coarse ?? (typeof media === 'function' ? !!media.call(globalThis, '(pointer: coarse)').matches : undefined);
  const tracker = createDeviceTracker({ coarse });
  let baseTheme = options.skin ? createSkin(options.skin) : (options.theme ?? 'midnight');
  const game = options.game || null;
  let highContrast = false;
  let theme = null;
  let width = 0;
  let height = 0;
  let unit = 0;
  let safe = { ...NO_SAFE, ...(options.safeArea || {}) };
  let view = null; // the viewport object handed to menus, HUD and the rest
  let time = 0;
  let pointerUsed = false;
  let ghost = null; // a menu that was just closed, still fading: { menu, t, fresh }
  let dialogue = null;
  let spoken = '';
  let dirty = false; // sizes need recomputing, as soon as no finger or button is held
  let pointerHeld = false;
  let shownAt; // the displayScale the current sizes were made for
  let ticks = 0;
  let lastPointer = null;
  const stack = [];
  const hud = createHud();
  const toasts = createToasts();
  const tooltip = createTooltip();
  const settings = options.settings || null;
  const say = typeof options.announce === 'function' ? options.announce : null;

  const top = () => stack[stack.length - 1] || null;
  const motion = () => !ui.reducedMotion;
  const talking = () => !!dialogue && dialogue.active;

  function applyTheme() {
    theme = createTheme(highContrast ? 'contrast' : baseTheme);
    // Fitted text sizes are remembered per theme, so text is measured once, not every frame.
    Object.defineProperty(theme, 'fit', { value: new Map(), enumerable: false });
    if (view && view.align !== (theme.menuAlign ?? 'center')) refresh();
  }
  function displayScale() {
    const d = typeof options.displayScale === 'function' ? options.displayScale() : options.displayScale;
    return d > 0 ? d : undefined;
  }
  /** Recompute the unit and the shared viewport, and hand it to every open menu. */
  function refresh() {
    if (!(width > 0)) return;
    shownAt = displayScale();
    const base = sizing === 'auto' ? autoUnit(width, height, tracker.device, shownAt) : unitFor(width, height);
    unit = base * scale;
    dirty = false;
    // The hint line keeps its room for mouse players too (it is just empty), so
    // rows do not move when a keyboard player touches the mouse.
    const hint = ui.hints && tracker.device !== 'touch';
    view = { width, height, unit, safe, hint: hint ? ' ' : '', device: tracker.device, align: theme.menuAlign ?? 'center' };
    for (const m of stack) m.setViewport(view);
    if (ghost) ghost.menu.setViewport(view);
  }
  function leave(menu) {
    if (menu && !menu.custom) ghost = { menu, t: 0, fresh: true };
  }
  /** Remove everything from stack index `from` up, telling custom screens they have left. */
  function drop(from) {
    const gone = stack.splice(from);
    leave(gone[gone.length - 1]);
    for (const m of gone.reverse()) if (m.custom) m.left();
    return gone.length > 0;
  }
  function announceNow() {
    if (!say) return;
    const text = describeFocus(top(), talking() ? dialogue : null, view);
    if (text && text !== spoken) say(text);
    spoken = text;
  }

  const ui = {
    hud,
    reducedMotion: false,
    hints: !!options.hints,
    get theme() { return theme; },
    get unit() { return unit; },
    get scale() { return scale; },
    /** The device in use: 'touch', 'mouse', 'keyboard' or 'gamepad'. */
    get device() { return tracker.device; },
    /** The dialogue showing now, or null. */
    get dialogue() { return talking() ? dialogue : null; },
    /** True while the last update's pointer press/tap landed on the UI (menu, dialogue or HUD button). */
    get pointerUsed() { return pointerUsed; },
    /** Logical canvas size, as given to createUi or ui.resize. */
    get width() { return width; },
    get height() { return height; },
    /** viewport() -> { width, height, unit, safe: { top, right, bottom, left }, device } (a copy). */
    viewport() { return { width, height, unit, safe: { ...safe }, device: tracker.device }; },

    resize(w, h) {
      unitFor(w, h); // throws on a bad size
      width = w;
      height = h;
      refresh();
    },
    setSafeArea(area) { safe = { ...NO_SAFE, ...area }; refresh(); },
    /** setScale(n) makes everything n times its normal size (the `uiScale` setting calls this). */
    setScale(n) {
      if (!(n > 0)) throw new Error(`ui.setScale: scale must be a number above 0, got ${n}`);
      scale = n;
      // Mid-drag (the "Text size" slider) the new size waits, so the slider does not move under the finger.
      if (pointerHeld) dirty = true; else refresh();
    },
    setTheme(spec) { createTheme(spec); baseTheme = spec; applyTheme(); },
    /** setSkin({ genre, style, palette, accent }) switches to a look made for the game (see createSkin). */
    setSkin(spec) { ui.setTheme(createSkin(spec)); },
    /** setHighContrast(on) switches to the built-in high contrast theme and back. */
    setHighContrast(on) { highContrast = !!on; applyTheme(); },

    /** open(menuOptions) pushes a menu on top (see createMenu for options) and returns it. */
    open(menuOptions) {
      const menu = createMenu(menuOptions);
      menu.setViewport(view || { width: 320, height: 180, unit: 9, safe });
      if (ghost && ghost.fresh) ghost = null; // closed and reopened in one go: swap without a fade
      stack.push(menu);
      return menu;
    },
    /** back() closes the top menu. Returns true if one was open. */
    back() { return stack.length > 0 && drop(stack.length - 1); },
    /** closeAll() closes every menu (use it when play starts or resumes). */
    closeAll() { drop(0); },
    /**
     * openScreen(options) puts your own screen in the menu stack (see screen.js):
     * { id, update(dt, input, viewport), draw(ctx, theme, viewport, frame), onClose, onCancel, backdrop, cancel, snapshot }.
     * It blocks the game like a menu and kit menus can open on top of it. Returns the screen (screen.close()).
     */
    openScreen(screenOptions) {
      const screen = createScreen(screenOptions, (s) => { const i = stack.indexOf(s); if (i >= 0) drop(i); });
      screen.setViewport(view || { width: 320, height: 180, unit: 9, safe, device: tracker.device });
      if (ghost && ghost.fresh) ghost = null;
      stack.push(screen);
      return screen;
    },
    isOpen() { return stack.length > 0; },
    /** current() -> the top menu, or null. */
    current: top,

    showTitle(o) { ui.closeAll(); return ui.open(titleOptions(ui, { settings, game, ...o })); },
    showPause(o) { return ui.open(pauseOptions(ui, { settings, game, ...o })); },
    showSettings(o) { return ui.open(settingsOptions(ui, { settings, ...o })); },
    showMessage(o) { return ui.open(messageOptions(ui, o)); },
    showResults(o) { return ui.open(resultsOptions(ui, o)); },
    /** showSaves(options) opens the save slots screen (see saves-screen.js). */
    showSaves(o) { return openSaves(ui, o); },
    /** showDialogue(source, options) shows a dialogue box (see dialogue.js) and returns it. */
    showDialogue(source, o) {
      dialogue = createDialogue(source, o);
      return dialogue;
    },

    /** toast(text, seconds) or toast({ text, kind, icon, seconds }): a short pop-up message. */
    toast(text, seconds) {
      toasts.show(text, seconds);
      if (say) say(typeof text === 'object' ? text.text : text);
    },
    /** tooltip({ text, title, x, y }) shows a floating note; tooltip(null) hides it. */
    tooltip(spec) { tooltip.set(spec); },

    /** action(name) sends one menu action ('up', 'confirm', ...) to the top menu, or to the dialogue. */
    action(name) {
      if (!ACTIONS.includes(name)) throw new Error(`ui.action: unknown action "${name}". Use one of: ${ACTIONS.join(', ')}`);
      const menu = top();
      if (menu) return menu.action(name);
      return talking() ? dialogue.action(name) : false;
    },
    /** pointer(p) sends a mouse/finger state { x, y, down, pressed, released } to the UI. */
    pointer(p) {
      const menu = top();
      let used;
      if (menu) { menu.pointer(p); used = true; } else if (talking() && dialogue.pointer(p, view)) used = true;
      else used = hud.pointer(p, view);
      lastPointer = { x: p.x, y: p.y };
      if (p.pressed) pointerUsed = used;
      else if (!p.down && !p.released) pointerUsed = false;
      return used;
    },
    /**
     * wheel(deltaY) scrolls the open menu (or tells the open screen). Returns true when the ui used it.
     * The ui hears the real wheel by itself; call this only to feed it by hand.
     */
    wheel(deltaY) { return wheels.wheel(deltaY); },
    /** True while a menu, a custom screen or a modal dialogue is open: the game should not react to input. */
    get busy() { return ui.isOpen() || (talking() && dialogue.modal); },
    /** dispose() removes the ui's event listeners. Call it when a ui is thrown away while a menu is open. */
    dispose() { wheels.dispose(); },
    /** feedKey(code) gives a key row that is waiting its key ('KeyW', 'Space'). Returns true if one was waiting. */
    feedKey(code) { return reader.feedKey(code); },

    /**
     * update(dt, input) - call once per game update, BEFORE the game's own logic.
     *   dt: seconds. input: core's input object (optional if you call action/pointer yourself).
     * Returns true while a menu or a modal dialogue is open (or was closed this
     * update): the game should skip its own update, e.g. `if (ui.update(dt, input)) return;`
     */
    update(dt, input) {
      if (!(dt >= 0)) throw new Error(`ui.update: dt must be seconds >= 0, got ${dt}`);
      if (!unit) throw new Error('ui.update: no size yet. Pass width and height to createUi or call ui.resize(w, h)');
      const busy = () => ui.busy;
      const wasBusy = busy();
      time += dt;
      // A new device changes sizes and hints, but never while a finger or button is down.
      const changed = input ? tracker.read(input, ACTIONS) : false;
      const held = !!(input && input.pointer && (input.pointer.down || input.pointer.released));
      pointerHeld = held;
      // The window may have been resized around a fixed-size canvas: look at displayScale again now and then.
      ticks += 1;
      if (sizing === 'auto' && typeof options.displayScale === 'function' && ticks % 30 === 0 && displayScale() !== shownAt) dirty = true;
      if ((changed || dirty || view.device !== tracker.device) && !held) refresh();
      for (const m of stack) m.tick(dt, motion());
      if (ghost) {
        ghost.fresh = false;
        ghost.t += dt;
        if (ghost.t >= GHOST_TIME || !motion()) ghost = null;
      }
      hud.update(dt, motion());
      toasts.update(dt);
      tooltip.update(dt);
      if (talking()) dialogue.update(dt, motion(), view);
      // A screen may open a menu from its update. That menu must not also get the
      // press that opened it, so input is skipped for it until the next update.
      const screen = top();
      if (screen && screen.custom) screen.update(dt, input ?? null);
      if (input) reader.read(dt, input, top() !== screen);
      announceNow();
      wheels.listen(busy());
      return wasBusy || busy();
    },

    /** draw(ctx) - call after the game has drawn its frame. */
    draw(ctx) {
      if (!unit) throw new Error('ui.draw: no size yet. Pass width and height to createUi or call ui.resize(w, h)');
      drawUi(ctx, {
        theme, view, hud, toasts, tooltip, menu: top(), dialogue: talking() ? dialogue : null,
        ghost: ghost && motion() ? { menu: ghost.menu, fade: 1 - ghost.t / GHOST_TIME } : null,
        frame: { width, height, time, motion: motion() },
      });
    },

    /** snapshot() -> plain data about what is on screen, for tests and play-tests. */
    snapshot() {
      const menu = top();
      const snap = menu ? menu.snapshot() : null;
      return {
        ...(menu && menu.custom ? snap : {}),
        open: !!menu,
        screen: menu ? menu.id : null,
        depth: stack.length,
        focus: snap ? snap.focus : null,
        items: snap ? snap.items : [],
        capturing: snap ? snap.capturing : null,
        hud: unit ? hud.snapshot(view) : {},
        dialogue: unit && talking() ? dialogue.snapshot(view) : { active: false },
        toasts: toasts.list(),
        tooltip: tooltip.current ? { title: tooltip.current.title ?? '', text: tooltip.current.text ?? '' } : null,
        theme: theme.name,
        device: tracker.device,
        unit,
      };
    },
  };

  const wheels = createWheelListener(ui, {
    top, modal: () => talking() && dialogue.modal, getView: () => view,
    getPointer: () => lastPointer, getTime: () => time, target: options.wheelTarget,
  });
  const reader = createInputReader(ui, {
    top, hud, tooltip, getView: () => view,
    markUsed: () => { pointerUsed = true; },
    dialogue: () => (talking() ? dialogue : null),
    keyTarget: options.keyTarget,
  });

  applyTheme();
  if (options.width || options.height) ui.resize(options.width, options.height);
  if (settings) {
    const apply = () => {
      const v = settings.values();
      if (typeof v.theme === 'string') ui.setTheme(v.theme);
      if (typeof v.reducedMotion === 'boolean') ui.reducedMotion = v.reducedMotion;
      if (typeof v.highContrast === 'boolean') ui.setHighContrast(v.highContrast);
      const wanted = v.uiScale > 0 ? v.uiScale * (options.scale ?? 1) : scale;
      if (wanted !== scale) ui.setScale(wanted);
    };
    apply();
    settings.onChange(apply);
  }
  return ui;
}
