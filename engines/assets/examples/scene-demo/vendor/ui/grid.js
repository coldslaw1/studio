// Grid items: a block of square slots inside a menu (an inventory bag, a
// chest, a level picker). Pure layout and cursor movement, no drawing.

import { clamp } from './geometry.js';

/**
 * gridMetrics(item, innerW, u) -> { cols, rows, cell, gap, w, h, headH }
 *   item: a normalized grid item. innerW: the width the grid may use. u: UI unit.
 * Columns are as many as fit, at most item.columns when that is set.
 */
export function gridMetrics(item, innerW, u) {
  const gap = 0.3 * u;
  let cell = item.cellSize * u;
  const fit = Math.max(1, Math.floor((innerW + gap) / (cell + gap)));
  const cols = clamp(item.columns ?? fit, 1, Math.max(1, item.cells.length || 1));
  // Too many columns asked for a narrow screen: shrink the slots rather than overflow.
  if (cols > fit) cell = (innerW - gap * (cols - 1)) / cols;
  const rows = Math.max(1, Math.ceil(item.cells.length / cols), item.rows ?? 1);
  const headH = item.label ? 1.4 * u : 0;
  return { cols, rows, cell, gap, w: cols * cell + (cols - 1) * gap, h: headH + rows * cell + (rows - 1) * gap, headH };
}

/** gridCells(item, x, y, innerW, u) -> [{ id, index, rect }] one per cell, the block centred in innerW. */
export function gridCells(item, x, y, innerW, u) {
  const m = gridMetrics(item, innerW, u);
  const left = x + (innerW - m.w) / 2;
  return item.cells.map((cell, index) => ({
    id: cell.id,
    index,
    rect: {
      x: left + (index % m.cols) * (m.cell + m.gap),
      y: y + m.headH + Math.floor(index / m.cols) * (m.cell + m.gap),
      w: m.cell,
      h: m.cell,
    },
  }));
}

/**
 * moveInGrid(item, cols, name) -> true when the cursor moved, false at an edge
 * (the menu then moves the focus to the item above or below).
 *   name: 'up' | 'down' | 'left' | 'right'
 */
export function moveInGrid(item, cols, name) {
  const n = item.cells.length;
  const at = item.cursor;
  let next = at;
  if (name === 'left' && at % cols > 0) next = at - 1;
  if (name === 'right' && at % cols < cols - 1 && at + 1 < n) next = at + 1;
  if (name === 'up' && at - cols >= 0) next = at - cols;
  if (name === 'down') {
    if (at + cols < n) next = at + cols;
    else if (Math.floor(at / cols) < Math.floor((n - 1) / cols)) next = n - 1; // short last row
  }
  if (next === at) return false;
  item.cursor = next;
  return true;
}

/**
 * enterGrid(item, cols, fromBelow, column) puts the cursor on the row nearest
 * to where the focus came from, keeping the column when there is one.
 */
export function enterGrid(item, cols, fromBelow, column) {
  const n = item.cells.length;
  const lastRow = Math.floor((n - 1) / cols);
  const row = fromBelow ? lastRow : 0;
  const col = clamp(Number.isInteger(column) ? column : 0, 0, cols - 1);
  item.cursor = clamp(row * cols + col, 0, n - 1);
}
