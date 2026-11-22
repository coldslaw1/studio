// Built-in 3D shapes for scenes, as PLY meshes for the Asciicker renderer. All original and
// generated from boxes, prisms and pyramids. Units: x and y in ground units, z in sixteenths
// (so z 16 is as tall as 1 unit is wide). Shapes stand on z = 0 centred on the origin and face -y.
import { parseHex } from './color.js';
import { makeRng } from './rng.js';
import { genShape } from './gen-shape.js';
import { modelShape } from './model.js';

const ZS = 16;

/**
 * The world scale every shape is built to: 1 ground unit is 1 metre (and 16 height steps), and a
 * standing adult is about this many units tall to the top of the head (hats and helmets go above).
 * Doors are about 2.1 units, house walls 2.75 to 3.5, a fence 1.1, a barrel 1.
 */
export const HUMAN_HEIGHT = 1.8;

function mesh() {
  const verts = [];
  const faces = [];
  const tones = [];
  let tf = null;
  // the renderer lights each face itself, so only a light touch of baked shading is kept
  const shade = (hex, k) => parseHex(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * (0.85 + 0.15 * Math.min(1, k))))));
  const put = (p, hex, k) => {
    let [x, y, z] = p;
    if (tf) {
      // rotate in true space (z scaled down) about the pivot: rx then rz
      let dx = x - tf.pivot[0];
      let dy = y - tf.pivot[1];
      let dz = (z - tf.pivot[2]) / ZS;
      const a = (tf.rx ?? 0) * Math.PI / 180;
      [dy, dz] = [dy * Math.cos(a) - dz * Math.sin(a), dy * Math.sin(a) + dz * Math.cos(a)];
      const c = (tf.rz ?? 0) * Math.PI / 180;
      [dx, dy] = [dx * Math.cos(c) - dy * Math.sin(c), dx * Math.sin(c) + dy * Math.cos(c)];
      [x, y, z] = [tf.pivot[0] + dx, tf.pivot[1] + dy, tf.pivot[2] + dz * ZS];
    }
    tones[verts.length] = hex; // the colour as asked for, which shapeMesh uses to tell parts apart
    verts.push([x, y, z, ...shade(hex, k)]);
    return verts.length - 1;
  };
  const poly = (pts, hex, k) => {
    const ids = pts.map((p) => put(p, hex, k));
    for (let i = 1; i < ids.length - 1; i++) faces.push([ids[0], ids[i], ids[i + 1]]);
  };
  const m = {
    verts,
    faces,
    tones,
    /** Run fn with every new vertex rotated about pivot: { pivot: [x, y, z], rx, rz } in degrees. */
    with(transform, fn) { const old = tf; tf = transform; fn(); tf = old; },
    box(x0, y0, z0, x1, y1, z1, hex) {
      poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], hex, 0.8);
      poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], hex, 1.0);
      poly([[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], hex, 0.9);
      poly([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], hex, 0.65);
      poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], hex, 1.1);
    },
    pyramid(x0, y0, z0, x1, y1, z1, hex) {
      const top = [(x0 + x1) / 2, (y0 + y1) / 2, z1];
      const base = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]];
      [0.8, 1.05, 0.95, 0.65].forEach((k, i) => poly([base[i], base[(i + 1) % 4], top], hex, k));
    },
    /** Upright n-sided prism, radius r at the bottom and r1 at the top (0 makes a cone). */
    prism(cx, cy, r, z0, z1, hex, n = 8, r1 = r) {
      const at = (i, rad, z) => [cx + rad * Math.cos(i / n * 2 * Math.PI), cy + rad * Math.sin(i / n * 2 * Math.PI), z];
      for (let i = 0; i < n; i++) {
        const k = 0.86 + 0.24 * Math.cos((i + 0.5) / n * 2 * Math.PI - 0.5);
        if (r1 > 0) poly([at(i, r, z0), at(i + 1, r, z0), at(i + 1, r1, z1), at(i, r1, z1)], hex, k);
        else poly([at(i, r, z0), at(i + 1, r, z0), [cx, cy, z1]], hex, k);
      }
      if (r1 > 0) poly(Array.from({ length: n }, (_, i) => at(i, r1, z1)), hex, 1.1);
    },
    /** Roof with its ridge along x: eaves at z0, ridge at z1. */
    gable(x0, y0, z0, x1, y1, z1, hex) {
      const ym = (y0 + y1) / 2;
      poly([[x0, y0, z0], [x1, y0, z0], [x1, ym, z1], [x0, ym, z1]], hex, 0.85);
      poly([[x1, y1, z0], [x0, y1, z0], [x0, ym, z1], [x1, ym, z1]], hex, 1.05);
      poly([[x1, y0, z0], [x1, y1, z0], [x1, ym, z1]], hex, 0.95);
      poly([[x0, y1, z0], [x0, y0, z0], [x0, ym, z1]], hex, 0.6);
    },
  };
  // remember which vertices each primitive made, so shapeFootprint can find the parts near the ground
  m.parts = [];
  for (const name of ['box', 'pyramid', 'prism', 'gable']) {
    const make = m[name];
    m[name] = (...args) => { const start = verts.length; make(...args); m.parts.push([start, verts.length]); };
  }
  return m;
}

