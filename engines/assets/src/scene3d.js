// 3D scenes for the Asciicker backend. Pure functions: turn a Kiln scene description (JSON) into
// the text the headless renderer reads plus the PLY meshes it needs, and turn its cell output back
// into Kiln's character grids. All terrain and objects are generated here; no Asciicker assets.
import { parseHex } from './color.js';
import { SHAPE_NAMES, shapePly, shapeSize, HUMAN_HEIGHT } from './scene-shapes.js';
import { defineModel, hasModel, validateModel } from './model.js';
import { expandTiles } from './scene-tiles.js';
import { SURFACE_NAMES } from './scene-materials.js';
import { validateSetting } from './scene-sky.js';
import { SCENE_STYLE_NAMES } from './scene-grade.js';

/** CP437 code page as Unicode, index = glyph code. */
export const CP437 = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** All 256 xterm colours as hex, index = colour code. */
export function xterm256() {
  const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const base = ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5', '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff'];
  const out = [...base];
  // Asciicker addresses the cube in even 51-steps (0, 51, ... 255), so use that ramp
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) out.push(hex(r * 51, g * 51, b * 51));
  for (let i = 0; i < 24; i++) out.push(hex(8 + i * 10, 8 + i * 10, 8 + i * 10));
  return out;
}

export { SHAPE_NAMES, shapePly };

/** Terrain height (in Asciicker z units, 16 per cell) at world x, y, as a whole number like the renderer's ground. */
export function terrainHeight(terrain, x, y) {
  return Math.round(terrainSurface(terrain, x, y));
}

/** The smooth hill surface behind terrainHeight (not rounded); used for lighting. */
export function terrainSurface(terrain, x, y) {
  if (!terrain) return 0;
  const { base = 32, amp = 24, scale = 14, seed = 1 } = terrain.hills ?? {};
  const a = seed * 1.7;
  // terrain.grid replaces the built-in hills with heights given by the caller (for example a world generator)
  let h = terrain.grid ? gridSurface(terrain.grid, x, y) : base + amp * (Math.sin(x / scale + a) * Math.cos(y / (scale * 1.3) - a) * 0.6 + Math.sin((x + y) / (scale * 0.55) + a * 2) * 0.25);
  for (const fl of terrain.flatten ?? []) {
    const d = Math.hypot(x - fl.at[0], y - fl.at[1]);
    const t = Math.min(1, Math.max(0, (d - fl.radius) / (fl.blend ?? 4)));
    h = (fl.height ?? base) * (1 - t) + h * t;
  }
  return Math.max(0, h);
}

/**
 * Height from terrain.grid = { step, cols, rows, heights }: heights[j * cols + i] is the height at
 * x = i * step, y = j * step. Blended in a straight line between samples, held at the edges.
 */
function gridSurface(grid, x, y) {
  const { step, cols, rows, heights } = grid;
  const gx = Math.min(cols - 1, Math.max(0, x / step));
  const gy = Math.min(rows - 1, Math.max(0, y / step));
  const i = Math.min(cols - 2, Math.floor(gx));
  const j = Math.min(rows - 2, Math.floor(gy));
  const tx = gx - i;
  const ty = gy - j;
  const at = (ii, jj) => heights[jj * cols + ii];
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
}

/** The scene's detail level: how many characters each unit of "size" becomes (default 2). */
export function sceneDetail(scene) {
  return scene.detail ?? 2;
}

/**
 * Limits for the renderer itself. It drops triangles that cover too much of the picture (the ground
 * vanishes a little above camera zoom x detail = 40), and its memory grows with the picture, so finer
 * pictures are rendered at a half, quarter or eighth and enlarged by Kiln before lighting.
 */
export const RENDER_ZOOM_MAX = 32;
export const RENDER_CELLS_MAX = 2500000;

/**
 * How a detail level is produced: the renderer draws at `detail` and Kiln enlarges `scale` times
 * (1, 2, 4 or 8) before lighting.
 */
