// "tiles" and "prefabs": kit pieces laid out on a grid, written as rows of short names like a map.
// A scene's "tiles" lists layouts; each becomes ordinary "model" objects placed by the pack's own origin
// (params.anchor "origin"), a cell apart, so walls, roads, floors and hex tiles meet without gaps.
// Pure: no DOM, no Node, no dependencies beyond the model library.
//
//   "tiles": [{
//     "at": [10, 10],                  the middle of the bottom-left cell, in ground units (metres)
//     "cell": 2.7,                     metres per cell; left out, the first piece that carries a "grid" gives it
//     "kind": "square",                or "hex" (six-sided tiles with a point towards +y, rows shifted half a cell)
//     "lift": 0.07,                    metres above the ground (default 7 cm, hex tiles 30 cm, so flat tops and water show); raise it for an upper storey or a roof
//     "key": { "w": "wall", "v": "wall:90", "d": { "model": "wall_door", "yaw": 90, "lift": 0, "offset": [0, 0] }, "t": ["road", "lantern"] },
//     "rows": ["w  w  d  w", ".  .  t  ."],   top row first (the far side, largest y); "." or "-" is an empty cell
//     "params": { "style": "storybook" }     shared model params (style, tint, colors)
//     "pack": "kenney-castle-kit"            names are looked up as "<pack>/<name>" first (models named with their pack)
//   }]
// A cell names a key or a model directly, and may end in ":90" to turn the piece that many degrees
// (counter-clockwise seen from above, added to the key's own yaw). A key entry may be a list: all of it shares the cell.
import { getModel, hasModel } from './model.js';

const ZS = 16; // height units per metre
const HEX_ROW = Math.sqrt(3) / 2;

function pieces(entry, where) {
  const list = Array.isArray(entry) ? entry : [entry];
  return list.map((e) => {
    if (typeof e === 'string') { const t = /^(.*?):(-?\d+(?:\.\d+)?)$/.exec(e); return t ? { model: t[1], yaw: Number(t[2]) } : { model: e }; } // "wall:90" is the wall turned 90 degrees
    if (e && typeof e === 'object' && typeof e.model === 'string') return e;
    throw new Error(`${where}: a piece must be a model name or { "model": name, "yaw", "lift", "offset": [x, y], "anchor", "scale", "params" }, got ${JSON.stringify(e)}`);
  });
}

/**
 * The scene objects of one tiles layout (see the top of this file).
 * @param {object} layout
 * @param {{ get?: (name: string) => object, has?: (name: string) => boolean }} [library]  Where models are looked up (default: the shared library).
 * @returns {Array<object>} "model" objects, row by row from the far side.
 */
