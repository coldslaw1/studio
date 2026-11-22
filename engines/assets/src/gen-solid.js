// Generated assets are lists of simple solids in METRES (x right, y back, z up; the asset stands
// on z = 0, is centred on the origin and faces -y). This file measures such a list and turns it
// into the triangle mesh the scene renderer uses.
//
// Solids: { p: 'box', min: [x, y, z], max: [x, y, z], c }
//         { p: 'pyramid', min, max, c }            base at min z, point at max z
//         { p: 'gable', min, max, c, along? }      roof: eaves at min z, ridge at max z, along 'x' (default) or 'y'
//         { p: 'prism', at: [x, y], r, r1?, z: [z0, z1], n?, c }   upright; r1 = 0 makes a cone
//         { p: 'limb', a: [x, y, z], b: [x, y, z], r: [r0, r1], c }  tapered rod between two points
//         { p: 'ball', at: [x, y, z], r: [rx, ry, rz], c }
// Any solid may carry turn: { pivot: [x, y, z], rx?, rz? } (degrees). `c` is a colour name looked up
// in the asset's palette (or a hex string).

const ZS = 16; // the renderer's height steps per metre
const RAD = Math.PI / 180;

function turned(p, turn) {
  if (!turn) return p;
  let [dx, dy, dz] = [p[0] - turn.pivot[0], p[1] - turn.pivot[1], p[2] - turn.pivot[2]];
  const a = (turn.rx ?? 0) * RAD;
  [dy, dz] = [dy * Math.cos(a) - dz * Math.sin(a), dy * Math.sin(a) + dz * Math.cos(a)];
  const c = (turn.rz ?? 0) * RAD;
  [dx, dy] = [dx * Math.cos(c) - dy * Math.sin(c), dx * Math.sin(c) + dy * Math.cos(c)];
  return [turn.pivot[0] + dx, turn.pivot[1] + dy, turn.pivot[2] + dz];
}

/** Corner points that bound one solid (after its turn). */
function corners(s) {
  let pts;
  if (s.p === 'box' || s.p === 'pyramid' || s.p === 'gable') {
    pts = [];
    for (let i = 0; i < 8; i++) pts.push([i & 1 ? s.max[0] : s.min[0], i & 2 ? s.max[1] : s.min[1], i & 4 ? s.max[2] : s.min[2]]);
  } else if (s.p === 'prism') {
    const r = Math.max(s.r, s.r1 ?? s.r);
    pts = [[s.at[0] - r, s.at[1] - r, s.z[0]], [s.at[0] + r, s.at[1] + r, s.z[1]], [s.at[0] - r, s.at[1] + r, s.z[0]], [s.at[0] + r, s.at[1] - r, s.z[1]]];
  } else if (s.p === 'limb') {
    pts = [];
    for (const [q, r] of [[s.a, s.r[0]], [s.b, s.r[1]]]) pts.push([q[0] - r, q[1] - r, q[2] - r], [q[0] + r, q[1] + r, q[2] + r]);
  } else if (s.p === 'ball') {
    pts = [[s.at[0] - s.r[0], s.at[1] - s.r[1], s.at[2] - s.r[2]], [s.at[0] + s.r[0], s.at[1] + s.r[1], s.at[2] + s.r[2]]];
  } else throw new Error(`gen solid: unknown solid "${s.p}". Use box, pyramid, gable, prism, limb or ball`);
  return pts.map((q) => turned(q, s.turn));
}

/** Bounding box of a list of solids: { min: [x, y, z], max: [x, y, z] } in metres. */
export function solidBounds(solids) {
  if (!Array.isArray(solids) || solids.length === 0) throw new Error('solidBounds: expected a non-empty list of solids');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) for (const q of corners(s)) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); }
  return { min, max };
}

/** Size of a list of solids in metres: { width, depth, height } (height is measured from the ground). */
export function solidSize(solids) {
  const { min, max } = solidBounds(solids);
  const r = (v) => Math.round(v * 100) / 100;
  return { width: r(max[0] - min[0]), depth: r(max[1] - min[1]), height: r(max[2]) };
}

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Resolve a solid's colour: a palette name or a hex string. */
export function solidColor(c, palette) {
  const hex = palette?.[c] ?? c;
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`gen solid: unknown colour "${c}". Palette: ${Object.keys(palette ?? {}).join(', ')}`);
  return hex;
}

