// Materials for 3D scenes: what each surface is made of, and the fine pattern and shine that goes
// with it (grass mottling, roof tiles, stone courses, wood boards, leaf clumps, ripples on water).
// Patterns are worked out from the position of each sample in the world, so they stay put when the
// detail changes, and each one fades out when it becomes too small to show (no noise at low detail).
// All original and procedural; nothing is loaded. Pure and browser-safe.

/** Surface kinds. gloss: strength of the highlight (0 = matt); shine: how tight it is. */
export const SURFACES = {
  plain: { gloss: 0, shine: 8 },
  grass: { gloss: 0, shine: 8 },
  dirt: { gloss: 0, shine: 8 },
  sand: { gloss: 0.03, shine: 20 },
  stone: { gloss: 0.05, shine: 10 },    // bare rock and stony ground
  snow: { gloss: 0.12, shine: 18 },
  plaster: { gloss: 0, shine: 8 },      // house walls
  masonry: { gloss: 0.04, shine: 10 },  // laid stone: towers, walls, wells
  tile: { gloss: 0.12, shine: 14 },     // roofs
  thatch: { gloss: 0, shine: 8 },       // straw and hay
  wood: { gloss: 0.04, shine: 10 },
  bark: { gloss: 0, shine: 8 },
  foliage: { gloss: 0.07, shine: 8 },
  cloth: { gloss: 0, shine: 8 },
  skin: { gloss: 0.03, shine: 8 },
  metal: { gloss: 0.5, shine: 26 },
  glass: { gloss: 0.6, shine: 40 },
  lamp: { gloss: 0, shine: 8 },         // the lit part of a lamp
  water: { gloss: 0.55, shine: 48 },
};
export const SURFACE_NAMES = Object.keys(SURFACES);
const ID = Object.fromEntries(SURFACE_NAMES.map((n, i) => [n, i]));
const LIST = SURFACE_NAMES.map((n) => SURFACES[n]);

// the part names shapes use for their colours, and what those parts are made of
const ROLE_SURFACE = {
  ground: 'grass', wall: 'plaster', roof: 'tile', door: 'wood', wood: 'wood', board: 'wood', hull: 'wood', inside: 'wood',
  pole: 'wood', hub: 'wood', box: 'wood', trunk: 'bark', stone: 'masonry', rock: 'stone', leaf: 'foliage', hay: 'thatch',
  cloth: 'cloth', tunic: 'cloth', sail: 'cloth', hat: 'cloth', legs: 'cloth', steel: 'metal', shield: 'metal', visor: 'metal',
  post: 'metal', window: 'glass', light: 'lamp', skin: 'skin', bone: 'skin',
};

/** Surface id for a shape part name ("roof", "leaf", ...); plain when unknown. */
export function surfaceOfRole(role) {
  return ID[ROLE_SURFACE[role] ?? 'plain'];
}

/** Surface id for a ground material: its "surface" key, else guessed from its name. */
export function surfaceOfMaterial(name, material = {}) {
  if (material.surface && ID[material.surface] !== undefined) return ID[material.surface];
  const n = String(name).toLowerCase();
  if (/grass|meadow|moss|marsh|lawn|field/.test(n)) return ID.grass;
  if (/path|dirt|mud|road|earth|soil|track/.test(n)) return ID.dirt;
  if (/sand|beach|dune/.test(n)) return ID.sand;
  if (/snow|ice|frost/.test(n)) return ID.snow;
  if (/stone|rock|cobble|gravel|cliff|slate/.test(n)) return ID.stone;
  if (/wood|plank|deck/.test(n)) return ID.wood;
  return ID.plain;
}