export function renderPlan(scene) {
  const d = sceneDetail(scene);
  const z = scene.camera?.zoom ?? 1;
  const cells = (k) => Math.round(scene.size[0] * d / k) * Math.round(scene.size[1] * d / k);
  let scale = 1;
  while (scale < 8 && (z * d / scale > RENDER_ZOOM_MAX || cells(scale) > RENDER_CELLS_MAX)) scale *= 2;
  return { detail: d / scale, scale };
}

/** Characters the renderer draws: [columns, rows]. */
export function renderCells(scene) {
  const { detail } = renderPlan(scene);
  return [Math.round(scene.size[0] * detail), Math.round(scene.size[1] * detail)];
}

/** Characters in the finished picture: [columns, rows] = size x detail. */
export function sceneCells(scene) {
  const { scale } = renderPlan(scene);
  const [c, r] = renderCells(scene);
  return [c * scale, r * scale];
}

/**
 * Add the models a scene carries under "models" (data, not file names) to the shared library, so
 * its objects can name them. Every entry point calls this; unsound entries are left for validateScene to report.
 */
export function useSceneModels(scene) {
  // an entry is a model's data, or { as: "pack/name", model: data } to give it the name the scene uses
  for (const e of Array.isArray(scene?.models) ? scene.models : []) {
    const m = e && typeof e === 'object' && e.kiln !== 'model' && e.model ? e.model : e;
    if (m && typeof m === 'object' && validateModel(m).length === 0) { try { defineModel(m, m === e ? undefined : e.as); } catch { /* validateScene reports it */ } }
  }
}

