// Draws one menu row: button, toggle, slider, choice, key binding, text line or grid.

import { fillBox, label } from './draw.js';
import { drawSurface, focusRing } from './surface.js';
import { drawIcon } from './icons.js';
import { displayValue, sliderFraction } from './items.js';
import { sliderTrack, textRowStacked } from './menu-layout.js';
import { easeOut } from './geometry.js';
import { drawGrid } from './grid-draw.js';

/**
 * drawRow(ctx, item, row, state, theme, u)
 *   row: { rect, control, cells } from layoutMenu.
 *   state: { focused, pressedId, time, alpha, motion, focusAge, capturing }
 */
export function drawRow(ctx, item, row, state, theme, u) {
  const { rect } = row;
  const midY = rect.y + rect.h / 2;
  const { focused, alpha } = state;
  ctx.globalAlpha = alpha * (item.disabled ? 0.4 : 1);

  if (item.type === 'text') { drawTextRow(ctx, item, rect, midY, theme, u); return; }
  if (item.type === 'grid') { drawGrid(ctx, item, row, state, theme, u); return; }

  const ascii = theme.style === 'ascii';
  const text = theme.uppercase ? item.label.toUpperCase() : item.label;
  // 'fill' paints the focused row in the accent colour; 'arrow' and 'bracket' keep the row and mark it instead.
  const filled = focused && (theme.focusStyle ?? 'fill') === 'fill';
  const shape = item.type === 'button' ? theme.buttonShape : (theme.buttonShape === 'pill' ? 'pill' : (theme.buttonShape === 'plain' ? 'plain' : 'round'));
  const ink = filled ? theme.accentText : (item.danger ? theme.danger : theme.text);
  const dimInk = filled ? theme.accentText : theme.textDim;

  // The focused row pops out a little when the focus lands on it and sinks while pressed.
  let scale = 1;
  if (state.motion) {
    if (state.pressedId === item.id) scale = 0.97;
    else if (focused) scale = 1 + popAmount(theme) * (1 - easeOut(state.focusAge / 0.14));
  }
  ctx.save();
  if (scale !== 1) {
    ctx.translate(rect.x + rect.w / 2, midY);
    ctx.scale(scale, scale);
    ctx.translate(-(rect.x + rect.w / 2), -midY);
  }
  drawSurface(ctx, rect, theme, u, { fill: filled ? theme.accent : theme.row, lift: 1, strong: focused, edge: focused && !filled ? theme.accent : undefined, glow: focused ? theme.accent : null, shape });
  if (focused) {
    const pulse = state.motion ? 0.6 + 0.4 * Math.sin(state.time * 5) : 1;
    if (filled) focusRing(ctx, rect, theme, u, pulse, shape);
    else drawFocusMark(ctx, rect, theme, u, state);
  }

  const state2 = filled === focused ? state : { ...state, focused: false };
  if (item.type === 'button') drawButton(ctx, item, rect, midY, ascii && filled ? `> ${text} <` : text, ink, dimInk, theme, u);
  else drawControl(ctx, item, row, midY, text, ink, state2, theme, u);
  ctx.restore();
}

// How far the focused row pops out, by the theme's motion feel.
function popAmount(theme) {
  if (theme.motionStyle === 'bouncy') return 0.07;
  return theme.motionStyle === 'snappy' ? 0.02 : 0.035;
}

