// Reads core's input object for the ui once per update: menu actions with
// key repeat, the pointer, and the raw key a key-binding row is waiting for.

/** The menu actions the kit understands. */
export const ACTIONS = ['up', 'down', 'left', 'right', 'confirm', 'cancel'];
const REPEATING = ['up', 'down', 'left', 'right'];

/**
 * createInputReader(ui, deps) -> { read(dt, input, skip), feedKey(code) }
 *   deps: { top(), dialogue(), hud, tooltip, getView(), markUsed(), keyTarget }
 *   skip: true makes read() ignore this update's input (the ui passes it when a screen just opened a menu).
 *   keyTarget: object with addEventListener/removeEventListener that gets
 *   'keydown' events (default: window). Only listened to while a key row waits.
 */
export function createInputReader(ui, deps) {
  let hold = { name: null, t: 0 };
  let swallow = false; // true right after a key capture, then the Set of action names still held from it
  let listening = null;
  let autoTip = false;

  const onKey = (e) => {
    if (e.repeat) return;
    if (reader.feedKey(e.code) && typeof e.preventDefault === 'function') e.preventDefault();
  };
  function listen(on) {
    const target = deps.keyTarget ?? globalThis.window;
    if (on && !listening && target && typeof target.addEventListener === 'function') {
      target.addEventListener('keydown', onKey, true);
      listening = target;
    } else if (!on && listening) {
      listening.removeEventListener('keydown', onKey, true);
      listening = null;
    }
  }

  const reader = {
    feedKey(code) {
      const menu = deps.top();
      if (!menu || !menu.capturing) return false;
      menu.captureKey(code);
      swallow = true;
      return true;
    },
    read(dt, input, skip = false) {
      if (skip) {
        // The top of the stack changed during this update (a screen opened a menu): nothing is sent to it yet.
        hold = { name: null, t: 0 };
        if (input.pointer && input.pointer.pressed) deps.markUsed();
        return;
      }
      const menu = deps.top();
      const talk = menu ? null : deps.dialogue();
      // Core turns taps and swipes into confirm/up/down/left/right as well. A
      // finger on a menu is already handled as a pointer, so those are skipped.
      const fromPointer = input.lastDevice === 'pointer';
      // The key that was just captured may also be bound to a menu action: that
      // press is skipped, and stays skipped for as long as the key is held.
      const names = [...ACTIONS, 'pause'];
      if (swallow === true) swallow = new Set(names.filter((n) => input.pressed(n) || input.down(n)));
      else if (swallow) for (const n of [...swallow]) if (!input.down(n)) swallow.delete(n);
      const fresh = (n) => input.pressed(n) && !(swallow && swallow.has(n));
      if (swallow && swallow.size === 0) swallow = false;
      if (menu && menu.capturing) {
        hold = { name: null, t: 0 };
        if (!fromPointer && fresh('cancel')) menu.action('cancel');
      } else if (menu && !fromPointer) {
        // Every action pressed this update is handled, in a fixed order, but
        // only on the menu that was on top when the update began.
        let fired = false;
        for (const name of ACTIONS) {
          const hit = fresh(name) || (name === 'cancel' && fresh('pause'));
          if (hit && deps.top() === menu) { menu.action(name); fired = true; }
        }
        // Holding a direction repeats it after a short delay.
        const held = REPEATING.find((n) => input.down(n)) || null;
        if (held !== hold.name) hold = { name: held, t: 0 };
        else if (held && !fired && deps.top() === menu) {
          hold.t += dt;
          if (hold.t > 0.4) { hold.t -= 0.09; menu.action(held); }
        }
      } else {
        hold = { name: null, t: 0 };
        if (talk && !fromPointer) {
          for (const name of ACTIONS) if (fresh(name) && deps.dialogue() === talk) talk.action(name);
        }
      }
      const after = deps.top();
      listen(!!(after && after.capturing));
      const p = input.pointer;
      if (!p) return;
      ui.pointer(p);
      // Resting the mouse on a HUD widget that has a `hint` shows it as a tooltip.
      const tip = after || p.down ? null : deps.hud.hintAt(p.x, p.y, deps.getView());
      if (tip) { deps.tooltip.set({ text: tip.text, rect: tip.rect }); autoTip = true; } else if (autoTip) { deps.tooltip.set(null); autoTip = false; }
    },
  };
  return reader;
}
