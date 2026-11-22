// ASCII sprite: a puppet shown as live text cells. It has the same shape as a Kiln scene view
// (cols, rows, draw, toCell), so Kiln's world.drawSprite places it in a scene and hides the
// parts behind houses and trees, with no pre-rendered frames.
import { rasterize } from './raster.js';
import { frontProjection, makeProjection, project } from './projection.js';

/** 8x8 bitmaps (one byte per row) for the texture characters, so they look the same in every browser. */
export const GLYPHS = {
  '.': [0, 0, 0, 0, 0, 0x18, 0x18, 0],
  ':': [0, 0x18, 0x18, 0, 0, 0x18, 0x18, 0],
  '=': [0, 0, 0x7e, 0, 0x7e, 0, 0, 0],
  '%': [0x62, 0x64, 0x08, 0x10, 0x26, 0x46, 0, 0],
};

/**
 * Draw a text grid ({ cols, rows, ch, fg, bg }) into the rectangle x, y, w, h (top-left corner).
 * Understands the half-block glyphs and the texture characters the rasteriser produces.
 */
export function drawCells(ctx, grid, palette, x, y, w, h, { flipX = false, alpha = 1 } = {}) {
  const cw = w / grid.cols; const ch = h / grid.rows;
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (let r = 0; r < grid.rows; r++) {
    const y0 = Math.round(y + r * ch); const y1 = Math.round(y + (r + 1) * ch); const ym = Math.round(y + (r + 0.5) * ch);
    const chars = [...grid.ch[r]];
    for (let c = 0; c < grid.cols; c++) {
      const i = r * grid.cols + c;
      const glyph = chars[c];
      if (glyph === ' ') continue;
      const cc = flipX ? grid.cols - 1 - c : c;
      const x0 = Math.round(x + cc * cw); const x1 = Math.round(x + (cc + 1) * cw);
      if (grid.bg[i] >= 0) { ctx.fillStyle = palette[grid.bg[i]]; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
      if (grid.fg[i] < 0) continue;
      ctx.fillStyle = palette[grid.fg[i]];
      if (glyph === '█') ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      else if (glyph === '▀') ctx.fillRect(x0, y0, x1 - x0, ym - y0);
      else if (glyph === '▄') ctx.fillRect(x0, ym, x1 - x0, y1 - ym);
      else {
        const bits = GLYPHS[glyph];
        if (!bits) continue;
        const px = (x1 - x0) / 8; const py = (y1 - y0) / 8;
        if (px < 0.75) continue; // too small to read: the background colour is enough
        for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) if (bits[gy] & (0x80 >> (flipX ? 7 - gx : gx))) ctx.fillRect(x0 + gx * px, y0 + gy * py, px, py);
      }
    }
  }
  ctx.restore();
}

/**
 * @param {object} puppet
 * @param {object} [opts]
 * @param {object} [opts.projection]  Cells per world unit. Use projectionFromScene(world) to match a Kiln scene;
 *   default is a front view at `unit` cells per world unit.
 * @param {number} [opts.detail]  Draw with this many times finer cells than the projection's (default 1). In a Kiln scene,
 *   drawSprite still shows the character life size; it is just made of smaller characters, like Kiln's own sprites.
 * @param {number} [opts.unit]    Cells per world unit for the default projection (default 8).
 * @param {number} [opts.pitch]   Camera pitch for the default projection (default 0).
 * @param {number} [opts.cols]    Grid width in cells (default: fits the puppet in any pose).
 * @param {number} [opts.rows]    Grid height in cells.
 * @param {number[]} [opts.light] Direction toward the light.
 * @param {number} [opts.text]    0..1 share of flat cells textured with characters (default 0.35).
 * @param {boolean} [opts.rim]
 * @param {(hex:string) => object} [opts.tones]
 * @returns {object} sprite  Works as the `sprite` argument of Kiln's world.drawSprite.
 */