export function validateScene(scene) {
  const errors = [];
  if (!scene || typeof scene !== 'object') return ['Scene must be a JSON object.'];
  const [w, h] = scene.size ?? [];
  if (!(Number.isInteger(w) && Number.isInteger(h) && w >= 8 && h >= 8 && w <= 400 && h <= 300)) errors.push('"size" must be [columns, rows], from 8x8 to 400x300.');
  const mats = Object.keys(scene.materials ?? {});
  if (scene.terrain) {
    const [px, py] = scene.terrain.patches ?? [];
    if (!(Number.isInteger(px) && Number.isInteger(py) && px >= 1 && py >= 1 && px * py <= 1024)) errors.push('"terrain.patches" must be [x, y] patch counts (each patch is 8x8 units, at most 1024 patches).');
    if (mats.length === 0 || mats.length > 250) errors.push('"materials" must name 1 to 250 materials when there is terrain.');
    const tg = scene.terrain.grid;
    if (tg !== undefined && !(tg && tg.step > 0 && Number.isInteger(tg.cols) && Number.isInteger(tg.rows) && tg.cols >= 2 && tg.rows >= 2 && Array.isArray(tg.heights) && tg.heights.length === tg.cols * tg.rows)) errors.push('"terrain.grid" must be { step, cols, rows, heights } with cols x rows heights (at least 2 x 2).');
    const tc = scene.terrain.cells;
    if (tc !== undefined && !(tc && Number.isInteger(tc.cols) && Number.isInteger(tc.rows) && Array.isArray(tc.materials) && tc.materials.every((m) => mats.includes(m)) && tc.data && tc.data.length === tc.cols * tc.rows)) errors.push('"terrain.cells" must be { cols, rows, materials, data }: one index into its "materials" (names from "materials") for every 1 x 1 unit of ground.');
  }
  for (const [name, m] of Object.entries(scene.materials ?? {})) {
    try { parseHex(m.fg); parseHex(m.bg); } catch { errors.push(`materials.${name}: "fg" and "bg" must be hex colours.`); }
    if (typeof m.glyph !== 'string' || !CP437.includes(m.glyph) || [...m.glyph].length !== 1) errors.push(`materials.${name}: "glyph" must be one CP437 character.`);
    if (m.grass !== undefined && !(typeof m.grass === 'number' && m.grass >= 0 && m.grass <= 1.5)) errors.push(`materials.${name}: "grass" must be a number from 0 (none) to 1.5.`);
    if (m.surface !== undefined && !SURFACE_NAMES.includes(m.surface)) errors.push(`materials.${name}: unknown "surface" "${m.surface}". Known: ${SURFACE_NAMES.join(', ')}.`);
  }
  if (scene.detail !== undefined && !(typeof scene.detail === 'number' && scene.detail >= 1 && scene.detail <= 64)) errors.push('"detail" must be a number from 1 to 64 (default 2).');
  else if ((scene.camera?.zoom ?? 1) * sceneDetail(scene) > RENDER_ZOOM_MAX * 8) errors.push(`camera "zoom" times "detail" must stay within ${RENDER_ZOOM_MAX * 8} (it is ${(scene.camera?.zoom ?? 1) * sceneDetail(scene)}).`);
  else if (Number.isInteger(w) && Number.isInteger(h) && Math.max(w, h) * sceneDetail(scene) > 4096) errors.push(`"size" times "detail" must stay within 4096 characters each way (it is ${Math.max(w, h) * sceneDetail(scene)}). Lower "detail" or "size".`);
  if (scene.depth !== undefined && typeof scene.depth !== 'boolean') errors.push('"depth" must be true or false.');
  errors.push(...validateSetting(scene));
  if (scene.style !== undefined && !SCENE_STYLE_NAMES.includes(scene.style)) errors.push(`"style" must be one of ${SCENE_STYLE_NAMES.join(', ')} (leave it out for the plain look).`);
  if (scene.draw !== undefined && scene.draw !== 'kiln' && scene.draw !== 'asciicker') errors.push('"draw" must be "kiln" or "asciicker" (default: "kiln" for scenes stored as a picture, "asciicker" for text).');
  const sh = scene.shading;
  if (sh !== undefined && sh !== false && sh !== 'classic' && sh !== 'smooth' && (typeof sh !== 'object' || sh === null || Array.isArray(sh))) errors.push('"shading" must be "smooth" (default), "classic" or an object such as { "shadows": 0.75, "occlusion": 0.5 }.');
  if (scene.frames !== undefined && !(Number.isInteger(scene.frames) && scene.frames >= 1 && scene.frames <= 64)) errors.push('"frames" must be a whole number from 1 to 64.');
  for (const [i, p] of (scene.terrain?.paint ?? []).entries()) if (!mats.includes(p.material)) errors.push(`terrain.paint[${i}]: unknown material "${p.material}".`);
  useSceneModels(scene);
  // "models": the imported models this scene uses, as data. They join the shared library here, so the
  // objects below (and every later step) can name them. File names are opened by the command line only.
  if (scene.models !== undefined && !Array.isArray(scene.models)) errors.push('"models" must be a list of models (the JSON of .kmodel.json files; the kiln command line also takes file and folder names).');
  for (const [i, m] of (Array.isArray(scene.models) ? scene.models : []).entries()) {
    if (typeof m === 'string') { errors.push(`models[${i}]: "${m}" is a file name. Only the kiln command line opens files; in code, read the file and pass its JSON.`); continue; }
    const wrapped = m && typeof m === 'object' && m.kiln !== 'model' && m.model !== undefined;
    if (wrapped && (typeof m.as !== 'string' || !/^[a-z0-9][a-z0-9_/-]*$/.test(m.as))) { errors.push(`models[${i}]: "as" must be the name the scene uses for the model (lowercase letters, digits, "_", "-", "/").`); continue; }
    const bad = validateModel(wrapped ? m.model : m);
    if (bad.length) errors.push(`models[${i}]: ${bad[0]}`);
  }
  // "tiles": layouts of kit pieces (see scene-tiles.js); checked as the objects they become
  let objects = scene.objects ?? [];
  if (scene.tiles !== undefined || scene.prefabs !== undefined) { try { objects = expandTiles(scene).objects; } catch (e) { errors.push(e.message); } }
  for (const [i, o] of objects.entries()) {
    if (!SHAPE_NAMES.includes(o.shape)) errors.push(`objects[${i}]: unknown shape "${o.shape}". Known: ${SHAPE_NAMES.join(', ')}.`);
    else if (o.shape === 'model') {
      const ref = o.params?.model;
      if (ref === undefined) { errors.push(`objects[${i}]: a "model" needs params.model, the name of an imported model.`); continue; }
      if (typeof ref === 'string' && !hasModel(ref)) { errors.push(`objects[${i}]: unknown model "${ref}". List its file under "models" in the scene, or call defineModel first.`); continue; }
    }
    if (!Array.isArray(o.at) || o.at.length !== 2) errors.push(`objects[${i}]: "at" must be [x, y].`);
    if (o.scale !== undefined && !(typeof o.scale === 'number' && o.scale > 0)) errors.push(`objects[${i}]: "scale" must be a number above 0.`);
    if (o.height !== undefined && !(typeof o.height === 'number' && o.height > 0)) errors.push(`objects[${i}]: "height" must be a number above 0 (metres).`);
    if (o.height !== undefined && o.scale !== undefined) errors.push(`objects[${i}]: give "scale" or "height", not both.`);
    for (const [k, v] of [...Object.entries(o.animate ?? {}).filter(([key]) => key !== 'params'), ...Object.entries(o.animate?.params ?? {})]) if (!(Array.isArray(v) && v.length === 2)) errors.push(`objects[${i}].animate.${k}: must be [from, to].`);
  }
  if (scene.sky !== undefined && scene.sky !== 'clear') { try { parseHex(scene.sky.bg); if (scene.sky.fg) parseHex(scene.sky.fg); } catch { errors.push('"sky" must be "clear" or { bg, fg, glyph } with hex colours.'); } }
  if (!Array.isArray(scene.camera?.at) || scene.camera.at.length !== 2) errors.push('"camera.at" must be [x, y], the ground point to look at.');
  return errors;
}

