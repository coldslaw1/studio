// Draws HUD widgets. Reads widgets, never changes them.

import { clamp } from './geometry.js';
import { fillBox, label, roundRectPath } from './draw.js';
import { drawSurface } from './surface.js';
import { drawIcon } from './icons.js';
import { drawSlot } from './grid-draw.js';
import { textOf, promptKey } from './hud.js';

const TAU = Math.PI * 2;

/**
 * drawWidget(ctx, w, rect, theme, viewport, pressId)
 *   w: a HUD widget. rect: where it goes. viewport: { unit, device }.
 *   pressId: key of the button or hotbar slot being pressed, or null.
 */
export function drawWidget(ctx, w, rect, theme, viewport, pressId) {
  const u = viewport.unit;
  const radius = theme.radius * u;
  const midY = rect.y + rect.h / 2;
  if (w.type === 'button') {
    const pressed = pressId === w.id;
    drawSurface(ctx, rect, theme, u, { fill: pressed ? theme.accent : theme.panel, lift: pressed ? 0 : 1, strong: true, shape: theme.buttonShape === 'tab' ? 'round' : theme.buttonShape });
    const ink = pressed ? theme.accentText : theme.text;
    if (w.icon) drawIcon(ctx, w.icon, rect.x + rect.w / 2, midY, rect.w * 0.6, ink);
    else label(ctx, theme, w.label, rect.x + rect.w / 2, midY, { size: 0.9 * u, weight: '700', color: ink, align: 'center', maxWidth: rect.w - 0.4 * u });
    return;
  }
  if (w.type === 'bar') { drawBar(ctx, w, rect, theme, u); return; }
  if (w.type === 'minimap') { drawMinimap(ctx, w, rect, theme, u); return; }
  if (w.type === 'hotbar') {
    w.slots.forEach((slot, i) => {
      const cell = { x: rect.x + i * 2.65 * u, y: rect.y, w: 2.4 * u, h: 2.4 * u };
      drawSlot(ctx, slot || {}, cell, theme, u, { focused: w.value === i, selected: pressId === `${w.id}:${i}`, keyHint: slot && slot.key });
      const cool = slot ? clamp(slot.cooldown ?? 0, 0, 1) : 0;
      if (cool > 0) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = theme.track;
        ctx.fillRect(cell.x, cell.y + cell.h * (1 - cool), cell.w, cell.h * cool);
        ctx.restore();
      }
    });
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0.9;
  drawSurface(ctx, rect, theme, u, { lift: 1, strong: true, edge: theme.panelEdge });
  ctx.restore();
  if (w.type === 'pips') {
    for (let i = 0; i < w.max; i++) {
      ctx.save();
      ctx.globalAlpha = i < w.value ? 1 : 0.25;
      drawIcon(ctx, w.icon, rect.x + 0.3 * u + (i + 0.5) * 1.4 * u, midY, 1.15 * u, i < w.value ? theme.danger : theme.textDim);
      ctx.restore();
    }
    return;
  }
  let x = rect.x + 0.6 * u;
  if (w.type === 'prompt') {
    const key = promptKey(w, viewport.device ?? 'keyboard');
    if (key) {
      const size = 0.8 * u;
      ctx.font = `700 ${size}px ${theme.font}`;
      const keyW = Math.max(1.5 * u, key.length * size * 0.56 + 0.8 * u);
      const cap = { x: rect.x + 0.4 * u, y: midY - 0.65 * u, w: keyW, h: 1.3 * u };
      fillBox(ctx, cap, Math.min(0.3 * u, radius), theme.accent);
      label(ctx, theme, key, cap.x + cap.w / 2, midY, { size, weight: '800', color: theme.accentText, align: 'center', maxWidth: cap.w - 0.3 * u });
      x = cap.x + cap.w + 0.5 * u;
    }
    label(ctx, theme, textOf(w), x, midY, { size: 0.95 * u, weight: '700', color: theme.text, maxWidth: rect.x + rect.w - x - 0.3 * u });
    return;
  }
  if (w.icon) {
    drawIcon(ctx, w.icon, x + 0.5 * u, midY, 1.1 * u, theme.accent);
    x += 1.4 * u;
  }
  const scale = 1 + (w.bump / 0.25) * 0.25;
  label(ctx, theme, textOf(w), x, midY, {
    size: 0.95 * u * scale, weight: '700',
    color: w.bump > 0 ? theme.accent : theme.text, maxWidth: rect.x + rect.w - x - 0.3 * u,
  });
}