/** A standing figure. `step` 0 to 1 is the walk cycle (0 and 0.5 are the passing poses). */
function figure(m, { step = 0, skin, top, legs, arm, limb = 0.26, swing = 32 }) {
  const a = Math.sin(step * 2 * Math.PI) * swing;
  const leg = (x0, ang) => m.with({ pivot: [0, 0, 13], rx: ang }, () => m.box(x0, -limb / 2, 0, x0 + limb, limb / 2, 13, legs));
  leg(-0.04 - limb, a);
  leg(0.04, -a);
  m.box(-0.36, -0.2, 12, 0.36, 0.2, 24, top);
  const armBox = (x0, ang) => m.with({ pivot: [0, 0, 23], rx: ang }, () => m.box(x0, -0.11, 13, x0 + 0.2, 0.11, 23.5, arm ?? top));
  armBox(-0.56, -a * 0.8);
  armBox(0.36, a * 0.8);
  m.box(-0.22, -0.22, 24, 0.22, 0.22, 30, skin);
  return a;
}

const SHAPES = {
  /** Box house with a pyramid roof and a door. colors: wall, roof, door. */
  house({ colors = {} }) {
    const m = mesh();
    m.box(-3, -3, 0, 3, 3, 56, colors.wall ?? '#c8b48c');
    m.box(-0.65, -3.15, 0, 0.65, -3, 34, colors.door ?? '#6b3a26');
    m.pyramid(-3.8, -3.8, 56, 3.8, 3.8, 104, colors.roof ?? '#aa3c32');
    return m;
  },
  /** Long cottage with a gabled roof and a chimney. colors: wall, roof, door, stone. */
  cottage({ colors = {} }) {
    const m = mesh();
    m.box(-4, -2.5, 0, 4, 2.5, 44, colors.wall ?? '#d8c8a0');
    m.box(-0.6, -2.65, 0, 0.6, -2.5, 34, colors.door ?? '#5a3320');
    m.box(1.8, -2.62, 17, 3, -2.5, 32, colors.window ?? '#33446a');
    m.box(-3, -2.62, 17, -1.8, -2.5, 32, colors.window ?? '#33446a');
    m.gable(-4.5, -3.1, 44, 4.5, 3.1, 86, colors.roof ?? '#8a5a2c');
    m.box(2.2, 0.6, 60, 3.2, 1.6, 98, colors.stone ?? '#8c8c96');
    return m;
  },
  /** Trunk with stacked pyramids. colors: trunk, leaf. */
  tree({ colors = {} }) {
    const m = mesh();
    m.box(-0.5, -0.5, 0, 0.5, 0.5, 30, colors.trunk ?? '#6b3a26');
    m.pyramid(-3, -3, 24, 3, 3, 70, colors.leaf ?? '#2f7d48');
    m.pyramid(-2.2, -2.2, 54, 2.2, 2.2, 100, colors.leaf ?? '#2f7d48');
    return m;
  },
  /** Tall narrow conifer. colors: trunk, leaf. */
  pine({ colors = {} }) {
    const m = mesh();
    m.prism(0, 0, 0.4, 0, 22, colors.trunk ?? '#5a3320', 6);
    for (let i = 0; i < 4; i++) m.prism(0, 0, 2.3 - i * 0.48, 18 + i * 24, 58 + i * 24, colors.leaf ?? '#1f6a4a', 8, 0);
    return m;
  },
  /** Broad round-crowned tree. colors: trunk, leaf. */
  oak({ colors = {} }) {
    const m = mesh();
    m.prism(0, 0, 0.6, 0, 34, colors.trunk ?? '#6b4a2c', 6);
    m.prism(0, 0, 2.2, 28, 44, colors.leaf ?? '#3c8a3c', 8, 3.2);
    m.prism(0, 0, 3.2, 44, 66, colors.leaf ?? '#3c8a3c', 8, 2.9);
    m.prism(0, 0, 2.9, 66, 82, colors.leaf ?? '#3c8a3c', 8, 1.4);
    return m;
  },
  /** Square tower with battlements. colors: stone. */
  tower({ colors = {} }) {
    const m = mesh();
    const c = colors.stone ?? '#8794a8';
    m.box(-2.5, -2.5, 0, 2.5, 2.5, 120, c);
    m.box(-3, -3, 120, 3, 3, 130, c);
    for (const [x, y] of [[-3, -3], [1.8, -3], [-3, 1.8], [1.8, 1.8]]) m.box(x, y, 130, x + 1.2, y + 1.2, 144, c);
    return m;
  },
  /** Round tower with a cone roof. colors: stone, roof. */
  roundtower({ colors = {} }) {
    const m = mesh();
    m.prism(0, 0, 2.4, 0, 124, colors.stone ?? '#9a9aa8', 10);
    m.prism(0, 0, 3, 124, 176, colors.roof ?? '#aa3c32', 10, 0);
    return m;
  },
  /** Straight wall along x. params: length. colors: stone. */
  wall({ length = 8, colors = {} }) {
    const m = mesh();
    m.box(-length / 2, -0.6, 0, length / 2, 0.6, 44, colors.stone ?? '#8794a8');
    return m;
  },
  /** Post-and-rail fence along x. params: length. colors: wood. */
  fence({ length = 8, colors = {} }) {
    const m = mesh();
    const c = colors.wood ?? '#8a6a3c';
    const n = Math.max(2, Math.round(length / 2) + 1);
    for (let i = 0; i < n; i++) { const x = -length / 2 + i * length / (n - 1); m.box(x - 0.15, -0.15, 0, x + 0.15, 0.15, 18, c); }
    m.box(-length / 2, -0.07, 8, length / 2, 0.07, 10.5, c);
    m.box(-length / 2, -0.07, 13.5, length / 2, 0.07, 16, c);
    return m;
  },
  /** Stone gateway to walk under, opening along y. colors: stone. */
  gate({ colors = {} }) {
    const m = mesh();
    const c = colors.stone ?? '#8794a8';
    m.box(-2.6, -0.8, 0, -1.4, 0.8, 52, c);
    m.box(1.4, -0.8, 0, 2.6, 0.8, 52, c);
    m.box(-2.9, -0.9, 52, 2.9, 0.9, 66, c);
    return m;
  },
  /** Plank bridge along x with rails; ends rest on the ground. params: length, rise. colors: wood. */
  bridge({ length = 10, rise = 10, colors = {} }) {
    const m = mesh();
    const c = colors.wood ?? '#9a7444';
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x0 = -length / 2 + i * length / n;
      const z = rise * Math.sin((i + 0.5) / n * Math.PI);
      m.box(x0, -1.2, z, x0 + length / n, 1.2, z + 3, c);
      if (i % 2 === 0) { m.box(x0, -1.3, z + 3, x0 + 0.25, -1.1, z + 16, c); m.box(x0, 1.1, z + 3, x0 + 0.25, 1.3, z + 16, c); }
    }
    return m;
  },
  /** Round stone well with a little roof. colors: stone, wood, roof. */
  well({ colors = {} }) {
    const m = mesh();
    m.prism(0, 0, 1.2, 0, 12, colors.stone ?? '#8c8c96', 8);
    m.box(-1.25, -0.12, 12, -1, 0.12, 34, colors.wood ?? '#6b4a2c');
    m.box(1, -0.12, 12, 1.25, 0.12, 34, colors.wood ?? '#6b4a2c');
    m.gable(-1.6, -1, 32, 1.6, 1, 44, colors.roof ?? '#8a3a2c');
    return m;
  },
  /** Upright barrel. colors: wood. */
  barrel({ colors = {} }) {
    const m = mesh();
    m.prism(0, 0, 0.42, 0, 8, colors.wood ?? '#8a5a2c', 8, 0.52);
    m.prism(0, 0, 0.52, 8, 16, colors.wood ?? '#8a5a2c', 8, 0.42);
    return m;
  },
  /** Low irregular boulder. params: seed. colors: rock. */
  rock({ seed = 1, colors = {} }) {
    const m = mesh();
    const rng = makeRng(seed);
    const s = 1.6 + rng.next();
    m.pyramid(-s, -s * 0.8, 0, s, s * 0.9, 26 + rng.next() * 14, colors.rock ?? '#7a7a86');
    m.box(-s * 0.7, -s * 0.6, 0, s * 0.6, s * 0.7, 14, colors.rock ?? '#7a7a86');
    return m;
  },
  /** Plain box. params: size [x, y, z]. colors: box. */
  box({ size = [2, 2, 32], colors = {} }) {
    const m = mesh();
    m.box(-size[0] / 2, -size[1] / 2, 0, size[0] / 2, size[1] / 2, size[2], colors.box ?? '#b5733f');
    return m;
  },
  /** Ridge tent. colors: cloth, pole. */
  tent({ colors = {} }) {
    const m = mesh();
    m.gable(-2, -1.8, 0, 2, 1.8, 36, colors.cloth ?? '#c8b478');
    m.box(-0.08, -0.08, 0, 0.08, 0.08, 40, colors.pole ?? '#5a3320');
    return m;
  },
  /** Rounded haystack. colors: hay. */
  haystack({ colors = {} }) {
    const m = mesh();
    m.prism(0, 0, 1.6, 0, 16, colors.hay ?? '#d2b450', 8, 1.5);
    m.prism(0, 0, 1.5, 16, 30, colors.hay ?? '#d2b450', 8, 0);
    return m;
  },
  /** Windmill; the sails face -y. params: turn (degrees, animate it). colors: stone, roof, sail. */
  windmill({ turn = 0, colors = {} }) {
    const m = mesh();
    m.prism(0, 0, 2.6, 0, 110, colors.stone ?? '#c8c0b0', 8, 1.8);
    m.prism(0, 0, 2.1, 110, 140, colors.roof ?? '#7a4a2c', 8, 0);
    for (let i = 0; i < 4; i++) {
      // rotate each sail about the hub, in the x-z plane
      const a = (turn + i * 90) * Math.PI / 180;
      const pt = (r, w) => [Math.cos(a) * r - Math.sin(a) * w, -2.9, 104 + (Math.sin(a) * r + Math.cos(a) * w) * ZS];
      const quad = [pt(0.4, -0.12), pt(5.2, -0.12), pt(5.2, 0.9), pt(0.4, 0.3)];
      const b = m.verts.length;
      for (const p of quad) m.verts.push([...p, ...parseHex(colors.sail ?? '#f0e6c8')]);
      m.faces.push([b, b + 1, b + 2], [b, b + 2, b + 3], [b, b + 2, b + 1], [b, b + 3, b + 2]);
    }
    m.box(-0.3, -3, 101, 0.3, -2.4, 107, colors.hub ?? '#5a3320');
    return m;
  },
  /** Lamp post with a lit top. colors: post, light. */
  lamp({ colors = {} }) {
    const m = mesh();
    m.box(-0.12, -0.12, 0, 0.12, 0.12, 36, colors.post ?? '#3c3c46');
    m.box(-0.35, -0.35, 36, 0.35, 0.35, 44, colors.light ?? '#ffdc78');
    m.pyramid(-0.5, -0.5, 44, 0.5, 0.5, 50, colors.post ?? '#3c3c46');
    return m;
  },
  /** Signpost with one board. colors: wood. */
  signpost({ colors = {} }) {
    const m = mesh();
    m.box(-0.12, -0.12, 0, 0.12, 0.12, 30, colors.wood ?? '#6b4a2c');
    m.box(-0.9, -0.2, 20, 0.9, -0.1, 29, colors.board ?? '#b48c50');
    return m;
  },
  /** Small rowing boat along x (put it at water level). colors: hull, inside. */
  boat({ colors = {} }) {
    const m = mesh();
    const c = colors.hull ?? '#7a4a2c';
    m.box(-2, -0.9, 0, 2, 0.9, 5, c);
    m.box(-2, -0.9, 5, 2, -0.7, 10, c);
    m.box(-2, 0.7, 5, 2, 0.9, 10, c);
    m.pyramid(2, -0.9, 0, 3.4, 0.9, 9, c);
    m.box(-0.2, -0.9, 7, 0.2, 0.9, 8.5, colors.inside ?? '#b48c50');
    return m;
  },
  /** Broken columns on a slab. params: seed. colors: stone. */
  ruin({ seed = 1, colors = {} }) {
    const m = mesh();
    const rng = makeRng(seed);
    const c = colors.stone ?? '#a0a0a8';
    m.box(-3.4, -2.4, 0, 3.4, 2.4, 5, c);
    for (const [x, y] of [[-2.6, -1.6], [0, -1.6], [2.6, -1.6], [-2.6, 1.6], [0, 1.6], [2.6, 1.6]]) m.prism(x, y, 0.45, 5, 16 + rng.next() * 60, c, 6);
    return m;
  },
  /** Villager in a tunic and hat. params: step (walk cycle 0 to 1). colors: skin, tunic, legs, hat. */
  villager({ step = 0, colors = {} }) {
    const m = mesh();
    figure(m, { step, skin: colors.skin ?? '#ffcc99', top: colors.tunic ?? '#3366cc', legs: colors.legs ?? '#996633' });
    m.box(-0.34, -0.34, 29, 0.34, 0.34, 31, colors.hat ?? '#cc9933');
    m.box(-0.2, -0.2, 31, 0.2, 0.2, 34, colors.hat ?? '#cc9933');
    return m;
  },
  /** Armoured knight with sword and shield. params: step. colors: steel, cloth, skin, shield. */
  knight({ step = 0, colors = {} }) {
    const m = mesh();
    const steel = colors.steel ?? '#a8b4c8';
    const a = figure(m, { step, skin: steel, top: colors.cloth ?? '#963c3c', legs: steel, arm: steel, swing: 26 });
    m.box(-0.24, -0.25, 25, 0.24, -0.22, 27, colors.visor ?? '#28283c');
    m.box(-0.06, -0.06, 30, 0.06, 0.06, 34, colors.cloth ?? '#963c3c');
    m.with({ pivot: [0, 0, 23], rx: a * 0.8 }, () => m.box(0.42, -0.9, 13, 0.5, -0.1, 14.5, steel));
    m.with({ pivot: [0, 0, 23], rx: -a * 0.8 }, () => m.box(-0.66, -0.3, 12, -0.56, 0.3, 22, colors.shield ?? '#c8a03c'));
    return m;
  },
  /**
   * A generated asset (see gen.js): a building, prop or character made from a seed or a short
   * description. params: kind, type, describe, seed, style, size; or ready-made solids. colors: by part name.
   */
  gen(params) {
    return genShape(mesh(), params);
  },
  /**
   * An imported model (see model.js and "kiln import"). params: model (the name of a defined model, or
   * its data), style (take that Kiln style's colours), tint ("kiln" or "own"). colors: by part role or name.
   */
  model(params) {
    return modelShape(mesh(), params);
  },
  /** Walking skeleton. params: step. colors: bone. */
  skeleton({ step = 0, colors = {} }) {
    const m = mesh();
    const bone = colors.bone ?? '#e6e0c8';
    figure(m, { step, skin: bone, top: bone, legs: bone, limb: 0.14, swing: 36 });
    m.box(-0.14, -0.24, 26, -0.04, -0.21, 28, '#1e1e28');
    m.box(0.04, -0.24, 26, 0.14, -0.21, 28, '#1e1e28');
    return m;
  },
};

