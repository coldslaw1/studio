// Painting the inventory panel. Reads a model made by panel.js and a ui kit
// theme (bg, panel, panelEdge, row, text, textDim, accent, accentText, track,
// danger, good, font, titleFont, radius, edge). Restores the context state.

import { iconKind, slotIconKind, drawItemIcon } from './item-icons.js';
import { stackRarity } from './stack.js';
import { placeTip } from './panel-layout.js';

function box(ctx, r, radius, fill, edge, width) {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  if (rad === 0) ctx.rect(r.x, r.y, r.w, r.h);
  else {
    ctx.moveTo(r.x + rad, r.y);
    ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
    ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
    ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
    ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
    ctx.closePath();
  }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (edge && width > 0) { ctx.strokeStyle = edge; ctx.lineWidth = width; ctx.stroke(); }
}

// A box in the ui kit's own look when the kit handed us its helpers (m.kit, from the screen's draw frame),
// else a plain rounded box. o: { fill, edge, width, radius, lift, strong }
function surface(ctx, m, r, o) {
  if (m.kit && typeof m.kit.drawSurface === 'function') m.kit.drawSurface(ctx, r, m.theme, m.layout.unit, { fill: o.fill, edge: o.edge, radius: o.radius, lift: o.lift ?? 0, strong: !!o.strong, shape: o.shape });
  else box(ctx, r, o.radius ?? 0, o.fill, o.edge, o.width ?? 0);
}

