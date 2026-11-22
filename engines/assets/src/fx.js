// Screen effects a game can draw over its finished frame.

/**
 * Old-monitor look: dark scanlines plus darkened corners. Call last in the frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width   Canvas width in pixels.
 * @param {number} height  Canvas height in pixels.
 * @param {{scanlines?:number, spacing?:number, vignette?:number}} [opts]  Strengths 0 to 1; spacing is pixels between lines.
 */
export function drawCrt(ctx, width, height, opts = {}) {
  const { scanlines = 0.18, spacing = 3, vignette = 0.5 } = opts;
  if (!(spacing >= 2)) throw new Error(`drawCrt: spacing must be 2 or more, got ${spacing}`);
  ctx.save();
  if (scanlines > 0) {
    ctx.fillStyle = `rgba(0,0,0,${scanlines})`;
    for (let y = 0; y < height; y += spacing) ctx.fillRect(0, y, width, 1);
  }
  if (vignette > 0) {
    const r = Math.hypot(width, height) / 2;
    const g = ctx.createRadialGradient(width / 2, height / 2, r * 0.55, width / 2, height / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}
