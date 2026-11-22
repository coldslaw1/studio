// Kiln's own triangle rasteriser for 3D scenes. It draws the same scene the Asciicker renderer is
// given (the hill function and the built-in shapes) with the camera Asciicker was measured to use,
// and records for every picture cell which triangle is seen and at what height. That is what lets
// Kiln light a scene with exact face directions and materials, cast shadows from the real geometry
// (the same rasteriser looks from the light), and draw pictures finer than the renderer can.
// All of it is Kiln's own code; nothing here comes from Asciicker. Pure and browser-safe.
import { terrainSurface, terrainHeight } from './scene3d.js';
import { shapeMesh } from './scene-shapes.js';

export const ZS = 16; // height units per ground unit

/** Part names (the keys of a shape's `colors`) in a fixed order; a triangle stores the index. 0 = unknown. */
export const ROLES = ['', 'ground'];
const roleId = (name) => { let i = ROLES.indexOf(name); if (i < 0) i = ROLES.push(name) - 1; return i; };

/**
 * Hill heights sampled on a ground grid, with smooth surface directions, so a picture cell can look
 * both up without evaluating the hill function again.
 * @param {object|null} terrain  scene.terrain
 * @param {number} perUnit       Samples per ground unit.
 * @returns {{x0:number, y0:number, g:number, w:number, h:number, H:Float32Array, NX:Float32Array, NY:Float32Array, NZ:Float32Array}|null}
 */
export function terrainField(terrain, perUnit = 4) {
  if (!terrain) return null;
  const [px, py] = terrain.patches ?? [0, 0];
  const g = Math.min(8, Math.max(2, Math.round(perUnit)));
  const w = px * 8 * g + 1; const h = py * 8 * g + 1;
  const H = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = terrainSurface(terrain, i / g, j / g);
  const NX = new Float32Array(w * h); const NY = new Float32Array(w * h); const NZ = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const i0 = Math.max(0, i - 1); const i1 = Math.min(w - 1, i + 1); const j0 = Math.max(0, j - 1); const j1 = Math.min(h - 1, j + 1);
      const sx = (H[j * w + i1] - H[j * w + i0]) / ((i1 - i0) / g * ZS);
      const sy = (H[j1 * w + i] - H[j0 * w + i]) / ((j1 - j0) / g * ZS);
      const l = Math.hypot(sx, sy, 1);
      NX[j * w + i] = -sx / l; NY[j * w + i] = -sy / l; NZ[j * w + i] = 1 / l;
    }
  }
  return { x0: 0, y0: 0, g, w, h, H, NX, NY, NZ };
}

/** Bilinear lookup in one array of a terrainField (clamped at the edges). */
export function fieldAt(f, A, x, y) {
  const fi = Math.min(f.w - 1.001, Math.max(0, (x - f.x0) * f.g)); const fj = Math.min(f.h - 1.001, Math.max(0, (y - f.y0) * f.g));
  const i = fi | 0; const j = fj | 0; const u = fi - i; const v = fj - j; const k = j * f.w + i;
  return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + f.w] * (1 - u) + A[k + f.w + 1] * u) * v;
}

/**
 * Every triangle of a scene (already at one animation frame): the ground first, then each object.
 * Positions are x, y in ground units and z in height units.
 * @param {object} scene
 * @param {{field?: object|null, objects?: boolean, ground?: boolean, groundSquare?: number}} [opts]  groundSquare: side of
 *   the ground mesh's squares in ground units (default 0.5).
 * @returns {{count:number, ground:number, P:Float32Array, N:Float32Array, C:Uint8Array, role:Uint8Array, obj:Int32Array, part:Int32Array, bounds:number[]}}
 *   P: 9 numbers per triangle. N: unit direction (true proportions) per triangle. C: r, g, b per
 *   triangle. role: index into ROLES. obj: 0 for ground, object index + 1 otherwise. `ground` = how
 *   many of the first triangles are ground. bounds: [x0, y0, z0, x1, y1, z1].
 */
