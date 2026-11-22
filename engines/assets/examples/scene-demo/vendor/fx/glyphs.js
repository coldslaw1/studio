// The small 8x8 font effects are drawn with: one byte per row, the same bitmaps the Kiln ASCII
// pictures and the first-person view use, so a spark looks like part of the scene.

/** 8x8 bitmaps by character. */
export const GLYPHS = {
  '.': [0, 0, 0, 0, 0, 0x18, 0x18, 0],
  ',': [0, 0, 0, 0, 0, 0x18, 0x18, 0x30],
  ':': [0, 0x18, 0x18, 0, 0, 0x18, 0x18, 0],
  "'": [0x18, 0x18, 0x30, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x7e, 0, 0, 0, 0],
  '+': [0, 0x18, 0x18, 0x7e, 0x18, 0x18, 0, 0],
  '*': [0, 0x66, 0x3c, 0xff, 0x3c, 0x66, 0, 0],
  '#': [0x24, 0x24, 0x7e, 0x24, 0x7e, 0x24, 0x24, 0],
  '%': [0x62, 0x64, 0x08, 0x10, 0x26, 0x46, 0, 0],
  '~': [0, 0, 0x32, 0x4c, 0, 0, 0, 0],
  '|': [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0],
  '/': [0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0, 0],
  '\\': [0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0, 0],
  'o': [0, 0, 0x3c, 0x42, 0x42, 0x3c, 0, 0],
  'x': [0, 0, 0x44, 0x28, 0x10, 0x28, 0x44, 0],
  'O': [0x3c, 0x42, 0x42, 0x42, 0x42, 0x42, 0x3c, 0],
  '·': [0, 0, 0, 0x18, 0x18, 0, 0, 0],
  '°': [0x18, 0x24, 0x24, 0x18, 0, 0, 0, 0],
  '●': [0, 0x3c, 0x7e, 0x7e, 0x7e, 0x7e, 0x3c, 0],
  '◆': [0x10, 0x38, 0x7c, 0xfe, 0x7c, 0x38, 0x10, 0],
  '■': [0, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0],
  '▲': [0, 0x10, 0x38, 0x38, 0x7c, 0x7c, 0xfe, 0],
  '✦': [0x10, 0x10, 0x38, 0xfe, 0x38, 0x10, 0x10, 0],
};

/** Every character of the font, in a fixed order. A glyph id is an index into this list. */
export const GLYPH_LIST = Object.freeze(Object.keys(GLYPHS));
const IDS = new Map(GLYPH_LIST.map((ch, i) => [ch, i]));

/** glyphId(ch, where) -> index into GLYPH_LIST. Throws for a character the font does not have. */
export function glyphId(ch, where = 'glyphId') {
  const id = IDS.get(ch);
  if (id === undefined) throw new Error(`${where}: the fx font has no glyph ${JSON.stringify(ch)} (it has: ${GLYPH_LIST.join(' ')})`);
  return id;
}

/** Ids of the four streak glyphs, picked by the direction a fast particle moves on screen. */
export const STREAKS = Object.freeze({ flat: IDS.get('-'), rise: IDS.get('/'), up: IDS.get('|'), fall: IDS.get('\\') });

/**
 * glyphRuns(bitmap) -> [x, y, w, ...] runs of lit pixels in the 8x8 bitmap, three numbers a run.
 * Used to draw a glyph with a few rectangles when no glyph sheet can be made.
 */
export function glyphRuns(bitmap) {
  const runs = [];
  for (let y = 0; y < 8; y++) {
    let x = 0;
    while (x < 8) {
      if (bitmap[y] & (0x80 >> x)) { let w = 1; while (x + w < 8 && (bitmap[y] & (0x80 >> (x + w)))) w++; runs.push(x, y, w); x += w; } else x++;
    }
  }
  return runs;
}

/** glyphCoverage(bitmap, cellPx) -> Float32Array(cellPx * cellPx): how much of each pixel the glyph covers, 0..1. */
export function glyphCoverage(bitmap, cellPx) {
  const out = new Float32Array(cellPx * cellPx);
  const sub = 4;
  for (let y = 0; y < cellPx; y++) for (let x = 0; x < cellPx; x++) {
    let on = 0;
    for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
      const gx = Math.min(7, Math.floor((x + (i + 0.5) / sub) * 8 / cellPx)); const gy = Math.min(7, Math.floor((y + (j + 0.5) / sub) * 8 / cellPx));
      if (bitmap[gy] & (0x80 >> gx)) on++;
    }
    out[y * cellPx + x] = on / (sub * sub);
  }
  return out;
}