/**
 * The scene as it is at one animation frame: every `animate` range on an object ([from, to] for
 * `at`, `yaw`, `scale`, `lift` and numbers in `params`) is replaced by its value at t = frame / frames.
 */
export function sceneAtFrame(sceneIn, frame = 0) {
  if (sceneIn.tiles !== undefined || sceneIn.prefabs !== undefined) useSceneModels(sceneIn);
  const scene = expandTiles(sceneIn); // "tiles" layouts become objects here, so every renderer sees plain objects
  const n = scene.frames ?? 1;
  const t = n > 1 ? (frame % n) / n : 0;
  const lerp = ([a, b]) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * t) : a + (b - a) * t);
  // "height" (metres) is another way to give the scale: the shape is sized to stand that tall
  const sized = (o) => {
    if (typeof o.height !== 'number' || !SHAPE_NAMES.includes(o.shape)) return o;
    const { height, ...rest } = o;
    return { ...rest, scale: height / shapeSize(o.shape, o.params ?? {}).height };
  };
  const objects = (scene.objects ?? []).map((o0) => {
    const o = sized(o0);
    if (!o.animate) return o;
    const out = { ...o, params: { ...(o.params ?? {}) } };
    for (const [k, v] of Object.entries(o.animate)) {
      if (k === 'params') for (const [pk, pv] of Object.entries(v)) out.params[pk] = lerp(pv);
      else out[k] = lerp(v);
    }
    delete out.animate;
    return out;
  });
  return { ...scene, objects };
}

/**
 * How big every object of a scene stands in the world, to check proportions: one row per object
 * with its size in metres after scale, its height in standing adults, and a `note` when it looks
 * out of proportion (a character far from adult height, or a building or prop scaled a lot).
 * @returns {Array<{index:number, shape:string, scale:number, width:number, depth:number, height:number, people:number, note:string}>}
 */