export function sceneGeometry(scene, opts = {}) {
  const P = []; const C = []; const role = []; const obj = [];
  const base = [0]; // height of the foot of each object (index = obj)
  const field = opts.field === undefined ? terrainField(scene.terrain, 2) : opts.field;
  let ground = 0;
  if (field && opts.ground !== false) {
    // the ground as a mesh of small squares (half a unit unless asked otherwise), heights from the hill function
    const step = Math.max(1, Math.round(field.g * (opts.groundSquare ?? 0.5)));
    for (let j = 0; j < field.h - 1; j += step) {
      for (let i = 0; i < field.w - 1; i += step) {
        const i1 = Math.min(field.w - 1, i + step); const j1 = Math.min(field.h - 1, j + step); // the last square may be narrower
        const x0 = i / field.g; const y0 = j / field.g; const x1 = i1 / field.g; const y1 = j1 / field.g;
        const a = field.H[j * field.w + i]; const b = field.H[j * field.w + i1];
        const c = field.H[j1 * field.w + i1]; const d = field.H[j1 * field.w + i];
        P.push(x0, y0, a, x1, y0, b, x1, y1, c, x0, y0, a, x1, y1, c, x0, y1, d);
        C.push(0, 0, 0, 0, 0, 0); role.push(1, 1); obj.push(0, 0);
        ground += 2;
      }
    }
  }
  if (opts.objects !== false) {
    const cache = new Map();
    (scene.objects ?? []).forEach((o, index) => {
      const key = JSON.stringify([o.shape, o.params ?? {}]);
      if (!cache.has(key)) cache.set(key, shapeMesh(o.shape, o.params ?? {}));
      const m = cache.get(key);
      const sc = o.scale ?? 1;
      const c = Math.cos((o.yaw ?? 0) * Math.PI / 180) * sc; const sn = Math.sin((o.yaw ?? 0) * Math.PI / 180) * sc;
      const z0 = terrainHeight(scene.terrain, o.at[0], o.at[1]) + (o.lift ?? 0);
      base[index + 1] = z0;
      const pts = m.verts.map((v) => [c * v[0] - sn * v[1] + o.at[0], sn * v[0] + c * v[1] + o.at[1], v[2] * sc + z0]);
      for (const f of m.faces) {
        for (const k of f) P.push(pts[k][0], pts[k][1], pts[k][2]);
        const v = m.verts[f[0]];
        C.push(v[3], v[4], v[5]);
        role.push(roleId(m.roles?.[f[0]] ?? ''));
        obj.push(index + 1);
      }
    });
  }
  const count = role.length;
  const Pa = Float32Array.from(P);
  const N = new Float32Array(count * 3);
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const e1x = Pa[o + 3] - Pa[o]; const e1y = Pa[o + 4] - Pa[o + 1]; const e1z = (Pa[o + 5] - Pa[o + 2]) / ZS;
    const e2x = Pa[o + 6] - Pa[o]; const e2y = Pa[o + 7] - Pa[o + 1]; const e2z = (Pa[o + 8] - Pa[o + 2]) / ZS;
    const nx = e1y * e2z - e1z * e2y; const ny = e1z * e2x - e1x * e2z; const nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
    for (let k = 0; k < 9; k++) { const a = k % 3; if (Pa[o + k] < bounds[a]) bounds[a] = Pa[o + k]; if (Pa[o + k] > bounds[a + 3]) bounds[a + 3] = Pa[o + k]; }
  }
  return { count, ground, P: Pa, N, C: Uint8Array.from(C), role: Uint8Array.from(role), obj: Int32Array.from(obj), base: Float32Array.from(base, (v) => v ?? 0), bounds };
}

/**
 * A straight-line camera: picture column u, row v and nearness d of a point are each
 * m[0] + m[1]*x + m[2]*y + m[3]*z. Larger d = nearer the eye.
 * @typedef {{u:number[], v:number[], d:number[]}} RasterMap
 */

/**
 * The camera of a measured projection (see measureProjection), for a picture `px` times finer
 * than the character grid. Nearness is the same number depthGrid uses.
 * @returns {RasterMap}
 */
export function cameraMap(projection, px = 1) {
  const [ox, oy, oz] = projection.origin;
  const line = (m) => [(m[0] - m[1] * ox - m[2] * oy - m[3] * oz) * px, m[1] * px, m[2] * px, m[3] * px];
  const r = projection.row;
  return { u: line(projection.col), v: line(r), d: [r[0] - r[1] * ox - r[2] * oy, r[1], r[2], 0] };
}

/**
 * A camera looking along a light: `dir` points towards the light. The picture is fitted around
 * `bounds` ([x0, y0, z0, x1, y1, z1]) at `size` pixels on its longer side.
 * @returns {RasterMap & {width:number, height:number, scale:number}}  scale = pixels per ground unit.
 */
