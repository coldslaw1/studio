// Fixed master palettes. With "pixel.palette" every sprite on a sheet is drawn from the same
// small set of colours, which is what makes separate sprites look like one piece of work.

export const PALETTES = {
  // Torch-lit dungeon: cold stone and steel, warm leather and fire, muted accents.
  crypt: [
    '#0b0a12', '#16131f', '#231d2e', '#352b3f', '#4b3d52',
    '#1a2030', '#2a3448', '#3f4d66', '#5d6d87', '#8794a8', '#b4bcc8',
    '#2b1a16', '#47271d', '#6b3a26', '#8f5231', '#b5733f', '#d49a58',
    '#5a1c1c', '#8a2a24', '#b8402c',
    '#e07a2c', '#f2b23a', '#f8dc7a',
    '#3a3524', '#5c5438', '#857a52', '#b3a678', '#d9cfa6', '#efe8cc',
    '#1c3327', '#2f5438', '#4f7d48', '#86b060',
    '#3a2358', '#5b3a86', '#8660b4',
    '#1e3a6a', '#3460a8', '#62a0d8',
  ],
};

/** Resolve a palette name or list of hex colours to a list of hex colours. */
export function resolvePalette(palette) {
  if (Array.isArray(palette)) {
    if (palette.length < 2 || !palette.every((c) => /^#[0-9a-fA-F]{6}$/.test(c))) throw new Error('resolvePalette: a custom palette must be a list of at least 2 "#rrggbb" colours');
    return palette;
  }
  if (!PALETTES[palette]) throw new Error(`resolvePalette: unknown palette "${palette}". Known: ${Object.keys(PALETTES).join(', ')}`);
  return PALETTES[palette];
}
