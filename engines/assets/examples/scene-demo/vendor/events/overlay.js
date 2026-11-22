// Draws what a cutscene lays over the game: the fade, the letterbox bars, the spoken line, the
// "hold to skip" ring and the interact hint. One call, after the world and before the menus.

const DEFAULTS = { panel: 'rgba(12, 12, 18, 0.88)', text: '#f2efe6', textDim: '#b9b4a6', accent: '#e8b04a', shadow: '#000' };

/** Split text into lines no wider than maxWidth, using ctx.measureText. */
export function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * drawEventsOverlay(ctx, view, options)
 *   view     events.view()
 *   options  width, height (canvas size, required); palette { panel, text, textDim, accent, shadow } (the base's
 *            style palette fits); font ('16px sans-serif'); barSize (0.12 of the height);
 *            toScreen(x, y) -> { x, y, visible } to pin the interact hint over its target; promptKey ('E');
 *            scale (1): real pixels per logical pixel. On a HiDPI canvas pass the pixel ratio, with width and
 *            height still the canvas size in real pixels: text and boxes then keep their size on screen
 * Restores every context setting it changes.
 */
export function drawEventsOverlay(ctx, view, options = {}) {
  const scale = options.scale ?? 1;
  if (!(options.width > 0) || !(options.height > 0)) throw new Error(`drawEventsOverlay: options.width and options.height must be the canvas size, got ${options.width} x ${options.height}`);
  if (!(scale > 0)) throw new Error(`drawEventsOverlay: options.scale must be a number above 0, got ${JSON.stringify(options.scale)}`);
  const width = options.width / scale; const height = options.height / scale; // everything below is in logical pixels
  const colors = { ...DEFAULTS, ...(options.palette ?? {}) };
  const font = options.font ?? `${Math.max(12, Math.round(height / 28))}px sans-serif`;
  const size = Number.parseInt(font, 10) || 16;
  ctx.save();
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.font = font; ctx.textBaseline = 'top'; ctx.textAlign = 'left';

  if (view.fade > 0) { ctx.globalAlpha = Math.min(1, view.fade); ctx.fillStyle = view.fadeColor; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1; }
  const bar = Math.round(height * (options.barSize ?? 0.12) * view.bars);
  if (bar > 0) { ctx.fillStyle = colors.shadow; ctx.fillRect(0, 0, width, bar); ctx.fillRect(0, height - bar, width, bar); }

  const caption = view.caption;
  if (caption) {
    const pad = Math.round(size * 0.7); const line = Math.round(size * 1.35);
    const boxW = Math.min(width - pad * 2, caption.bark ? size * 26 : size * 44);
    ctx.font = font;
    const all = wrapLines(ctx, caption.full, boxW - pad * 2); // wrap the whole line once so words do not jump while typing
    let left = caption.text.length; const shown = [];
    for (const l of all) { if (left <= 0) break; shown.push(l.slice(0, left)); left -= l.length + 1; }
    const boxH = pad * 2 + line * (all.length + (caption.speaker ? 1 : 0));
    const x = Math.round((width - boxW) / 2);
    const y = caption.bark ? Math.round(height * 0.14) : Math.round(height - boxH - Math.max(bar * 0.35, pad));
    ctx.fillStyle = colors.panel; ctx.fillRect(x, y, boxW, boxH);
    let ty = y + pad;
    if (caption.speaker) { ctx.fillStyle = colors.accent; ctx.fillText(caption.speaker, x + pad, ty); ty += line; }
    ctx.fillStyle = colors.text;
    for (const l of shown) { ctx.fillText(l, x + pad, ty); ty += line; }
    if (caption.done && !caption.bark) { ctx.fillStyle = colors.textDim; ctx.textAlign = 'right'; ctx.fillText('▼', x + boxW - pad, y + boxH - pad - size); ctx.textAlign = 'left'; }
  }

  if (view.skip > 0) { // hold-to-skip ring, top right
    const r = size * 0.8; const cx = width - r * 2; const cy = Math.max(bar, 0) + r * 2;
    ctx.lineWidth = Math.max(2, size / 6); ctx.strokeStyle = colors.textDim; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = colors.accent; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * view.skip); ctx.stroke();
    ctx.fillStyle = colors.text; ctx.textAlign = 'right'; ctx.fillText('Skip', cx - r * 1.6, cy - size / 2);
  }

  const prompt = view.prompt;
  if (prompt && !view.busy) {
    const label = `[${options.promptKey ?? 'E'}] ${prompt.text}`;
    const real = options.toScreen?.(prompt.x, prompt.y); // toScreen answers in real canvas pixels
    const at = real ? { ...real, x: real.x / scale, y: real.y / scale } : real;
    const w = ctx.measureText(label).width + size;
    const px = at && at.visible !== false ? at.x - w / 2 : (width - w) / 2;
    const py = at && at.visible !== false ? at.y - size * 2.2 : height - size * 3;
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.panel; ctx.fillRect(Math.round(px), Math.round(py), Math.round(w), Math.round(size * 1.7));
    ctx.fillStyle = colors.text; ctx.fillText(label, Math.round(px + size / 2), Math.round(py + size * 0.35));
  }
  ctx.restore();
}