export function sceneSizes(scene) {
  const characters = ['villager', 'knight', 'skeleton'];
  const anySize = ['tree', 'pine', 'oak', 'rock', 'haystack', 'box', 'ruin', 'model']; // no doors or other person-sized details
  const r = (v) => Math.round(v * 100) / 100;
  return sceneAtFrame(scene, 0).objects.filter((o) => SHAPE_NAMES.includes(o.shape)).map((o, index) => {
    const s = shapeSize(o.shape, o.params ?? {});
    const scale = o.scale ?? 1;
    const height = s.height * scale;
    let note = '';
    if (characters.includes(o.shape) && (height < HUMAN_HEIGHT * 0.8 || height > HUMAN_HEIGHT * 1.45)) note = `a person is about ${HUMAN_HEIGHT} m tall; this one is ${r(height)} m`;
    else if (!anySize.includes(o.shape) && (scale < 0.5 || scale > 2)) note = `scaled ${r(scale)} times its built size; doors and details scale with it`;
    return { index, shape: o.shape, scale: r(scale), width: r(s.width * scale), depth: r(s.depth * scale), height: r(height), people: r(height / HUMAN_HEIGHT), note };
  });
}

/** How far above the scene the camera target handed to the renderer is moved (height units); see cameraTarget. */
export const CAMERA_RAISE = 2048;

/**
 * The camera target handed to the Asciicker renderer: [x, y, z]. The renderer expects a player to
 * stand at the target and darkens the ground within about 1.4 units of it as that player's shadow
 * (only where the ground is within 64 height units of the target), which showed as a small dark
 * column in the middle of every picture. The straight-on camera shows the same picture from any
 * target on the same line of sight, so the target is slid up that line, far above the scene, where
 * no ground is near it. Perspective cameras keep their target (and that shadow).
 */
export function cameraTarget(scene) {
  const cam = scene.camera;
  const [cx, cy] = cam.at;
  const cz = terrainHeight(scene.terrain, cx, cy) + (cam.lift ?? 0);
  if (cam.perspective) return [cx, cy, cz];
  // the line of sight rises 30 degrees: 16 height units up for every 16 / tan 30 along the ground towards the eye
  const a = (cam.yaw ?? 45) * Math.PI / 180;
  const back = CAMERA_RAISE / 16 / Math.tan(Math.PI / 6);
  return [cx + Math.sin(a) * back, cy - Math.cos(a) * back, cz + CAMERA_RAISE];
}

/**
 * Build the renderer input for one frame.
 * @returns {{text:string, meshes:Object<string,string>}} scene text and PLY files by file name.
 */
