// Colours and the small built-in font. Colours are packed as 0xRRGGBB numbers inside the renderer.

/** '#rrggbb' or '#rgb' to [r, g, b] (0..255). */
export function hexRgb(hex, where = 'hexRgb') {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`${where}: not a hex colour: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** 0xRRGGBB to '#rrggbb'. */
export const packedHex = (c) => '#' + c.toString(16).padStart(6, '0');

/** 8x8 bitmaps (one byte per row) for the characters materials usually use, so they look the same in every browser. */
export const GLYPHS = {
  '.': [0, 0, 0, 0, 0, 0x18, 0x18, 0],
  ',': [0, 0, 0, 0, 0, 0x18, 0x18, 0x30],
  ':': [0, 0x18, 0x18, 0, 0, 0x18, 0x18, 0],
  ';': [0, 0x18, 0x18, 0, 0, 0x18, 0x18, 0x30],
  "'": [0x18, 0x18, 0x30, 0, 0, 0, 0, 0],
  '"': [0x66, 0x66, 0x44, 0, 0, 0, 0, 0],
  '`': [0x30, 0x18, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x7e, 0, 0, 0, 0],
  '_': [0, 0, 0, 0, 0, 0, 0x7e, 0],
  '=': [0, 0, 0x7e, 0, 0x7e, 0, 0, 0],
  '+': [0, 0x18, 0x18, 0x7e, 0x18, 0x18, 0, 0],
  '*': [0, 0x66, 0x3c, 0xff, 0x3c, 0x66, 0, 0],
  '#': [0x24, 0x24, 0x7e, 0x24, 0x7e, 0x24, 0x24, 0],
  '%': [0x62, 0x64, 0x08, 0x10, 0x26, 0x46, 0, 0],
  '@': [0x3c, 0x42, 0x5a, 0x5a, 0x5c, 0x40, 0x3c, 0],
  '~': [0, 0, 0x32, 0x4c, 0, 0, 0, 0],
  '^': [0x10, 0x28, 0x44, 0, 0, 0, 0, 0],
  '|': [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0],
  '/': [0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0, 0],
  '\\': [0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0, 0],
  'o': [0, 0, 0x3c, 0x42, 0x42, 0x3c, 0, 0],
  'x': [0, 0, 0x44, 0x28, 0x10, 0x28, 0x44, 0],
};

/** The bitmap for a character: its own if known, else a dot, so an unusual glyph still shows as texture. */
export const glyphBitmap = (ch) => GLYPHS[ch] ?? GLYPHS['.'];