export function tileObjects(layout, library = {}) {
  const fn = 'tiles';
  const get = library.get ?? getModel; const has = library.has ?? hasModel;
  if (!layout || typeof layout !== 'object') throw new Error(`${fn}: a layout must be an object with "at" and "rows"`);
  if (!Array.isArray(layout.at) || layout.at.length !== 2 || !layout.at.every((v) => Number.isFinite(v))) throw new Error(`${fn}: "at" must be [x, y], the middle of the bottom-left cell, got ${JSON.stringify(layout.at)}`);
  if (!Array.isArray(layout.rows) || layout.rows.length === 0 || !layout.rows.every((r) => typeof r === 'string' || Array.isArray(r))) throw new Error(`${fn}: "rows" must be a list of rows, each a string of names with spaces between ("w w d w") or a list`);
  if (layout.kind !== undefined && layout.kind !== 'square' && layout.kind !== 'hex') throw new Error(`${fn}: "kind" must be "square" or "hex", got ${JSON.stringify(layout.kind)}`);
  if (layout.cell !== undefined && !(layout.cell > 0)) throw new Error(`${fn}: "cell" must be a number above 0 (metres), got ${JSON.stringify(layout.cell)}`);
  const key = layout.key ?? {};
  // "pack": models named with their pack ("kenney-castle-kit/wall") are found by their short name
  const q = (name) => (layout.pack && has(`${layout.pack}/${name}`) ? `${layout.pack}/${name}` : name);
  const rows = layout.rows.map((r) => (Array.isArray(r) ? r : r.trim().split(/\s+/)));
  const cells = [];
  rows.forEach((row, r) => row.forEach((token, c) => {
    if (token === '.' || token === '-' || token === '' || token === null) return;
    const m = /^(.*?)(?::(-?\d+(?:\.\d+)?))?$/.exec(String(token));
    const name = m[1]; const turn = m[2] !== undefined ? Number(m[2]) : 0;
    const where = `${fn}: row ${r + 1}, cell ${c + 1} ("${token}")`;
    if (!Object.hasOwn(key, name) && !has(q(name))) throw new Error(`${where}: "${name}" is neither in "key" nor a defined model. Keys: ${Object.keys(key).join(', ') || 'none'}`);
    cells.push({ r, c, turn, where, list: pieces(Object.hasOwn(key, name) ? key[name] : name, where) });
  }));
  if (cells.length === 0) return [];
  for (const cell of cells) cell.list = cell.list.map((p) => ({ ...p, model: q(p.model) }));
  for (const cell of cells) for (const p of cell.list) if (!has(p.model)) throw new Error(`${cell.where}: unknown model "${p.model}". List its file under "models" in the scene, or call defineModel first.`);
  // the spacing: the layout's own, else the grid of the first piece that carries one
  let grid = null;
  for (const c of cells) { for (const p of c.list) { const g = get(p.model).grid; if (g) { grid = g; break; } } if (grid) break; }
  const cell = layout.cell ?? grid?.cell;
  if (!(cell > 0)) throw new Error(`${fn}: give "cell" (metres per cell): none of the pieces carries a grid of its own`);
  const kind = layout.kind ?? grid?.kind ?? 'square';
  // a little above the ground by default (7 cm, just over one step of the renderer's heights; 30 cm for hex tiles, whose top is level with their origin and whose water lies below it): a flat floor
  // or tile top lying exactly in the ground would be lost in it
  const lift = (layout.lift ?? (kind === 'hex' ? 0.3 : 0.07)) * ZS;
  const out = [];
  for (const { r, c, turn, list } of cells) {
    const up = rows.length - 1 - r; // rows are written far side first
    const x = layout.at[0] + (kind === 'hex' ? (c + (up % 2 ? 0.5 : 0)) * cell : c * cell);
    const y = layout.at[1] + (kind === 'hex' ? up * cell * HEX_ROW : up * cell);
    for (const p of list) {
      const yaw = (p.yaw ?? 0) + turn;
      // a piece's own offset turns with the cell
      const a = turn * Math.PI / 180; const [ox, oy] = p.offset ?? [0, 0];
      const o = { shape: 'model', at: [Math.round((x + ox * Math.cos(a) - oy * Math.sin(a)) * 1000) / 1000, Math.round((y + ox * Math.sin(a) + oy * Math.cos(a)) * 1000) / 1000] };
      if (yaw) o.yaw = ((yaw % 360) + 360) % 360;
      if (lift || p.lift) o.lift = lift + (p.lift ?? 0) * ZS;
      if (p.scale !== undefined) o.scale = p.scale;
      o.params = { ...(layout.params ?? {}), ...(p.params ?? {}), model: p.model, anchor: p.anchor ?? 'origin' };
      out.push(o);
    }
  }
  return out;
}

/**
 * A prefab is a ready-made piece of scenery built from tiles (a house, a keep, a dungeon room), stored as JSON:
 *   { kiln: 'prefab', name, title, size: [width, depth] metres, models: ['pack/name', ...], tiles: [layout, ...], objects?: [...] }
 * Its layouts' "at" (and its loose objects' "at") are measured from the prefab's own corner (0, 0).
 */