export function buildSceneInput(sceneIn, frame = 0) {
  const errors = validateScene(sceneIn);
  if (errors.length) throw new Error('Invalid scene:\n- ' + errors.join('\n- '));
  const scene = sceneAtFrame(sceneIn, frame);
  const [cols, rows] = renderCells(scene);
  const lines = [`size ${cols} ${rows}`];
  const cam = scene.camera;
  const [cx, cy] = cam.at;
  lines.push(`camera ${cameraTarget(scene).map((v) => Math.round(v * 1e4) / 1e4).join(' ')} ${cam.yaw ?? 45} ${(cam.zoom ?? 1) * renderPlan(scene).detail} ${cam.perspective ? 1 : 0}`);
  // The renderer stores brightness in one byte, so the direction must be unit length or lit slopes wrap to black.
  const lt = scene.light ?? [1, 0.4, 1, 0.5];
  const ln = Math.hypot(lt[0], lt[1], lt[2]) || 1;
  // With Kiln's own shading (the default) the renderer is asked for unlit colours: light from straight
  // above at full ambient, and material shade steps all at full brightness. scene-shade.js lights it.
  const unlit = scene.shading !== 'classic' && scene.shading !== false;
  if (unlit) lines.push('light 0 0 1 1', 'ramp 1 1');
  else lines.push(`light ${[lt[0] / ln, lt[1] / ln, lt[2] / ln].map((v) => v.toFixed(4)).join(' ')} ${Math.min(1, Math.max(0, lt[3] ?? 0.5))}`);
  if (typeof scene.water === 'number') lines.push(`water ${scene.water}`);
  const matId = {};
  Object.entries(scene.materials ?? {}).forEach(([name, m], i) => {
    matId[name] = i + 1;
    lines.push(`mat ${i + 1} ${parseHex(m.fg).join(' ')} ${CP437.indexOf(m.glyph)} ${parseHex(m.bg).join(' ')}`);
  });
  const paint = scene.terrain?.paint ?? [{ material: Object.keys(scene.materials ?? {})[0] }];
  const cells = scene.terrain?.cells ?? null; // a material for every 1 x 1 unit of ground, given by the caller
  const materialAt = (x, y) => {
    if (cells && x >= 0 && y >= 0 && x < cells.cols && y < cells.rows) return matId[cells.materials[cells.data[Math.floor(y) * cells.cols + Math.floor(x)]]];
    let id = matId[paint[0].material];
    const h = terrainHeight(scene.terrain, x, y);
    for (const p of paint) {
      if (p.above !== undefined && h < p.above) continue;
      if (p.below !== undefined && h > p.below) continue;
      if (p.rect && !(x >= p.rect[0] && y >= p.rect[1] && x < p.rect[2] && y < p.rect[3])) continue;
      if (p.near && Math.hypot(x - p.near[0], y - p.near[1]) > p.near[2]) continue;
      id = matId[p.material];
    }
    return id;
  };
  const [npx, npy] = scene.terrain?.patches ?? [0, 0];
  for (let py = 0; py < npy; py++) {
    for (let px = 0; px < npx; px++) {
      const hs = [];
      for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) hs.push(terrainHeight(scene.terrain, px * 8 + i * 2, py * 8 + j * 2));
      const vs = [];
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) vs.push(materialAt(px * 8 + i + 0.5, py * 8 + j + 0.5));
      lines.push(`patch ${px} ${py} ${hs.join(' ')} ${vs.join(' ')}`);
    }
  }
  const meshes = {};
  const rzoom = (cam.zoom ?? 1) * renderPlan(scene).detail;
  (scene.objects ?? []).forEach((o, i) => {
    // the renderer drops very large triangles, so big faces are split; the limit halves in steps so
    // objects of similar size still share a mesh
    const maxEdge = 2 ** Math.floor(Math.log2(70 / (rzoom * (o.scale ?? 1))));
    const key = JSON.stringify([o.shape, o.params ?? {}, maxEdge]);
    let file = Object.keys(meshes).find((k) => meshes[k].key === key);
    if (!file) {
      file = `m${Object.keys(meshes).length}.ply`;
      meshes[file] = { key, ply: shapePly(o.shape, o.params ?? {}, maxEdge) };
      lines.push(`mesh ${file.replace('.ply', '')} ${file}`);
    }
    const s = o.scale ?? 1;
    lines.push(`inst ${file.replace('.ply', '')} ${o.at[0]} ${o.at[1]} ${terrainHeight(scene.terrain, o.at[0], o.at[1]) + (o.lift ?? 0)} ${o.yaw ?? 0} ${s} ${s}`);
    void i;
  });
  return { text: lines.join('\n') + '\n', meshes: Object.fromEntries(Object.entries(meshes).map(([k, v]) => [k, v.ply])) };
}

/**
 * Parse the renderer's cell file into Kiln's grid format (same shape as ascii.json sprites, with
 * colours as indexes into xterm256()). `hit[i]` is 1 where the scene covers the cell.
 * @param {Uint8Array} bytes
 * @param {{sky?: {bg:string, fg?:string, glyph?:string}|'clear'}} [opts]  Recolour the empty backdrop
 *   (nearest xterm colour), or 'clear' to make it transparent (colour -1).
 * The result also has `height`: per cell, the world height of the drawn surface (null where there is none).
 */
