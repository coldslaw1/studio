// Draws a box (panel, row, HUD chip, slot) in the theme's style. This one file
// is what makes storybook, nocturne, papercut, crypt and terminal look different.
// Uses only fills and strokes: no gradients or blur, so it is cheap and runs
// on any context, including test fakes.

import { fillBox, boxPath } from './draw.js';
import { drawOrnament } from './ornament.js';

/**
 * drawSurface(ctx, rect, theme, u, o)
 *   rect: { x, y, w, h }.  u: the UI unit in pixels.
 *   o: {
 *     fill = theme.panel,
 *     edge = theme.panelEdge,   outline colour (styles without outlines ignore it unless `strong`)
 *     radius = theme.radius * u,
 *     lift = 0,                 0 flat on the page, 1 a row or chip, 2 a panel (bigger shadow or glow)
 *     glow,                     colour of the halo in the glow style (default theme.accent)
 *     strong = false,           true forces a visible outline in every style (focus, pressed)
 *     shape = 'round',          'round' | 'pill' | 'cut' | 'tab' | 'plain' (buttons pass theme.buttonShape)
 *     ornament = lift >= 2,     draw the theme's panel ornament (corner brackets, rivets, stitching...)
 *   }
 */
export function drawSurface(ctx, rect, theme, u, o = {}) {
  const fill = o.fill ?? theme.panel;
  const edge = o.edge ?? theme.panelEdge;
  const radius = o.radius ?? theme.radius * u;
  const lift = o.lift ?? 0;
  const line = theme.edge * u;
  const style = theme.style ?? 'flat';
  const shape = style === 'ascii' ? 'plain' : (o.shape ?? 'round');
  const box = (r, rad, color, edgeColor, width) => fillBox(ctx, r, rad, color, edgeColor, width, shape);
  const moved = (dx, dy, grow = 0) => ({ x: rect.x + dx - grow, y: rect.y + dy, w: rect.w + grow * 2, h: rect.h + grow * 2 });

  if (style === 'ascii') {
    ctx.fillStyle = fill;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    if (lift >= 2) asciiFrame(ctx, rect, theme, u, edge);
    else if (o.strong) box(rect, 0, fill, edge, Math.max(1, line));
  } else if (style === 'cel') {
    if (lift > 0) {
      const d = (lift >= 2 ? 0.3 : 0.14) * u;
      box(moved(d, d), radius, theme.shadow);
    }
    box(rect, radius, fill, edge, lift >= 2 ? line * 1.25 : line);
  } else if (style === 'paper') {
    if (lift > 0) {
      const d = (lift >= 2 ? 0.28 : 0.12) * u;
      box(moved(d * 0.6, d), radius, theme.shadow);
    }
    box(rect, radius, fill, o.strong ? edge : null, Math.max(1, 0.08 * u));
  } else if (style === 'glow') {
    if (lift >= 2 || o.glow) {
      ctx.save();
      ctx.strokeStyle = o.glow ?? theme.accent;
      const base = ctx.globalAlpha ?? 1;
      for (let i = 3; i >= 1; i--) {
        ctx.globalAlpha = base * 0.09 * (4 - i);
        ctx.lineWidth = i * 0.28 * u * (lift >= 2 ? 1.4 : 1);
        boxPath(ctx, rect.x, rect.y, rect.w, rect.h, radius, shape);
        ctx.stroke();
      }
      ctx.restore();
    }
    box(rect, radius, fill, lift >= 2 || o.strong ? edge : null, Math.max(1, line));
  } else if (style === 'painted') {
    if (lift >= 2) box(moved(0, 0.3 * u), radius, theme.shadow);
    box(rect, radius, fill, edge, Math.max(1, line));
    if (lift > 0 && rect.h > 0.6 * u) {
      // A light top edge and a dark bottom edge, like a carved stone block.
      const inset = Math.max(1, line) + (shape === 'round' ? radius : rect.h * 0.25);
      const t = Math.max(1, 0.07 * u);
      ctx.fillStyle = 'rgba(255, 236, 200, 0.13)';
      ctx.fillRect(rect.x + inset, rect.y + Math.max(1, line), rect.w - 2 * inset, t);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      ctx.fillRect(rect.x + inset, rect.y + rect.h - Math.max(1, line) - t, rect.w - 2 * inset, t);
    }
  } else {
    if (lift >= 2) {
      ctx.save();
      ctx.globalAlpha = (ctx.globalAlpha ?? 1) * 0.5;
      box(moved(0, 0.15 * u, 0.1 * u), radius * 1.2, theme.shadow);
      box(moved(0, 0.3 * u), radius, theme.shadow);
      ctx.restore();
    }
    box(rect, radius, fill, lift >= 2 || o.strong ? edge : null, line);
  }
  if ((o.ornament ?? lift >= 2) && theme.ornament && theme.ornament !== 'none') drawOrnament(ctx, rect, theme, u);
}

/** asciiFrame(ctx, rect, theme, u, color) draws a border of + - | characters around rect. */
export function asciiFrame(ctx, rect, theme, u, color) {
  const size = Math.max(6, 0.8 * u);
  ctx.save();
  ctx.font = `700 ${size}px ${theme.font}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const key = `ascii|${Math.round(size * 8)}|${theme.font}`;
  let charW = theme.fit ? theme.fit.get(key) : undefined;
  if (charW === undefined) {
    charW = Math.max(1, ctx.measureText('-').width || size * 0.6);
    if (theme.fit) theme.fit.set(key, charW);
  }
  const n = Math.max(2, Math.ceil(rect.w / charW));
  const bar = `+${'-'.repeat(n - 2)}+`;
  // The fourth argument squeezes the line so it ends exactly at the corner.
  ctx.fillText(bar, rect.x, rect.y, rect.w);
  ctx.fillText(bar, rect.x, rect.y + rect.h, rect.w);
  // Side bars sit under the corner characters and are packed closely, so they read as one line.
  const cw = rect.w / n;
  const span = rect.h - size * 0.6;
  const rows = Math.max(0, Math.ceil(span / (size * 0.72)));
  const step = rows > 0 ? span / rows : 0;
  for (let i = 0; i < rows; i++) {
    const y = rect.y + size * 0.3 + step * (i + 0.5);
    ctx.fillText('|', rect.x, y, cw);
    ctx.fillText('|', rect.x + rect.w - cw, y, cw);
  }
  ctx.restore();
}

/** focusRing(ctx, rect, theme, u, alpha, shape) draws the outline that marks the focused control. */
export function focusRing(ctx, rect, theme, u, alpha = 1, shape = 'round') {
  const grow = 0.14 * u;
  ctx.save();
  ctx.globalAlpha = (ctx.globalAlpha ?? 1) * alpha;
  boxPath(ctx, rect.x - grow, rect.y - grow, rect.w + grow * 2, rect.h + grow * 2,
    theme.radius * u * 1.2, theme.style === 'ascii' ? 'plain' : shape);
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = Math.max(1.5, u * 0.11);
  ctx.stroke();
  ctx.restore();
}