// Add a convex face list straight to the mesh, one flat-shaded polygon at a time.
function rawFaces(m, polys, hex, turn) {
  const rgb = hexRgb(hex);
  const start = m.verts.length;
  for (const poly0 of polys) {
    const poly = poly0.map((q) => turned(q, turn));
    const [a, b, c] = poly;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    // the same gentle baked shading the built-in shapes use: tops lightest, the -x side darkest
    const k = 0.85 + 0.15 * Math.min(1, 0.85 + 0.25 * n[2] / len + 0.17 * n[0] / len);
    const base = m.verts.length;
    for (const q of poly) m.verts.push([q[0], q[1], q[2] * ZS, ...rgb.map((ch) => Math.max(0, Math.min(255, Math.round(ch * k))))]);
    for (let i = 1; i < poly.length - 1; i++) m.faces.push([base, base + i, base + i + 1]);
  }
  m.parts.push([start, m.verts.length]);
}

function limbFaces(s, n = 6) {
  const d = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]];
  const len = Math.hypot(...d);
  if (len < 1e-6) return ballFaces({ at: s.a, r: [s.r[0], s.r[0], s.r[0]] });
  const w = d.map((v) => v / len);
  const ref = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = [ref[1] * w[2] - ref[2] * w[1], ref[2] * w[0] - ref[0] * w[2], ref[0] * w[1] - ref[1] * w[0]];
  const ul = Math.hypot(...u); u = u.map((x) => x / ul);
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]]; // u x v = w
  const ring = (c, r) => Array.from({ length: n }, (_, i) => { const t = i / n * 2 * Math.PI; return c.map((x, k) => x + r * (Math.cos(t) * u[k] + Math.sin(t) * v[k])); });
  const r0 = Math.max(0.004, s.r[0]); const r1 = Math.max(0.004, s.r[1]);
  // caps are pushed out by a part of the radius so joints overlap like the round ends of a capsule
  const A = ring(s.a.map((x, k) => x - w[k] * r0 * 0.5), r0); const B = ring(s.b.map((x, k) => x + w[k] * r1 * 0.5), r1);
  const polys = [];
  for (let i = 0; i < n; i++) polys.push([A[i], A[(i + 1) % n], B[(i + 1) % n], B[i]]);
  polys.push(A.slice().reverse(), B);
  return polys;
}

function ballFaces(s, seg = 8, rows = 5) {
  const at = (i, j) => {
    const lat = -Math.PI / 2 + Math.PI * j / rows; const lon = 2 * Math.PI * i / seg;
    return [s.at[0] + s.r[0] * Math.cos(lat) * Math.cos(lon), s.at[1] + s.r[1] * Math.cos(lat) * Math.sin(lon), s.at[2] + s.r[2] * Math.sin(lat)];
  };
  const polys = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      if (j === 0) polys.push([at(0, 0), at(i + 1, 1), at(i, 1)]);
      else if (j === rows - 1) polys.push([at(i, j), at(i + 1, j), at(0, rows)]);
      else polys.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return polys;
}

/**
 * Add solids to a scene mesh builder (the one scene-shapes.js uses for the built-in shapes).
 * @param {object} m  Mesh builder with box, pyramid, gable, prism, with, verts, faces, parts.
 * @param {object[]} solids
 * @param {Object<string,string>} [palette]  Colour name to hex.
 * @returns {object} m
 */
export function addSolids(m, solids, palette = {}) {
  if (!Array.isArray(solids)) throw new Error('addSolids: "solids" must be a list');
  for (const s of solids) {
    const hex = solidColor(s.c, palette);
    const draw = () => {
      if (s.p === 'box') m.box(s.min[0], s.min[1], s.min[2] * ZS, s.max[0], s.max[1], s.max[2] * ZS, hex);
      else if (s.p === 'pyramid') m.pyramid(s.min[0], s.min[1], s.min[2] * ZS, s.max[0], s.max[1], s.max[2] * ZS, hex);
      else if (s.p === 'prism') m.prism(s.at[0], s.at[1], s.r, s.z[0] * ZS, s.z[1] * ZS, hex, s.n ?? 8, s.r1 ?? s.r);
      else if (s.p === 'gable' && s.along !== 'y') m.gable(s.min[0], s.min[1], s.min[2] * ZS, s.max[0], s.max[1], s.max[2] * ZS, hex);
    };
    if (s.p === 'limb') rawFaces(m, limbFaces(s), hex, s.turn);
    else if (s.p === 'ball') rawFaces(m, ballFaces(s), hex, s.turn);
    else if (s.p === 'gable' && s.along === 'y') {
      // a roof with its ridge along y: the same roof built along x, then turned a quarter about its centre
      const cx = (s.min[0] + s.max[0]) / 2; const cy = (s.min[1] + s.max[1]) / 2;
      const hx = (s.max[1] - s.min[1]) / 2; const hy = (s.max[0] - s.min[0]) / 2;
      m.with({ pivot: [cx, cy, 0], rz: 90 }, () => m.gable(cx - hx, cy - hy, s.min[2] * ZS, cx + hx, cy + hy, s.max[2] * ZS, hex));
    } else if (s.p === 'box' || s.p === 'pyramid' || s.p === 'prism' || s.p === 'gable') {
      if (s.turn) m.with({ pivot: [s.turn.pivot[0], s.turn.pivot[1], s.turn.pivot[2] * ZS], rx: s.turn.rx ?? 0, rz: s.turn.rz ?? 0 }, draw);
      else draw();
    } else throw new Error(`addSolids: unknown solid "${s.p}"`);
  }
  return m;
}