export function parseCells(bytes, opts = {}) {
  const magic = bytes.length >= 8 ? String.fromCharCode(...bytes.subarray(0, 4)) : '';
  if (magic !== 'KAC2' && magic !== 'KAC3') throw new Error('parseCells: not a Kiln/Asciicker cell file');
  const stride = magic === 'KAC3' ? 8 : 4; // KAC3 adds a float32 surface height to every cell
  const cols = bytes[4] | (bytes[5] << 8);
  const rows = bytes[6] | (bytes[7] << 8);
  if (bytes.length !== 8 + cols * rows * stride) throw new Error(`parseCells: expected ${8 + cols * rows * stride} bytes for ${cols}x${rows}, got ${bytes.length}`);
  const dv = stride === 8 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
  const sky = opts.sky;
  const skyCell = sky && sky !== 'clear' ? { bg: nearestXterm(sky.bg), fg: nearestXterm(sky.fg ?? sky.bg), ch: sky.glyph ?? ' ' } : null;
  const grid = { cols, rows, ch: [], fg: [], bg: [], hit: [], height: [] };
  // In 'clear' mode, silhouette cells are half scene and half backdrop. Find the backdrop colours
  // and make those halves transparent too, so sprites have no coloured fringe.
  const fringe = new Set();
  if (sky === 'clear') {
    xtermRgb ??= xterm256().map(parseHex);
    const back = new Set();
    for (let i = 0; i < cols * rows; i++) if (!bytes[8 + i * stride + 3]) { back.add(bytes[8 + i * stride]); back.add(bytes[8 + i * stride + 1]); }
    for (let c = 16; c < 256; c++) for (const b of back) if (Math.hypot(...xtermRgb[c].map((v, k) => v - xtermRgb[b][k])) <= 30) fringe.add(c);
  }
  const SWAP = { '▀': '▄', '▄': '▀', '▌': '▐', '▐': '▌' };
  for (let y = 0; y < rows; y++) {
    let row = '';
    for (let x = 0; x < cols; x++) {
      const o = 8 + (y * cols + x) * stride;
      const gl = bytes[o + 2];
      const hit = bytes[o + 3] ? 1 : 0;
      grid.hit.push(hit);
      const z = dv ? dv.getFloat32(o + 4, true) : NaN;
      grid.height.push(z > -1e5 && z < 1e5 ? z : null); // null: the renderer drew no surface here
      if (!hit && sky === 'clear') { row += ' '; grid.fg.push(-1); grid.bg.push(-1); continue; }
      if (!hit && skyCell) { row += skyCell.ch; grid.fg.push(skyCell.fg); grid.bg.push(skyCell.bg); continue; }
      let ch = gl === 0 || gl === 255 ? ' ' : CP437[gl];
      let fg = bytes[o];
      let bg = bytes[o + 1];
      if (fringe.size) {
        const half = SWAP[ch] !== undefined;
        if (fringe.has(bg) && (fringe.has(fg) || !half)) { ch = ' '; fg = -1; bg = -1; }
        else if (fringe.has(bg)) bg = -1;
        else if (fringe.has(fg) && half) { ch = SWAP[ch]; fg = bg; bg = -1; }
        else if (fringe.has(fg)) { ch = ' '; fg = bg; }
      }
      row += ch;
      grid.fg.push(fg);
      grid.bg.push(bg);
    }
    grid.ch.push(row);
  }
  return grid;
}

let xtermRgb = null;
/** Index of the xterm colour closest to a hex colour (colour cube and greys only, so it is stable). */
export function nearestXterm(hex) {
  xtermRgb ??= xterm256().map(parseHex);
  const [r, g, b] = parseHex(hex);
  let best = 16;
  let bestD = Infinity;
  for (let i = 16; i < 256; i++) {
    const c = xtermRgb[i];
    const d = (c[0] - r) ** 2 * 0.3 + (c[1] - g) ** 2 * 0.59 + (c[2] - b) ** 2 * 0.11;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Wrap one rendered grid in the same structure as ascii.json, so toAnsi() and game code can read it. */
export function sceneGrids(grid, name = 'scene') {
  return { kiln: 1, renderer: 'asciicker', palette: xterm256(), sprites: { [name]: { cols: grid.cols, rows: grid.rows, ch: grid.ch, fg: grid.fg, bg: grid.bg } } };
}
