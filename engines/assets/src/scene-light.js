// Kiln's lighting for 3D scenes, worked out from the real geometry. scene-raster.js says which
// triangle is seen at every sample of the picture; this file turns that into light:
//   - sun shadows from a picture of the scene taken along the light (a shadow map), with edges that
//     are sharp where a shadow starts and soft further from what casts it,
//   - sky light that is blocked in corners, under eaves and between trees (the scene is looked at
//     from many directions of the sky and each sample counts how many of them it can see).
// A "sample" is one character cell, or one pixel when Kiln draws the picture itself. Pure, browser-safe.
import { ZS, ROLES, sceneGeometry, terrainField, fieldAt, cameraMap, lightMap, rasterise } from './scene-raster.js';

/** Both directions of a measured projection at `px` samples per character. */
export function sampleProjection(projection, px = 1) {
  const [ox, oy, oz] = projection.origin;
  const [c0, ax, ay, az] = projection.col;
  const [r0, bx, by, bz] = projection.row;
  const det = ax * by - ay * bx;
  const A = [ax, ay, az * ZS]; const B = [bx, by, bz * ZS];
  const v = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
  const l = Math.hypot(...v) * (v[2] < 0 ? -1 : 1) || 1;
  return {
    px, ox, oy, oz, c0, r0, ax, ay, az, bx, by, bz, det,
    /** Samples per ground unit. */
    perUnit: Math.max(Math.hypot(ax, bx), Math.hypot(ay, by)) * px,
    /** Unit direction towards the camera (true proportions). */
    toCamera: [v[0] / l, v[1] / l, v[2] / l],
  };
}

/**
 * Everything about a scene's shape that lighting needs, for one animation frame: its triangles, the
 * sampled hills and the triangle seen at every sample.
 * @param {object} scene       Already at one frame (see sceneAtFrame).
 * @param {object} projection  From measureProjection, for the character grid.
 * @param {{cols:number, rows:number, px?:number}} size  px = samples per character each way.
 */
export function prepareScene(scene, projection, size) {
  const px = size.px ?? 1;
  const S = sampleProjection(projection, px);
  const field = terrainField(scene.terrain ?? null, S.perUnit / 2);
  // coarse pictures get by with a coarser ground mesh
  const geo = sceneGeometry(scene, { field, groundSquare: S.perUnit >= 8 ? 0.5 : 1 });
  const w = size.cols * px; const h = size.rows * px;
  const gb = rasterise(geo, cameraMap(projection, px), w, h);
  const water = typeof scene.water === 'number' ? scene.water : null;
  return { scene, projection, S, field, geo, w, h, px, cols: size.cols, rows: size.rows, tri: gb.tri, z: gb.z, water, covered: null, cache: {} };
}

/**
 * For a character grid drawn by the Asciicker renderer: make the prepared samples agree with what
 * each cell really shows. Where Kiln's triangle is at a different height than the cell (edges, where
 * the two renderers round differently), a neighbouring triangle at the right height is used, and
 * failing that the cell is lit as a level surface at the renderer's height.
 */
export function reconcile(prep, grid, tolerance = 6) {
  const { tri, z, w, h } = prep;
  const n = w * h;
  const covered = new Uint8Array(n);
  const tri2 = tri.slice(); const z2 = z.slice();
  const near = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1, -2, 2, -2 * w, 2 * w];
  for (let i = 0; i < n; i++) {
    covered[i] = grid.hit[i] ? 1 : 0;
    const ha = grid.height[i];
    if (ha === null || ha === undefined) { tri2[i] = -1; continue; }
    if (tri[i] >= 0 && Math.abs(z[i] - ha) <= tolerance) continue;
    let found = -2;
    const c = i % w;
    for (const d of near) {
      const k = i + d;
      if (k < 0 || k >= n || Math.abs((k % w) - c) > 2) continue;
      if (tri[k] >= 0 && Math.abs(z[k] - ha) <= tolerance) { found = tri[k]; break; }
    }
    tri2[i] = found; z2[i] = ha;
  }
  prep.tri = tri2; prep.z = z2; prep.covered = covered;
  return prep;
}

// what the sample under inspection is: filled in by `look`
export const sample = { kind: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, tri: -1, floor: 0 };

