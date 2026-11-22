// Seeded terrain for createWorld: height, temperature and wetness noise pick a biome per tile,
// biomes scatter objects, and points of interest (POIs) are stamped on top. Every value is a
// pure function of the seed and the absolute tile position, so chunks match at their borders
// and come out the same whatever order they load in.
import { hashSeed, hash2, rand2, fbm, createRng } from './rng.js';

/** Default ground tile ids (layer "ground"). Games may use their own numbers in a biome table. */
export const GROUND = { none: 0, deep: 1, water: 2, sand: 3, grass: 4, moss: 5, dust: 6, snow: 7, rock: 8, marsh: 9, floor: 10, path: 11 };
/** Default object ids (layer "object"). 0 means nothing there. */
export const OBJECT = { none: 0, tree: 1, pine: 2, boulder: 3, bush: 4, reed: 5, thornbush: 6, wall: 7, chest: 8, pillar: 9, fire: 10 };

/** Default biome table: each biome sits at a (temp, wet) point; a tile takes the nearest one. */
export const BIOMES = [
  { name: 'meadow', temp: 0.5, wet: 0.45, ground: GROUND.grass, scatter: [[OBJECT.tree, 0.015], [OBJECT.bush, 0.02]] },
  { name: 'forest', temp: 0.45, wet: 0.62, ground: GROUND.moss, scatter: [[OBJECT.tree, 0.12], [OBJECT.bush, 0.04]] },
  { name: 'taiga', temp: 0.3, wet: 0.5, ground: GROUND.snow, scatter: [[OBJECT.pine, 0.08], [OBJECT.boulder, 0.01]] },
  { name: 'steppe', temp: 0.66, wet: 0.36, ground: GROUND.dust, scatter: [[OBJECT.thornbush, 0.02], [OBJECT.boulder, 0.012]] },
  { name: 'fen', temp: 0.58, wet: 0.68, ground: GROUND.marsh, scatter: [[OBJECT.reed, 0.1], [OBJECT.tree, 0.02]] },
];

/**
 * createTerrain(options) -> terrain
 * options:
 *   seed        string or number. Required.
 *   scale       tiles across one big land shape. Default 96.
 *   sea         height below which is water (0..1). Default 0.42.   peak  height above which is rock. Default 0.66.
 *   biomes      biome table (see BIOMES).   ground / object  id tables when you renumber (see GROUND, OBJECT).
 *   pois        [{ name, spacing, chance, radius, biomes?, stamp(poi, put) }]
 *               spacing: tiles between candidate sites. chance: 0..1 that a site is used.
 *               radius: the stamp never reaches further than this many tiles from the site.
 *               biomes: names the site must sit in (default any land). stamp: see README.
 * terrain:
 *   generate(chunk)   pass as createWorld({ generate: terrain.generate })
 *   sample(tx, ty)    { height, temp, wet, biome, ground } for ANY tile, loaded or not (maps, far views)
 *   poisIn(tx0, ty0, tx1, ty1)  POI sites in a tile box, without loading chunks: [{ name, tx, ty, seed }]
 */
