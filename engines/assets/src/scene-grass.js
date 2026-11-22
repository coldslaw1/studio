// Grass for 3D scenes: blades and tufts scattered over grassy ground. Where they stand, how tall
// they are, how they lean and how light or dark they are all come from fixed hashes of their
// place in the world, so the same meadow comes out every time and in every picture of it.
// The rules are shared with the first-person views (which draw their own blades in 3D):
//   where:   ground materials that are grass (by name: grass, meadow, moss, marsh, lawn, field; or
//            a material's "grass" amount), never under water
//   density: about 12 blades a square metre on average, in thin and lush patches
//   size:    blades 0.18 to 0.46 m tall and 5 cm wide at the foot
//   colour:  the material's bg x 0.62 at the foot, blending to its fg at the tip, times 0.82 to
//            1.18 per plant; lit and shadowed like the ground it stands on
//   wind:    scene.wind ([x, y], default [0.8, 0.3]): a steady lean downwind plus a slow wave
// grassIn lists the plants of an area for any other view that wants the very same ones.
// Pure and browser-safe.
import { noise2 } from './scene-materials.js';

function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The two sizes of grass. The ground is cut into squares of `cell` metres; each square holds at
 * most one plant. `from` and `full` are samples per metre: below `from` the plant is too small to
 * show and is left out, at `full` it is drawn at full strength.
 *   tuft:  a broad clump, what a meadow looks like from far off
 *   blade: single blades, seen close up
 */
export const GRASS_LAYERS = [
  { name: 'tuft', salt: 101, cell: 0.55, width: 0.2, low: 0.28, high: 0.6, from: 5, full: 9 },
  { name: 'blade', salt: 211, cell: 0.2, width: 0.05, low: 0.18, high: 0.46, from: 11, full: 20 },
];

/** The wind when a scene gives none: [x, y] along the ground; its length is its strength. */
export const WIND = [0.8, 0.3];

/** How thick the grass grows at a ground point, 0.15 to 1: slow patches, so meadows have thin and lush parts. */
export function grassDensity(x, y) {
  const v = 0.7 * noise2(x / 6 + 11, y / 6 + 3) + 0.3 * noise2(x / 2.1 + 5, y / 2.1 + 19);
  return Math.min(1, Math.max(0.15, (v - 0.22) * 1.9));
}

/** What `plantIn` found: where the plant is rooted and what it is like. */
export const plant = { x: 0, y: 0, height: 0, lean: 0, tint: 0, flower: 0, density: 0 };

/**
 * The plant of one ground square of a layer, if it has one. Fills `plant` and returns true.
 * @param {object} layer   One of GRASS_LAYERS.
 * @param {number} ix      Square index: the square covers ix * cell to (ix + 1) * cell.
 * @param {number} iy
 * @param {number} amount  0 to 1.5: how much of the usual grass there is here (a material's "grass").
 */
export function plantIn(layer, ix, iy, amount = 1) {
  const s = layer.salt;
  const x = (ix + 0.15 + 0.7 * hash2(ix + s, iy - s)) * layer.cell;
  const y = (iy + 0.15 + 0.7 * hash2(ix - s, iy + s * 3)) * layer.cell;
  const d = grassDensity(x, y);
  if (hash2(ix * 3 + s, iy * 3 + 1) >= d * amount) return false;
  const r = hash2(ix + s * 5, iy + 7);
  plant.x = x; plant.y = y; plant.density = d;
  plant.height = layer.low + (layer.high - layer.low) * r * (0.55 + 0.45 * d); // lush patches grow taller
  plant.lean = (hash2(ix + 13, iy + s * 7) - 0.5) * 0.5; // the plant's own lean across the wind, as a share of its height
  plant.tint = hash2(ix + s * 11, iy + 29);              // 0 dark, 1 light: brightness is 0.82 + 0.36 x tint
  plant.flower = layer.name === 'blade' && hash2(ix + 41, iy + s * 13) > 0.972 ? 1 + Math.floor(hash2(ix + 43, iy + 47) * 3) : 0; // 0 none, else 1 white, 2 yellow, 3 pink
  return true;
}

