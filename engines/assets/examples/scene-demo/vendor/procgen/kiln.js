// Generated places as Kiln 3D scenes (the `assets` engine): props become Kiln shapes, a dungeon
// or interior becomes a whole scene file for `kiln scene` / writeScene. Kiln's world scale is
// 1 unit = 1 metre and heights are 16 per metre, the same as procgen's maps with cell = 1.
import { TILE, isWalkable } from './grid.js';

const need = (ok, message) => { if (!ok) throw new Error(message); };
/** Height of Kiln's own `wall` shape, metres. */
const WALL_HEIGHT = 2.75;
const isLayout = (s) => s && (s.kind === 'dungeon' || s.kind === 'interior');
const gen = (describe) => (p) => ({ shape: 'gen', params: { describe, seed: p.seed ?? 1 } });
const box = (w, d, h, color) => () => ({ shape: 'box', params: { size: [w, d, h], ...(color ? { colors: { box: color } } : {}) } });

/**
 * KILN_SHAPES -> { prop: (prop) => { shape, params?, scale? } | null }
 * How each procgen prop is drawn by Kiln. null = not drawn (a rug). Add or replace entries by
 * passing `shapes` to toKilnObjects / toKilnScene.
 */
export const KILN_SHAPES = {
  tent: () => ({ shape: 'tent' }), rock: (p) => ({ shape: 'rock', scale: 0.4, params: { seed: p.seed ?? 1 } }), rubble: (p) => ({ shape: 'rock', scale: 0.2, params: { seed: p.seed ?? 1 } }),
  ruin: (p) => ({ shape: 'ruin', params: { seed: p.seed ?? 1 } }), fence: (p) => ({ shape: 'fence', params: { length: p.length ?? 4 } }), torch: () => ({ shape: 'lamp', scale: 0.7 }),
  crates: gen('crates'), barrels: gen('barrels'), table: gen('table'), bench: gen('bench'), statue: gen('statue'), campfire: gen('campfire'), chest: gen('chest'),
  gravestones: gen('gravestones'), weapon_rack: gen('rack'), anvil: gen('anvil'), woodpile: gen('woodpile'), cauldron: gen('cauldron'), banner: gen('banner'),
  pillar: gen('stone pillar'), altar: gen('altar'), trough: gen('trough'), cart: gen('cart'), stall: gen('stall'),
  bed: box(0.9, 0.9, 8, '#a05a3c'), hearth: box(0.9, 0.7, 26, '#6e6a66'), counter: box(0.9, 0.6, 15, '#8a5a34'), shelf: box(0.9, 0.35, 28, '#7a5230'), rug: () => null,
};

const hash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 100000; };

/**
 * toKilnObjects(source, options) -> [{ shape, at: [x, y], yaw, scale?, params? }, ...]
 * The scenery (and chests) of a dungeon, interior or camp as Kiln scene objects.
 *   options.origin   { x, y } in scene units: the map's top-left corner, or the camp's centre. Default 0, 0.
 *   options.shapes   extra or replacement entries for KILN_SHAPES
 *   options.walls    dungeons and interiors: also the walls, as `wall` shapes. Default true.
 *   options.wallHeight   metres. Default 2.75 (Kiln's own wall). Lower walls are also thinner (1.2 m at full height).
 */
export function toKilnObjects(source, options = {}) {
  need(source && (isLayout(source) || source.kind === 'camp'), 'toKilnObjects: the first argument must be a dungeon, an interior or a camp');
  const shapes = { ...KILN_SHAPES, ...(options.shapes ?? {}) };
  const ox = options.origin?.x ?? 0; const oy = options.origin?.y ?? 0;
  const layout = isLayout(source); const cell = layout ? source.cell : 1;
  const at = (t) => (layout ? [ox + (t.x + 0.5) * cell, oy + (t.y + 0.5) * cell] : [Math.round((ox + t.x) * 100) / 100, Math.round((oy + t.y) * 100) / 100]);
  const out = [];
  const put = (prop, thing) => {
    const make = shapes[prop];
    if (!make) return;
    const made = make({ ...thing, seed: hash(thing.id) });
    if (made) out.push({ ...made, at: at(thing), yaw: thing.yaw ?? 0 });
  };
  for (const p of source.props) put(p.prop, p);
  for (const l of source.loot) if (l.container === 'chest' && !l.prop) put('chest', l);
  if (layout && (options.walls ?? true)) {
    // Kiln's wall is 2.75 m high and 1.2 m thick; a lower wall is the same shape scaled down, so
    // its length is given longer by the same factor, plus the bit that closes the corners.
    const scale = (options.wallHeight ?? WALL_HEIGHT) / WALL_HEIGHT;
    const thick = 1.2 * scale;
    for (const w of wallRuns(source)) {
      const mid = (w.n - 1) / 2;
      const length = Math.round(((w.n * cell + Math.max(0, cell - thick)) / scale) * 100) / 100;
      out.push({ shape: 'wall', at: at({ x: w.x + (w.vertical ? 0 : mid), y: w.y + (w.vertical ? mid : 0) }), yaw: w.vertical ? 90 : 0, ...(scale !== 1 ? { scale: Math.round(scale * 1000) / 1000 } : {}), params: { length } });
    }
  }
  return out;
}

