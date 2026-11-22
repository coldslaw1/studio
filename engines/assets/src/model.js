// Imported 3D models (from CC0 packs such as Kenney, Quaternius and KayKit) as Kiln shapes.
// A model is plain JSON made once by `kiln import` (see model-import.js) and used in a scene as
// { "shape": "model", "at": [x, y], "params": { "model": "tree_oak" } }. No DOM, no Node, no dependencies.
//
// The format (a ".kmodel.json" file):
//   { kiln: 'model', version: 1, name, tags: [words],
//     size: { width, depth, height },            metres, standing on the ground, centred, facing -y
//     source: { pack, author, license, url, file },   where it came from; license is an SPDX id
//     anchor: [x, y, z],                         optional, millimetres: where the pack's own origin lies in the model
//     grid: { cell, kind },                      optional: a kit piece made for a grid of `cell` metres ('square' or 'hex')
//     parts: [{ name, role, color }],            one per material of the original; role may be ''
//     verts: [x, y, z, ...],                     whole millimetres, three per vertex
//     faces: [a, b, c, part, ...],               four per triangle
//     groups: [vertexCount, ...] }               connected pieces, in vertex order (for collision outlines)
import { parseHex } from './color.js';
import { STYLES } from './styles.js';

const ZS = 16;

/**
 * Words in a material or object name and the Kiln part name ("role") they stand for. The role
 * decides the surface finish (roof tiles, bark, foliage) and lets a scene recolour the part by
 * name. First match wins; names are split into words at capitals, digits, spaces, "_" and "-".
 */
export const MODEL_ROLE_WORDS = [
  ['leaf', ['leaf', 'leafs', 'leaves', 'foliage', 'bush', 'grass', 'plant', 'moss', 'vine', 'hedge']],
  ['trunk', ['bark', 'trunk', 'branch', 'log', 'stump']],
  ['roof', ['roof', 'tile', 'tiles', 'shingle', 'thatch']],
  ['window', ['window', 'glass', 'pane']],
  ['door', ['door']],
  ['stone', ['stone', 'rock', 'brick', 'bricks', 'cobble', 'marble', 'concrete']],
  ['steel', ['metal', 'steel', 'iron', 'silver', 'chain', 'blade', 'armor', 'armour']],
  ['wall', ['wall', 'plaster', 'stucco']],
  ['wood', ['wood', 'wooden', 'plank', 'planks', 'board', 'timber']],
  ['cloth', ['cloth', 'fabric', 'canvas', 'banner', 'flag', 'rope', 'sail', 'shirt', 'tunic', 'cape', 'hood']],
  ['skin', ['skin', 'face', 'flesh']],
  ['bone', ['bone', 'skull', 'teeth', 'tooth', 'horn']],
  ['light', ['glow', 'flame', 'fire', 'emissive', 'lava', 'lamp', 'lantern']],
  ['ground', ['dirt', 'ground', 'soil', 'mud', 'sand', 'earth']],
];

/** The Kiln palette colour ("a" or "a~b~t") a role takes in a style, for `params.style`. Roles not listed keep the model's own colour. */
export const MODEL_ROLE_PALETTE = {
  leaf: 'leaf', trunk: 'wood~ink~0.45', roof: 'roof', stone: 'stone', steel: 'steel', wall: 'cream', wood: 'wood',
  bone: 'bone', ground: 'wood~ink~0.3', door: 'wood~ink~0.35', window: 'night',
};

/** The colours the built-in shapes use for the same parts, so a model beside them matches (`tint: "kiln"`, the default). */
const ROLE_DEFAULT = {
  leaf: '#2f7d48', trunk: '#6b3a26', roof: '#aa3c32', stone: '#8c8c96', steel: '#9aa0aa', wall: '#c8b48c', wood: '#8a5a2c',
  bone: '#e6e0c8', ground: '#7a5a3a', door: '#6b3a26', window: '#33446a',
};

