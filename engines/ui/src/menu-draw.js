// Draws a menu on a 2D canvas context. Reads the menu, never changes it.

import { fillBox, label } from './draw.js';
import { drawSurface } from './surface.js';
import { easeOut, wrapText, estimateTextWidth } from './geometry.js';
import { drawRow } from './row-draw.js';

/**
 * drawMenu(ctx, menu, theme, view)
 *   view: { width, height, time, motion, fade = 1, backdrop = true }
 *   time: seconds, used for the focus pulse. motion: false turns animation off.
 *   fade: 0..1, below 1 while a closed menu fades away. backdrop: false skips the dim layer.
 */
export function drawMenu(ctx, menu, theme, view) {
  const l = menu.layout();
  const u = l.unit;
  const motion = view.motion !== false;
  const feel = theme.motionStyle ?? 'smooth';
  const appear = motion ? easeOut(menu.age / (feel === 'snappy' ? 0.08 : 0.16)) : 1;
  // 'bouncy' menus land with a little overshoot.
  const land = motion && feel === 'bouncy' && menu.age < 0.3 ? Math.sin(Math.min(1, menu.age / 0.3) * Math.PI) * 0.035 : 0;
  const fade = motion ? (view.fade ?? 1) : 1;
  const alpha = appear * fade;
  ctx.save();

  if (view.backdrop !== false) {
    if (menu.backdrop === 'solid') {
      ctx.globalAlpha = fade;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, view.width, view.height);
    } else if (menu.backdrop === 'dim') {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = theme.dim;
      ctx.fillRect(0, 0, view.width, view.height);
    }
  }
  ctx.globalAlpha = alpha;
  ctx.translate(0, (1 - appear) * u + (1 - fade) * 0.6 * u);
  if (land) {
    const cx = l.panel.x + l.panel.w / 2;
    const cy = l.panel.y + l.panel.h / 2;
    ctx.translate(cx, cy); ctx.scale(1 + land, 1 + land); ctx.translate(-cx, -cy);
  }

  if (menu.variant !== 'title') {
    drawSurface(ctx, l.panel, theme, u, { lift: 2, radius: theme.radius * u * 1.4 });
  }
  if (l.title) drawTitle(ctx, menu, l.title, theme, u);
  // A title screen has no panel: its small lines sit on the game's picture, so each gets a plate of its own.
  const bare = menu.variant === 'title';
  if (l.subtitle) {
    if (bare) plate(ctx, theme, u, l.subtitle.x, l.subtitle.y, Math.min(l.subtitle.maxWidth, textWidth(ctx, theme, menu.subtitle, l.subtitle.size)), l.subtitle.size);
    label(ctx, theme, menu.subtitle, l.subtitle.x, l.subtitle.y, {
      size: l.subtitle.size, weight: '500', color: theme.textDim, align: 'center', maxWidth: l.subtitle.maxWidth,
    });
  }
  for (const t of l.textLines) {
    label(ctx, theme, t.line, t.x, t.y, { size: t.size, weight: '500', color: theme.text, align: 'center', maxWidth: t.maxWidth });
  }

  // Rows are laid out at menu.scroll; what is drawn trails it for a smooth scroll.
  const shift = motion ? menu.scroll - menu.scrollShown : 0;
  const state = { time: view.time || 0, alpha, motion, focusAge: menu.focusAge, capturing: menu.capturing };
  ctx.save();
  ctx.beginPath();
  ctx.rect(l.view.x - u * 0.45, l.view.y - u * 0.3, l.view.w + u * 0.9, l.view.h + u * 0.6);
  ctx.clip();
  ctx.translate(0, shift);
  for (const row of l.rows) {
    if (row.rect.y + row.rect.h + shift < l.view.y - u || row.rect.y + shift > l.view.y + l.view.h + u) continue;
    state.focused = row.index === menu.focusIndex;
    state.pressedId = menu.pressedId;
    drawRow(ctx, menu.items[row.index], row, state, theme, u);
  }
  ctx.restore();

  if (l.maxScroll > 0) {
    const barH = Math.max(u, l.view.h * (l.view.h / (l.view.h + l.maxScroll)));
    const barY = l.view.y + (l.view.h - barH) * ((l.scroll - shift) / l.maxScroll);
    fillBox(ctx, { x: l.view.x + l.view.w + u * 0.3, y: Math.max(l.view.y, Math.min(l.view.y + l.view.h - barH, barY)), w: u * 0.2, h: barH },
      u * 0.1, theme.textDim);
  }
  if (l.hint) drawHint(ctx, menu.focusHint(), l.hint, theme, u);
  if (l.footer && menu.footer) {
    if (bare) plate(ctx, theme, u, l.footer.x, l.footer.y, Math.min(l.footer.maxWidth, textWidth(ctx, theme, menu.footer, l.footer.size)), l.footer.size);
    label(ctx, theme, menu.footer, l.footer.x, l.footer.y, {
      size: l.footer.size, weight: '500', color: theme.textDim, align: 'center', maxWidth: l.footer.maxWidth,
    });
  } else if (l.footer && view.hint && view.hint.length) {
    drawHints(ctx, view.hint, l.footer, theme, u, bare);
  }
  ctx.restore();
}

