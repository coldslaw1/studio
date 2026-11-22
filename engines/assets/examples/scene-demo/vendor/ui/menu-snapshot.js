// Plain data describing a menu, for tests and play-tests.

import { displayValue } from './items.js';

/**
 * menuSnapshot(menu) -> { screen, title, focus, capturing, items }
 *   items[i]: { id, label, type, disabled, value, display, x, y, visible } and, for a grid,
 *   cells: [{ id, label, count, disabled, x, y, visible }]. x, y is a point inside, for clicking.
 */
export function menuSnapshot(menu) {
  const l = menu.layout();
  const inView = (r) => r.y >= l.view.y - 1 && r.y + r.h <= l.view.y + l.view.h + 1;
  const centre = (r) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });
  return {
    screen: menu.id,
    title: menu.title,
    focus: menu.focusId,
    capturing: menu.capturing,
    items: menu.items.map((item, i) => {
      const row = l.rows[i];
      const out = {
        id: item.id, label: item.label, type: item.type, disabled: !!item.disabled,
        value: item.type === 'button' || item.type === 'grid' ? undefined : item.value,
        display: displayValue(item),
        x: Math.round(row.rect.x + row.rect.w / 4),
        y: Math.round(row.rect.y + row.rect.h / 2),
        visible: inView(row.rect),
      };
      if (item.type === 'grid') {
        out.cells = item.cells.map((cell, n) => ({
          id: cell.id, label: cell.label, count: cell.count, disabled: !!cell.disabled,
          ...centre(row.cells[n].rect), visible: inView(row.cells[n].rect),
        }));
      }
      return out;
    }),
  };
}