function text(ctx, str, x, y, o) {
  let px = o.size;
  ctx.font = `${o.weight ?? '600'} ${px}px ${o.font}`;
  if (o.maxWidth > 0) {
    for (let i = 0; i < 10 && ctx.measureText(str).width > o.maxWidth && px > o.size * 0.6; i++) {
      px *= 0.93;
      ctx.font = `${o.weight ?? '600'} ${px}px ${o.font}`;
    }
  }
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'middle';
  if (o.outline) { ctx.lineWidth = Math.max(2, px * 0.28); ctx.strokeStyle = o.outline; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = o.color;
  ctx.fillText(str, x, y);
}

function wrap(ctx, str, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(str).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** drawStack(ctx, m, stack, rect, alpha) draws one item (icon and count) inside a cell rect. */
export function drawStack(ctx, m, stack, r, alpha = 1) {
  const def = m.inventory.catalog.get(stack.id);
  const inset = r.w * 0.12;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const custom = typeof m.icons === 'function' && m.icons(ctx, stack, def, r.x + inset, r.y + inset, r.w - 2 * inset) === true;
  if (!custom) {
    if (typeof def.icon === 'function') def.icon(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w - 2 * inset, m.theme.text);
    else drawItemIcon(ctx, iconKind(def), r.x + inset, r.y + inset, r.w - 2 * inset, def.color);
  }
  const size = Math.max(9, r.w * 0.27);
  const label = stack.endless ? '' : (stack.quick || stack.n > 1 ? String(stack.n) : '');
  if (label) text(ctx, label, r.x + r.w - r.w * 0.1, r.y + r.h - size * 0.62, { size, font: m.theme.font, weight: '800', color: stack.quick && stack.n === 0 ? m.theme.danger : m.theme.text, align: 'right', outline: m.theme.track });
  if (stack.price !== undefined) text(ctx, `${stack.price}${m.money ? m.money.symbol : 'c'}`, r.x + r.w * 0.1, r.y + size * 0.62, { size: size * 0.9, font: m.theme.font, weight: '800', color: m.theme.accent, outline: m.theme.track });
  ctx.restore();
}

function drawCell(ctx, m, t) {
  const { theme, layout: l } = m;
  const u = l.unit;
  const stack = m.stackAt(t.id);
  const focused = m.cursor === t.id;
  const source = m.held && m.held.from === t.id;
  const rarity = stack ? m.inventory.catalog.rarity(stackRarity(m.inventory.catalog, stack)) : null;
  const radius = Math.min(theme.radius * u * 0.6, l.cell * 0.18);
  const rare = !!rarity && rarity.order > 0;
  surface(ctx, m, t.rect, { fill: theme.track, edge: rare ? rarity.color : theme.panelEdge, width: Math.max(1, (rare ? 0.11 : 0.06) * u), radius, strong: rare });
  if (rarity && rarity.order > 0) {
    ctx.save();
    ctx.globalAlpha = 0.14;
    box(ctx, t.rect, radius, rarity.color);
    ctx.restore();
  }
  if (!stack && t.zone === 'equip') {
    ctx.save();
    ctx.globalAlpha = 0.16;
    drawItemIcon(ctx, slotIconKind(t.slot), t.rect.x + l.cell * 0.16, t.rect.y + l.cell * 0.16, l.cell * 0.68, theme.text);
    ctx.restore();
  }
  if (stack) drawStack(ctx, m, stack, t.rect, source ? 0.3 : 1);
  if (t.zone === 'hot') text(ctx, String(t.index + 1), t.rect.x + l.cell * 0.1, t.rect.y + l.cell * 0.2, { size: Math.max(8, l.cell * 0.22), font: theme.font, color: theme.textDim });
  if (focused) {
    const pulse = m.pointerMode ? 0 : 0.5 + 0.5 * Math.sin(m.time * 6);
    const grow = 0.06 * u + pulse * 0.05 * u;
    if (m.kit && typeof m.kit.focusRing === 'function') m.kit.focusRing(ctx, t.rect, theme, u, m.pointerMode ? 1 : 0.6 + 0.4 * pulse);
    else box(ctx, { x: t.rect.x - grow, y: t.rect.y - grow, w: t.rect.w + 2 * grow, h: t.rect.h + 2 * grow }, radius + grow, null, theme.accent, Math.max(2, 0.16 * u));
  }
}

function drawButton(ctx, m, t) {
  const { theme, layout: l } = m;
  const focused = m.cursor === t.id;
  if (t.scrolls) {
    box(ctx, t.rect, 0.2 * l.unit, focused ? theme.accent : theme.row);
    const cx = t.rect.x + t.rect.w / 2;
    const cy = t.rect.y + t.rect.h / 2;
    const s = Math.min(t.rect.w, t.rect.h) * 0.25 * t.dir;
    ctx.beginPath(); ctx.moveTo(cx - Math.abs(s), cy - s); ctx.lineTo(cx + Math.abs(s), cy - s); ctx.lineTo(cx, cy + s); ctx.closePath();
    ctx.fillStyle = focused ? theme.accentText : theme.text; ctx.fill();
    return;
  }
  surface(ctx, m, t.rect, { fill: focused ? theme.accent : theme.row, edge: focused ? theme.text : undefined, width: focused ? Math.max(1, 0.08 * l.unit) : 0, radius: theme.buttonShape ? undefined : theme.radius * l.unit * 0.7, lift: 1, strong: focused, shape: theme.buttonShape });
  const label = theme.uppercase ? t.label.toUpperCase() : t.label;
  text(ctx, label, t.rect.x + t.rect.w / 2, t.rect.y + t.rect.h / 2, { size: 0.9 * l.unit, font: theme.font, weight: '700', color: focused ? theme.accentText : theme.text, align: 'center', maxWidth: t.rect.w - 0.6 * l.unit });
}

function drawDoll(ctx, m) {
  const { theme, layout: l } = m;
  if (!l.doll) return;
  surface(ctx, m, l.doll, { fill: theme.track, edge: theme.panelEdge, width: Math.max(1, 0.05 * l.unit), radius: theme.radius * l.unit * 0.6 });
  ctx.save();
  ctx.beginPath(); ctx.rect(l.doll.x, l.doll.y, l.doll.w, l.doll.h); ctx.clip();
  if (typeof m.drawDoll === 'function') m.drawDoll(ctx, { ...l.doll });
  else {
    // A plain figure, so the slots read as "what you wear".
    const cx = l.doll.x + l.doll.w / 2;
    const h = l.doll.h;
    const top = l.doll.y;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = theme.text;
    ctx.beginPath(); ctx.arc(cx, top + h * 0.22, h * 0.09, 0, Math.PI * 2); ctx.fill();
    box(ctx, { x: cx - h * 0.13, y: top + h * 0.34, w: h * 0.26, h: h * 0.3 }, h * 0.06, theme.text);
    box(ctx, { x: cx - h * 0.12, y: top + h * 0.66, w: h * 0.1, h: h * 0.26 }, h * 0.04, theme.text);
    box(ctx, { x: cx + h * 0.02, y: top + h * 0.66, w: h * 0.1, h: h * 0.26 }, h * 0.04, theme.text);
    box(ctx, { x: cx - h * 0.22, y: top + h * 0.35, w: h * 0.07, h: h * 0.27 }, h * 0.035, theme.text);
    box(ctx, { x: cx + h * 0.15, y: top + h * 0.35, w: h * 0.07, h: h * 0.27 }, h * 0.035, theme.text);
  }
  ctx.restore();
}

function drawTip(ctx, m) {
  const { theme, layout: l, tip } = m;
  const target = l.targets.find((t) => t.id === m.tipId);
  if (!tip || !target) return;
  const u = l.unit;
  const size = 0.82 * u;
  const pad = 0.6 * u;
  const width = Math.min(13 * u, m.view.width - 2 * pad);
  ctx.font = `600 ${size}px ${theme.font}`;
  const rows = [];
  for (const line of tip.lines) {
    if (line.wrap) for (const part of wrap(ctx, line.text, width - 2 * pad)) rows.push({ ...line, text: part });
    else rows.push(line);
  }
  const lineH = size * 1.35;
  const height = pad * 1.6 + size * 1.5 + rows.length * lineH;
  // Where it hides the fewest items (never its own cell): see placeTip.
  const r = placeTip(l, target.id, width, height, m.view, (id) => !!m.stackAt(id));
  if (!m.kit) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    box(ctx, { x: r.x + 0.15 * u, y: r.y + 0.2 * u, w: r.w, h: r.h }, theme.radius * u * 0.6, '#000');
    ctx.restore();
  }
  surface(ctx, m, r, { fill: theme.bg, edge: tip.color, width: Math.max(1, 0.1 * u), radius: theme.radius * u * 0.6, lift: 2, strong: true });
  text(ctx, tip.title, r.x + pad, r.y + pad + size * 0.6, { size: size * 1.15, font: theme.font, weight: '800', color: theme.text, maxWidth: width - 2 * pad });
  const tones = { dim: theme.textDim, good: theme.good, bad: theme.danger, text: theme.text, accent: theme.accent, rarity: tip.color };
  rows.forEach((line, i) => {
    text(ctx, line.text, r.x + pad, r.y + pad + size * 1.75 + i * lineH + lineH * 0.3, { size, font: theme.font, weight: line.tone === 'dim' ? '500' : '700', color: tones[line.tone] ?? theme.text, maxWidth: width - 2 * pad });
  });
}

/** drawPanel(ctx, model) paints the whole panel (not the dimmed backdrop). See panel.js for the model. */
export function drawPanel(ctx, m) {
  const { theme, layout: l } = m;
  const u = l.unit;
  const inv = m.inventory;
  if (!m.kit) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    box(ctx, { x: l.panel.x + 0.2 * u, y: l.panel.y + 0.3 * u, w: l.panel.w, h: l.panel.h }, theme.radius * u, '#000');
    ctx.restore();
  }
  ctx.save();
  surface(ctx, m, l.panel, { fill: theme.panel, edge: theme.panelEdge, width: Math.max(1, theme.edge * u), radius: theme.radius * u, lift: 2 });
  const midY = l.header.y + l.header.h / 2 + 0.1 * u;
  const title = theme.uppercase ? m.title.toUpperCase() : m.title;
  text(ctx, title, l.panel.x + l.pad, midY, { size: 1.3 * u, font: theme.titleFont ?? theme.font, weight: theme.titleWeight ?? '800', color: theme.text, maxWidth: l.panel.w * 0.45 });
  // Purse and carry weight, right-aligned in the header.
  let right = l.panel.x + l.panel.w - l.pad;
  if (inv.maxWeight !== null) {
    const w = 4.6 * u;
    const bar = { x: right - w, y: midY + 0.35 * u, w, h: 0.28 * u };
    const share = Math.max(0, Math.min(1, inv.weight / (inv.maxWeight || 1)));
    box(ctx, bar, bar.h / 2, theme.track);
    if (share > 0) box(ctx, { ...bar, w: Math.max(bar.h, bar.w * share) }, bar.h / 2, share > 0.9 ? theme.danger : theme.good);
    text(ctx, `${Math.round(inv.weight * 10) / 10} / ${inv.maxWeight}`, right, midY - 0.25 * u, { size: 0.8 * u, font: theme.font, color: theme.textDim, align: 'right' });
    right -= w + 0.9 * u;
  }
  // In a shop that trades in another currency the purse shows that currency's balance, with its symbol instead of the coin.
  const purse = m.money && !m.money.coins ? `${m.money.balance}${m.money.symbol}` : String(m.money ? m.money.balance : inv.coins);
  text(ctx, purse, right, midY, { size: 1 * u, font: theme.font, weight: '800', color: theme.text, align: 'right' });
  ctx.font = `800 ${u}px ${theme.font}`;
  if (!m.money || m.money.coins) drawItemIcon(ctx, 'coin', right - ctx.measureText(purse).width - 1.35 * u, midY - 0.6 * u, 1.2 * u);

  for (const label of l.labels) text(ctx, theme.uppercase ? label.text.toUpperCase() : label.text, label.x, label.y, { size: 0.78 * u, font: theme.font, weight: '700', color: theme.textDim });
  drawDoll(ctx, m);
  for (const t of l.targets) if (t.zone === 'btn') drawButton(ctx, m, t); else drawCell(ctx, m, t);
  ctx.font = `500 ${0.72 * u}px ${theme.font}`;
  if (m.hint && ctx.measureText(m.hint).width * 0.8 <= l.hint.w - 0.5 * u) text(ctx, m.hint, l.hint.x, l.hint.y, { size: 0.72 * u, font: theme.font, weight: '500', color: theme.textDim, maxWidth: l.hint.w - 0.5 * u });

  if (m.held) {
    const stack = m.stackAt(m.held.from);
    const from = l.targets.find((t) => t.id === m.held.from);
    const over = l.targets.find((t) => t.id === m.cursor);
    if (stack && stack.id === m.held.id) {
      const s = l.cell * 1.1;
      const at = m.held.pointer || !over
        ? { x: m.point.x - s / 2, y: m.point.y - s / 2 }
        : { x: over.rect.x + l.cell * 0.18, y: over.rect.y - l.cell * 0.28 };
      if (m.held.pointer || over || from) drawStack(ctx, m, stack, { x: at.x, y: at.y, w: s, h: s }, 0.95);
    }
  } else drawTip(ctx, m);
  ctx.restore();
}