export const SHAPE_NAMES = Object.keys(SHAPES);

/** The triangles of a built-in shape: { verts: [[x, y, z, r, g, b]], faces: [[a, b, c]] } (z in sixteenths). */
export function shapeMesh(shape, params = {}) {
  if (!SHAPES[shape]) throw new Error(`shapeMesh: unknown shape "${shape}". Known: ${SHAPE_NAMES.join(', ')}`);
  const m = SHAPES[shape](params);
  return { verts: m.verts, faces: m.faces, roles: shapeRoles(shape, params, m) };
}

/**
 * Which part every vertex belongs to, named by the `colors` key the shape used for it ("roof",
 * "wall", "leaf", ...); '' where a colour was fixed. Found by building the shape a second time
 * with marker colours, so shapes need no extra bookkeeping. null if the two builds do not line up.
 */
function shapeRoles(shape, params, real) {
  const names = [];
  const marker = (i) => '#' + (i + 1).toString(16).padStart(6, '0');
  const probe = new Proxy({}, { get: (_, key) => { if (typeof key !== 'string') return undefined; let i = names.indexOf(key); if (i < 0) i = names.push(key) - 1; return marker(i); } });
  let m;
  try { m = SHAPES[shape]({ ...params, colors: probe }); } catch { return null; }
  if (m.verts.length !== real.verts.length) return null;
  const byMarker = new Map(names.map((name, i) => [marker(i), name]));
  return m.verts.map((v, i) => {
    if (m.tones[i] !== undefined) return byMarker.get(m.tones[i]) ?? '';
    // a vertex the shape pushed itself still carries the marker as its colour
    return v[3] === 0 && v[4] === 0 && v[5] >= 1 && v[5] <= names.length ? names[v[5] - 1] : '';
  });
}