// The menu's heading, in the theme's title style.
function drawTitle(ctx, menu, at, theme, u) {
  const style = theme.titleStyle ?? 'bar';
  const text = menu.title;
  const opts = { size: at.size, font: theme.titleFont, weight: theme.titleWeight, align: 'center', maxWidth: at.maxWidth };
  const wide = Math.min(at.maxWidth, estimateTextWidth(text, at.size) * 1.05 + 2.4 * u);
  if (style === 'banner') {
    // A ribbon behind the title, its ends notched like cut cloth.
    const h = at.size * 1.36;
    const x = at.x - wide / 2;
    const y = at.y - h / 2;
    const n = 0.45 * u;
    ctx.fillStyle = theme.shadow;
    ctx.fillRect(x + 0.16 * u, y + 0.16 * u, wide, h);
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + wide, y); ctx.lineTo(x + wide - n, y + h / 2); ctx.lineTo(x + wide, y + h);
    ctx.lineTo(x, y + h); ctx.lineTo(x + n, y + h / 2);
    ctx.closePath();
    ctx.fill();
    label(ctx, theme, text, at.x, at.y, { ...opts, color: theme.accentText, maxWidth: wide - 2 * n - 0.6 * u });
    return;
  }
  if (style === 'boxed') {
    const h = at.size * 1.36;
    fillBox(ctx, { x: at.x - wide / 2, y: at.y - h / 2, w: wide, h }, 0.3 * u, theme.track, theme.accent, Math.max(1, 0.08 * u), 'cut');
    label(ctx, theme, text, at.x, at.y, { ...opts, color: theme.text, maxWidth: wide - 1.4 * u });
    return;
  }
  if (style === 'shadow') {
    label(ctx, theme, text, at.x + 0.09 * u, at.y + 0.11 * u, { ...opts, color: theme.accent });
  }
  label(ctx, theme, text, at.x, at.y, { ...opts, color: theme.text });
  if (style === 'bar') {
    const barW = Math.min(at.maxWidth, 3 * u);
    const barH = Math.max(2, 0.14 * u);
    fillBox(ctx, { x: at.x - barW / 2, y: at.barY - barH / 2, w: barW, h: barH }, theme.style === 'ascii' ? 0 : barH / 2, theme.accent);
  }
}

const textWidth = (ctx, theme, text, size) => { ctx.font = `500 ${size}px ${theme.font}`; return ctx.measureText(text).width; };

/** A quiet plate in the panel colour behind one centred line, so textDim keeps its contrast off the panel. */
function plate(ctx, theme, u, cx, cy, w, size) {
  const h = size * 1.7;
  const box = { x: cx - w / 2 - 0.7 * size, y: cy - h / 2, w: w + 1.4 * size, h };
  ctx.save();
  ctx.globalAlpha *= 0.88;
  fillBox(ctx, box, theme.style === 'ascii' ? 0 : h / 2, theme.panel);
  ctx.restore();
}

// Control hints: each one a small key cap and a word, the row centred under the list.
function drawHints(ctx, parts, at, theme, u, bare = false) {
  const size = at.size;
  const capW = (p) => Math.max(1.5 * size, estimateTextWidth(p.key, size) + 0.9 * size);
  const wordW = (p) => estimateTextWidth(p.text, size);
  const gap = 0.45 * size;
  const between = 1.5 * size;
  const total = parts.reduce((sum, p) => sum + capW(p) + gap + wordW(p), 0) + between * (parts.length - 1);
  const squeeze = Math.min(1, at.maxWidth / total);
  let x = at.x - (total * squeeze) / 2;
  if (bare) plate(ctx, theme, u, at.x, at.y, total * squeeze, size * 1.3);
  for (const p of parts) {
    const w = capW(p) * squeeze;
    const cap = { x, y: at.y - 0.72 * size, w, h: 1.44 * size };
    fillBox(ctx, cap, theme.style === 'ascii' ? 0 : 0.3 * size, theme.track, theme.panelEdge, Math.max(1, 0.07 * u));
    label(ctx, theme, p.key, x + w / 2, at.y, { size: size * 0.92, weight: '700', color: theme.text, align: 'center', maxWidth: w - 0.3 * size });
    x += w + gap * squeeze;
    label(ctx, theme, p.text, x, at.y, { size, weight: '500', color: theme.textDim, maxWidth: wordW(p) * squeeze + 2 });
    x += (wordW(p) + between) * squeeze;
  }
}

// The focused row's name and description, under the list.
function drawHint(ctx, hint, box, theme, u) {
  ctx.fillStyle = theme.panelEdge;
  ctx.fillRect(box.x, box.y - 0.25 * u, box.w, Math.max(1, 0.05 * u));
  if (!hint) return;
  let line = 0;
  const y = (n) => box.y + box.lineH * (n + 0.5);
  if (hint.title) {
    label(ctx, theme, hint.title, box.x, y(line), { size: box.size * 1.1, weight: '700', color: theme.text, maxWidth: box.w });
    line += 1;
  }
  if (!hint.text) return;
  const lines = wrapText(hint.text, box.w / (box.size * 0.52));
  for (const text of lines.slice(0, box.lines - line)) {
    label(ctx, theme, text, box.x, y(line), { size: box.size, weight: '500', color: theme.textDim, maxWidth: box.w });
    line += 1;
  }
}
