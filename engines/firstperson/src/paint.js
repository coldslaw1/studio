// Turns a frame of character cells into pixels. Written straight into a pixel array (one pass,
// no per-cell canvas calls), then copied to the canvas, so painting costs about a millisecond.
import { glyphBitmap } from './color.js';

const HALF = 0x2580;
// canvas pixels are stored red first in memory, which on every supported machine is 0xAABBGGRR
const abgr = (c) => (0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | (c >>> 16)) >>> 0;

/** How much of each pixel of a cellPx x cellPx cell a glyph's 8x8 bitmap covers (0..1). */
export function glyphCoverage(bitmap, cellPx) {
  const out = new Float32Array(cellPx * cellPx);
  const sub = 4; // sample points per pixel each way
  for (let y = 0; y < cellPx; y++) {
    for (let x = 0; x < cellPx; x++) {
      let on = 0;
      for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
        const gx = Math.min(7, Math.floor((x + (i + 0.5) / sub) * 8 / cellPx)); const gy = Math.min(7, Math.floor((y + (j + 0.5) / sub) * 8 / cellPx));
        if (bitmap[gy] & (0x80 >> gx)) on++;
      }
      out[y * cellPx + x] = on / (sub * sub);
    }
  }
  return out;
}

/**
 * @param {object} world   For the glyph bitmaps of its materials and sky.
 * @param {object} frame   { cols, rows, ch, fg, bg } that the view fills.
 * @param {number} cellPx  Pixels per character.
 * @param {(w:number, h:number) => object} [createCanvas]
 */
export function createPainter(world, frame, cellPx, createCanvas) {
  if (!(Number.isInteger(cellPx) && cellPx >= 1 && cellPx <= 32)) throw new Error(`createFirstPerson: "cellPx" must be a whole number from 1 to 32, got ${cellPx}`);
  const { cols, rows } = frame;
  const W = cols * cellPx; const H = rows * cellPx;
  const cover = new Map();
  for (const m of world.materials) cover.set(m.code, glyphCoverage(m.bitmap, cellPx));
  cover.set(world.sky.code, glyphCoverage(world.sky.bitmap, cellPx));
  const half = cellPx >> 1;
  let canvas = null; let cctx = null; let image = null; let pixels = null;

  function paint(px) {
    if (px.length !== W * H) throw new Error(`firstperson paint: expected ${W * H} pixels (${W} x ${H}), got ${px.length}`);
    const { ch, fg, bg } = frame;
    for (let r = 0, i = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        const code = ch[i];
        const b = abgr(bg[i]);
        const base = r * cellPx * W + c * cellPx;
        if (code === 32) { for (let y = 0; y < cellPx; y++) { const p = base + y * W; for (let x = 0; x < cellPx; x++) px[p + x] = b; } continue; }
        if (code === HALF) {
          const f = abgr(fg[i]);
          for (let y = 0; y < cellPx; y++) { const p = base + y * W; const v = y < half ? f : b; for (let x = 0; x < cellPx; x++) px[p + x] = v; }
          continue;
        }
        let cv = cover.get(code);
        if (!cv) { cv = glyphCoverage(glyphBitmap(String.fromCharCode(code)), cellPx); cover.set(code, cv); }
        const fr = fg[i] >>> 16; const fgn = (fg[i] >>> 8) & 255; const fb = fg[i] & 255;
        const br = bg[i] >>> 16; const bgn = (bg[i] >>> 8) & 255; const bb = bg[i] & 255;
        for (let y = 0; y < cellPx; y++) {
          const p = base + y * W;
          for (let x = 0; x < cellPx; x++) {
            const k = cv[y * cellPx + x];
            px[p + x] = k === 0 ? b : (0xff000000 | ((bb + (fb - bb) * k) << 16) | ((bgn + (fgn - bgn) * k) << 8) | (br + (fr - br) * k)) >>> 0;
          }
        }
      }
    }
    return px;
  }

  return {
    cellPx, width: W, height: H, paint,
    draw(ctx, x, y, w, h) {
      if (!canvas) {
        canvas = createCanvas ? createCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
        cctx = canvas.getContext('2d');
        image = cctx.createImageData(W, H);
        pixels = new Uint32Array(image.data.buffer);
      }
      paint(pixels);
      cctx.putImageData(image, 0, 0);
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, x, y, w, h);
      ctx.imageSmoothingEnabled = smooth;
    },
  };
}