/**
 * Size of a built-in shape in ground units (metres) before the object's scale: width (x), depth (y)
 * and height, plus `people`: its height in standing adults.
 */
export function shapeSize(shape, params = {}) {
  const m = shapeMesh(shape, params);
  // loops, not Math.max(...): an imported model can have more vertices than a call takes arguments
  const lo = [Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of m.verts) { for (let k = 0; k < 2; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; } if (v[2] > hi[2]) hi[2] = v[2]; }
  const span = (k) => hi[k] - lo[k];
  const r = (v) => Math.round(v * 100) / 100;
  const height = hi[2] / ZS;
  return { width: r(span(0)), depth: r(span(1)), height: r(height), people: r(height / HUMAN_HEIGHT) };
}

/** Split triangles (always at the middle of their longest edge) until no edge is longer than maxEdge ground units. */
function splitLong(m, maxEdge) {
  const verts = m.verts.slice();
  const mid = new Map();
  const len = (a, b) => Math.hypot(verts[a][0] - verts[b][0], verts[a][1] - verts[b][1], (verts[a][2] - verts[b][2]) / 16);
  const middle = (a, b) => {
    const k = a < b ? a + ':' + b : b + ':' + a;
    if (!mid.has(k)) {
      const p = verts[a]; const q = verts[b];
      mid.set(k, verts.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, Math.round((p[3] + q[3]) / 2), Math.round((p[4] + q[4]) / 2), Math.round((p[5] + q[5]) / 2)]) - 1);
    }
    return mid.get(k);
  };
  const faces = [];
  const todo = m.faces.slice().reverse(); // a stack, so faces keep their order
  while (todo.length) {
    const [a, b, c] = todo.pop();
    const l = [len(a, b), len(b, c), len(c, a)];
    const big = Math.max(...l);
    if (big <= maxEdge) { faces.push([a, b, c]); continue; }
    // keep the winding: rotate so the longest edge is a-b
    const [p, q, r] = l[0] === big ? [a, b, c] : l[1] === big ? [b, c, a] : [c, a, b];
    const x = middle(p, q);
    todo.push([x, q, r], [p, x, r]);
  }
  return { verts, faces };
}