export function createAsciiSprite(puppet, opts = {}) {
  const base = opts.projection ?? frontProjection({ unit: opts.unit ?? 8, pitch: opts.pitch ?? 0 });
  const detail = opts.detail ?? 1;
  if (!(detail > 0)) throw new Error(`createAsciiSprite: "detail" must be above 0, got ${opts.detail}`);
  const proj = detail === 1 ? base : makeProjection(base.col.map((v) => v * detail), base.row.map((v) => v * detail));
  // room for every pose and facing: `radius` sideways from the feet, `top` upward
  const [radius, top] = puppet.extent();
  const flat = Math.hypot(proj.row[0], proj.row[1]); // rows per unit of ground distance (0 for a side-on camera)
  const cols = opts.cols ?? 2 * Math.ceil(radius * proj.unitX) + 2;
  const below = Math.ceil(radius * flat + top * 0.05 * Math.abs(proj.row[2])) + 1;
  const above = Math.ceil(top * Math.abs(proj.row[2]) + radius * flat) + 1;
  const rows = opts.rows ?? above + below;
  const anchor = opts.anchor ?? { col: cols / 2, row: rows - below };
  let grid = null;
  let seen = -1;
  const sprite = {
    cols, rows,
    /** Kiln scene-view compatibility: a live sprite has one "frame" that is always current. */
    frames: 1, fps: 0, width: cols * 8, height: rows * 8,
    frameAt() { return 0; },
    /** The camera used to rasterise (cells per world unit). */
    camera: proj,
    /** The same camera in Kiln's layout (heights in sixteenths), which Kiln reads to draw the sprite life size. */
    projection: { origin: [0, 0, 0], col: [anchor.col, proj.col[0], proj.col[1], proj.col[2] / 16], row: [anchor.row, proj.row[0], proj.row[1], proj.row[2] / 16] },
    detail,
    anchor,
    /** Rasterise the puppet as it is now. Called automatically by draw() when the puppet has changed. */
    render() {
      grid = rasterize(puppet.shapes(opts.palette ?? null), proj, { cols, rows, anchor, light: opts.light, ambient: opts.ambient, text: opts.text, rim: opts.rim, tones: opts.tones });
      seen = puppet.version;
      return grid;
    },
    /** The current text grid: { cols, rows, ch, fg, bg, palette, filled }. */
    get grid() { if (seen !== puppet.version || !grid) sprite.render(); return grid; },
    /** Draw into the rectangle x, y, w, h (top-left corner), like a Kiln scene view. */
    draw(ctx, x, y, w = cols * 8, h = rows * 8, o = {}) { const g = sprite.grid; drawCells(ctx, g, g.palette, x, y, w, h, o); },
    /** Cell position of a point given relative to the puppet's ground point. */
    toCell(x = 0, y = 0, z = 0) { const p = project([x, y, z / 16], proj); return { col: anchor.col + p[0], row: anchor.row + p[1] }; },
    /**
     * How far the picture reaches from the ground point right now, in cells: { left, right, up, down }.
     * Kiln's world.spriteExtent uses it to size collision from the picture.
     */
    cellBounds() {
      const g = sprite.grid;
      const b = { left: 0, right: 0, up: 0, down: 0 };
      g.ch.forEach((line, r) => [...line].forEach((c, k) => {
        if (c === ' ') return;
        b.left = Math.max(b.left, anchor.col - k); b.right = Math.max(b.right, k + 1 - anchor.col);
        b.up = Math.max(b.up, anchor.row - r); b.down = Math.max(b.down, r + 1 - anchor.row);
      }));
      return b;
    },
    /** The grid as plain text lines (no colour), for tests and logs. */
    toText() { return sprite.grid.ch.join('\n'); },
    /** The grid as coloured terminal text (24-bit ANSI). */
    toAnsi() {
      const g = sprite.grid;
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(';');
      return g.ch.map((line, r) => [...line].map((c, k) => {
        const i = r * g.cols + k;
        return (g.bg[i] < 0 ? '\x1b[49m' : `\x1b[48;2;${rgb(g.palette[g.bg[i]])}m`) + (g.fg[i] < 0 ? '' : `\x1b[38;2;${rgb(g.palette[g.fg[i]])}m`) + c;
      }).join('') + '\x1b[0m').join('\n') + '\n';
    },
  };
  return sprite;
}