/** A tiny helper the makers use to collect solids: s.box(min, max, c), s.prism(...), and so on. */
export function solidList() {
  const list = [];
  const r = (v) => Math.round(v * 1000) / 1000;
  const v3 = (v) => v.map(r);
  const add = (s, turn) => { if (turn) s.turn = { pivot: v3(turn.pivot), ...(turn.rx ? { rx: r(turn.rx) } : {}), ...(turn.rz ? { rz: r(turn.rz) } : {}) }; list.push(s); return s; };
  return {
    list,
    box: (min, max, c, turn) => add({ p: 'box', min: v3(min), max: v3(max), c }, turn),
    pyramid: (min, max, c) => add({ p: 'pyramid', min: v3(min), max: v3(max), c }),
    gable: (min, max, c, along = 'x') => add({ p: 'gable', min: v3(min), max: v3(max), c, ...(along === 'y' ? { along } : {}) }),
    prism: (at, rad, z, c, o = {}, turn) => add({ p: 'prism', at: at.map(r), r: r(rad), ...(o.r1 !== undefined ? { r1: r(o.r1) } : {}), z: z.map(r), ...(o.n ? { n: o.n } : {}), c }, turn),
    limb: (a, b, rad, c) => add({ p: 'limb', a: v3(a), b: v3(b), r: (Array.isArray(rad) ? rad : [rad, rad]).map(r), c }),
    ball: (at, rad, c) => add({ p: 'ball', at: v3(at), r: (Array.isArray(rad) ? rad : [rad, rad, rad]).map(r), c }),
  };
}

/**
 * The flat faces of one solid as polygons in metres, wound so their normals point outward, with
 * the solid's turn applied. Used to draw solids as 2D vector art.
 * @returns {number[][][]} A list of polygons, each a list of [x, y, z].
 */
export function solidFaces(s) {
  let polys;
  if (s.p === 'limb') polys = limbFaces(s, 8);
  else if (s.p === 'ball') polys = ballFaces(s, 10, 6);
  else if (s.p === 'prism') {
    const n = s.n ?? 8; const r1 = s.r1 ?? s.r;
    const at = (i, rad, z) => [s.at[0] + rad * Math.cos(i / n * 2 * Math.PI), s.at[1] + rad * Math.sin(i / n * 2 * Math.PI), z];
    polys = [];
    for (let i = 0; i < n; i++) polys.push(r1 > 0 ? [at(i, s.r, s.z[0]), at(i + 1, s.r, s.z[0]), at(i + 1, r1, s.z[1]), at(i, r1, s.z[1])] : [at(i, s.r, s.z[0]), at(i + 1, s.r, s.z[0]), [s.at[0], s.at[1], s.z[1]]]);
    if (r1 > 0) polys.push(Array.from({ length: n }, (_, i) => at(i, r1, s.z[1])));
  } else {
    const [x0, y0, z0] = s.min; const [x1, y1, z1] = s.max;
    if (s.p === 'box') polys = [[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]];
    else if (s.p === 'pyramid') {
      const top = [(x0 + x1) / 2, (y0 + y1) / 2, z1]; const base = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]];
      polys = base.map((b, i) => [b, base[(i + 1) % 4], top]);
    } else if (s.p === 'gable' && s.along === 'y') {
      const xm = (x0 + x1) / 2;
      polys = [[[x0, y1, z0], [x0, y0, z0], [xm, y0, z1], [xm, y1, z1]], [[x1, y0, z0], [x1, y1, z0], [xm, y1, z1], [xm, y0, z1]], [[x0, y0, z0], [x1, y0, z0], [xm, y0, z1]], [[x1, y1, z0], [x0, y1, z0], [xm, y1, z1]]];
    } else if (s.p === 'gable') {
      const ym = (y0 + y1) / 2;
      polys = [[[x0, y0, z0], [x1, y0, z0], [x1, ym, z1], [x0, ym, z1]], [[x1, y1, z0], [x0, y1, z0], [x0, ym, z1], [x1, ym, z1]], [[x1, y0, z0], [x1, y1, z0], [x1, ym, z1]], [[x0, y1, z0], [x0, y0, z0], [x0, ym, z1]]];
    } else throw new Error(`solidFaces: unknown solid "${s.p}"`);
  }
  return s.turn ? polys.map((poly) => poly.map((q) => turned(q, s.turn))) : polys;
}
