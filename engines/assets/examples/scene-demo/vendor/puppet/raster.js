// ASCII rasteriser: turns a puppet's shapes into a grid of coloured text cells at runtime, so
// rigged characters animate freely in ASCII scenes (no pre-rendered frames). Each cell takes two
// samples, top and bottom, and uses half-block glyphs, so the picture has twice the rows of the
// text grid. Every sample is found by casting a ray at the shapes, with a depth test and lighting.
import { dot, norm, sub, apply, unapply } from './math.js';
import { tones as defaultTones, TONE_ORDER } from './color.js';

/** Characters scattered over flat areas, from the darkest tone to the lightest. */
export const TEXTURE = ['%', '=', ':', '.'];

// cheap repeatable noise for a cell, so the text texture does not flicker
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Per-shape numbers that do not change from sample to sample. */
function prepare(s, proj) {
  const n = proj.toward;
  // nothing may be thinner than about half a cell, or thin limbs and blades break into dots
  const thin = 0.55 / proj.unitX;
  if (s.shape === 'capsule') {
    const w = sub(s.b, s.a);
    const r0 = Math.max(s.r0, thin); const r1 = Math.max(s.r1, thin);
    return { s, w, r0, r1, e: dot(w, w), b: dot(n, w), centre: [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2], reach: Math.sqrt(dot(w, w)) / 2 + Math.max(r0, r1) };
  }
  const size = (s.shape === 'ball' ? s.r : s.half).map((v) => Math.max(v, thin * (s.flat ? 0.8 : 0.6)));
  const d = unapply(s.m, n);
  return { s, d, size, centre: s.c, reach: s.shape === 'ball' ? Math.max(...size) : Math.hypot(...size) };
}

/** Cast the ray p0 + t * toward at one shape. Returns t of the surface nearest the camera, or null; writes the normal to `nrm`. */
function hit(q, p0, n, nrm) {
  const s = q.s;
  if (s.shape === 'capsule') {
    const r = sub(p0, s.a);
    const c1 = dot(n, r);
    const den = q.e - q.b * q.b;
    let u = den > 1e-9 ? (dot(q.w, r) - q.b * c1) / den : (q.b > 0 ? 1 : 0);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const rad = q.r0 + (q.r1 - q.r0) * u;
    const m = [r[0] - q.w[0] * u, r[1] - q.w[1] * u, r[2] - q.w[2] * u];
    const tc = -dot(m, n);
    const d2 = dot(m, m) - tc * tc;
    if (d2 >= rad * rad) return null;
    const t = tc + Math.sqrt(rad * rad - d2);
    nrm[0] = (m[0] + n[0] * t) / rad; nrm[1] = (m[1] + n[1] * t) / rad; nrm[2] = (m[2] + n[2] * t) / rad;
    return t;
  }
  const o = unapply(s.m, sub(p0, s.c));
  const d = q.d; const size = q.size;
  if (s.shape === 'ball') {
    const ox = o[0] / size[0]; const oy = o[1] / size[1]; const oz = o[2] / size[2];
    const dx = d[0] / size[0]; const dy = d[1] / size[1]; const dz = d[2] / size[2];
    const A = dx * dx + dy * dy + dz * dz; const B = ox * dx + oy * dy + oz * dz; const C = ox * ox + oy * oy + oz * oz - 1;
    const disc = B * B - A * C;
    if (disc <= 0) return null;
    const t = (-B + Math.sqrt(disc)) / A;
    const g = norm(apply(s.m, [(ox + dx * t) / size[0], (oy + dy * t) / size[1], (oz + dz * t) / size[2]]));
    nrm[0] = g[0]; nrm[1] = g[1]; nrm[2] = g[2];
    return t;
  }
  let near = -Infinity; let far = Infinity; let axis = 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (Math.abs(o[k]) > size[k]) return null; continue; }
    const t1 = (-size[k] - o[k]) / d[k]; const t2 = (size[k] - o[k]) / d[k];
    const lo = Math.min(t1, t2); const hi = Math.max(t1, t2);
    if (lo > near) near = lo;
    if (hi < far) { far = hi; axis = k; }
  }
  if (near > far) return null;
  const sign = d[axis] > 0 ? 1 : -1;
  nrm[0] = s.m[axis] * sign; nrm[1] = s.m[3 + axis] * sign; nrm[2] = s.m[6 + axis] * sign;
  return far;
}

