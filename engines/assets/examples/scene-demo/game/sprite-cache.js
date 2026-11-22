// Drawing a sprite on a Kiln scene costs about a third of a millisecond: the text cells are
// painted and every cell is tested against the scene's depth to cut away what is hidden. A dozen
// sprites, drawn again for every screen frame, was nearly all of the hamlet's drawing time. But the
// result only changes when the thing moves, its pose changes (once per game tick) or the picture
// behind it changes. So each sprite keeps its finished, already cut-out picture and is redrawn only
// then; on every other frame it is a single image copy. Things outside the canvas are skipped.

/**
 * Draw `sprite` standing at ground x, y of `view`, like view.drawSprite, reusing the last result
 * when nothing changed.
 * @param {object} slot     Any object owned by the caller, one per sprite on screen; the cache lives on it.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} view     The Kiln view being shown.
 * @param {{x:number,y:number,w:number,h:number}} rect  Where the view is drawn.
 * @param {object} sprite   What to draw (a Kiln view or a puppet text sprite).
 * @param {number} x        Ground position.
 * @param {number} y
 * @param {object} opts     The options of view.drawSprite (scale, occlude, z, bias, frame...).
 * @param {number|string} version  Changes whenever the sprite's own picture changes (puppet.version).
 * @param {{width:number,height:number}} canvas  The canvas size, to skip what is off screen.
 * @returns {{x:number,y:number,w:number,h:number}|null} where it was drawn, or null when off screen
 */
export function drawSpriteCached(slot, ctx, view, rect, sprite, x, y, opts, version, canvas) {
  const z = opts.z ?? 0;
  const feet = view.toPoint(x, y, rect, view.heightAt(x, y) + z);
  const c = slot.spriteCache ??= { key: '', size: 0, canvas: null, g: null, out: null };
  const reach = c.size || 400;
  if (feet.x < -reach || feet.y < -reach || feet.x > canvas.width + reach || feet.y > canvas.height + reach * 2) return null; // not on screen
  const fx = Math.round(feet.x - rect.x); const fy = Math.round(feet.y - rect.y);
  if (!c.size) { // first time: draw it the plain way, to learn how big it is
    const out = view.drawSprite(ctx, rect, sprite, x, y, opts);
    c.size = Math.ceil(Math.max(out.w, out.h, 16) * 2.2) + 16;
    return out;
  }
  const S = c.size;
  const key = `${fx},${fy},${z},${opts.scale ?? 1},${opts.occlude !== false},${opts.frame ?? 0},${rect.w},${rect.h},${version}`;
  if (c.view !== view || c.key !== key) {
    if (!c.canvas) { c.canvas = ctx.canvas.ownerDocument.createElement('canvas'); c.g = c.canvas.getContext('2d'); }
    if (c.canvas.width !== S) { c.canvas.width = S; c.canvas.height = S; } else c.g.clearRect(0, 0, S, S);
    // the same drawing, moved so the feet land at a fixed spot of the small canvas
    const out = view.drawSprite(c.g, { x: Math.round(S / 2) - fx, y: Math.round(S * 0.8) - fy, w: rect.w, h: rect.h }, sprite, x, y, opts);
    if (out.w > S * 0.9 || out.h > S * 0.75) c.size = Math.ceil(Math.max(out.w, out.h) * 2.2) + 16; // it grew (zoomed in): a bigger canvas next time
    c.out = out; c.key = key; c.view = view;
  }
  const left = rect.x + fx - Math.round(S / 2); const top = rect.y + fy - Math.round(S * 0.8);
  ctx.drawImage(c.canvas, left, top);
  return { ...c.out, x: c.out.x + left, y: c.out.y + top };
}