// 'arrow': pointers at both ends of the row. 'bracket': accent brackets hugging the row.
function drawFocusMark(ctx, rect, theme, u, state) {
  const midY = rect.y + rect.h / 2;
  const sway = state.motion ? Math.sin(state.time * 6) * 0.12 * u : 0;
  ctx.save();
  ctx.fillStyle = theme.accent;
  if (theme.focusStyle === 'arrow') {
    // Two small pointers just inside the row's ends, aimed at the label.
    for (const dir of [1, -1]) {
      const tip = (dir > 0 ? rect.x + 0.62 * u : rect.x + rect.w - 0.62 * u) + dir * sway;
      ctx.beginPath();
      ctx.moveTo(tip - dir * 0.45 * u, midY - 0.42 * u); ctx.lineTo(tip, midY); ctx.lineTo(tip - dir * 0.45 * u, midY + 0.42 * u);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    const t = Math.max(2, 0.14 * u);
    const arm = 0.5 * u;
    for (const [x, dir] of [[rect.x - 0.3 * u - sway, 1], [rect.x + rect.w + 0.3 * u + sway, -1]]) {
      ctx.fillRect(dir > 0 ? x : x - t, rect.y, t, rect.h);
      ctx.fillRect(dir > 0 ? x : x - arm, rect.y, arm, t);
      ctx.fillRect(dir > 0 ? x : x - arm, rect.y + rect.h - t, arm, t);
    }
  }
  ctx.restore();
}

function drawTextRow(ctx, item, rect, midY, theme, u) {
  const value = displayValue(item);
  if (value === '') {
    label(ctx, theme, item.label, rect.x + rect.w / 2, midY, { size: 0.9 * u, weight: '500', color: theme.textDim, align: 'center', maxWidth: rect.w });
    return;
  }
  if (textRowStacked(item, rect.w, u)) { // too long for one line: the label, then the value under it
    label(ctx, theme, item.label, rect.x + 0.4 * u, rect.y + 0.8 * u, { size: 0.95 * u, weight: '500', color: theme.textDim, maxWidth: rect.w - 0.8 * u });
    label(ctx, theme, value, rect.x + rect.w - 0.4 * u, rect.y + 2.1 * u, { size: 1.05 * u, weight: '700', color: theme.text, align: 'right', maxWidth: rect.w - 0.8 * u });
    return;
  }
  // side by side: each gets the room it needs, and what is left over goes to the other
  const room = rect.w - 1.4 * u;
  ctx.font = `700 ${1.05 * u}px ${theme.font}`;
  const valueW = Math.min(ctx.measureText(value).width, room * 0.7);
  label(ctx, theme, item.label, rect.x + 0.4 * u, midY, { size: 0.95 * u, weight: '500', color: theme.textDim, maxWidth: Math.max(room * 0.3, room - valueW) });
  label(ctx, theme, value, rect.x + rect.w - 0.4 * u, midY, { size: 1.05 * u, weight: '700', color: theme.text, align: 'right', maxWidth: Math.max(valueW, 1) });
}

function drawButton(ctx, item, rect, midY, text, ink, dimInk, theme, u) {
  const iconW = item.icon ? 2.6 * u : 0.8 * u;
  if (item.icon) drawIcon(ctx, item.icon, rect.x + 1.3 * u, item.detail ? rect.y + 1.25 * u : midY, 1.3 * u, ink);
  let right = rect.x + rect.w - 0.7 * u;
  if (item.badge !== undefined && item.badge !== '') {
    const badge = String(item.badge);
    label(ctx, theme, badge, right, midY, { size: 0.8 * u, weight: '700', color: dimInk, align: 'right', maxWidth: rect.w * 0.3 });
    right -= Math.min(rect.w * 0.3, badge.length * 0.5 * u) + 0.5 * u;
  }
  if (item.detail) {
    // Two lines, left aligned: a name and a smaller line under it (save slots, shop rows).
    const x = rect.x + iconW;
    label(ctx, theme, text, x, rect.y + 1.2 * u, { size: 1.05 * u, weight: '700', color: ink, maxWidth: right - x });
    label(ctx, theme, String(item.detail), x, rect.y + 2.4 * u, { size: 0.8 * u, weight: '500', color: dimInk, maxWidth: right - x });
    return;
  }
  const side = Math.max(item.icon ? 2.2 * u : 0.6 * u, rect.x + rect.w - right);
  label(ctx, theme, text, rect.x + rect.w / 2, midY, { size: 1.05 * u, weight: '700', color: ink, align: 'center', maxWidth: rect.w - side * 2 });
}

function drawControl(ctx, item, row, midY, text, ink, state, theme, u) {
  const { rect, control: c } = row;
  const { focused } = state;
  const radius = theme.radius * u;
  label(ctx, theme, text, rect.x + 0.7 * u, midY, { size: 0.95 * u, weight: '600', color: ink, maxWidth: c.x - rect.x - 1.1 * u });

  if (item.type === 'toggle') {
    const w = 2.4 * u;
    const h = 1.25 * u;
    const on = item.shown ?? (item.value ? 1 : 0);
    const box = { x: c.x + c.w - w, y: midY - h / 2, w, h };
    fillBox(ctx, box, Math.min(h / 2, radius * 1.3 + 1), item.value ? theme.good : theme.track, focused ? theme.accentText : theme.panelEdge, u * 0.08);
    const knob = h - u * 0.36;
    const kx = box.x + u * 0.18 + (w - knob - u * 0.36) * on;
    fillBox(ctx, { x: kx, y: midY - knob / 2, w: knob, h: knob }, Math.min(knob / 2, radius * 1.2), item.value ? theme.track : theme.textDim);
    label(ctx, theme, displayValue(item), box.x - 0.5 * u, midY, { size: 0.85 * u, weight: '600', color: ink, align: 'right' });
  } else if (item.type === 'slider') {
    const track = sliderTrack(c, u);
    const f = item.shown ?? sliderFraction(item);
    fillBox(ctx, track, Math.min(track.h / 2, radius), theme.track, focused ? theme.accentText : theme.panelEdge, u * 0.06);
    if (f > 0) fillBox(ctx, { ...track, w: track.w * f }, Math.min(track.h / 2, radius), focused ? theme.accentText : theme.accent);
    const k = 1.1 * u;
    fillBox(ctx, { x: track.x + track.w * f - k / 2, y: midY - k / 2, w: k, h: k }, Math.min(k / 2, radius * 1.2),
      focused ? theme.accentText : theme.text, focused ? theme.accent : theme.row, u * 0.12);
    label(ctx, theme, displayValue(item), c.x + c.w, midY, { size: 0.85 * u, weight: '600', color: ink, align: 'right', maxWidth: 2.2 * u });
  } else if (item.type === 'choice') {
    const a = 0.45 * u;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(c.x + a, midY - a); ctx.lineTo(c.x, midY); ctx.lineTo(c.x + a, midY + a);
    ctx.moveTo(c.x + c.w - a, midY - a); ctx.lineTo(c.x + c.w, midY); ctx.lineTo(c.x + c.w - a, midY + a);
    ctx.fill();
    label(ctx, theme, displayValue(item), c.x + c.w / 2, midY, { size: 0.95 * u, weight: '700', color: ink, align: 'center', maxWidth: c.w - 2.4 * a });
  } else if (item.type === 'key') {
    const waiting = state.capturing === item.id;
    const shown = waiting ? 'Press a key' : displayValue(item);
    const w = Math.min(c.w, Math.max(2.2 * u, shown.length * 0.55 * u + 1.2 * u));
    const cap = { x: c.x + c.w - w, y: midY - 0.8 * u, w, h: 1.6 * u };
    const blink = waiting && state.motion ? 0.6 + 0.4 * Math.sin(state.time * 8) : 1;
    ctx.save();
    ctx.globalAlpha = (state.alpha ?? 1) * blink;
    fillBox(ctx, cap, Math.min(0.3 * u, radius), waiting ? theme.good : theme.track, focused ? theme.accentText : theme.panelEdge, u * 0.08);
    label(ctx, theme, shown, cap.x + cap.w / 2, midY, {
      size: 0.85 * u, weight: '700', color: waiting ? theme.track : theme.text, align: 'center', maxWidth: cap.w - 0.5 * u,
    });
    ctx.restore();
  }
}
