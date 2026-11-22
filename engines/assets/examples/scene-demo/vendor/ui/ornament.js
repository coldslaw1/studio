// Panel ornaments: small decorations that give a theme its character. Each is
// a handful of fills or strokes, so a panel stays cheap to draw.

/** Names a theme's `ornament` token may use. */
export const ORNAMENT_NAMES = ['none', 'corners', 'rivets', 'stitch', 'double', 'scanlines', 'notch'];

const TAU = Math.PI * 2;

/**
 * drawOrnament(ctx, rect, theme, u) decorates a panel that is already drawn.
 *   corners    metal brackets on the four corners (accent colour)
 *   rivets     a round stud in each corner
 *   stitch     a dashed seam just inside the edge
 *   double     a second thin outline inside the first
 *   scanlines  faint horizontal lines, like an old screen
 *   notch      a small accent tab on the top edge and short ticks on the sides
 */
export function drawOrnament(ctx, rect, theme, u) {
  const kind = theme.ornament;
  const { x, y, w, h } = rect;
  if (w < 3 * u || h < 2 * u) return; // too small to decorate
  ctx.save();
  if (kind === 'corners') {
    const arm = Math.min(1.1 * u, w / 4, h / 4);
    const t = Math.max(2, 0.16 * u);
    const o = -t * 0.4; // sit slightly outside the edge, like fitted iron
    ctx.fillStyle = theme.accent;
    for (const [cx, cy, sx, sy] of [[x + o, y + o, 1, 1], [x + w - o, y + o, -1, 1], [x + o, y + h - o, 1, -1], [x + w - o, y + h - o, -1, -1]]) {
      ctx.fillRect(sx > 0 ? cx : cx - arm, sy > 0 ? cy : cy - t, arm, t);
      ctx.fillRect(sx > 0 ? cx : cx - t, sy > 0 ? cy : cy - arm, t, arm);
    }
  } else if (kind === 'rivets') {
    const inset = 0.5 * u;
    const r = Math.max(1.5, 0.14 * u);
    for (const [cx, cy] of [[x + inset, y + inset], [x + w - inset, y + inset], [x + inset, y + h - inset], [x + w - inset, y + h - inset]]) {
      ctx.fillStyle = theme.panelEdge;
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.3, r * 1.25, 0, TAU); ctx.fill();
      ctx.fillStyle = theme.textDim;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    }
  } else if (kind === 'stitch' || kind === 'double') {
    const inset = (kind === 'stitch' ? 0.32 : 0.24) * u;
    const r = Math.max(0, theme.radius * u * 1.4 - inset);
    ctx.globalAlpha = (ctx.globalAlpha ?? 1) * (kind === 'stitch' ? 0.55 : 0.6);
    ctx.strokeStyle = kind === 'stitch' ? theme.textDim : theme.accent;
    ctx.lineWidth = Math.max(1, (kind === 'stitch' ? 0.07 : 0.05) * u);
    if (kind === 'stitch') ctx.setLineDash([0.32 * u, 0.24 * u]);
    ctx.beginPath();
    if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(x + inset, y + inset, w - inset * 2, h - inset * 2, r);
    else ctx.rect(x + inset, y + inset, w - inset * 2, h - inset * 2);
    ctx.stroke();
    if (kind === 'stitch') ctx.setLineDash([]);
  } else if (kind === 'scanlines') {
    const step = Math.max(3, 0.42 * u);
    const lines = Math.min(48, Math.floor((h - step) / step));
    ctx.globalAlpha = (ctx.globalAlpha ?? 1) * 0.07;
    ctx.fillStyle = theme.text;
    for (let i = 1; i <= lines; i++) ctx.fillRect(x + 2, y + i * step, w - 4, 1);
  } else if (kind === 'notch') {
    const t = Math.max(2, 0.14 * u);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(x + w / 2 - 1.6 * u, y - t / 2, 3.2 * u, t);
    ctx.fillRect(x - t / 2, y + h / 2 - 0.8 * u, t, 1.6 * u);
    ctx.fillRect(x + w - t / 2, y + h / 2 - 0.8 * u, t, 1.6 * u);
  }
  ctx.restore();
}
