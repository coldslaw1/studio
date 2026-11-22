// Mouse and touch handling for a menu: hover focus, taps, slider drags and
// drag-to-scroll. Split from menu.js to keep both files small.

import { contains, clamp } from './geometry.js';
import { isFocusable } from './items.js';

/**
 * createMenuPointer(menu, items, S, fns) -> pointer(p)
 *   S: the menu's shared focus state. fns: { activate, dragSlider, focusOn } from menu.js.
 * pointer(p) handles the mouse or a finger. p = { x, y, down, pressed, released }.
 * Returns true when the pointer is over the menu or dragging in it.
 */
export function createMenuPointer(menu, items, S, fns) {
  let press = null;
  let last = { x: NaN, y: NaN };

  // What is under the point: { row, cell } with cell -1 for plain rows, or null.
  function hitAt(l, x, y) {
    if (!contains(l.view, x, y)) return null;
    const row = l.rows.find((r) => contains(r.rect, x, y) && isFocusable(items[r.index]));
    if (!row) return null;
    if (!row.cells) return { row, cell: -1, id: row.id };
    const spot = row.cells.find((c) => contains(c.rect, x, y));
    return spot ? { row, cell: spot.index, id: spot.id } : null;
  }

  return function pointer(p) {
    const l = menu.layout();
    const moved = p.x !== last.x || p.y !== last.y;
    last = { x: p.x, y: p.y };
    const hit = hitAt(l, p.x, p.y);
    if (p.pressed) {
      if (menu.capturing) menu.capturing = null; // a tap anywhere stops waiting for a key
      press = { id: hit ? hit.id : null, y: p.y, scroll: menu.scroll, scrolled: false, slider: false };
      if (hit) {
        fns.focusOn({ index: hit.row.index, cell: hit.cell });
        const item = items[hit.row.index];
        press.slider = item.type === 'slider' && contains(hit.row.control, p.x, p.y);
        if (press.slider) fns.dragSlider(item, hit.row, l.unit, p.x);
      }
    } else if (p.down && press) {
      const dy = p.y - press.y;
      if (press.slider) {
        const r = l.rows.find((x) => x.id === press.id);
        fns.dragSlider(items[r.index], r, l.unit, p.x);
      } else if (l.maxScroll > 0 && (press.scrolled || Math.abs(dy) > 0.6 * l.unit)) {
        press.scrolled = true;
        menu.scroll = clamp(press.scroll - dy, 0, l.maxScroll);
        menu.scrollShown = menu.scroll; // a finger drags the list directly, no easing
      }
    } else if (!p.down && !p.released && moved && hit && menu.focusId !== hit.id) {
      fns.focusOn({ index: hit.row.index, cell: hit.cell }); // mouse hover
    }
    menu.pressedId = press && !press.scrolled && !press.slider && hit && hit.id === press.id ? press.id : null;
    if (p.released && press) {
      const tapped = !press.scrolled && !press.slider && hit && hit.id === press.id;
      press = null;
      menu.pressedId = null;
      if (tapped) {
        const item = items[hit.row.index];
        const c = hit.row.control;
        const dir = (item.type === 'choice' && c && p.x < c.x + c.w / 2 && p.x >= c.x) ? -1 : 1;
        fns.activate(item, dir);
      }
    }
    return press !== null || contains(l.panel, p.x, p.y);
  };
}
