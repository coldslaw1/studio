// Worker for world-stage.js: gets one world page as a picture, off the main thread. Either it fetches
// the page from the page server (or a baked file) and turns its characters into a picture, or, with no
// page server, it draws the page itself (drawPage below), so the world has no edge anywhere.
// Walking never stutters when a page arrives: a fetched page's picture is built as plain pixels in
// this thread (no canvas drawing calls: a page is over 100,000 characters, and that many calls from
// a worker hold up the page's own drawing), then handed over as one bitmap.
// A page is <name>.json from the page server, or the baked file <name>.json.gz on a static site.
import { RAMP, QUADRANTS } from '../../src/ascii.js';
import { createSceneView } from '../../src/scene-view.js';
import { shadePicture } from '../../src/scene-shade.js';
import { useSceneModels, sceneAtFrame } from '../../src/scene3d.js';
import { orbit, pageScene, createGenWorld, sceneOptionsFromKey } from './world-gen.js';

async function fetchScene(url) {
  const res = await fetch(url);
  if (res.ok) return res.json();
  const packed = await fetch(url + '.gz'); // baked ahead with "serve.mjs --bake"
  if (!packed.ok) {
    // 404 for both: there is no such page (a static site, past what was baked). Anything else is a hiccup
    // (a server that is restarting or busy, a page that failed to render) and worth asking for again.
    const e = new Error(`${url}: ${res.status}`);
    e.missing = res.status === 404 && packed.status === 404;
    throw e;
  }
  const bytes = new Uint8Array(await packed.arrayBuffer());
  // a static host may already have unpacked it on the way (content-encoding); gzip data starts 1f 8b
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return JSON.parse(new TextDecoder().decode(bytes));
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}

// ---- glyph shapes as 8 x 8 bitmaps (one byte per row), like Kiln's drawGrid draws them
const glyphs = new Map(RAMP);
const half = (rows) => rows; // readability
glyphs.set('█', half([255, 255, 255, 255, 255, 255, 255, 255]));
glyphs.set('▀', [255, 255, 255, 255, 0, 0, 0, 0]);
glyphs.set('▄', [0, 0, 0, 0, 255, 255, 255, 255]);
glyphs.set('▌', [240, 240, 240, 240, 240, 240, 240, 240]);
glyphs.set('▐', [15, 15, 15, 15, 15, 15, 15, 15]);
glyphs.set('■', [0, 0, 60, 60, 60, 60, 0, 0]);
QUADRANTS.forEach((ch, bits) => { // bit 1 top left, 2 top right, 4 bottom left, 8 bottom right
  if (glyphs.has(ch) || ch === ' ') return;
  const top = (bits & 1 ? 240 : 0) | (bits & 2 ? 15 : 0); const bottom = (bits & 4 ? 240 : 0) | (bits & 8 ? 15 : 0);
  glyphs.set(ch, [top, top, top, top, bottom, bottom, bottom, bottom]);
});
const SHADES = { '░': 0.25, '▒': 0.5, '▓': 0.75 };
let scratch = null;
/** Any other character: drawn once with the browser's font into an 8 x 8 bitmap, then remembered. */
function glyphOf(ch) {
  let rows = glyphs.get(ch);
  if (rows) return rows;
  scratch ??= new OffscreenCanvas(8, 8).getContext('2d', { willReadFrequently: true });
  scratch.clearRect(0, 0, 8, 8);
  scratch.font = '8px "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace';
  scratch.textBaseline = 'middle'; scratch.textAlign = 'center'; scratch.fillStyle = '#fff';
  scratch.fillText(ch, 4, 4, 8);
  const px = scratch.getImageData(0, 0, 8, 8).data;
  rows = [];
  for (let y = 0; y < 8; y++) { let b = 0; for (let x = 0; x < 8; x++) if (px[(y * 8 + x) * 4 + 3] > 96) b |= 0x80 >> x; rows.push(b); }
  glyphs.set(ch, rows);
  return rows;
}

/** The page's characters as pixels: `cell` pixels per character (4 = half of the 8 x 8 glyph size). */
function rasterise(grid, palette, cell) {
  const { cols, rows } = grid;
  const w = cols * cell; const h = rows * cell;
  const out = new Uint8ClampedArray(w * h * 4);
  const rgb = palette.map((hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
  const step = 8 / cell; // glyph bits per pixel, each way
  const cover = new Float32Array(cell * cell);
  for (let y = 0; y < rows; y++) {
    const line = [...grid.ch[y]];
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const bg = grid.bg[i] >= 0 ? rgb[grid.bg[i]] : null;
      const ch = line[x];
      const fg = grid.fg[i] >= 0 && ch !== ' ' ? rgb[grid.fg[i]] : null;
      let flat = -1; // the same share of ink on every pixel (-1 = use the glyph's shape)
      if (!fg) flat = 0; else if (SHADES[ch] !== undefined) flat = SHADES[ch];
      if (flat < 0) {
        const bits = glyphOf(ch);
        for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) {
          let n = 0;
          for (let sy = Math.floor(py * step); sy < (py + 1) * step; sy++) for (let sx = Math.floor(px * step); sx < (px + 1) * step; sx++) if (bits[sy] & (0x80 >> sx)) n++;
          cover[py * cell + px] = n / (step * step);
        }
      }
      for (let py = 0; py < cell; py++) {
        let o = ((y * cell + py) * w + x * cell) * 4;
        for (let px = 0; px < cell; px++, o += 4) {
          const a = flat >= 0 ? flat : cover[py * cell + px];
          if (bg) { out[o] = bg[0] + (fg ? (fg[0] - bg[0]) * a : 0); out[o + 1] = bg[1] + (fg ? (fg[1] - bg[1]) * a : 0); out[o + 2] = bg[2] + (fg ? (fg[2] - bg[2]) * a : 0); out[o + 3] = 255; }
          else if (fg && a > 0) { out[o] = fg[0]; out[o + 1] = fg[1]; out[o + 2] = fg[2]; out[o + 3] = 255 * a; }
        }
      }
    }
  }
  return new ImageData(out, w, h);
}