/** Flower colours by number (see plant.flower), 0 to 255. A flower sits at the top fifth of its blade. */
export const FLOWERS = [null, [250, 246, 232], [246, 208, 84], [232, 140, 176]];

/**
 * How far the tip of a plant is pushed along the wind, as a share of its height: a steady lean
 * plus a slow wave that travels downwind.
 * @param {number} t         0..1 through the loop of an animated scene, or -1 for a still one.
 * @param {number[]} [wind]  scene.wind.
 */
export function windLean(x, y, t, wind = WIND) {
  const w = Math.hypot(wind[0], wind[1]);
  if (!(w > 0)) return 0;
  const along = (x * wind[0] + y * wind[1]) / w;
  const p = t >= 0 ? 2 * Math.PI * t : 0;
  return w * (0.14 + 0.16 * Math.sin(along * 0.9 - p) + 0.05 * Math.sin(along * 2.3 + x * 0.7 - 2 * p));
}

/**
 * Every plant rooted in a rectangle of ground, as plain numbers side by side.
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {{layers?: string[], amount?: number|((x:number, y:number) => number)}} [opts]
 *   layers: which of 'tuft' and 'blade' (default both). amount: how much grass, 0 to 1.5, or a
 *   function of the place (0 where the ground is not grass).
 * @returns {{count:number, x:Float32Array, y:Float32Array, height:Float32Array, lean:Float32Array, tint:Float32Array, flower:Uint8Array, layer:Uint8Array}}
 *   layer: index into GRASS_LAYERS. lean: the plant's own, as a share of its height (add the wind).
 */
export function grassPlants(x0, y0, x1, y1, opts = {}) {
  const amount = typeof opts.amount === 'function' ? opts.amount : () => opts.amount ?? 1;
  const xs = []; const ys = []; const hs = []; const ls = []; const ts = []; const fs = []; const ly = [];
  GRASS_LAYERS.forEach((layer, n) => {
    if (opts.layers && !opts.layers.includes(layer.name)) return;
    for (let iy = Math.floor(y0 / layer.cell); iy <= Math.floor(y1 / layer.cell); iy++) {
      for (let ix = Math.floor(x0 / layer.cell); ix <= Math.floor(x1 / layer.cell); ix++) {
        // the place is only known once the plant is: look with the most grass there can be, then ask about that place
        if (!plantIn(layer, ix, iy, 1.5)) continue;
        if (plant.x < x0 || plant.y < y0 || plant.x >= x1 || plant.y >= y1) continue;
        const a = amount(plant.x, plant.y);
        if (!(a > 0) || !plantIn(layer, ix, iy, a)) continue;
        xs.push(plant.x); ys.push(plant.y); hs.push(plant.height); ls.push(plant.lean); ts.push(plant.tint); fs.push(plant.flower); ly.push(n);
      }
    }
  });
  return { count: xs.length, x: Float32Array.from(xs), y: Float32Array.from(ys), height: Float32Array.from(hs), lean: Float32Array.from(ls), tint: Float32Array.from(ts), flower: Uint8Array.from(fs), layer: Uint8Array.from(ly) };
}

/**
 * The same plants as a list of objects, for views that draw grass their own way (a first-person
 * view, a map).
 * @param {{layers?: string[], amount?: number|Function, time?: number, wind?: number[]}} [opts]
 *   time: 0..1 for the wind's wave, default still. wind: scene.wind.
 * @returns {Array<{layer:string, x:number, y:number, height:number, width:number, lean:number[], tint:number, flower:number}>}
 *   lean: [x, y] push of the tip along the ground in metres, wind included.
 */
export function grassIn(x0, y0, x1, y1, opts = {}) {
  const p = grassPlants(x0, y0, x1, y1, opts);
  const wind = opts.wind ?? WIND;
  const w = Math.hypot(wind[0], wind[1]) || 1;
  return Array.from({ length: p.count }, (_, k) => {
    const blow = windLean(p.x[k], p.y[k], opts.time ?? -1, wind) * p.height[k] / w; const own = p.lean[k] * p.height[k] / w;
    return { layer: GRASS_LAYERS[p.layer[k]].name, x: p.x[k], y: p.y[k], height: p.height[k], width: GRASS_LAYERS[p.layer[k]].width, lean: [wind[0] * blow - wind[1] * own, wind[1] * blow + wind[0] * own], tint: p.tint[k], flower: p.flower[k] };
  });
}

