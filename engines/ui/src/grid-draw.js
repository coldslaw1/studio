// Draws a grid item: square slots with an icon, a count and a rarity colour.

import { fillBox, label } from './draw.js';
import { focusRing } from './surface.js';
import { drawIcon, isIcon } from './icons.js';
import { easeOut } from './geometry.js';

/**
 * drawGrid(ctx, item, row, state, theme, u)
 *   item: a normalized grid item. row: { rect, cells } from layoutMenu.
 *   state: { focused, pressedId, time, alpha, motion, focusAge }
 * Cell fields used: icon (name or function), iconColor, label, count, color
 * (a stripe along the bottom, e.g. rarity), disabled, selected (marked with the "good" colour).
 */
export function drawGrid(ctx, item, row, state, theme, u) {
  if (item.label) {
    label(ctx, theme, theme.uppercase ? item.label.toUpperCase() : item.label, row.rect.x + 0.2 * u, row.rect.y + 0.6 * u, {
      size: 0.85 * u, weight: '700', color: theme.textDim, maxWidth: row.rect.w,
    });
  }
  item.cells.forEach((cell, i) => {
    const rect = row.cells[i].rect;
    const focused = state.focused && item.cursor === i;
    ctx.save();
    ctx.globalAlpha = state.alpha * (item.disabled || cell.disabled ? 0.4 : 1);
    if (state.motion && (focused || state.pressedId === cell.id)) {
      const s = state.pressedId === cell.id ? 0.94 : 1 + 0.08 * (1 - easeOut(state.focusAge / 0.14));
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
    }
    drawSlot(ctx, cell, rect, theme, u, { focused, selected: !!cell.selected });
    if (focused) focusRing(ctx, rect, theme, u, state.motion ? 0.6 + 0.4 * Math.sin(state.time * 5) : 1);
    ctx.restore();
  });
}

/**
 * drawSlot(ctx, cell, rect, theme, u, o) draws one slot. Also used by the HUD hotbar.
 *   o: { focused, selected, keyHint }  keyHint: a short text in the top-left corner ('1', 'Q')
 */
export function drawSlot(ctx, cell, rect, theme, u, o = {}) {
  const radius = Math.min(theme.radius * u, rect.w * 0.2);
  const edge = o.focused ? theme.accent : (o.selected ? theme.good : theme.panelEdge);
  const width = Math.max(1, (o.focused || o.selected ? 0.16 : 0.07) * u);
  // An empty slot is fainter than one holding something, so the bag reads at a glance.
  const hollow = !!cell.empty && !o.focused && !o.selected;
  ctx.save();
  if (hollow) ctx.globalAlpha = (ctx.globalAlpha ?? 1) * 0.5;
  fillBox(ctx, rect, theme.style === 'ascii' ? 0 : radius, theme.track, edge, width);
  ctx.restore();
  if (cell.color) {
    const h = Math.max(2, 0.14 * rect.h);
    const inset = Math.max(width, radius * 0.6);
    fillBox(ctx, { x: rect.x + inset, y: rect.y + rect.h - h - width, w: rect.w - inset * 2, h }, h / 2, cell.color);
  }
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2 - (cell.color ? 0.04 * rect.h : 0);
  if (cell.icon && isIcon(cell.icon)) {
    drawIcon(ctx, cell.icon, cx, cy, rect.w * 0.62, cell.iconColor ?? theme.text);
  } else if (cell.label && !cell.empty) {
    label(ctx, theme, cell.label.slice(0, 2), cx, cy, { size: rect.w * 0.34, weight: '700', color: cell.iconColor ?? theme.text, align: 'center' });
  }
  const count = cell.count;
  if (typeof count === 'string' ? count !== '' : count > 1) {
    label(ctx, theme, String(count), rect.x + rect.w - 0.2 * u, rect.y + rect.h - Math.max(0.5 * u, rect.h * 0.2), {
      size: Math.max(0.62 * u, rect.w * 0.24), weight: '800', color: theme.text, align: 'right', maxWidth: rect.w * 0.7,
    });
  }
  if (o.keyHint) {
    label(ctx, theme, String(o.keyHint), rect.x + 0.22 * u, rect.y + 0.5 * u, { size: 0.6 * u, weight: '700', color: theme.textDim });
  }
}
