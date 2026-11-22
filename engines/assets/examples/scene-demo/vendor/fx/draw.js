// Painting the cell list. Glyphs come from a small sheet made once per style and cell size
// (every glyph in every colour), so a picture is one image copy per cell and no text drawing.
// Where no sheet can be made (tests, odd hosts) each glyph is a few rectangles instead.
import { GLYPHS, GLYPH_LIST, glyphRuns, glyphCoverage } from './glyphs.js';

const defaultCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width: w, height: h });
  return null;
};

/** makeSheetPixels(cellPx, colors) -> { width, height, data: Uint8ClampedArray RGBA }: glyph id across, colour index down. */
export function makeSheetPixels(cellPx, colors) {
  const width = GLYPH_LIST.length * cellPx; const height = colors.length * cellPx;
  const data = new Uint8ClampedArray(width * height * 4);
  GLYPH_LIST.forEach((ch, g) => {
    const cover = glyphCoverage(GLYPHS[ch], cellPx);
    for (let c = 0; c < colors.length; c++) {
      const rgb = colors[c];
      for (let y = 0; y < cellPx; y++) for (let x = 0; x < cellPx; x++) {
        const k = cover[y * cellPx + x];
        if (k === 0) continue;
        const o = ((c * cellPx + y) * width + g * cellPx + x) * 4;
        data[o] = rgb >>> 16; data[o + 1] = (rgb >>> 8) & 255; data[o + 2] = rgb & 255; data[o + 3] = Math.round(Math.min(1, k * 1.6) * 255);
      }
    }
  });
  return { width, height, data };
}

/**
 * createPainter(options) -> painter
 *   options.createCanvas   (w, h) -> a canvas for the glyph sheet. Default: OffscreenCanvas or a browser canvas; none under Node.
 * painter.paint(ctx, list, view, palette, veilCss) -> cells painted
 *   palette  { packed: number[], css: string[], version }     veilCss  an 'rgba(...)' fill for veiled cells
 */
export function createPainter(options = {}) {
  const createCanvas = options.createCanvas ?? defaultCanvas;
  const sheets = new Map(); // 'cellPx:version' -> canvas or null
  const runs = GLYPH_LIST.map((ch) => glyphRuns(GLYPHS[ch]));
  function sheet(cellPx, palette) {
    const key = cellPx + ':' + palette.version;
    if (sheets.has(key)) return sheets.get(key);
    if (sheets.size >= 6) sheets.delete(sheets.keys().next().value);
    let canvas = null;
    try {
      canvas = createCanvas(GLYPH_LIST.length * cellPx, palette.packed.length * cellPx);
      const c = canvas?.getContext?.('2d');
      if (!c || typeof c.createImageData !== 'function') canvas = null; else {
        const px = makeSheetPixels(cellPx, palette.packed);
        const image = c.createImageData(px.width, px.height);
        image.data.set(px.data);
        c.putImageData(image, 0, 0);
      }
    } catch { canvas = null; }
    sheets.set(key, canvas);
    return canvas;
  }
  return {
    get sheets() { return sheets.size; },
    paint(ctx, list, view, palette, veilCss) {
      if (list.n === 0) return 0;
      const cp = view.cellPx; const ox = view.originX; const oy = view.originY; const cols = list.cols;
      const fill = ctx.fillStyle; const smooth = ctx.imageSmoothingEnabled;
      let veiled = false;
      for (let i = 0; i < list.n; i++) {
        const k = list.cell[i];
        if (!list.veil[k]) continue;
        if (!veiled) { ctx.fillStyle = veilCss; veiled = true; }
        ctx.fillRect(ox + (k % cols) * cp, oy + Math.floor(k / cols) * cp, cp, cp);
      }
      const whole = Number.isInteger(cp) ? sheet(cp, palette) : null;
      if (whole) {
        ctx.imageSmoothingEnabled = false;
        for (let i = 0; i < list.n; i++) {
          const k = list.cell[i];
          ctx.drawImage(whole, list.glyph[k] * cp, list.color[k] * cp, cp, cp, ox + (k % cols) * cp, oy + Math.floor(k / cols) * cp, cp, cp);
        }
        ctx.imageSmoothingEnabled = smooth;
      } else {
        const u = cp / 8; let last = -1;
        for (let i = 0; i < list.n; i++) {
          const k = list.cell[i]; const x = ox + (k % cols) * cp; const y = oy + Math.floor(k / cols) * cp;
          if (list.color[k] !== last) { last = list.color[k]; ctx.fillStyle = palette.css[last]; }
          const r = runs[list.glyph[k]];
          for (let j = 0; j < r.length; j += 3) ctx.fillRect(x + r[j] * u, y + r[j + 1] * u, r[j + 2] * u, u);
        }
      }
      ctx.fillStyle = fill;
      return list.n;
    },
  };
}