function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth noise in 0..1. */
export function noise2(x, y) {
  const ix = Math.floor(x); const iy = Math.floor(y);
  let u = x - ix; let v = y - iy;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  const a = hash2(ix, iy); const b = hash2(ix + 1, iy); const c = hash2(ix, iy + 1); const d = hash2(ix + 1, iy + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** What `texture` found: l multiplies brightness, w shifts warm (+) or cool (-), gloss and shine set the highlight. */
export const tex = { l: 1, w: 0, gloss: 0, shine: 8 };

/**
 * The pattern of a surface at one point. Fills `tex`.
 * @param {number} id   Surface id.
 * @param {number} x    Ground position.
 * @param {number} y
 * @param {number} zu   Height in ground units (height units / 16).
 * @param {number} nx   Direction the surface faces.
 * @param {number} ny
 * @param {number} nz
 * @param {number} ppu  Samples per ground unit: patterns finer than about two samples are left out.
 * @param {number} rise Height above the foot of the object, in ground units (walls are grubbier low down).
 * @param {number} t    Animation time 0..1 (loops); moves leaves, grass and water a little.
 */
export function texture(id, x, y, zu, nx, ny, nz, ppu, rise, t) {
  const fade = (wave) => { const f = (wave * ppu - 2) / 4; return f < 0 ? 0 : f > 1 ? 1 : f; };
  let l = 1; let w = 0;
  // along a wall: u runs sideways, v up; on flatter surfaces the ground position is used
  const nh = Math.hypot(nx, ny);
  const steep = nz < 0.55 && nh > 1e-3;
  const u = steep ? (x * -ny + y * nx) / nh : x;
  const v = steep ? zu : y;
  switch (id) {
    case 1: { // grass
      const sway = t >= 0 ? 0.12 * Math.sin(2 * Math.PI * t + x * 0.9 + y * 0.7) : 0;
      l += 0.12 * (noise2(x / 3.5, y / 3.5) - 0.5) + 0.1 * (noise2(x * 1.1 + 7, y * 1.1) - 0.5) * fade(0.9)
        + 0.16 * (noise2(x * 4.2 + sway, y * 4.2) - 0.5) * fade(0.24);
      w = 0.1 * (noise2(x / 6 + 3, y / 6) - 0.5);
      const f = fade(0.3);
      if (f > 0) { const cx = Math.floor(x / 0.7); const cy = Math.floor(y / 0.7); const h = hash2(cx, cy); if (h > 0.72) { const d = Math.hypot(x / 0.7 - cx - 0.3 - 0.4 * hash2(cx + 9, cy), y / 0.7 - cy - 0.3 - 0.4 * hash2(cx, cy + 9)); if (d < 0.24) l += (h > 0.93 ? 0.16 : -0.1) * f * (1 - d / 0.24); } }
      break;
    }
    case 2: { // dirt
      l += 0.1 * (noise2(x / 2, y / 2) - 0.5) + 0.14 * (noise2(x * 3, y * 3) - 0.5) * fade(0.33);
      w = 0.05 * (noise2(x / 3 + 5, y / 3) - 0.5);
      const f = fade(0.2);
      if (f > 0) { const cx = Math.floor(x / 0.45); const cy = Math.floor(y / 0.45); const hp = hash2(cx, cy); if (hp > 0.78) { const d = Math.hypot(x / 0.45 - cx - 0.25 - 0.5 * hash2(cx + 5, cy), y / 0.45 - cy - 0.25 - 0.5 * hash2(cx, cy + 5)); const rad = 0.1 + 0.12 * (hp - 0.78) / 0.22; if (d < rad * 1.7) l += 0.15 * f * (d < rad ? 1 : -0.5); } }
      break;
    }
    case 3: // sand
      l += 0.05 * Math.sin((x * 0.8 + y * 0.6) * 9 + 5 * noise2(x / 2, y / 2)) * fade(0.7) + 0.07 * (noise2(x * 8, y * 8) - 0.5) * fade(0.12) + 0.06 * (noise2(x / 3, y / 3) - 0.5);
      break;
    case 4: { // stone
      const a = x + zu * 0.7; const b = y - zu * 0.6;
      l += 0.16 * (noise2(a / 1.2, b / 1.2) - 0.5) + 0.08 * (noise2(a * 3, b * 3) - 0.5) * fade(0.33);
      const c = Math.abs(noise2(a * 1.6 + 3, b * 1.6) - 0.5);
      if (c < 0.02) l -= 0.13 * fade(0.5) * (1 - c / 0.02);
      break;
    }
    case 5: // snow
      l += 0.05 * (noise2(x / 2, y / 2) - 0.5) + 0.04 * (noise2(x * 5, y * 5) - 0.5) * fade(0.2);
      w = -0.03;
      break;
    case 6: // plaster
      l += 0.08 * (noise2(u / 1.5, v / 1.5 + 3) - 0.5) + 0.05 * (noise2(u * 5, v * 5) - 0.5) * fade(0.2);
      if (steep) l -= 0.12 * Math.exp(-Math.max(0, rise) / 0.35);
      break;
    case 7: { // masonry
      const ch = steep ? 0.4 : 0.8; const cl = steep ? 0.95 : 0.8;
      const row = Math.floor(v / ch);
      const uu = u / cl + (row & 1 ? 0.5 : 0);
      const block = Math.floor(uu); const fu = uu - block; const fv = v / ch - row;
      const f = fade(ch);
      if (fu < 0.07 || fv < 0.11) l -= 0.17 * f; else l += 0.14 * (hash2(block, row) - 0.5) * f;
      l += 0.06 * (noise2(u * 4, v * 4) - 0.5) * fade(0.25) + 0.06 * (noise2(u / 2, v / 2) - 0.5);
      if (steep) l -= 0.08 * Math.exp(-Math.max(0, rise) / 0.4);
      break;
    }
    case 8: { // tile: rows down the slope, tiles side by side, every other row shifted
      const row = Math.floor(zu / 0.3);
      const fv = zu / 0.3 - row;
      const uu = (steep || nh > 1e-3 ? (x * -ny + y * nx) / nh : x) / 0.45 + (row & 1 ? 0.5 : 0);
      const tile = Math.floor(uu); const fu = uu - tile;
      const f = fade(0.3);
      if (fv < 0.2) l -= 0.18 * f; else if (fu < 0.1) l -= 0.08 * fade(0.45);
      l += 0.12 * (hash2(tile, row + 31) - 0.5) * fade(0.45) + 0.05 * (noise2(x / 1.5, y / 1.5) - 0.5);
      break;
    }
    case 9: { // thatch
      const uu = nh > 1e-3 ? (x * -ny + y * nx) / nh : x;
      l += 0.16 * (noise2(uu * 7, zu * 1.3) - 0.5) * fade(0.15) + 0.08 * (noise2(uu * 2, zu * 3) - 0.5);
      w = 0.04 * (noise2(uu, zu) - 0.5);
      break;
    }
    case 10: { // wood: boards with grain
      const uu = u / 0.32;
      const fu = uu - Math.floor(uu);
      if (fu < 0.09) l -= 0.15 * fade(0.32);
      l += 0.1 * (noise2(u * 9, v * 1.3) - 0.5) * fade(0.11) + 0.06 * (hash2(Math.floor(uu), 5) - 0.5) * fade(0.32);
      break;
    }
    case 11: // bark
      l += 0.2 * (noise2(u * 8, v * 1.1) - 0.5) * fade(0.12) + 0.06 * (noise2(u, v) - 0.5);
      break;
    case 12: { // foliage: clumps of leaves, with dapple; the wind moves the clumps a little
      const sway = t >= 0 ? 0.1 * Math.sin(2 * Math.PI * t + x * 0.6 + y * 0.8) : 0;
      const a = noise2(x * 1.6 + zu * 1.1 + sway, y * 1.6 - zu * 0.9 + sway * 0.6);
      l += 0.34 * (a - 0.5) * fade(0.6) + 0.2 * (noise2(x * 5 + zu * 3 + sway * 2, y * 5 + zu * 2) - 0.5) * fade(0.2);
      w = 0.07 * (a - 0.5);
      break;
    }
    case 15: // metal
      l += 0.06 * (noise2(u * 2, v * 14) - 0.5) * fade(0.07);
      break;
    case 16: case 17: break; // glass, lamp
    default: // plain, cloth, skin
      l += 0.04 * (noise2(x * 6 + zu * 5, y * 6 - zu * 4) - 0.5) * fade(0.16);
  }
  tex.l = l; tex.w = w; tex.gloss = LIST[id].gloss; tex.shine = LIST[id].shine;
}

/** What `waterSurface` found: the tilt of the surface, foam 0..1 and a brightness pattern. */
export const wave = { nx: 0, ny: 0, foam: 0, l: 1 };

/**
 * Ripples, shore foam and mottling for water at x, y. Fills `wave`.
 * @param {number} depth  Water depth in height units (large for open sea).
 * @param {number} ppu    Samples per ground unit.
 * @param {number} t      Animation time 0..1 (loops), or -1 for a still picture.
 */
export function waterSurface(x, y, depth, ppu, t) {
  const fade = (wv) => { const f = (wv * ppu - 2) / 4; return f < 0 ? 0 : f > 1 ? 1 : f; };
  const p = t >= 0 ? 2 * Math.PI * t : 0;
  // three trains of ripples, each moving a whole number of wavelengths per loop
  // (their phases are bent by slow noise, so the crests wander instead of forming a grid)
  const bend = 5 * noise2(x / 3.3, y / 3.3); const bend2 = 5 * noise2(x / 2.1 + 9, y / 2.1);
  const a = Math.cos(x * 2.1 + y * 0.9 + p + bend);
  const b = Math.cos(-x * 0.8 + y * 2.9 - 2 * p + bend2);
  const c = Math.cos(x * 5.1 - y * 3.7 + 3 * p + bend - bend2);
  // ripples want a good dozen samples per wave; coarser than that the water stays calm
  const f1 = Math.min(1, Math.max(0, (ppu - 4) / 8)); const f2 = Math.min(1, Math.max(0, (ppu - 8) / 10));
  // the surface tilts down the slope of the waves
  wave.nx = (0.03 * 2.1 * a - 0.02 * 0.8 * b) * f1 + 0.006 * 5.1 * c * f2;
  wave.ny = (0.03 * 0.9 * a + 0.02 * 2.9 * b) * f1 - 0.006 * 3.7 * c * f2;
  wave.l = 1 + 0.1 * (noise2(x / 4, y / 4) - 0.5) + 0.025 * (a + b) * f1;
  // foam where the water is shallowest; it laps in and out once per loop
  const lap = 1.3 + (t >= 0 ? 0.5 * Math.sin(p + x * 0.5 + y * 0.4) : 0);
  const edge = depth < lap ? 1 - depth / lap : 0;
  wave.foam = edge > 0 ? Math.min(1, edge * edge * (0.5 + 1.1 * noise2(x * 3.1 + (t >= 0 ? Math.sin(p) * 0.2 : 0), y * 3.1))) * (0.3 + 0.7 * fade(0.5)) : 0;
}
