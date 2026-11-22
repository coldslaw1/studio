// Draws a character grid on a canvas. Self-contained on purpose (no outside references), because
// the PNG step sends this function's source into a browser page.

/**
 * @param {CanvasRenderingContext2D} g
 * @param {{cols:number, rows:number, ch:string[], fg:number[], bg:number[]}} grid  Colour -1 = transparent.
 * @param {string[]} palette  Hex colours.
 * @param {number} zoom       Pixels per glyph pixel; one character is 8 x 8 glyph pixels.
 * @param {number} [ox]       Left edge in canvas pixels.
 * @param {Array} [ramp]      RAMP from ascii.js: bitmaps for the ASCII characters, so they look the same everywhere.
 */
export function drawGrid(g, grid, palette, zoom, ox = 0, ramp = []) {
  const s = 8 * zoom;
  const h = s / 2;
  // [x, y, w, h] in half cells for the block glyphs
  const blocks = { '█': [0, 0, 2, 2], '▀': [0, 0, 2, 1], '▄': [0, 1, 2, 1], '▌': [0, 0, 1, 2], '▐': [1, 0, 1, 2], '■': [0.5, 0.5, 1, 1] };
  const shades = { '░': 0.25, '▒': 0.5, '▓': 0.75 };
  const bitmaps = Object.fromEntries(ramp);
  g.font = `${s}px "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace`;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  for (let y = 0; y < grid.rows; y++) {
    const chars = [...grid.ch[y]];
    for (let x = 0; x < grid.cols; x++) {
      const i = y * grid.cols + x;
      const px = ox + x * s;
      const py = y * s;
      if (grid.bg[i] >= 0) { g.fillStyle = palette[grid.bg[i]]; g.fillRect(px, py, s, s); }
      const ch = chars[x];
      if (ch === ' ' || grid.fg[i] < 0) continue;
      g.fillStyle = palette[grid.fg[i]];
      if (blocks[ch]) { const b = blocks[ch]; g.fillRect(px + b[0] * h, py + b[1] * h, b[2] * h, b[3] * h); }
      else if (shades[ch]) { g.globalAlpha = shades[ch]; g.fillRect(px, py, s, s); g.globalAlpha = 1; }
      else if (bitmaps[ch]) { bitmaps[ch].forEach((bits, r) => { for (let k = 0; k < 8; k++) if (bits & (0x80 >> k)) g.fillRect(px + k * zoom, py + r * zoom, zoom, zoom); }); }
      else g.fillText(ch, px + h, py + h, s);
    }
  }
}