export function validatePrefab(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || data.kiln !== 'prefab') return ['A prefab must be an object with "kiln": "prefab".'];
  if (typeof data.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(data.name)) errors.push('"name" must be lowercase letters, digits, "_" or "-".');
  if (!Array.isArray(data.tiles) || data.tiles.length === 0) errors.push('"tiles" must list at least one layout.');
  if (data.models !== undefined && !(Array.isArray(data.models) && data.models.every((m) => typeof m === 'string'))) errors.push('"models" must list the models it uses as "pack/name".');
  if (data.size !== undefined && !(Array.isArray(data.size) && data.size.length === 2 && data.size.every((v) => v > 0))) errors.push('"size" must be [width, depth] in metres.');
  return errors;
}

/**
 * The tiles layouts and loose objects of a prefab set down with its corner at `at`.
 * @param {object} prefab  The JSON of a prefab file.
 * @param {[number, number]} at  Ground position of the prefab's (0, 0) corner.
 * @param {{ lift?: number, params?: object }} [opts]  lift: metres added to every layout; params: model params (style, tint, colors) for all of it.
 * @returns {{ tiles: object[], objects: object[] }}
 */
export function prefabAt(prefab, at, opts = {}) {
  const errors = validatePrefab(prefab);
  if (errors.length) throw new Error(`prefab: ${prefab?.name ?? 'prefab'} is not usable:\n- ${errors.join('\n- ')}`);
  if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => Number.isFinite(v))) throw new Error(`prefab: "at" must be [x, y], got ${JSON.stringify(at)}`);
  const r = (v) => Math.round(v * 1000) / 1000;
  const tiles = prefab.tiles.map((l) => ({ ...l, at: [r(l.at[0] + at[0]), r(l.at[1] + at[1])], ...(opts.lift ? { lift: (l.lift ?? (l.kind === 'hex' ? 0.3 : 0.07)) + opts.lift } : {}), ...(opts.params ? { params: { ...(l.params ?? {}), ...opts.params } } : {}) }));
  const objects = (prefab.objects ?? []).map((o) => ({ ...o, at: [r(o.at[0] + at[0]), r(o.at[1] + at[1])], ...(opts.lift ? { lift: (o.lift ?? 0) + opts.lift * ZS } : {}) }));
  return { tiles, objects };
}

/**
 * A scene with its "tiles" layouts turned into objects (they come before the scene's own objects).
 * Scenes without "tiles" come back as they are. Models the scene carries as data must be defined first
 * (validateScene and every render entry do that).
 */
export function expandTiles(scene) {
  if (!scene || (scene.tiles === undefined && scene.prefabs === undefined)) return scene;
  if (scene.tiles !== undefined && !Array.isArray(scene.tiles)) throw new Error('"tiles" must be a list of layouts: [{ "at": [x, y], "rows": ["wall wall:90", ...], "key": {...} }]');
  if (scene.prefabs !== undefined && !Array.isArray(scene.prefabs)) throw new Error('"prefabs" must be a list: [{ "prefab": the JSON of a prefab file, "at": [x, y] }]');
  const { tiles, prefabs, ...rest } = scene;
  const layouts = []; const loose = [];
  (prefabs ?? []).forEach((p, i) => {
    if (typeof p?.prefab === 'string' || typeof p?.file === 'string') throw new Error(`prefabs[${i}]: "${p.prefab ?? p.file}" is a name. Only the kiln command line opens files; in code, pass the prefab's JSON as "prefab" (the kiln plugin's prefab() does this for you).`);
    try { const set = prefabAt(p?.prefab, p?.at, { lift: p?.lift, params: p?.params }); layouts.push(...set.tiles.map((l) => [l, `prefabs[${i}]`])); loose.push(...set.objects); } catch (e) { throw new Error(`prefabs[${i}]: ${e.message}`); }
  });
  (tiles ?? []).forEach((l, i) => layouts.push([l, `tiles[${i}]`]));
  const made = layouts.flatMap(([layout, where]) => { try { return tileObjects(layout); } catch (e) { throw new Error(`${where}: ${e.message}`); } });
  return { ...rest, objects: [...made, ...loose, ...(scene.objects ?? [])] };
}
