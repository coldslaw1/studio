// Turns a glTF / GLB or OBJ file from a model pack into a Kiln model (see model.js). Pure functions
// over bytes and text: the command line (cli.js "kiln import") does the file reading. No dependencies.
// Understood: glTF 2.0 meshes (triangles), node transforms, skins (the rest pose), base colours, vertex
// colours, PNG colour textures, KHR_mesh_quantization, KHR_texture_transform; OBJ with MTL (Kd, map_Kd).
// Not understood, with a clear error: Draco and meshopt compression (export the plain file instead).
import { modelRole, validateModel } from './model.js';

const text = (bytes) => new TextDecoder().decode(bytes);

// ---- small matrix helpers (column-major 4x4, as glTF stores them) ----
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mat(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(node) {
  if (node.matrix) return node.matrix.slice();
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

// ---- PNG reading (for colour-palette textures); `inflate` is zlib's inflateSync or the like ----
/** decodePng(bytes, inflate) -> { width, height, data: Uint8Array rgba }. 8-bit, not interlaced. */
export function decodePng(bytes, inflate) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47) throw new Error('decodePng: not a PNG file');
  let at = 8; let width = 0; let height = 0; let depth = 0; let type = 0; let interlace = 0; let palette = null; let trns = null;
  const idat = [];
  while (at < bytes.length) {
    const len = view.getUint32(at); const name = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (name === 'IHDR') { width = view.getUint32(at + 8); height = view.getUint32(at + 12); depth = bytes[at + 16]; type = bytes[at + 17]; interlace = bytes[at + 20]; }
    else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`decodePng: only 8-bit, non-interlaced PNG is read (this one is ${depth}-bit${interlace ? ', interlaced' : ''})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`decodePng: unknown colour type ${type}`);
  const all = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0; for (const c of idat) { all.set(c, o); o += c.length; }
  const raw = new Uint8Array(inflate(all));
  const stride = width * channels; const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]; const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0; const b = y ? px[(y - 1) * stride + x] : 0; const c = x >= channels && y ? px[(y - 1) * stride + x - channels] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r; let g; let b; let a = 255;
    if (type === 0) { r = g = b = px[i]; } else if (type === 2) { r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2]; }
    else if (type === 3) { const k = px[i]; r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2]; a = trns && k < trns.length ? trns[k] : 255; }
    else if (type === 4) { r = g = b = px[i * 2]; a = px[i * 2 + 1]; } else { r = px[i * 4]; g = px[i * 4 + 1]; b = px[i * 4 + 2]; a = px[i * 4 + 3]; }
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return { width, height, data };
}
const texel = (img, u, v) => {
  const x = Math.min(img.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.width)));
  const y = Math.min(img.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.height)));
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};
// Colours are multiplied as light (linear, 0 to 1) and turned into screen values (sRGB bytes) once, at the end.
const srgb = (c) => { const v = Math.max(0, Math.min(1, c)); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) + 1e-6); };
const linear = (byte) => { const v = byte / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

// ---- glTF ----
/**
 * Read a .glb (bytes) or a .gltf (JSON text or object) into loose triangles.
 * @param {Uint8Array|string|object} input
 * @param {{ load?: (uri: string) => Uint8Array, inflate?: (bytes: Uint8Array) => Uint8Array, colors?: 'linear'|'srgb' }} [io]
 *   load fetches a file named by the glTF (its .bin, a texture); inflate opens PNG textures. Without
 *   them such parts are skipped and listed in `warnings`. colors says how the file's material colours
 *   (baseColorFactor) and vertex colours are stored: 'linear' (the default, as glTF asks) or 'srgb' for
 *   packs that wrote screen values there (their models come out pale otherwise). Textures are always
 *   screen values. Everything is multiplied as light and turned into a screen colour once.
 * @returns {{ tris: Array<{ p: number[][], color: number[], material: string }>, warnings: string[], up: 'y' }}
 */
export function readGltf(input, io = {}) {
  const warnings = [];
  let json; let bin = null;
  if (input instanceof Uint8Array) {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    if (view.getUint32(0, true) === 0x46546c67) {
      let at = 12;
      while (at < input.length) {
        const len = view.getUint32(at, true); const kind = view.getUint32(at + 4, true); const body = input.subarray(at + 8, at + 8 + len);
        if (kind === 0x4e4f534a) json = JSON.parse(text(body)); else if (kind === 0x004e4942 && !bin) bin = body;
        at += 8 + len;
      }
    } else json = JSON.parse(text(input));
  } else json = typeof input === 'string' ? JSON.parse(input) : input;
  if (!json || !json.asset) throw new Error('readGltf: not a glTF file (no "asset")');
  if (io.colors !== undefined && io.colors !== 'linear' && io.colors !== 'srgb') throw new Error(`readGltf: "colors" must be "linear" or "srgb", got ${JSON.stringify(io.colors)}`);
  // a material or vertex colour as light: the file's number as it is, or read as a screen value first
  const given = io.colors === 'srgb' ? (v) => linear(Math.max(0, Math.min(1, v)) * 255) : (v) => Math.max(0, Math.min(1, v));
  const required = json.extensionsRequired ?? [];
  for (const bad of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']) if (required.includes(bad) || (bad === 'EXT_meshopt_compression' && (json.extensionsUsed ?? []).includes(bad))) throw new Error(`readGltf: this file is packed with ${bad}, which Kiln does not unpack. Use the pack's plain glTF, GLB or OBJ file instead.`);
  const dataUri = (uri) => { const m = /^data:[^;,]*;base64,(.*)$/s.exec(uri); if (!m) return null; const s = atob(m[1]); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const buffers = (json.buffers ?? []).map((b, i) => {
    if (b.uri === undefined) return i === 0 ? bin : null;
    const d = dataUri(b.uri); if (d) return d;
    if (!io.load) { warnings.push(`buffer "${b.uri}" was not loaded`); return null; }
    return io.load(decodeURIComponent(b.uri));
  });
  const viewBytes = (index) => { const v = json.bufferViews[index]; const b = buffers[v.buffer]; if (!b) throw new Error(`readGltf: buffer ${v.buffer} is missing`); return { bytes: b.subarray((v.byteOffset ?? 0), (v.byteOffset ?? 0) + v.byteLength), stride: v.byteStride ?? 0 }; };
  const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const READ = { 5120: ['getInt8', 1, 127], 5121: ['getUint8', 1, 255], 5122: ['getInt16', 2, 32767], 5123: ['getUint16', 2, 65535], 5125: ['getUint32', 4, 1], 5126: ['getFloat32', 4, 1] };
  const accessor = (index) => {
    const a = json.accessors[index]; const n = SIZE[a.type]; const [fn, width, max] = READ[a.componentType];
    const out = new Array(a.count);
    if (a.bufferView === undefined) { for (let i = 0; i < a.count; i++) out[i] = new Array(n).fill(0); return out; }
    const { bytes, stride } = viewBytes(a.bufferView);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const step = stride || n * width; const off = a.byteOffset ?? 0;
    for (let i = 0; i < a.count; i++) {
      const row = new Array(n);
      for (let k = 0; k < n; k++) { const v = dv[fn](off + i * step + k * width, true); row[k] = a.normalized ? Math.max(-1, v / max) : v; }
      out[i] = row;
    }
    return out;
  };
  const images = new Map();
  const image = (texIndex) => {
    const tex = json.textures?.[texIndex]; const src = tex?.source;
    if (src === undefined) return null;
    if (!images.has(src)) {
      let img = null;
      try {
        const def = json.images[src];
        const bytes = def.bufferView !== undefined ? viewBytes(def.bufferView).bytes : dataUri(def.uri ?? '') ?? (io.load ? io.load(decodeURIComponent(def.uri)) : null);
        if (!bytes) warnings.push(`texture "${def.uri}" was not loaded; its parts use the material's plain colour`);
        else if (!io.inflate) warnings.push('textures were not read (no inflate given); parts use the material\'s plain colour');
        else img = decodePng(bytes, io.inflate);
      } catch (e) { warnings.push(`a texture could not be read (${e.message}); its parts use the material's plain colour`); }
      images.set(src, img);
    }
    return images.get(src);
  };
  // world matrices
  const nodes = json.nodes ?? []; const world = new Array(nodes.length).fill(null);
  const walk = (i, parent) => { world[i] = mat(parent, trs(nodes[i])); for (const c of nodes[i].children ?? []) walk(c, world[i]); };
  const sceneDef = json.scenes?.[json.scene ?? 0];
  const roots = sceneDef?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((n) => (n.children ?? []).includes(i)));
  for (const r of roots) walk(r, IDENT);
  const tris = [];
  nodes.forEach((node, ni) => {
    if (node.mesh === undefined || !world[ni]) return;
    const skin = node.skin !== undefined ? json.skins[node.skin] : null;
    const ibm = skin ? (skin.inverseBindMatrices !== undefined ? accessor(skin.inverseBindMatrices) : skin.joints.map(() => IDENT)) : null;
    const joint = skin ? skin.joints.map((j, k) => mat(world[j] ?? IDENT, ibm[k])) : null;
    for (const prim of json.meshes[node.mesh].primitives) {
      if ((prim.mode ?? 4) !== 4) { warnings.push(`a part of "${node.name ?? json.meshes[node.mesh].name ?? 'mesh'}" is not made of triangles and was skipped`); continue; }
      if (prim.attributes.POSITION === undefined) continue;
      const pos = accessor(prim.attributes.POSITION);
      const uv = prim.attributes.TEXCOORD_0 !== undefined ? accessor(prim.attributes.TEXCOORD_0) : null;
      const col = prim.attributes.COLOR_0 !== undefined ? accessor(prim.attributes.COLOR_0) : null;
      const J = joint && prim.attributes.JOINTS_0 !== undefined ? accessor(prim.attributes.JOINTS_0) : null;
      const W = J && prim.attributes.WEIGHTS_0 !== undefined ? accessor(prim.attributes.WEIGHTS_0) : null;
      const m = prim.material !== undefined ? json.materials[prim.material] : null;
      const pbr = m?.pbrMetallicRoughness ?? {};
      const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
      const info = pbr.baseColorTexture; const img = info ? image(info.index) : null;
      const xf = info?.extensions?.KHR_texture_transform;
      const points = pos.map((v, i) => {
        if (J && W) {
          const w = W[i]; const sum = w[0] + w[1] + w[2] + w[3] || 1; const p = [0, 0, 0];
          for (let k = 0; k < 4; k++) if (w[k] > 0) { const q = apply(joint[J[i][k]], v); p[0] += q[0] * w[k] / sum; p[1] += q[1] * w[k] / sum; p[2] += q[2] * w[k] / sum; }
          return p;
        }
        return apply(world[ni], v);
      });
      const colourAt = (i) => {
        const c = [given(factor[0]), given(factor[1]), given(factor[2])];
        if (img && uv) {
          let [u, v] = uv[i];
          if (xf) { u = u * (xf.scale?.[0] ?? 1) + (xf.offset?.[0] ?? 0); v = v * (xf.scale?.[1] ?? 1) + (xf.offset?.[1] ?? 0); }
          const t = texel(img, u, v); for (let k = 0; k < 3; k++) c[k] *= linear(t[k]);
        }
        if (col) for (let k = 0; k < 3; k++) c[k] *= given(col[i][k]);
        return c.map(srgb);
      };
      const idx = prim.indices !== undefined ? accessor(prim.indices).map((r) => r[0]) : pos.map((_, i) => i);
      const material = m?.name ?? node.name ?? json.meshes[node.mesh].name ?? '';
      for (let i = 0; i + 2 < idx.length; i += 3) {
        const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
        // one colour per triangle: the middle of its three corners (pack textures are flat colour swatches)
        const ca = colourAt(a); const cb = colourAt(b); const cc = colourAt(c);
        const same = (ca[0] === cb[0] && ca[1] === cb[1] && ca[2] === cb[2]) || (ca[0] === cc[0] && ca[1] === cc[1] && ca[2] === cc[2]);
        tris.push({ p: [points[a], points[b], points[c]], color: same ? ca : cb, material });
      }
    }
  });
  if (tris.length === 0) throw new Error('readGltf: the file holds no triangles');
  return { tris, warnings, up: 'y' };
}

// ---- OBJ ----
/**
 * Read a Wavefront .obj (text) with its .mtl (text, optional) into loose triangles.
 * @param {string} obj
 * @param {string} [mtl]
 * @param {{ load?: (name: string) => Uint8Array, inflate?: Function }} [io]  for map_Kd PNG textures
 */
export function readObj(obj, mtl = '', io = {}) {
  const warnings = []; const mats = new Map(); let cur = null;
  for (const line of mtl.split(/\r?\n/)) {
    const [k, ...rest] = line.trim().split(/\s+/);
    if (k === 'newmtl') { cur = { kd: [0.8, 0.8, 0.8], img: null }; mats.set(rest.join(' '), cur); }
    else if (k === 'Kd' && cur) cur.kd = rest.slice(0, 3).map(Number);
    else if (k === 'map_Kd' && cur) {
      const name = rest[rest.length - 1];
      try { if (io.load && io.inflate) cur.img = decodePng(io.load(name), io.inflate); else warnings.push(`texture "${name}" was not read; its parts use the material's plain colour`); }
      catch (e) { warnings.push(`texture "${name}" could not be read (${e.message}); its parts use the material's plain colour`); }
    }
  }
  const v = []; const vt = []; const tris = []; let material = '';
  for (const line of obj.split(/\r?\n/)) {
    const [k, ...rest] = line.trim().split(/\s+/);
    if (k === 'v') v.push(rest.slice(0, 3).map(Number));
    else if (k === 'vt') vt.push(rest.slice(0, 2).map(Number));
    else if (k === 'usemtl') material = rest.join(' ');
    else if (k === 'f') {
      const corners = rest.map((c) => { const [a, b] = c.split('/'); const i = Number(a); const j = b ? Number(b) : 0; return { p: v[i < 0 ? v.length + i : i - 1], t: j ? vt[j < 0 ? vt.length + j : j - 1] : null }; });
      if (corners.some((c) => !c.p)) throw new Error(`readObj: a face names a vertex that does not exist ("${line.trim()}")`);
      const m = mats.get(material);
      for (let i = 1; i + 1 < corners.length; i++) {
        const tri = [corners[0], corners[i], corners[i + 1]];
        let color = (m?.kd ?? [0.8, 0.8, 0.8]).map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255));
        if (m?.img && tri[1].t) { const t = texel(m.img, tri[1].t[0], 1 - tri[1].t[1]); color = t.map((c, n) => Math.round(c * (m.kd[n] ?? 1))); }
        tris.push({ p: tri.map((c) => c.p), color, material });
      }
    }
  }
  if (tris.length === 0) throw new Error('readObj: the file holds no faces');
  return { tris, warnings, up: 'y' };
}