const s = sample;
/** A function that inspects sample i and fills `sample`: kind 0 nothing, 1 surface, 2 water. */
export function looker(prep) {
  const { S, field, geo, tri, z, w, water, covered } = prep;
  const { px, ox, oy, oz, c0, r0, az, bz, ax, ay, bx, by, det } = S;
  const N = geo.N; const cam = S.toCamera;
  return (i) => {
    const t = tri[i];
    let zz;
    s.tri = t;
    if (t === -1) {
      if (water === null || (covered && !covered[i])) { s.kind = 0; return 0; }
      zz = water; s.kind = 2;
    } else {
      zz = z[i];
      if (water !== null && zz <= water) { zz = water; s.kind = 2; } else s.kind = 1;
    }
    const cx = i % w; const cy = (i - cx) / w;
    const u = (cx + 0.5) / px - c0 - az * (zz - oz); const v = (cy + 0.5) / px - r0 - bz * (zz - oz);
    const x = ox + (u * by - ay * v) / det; const y = oy + (ax * v - u * bx) / det;
    s.x = x; s.y = y; s.z = zz;
    if (s.kind === 2) {
      s.nx = 0; s.ny = 0; s.nz = 1;
      s.floor = field ? fieldAt(field, field.H, x, y) : -1e6; // the sea bed under this spot
    } else if (t >= 0 && t < geo.ground) {
      s.nx = fieldAt(field, field.NX, x, y); s.ny = fieldAt(field, field.NY, x, y); s.nz = fieldAt(field, field.NZ, x, y);
    } else if (t >= 0) {
      let nx = N[t * 3]; let ny = N[t * 3 + 1]; let nz = N[t * 3 + 2];
      if (nx * cam[0] + ny * cam[1] + nz * cam[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      s.nx = nx; s.ny = ny; s.nz = nz;
    } else { s.nx = 0; s.ny = 0; s.nz = 1; }
    return s.kind;
  };
}

const POISSON = [[-0.94, -0.4], [0.95, -0.77], [-0.09, -0.93], [0.34, 0.29], [-0.92, 0.46], [-0.82, -0.88], [-0.38, 0.28], [0.97, 0.19], [0.44, -0.98], [0.54, 0.94], [-0.28, -0.42], [0.79, -0.24], [-0.24, 0.99], [-0.81, 0.91], [0.2, -0.41], [0.14, 0.79]];

/**
 * How much of the sun reaches every sample: 255 = all of it, 0 = none.
 * @param {object} prep
 * @param {number[]} L       Unit direction towards the light.
 * @param {number} softness  0 = hard edges; 1 = edges widen with distance from what casts the shadow.
 * @returns {Uint8Array}
 */
export function sunVisibility(prep, L, softness = 1) {
  const key = 'sun:' + L.map((v) => v.toFixed(4)).join(',') + ':' + softness;
  if (prep.cache[key]) return prep.cache[key];
  const { geo, S, w, h } = prep;
  const n = w * h;
  const out = new Uint8Array(n).fill(255);
  if (!(L[2] > 0.02) || geo.count === 0) return (prep.cache[key] = out);
  const b = geo.bounds;
  const span = Math.hypot(b[3] - b[0], b[4] - b[1], (b[5] - b[2]) / ZS);
  const size = Math.round(Math.min(4096, Math.max(512, span * Math.max(S.perUnit, 6))));
  const map = lightMap(L, b, size);
  const D = rasterise(geo, map, map.width, map.height, { depthOnly: true }).depth;
  const { u, v, d, width: mw, height: mh, scale } = map;
  const look = looker(prep);
  const bias = 0.04 + 1.5 / scale;   // ground units
  const push = 0.03 + 1.2 / scale;   // samples are lifted off their own surface by this much
  const reach = Math.max(1.5, 0.45 * softness * scale); // widest shadow edge, in map pixels
  const gapAt = (fu, fv, dd) => {
    const iu = fu | 0; const iv = fv | 0;
    if (iu < 0 || iv < 0 || iu >= mw || iv >= mh) return -1;
    return D[iv * mw + iu] - dd;
  };
  for (let i = 0; i < n; i++) {
    if (!look(i)) continue;
    const x = s.x + s.nx * push; const y = s.y + s.ny * push; const z = s.z + s.nz * push * ZS;
    const fu = u[0] + u[1] * x + u[2] * y + u[3] * z; const fv = v[0] + v[1] * x + v[2] * y + v[3] * z;
    const dd = d[1] * x + d[2] * y + d[3] * z + bias;
    // a quick look around: all open or all blocked settles it
    let blocked = 0; let gaps = 0;
    for (let k = 0; k < 5; k++) {
      const g = gapAt(fu + (k === 1 ? reach : k === 2 ? -reach : 0), fv + (k === 3 ? reach : k === 4 ? -reach : 0), dd);
      if (g > 0) { blocked++; gaps += g; }
    }
    if (blocked === 0) continue;
    if (blocked === 5) { out[i] = 0; continue; }
    // the edge is as wide as the caster is far away
    const r = softness > 0 ? Math.min(reach, Math.max(1.2, gaps / blocked * 0.09 * softness * scale)) : 1.2;
    const cx = i % w; const cy = (i - cx) / w;
    const a = 6.2832 * ((52.9829189 * ((0.06711056 * cx + 0.00583715 * cy) % 1)) % 1);
    const ca = Math.cos(a) * r; const sa = Math.sin(a) * r;
    let open = 0;
    for (const p of POISSON) if (gapAt(fu + p[0] * ca - p[1] * sa, fv + p[0] * sa + p[1] * ca, dd) <= 0) open++;
    out[i] = Math.round(open / POISSON.length * 255);
  }
  return (prep.cache[key] = out);
}

/**
 * How much of the sky every sample can see: 255 = open ground, low numbers in corners, under
 * eaves and deep between things. Worked out on a coarser grid for big pictures and smoothed back up.
 * @returns {Uint8Array}
 */
const NEAR = 5; const RANGE = 14; // ground units
export function skyVisibility(prep, directions = prep.w * prep.h < 300000 ? 16 : 24) {
  const key = 'sky:' + directions;
  if (prep.cache[key]) return prep.cache[key];
  const { geo, S, w, h } = prep;
  const n = w * h;
  const out = new Uint8Array(n).fill(255);
  if (geo.count === 0) return (prep.cache[key] = out);
  // Sky light changes slowly from place to place, so about 60000 samples are enough for any picture;
  // the rest get theirs from the samples around them on the same surface.
  const step = Math.max(1, Math.round(Math.sqrt(n / 60000)));
  const cw = Math.ceil(w / step); const ch = Math.ceil(h / step);
  const look = looker(prep);
  // the coarse samples, looked at once
  const cn = cw * ch;
  const X = new Float32Array(cn); const Y = new Float32Array(cn); const Z = new Float32Array(cn);
  const NX = new Float32Array(cn); const NY = new Float32Array(cn); const NZ = new Float32Array(cn);
  const kind = new Uint8Array(cn);
  const at = (cx, cy) => Math.min(h - 1, cy * step + (step >> 1)) * w + Math.min(w - 1, cx * step + (step >> 1));
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const k = cy * cw + cx;
    kind[k] = look(at(cx, cy));
    X[k] = s.x; Y[k] = s.y; Z[k] = s.z; NX[k] = s.nx; NY[k] = s.ny; NZ[k] = s.nz;
  }
  const seen = new Float32Array(cn); const total = new Float32Array(cn);
  // the sky is looked at through small, soft pictures, so the ground can be a coarse mesh there
  const coarse = prep.cache.skyGeo ??= (geo.ground > 20000 ? sceneGeometry(prep.scene, { field: prep.field, groundSquare: 2 }) : geo);
  const b = geo.bounds;
  const span = Math.hypot(b[3] - b[0], b[4] - b[1], (b[5] - b[2]) / ZS);
  const size = Math.round(Math.min(1024, Math.max(256, span * Math.min(S.perUnit / step * 0.75, 9))));
  for (let j = 0; j < directions; j++) {
    const up = 1 - (j + 0.5) / directions * 0.85;
    const flat = Math.sqrt(1 - up * up); const a = j * 2.399963;
    const dir = [flat * Math.cos(a), flat * Math.sin(a), up];
    const map = lightMap(dir, b, size);
    const D = rasterise(coarse, map, map.width, map.height, { depthOnly: true }).depth;
    const { u, v, d, width: mw, height: mh, scale } = map;
    const bias = 0.05 + 1.6 / scale; const push = 0.05 + 1.6 / scale;
    for (let k = 0; k < cn; k++) {
      if (!kind[k]) continue;
      const wt = NX[k] * dir[0] + NY[k] * dir[1] + NZ[k] * dir[2];
      if (wt <= 0.02) continue;
      total[k] += wt;
      const x = X[k] + NX[k] * push; const y = Y[k] + NY[k] * push; const z = Z[k] + NZ[k] * push * ZS;
      const iu = (u[0] + u[1] * x + u[2] * y + u[3] * z) | 0; const iv = (v[0] + v[1] * x + v[2] * y + v[3] * z) | 0;
      if (iu < 0 || iv < 0 || iu >= mw || iv >= mh) { seen[k] += wt; continue; }
      // Things count less the further off they are, so a far tower does not draw a faint streak.
      // (The distance is to the top of whatever is in the way, hence the generous range.)
      const gap = D[iv * mw + iu] - (d[1] * x + d[2] * y + d[3] * z + bias);
      seen[k] += gap <= 0 || gap >= RANGE ? wt : gap > NEAR ? wt * (gap - NEAR) / (RANGE - NEAR) : 0;
    }
  }
  let vis = new Float32Array(cn);
  for (let k = 0; k < cn; k++) vis[k] = total[k] > 0 ? seen[k] / total[k] : 1;
  // A blur within each surface takes out the grain of looking from a fixed set of directions.
  // It reaches about a third of a ground unit, however fine the picture is.
  const passes = Math.min(6, Math.max(1, Math.round(S.perUnit / step / 4)));
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(cn);
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
      const k = cy * cw + cx;
      if (!kind[k]) continue;
      let sum = vis[k] * 2; let wsum = 2;
      for (let m = 0; m < 4; m++) {
        const x = cx + (m === 0 ? 1 : m === 1 ? -1 : 0); const y = cy + (m === 2 ? 1 : m === 3 ? -1 : 0);
        if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
        const q = y * cw + x;
        if (!kind[q] || NX[q] * NX[k] + NY[q] * NY[k] + NZ[q] * NZ[k] < 0.8) continue;
        if (Math.abs((X[q] - X[k]) * NX[k] + (Y[q] - Y[k]) * NY[k] + (Z[q] - Z[k]) / ZS * NZ[k]) > 0.3) continue; // another surface
        sum += vis[q]; wsum += 1;
      }
      next[k] = sum / wsum;
    }
    vis = next;
  }
  if (step === 1) {
    for (let k = 0; k < cn; k++) if (kind[k]) out[k] = Math.round(vis[k] * 255);
    return (prep.cache[key] = out);
  }
  // back to full size: each sample blends the coarse values around it that lie on the same surface
  for (let i = 0; i < n; i++) {
    if (!look(i)) continue;
    const cx = i % w; const cy = (i - cx) / w;
    const fx = (cx - (step >> 1)) / step; const fy = (cy - (step >> 1)) / step;
    const x0 = Math.floor(fx); const y0 = Math.floor(fy);
    let sum = 0; let wsum = 0; let nearest = 1; let best = -1;
    for (let m = 0; m < 4; m++) {
      const x = Math.min(cw - 1, Math.max(0, x0 + (m & 1))); const y = Math.min(ch - 1, Math.max(0, y0 + (m >> 1)));
      const q = y * cw + x;
      if (!kind[q]) continue;
      const wb = (m & 1 ? fx - x0 : 1 - (fx - x0)) * (m >> 1 ? fy - y0 : 1 - (fy - y0)) + 0.01;
      if (wb > best) { best = wb; nearest = vis[q]; }
      const off = (X[q] - s.x) * s.nx + (Y[q] - s.y) * s.ny + (Z[q] - s.z) / ZS * s.nz; // distance from this sample's own surface
      const like = NX[q] * s.nx + NY[q] * s.ny + NZ[q] * s.nz;
      const wt = wb * Math.max(0, like) ** 4 / (1 + (off * 6) ** 2);
      sum += vis[q] * wt; wsum += wt;
    }
    out[i] = Math.round((wsum > 0.02 ? sum / wsum : nearest) * 255);
  }
  return (prep.cache[key] = out);
}

export { ROLES };
