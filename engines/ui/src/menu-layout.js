// Works out where every part of a menu goes. Pure: no canvas needed.

import { clamp, wrapText, estimateTextWidth } from './geometry.js';
import { gridMetrics, gridCells } from './grid.js';

const CONTROL_TYPES = ['toggle', 'slider', 'choice', 'key'];

/**
 * textRowStacked(item, w, u) -> true when a text row's label and value do not fit side by side.
 * The row then shows the label on one line and the value under it, so the two never overlap.
 */
export function textRowStacked(item, w, u) {
  const value = item.value === undefined || item.value === null ? '' : String(item.value);
  if (value === '' || !item.label) return false;
  return estimateTextWidth(item.label, 0.95 * u) + estimateTextWidth(value, 1.05 * u) > w - 1.6 * u;
}

/** rowHeight(item, innerW, u) -> the height of one item's row in pixels. */
export function rowHeight(item, innerW, u) {
  if (item.type === 'text') return textRowStacked(item, innerW, u) ? 2.9 * u : 1.6 * u;
  if (item.type === 'grid') return gridMetrics(item, innerW, u).h;
  if (item.type === 'button' && item.detail) return 3.4 * u;
  return 2.5 * u;
}

/**
 * layoutMenu(menu, viewport) -> layout
 *   menu: { title, subtitle, text, footer, variant, items, scroll, hasHints }
 *   viewport: { width, height, unit, safe: { top, right, bottom, left }, hint }
 *     hint: optional control hint line, shown when the menu has no footer of its own.
 * Returns rectangles in canvas pixels:
 *   { unit, panel, title, subtitle, textLines, footer, footerText, hint, view, rows, maxScroll, scroll }
 * rows[i] = { id, index, rect, control, cells } where control is the right-hand
 * part of a toggle/slider/choice/key row and cells the slots of a grid.
 * Row rects already include scrolling.
 */
export function layoutMenu(menu, viewport) {
  const { width, height, unit: u, safe } = viewport;
  const pad = 0.8 * u;
  const gap = 0.35 * u;
  const areaW = width - safe.left - safe.right;
  const areaH = height - safe.top - safe.bottom;
  const panelW = Math.max(6 * u, Math.min(areaW - 1.2 * u, (menu.wide ? 30 : 22) * u));
  const innerW = panelW - pad * 2;
  const big = menu.variant === 'title';

  const titleSize = (big ? 2.2 : 1.5) * u;
  const titleBlock = titleSize * 1.4;
  const titleH = menu.title ? titleBlock + 0.3 * u : 0; // the extra room holds the accent bar under the title
  const subSize = 0.9 * u;
  const subH = menu.subtitle ? 1.4 * u : 0;
  const textSize = 0.95 * u;
  const lineH = 1.35 * u;
  const textLines = menu.text ? wrapText(menu.text, innerW / (textSize * 0.52)) : [];
  const textH = textLines.length * lineH;
  const headGap = (titleH || subH || textH) ? 0.5 * u : 0;
  const headerH = pad + titleH + subH + textH + headGap;
  const footSize = 0.8 * u;
  const footerText = menu.footer || viewport.hint || '';
  const footerH = footerText ? 1.5 * u : 0;
  // Room for the focused row's hint: two lines, or three under a grid (name, then the hint).
  const hintLines = menu.hasHints ? hintLinesFor(menu, innerW, u) : 0;
  const hintH = hintLines ? hintLines * 1.15 * u + 0.5 * u : 0;

  const heights = menu.items.map((item) => rowHeight(item, innerW, u));
  const rowsH = heights.reduce((a, b) => a + b, 0) + gap * Math.max(0, heights.length - 1);
  const availH = areaH - 1.2 * u - headerH - footerH - hintH - pad;
  const viewH = Math.max(Math.min(rowsH, 2.5 * u), Math.min(rowsH, availH));
  const maxScroll = Math.max(0, rowsH - viewH);
  const scroll = clamp(menu.scroll || 0, 0, maxScroll);
  const panelH = headerH + viewH + hintH + footerH + pad;

  // A title screen's menu may sit to one side (theme.menuAlign), leaving the middle to the game's art.
  const side = big && areaW > panelW * 1.6 ? viewport.align : 'center';
  const sideX = side === 'left' ? Math.min(areaW * 0.08, areaW - panelW) : areaW - panelW - Math.min(areaW * 0.08, areaW - panelW);
  const panel = {
    x: safe.left + (side === 'left' || side === 'right' ? sideX : (areaW - panelW) / 2),
    y: Math.max(safe.top, safe.top + (areaH - panelH) / 2),
    w: panelW,
    h: panelH,
  };
  const cx = panel.x + panelW / 2;
  let y = panel.y + pad;
  const title = menu.title ? { x: cx, y: y + titleBlock / 2, size: titleSize, maxWidth: innerW, barY: y + titleBlock + 0.02 * u } : null;
  y += titleH;
  const subtitle = menu.subtitle ? { x: cx, y: y + subH / 2, size: subSize, maxWidth: innerW } : null;
  y += subH;
  const text = textLines.map((line, i) => ({
    line, x: cx, y: y + lineH * (i + 0.5), size: textSize, maxWidth: innerW,
  }));
  y += textH + headGap;

  const view = { x: panel.x + pad, y, w: innerW, h: viewH };
  const rows = [];
  let ry = y - scroll;
  menu.items.forEach((item, index) => {
    const rect = { x: view.x, y: ry, w: innerW, h: heights[index] };
    const controlW = innerW * 0.46;
    const control = CONTROL_TYPES.includes(item.type)
      ? { x: rect.x + innerW - controlW - 0.5 * u, y: ry, w: controlW, h: rect.h }
      : null;
    const cells = item.type === 'grid' ? gridCells(item, view.x, ry, innerW, u) : null;
    rows.push({ id: item.id, index, rect, control, cells });
    ry += heights[index] + gap;
  });

  const hint = hintH
    ? { x: view.x, y: view.y + viewH + 0.5 * u, w: innerW, h: hintH - 0.5 * u, lines: hintLines, lineH: 1.15 * u, size: 0.85 * u }
    : null;
  const footer = footerText
    ? { x: cx, y: view.y + viewH + hintH + footerH / 2 + 0.2 * u, size: footSize, maxWidth: innerW }
    : null;
  return { unit: u, panel, title, subtitle, textLines: text, footer, footerText, hint, view, rows, maxScroll, scroll };
}

// Lines the hint area needs: the longest hint in the menu, wrapped (plus a name line for grid cells), at most 3.
function hintLinesFor(menu, innerW, u) {
  const perLine = innerW / (0.85 * u * 0.52);
  const wrapped = (text) => (text ? wrapText(String(text), perLine).length : 0);
  let most = 0;
  for (const item of menu.items) {
    most = Math.max(most, wrapped(item.hint));
    if (item.type === 'grid') for (const cell of item.cells) most = Math.max(most, (cell.label ? 1 : 0) + wrapped(cell.hint));
  }
  return Math.min(3, Math.max(1, most));
}

/** sliderTrack(control, unit) -> the rectangle of a slider's track inside its control area. */
export function sliderTrack(control, unit) {
  const valueW = 2.6 * unit; // room for the "80%" text on the right
  const h = 0.5 * unit;
  return { x: control.x, y: control.y + (control.h - h) / 2, w: Math.max(unit, control.w - valueW), h };
}
