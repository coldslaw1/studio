// Character-grid ("ASCII art") rendering: every sprite becomes rows of coloured text cells.
// Each cell is a glyph with a foreground and a background colour. Two samples across and two down
// are taken per character, so quarter-block glyphs give twice the resolution of the text grid, the
// way terminal 3D renderers do it. Flat areas can be filled with ordinary ASCII characters for
// the "made of text" texture. This is an original renderer; it shares no code with other engines.

/** Glyph for each quarter-block pattern. Bits: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right. */
export const QUADRANTS = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█'];

/** ASCII characters from faint to dense, with their 8x8 bitmaps (one byte per row). */
export const RAMP = [
  ['.', [0, 0, 0, 0, 0, 0x18, 0x18, 0]],
  [':', [0, 0x18, 0x18, 0, 0, 0x18, 0x18, 0]],
  ['-', [0, 0, 0, 0x7e, 0, 0, 0, 0]],
  ['=', [0, 0, 0x7e, 0, 0x7e, 0, 0, 0]],
  ['+', [0, 0x18, 0x18, 0x7e, 0x18, 0x18, 0, 0]],
  ['*', [0, 0x66, 0x3c, 0xff, 0x3c, 0x66, 0, 0]],
  ['#', [0x24, 0x24, 0x7e, 0x24, 0x7e, 0x24, 0x24, 0]],
  ['%', [0x62, 0x64, 0x08, 0x10, 0x26, 0x46, 0, 0]],
  ['@', [0x3c, 0x42, 0x5a, 0x5a, 0x5c, 0x40, 0x3c, 0]],
];

/** The 240 colours terminals share: a 6x6x6 colour cube and 24 greys. */
export function xtermPalette() {
  const steps = [0, 95, 135, 175, 215, 255];
  const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const out = [];
  for (const r of steps) for (const g of steps) for (const b of steps) out.push(hex(r, g, b));
  for (let i = 0; i < 24; i++) out.push(hex(8 + i * 10, 8 + i * 10, 8 + i * 10));
  return out;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Turn stored grids into ANSI text for a terminal (24-bit colour escapes).
 * @param {{palette:string[], sprites:Object<string,{cols:number,rows:number,ch:string[],fg:number[],bg:number[]}>}} grids
 * @param {string} [only]  One sprite name; default is every sprite, each under a "# name" line.
 */
export function toAnsi(grids, only) {
  const names = only ? [only] : Object.keys(grids.sprites);
  const out = [];
  for (const name of names) {
    const g = grids.sprites[name];
    if (!g) throw new Error(`toAnsi: no sprite named "${name}"`);
    if (!only) out.push(`# ${name}`);
    for (let y = 0; y < g.rows; y++) {
      let line = '';
      const chars = [...g.ch[y]];
      for (let x = 0; x < g.cols; x++) {
        const i = y * g.cols + x;
        const bg = g.bg[i] < 0 ? '\x1b[49m' : `\x1b[48;2;${rgb(grids.palette[g.bg[i]]).join(';')}m`;
        const fg = g.fg[i] < 0 ? '' : `\x1b[38;2;${rgb(grids.palette[g.fg[i]]).join(';')}m`;
        line += bg + fg + chars[x];
      }
      out.push(line + '\x1b[0m');
    }
  }
  return out.join('\n') + '\n';
}