/**
 * PLY text (the mesh format Asciicker loads) for a built-in shape. With maxEdge (ground units) large
 * faces are split into smaller triangles, which the renderer needs at high zoom.
 */
export function shapePly(shape, params = {}, maxEdge = Infinity) {
  if (!SHAPES[shape]) throw new Error(`shapePly: unknown shape "${shape}". Known: ${SHAPE_NAMES.join(', ')}`);
  let m = SHAPES[shape](params);
  if (maxEdge < Infinity) m = splitLong(m, maxEdge);
  const f = (n) => (Math.round(n * 1000) / 1000).toString();
  return `ply\nformat ascii 1.0\ncomment generated by Kiln\nelement vertex ${m.verts.length}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nproperty uchar alpha\nelement face ${m.faces.length}\nproperty list uchar uint vertex_indices\nend_header\n`
    + m.verts.map((v) => `${f(v[0])} ${f(v[1])} ${f(v[2])} ${v[3]} ${v[4]} ${v[5]} 255`).join('\n') + '\n'
    + m.faces.map((t) => `3 ${t.join(' ')}`).join('\n') + '\n';
}

// Convex outline of a set of [x, y] points (monotone chain); null when they have no area.
function hull(points) {
  const p = [...new Map(points.map((q) => [q[0].toFixed(4) + ',' + q[1].toFixed(4), q])).values()].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  if (p.length < 3) return null;
  const cross = (o, u, v) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 1e-9) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  const out = [...half(p), ...half(p.slice().reverse())];
  return out.length >= 3 ? out : null;
}