export function lightMap(dir, bounds, size) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const L = [dir[0] / l, dir[1] / l, dir[2] / l];
  // two directions across the light, in true proportions
  let ax = [-L[1], L[0], 0];
  if (Math.hypot(ax[0], ax[1]) < 1e-6) ax = [1, 0, 0];
  const al = Math.hypot(...ax); ax = ax.map((v) => v / al);
  const ay = [L[1] * ax[2] - L[2] * ax[1], L[2] * ax[0] - L[0] * ax[2], L[0] * ax[1] - L[1] * ax[0]];
  const lo = [Infinity, Infinity]; const hi = [-Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const p = [bounds[k & 1 ? 3 : 0], bounds[k & 2 ? 4 : 1], bounds[k & 4 ? 5 : 2] / ZS];
    const u = p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2]; const v = p[0] * ay[0] + p[1] * ay[1] + p[2] * ay[2];
    lo[0] = Math.min(lo[0], u); hi[0] = Math.max(hi[0], u); lo[1] = Math.min(lo[1], v); hi[1] = Math.max(hi[1], v);
  }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-6);
  const scale = (size - 4) / span;
  return {
    u: [2 - lo[0] * scale, ax[0] * scale, ax[1] * scale, ax[2] * scale / ZS],
    v: [2 - lo[1] * scale, ay[0] * scale, ay[1] * scale, ay[2] * scale / ZS],
    d: [0, L[0], L[1], L[2] / ZS], // distance towards the light, in ground units
    width: Math.max(1, Math.ceil((hi[0] - lo[0]) * scale) + 4),
    height: Math.max(1, Math.ceil((hi[1] - lo[1]) * scale) + 4),
    scale,
  };
}

/**
 * Draw triangles into a width x height picture, keeping the nearest at every pixel centre.
 * @param {{count:number, P:Float32Array}} geo
 * @param {RasterMap} map
 * @param {number} width
 * @param {number} height
 * @param {{from?:number, to?:number, depthOnly?:boolean, into?:object}} [opts]  from/to: triangle range.
 *   into: a result of an earlier call to draw on top of.
 * @returns {{width:number, height:number, tri:Int32Array|null, z:Float32Array|null, depth:Float32Array}}
 *   tri: triangle index or -1. z: height of the surface. depth: nearness (-Infinity where empty).
 */
export function rasterise(geo, map, width, height, opts = {}) {
  const n = width * height;
  const out = opts.into ?? {
    width, height,
    tri: opts.depthOnly ? null : new Int32Array(n).fill(-1),
    z: opts.depthOnly ? null : new Float32Array(n),
    depth: new Float32Array(n).fill(-Infinity),
  };
  const { tri, z, depth } = out;
  const { u, v, d } = map;
  const P = geo.P;
  const to = opts.to ?? geo.count;
  for (let t = opts.from ?? 0; t < to; t++) {
    const o = t * 9;
    const ax = P[o]; const ay = P[o + 1]; const az = P[o + 2];
    const bx = P[o + 3]; const by = P[o + 4]; const bz = P[o + 5];
    const cx = P[o + 6]; const cy = P[o + 7]; const cz = P[o + 8];
    // pixel-centre coordinates
    const x0 = u[0] + u[1] * ax + u[2] * ay + u[3] * az - 0.5; const y0 = v[0] + v[1] * ax + v[2] * ay + v[3] * az - 0.5;
    const x1 = u[0] + u[1] * bx + u[2] * by + u[3] * bz - 0.5; const y1 = v[0] + v[1] * bx + v[2] * by + v[3] * bz - 0.5;
    const x2 = u[0] + u[1] * cx + u[2] * cy + u[3] * cz - 0.5; const y2 = v[0] + v[1] * cx + v[2] * cy + v[3] * cz - 0.5;
    const minX = Math.max(0, Math.ceil(Math.min(x0, x1, x2))); const maxX = Math.min(width - 1, Math.floor(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.ceil(Math.min(y0, y1, y2))); const maxY = Math.min(height - 1, Math.floor(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) continue;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const inv = 1 / area;
    const d0 = d[0] + d[1] * ax + d[2] * ay + d[3] * az; const d1 = d[0] + d[1] * bx + d[2] * by + d[3] * bz; const d2 = d[0] + d[1] * cx + d[2] * cy + d[3] * cz;
    // weights of corners b and c step by these amounts per pixel
    const w1x = (y2 - y0) * inv; const w1y = -(x2 - x0) * inv;
    const w2x = -(y1 - y0) * inv; const w2y = (x1 - x0) * inv;
    const e = 1e-6;
    for (let y = minY; y <= maxY; y++) {
      let w1 = (minX - x0) * w1x + (y - y0) * w1y;
      let w2 = (minX - x0) * w2x + (y - y0) * w2y;
      let k = y * width + minX;
      for (let x = minX; x <= maxX; x++, k++, w1 += w1x, w2 += w2x) {
        if (w1 < -e || w2 < -e || w1 + w2 > 1 + e) continue;
        const dd = d0 + (d1 - d0) * w1 + (d2 - d0) * w2;
        if (dd <= depth[k]) continue;
        depth[k] = dd;
        if (tri) { tri[k] = t; z[k] = az + (bz - az) * w1 + (cz - az) * w2; }
      }
    }
  }
  return out;
}