// ---- loose triangles -> a Kiln model ----
/**
 * Make a Kiln model from loose triangles.
 * @param {{ tris: Array, warnings?: string[], up?: 'y'|'z' }} mesh  From readGltf or readObj.
 * @param {object} opts
 * @param {string} opts.name      Lowercase name the scenes use.
 * @param {object} opts.source    { pack, author, license, url, file }. license is required.
 * @param {number} [opts.height]  Make it this many metres tall. Use it for characters (1.8) and anything whose pack has no fixed scale.
 * @param {number} [opts.scale]   Or multiply the pack's units by this to get metres (default 1). One number per pack keeps its models in proportion.
 * @param {number} [opts.yaw]     Turn it this many degrees so that its front faces -y (Kiln's "towards the camera").
 * @param {Object<string,string>} [opts.roles]  Material name -> role, where the automatic reading is wrong ('' for none).
 * @param {Array<{ near: string, role: string, within?: number }>} [opts.colorRoles]  Roles by colour, for packs that paint
 *   every part from one material (a "colormap"): a part whose material gave no role, and has no entry in opts.roles, takes
 *   the role of the nearest listed colour (`near`, '#rrggbb') when it is within `within` of it (distance over the three
 *   0 to 255 channels, default 40). A role from opts.roles always wins, '' included.
 * @param {{ cell: number, kind?: 'square'|'hex' }} [opts.grid]  For kit pieces made to sit on a grid (walls, roads, floor and
 *   hex tiles): the cell size in the pack's own units (Kenney kits: 1). It is stored in metres as the model's "grid", and
 *   a scene's "tiles" layout takes its spacing from it. kind 'hex' is for six-sided tiles with a point towards +y.
 * @param {string[]} [opts.tags]  Words for a catalogue ("tree", "nature").
 * @param {number} [opts.maxTriangles]  Refuse models above this (default 60000).
 * @returns {{ model: object, warnings: string[] }}
 */
