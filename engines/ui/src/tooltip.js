// A small floating box with a title and a few lines of text, next to a point
// or a rectangle: what an item does, what a HUD widget means.

import { clamp, wrapText, estimateTextWidth, easeOut } from './geometry.js';
import { label } from './draw.js';
import { drawSurface } from './surface.js';

/**
 * layoutTooltip(spec, viewport) -> { box, title, lines, size, lineH }
 *   spec: { text, title, x, y } or { text, title, rect: { x, y, w, h } }
 * The box sits above the point (below when there is no room) and stays on screen.
 */
export function layoutTooltip(spec, viewport) {
  const { width, height, unit: u, safe } = viewport;
  const size = 0.85 * u;
  const lineH = 1.2 * u;
  const pad = 0.6 * u;
  const maxW = Math.min(16 * u, width - safe.left - safe.right - 1.2 * u);
  const lines = spec.text ? wrapText(String(spec.text), (maxW - pad * 2) / (size * 0.52)) : [];
  const widest = Math.max(spec.title ? estimateTextWidth(spec.title, size * 1.1) : 0, ...lines.map((t) => estimateTextWidth(t, size)));
  const w = Math.min(maxW, widest + pad * 2);
  const h = pad * 2 + (spec.title ? lineH * 1.1 : 0) + lines.length * lineH;
  const a = spec.rect ?? { x: spec.x, y: spec.y, w: 0, h: 0 };
  const gap = 0.5 * u;
  let y = a.y - gap - h;
  if (y < safe.top + 0.3 * u) y = a.y + a.h + gap;
  const x = clamp(a.x + a.w / 2 - w / 2, safe.left + 0.3 * u, width - safe.right - 0.3 * u - w);
  y = clamp(y, safe.top + 0.3 * u, height - safe.bottom - 0.3 * u - h);
  return { box: { x, y, w, h }, title: spec.title ? String(spec.title) : '', lines, size, lineH, pad };
}

/**
 * createTooltip() -> tooltip
 *   tooltip.set(spec)     show ({ text, title, x, y } or { text, title, rect }); null hides
 *   tooltip.update(dt)    advance the fade
 *   tooltip.draw(ctx, theme, viewport, motion)
 *   tooltip.current       the spec showing, or null
 */
export function createTooltip() {
  let age = 0;
  const tooltip = {
    current: null,
    set(spec) {
      if (spec === null || spec === undefined) { tooltip.current = null; return; }
      if (typeof spec !== 'object' || (!spec.text && !spec.title)) throw new Error('ui.tooltip: give { text } or { title }, or null to hide');
      const at = spec.rect ?? spec;
      if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error('ui.tooltip: needs a position: { x, y } or { rect }');
      const same = tooltip.current && tooltip.current.text === spec.text && tooltip.current.title === spec.title;
      if (!same) age = 0;
      tooltip.current = spec;
    },
    update(dt) { age += dt; },
    draw(ctx, theme, viewport, motion = true) {
      if (!tooltip.current) return;
      const u = viewport.unit;
      const l = layoutTooltip(tooltip.current, viewport);
      ctx.save();
      ctx.globalAlpha = motion ? easeOut(age / 0.12) : 1;
      drawSurface(ctx, l.box, theme, u, { lift: 2, strong: true });
      let y = l.box.y + l.pad;
      if (l.title) {
        label(ctx, theme, l.title, l.box.x + l.pad, y + l.lineH * 0.55, { size: l.size * 1.1, weight: '700', color: theme.text, maxWidth: l.box.w - l.pad * 2 });
        y += l.lineH * 1.1;
      }
      for (const line of l.lines) {
        label(ctx, theme, line, l.box.x + l.pad, y + l.lineH / 2, { size: l.size, weight: '500', color: theme.textDim, maxWidth: l.box.w - l.pad * 2 });
        y += l.lineH;
      }
      ctx.restore();
    },
  };
  return tooltip;
}
