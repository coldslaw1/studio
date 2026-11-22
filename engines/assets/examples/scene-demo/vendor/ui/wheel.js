// Mouse wheel and trackpad scrolling. The ui hears wheel events itself (core's
// input has none) and only while a menu, custom screen or modal dialogue is
// open; it then stops the event, so a camera zoom under the menu does not react.

import { clamp, contains } from './geometry.js';

const NOTCH = 100; // wheel distance of one mouse-wheel notch, in pixels

/**
 * createMenuWheel(menu, items, focusOn) -> wheel(deltaY, pointer, time)
 *   deltaY: pixels, positive scrolls down. pointer: { x, y } or null. time: seconds (any clock).
 * A list that does not fit scrolls. One that fits: over a slider, choice or
 * toggle the wheel changes its value (up is more), elsewhere it moves the
 * focus. A trackpad's stream of small deltas adds up to one step per notch.
 */
export function createMenuWheel(menu, items, focusOn) {
  let sum = 0;
  let last = -Infinity;
  return function wheel(deltaY, pointer, time = 0) {
    if (!Number.isFinite(deltaY) || deltaY === 0 || menu.capturing) return;
    const l = menu.layout();
    if (l.maxScroll > 0) {
      menu.scroll = clamp(menu.scroll + deltaY, 0, l.maxScroll);
      return;
    }
    if (time - last > 0.25 || Math.sign(deltaY) !== Math.sign(sum)) sum = 0; // a new scroll, or a change of direction
    last = time;
    const fresh = sum === 0;
    sum += deltaY;
    const steps = clamp(fresh ? Math.sign(deltaY) : Math.trunc(sum / NOTCH) - Math.trunc((sum - deltaY) / NOTCH), -3, 3);
    if (!steps) return;
    const row = pointer ? l.rows.find((r) => r.control && contains(r.control, pointer.x, pointer.y)) : null;
    const item = row ? items[row.index] : null;
    const adjust = item && !item.disabled && (item.type === 'slider' || item.type === 'choice' || item.type === 'toggle');
    if (adjust) focusOn({ index: row.index, cell: -1 });
    for (let i = 0; i < Math.abs(steps); i++) {
      if (adjust) menu.action(steps > 0 ? 'left' : 'right');
      else menu.action(steps > 0 ? 'down' : 'up');
    }
  };
}

/**
 * createWheelListener(ui, deps) -> { listen(on), wheel(deltaY), dispose() }
 *   deps: { top(), modal(), getView(), getPointer(), getTime(), target }
 *   target: gets 'wheel' events (default: window). Listened to only while listen(true).
 * wheel(deltaY) -> true when the ui used (and so consumed) the wheel.
 */
export function createWheelListener(ui, deps) {
  let listening = null;
  const api = {
    wheel(deltaY) {
      const top = deps.top();
      if (top) {
        top.wheel(deltaY, deps.getPointer(), deps.getTime());
        return true;
      }
      return deps.modal();
    },
    listen(on) {
      const target = deps.target ?? globalThis.window;
      if (on && !listening && target && typeof target.addEventListener === 'function') {
        // Capture phase and not passive: the ui sees the event first and may stop it.
        target.addEventListener('wheel', onWheel, { capture: true, passive: false });
        listening = target;
      } else if (!on && listening) {
        listening.removeEventListener('wheel', onWheel, { capture: true });
        listening = null;
      }
    },
    dispose() { api.listen(false); },
  };
  function onWheel(e) {
    if (e.ctrlKey) return; // pinch zoom of the page: not ours
    const view = deps.getView();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 32; // lines
    else if (e.deltaMode === 2) dy *= view ? view.height : 600; // pages
    if (!api.wheel(dy)) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  return api;
}