/**
 * Draw plants into a picture's samples, for Kiln's own pictures: each plant is a tapering stroke
 * from its foot up to its tip, nearer plants over further ones.
 * @param {object} plants  From grassPlants.
 * @param {object} S       The picture's projection (sampleProjection in scene-light.js).
 * @param {number} w       Picture size in samples.
 * @param {number} h
 * @param {(x:number, y:number) => number} heightAt  Ground height at a plant's foot.
 * @param {(i:number) => boolean} open  Whether sample i shows bare ground (plants are not drawn over objects or water).
 * @param {number} t       0..1 through the loop, or -1 for a still picture.
 * @param {number[]} [wind]
 * @returns {{id:Int32Array, up:Uint8Array, strength:Float32Array}|null}  Per sample: the plant
 *   seen there (-1 none) and how far up it the sample is (0 foot to 255 tip); strength per layer.
 */
export function drawGrass(plants, S, w, h, heightAt, open, t, wind = WIND) {
  const ppu = S.perUnit;
  const strength = Float32Array.from(GRASS_LAYERS, (l) => Math.min(1, Math.max(0, (ppu - l.from) / (l.full - l.from))));
  if (!plants.count || !strength.some((v) => v > 0)) return null;
  const id = new Int32Array(w * h).fill(-1);
  const up = new Uint8Array(w * h);
  const { px, ox, oy, oz, c0, r0, ax, ay, az, bx, by, bz } = S;
  // nearer plants (further down the picture) are drawn later, so they end up on top
  const near = Float32Array.from(plants.x, (x, k) => bx * x + by * plants.y[k]);
  const order = Array.from({ length: plants.count }, (_, k) => k).filter((k) => strength[plants.layer[k]] > 0).sort((a, b) => near[a] - near[b]);
  const wl = Math.hypot(wind[0], wind[1]) || 1;
  // how a push of one metre along the ground shows on the picture, in samples: along the wind, and across it
  const windCols = (ax * wind[0] + ay * wind[1]) / wl * px; const windRows = (bx * wind[0] + by * wind[1]) / wl * px;
  const crossCols = (-ax * wind[1] + ay * wind[0]) / wl * px; const crossRows = (-bx * wind[1] + by * wind[0]) / wl * px;
  for (const k of order) {
    const layer = GRASS_LAYERS[plants.layer[k]];
    const x = plants.x[k]; const y = plants.y[k]; const z = heightAt(x, y); const tall = plants.height[k];
    const fx = (c0 + ax * (x - ox) + ay * (y - oy) + az * (z - oz)) * px; const fy = (r0 + bx * (x - ox) + by * (y - oy) + bz * (z - oz)) * px;
    if (fx < -40 || fy < -4 || fx > w + 40 || fy > h + 200) continue;
    const blow = windLean(x, y, t, wind) * tall; const own = plants.lean[k] * tall;
    // the tip: straight up from the foot, pushed along the ground by the wind and the plant's own lean
    const tx = fx + az * tall * 16 * px + blow * windCols + own * crossCols;
    const ty = fy + bz * tall * 16 * px + blow * windRows + own * crossRows;
    const rows = Math.max(1, Math.ceil(fy - ty));
    const half0 = layer.width * ppu / 2;
    for (let j = 0; j <= rows; j++) {
      const f = j / rows; // 0 at the foot, 1 at the tip
      const cy = Math.round(fy + (ty - fy) * f - 0.5);
      if (cy < 0 || cy >= h) continue;
      const mid = fx + (tx - fx) * f * f; // the stroke bends: most of the lean is near the tip
      const half = Math.max(0.5, half0 * (1 - f) ** 0.8);
      const a = Math.max(0, Math.round(mid - half)); const b = Math.min(w - 1, Math.max(a, Math.round(mid + half) - 1));
      for (let cx = a; cx <= b; cx++) {
        const i = cy * w + cx;
        if (!open(i)) continue;
        id[i] = k; up[i] = Math.round(f * 255);
      }
    }
  }
  return { id, up, strength };
}