export function createTerrain(options = {}) {
  const { scale = 96, sea = 0.42, peak = 0.66, biomes = BIOMES, ground = GROUND, pois = [] } = options;
  if (options.seed === undefined || options.seed === null) throw new Error('createTerrain: options.seed is required');
  if (!(scale > 0)) throw new Error(`createTerrain: scale must be > 0, got ${scale}`);
  if (!Array.isArray(biomes) || !biomes.length) throw new Error('createTerrain: biomes must be a non-empty array');
  pois.forEach((p, i) => {
    if (!p.name || typeof p.stamp !== 'function') throw new Error(`createTerrain: pois[${i}] needs a name and a stamp(poi, put) function`);
    if (!Number.isInteger(p.spacing) || p.spacing < 8) throw new Error(`createTerrain: pois[${i}].spacing must be an integer >= 8 tiles, got ${p.spacing}`);
    if (!Number.isInteger(p.radius) || p.radius < 0 || p.radius * 2 >= p.spacing) throw new Error(`createTerrain: pois[${i}].radius (${p.radius}) must be an integer >= 0 and less than half its spacing (${p.spacing})`);
    if (!(p.chance > 0 && p.chance <= 1)) throw new Error(`createTerrain: pois[${i}].chance must be a number above 0 and at most 1, got ${p.chance}`);
  });
  const seed = hashSeed(options.seed);
  const sH = seed ^ 0x9e3779b9;
  const sT = seed ^ 0x7f4a7c15;
  const sW = seed ^ 0x2545f491;
  const sS = seed ^ 0x51ed270b;
  const out = { height: 0, temp: 0, wet: 0, biome: null, ground: 0 };

  /** Fills and returns ONE shared object (copy the fields you keep). */
  function sample(tx, ty) {
    const h = fbm(sH, tx / scale, ty / scale, 4);
    const t = fbm(sT, tx / (scale * 2.5), ty / (scale * 2.5), 2);
    const w = fbm(sW, tx / (scale * 1.7), ty / (scale * 1.7), 2);
    out.height = h; out.temp = t; out.wet = w; out.biome = null;
    if (h < sea - 0.07) out.ground = ground.deep;
    else if (h < sea) out.ground = ground.water;
    else if (h < sea + 0.02) out.ground = ground.sand;
    else if (h > peak) out.ground = ground.rock;
    else {
      let best = biomes[0];
      let bd = Infinity;
      for (const b of biomes) { const d = (b.temp - t) * (b.temp - t) + (b.wet - w) * (b.wet - w); if (d < bd) { bd = d; best = b; } }
      out.biome = best;
      out.ground = best.ground;
    }
    return out;
  }

  /** The POI of one kind in site cell (gx, gy), or null. Same answer from every chunk. */
  function siteAt(p, k, gx, gy) {
    const s = hash2(seed ^ Math.imul(k + 1, 0x3c6ef372), gx, gy);
    if (s / 4294967296 >= p.chance) return null;
    const room = p.spacing - 2 * p.radius; // keep the whole stamp inside its own cell
    const tx = gx * p.spacing + p.radius + (hash2(s, 1, 0) % room);
    const ty = gy * p.spacing + p.radius + (hash2(s, 0, 1) % room);
    const here = sample(tx, ty);
    if (!here.biome || (p.biomes && !p.biomes.includes(here.biome.name))) return null;
    return { name: p.name, tx, ty, seed: s };
  }

  function eachSite(tx0, ty0, tx1, ty1, fn) {
    pois.forEach((p, k) => {
      const g0x = Math.floor(tx0 / p.spacing); const g1x = Math.floor(tx1 / p.spacing);
      const g0y = Math.floor(ty0 / p.spacing); const g1y = Math.floor(ty1 / p.spacing);
      for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) { const site = siteAt(p, k, gx, gy); if (site) fn(site, p); }
    });
  }

  function generate(chunk) {
    const n = chunk.size;
    const g = chunk.layers.ground;
    const o = chunk.layers.object;
    const hl = chunk.layers.height;
    if (!g) throw new Error('terrain.generate: the world needs a "ground" layer');
    for (let ly = 0; ly < n; ly++) {
      for (let lx = 0; lx < n; lx++) {
        const tx = chunk.x0 + lx; const ty = chunk.y0 + ly;
        const s = sample(tx, ty);
        const i = ly * n + lx;
        g[i] = s.ground;
        if (hl) hl[i] = s.height * 255;
        if (o && s.biome) {
          let roll = rand2(sS, tx, ty);
          for (const [id, chance] of s.biome.scatter ?? []) { if (roll < chance) { o[i] = id; break; } roll -= chance; }
        }
      }
    }
    const x1 = chunk.x0 + n - 1; const y1 = chunk.y0 + n - 1;
    const put = (tx, ty, layer, value) => { // writes only the part that lies in this chunk
      if (tx < chunk.x0 || tx > x1 || ty < chunk.y0 || ty > y1) return;
      const arr = chunk.layers[layer];
      if (!arr) throw new Error(`poi stamp: unknown layer "${layer}"`);
      arr[(ty - chunk.y0) * n + (tx - chunk.x0)] = value;
    };
    eachSite(chunk.x0, chunk.y0, x1, y1, (site, p) => {
      site.rng = createRng(site.seed); // a fresh stream each time: every chunk stamps the same picture
      p.stamp(site, put);
      delete site.rng;
      if (site.tx >= chunk.x0 && site.tx <= x1 && site.ty >= chunk.y0 && site.ty <= y1) chunk.features.push(site);
    });
  }

  return {
    seed: options.seed, generate, sample,
    poisIn(tx0, ty0, tx1, ty1) { const list = []; eachSite(tx0, ty0, tx1, ty1, (site) => { if (site.tx >= tx0 && site.tx <= tx1 && site.ty >= ty0 && site.ty <= ty1) list.push(site); }); return list; },
  };
}

/**
 * stampRows(poi, put, rows, legend) - draw a small map (array of equal-length strings) centred on
 * the POI. legend maps a character to { ground?, object? }; characters not in it are skipped.
 * Works with the levels engine: stampRows(poi, put, toRows(grid), legend).
 */
export function stampRows(poi, put, rows, legend) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('stampRows: rows must be a non-empty array of strings');
  const x0 = poi.tx - Math.floor(rows[0].length / 2);
  const y0 = poi.ty - Math.floor(rows.length / 2);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const entry = legend[rows[y][x]];
      if (!entry) continue;
      if (entry.ground !== undefined) put(x0 + x, y0 + y, 'ground', entry.ground);
      if (entry.object !== undefined) put(x0 + x, y0 + y, 'object', entry.object);
    }
  }
}