/** modelRole("leafsGreen") -> "leaf"; '' when no word of the name is known. */
export function modelRole(name) {
  const words = String(name ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const [role, list] of MODEL_ROLE_WORDS) if (words.some((w) => list.includes(w))) return role;
  return '';
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const toHex = (rgb) => '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]);
const mixHex = (a, b, t) => { const p = parseHex(a); const q = parseHex(b); return toHex(p.map((v, i) => v + (q[i] - v) * t)); };

/** Problems with a model's data, as a list of sentences (empty when it is sound). */
export function validateModel(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || data.kiln !== 'model') return ['A model must be an object with "kiln": "model" (a .kmodel.json file made by "kiln import").'];
  if (data.version !== 1) errors.push(`"version" must be 1, got ${JSON.stringify(data.version)}.`);
  if (typeof data.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(data.name)) errors.push('"name" must be lowercase letters, digits, "_" or "-".');
  if (!Array.isArray(data.parts) || data.parts.length === 0) errors.push('"parts" must list at least one part.');
  else data.parts.forEach((p, i) => { try { parseHex(p.color); } catch { errors.push(`parts[${i}].color must be a hex colour.`); } });
  if (!Array.isArray(data.verts) || data.verts.length % 3 !== 0 || data.verts.length < 9) errors.push('"verts" must hold three numbers per vertex, at least three vertices.');
  if (!Array.isArray(data.faces) || data.faces.length % 4 !== 0 || data.faces.length < 4) errors.push('"faces" must hold four numbers per triangle (a, b, c, part).');
  if (errors.length === 0) {
    const nv = data.verts.length / 3;
    for (let i = 0; i < data.faces.length; i += 4) {
      if (!(data.faces[i] < nv && data.faces[i + 1] < nv && data.faces[i + 2] < nv && data.faces[i] >= 0)) { errors.push(`faces: triangle ${i / 4} points past the last vertex.`); break; }
      if (!data.parts[data.faces[i + 3]]) { errors.push(`faces: triangle ${i / 4} names part ${data.faces[i + 3]}, which is not in "parts".`); break; }
    }
    if (data.groups !== undefined && (!Array.isArray(data.groups) || data.groups.reduce((a, b) => a + b, 0) !== nv)) errors.push('"groups" must add up to the number of vertices.');
  }
  if (data.anchor !== undefined && !(Array.isArray(data.anchor) && data.anchor.length === 3 && data.anchor.every((v) => Number.isFinite(v)))) errors.push('"anchor" must be [x, y, z] in millimetres.');
  if (data.grid !== undefined && !(data.grid && data.grid.cell > 0 && (data.grid.kind === 'square' || data.grid.kind === 'hex'))) errors.push('"grid" must be { cell: metres, kind: "square" or "hex" }.');
  if (!data.source || typeof data.source.license !== 'string' || !data.source.license) errors.push('"source.license" is required (an SPDX id such as "CC0-1.0"): a model without a recorded license must not be used.');
  return errors;
}

/**
 * A set of models to look names up in. One library is shared by default (`defineModel`,
 * `modelNames`); make your own with createModelLibrary() to keep sets apart, for example in tests.
 */
export function createModelLibrary() {
  const models = new Map();
  return {
    /**
     * Add a model (the JSON of a .kmodel.json file). Throws when the data is unsound. Returns the name scenes use.
     * `as` gives it another name than its own, usually "pack/name": packs share names such as "wall" and "barrel",
     * and a game that mixes packs names each model with its pack.
     */
    define(data, as) {
      const errors = validateModel(data);
      if (errors.length) throw new Error(`defineModel: ${data?.name ?? 'model'} is not usable:\n- ${errors.join('\n- ')}`);
      if (as !== undefined && (typeof as !== 'string' || !/^[a-z0-9][a-z0-9_/-]*$/.test(as))) throw new Error(`defineModel: "as" must be lowercase letters, digits, "_", "-" or "/", got ${JSON.stringify(as)}`);
      models.set(as ?? data.name, data);
      return as ?? data.name;
    },
    get(name) {
      const m = models.get(name);
      if (!m) throw new Error(`model: unknown model "${name}". Defined: ${[...models.keys()].join(', ') || 'none (call defineModel or list the files under "models" in the scene)'}`);
      return m;
    },
    has: (name) => models.has(name),
    names: () => [...models.keys()],
    /** One line of facts per model, for a catalogue: { name, tags, size, parts: [role or name], license, pack }. */
    list: () => [...models.entries()].map(([name, m]) => ({ name, tags: m.tags ?? [], size: m.size, ...(m.grid ? { grid: m.grid } : {}), parts: [...new Set(m.parts.map((p) => p.role || p.name))], license: m.source.license, pack: m.source.pack ?? '' })),
    /** The credit lines the defined models need, one per pack: "Pack by Author (License)". */
    credits() {
      const seen = new Map();
      for (const [name, m] of models) {
        const s = m.source;
        const key = `${s.pack ?? m.name}|${s.author ?? ''}|${s.license}`;
        if (!seen.has(key)) seen.set(key, { pack: s.pack ?? m.name, author: s.author ?? '', license: s.license, url: s.url ?? '', required: !/^CC0|^Unlicense|^0BSD/i.test(s.license), models: [] });
        seen.get(key).models.push(name);
      }
      return [...seen.values()];
    },
    clear: () => models.clear(),
  };
}