export function buildModel(mesh, opts = {}) {
  const fn = 'buildModel';
  if (!opts.name || !/^[a-z0-9][a-z0-9_-]*$/.test(opts.name)) throw new Error(`${fn}: opts.name must be lowercase letters, digits, "_" or "-", got ${JSON.stringify(opts.name)}`);
  if (!opts.source?.license) throw new Error(`${fn}: opts.source.license is required (an SPDX id such as "CC0-1.0"). Read the pack's license file first.`);
  if (opts.height !== undefined && opts.scale !== undefined) throw new Error(`${fn}: give "height" or "scale", not both`);
  if (opts.height !== undefined && !(opts.height > 0)) throw new Error(`${fn}: opts.height must be above 0, got ${opts.height}`);
  if (opts.scale !== undefined && !(opts.scale > 0)) throw new Error(`${fn}: opts.scale must be above 0, got ${opts.scale}`);
  if (opts.colorRoles !== undefined && !Array.isArray(opts.colorRoles)) throw new Error(`${fn}: opts.colorRoles must be a list of { near: "#rrggbb", role, within }, got ${JSON.stringify(opts.colorRoles)}`);
  const colorRoles = (opts.colorRoles ?? []).map((e, i) => {
    const m = typeof e?.near === 'string' ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(e.near) : null;
    if (!m || typeof e.role !== 'string' || !e.role || (e.within !== undefined && !(e.within > 0))) throw new Error(`${fn}: opts.colorRoles[${i}] must be { near: "#rrggbb", role: a part role such as "leaf", within: a number above 0 (default 40) }, got ${JSON.stringify(e)}`);
    return { rgb: [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)], role: e.role, within: e.within ?? 40 };
  });
  const roleByColour = (c) => {
    let best = ''; let bestD = Infinity;
    for (const e of colorRoles) { const d = Math.hypot(c[0] - e.rgb[0], c[1] - e.rgb[1], c[2] - e.rgb[2]); if (d <= e.within && d < bestD) { bestD = d; best = e.role; } }
    return best;
  };
  if (opts.grid !== undefined && !(opts.grid && opts.grid.cell > 0 && (opts.grid.kind === undefined || opts.grid.kind === 'square' || opts.grid.kind === 'hex'))) throw new Error(`${fn}: opts.grid must be { cell: a number above 0 (pack units), kind: "square" or "hex" }, got ${JSON.stringify(opts.grid)}`);
  const max = opts.maxTriangles ?? 60000;
  if (mesh.tris.length > max) throw new Error(`${fn}: ${opts.name} has ${mesh.tris.length} triangles, more than ${max}. Pick a lighter model or raise maxTriangles.`);
  const warnings = [...(mesh.warnings ?? [])];
  const yaw = (opts.yaw ?? 0) * Math.PI / 180; const cs = Math.cos(yaw); const sn = Math.sin(yaw);
  // to Kiln's axes: x right, y away from the camera, z up
  const turn = (p) => { const q = mesh.up === 'z' ? [p[0], p[1], p[2]] : [p[0], -p[2], p[1]]; return [q[0] * cs - q[1] * sn, q[0] * sn + q[1] * cs, q[2]]; };
  const tris = mesh.tris.map((t) => ({ ...t, p: t.p.map(turn) })).filter((t) => {
    const [a, b, c] = t.p; const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) > 1e-12; // drop zero-area slivers
  });
  if (tris.length === 0) throw new Error(`${fn}: ${opts.name} has no triangles with any area`);
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t.p) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  const tall = hi[2] - lo[2];
  // a flat piece (a ground or floor tile) is fine, but it cannot be sized by its height
  if (!(tall > 0) && opts.height !== undefined) throw new Error(`${fn}: ${opts.name} is flat (no height), so "height" cannot size it. Give "scale" instead.`);
  if (!(hi[0] - lo[0] > 0) && !(hi[1] - lo[1] > 0)) throw new Error(`${fn}: ${opts.name} has no width`);
  const s = opts.height !== undefined ? opts.height / tall : (opts.scale ?? 1);
  const cx = (lo[0] + hi[0]) / 2; const cy = (lo[1] + hi[1]) / 2;
  const mm = (p) => [Math.round((p[0] - cx) * s * 1000), Math.round((p[1] - cy) * s * 1000), Math.round((p[2] - lo[2]) * s * 1000)];
  // parts: one per (material, colour)
  const parts = []; const partIndex = new Map();
  const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  const partOf = (t) => {
    const color = hex(t.color); const key = t.material + '|' + color;
    if (!partIndex.has(key)) {
      // the role: what the map says for this material, else what its name says, else what its colour says
      const role = opts.roles && Object.hasOwn(opts.roles, t.material) ? opts.roles[t.material] : (modelRole(t.material) || roleByColour(t.color));
      const n = parts.filter((p) => p.name === t.material || p.name.startsWith(t.material + '#')).length;
      partIndex.set(key, parts.push({ name: n ? `${t.material}#${n + 1}` : (t.material || `part${parts.length + 1}`), role, color }) - 1);
    }
    return partIndex.get(key);
  };
  // connected pieces: triangles that share a corner position belong together
  const posId = new Map(); const parent = [];
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const idOf = (q) => { const k = q.join(','); if (!posId.has(k)) { posId.set(k, parent.length); parent.push(parent.length); } return posId.get(k); };
  const made = [];
  for (const t of tris) {
    // a triangle whose corners land on one point or one line once rounded to millimetres has no area: leave it out
    const q = t.p.map(mm); const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]]; const w = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
    if (u[1] * w[2] - u[2] * w[1] === 0 && u[2] * w[0] - u[0] * w[2] === 0 && u[0] * w[1] - u[1] * w[0] === 0) continue;
    const ids = q.map(idOf); parent[find(ids[1])] = find(ids[0]); parent[find(ids[2])] = find(ids[0]);
    made.push({ q, ids, part: partOf(t) });
  }
  if (made.length === 0) throw new Error(`${fn}: ${opts.name} is too small to keep any triangle at this scale`);
  const byPiece = new Map();
  for (const t of made) { const r = find(t.ids[0]); if (!byPiece.has(r)) byPiece.set(r, []); byPiece.get(r).push(t); }
  const verts = []; const faces = []; const groups = [];
  for (const piece of byPiece.values()) {
    const start = verts.length / 3; const seen = new Map();
    for (const t of piece) {
      const abc = t.q.map((q, k) => { const key = t.ids[k] + ':' + t.part; if (!seen.has(key)) { seen.set(key, verts.length / 3); verts.push(q[0], q[1], q[2]); } return seen.get(key); });
      faces.push(abc[0], abc[1], abc[2], t.part);
    }
    groups.push(verts.length / 3 - start);
  }
  const r = (v) => Math.round(v * 1000) / 1000;
  const model = {
    kiln: 'model', version: 1, name: opts.name, tags: opts.tags ?? [],
    size: { width: r((hi[0] - lo[0]) * s), depth: r((hi[1] - lo[1]) * s), height: r(tall * s) },
    source: { pack: opts.source.pack ?? '', author: opts.source.author ?? '', license: opts.source.license, url: opts.source.url ?? '', file: opts.source.file ?? '' },
    // where the pack's own origin lies in this model, in millimetres. Kit pieces are drawn around it so that they
    // meet when placed a cell apart (a wall sits at the edge of its cell, a roof hangs below its own floor line).
    anchor: [Math.round(-cx * s * 1000) + 0, Math.round(-cy * s * 1000) + 0, Math.round(-lo[2] * s * 1000) + 0], // "+ 0": no minus zero
    ...(opts.grid ? { grid: { cell: r(opts.grid.cell * s), kind: opts.grid.kind ?? 'square' } } : {}),
    parts, verts, faces, groups,
  };
  if (model.size.height > 40 || (model.size.height < 0.03 && model.size.height > 0)) warnings.push(`${opts.name} is ${model.size.height} m tall: check "height" or "scale"`);
  const errors = validateModel(model);
  if (errors.length) throw new Error(`${fn}: ${opts.name} came out unsound:\n- ${errors.join('\n- ')}`);
  return { model, warnings };
}

/** Compact JSON text for a model file (arrays on one line each). */
export function modelJson(model) {
  const { verts, faces, groups, ...head0 } = model;
  const head = { ...head0, ...(head0.anchor ? { anchor: `@@[${head0.anchor.join(',')}]@@` } : {}) };
  return JSON.stringify(head, null, 1).replace(/"@@(\[[^\]]*\])@@"/, '$1').replace(/\n}$/, '') + `,\n "verts": [${verts.join(',')}],\n "faces": [${faces.join(',')}],\n "groups": [${groups.join(',')}]\n}\n`;
}
