// The first-person view: draws a world as a grid of character cells, the same kind of picture Kiln
// makes (a glyph with a foreground and a background colour per cell, half-block glyphs for twice
// the rows), but from the eye of someone standing in it, every frame.
import { cameraBasis } from './camera.js';
import { createBuffers, clearBuffers, drawTriangles } from './raster.js';
import { drawSolids } from './solids.js';
import { shade } from './shade.js';
import { packedHex } from './color.js';
import { createPainter } from './paint.js';
import { createGrassBuffer, buildGrass } from './grass.js';

const HALF = 0x2580; // ▀
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * @param {object} o
 * @param {object} o.world   From createFpWorld.
 * @param {number} o.cols    Character cells across.
 * @param {number} o.rows    Character cells down.
 * @param {number} [o.cellPx]  Pixels per character when drawn to a canvas (default 4).
 * @param {boolean} [o.pair]  Shade a cell once where both its samples show the same surface (default true: about a third faster).
 * @param {object} [o.tuft]  Ground glyphs: { size (metres, default 0.25), density (0..1, default 0.45), near, far (metres over which they fade, default 6 and 34) }.
 * @param {(w:number, h:number) => object} [o.createCanvas]  Makes the hidden canvas draw() paints into (default: a browser canvas).
 * @returns {object} view
 */