/**
 * Ground outline of a built-in shape, for collision: the parts of the mesh that reach down to
 * walking height, each as a convex polygon. Roofs, tree tops and other overhangs are left out,
 * and a gate keeps its opening (two posts, not one block). Raise maxZ to the height of the
 * characters (see view.spriteExtent) to also keep them from poking through eaves and tree tops.
 * @param {string} shape  One of SHAPE_NAMES.
 * @param {object} [params]  The same params the scene gives the shape (length, seed, ...).
 * @param {{maxZ?: number}} [opts]  Parts that start above this height are ignored (default 12, in
 *   sixteenths of a ground unit, so 0.75 units: about knee height of a villager).
 * @returns {Array<Array<[number, number]>>}  Polygons in the shape's own ground units, centred on
 *   its origin, before the object's yaw and scale.
 */
export function shapeFootprint(shape, params = {}, opts = {}) {
  if (!SHAPES[shape]) throw new Error(`shapeFootprint: unknown shape "${shape}". Known: ${SHAPE_NAMES.join(', ')}`);
  const maxZ = opts.maxZ ?? 12;
  if (!(maxZ >= 0)) throw new Error(`shapeFootprint: maxZ must be a number >= 0, got ${opts.maxZ}`);
  const m = SHAPES[shape](params);
  const out = [];
  for (const [start, end] of m.parts) {
    const low = m.verts.slice(start, end).filter((v) => v[2] <= maxZ).map((v) => [v[0], v[1]]);
    if (low.length === 0) continue;
    // edges that cross maxZ: add the point where they cross, so a part that widens (or narrows)
    // on its way up is outlined as wide as it really is below that height
    for (const face of m.faces) {
      if (face[0] < start || face[0] >= end) continue;
      for (let i = 0; i < 3; i++) {
        const a = m.verts[face[i]]; const b = m.verts[face[(i + 1) % 3]];
        if ((a[2] <= maxZ) === (b[2] <= maxZ)) continue;
        const t = (maxZ - a[2]) / (b[2] - a[2]);
        low.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    // round first and outline after: rounding an outline afterwards can leave tiny dents in small
    // parts (a goblin's ankle), and the collision engine only takes convex polygons
    const outline = hull(low.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]));
    if (!outline) continue;
    let area = 0;
    outline.forEach((p, i) => { const q = outline[(i + 1) % outline.length]; area += p[0] * q[1] - q[0] * p[1]; });
    if (Math.abs(area) / 2 >= 1e-5) out.push(outline); // slivers thinner than a hair block nothing
  }
  return out;
}