/** wallRuns(layout) -> [{ x, y, n, vertical }] the walls as straight runs, longest pieces first along x. */
export function wallRuns(layout) {
  const { cols, rows, tiles } = layout;
  const left = new Uint8Array(cols * rows);
  for (let i = 0; i < tiles.length; i++) left[i] = tiles[i] === TILE.wall ? 1 : 0;
  const runs = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!left[y * cols + x]) continue;
    let n = 1;
    while (x + n < cols && left[y * cols + x + n]) n++;
    if (n < 2) continue;
    for (let k = 0; k < n; k++) left[y * cols + x + k] = 0;
    runs.push({ x, y, n, vertical: false });
    x += n - 1;
  }
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
    if (!left[y * cols + x]) continue;
    let n = 1;
    while (y + n < rows && left[(y + n) * cols + x]) n++;
    for (let k = 0; k < n; k++) left[(y + k) * cols + x] = 0;
    runs.push({ x, y, n, vertical: true });
    y += n - 1;
  }
  return runs;
}

const LOOKS = {
  crypt: { floor: ['#9999aa', '#666677'], dark: ['#333344', '#1a1a22'], door: ['#996633', '#663300'] },
  storybook: { floor: ['#cc9966', '#996633'], dark: ['#333333', '#1a1a1a'], door: ['#cc9966', '#663300'] },
  nocturne: { floor: ['#666699', '#333366'], dark: ['#1a1a33', '#0d0d1a'], door: ['#996633', '#663300'] },
  papercut: { floor: ['#ffcc99', '#cc9966'], dark: ['#666666', '#333333'], door: ['#cc6633', '#993300'] },
};

/**
 * toKilnScene(layout, options) -> a Kiln scene object (write it as JSON for `kiln scene`, or pass it to writeScene)
 *   options.name     output name. Default the layout id.
 *   options.size     [cols, rows] of the picture in characters. Default [120, 80].
 *   options.detail, options.time, options.style, options.yaw (default 35), options.zoom
 *   options.shapes, options.walls   as in toKilnObjects
 *   options.wallHeight   metres. Default 1.2: low walls, so the floors and what stands on them can be seen.
 *   The camera frames the built part of the map by itself; options.zoom overrides it. Kiln draws +y
 *   away from the viewer, so the picture is the map seen from its far side: place sprites with the
 *   scene view's toPoint, never by hand.
 * The floor is flat; ground materials are 'floor', 'door', 'wall' (the footing under the walls) and 'dark' (the rest).
 */
export function toKilnScene(layout, options = {}) {
  need(isLayout(layout), 'toKilnScene: the first argument must be a dungeon or an interior');
  const style = options.style ?? layout.style ?? 'crypt';
  const look = LOOKS[style] ?? LOOKS.crypt;
  const { cols, rows, cell } = layout;
  const patches = [Math.ceil((cols * cell) / 8), Math.ceil((rows * cell) / 8)];
  const w = patches[0] * 8; const h = patches[1] * 8;
  const data = new Array(w * h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const tx = Math.floor(x / cell); const ty = Math.floor(y / cell);
    const t = tx < cols && ty < rows ? layout.tiles[ty * cols + tx] : TILE.void;
    data[y * w + x] = t === TILE.door ? 2 : t === TILE.wall ? 3 : isWalkable(t) ? 1 : 0;
  }
  const size = options.size ?? [120, 80];
  // Frame what is there: the camera looks at the middle of the built part of the map, half-way up
  // the walls, and zooms so that part fills the picture. Kiln's fixed view shows 1.5 * zoom
  // characters per metre across, 0.75 * zoom per metre of depth and 1.3 * zoom per metre of height.
  let x0 = cols; let y0 = rows; let x1 = 0; let y1 = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (layout.tiles[y * cols + x] !== TILE.void) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  const wallHeight = options.wallHeight ?? 1.2;
  const yaw = options.yaw ?? 35; const rad = (yaw * Math.PI) / 180;
  const hx = ((x1 - x0) * cell) / 2; const hy = ((y1 - y0) * cell) / 2;
  const across = 2 * 1.5 * (Math.abs(Math.cos(rad)) * hx + Math.abs(Math.sin(rad)) * hy);
  const down = 2 * 0.75 * (Math.abs(Math.sin(rad)) * hx + Math.abs(Math.cos(rad)) * hy) + 1.3 * wallHeight;
  const fit = Math.round(Math.min((size[0] * 0.9) / across, (size[1] * 0.9) / down) * 100) / 100;
  const scene = {
    name: options.name ?? layout.id, size, zoom: 2, detail: options.detail ?? 2, style,
    camera: { at: [((x0 + x1) * cell) / 2, ((y0 + y1) * cell) / 2], lift: Math.round(wallHeight * 8), yaw, zoom: options.zoom ?? Math.max(0.3, Math.min(8, fit)), perspective: false },
    light: [1, -0.5, 1, 0.55], sky: { bg: '#0d0d14', fg: '#1a1a26', glyph: ' ' },
    materials: {
      dark: { fg: look.dark[0], bg: look.dark[1], glyph: ' ', surface: 'plain' },
      floor: { fg: look.floor[0], bg: look.floor[1], glyph: '.', surface: layout.kind === 'interior' ? 'wood' : 'stone' },
      door: { fg: look.door[0], bg: look.door[1], glyph: '=', surface: 'wood' },
      wall: { fg: '#8794a8', bg: '#667088', glyph: '#', surface: 'stone' }, // the ground under the walls, so a thin wall stands on a stone footing
    },
    terrain: { patches, grid: { step: Math.max(w, h), cols: 2, rows: 2, heights: [32, 32, 32, 32] }, cells: { cols: w, rows: h, materials: ['dark', 'floor', 'door', 'wall'], data } },
    objects: toKilnObjects(layout, { ...options, wallHeight }),
  };
  if (options.time !== undefined) scene.time = options.time;
  return scene;
}