/**
 * Render shapes (from puppet.shapes()) to a text grid.
 * @param {object[]} shapes
 * @param {object} proj     A projection in character cells per world unit (projectionFromScene or frontProjection).
 * @param {object} o
 * @param {number} o.cols
 * @param {number} o.rows
 * @param {{col:number, row:number}} o.anchor  Cell position of the puppet's ground point.
 * @param {number[]} [o.light]   Direction TOWARD the light (default up, left and toward the viewer).
 * @param {number} [o.ambient]   0..1 light in full shadow (default 0.3).
 * @param {number} [o.text]      0..1 share of flat cells that get a texture character (default 0.35; 0 = blocks only).
 * @param {boolean} [o.rim]      Darken the edges of shapes so limbs read against the body (default true).
 * @param {(hex:string) => object} [o.tones]
 * @returns {{cols:number, rows:number, ch:string[], fg:number[], bg:number[], palette:string[], filled:number}}
 *   Same grid layout as Kiln's drawGrid: fg/bg index `palette`, -1 = transparent.
 */
export function rasterize(shapes, proj, o) {
  const { cols, rows, anchor } = o;
  if (!(Number.isInteger(cols) && cols > 0 && Number.isInteger(rows) && rows > 0)) throw new Error(`rasterize: cols and rows must be whole numbers above 0, got ${cols} x ${rows}`);
  if (!anchor || typeof anchor.col !== 'number' || typeof anchor.row !== 'number') throw new Error('rasterize: "anchor" must be { col, row }');
  const toneOf = o.tones ?? defaultTones;
  const n = proj.toward;
  const L = norm(o.light ?? [-0.5, -0.6, 0.8]);
  const ambient = o.ambient ?? 0.3;
  const rim = o.rim ?? true;
  const H = rows * 2;
  const depth = new Float32Array(cols * H).fill(-Infinity);
  const ink = new Int16Array(cols * H).fill(-1);
  const palette = [];
  const meta = []; // [hex, tone] of each palette entry
  const slot = new Map();
  const indexOf = (hex, tone) => {
    const key = hex + tone;
    if (!slot.has(key)) { slot.set(key, palette.length); palette.push(toneOf(hex)[TONE_ORDER[tone]]); meta.push([hex, tone]); }
    return slot.get(key);
  };
  const nrm = [0, 0, 0]; const p0 = [0, 0, 0];
  for (const s of shapes) {
    const q = prepare(s, proj);
    const cx = dot(proj.col, q.centre) + anchor.col; const cy = dot(proj.row, q.centre) + anchor.row;
    const x0 = Math.max(0, Math.floor(cx - q.reach * proj.unitX)); const x1 = Math.min(cols - 1, Math.ceil(cx + q.reach * proj.unitX));
    const y0 = Math.max(0, Math.floor((cy - q.reach * proj.unitY) * 2)); const y1 = Math.min(H - 1, Math.ceil((cy + q.reach * proj.unitY) * 2));
    for (let y = y0; y <= y1; y++) {
      const v = (y + 0.5) / 2 - anchor.row;
      for (let x = x0; x <= x1; x++) {
        const u = x + 0.5 - anchor.col;
        p0[0] = u * proj.U[0] + v * proj.V[0]; p0[1] = u * proj.U[1] + v * proj.V[1]; p0[2] = u * proj.U[2] + v * proj.V[2];
        const t = hit(q, p0, n, nrm);
        const i = y * cols + x;
        if (t === null || t + s.bias <= depth[i]) continue;
        depth[i] = t + s.bias;
        let tone = 2;
        if (!s.flat) {
          const lit = ambient + (1 - ambient) * Math.max(0, dot(nrm, L));
          tone = lit >= 0.8 ? 3 : lit >= 0.52 ? 2 : lit >= 0.36 ? 1 : 0;
          if (rim && tone > 0 && dot(nrm, n) < 0.3) tone--;
        }
        ink[i] = indexOf(s.color, tone);
      }
    }
  }
  const text = o.text ?? 0.35;
  const ch = []; const fg = new Array(cols * rows); const bg = new Array(cols * rows);
  let filled = 0;
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const top = ink[r * 2 * cols + c]; const bot = ink[(r * 2 + 1) * cols + c];
      const i = r * cols + c;
      if (top < 0 && bot < 0) { line += ' '; fg[i] = -1; bg[i] = -1; continue; }
      filled++;
      if (bot < 0) { line += '▀'; fg[i] = top; bg[i] = -1; }
      else if (top < 0) { line += '▄'; fg[i] = bot; bg[i] = -1; }
      else if (top !== bot) { line += '▀'; fg[i] = top; bg[i] = bot; }
      else if (text > 0 && hash(c, r) < text) {
        // a texture character in the neighbouring tone of the same colour
        const [hex, tone] = meta[top];
        line += TEXTURE[tone]; bg[i] = top; fg[i] = indexOf(hex, tone === 0 ? 1 : tone - 1);
      } else { line += '█'; fg[i] = top; bg[i] = top; }
    }
    ch.push(line);
  }
  return { cols, rows, ch, fg, bg, palette, filled };
}