const shared = createModelLibrary();
/** defineModel(data) adds a model to the shared library, so scenes can name it. Returns its name. */
export const defineModel = (data, as) => shared.define(data, as);
/** defineModels([data, ...]) adds several. Returns their names. */
export const defineModels = (list) => list.map((d) => shared.define(d));
export const modelNames = () => shared.names();
export const hasModel = (name) => shared.has(name);
export const getModel = (name) => shared.get(name);
export const modelList = () => shared.list();
export const modelCredits = () => shared.credits();
export const clearModels = () => shared.clear();

/**
 * The colour of every part of a model, as hex, for the given params:
 *   colors: { role or part name: hex }   wins over everything
 *   style:  a Kiln style name            parts with a known role take that style's palette colour
 *   tint:   "kiln" (default)             parts with a known role take the built-in shapes' colour
 *           "own"                        every part keeps the colour the pack gave it
 */
export function modelColors(model, params = {}) {
  const colors = params.colors ?? {};
  const style = params.style ? STYLES[params.style] : null;
  if (params.style && !style) throw new Error(`model: unknown style "${params.style}". Known: ${Object.keys(STYLES).join(', ')}`);
  if (params.tint !== undefined && params.tint !== 'kiln' && params.tint !== 'own') throw new Error(`model: "tint" must be "kiln" or "own", got ${JSON.stringify(params.tint)}`);
  return model.parts.map((part) => {
    if (part.role) { const c = colors[part.role]; if (c !== undefined) return c; } // one lookup per role: shapeMesh names parts by it
    if (Object.hasOwn(colors, part.name)) return colors[part.name];
    if (params.tint === 'own' || !part.role) return part.color;
    if (style && MODEL_ROLE_PALETTE[part.role]) {
      const [a, b, t] = MODEL_ROLE_PALETTE[part.role].split('~');
      const pa = style.palette[a]; const pb = b ? style.palette[b] : null;
      if (pa && (!b || pb)) return b ? mixHex(pa, pb, Number(t)) : pa;
    }
    return ROLE_DEFAULT[part.role] ?? part.color;
  });
}

/**
 * Fill a scene mesh (see scene-shapes.js) from a model. params: { model: name or data, colors, style, tint, anchor }.
 * anchor: "base" (default) stands the model on the ground, centred on the object's "at"; "origin" puts the pack's
 * own origin there instead, which is how kit pieces (walls, roads, roofs, tiles) meet their neighbours.
 * Each part gets its own vertices, so parts keep clean colour edges.
 */
export function modelShape(m, params = {}) {
  if (params.model === undefined) throw new Error('model: params.model is required (the name of a defined model, or its data)');
  const model = typeof params.model === 'string' ? shared.get(params.model) : params.model;
  if (typeof params.model !== 'string') { const errors = validateModel(model); if (errors.length) throw new Error(`model: params.model is not usable:\n- ${errors.join('\n- ')}`); }
  if (params.anchor !== undefined && params.anchor !== 'base' && params.anchor !== 'origin') throw new Error(`model: "anchor" must be "base" or "origin", got ${JSON.stringify(params.anchor)}`);
  if (params.anchor === 'origin' && !model.anchor) throw new Error(`model: "${model.name}" has no "anchor" (it was imported before kit pieces kept their origin). Import its pack again with "kiln import".`);
  const [ax, ay, az] = params.anchor === 'origin' ? model.anchor : [0, 0, 0];
  const hexes = modelColors(model, params);
  const rgb = hexes.map((h) => parseHex(h));
  const nv = model.verts.length / 3;
  const partOf = new Int32Array(nv).fill(-1);
  for (let i = 0; i < model.faces.length; i += 4) { const p = model.faces[i + 3]; partOf[model.faces[i]] = p; partOf[model.faces[i + 1]] = p; partOf[model.faces[i + 2]] = p; }
  const base = m.verts.length;
  for (let i = 0; i < nv; i++) {
    const p = partOf[i] < 0 ? 0 : partOf[i];
    m.tones[m.verts.length] = hexes[p];
    m.verts.push([(model.verts[i * 3] - ax) / 1000, (model.verts[i * 3 + 1] - ay) / 1000, (model.verts[i * 3 + 2] - az) / 1000 * ZS, rgb[p][0], rgb[p][1], rgb[p][2]]);
  }
  for (let i = 0; i < model.faces.length; i += 4) m.faces.push([base + model.faces[i], base + model.faces[i + 1], base + model.faces[i + 2]]);
  let at = base;
  for (const count of model.groups ?? [nv]) { m.parts.push([at, at + count]); at += count; }
  return m;
}