function drawBar(ctx, w, rect, theme, u) {
  const radius = Math.min(theme.radius * u, rect.h / 2);
  const midY = rect.y + rect.h / 2;
  const f = clamp((w.shown ?? w.value) / w.max, 0, 1);
  const ghost = clamp((w.ghost ?? w.value) / w.max, 0, 1);
  const low = clamp(w.value / w.max, 0, 1) <= 0.25;
  drawSurface(ctx, rect, theme, u, { fill: theme.track, radius, lift: 1, strong: true });
  const inset = Math.max(1, theme.edge * u);
  const inner = { x: rect.x + inset, y: rect.y + inset, w: rect.w - inset * 2, h: rect.h - inset * 2 };
  if (ghost > f) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    fillBox(ctx, { ...inner, w: inner.w * ghost }, radius, theme.text);
    ctx.restore();
  }
  if (f > 0) fillBox(ctx, { ...inner, w: inner.w * f }, radius, w.color || (low ? theme.danger : theme.good));
  if (w.segments > 1) {
    ctx.fillStyle = theme.track;
    for (let i = 1; i < w.segments; i++) ctx.fillRect(inner.x + (inner.w * i) / w.segments - 0.04 * u, inner.y, Math.max(1, 0.08 * u), inner.h);
  }
  // Text sits on a bar that may be full or empty, so it gets a dark outline to stay readable.
  const words = (text, x, align) => {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, 0.11 * u);
    ctx.strokeStyle = theme.track;
    ctx.font = `700 ${0.75 * u}px ${theme.font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.strokeText(text, x, midY);
    ctx.restore();
    label(ctx, theme, text, x, midY, { size: 0.75 * u, weight: '700', color: theme.text, align });
  };
  if (w.label) words(w.label, rect.x + 0.5 * u, 'left');
  if (w.showValue) words(`${Math.round(w.value)}/${w.max}`, rect.x + rect.w - 0.5 * u, 'right');
}

const KIND_COLOR = { enemy: 'danger', friend: 'good', item: 'warn', goal: 'accent' };

function drawMinimap(ctx, w, rect, theme, u) {
  const v = w.value || {};
  const round = (w.shape ?? 'round') === 'round';
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = rect.w / 2;
  const radius = round ? r : theme.radius * u;
  ctx.save();
  ctx.globalAlpha = 0.92;
  drawSurface(ctx, rect, theme, u, { fill: theme.track, radius, lift: 1, strong: true });
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.clip();
  if (typeof w.drawMap === 'function') w.drawMap(ctx, rect, v, theme);
  const range = v.range > 0 ? v.range : 100;
  const center = v.center || { x: 0, y: 0 };
  const turn = w.rotate ? -(v.heading ?? 0) : 0;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const edge = r - 0.35 * u;
  for (const p of v.points || []) {
    let dx = ((p.x - center.x) / range) * r;
    let dy = ((p.y - center.y) / range) * r;
    if (turn) [dx, dy] = [dx * cos - dy * sin, dx * sin + dy * cos];
    const far = round ? Math.hypot(dx, dy) / edge : Math.max(Math.abs(dx), Math.abs(dy)) / edge;
    if (far > 1) {
      if (!p.pin) continue; // off the map; pinned points wait at the edge
      dx /= far;
      dy /= far;
    }
    ctx.fillStyle = p.color ?? theme[KIND_COLOR[p.kind]] ?? theme.textDim;
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, (p.r ?? (p.kind === 'goal' ? 0.32 : 0.22)) * u, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  if (v.center) {
    // The player: an arrow in the middle, turned to the heading (0 is up, clockwise).
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(w.rotate ? 0 : (v.heading ?? 0));
    drawIcon(ctx, 'arrow', 0, 0, 0.9 * u, theme.text);
    ctx.restore();
  }
  if (w.label) label(ctx, theme, w.label, cx, rect.y + rect.h - 0.6 * u, { size: 0.65 * u, weight: '700', color: theme.textDim, align: 'center', maxWidth: rect.w * 0.7 });
}
