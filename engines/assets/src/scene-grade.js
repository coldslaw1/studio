// The four Kiln looks, for 3D scenes: storybook, nocturne, papercut and crypt. A scene's "style"
// changes how light is stepped (cel bands), whether shapes get an outline, how soft shadows are,
// and pulls the finished colours towards that style's own palette (styles.js, palettes.js), so a
// scene sits next to the sprites `kiln build` makes in the same style. Pure and browser-safe.
import { parseHex } from './color.js';
import { STYLES } from './styles.js';
import { PALETTES } from './palettes.js';

/**
 * What each style changes. bands: steps of light (0 = smooth). outline: width in ground units
 * (0 = none) and ink: how dark it is. pull: how far colours move towards the style's palette.
 * lift: lightens darks (pastel). contrast: around mid grey. grain: speckle. The rest override the
 * defaults of the "shading" settings of the same name (a scene's own "shading" values still win).
 */
export const SCENE_STYLES = {
  storybook: { bands: 3, outline: 0.075, ink: 0.5, pull: 0.3, lift: 0, contrast: 1, grain: 0, palette: Object.values(STYLES.storybook.palette), shading: { saturation: 1, exposure: 1, materials: 0.55, gloss: 0.4, grass: 0.75 } },
  nocturne: { bands: 0, outline: 0, ink: 0, pull: 0.3, lift: 0, contrast: 1.08, grain: 0, palette: Object.values(STYLES.nocturne.palette), shading: { saturation: 0.9, exposure: 1.12, bloom: 2, occlusion: 0.6 } },
  papercut: { bands: 2, outline: 0, ink: 0, pull: 0.4, lift: 0.1, contrast: 0.92, grain: 0, palette: Object.values(STYLES.papercut.palette), shading: { saturation: 0.78, exposure: 1.04, materials: 0, gloss: 0, softness: 0, occlusion: 0.2, shadows: 0.5, grass: 0 } },
  crypt: { bands: 4, outline: 0.04, ink: 0.8, pull: 0.6, lift: 0, contrast: 1.05, grain: 0.05, palette: PALETTES.crypt, shading: { saturation: 0.7, exposure: 0.84, gloss: 0, materials: 0.85, bloom: 1.3 } },
};
export const SCENE_STYLE_NAMES = Object.keys(SCENE_STYLES);

/** The style of a scene, or null. */
export function sceneStyle(scene) {
  return SCENE_STYLES[scene.style] ?? null;
}

/**
 * Step a light level (0 to about 1.4) into `bands` levels with slightly soft steps, as painted
 * cel shading does. Returns the stepped level.
 */
export function banded(level, bands) {
  if (!(bands > 0)) return level;
  const top = 1.3;
  const v = Math.min(0.9999, Math.max(0, level / top)) * bands;
  const step = Math.floor(v); const f = v - step;
  const e = 0.07;
  const s = f < 0.5 - e ? 0 : f > 0.5 + e ? 1 : (f - 0.5 + e) / (2 * e);
  return (step + 0.45 + s * 0.9) / (bands + 0.35) * top;
}

const SIZE = 17; // colour table: 17 steps per channel

/**
 * A table that moves any colour part of the way towards a palette: each colour goes towards a
 * blend of the palette colours nearest to it, so smooth gradients stay smooth.
 * @returns {Float32Array}  SIZE^3 x 3 values, indexed r + g*SIZE + b*SIZE*SIZE.
 */
export function pullTable(palette, pull) {
  const pal = palette.map(parseHex);
  const out = new Float32Array(SIZE * SIZE * SIZE * 3);
  for (let b = 0; b < SIZE; b++) for (let g = 0; g < SIZE; g++) for (let r = 0; r < SIZE; r++) {
    const c = [r * 255 / (SIZE - 1), g * 255 / (SIZE - 1), b * 255 / (SIZE - 1)];
    let wr = 0; let wg = 0; let wb = 0; let ws = 0;
    for (const p of pal) {
      const d = 0.3 * (p[0] - c[0]) ** 2 + 0.59 * (p[1] - c[1]) ** 2 + 0.11 * (p[2] - c[2]) ** 2;
      const wt = 1 / (d + 60) ** 2.5;
      wr += p[0] * wt; wg += p[1] * wt; wb += p[2] * wt; ws += wt;
    }
    const o = (r + g * SIZE + b * SIZE * SIZE) * 3;
    out[o] = c[0] + (wr / ws - c[0]) * pull; out[o + 1] = c[1] + (wg / ws - c[1]) * pull; out[o + 2] = c[2] + (wb / ws - c[2]) * pull;
  }
  return out;
}

/** Look a colour (0..255 each) up in a pullTable, blending between entries. Writes into out. */
export function pulled(table, r, g, b, out) {
  const k = (SIZE - 1) / 255;
  const fr = Math.min(SIZE - 1.001, Math.max(0, r * k)); const fg = Math.min(SIZE - 1.001, Math.max(0, g * k)); const fb = Math.min(SIZE - 1.001, Math.max(0, b * k));
  const ir = fr | 0; const ig = fg | 0; const ib = fb | 0; const u = fr - ir; const v = fg - ig; const w = fb - ib;
  const o = (ir + ig * SIZE + ib * SIZE * SIZE) * 3; const dg = SIZE * 3; const db = SIZE * SIZE * 3;
  for (let c = 0; c < 3; c++) {
    const a = (table[o + c] * (1 - u) + table[o + 3 + c] * u) * (1 - v) + (table[o + dg + c] * (1 - u) + table[o + dg + 3 + c] * u) * v;
    const z = (table[o + db + c] * (1 - u) + table[o + db + 3 + c] * u) * (1 - v) + (table[o + db + dg + c] * (1 - u) + table[o + db + dg + 3 + c] * u) * v;
    out[c] = a * (1 - w) + z * w;
  }
  return out;
}

/**
 * Where the outlines of a picture go: 255 on the edge between two different things (or a thing
 * and the ground or sky), about half that along a sharp crease of one thing, 0 elsewhere.
 * @param {Int32Array} tri    Triangle seen at every sample (-1 none).
 * @param {{obj:Int32Array, N:Float32Array}} geo
 * @param {number} w
 * @param {number} h
 * @param {number} width      Outline width in samples (at least 1).
 * @returns {Uint8Array}
 */
export function edgeMask(tri, geo, w, h, width = 1) {
  const n = w * h;
  let mask = new Uint8Array(n);
  const thing = (t) => (t < 0 ? -1 : geo.obj[t]);
  const N = geo.N;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const t = tri[i]; const a = thing(t);
    for (let m = 0; m < 2; m++) {
      if (m === 0 ? x + 1 >= w : y + 1 >= h) continue;
      const j = m === 0 ? i + 1 : i + w; const u = tri[j];
      if (u === t) continue;
      const bth = thing(u);
      let v = 0;
      if (a !== bth) v = 255;
      else if (a > 0 && N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2] < 0.55) v = 120;
      if (v > mask[i]) mask[i] = v;
      if (v > mask[j]) mask[j] = v;
    }
  }
  // widen to the asked width
  for (let grow = Math.round((width - 1) / 2); grow > 0; grow--) {
    const next = mask.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let v = mask[i];
      if (x > 0 && mask[i - 1] > v) v = mask[i - 1];
      if (x + 1 < w && mask[i + 1] > v) v = mask[i + 1];
      if (y > 0 && mask[i - w] > v) v = mask[i - w];
      if (y + 1 < h && mask[i + w] > v) v = mask[i + w];
      next[i] = v;
    }
    mask = next;
  }
  return mask;
}
