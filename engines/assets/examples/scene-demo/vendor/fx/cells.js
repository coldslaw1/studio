// From particles in the world to character cells on the screen. Each particle is projected by the
// view, snapped to the view's cell grid, and the strongest particle in a cell wins it. The result
// is a short list of cells to paint, so drawing cost follows the cells touched, not the particles.
import { STREAKS } from './glyphs.js';

const MAX_RADIUS = 3.5; // a puff never covers more than about 38 cells

/** createCellList(maxCells) -> list, reused every picture. `n` cells are listed in `cell` (index = row * cols + col). */
export function createCellList(maxCells = 4096) {
  return { n: 0, max: maxCells, cols: 0, rows: 0, gen: 0, cell: new Int32Array(maxCells), glyph: new Uint8Array(0), color: new Uint8Array(0), layer: new Uint8Array(0), veil: new Uint8Array(0), stamp: new Uint32Array(0), particles: 0 };
}

function fit(list, cols, rows) {
  if (list.cols === cols && list.rows === rows) return;
  const size = cols * rows;
  list.cols = cols; list.rows = rows; list.gen = 0;
  list.glyph = new Uint8Array(size); list.color = new Uint8Array(size); list.layer = new Uint8Array(size); list.veil = new Uint8Array(size); list.stamp = new Uint32Array(size);
}

function put(list, col, row, glyph, color, layer, veil) {
  if (col < 0 || row < 0 || col >= list.cols || row >= list.rows) return;
  const k = row * list.cols + col;
  if (list.stamp[k] !== list.gen) {
    if (list.n >= list.max) return;
    list.stamp[k] = list.gen; list.cell[list.n++] = k; list.layer[k] = layer; list.veil[k] = veil;
  } else {
    if (veil) list.veil[k] = 1;
    if (layer < list.layer[k]) return;
    list.layer[k] = layer;
  }
  list.glyph[k] = glyph; list.color[k] = color;
}

const speck = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * collectCells(list, pool, looks, view, back, time, streaks) -> list
 *   looks    per preset index: { glyphIds, colorIds, veil, streak, twinkle, layer }
 *   view     { toScreen(x, y, h) -> { x, y, visible?, scale? }, cellPx, originX, originY, width, height, occluded?(x, y, h, point) }
 *   back     seconds to step each particle back along its path (for smooth pictures between ticks)
 *   time     seconds, drives the twinkle
 */
export function collectCells(list, pool, looks, view, back = 0, time = 0, streaks = true) {
  const cp = view.cellPx; const ox = view.originX; const oy = view.originY;
  fit(list, Math.max(1, Math.ceil((view.width - ox) / cp)), Math.max(1, Math.ceil((view.height - oy) / cp)));
  list.gen = (list.gen + 1) >>> 0;
  if (list.gen === 0) { list.stamp.fill(0); list.gen = 1; }
  list.n = 0; list.particles = 0;
  const p = pool; const toScreen = view.toScreen; const occluded = view.occluded;
  const flick = Math.floor(time * 12);
  for (let i = 0; i < p.n; i++) {
    const x = p.x[i] - p.vx[i] * back; const y = p.y[i] - p.vy[i] * back; const z = Math.max(0, p.z[i] - p.vz[i] * back);
    const at = toScreen(x, y, z);
    if (!at || at.visible === false) { p.sx[i] = NaN; continue; }
    if (occluded && occluded(x, y, z, at)) { p.sx[i] = NaN; continue; }
    const look = looks[p.def[i]];
    const t = p.age[i] / p.life[i];
    const ng = look.glyphIds.length;
    let gi = Math.min(ng - 1, Math.floor(t * ng));
    if (look.twinkle && ((flick + Math.floor(p.seed[i] * 97)) & 3) === 0) gi = Math.min(ng - 1, gi + 1);
    let glyph = look.glyphIds[gi];
    if (look.streak && streaks && t < 0.6 && p.sx[i] === p.sx[i]) {
      const dx = at.x - p.sx[i]; const dy = at.y - p.sy[i];
      const ax = Math.abs(dx); const ay = Math.abs(dy);
      if (ax + ay > cp * 0.35) glyph = ax > ay * 2.4 ? STREAKS.flat : ay > ax * 2.4 ? STREAKS.up : (dx > 0) === (dy > 0) ? STREAKS.fall : STREAKS.rise;
    }
    p.sx[i] = at.x; p.sy[i] = at.y;
    const color = look.colorIds[Math.min(look.colorIds.length - 1, Math.floor(t * look.colorIds.length))];
    const col = Math.floor((at.x - ox) / cp); const row = Math.floor((at.y - oy) / cp);
    list.particles++;
    let r = 0;
    const size = p.size_[i];
    if (size > 0) {
      let px = at.scale !== undefined ? size * at.scale : 0;
      if (at.scale === undefined) { const top = toScreen(x, y, z + size); if (top) px = Math.hypot(top.x - at.x, top.y - at.y); }
      r = Math.min(MAX_RADIUS, px / cp / 2);
    }
    if (r < 0.75) { put(list, col, row, glyph, color, look.layer, look.veil); continue; }
    const thin = look.glyphIds[Math.min(ng - 1, gi + 1)];
    const reach = Math.ceil(r); const salt = Math.floor(p.seed[i] * 1024);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const edge = d > r - 0.9;
      if (edge && d > 0 && speck(col + dx + salt, row + dy) < 0.4) continue; // a ragged rim
      const worn = (edge && d > 0) || (r > 1.5 && speck(col + dx, row + dy + salt) < 0.3); // big puffs are mottled, not a block
      put(list, col + dx, row + dy, worn ? thin : glyph, color, look.layer, look.veil);
    }
  }
  return list;
}
