// Draws the dialogue box. Reads its arguments, changes nothing.

import { fillBox, label } from './draw.js';
import { drawSurface, focusRing } from './surface.js';
import { estimateTextWidth, easeOut } from './geometry.js';

/**
 * drawDialogue(ctx, theme, l, s)
 *   l: from layoutDialogue. s: { view, lines, shown, choicesOpen, selected, more, portrait, time, motion }
 *   lines: the page's lines; shown: how many of its characters are revealed.
 */
export function drawDialogue(ctx, theme, l, s) {
  const u = l.unit;
  ctx.save();
  if (s.motion !== false && s.age !== undefined && s.age < 0.2) {
    // The box slides in from its edge of the screen.
    const t = easeOut(s.age / 0.18);
    ctx.globalAlpha = t;
    ctx.translate(0, (1 - t) * 1.2 * u * (s.position === 'top' ? -1 : 1));
  }
  drawSurface(ctx, l.box, theme, u, { lift: 2, radius: theme.radius * u * 1.2 });
  if (l.name) {
    const text = String(s.view.speaker);
    ctx.font = `700 ${l.name.size}px ${theme.font}`;
    const w = Math.min(l.box.w * 0.6, estimateTextWidth(text, l.name.size) + 1.4 * u);
    const plate = { x: l.name.x, y: l.name.y, w, h: l.name.h };
    drawSurface(ctx, plate, theme, u, { fill: theme.accent, lift: 1, strong: true });
    label(ctx, theme, text, plate.x + w / 2, plate.y + plate.h / 2, {
      size: l.name.size, weight: '700', color: theme.accentText, align: 'center', maxWidth: w - 0.6 * u,
    });
  }
  if (l.portrait && typeof s.portrait === 'function') {
    fillBox(ctx, l.portrait, theme.radius * u, theme.track, theme.panelEdge, Math.max(1, theme.edge * u));
    ctx.save();
    s.portrait(ctx, l.portrait, s.view.speaker);
    ctx.restore();
  }
  // Lines are wrapped by an estimate, so a wide font could spill: the page's
  // widest line is measured once (remembered in theme.fit) and all lines shrink to fit.
  let size = l.text.size;
  const widest = s.lines.reduce((a, b) => (b.length > a.length ? b : a), '');
  const key = `dlg|${Math.round(size * 8)}|${Math.round(l.text.w)}|${theme.font}|${widest}`;
  const known = theme.fit ? theme.fit.get(key) : undefined;
  if (known !== undefined) size = known;
  else {
    ctx.font = `500 ${size}px ${theme.font}`;
    const w = ctx.measureText(widest).width;
    if (w > l.text.w) size = Math.max(size * 0.6, (size * l.text.w) / w);
    if (theme.fit) theme.fit.set(key, size);
  }
  let budget = s.shown;
  s.lines.forEach((line, i) => {
    const part = line.slice(0, Math.max(0, budget));
    budget -= line.length + 1;
    if (part) label(ctx, theme, part, l.text.x, l.text.y + l.text.lineH * (i + 0.5), { size, weight: '500', color: theme.text });
  });
  if (s.more && !s.choicesOpen) {
    // A small arrow says "there is more": it bobs unless motion is off.
    const bob = s.motion === false ? 0 : Math.sin((s.time || 0) * 6) * 0.12 * u;
    const ax = l.box.x + l.box.w - 1.1 * u;
    const ay = l.box.y + l.box.h - 0.9 * u + bob;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(ax - 0.35 * u, ay - 0.2 * u);
    ctx.lineTo(ax + 0.35 * u, ay - 0.2 * u);
    ctx.lineTo(ax, ay + 0.25 * u);
    ctx.closePath();
    ctx.fill();
  }
  if (s.choicesOpen) {
    s.view.choices.forEach((choice, i) => {
      const rect = l.choices[i].rect;
      const on = i === s.selected;
      const shape = theme.buttonShape === 'tab' ? 'round' : theme.buttonShape;
      drawSurface(ctx, rect, theme, u, { fill: on ? theme.accent : theme.panel, lift: 1, strong: true, glow: on ? theme.accent : null, shape });
      if (on) focusRing(ctx, rect, theme, u, s.motion === false ? 1 : 0.6 + 0.4 * Math.sin((s.time || 0) * 5), shape);
      label(ctx, theme, String(choice.text), rect.x + 0.8 * u, rect.y + rect.h / 2, {
        size: 0.95 * u, weight: '600', color: on ? theme.accentText : theme.text, maxWidth: rect.w - 1.6 * u,
      });
    });
  }
  ctx.restore();
}