// ---- drawing a page here, with no page server: the world generator makes the page's scene and
// Kiln's own renderer (plain JavaScript) draws it. About half a second a page, in this thread.
const DRAW_PX = 2; // picture pixels per character each way
let genWorld = null;
function drawPage({ px, py, yi, li, look }, maxZ) {
  const options = sceneOptionsFromKey(look);
  if (options.kit) throw new Error('kit hamlets are built from library models, which only the page server has');
  genWorld ??= createGenWorld();
  const layout = orbit.layout(yi, li);
  const [cols, rows] = layout.cells;
  const scene = pageScene(genWorld, px, py, yi, li, options);
  useSceneModels(scene);
  const at = sceneAtFrame(scene, 0);
  const pic = shadePicture({ ...at, sky: scene.sky }, layout.projection, { cols, rows, px: DRAW_PX, time: -1 });
  // depth for hiding characters behind scenery: per character, the nearest surface among its pixels,
  // as the picture row where that point would land at the camera target's height (see Kiln's depthGrid)
  const { tri, z, water } = pic.prep;
  const height = new Float32Array(cols * rows).fill(NaN);
  for (let i = 0; i < tri.length; i++) {
    if (tri[i] < 0) continue;
    const k = Math.floor(Math.floor(i / pic.width) / DRAW_PX) * cols + Math.floor((i % pic.width) / DRAW_PX);
    if (!(height[k] >= z[i])) height[k] = z[i];
  }
  const kz = layout.projection.row[3]; const oz = layout.projection.origin[2];
  const level = typeof scene.water === 'number' ? scene.water : (typeof water === 'number' ? water : null);
  const depth = new Array(cols * rows);
  for (let i = 0; i < depth.length; i++) {
    let h = Number.isNaN(height[i]) ? null : height[i];
    if (level !== null) h = Math.max(h ?? level, level);
    depth[i] = h === null ? null : (Math.floor(i / cols) + 0.5) - kz * (h - oz);
  }
  const data = {
    kiln: 1, renderer: 'asciicker', name: scene.name, cols, rows, frames: 1, fps: 8, detail: layout.detail, shading: 'smooth', ambient: false, draw: 'kiln', palette: [],
    image: { file: '', frameWidth: pic.width, frameHeight: pic.height }, depth: [depth],
    view: { projection: layout.projection, terrain: scene.terrain ?? null, water: scene.water ?? null, objects: at.objects.map((o) => ({ shape: o.shape, at: o.at, yaw: o.yaw ?? 0, scale: o.scale ?? 1, ...(o.params ? { params: o.params } : {}) })) },
  };
  let outlines = null;
  if (maxZ !== undefined) { try { outlines = createSceneView(data, { image: {} }).footprints({ maxZ }); } catch { outlines = null; } }
  return { data, outlines, image: new ImageData(new Uint8ClampedArray(pic.rgba), pic.width, pic.height) };
}

onmessage = async ({ data: { id, url, zoom, maxZ, draw } }) => {
  try {
    if (draw) {
      const made = drawPage(draw, maxZ);
      const bitmap = await createImageBitmap(made.image);
      postMessage({ id, data: made.data, bitmap, outlines: made.outlines }, [bitmap]);
      return;
    }
    const scene = await fetchScene(url);
    const grid = Object.values(scene.sprites)[0];
    const image = rasterise(grid, scene.palette, Math.max(1, Math.round(8 * zoom)));
    const bitmap = await createImageBitmap(image);
    // the ground outlines of everything on the page (for collision), worked out here instead of in the game
    // (the page server sends them along; an older or baked page without them is worked out here)
    let outlines = Array.isArray(scene.outlines) ? scene.outlines : null;
    if (!outlines && maxZ !== undefined) { try { outlines = createSceneView(scene).footprints({ maxZ }); } catch { outlines = null; } }
    // hand the page over in Kiln's "picture" form: the drawn picture plus depth, without the character grids
    const data = { ...scene, palette: [], image: { file: '', frameWidth: image.width, frameHeight: image.height }, depth: [grid.depth] };
    delete data.sprites; delete data.outlines;
    postMessage({ id, data, bitmap, outlines }, [bitmap]);
  } catch (e) {
    postMessage({ id, error: String(e.message ?? e), missing: e.missing === true });
  }
};