export function createFirstPerson(o) {
  const { world } = o ?? {};
  if (!world || !world.tris || !world.maps) throw new Error('createFirstPerson: "world" must come from createFpWorld');
  const cols = o.cols; const rows = o.rows;
  if (!(Number.isInteger(cols) && Number.isInteger(rows) && cols >= 8 && rows >= 8)) throw new Error(`createFirstPerson: cols and rows must be whole numbers of at least 8, got ${cols} x ${rows}`);
  // pair: shade each cell once where both of its samples show the same surface (see shade.js); false = every sample
  const tuft = { size: 0.25, density: 0.45, near: 6, far: 34, pair: o.pair !== false, ...(o.tuft ?? {}) };
  const buf = createBuffers(cols, rows * 2);
  const n = cols * rows;
  const samples = { col: new Uint32Array(n * 2), mat: new Uint8Array(n * 2), ink: new Uint32Array(n * 2) };
  const frame = { cols, rows, ch: new Uint16Array(n), fg: new Uint32Array(n), bg: new Uint32Array(n) };
  const drawn = [];
  const colorCache = new Map();
  const skyRow = new Uint32Array(rows);
  const total = world.tris.length / 9;
  const painter = createPainter(world, frame, o.cellPx ?? 4, o.createCanvas);
  const stats = { triangles: 0, solidSamples: 0, shapes: 0, blades: 0 };
  const grass = world.grass ? createGrassBuffer(world.grass.max) : null;

  function compose(cam, camera) {
    const { ch, fg, bg } = frame;
    const { col, mat, ink } = samples;
    const id = buf.id;
    const sk = world.sky;
    // the backdrop: one colour a row, from the horizon colour up to the top colour
    for (let r = 0; r < rows; r++) {
      const b = (cam.cy - (2 * r + 1)) / cam.fy;
      const up = cam.F[2] + b * cam.U[2]; const flat = Math.hypot(cam.F[0] + b * cam.U[0], cam.F[1] + b * cam.U[1]);
      const t = Math.min(1, Math.max(0, Math.atan2(up, flat) / 1.1));
      skyRow[r] = (Math.round(sk.horizon[0] + (sk.top[0] - sk.horizon[0]) * t) << 16) | (Math.round(sk.horizon[1] + (sk.top[1] - sk.horizon[1]) * t) << 8) | Math.round(sk.horizon[2] + (sk.top[2] - sk.horizon[2]) * t);
    }
    // specks in the sky keep their place in the world as the camera turns
    const turnC = Math.round(camera.yaw * Math.PI / 180 * cam.fx); const turnR = Math.round(camera.pitch * Math.PI / 180 * cam.fx);
    const skyInk = (sk.fg[0] << 16) | (sk.fg[1] << 8) | sk.fg[2];
    for (let r = 0, i = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        const kt = r * 2 * cols + c; const kb = kt + cols;
        const st = id[kt] === -1; const sb = id[kb] === -1;
        if (st && sb) {
          bg[i] = skyRow[r];
          if (sk.density > 0 && hash(c - turnC, r - turnR) < sk.density) { ch[i] = sk.code; fg[i] = skyInk; } else { ch[i] = 32; fg[i] = skyRow[r]; }
          continue;
        }
        const ct = st ? skyRow[r] : col[kt]; const cb = sb ? skyRow[r] : col[kb];
        if ((mat[kb] & 128) && (mat[kt] & 127) === (mat[kb] & 127)) {
          ch[i] = world.materials[(mat[kb] & 127) - 1].code;
          bg[i] = ((ct & 0xfefefe) + (cb & 0xfefefe)) >>> 1; fg[i] = ink[kb];
        } else if (ct === cb) { ch[i] = 32; fg[i] = ct; bg[i] = ct; } else { ch[i] = HALF; fg[i] = ct; bg[i] = cb; }
      }
    }
  }

  const view = {
    cols, rows, world,
    /** The last picture: { cols, rows, ch (character codes), fg, bg (0xRRGGBB) }, one entry a cell, top row first. */
    frame,
    /** Counts from the last render: { triangles, shapes, solidSamples, blades }. */
    stats,
    /**
     * Work out the picture for a camera.
     * @param {object} camera  From createFpCamera (or any { x, y, z, yaw, pitch, fov, near, far }).
     * @param {object} [scene]
     * @param {Array<{at:number[], shapes:object[]}>} [scene.solids]  Characters and props: a ground point and puppet shapes (see drawSolids).
     * @param {Array<{x:number, y:number, r:number, h:number}>} [scene.casters]  Standing things that throw a shadow on the ground.
     * @param {number} [scene.time]  Seconds since the start: grass sways and water ripples with it (default 0: still).
     * @returns {object} frame
     */
    render(camera, scene = {}) {
      const cam = cameraBasis(camera, cols, rows);
      clearBuffers(buf);
      stats.triangles = drawTriangles(buf, cam, world.tris, total, 0);
      const time = scene.time ?? 0;
      stats.blades = grass ? buildGrass(world, cam, time, grass) : 0;
      if (stats.blades) drawTriangles(buf, cam, grass.tris, stats.blades, total);
      stats.solidSamples = drawSolids(buf, cam, scene.solids ?? [], drawn);
      stats.shapes = drawn.length;
      shade(world, buf, cam, samples, drawn, scene.casters ?? [], colorCache, tuft, grass, time);
      compose(cam, camera);
      return frame;
    },
    /** Distance in metres to whatever is drawn in a cell (Infinity for sky). Handy for "what am I looking at". */
    depthAt(col, row) {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return Infinity;
      const z = Math.max(buf.iz[Math.floor(row) * 2 * cols + Math.floor(col)], buf.iz[(Math.floor(row) * 2 + 1) * cols + Math.floor(col)]);
      return z > 0 ? 1 / z : Infinity;
    },
    /** Draw the last picture into the rectangle x, y, w, h of a 2D canvas context. */
    draw(ctx, x = 0, y = 0, w = cols * painter.cellPx, h = rows * painter.cellPx) { painter.draw(ctx, x, y, w, h); },
    /** Paint the last picture into pixels (Uint32Array, cols * cellPx wide); for tests and custom drawing. */
    paint(pixels) { return painter.paint(pixels); },
    /** The last picture in Kiln's grid layout: { cols, rows, ch: string[], fg, bg (indexes), palette: string[] }. */
    toGrid() {
      const palette = []; const slot = new Map();
      const idx = (c) => { if (!slot.has(c)) { slot.set(c, palette.length); palette.push(packedHex(c)); } return slot.get(c); };
      const ch = []; const fg = new Array(n); const bg = new Array(n);
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) { const i = r * cols + c; line += String.fromCharCode(frame.ch[i]); fg[i] = idx(frame.fg[i]); bg[i] = idx(frame.bg[i]); }
        ch.push(line);
      }
      return { cols, rows, ch, fg, bg, palette };
    },
    /** The last picture as plain text lines (no colour). */
    toText() { return view.toGrid().ch.join('\n'); },
  };
  return view;
}
