// Small canvas drawing helpers shared by menus and the HUD.
// Each helper leaves the context state as it found it, except fillStyle/font.

/** roundRectPath(ctx, x, y, w, h, r) traces a rounded rectangle path (no fill). */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rad === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/** Shapes a button or chip can have (a theme's `buttonShape` token). */
export const SHAPE_NAMES = ['round', 'pill', 'cut', 'tab', 'plain'];

/**
 * boxPath(ctx, x, y, w, h, r, shape) traces a box outline (no fill).
 *   shape: 'round' (corner radius r, the default), 'pill' (fully rounded ends),
 *   'cut' (corners sliced off), 'tab' (slanted sides) or 'plain' (square corners).
 */
export function boxPath(ctx, x, y, w, h, r, shape = 'round') {
  if (shape === 'cut' || shape === 'tab') {
    const c = Math.min(shape === 'cut' ? Math.max(r, h * 0.24) : h * 0.3, h / 2, w / 4);
    ctx.beginPath();
    if (shape === 'cut') {
      ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + h - c);
      ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c);
    } else {
      ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h);
    }
    ctx.closePath();
    return;
  }
  roundRectPath(ctx, x, y, w, h, shape === 'pill' ? h / 2 : (shape === 'plain' ? 0 : r));
}

/** fillBox(ctx, rect, radius, fill, edgeColor, edgeWidth, shape) draws a filled, optionally outlined box. */
export function fillBox(ctx, rect, radius, fill, edgeColor, edgeWidth, shape) {
  boxPath(ctx, rect.x, rect.y, rect.w, rect.h, radius, shape);
  ctx.fillStyle = fill;
  ctx.fill();
  if (edgeColor && edgeWidth > 0) {
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.stroke();
  }
}

const FIT_LIMIT = 600;

/**
 * drawText(ctx, text, x, y, opts) draws one line, shrinking the font until it
 * fits opts.maxWidth (down to 55% of opts.size).
 *   opts: { size, font, weight = '600', color, align = 'left', maxWidth, fit }
 *   fit: optional Map used to remember the fitted size, so text is measured
 *        once instead of every frame (createUi keeps one per theme).
 * y is the vertical middle of the text.
 */
export function drawText(ctx, text, x, y, opts) {
  const { size, font, weight = '600', color, align = 'left', maxWidth, fit } = opts;
  let px = size;
  if (maxWidth > 0) {
    const key = fit ? `${weight}|${Math.round(size * 8)}|${Math.round(maxWidth)}|${font}|${text}` : null;
    const known = key === null ? undefined : fit.get(key);
    if (known !== undefined) {
      px = known;
    } else {
      ctx.font = `${weight} ${px}px ${font}`;
      let guard = 0;
      while (ctx.measureText(text).width > maxWidth && px > size * 0.55 && guard < 12) {
        px *= 0.92;
        ctx.font = `${weight} ${px}px ${font}`;
        guard += 1;
      }
      if (key !== null) {
        if (fit.size >= FIT_LIMIT) fit.clear();
        fit.set(key, px);
      }
    }
  }
  ctx.font = `${weight} ${px}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/**
 * label(ctx, theme, text, x, y, opts) is drawText with the theme's font and
 * its remembered text sizes filled in. opts as drawText; `font` defaults to theme.font.
 */
export function label(ctx, theme, text, x, y, opts) {
  drawText(ctx, text, x, y, { font: theme.font, fit: theme.fit, ...opts });
}
