// Rain and snow for pictures made of character cells: the first-person view and the orbit view of
// the firstperson engine. Drops are real points in the world around the eye, moved by gravity and
// the wind and projected with the camera, so they slant with the wind, pass in front of far walls,
// hide behind near ones and stay put when the player turns. They are written into the view's
// frame (glyph and ink of a cell) between view.render and view.draw.
import { clamp, lerp, seededRng } from './noise.js';

const HALF = 0x2580; // the half-block glyph: ink above, paper below
const RAIN_FALL = 9; const SNOW_FALL = 1.3; // metres a second
const BAR = 124; const SLASH = 47; const BACK = 92; const DASH = 45; const STAR = 42; const PLUS = 43; const DOT = 46;
const wrap = (v, size) => v - Math.floor(v / size) * size;

const mix = (p, ink, t) => (Math.min(255, lerp(p >> 16 & 255, ink[0], t)) << 16) | (Math.min(255, lerp(p >> 8 & 255, ink[1], t)) << 8) | Math.min(255, lerp(p & 255, ink[2], t));

/** Put a drop into one cell: its glyph in `ink`, and a little of the ink in the cell's own colours. Returns 1. */
function mark(frame, col, row, glyph, ink, strength, wash) {
  const { ch, fg, bg } = frame; const at = row * frame.cols + col;
  if (ch[at] === HALF) { // two colours in one cell (an edge of the scene): keep the edge, lighten both halves
    fg[at] = mix(fg[at], ink, strength * 0.6); bg[at] = mix(bg[at], ink, strength * 0.6);
    return 1;
  }
  bg[at] = mix(bg[at], ink, strength * wash);
  ch[at] = glyph; fg[at] = mix(bg[at], ink, strength);
  return 1;
}

/**
 * @param {object} [o]
 * @param {number} [o.max]    Most drops or flakes at once (default 700).
 * @param {number} [o.reach]  Metres around the eye that are filled (default 14).
 * @param {() => number} [o.rng]
 * @returns {{apply:Function, stats:{shown:number, alive:number}, max:number}}
 */
export function createCellWeather(o = {}) {
  const max = o.max ?? 700;
  if (!(Number.isInteger(max) && max >= 0 && max <= 20000)) throw new Error(`createCellWeather: "max" must be a whole number from 0 to 20000, got ${JSON.stringify(o.max)}`);
  const baseReach = o.reach ?? 14;
  if (!(baseReach > 0)) throw new Error(`createCellWeather: "reach" must be above 0 metres, got ${JSON.stringify(o.reach)}`);
  const rng = o.rng ?? seededRng(7);
  // each drop: a place in a box (0..1 on every axis) and a number of its own
  const px = new Float32Array(max); const py = new Float32Array(max); const pz = new Float32Array(max); const own = new Float32Array(max);
  for (let i = 0; i < max; i++) { px[i] = rng(); py[i] = rng(); pz[i] = rng(); own[i] = rng(); }
  const stats = { shown: 0, alive: 0 };
  let clock = 0;

  /**
   * Move the drops on and write them into a frame.
   * @param {object} frame   view.frame of the firstperson engine: { cols, rows, ch, fg, bg }.
   * @param {object} w       weather.now
   * @param {object} opts
   * @param {object} opts.basis      cameraBasis(camera, frame.cols, frame.rows) of the firstperson engine.
   * @param {number} [opts.dt]       Seconds since the last call (default 0: the drops stand still).
   * @param {(col:number, row:number) => number} [opts.depthAt]  view.depthAt, so drops hide behind what is nearer.
   * @param {number} [opts.light]    How bright the drops are, 0..1 (precipLight(sky sample); default 1).
   * @param {number[]} [opts.center] Middle of the filled space (default the eye). The orbit view passes what it looks at.
   * @param {number} [opts.reach]    Metres filled around the centre (default the `reach` option). The orbit view passes its distance.
   * @param {number} [opts.amount]   Share of the drops to draw, 0..1 (the effects setting; default 1).
   * @returns {number} cells written
   */
  function apply(frame, w, opts = {}) {
    const b = opts.basis;
    if (!frame || !frame.ch || !frame.fg || !frame.bg) throw new Error('cellWeather.apply: "frame" must be a view.frame { cols, rows, ch, fg, bg }');
    if (!b || !b.eye || !b.F || !b.R || !b.U) throw new Error('cellWeather.apply: pass opts.basis from the firstperson engine\'s cameraBasis(camera, cols, rows)');
    const dt = opts.dt ?? 0; clock += dt;
    const amount = clamp(opts.amount ?? 1);
    const nRain = Math.round(max * amount * Math.pow(w.rain, 0.8)); const nSnow = Math.min(max - nRain, Math.round(max * amount * Math.pow(w.snow, 0.8)));
    stats.alive = nRain + nSnow; stats.shown = 0;
    if (stats.alive === 0) return 0;
    const reach = opts.reach ?? baseReach; const size = reach * 2; const tall = reach * 0.9;
    const c = opts.center ?? b.eye; const light = clamp(opts.light ?? 1, 0.05, 1.6);
    const { cols, rows } = frame; const depthAt = opts.depthAt;
    const { eye, F, R, U } = b;
    const wx = w.wind.x; const wy = w.wind.y;
    const rainInk = [168 * light, 186 * light, 214 * light]; const snowInk = [236 * light, 240 * light, 248 * light];
    for (let i = 0; i < stats.alive; i++) {
      const snow = i >= nRain;
      // velocity: the wind carries it, gravity pulls it; flakes flutter
      let vx = wx; let vy = wy; const vz = snow ? -SNOW_FALL * (0.7 + 0.6 * own[i]) : -RAIN_FALL * (0.85 + 0.3 * own[i]);
      if (snow) { vx = wx * 0.8 + Math.sin(clock * 1.3 + own[i] * 40) * 0.5; vy = wy * 0.8 + Math.cos(clock * 1.1 + own[i] * 31) * 0.5; }
      px[i] = wrap(px[i] + vx * dt / size, 1); py[i] = wrap(py[i] + vy * dt / size, 1); pz[i] = wrap(pz[i] + vz * dt / tall, 1);
      // the box is tiled through the world; take the copy of the drop that is around the centre
      const x = c[0] - reach + wrap(px[i] * size - (c[0] - reach), size);
      const y = c[1] - reach + wrap(py[i] * size - (c[1] - reach), size);
      const z = c[2] - tall * 0.3 + wrap(pz[i] * tall - (c[2] - tall * 0.3), tall);
      const dx = x - eye[0]; const dy = y - eye[1]; const dz = z - eye[2];
      const depth = dx * F[0] + dy * F[1] + dz * F[2];
      if (depth < 0.35) continue;
      const sx = b.cx + b.fx * (dx * R[0] + dy * R[1] + dz * R[2]) / depth;
      const sy = b.cy - b.fy * (dx * U[0] + dy * U[1] + dz * U[2]) / depth;
      const col = Math.floor(sx); const row = Math.floor(sy / 2);
      if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
      if (depthAt && depthAt(col, row) < depth) continue;
      const far = clamp(depth / reach);
      if (snow) {
        // a near flake fills its cell, a far one is a glyph on the scene's own colour
        const near = far < 0.35;
        stats.shown += mark(frame, col, row, near ? STAR : far < 0.65 ? PLUS : DOT, snowInk, lerp(0.95, 0.5, far), near ? 0.8 : 0.2);
        continue;
      }
      // a streak: where the drop was a moment ago, as seen on screen, gives the slant and the length
      const k = 0.05; const tx = dx - vx * k; const ty = dy - vy * k; const tz = dz - vz * k;
      const td = Math.max(0.2, tx * F[0] + ty * F[1] + tz * F[2]);
      const ax = b.cx + b.fx * (tx * R[0] + ty * R[1] + tz * R[2]) / td - sx; const ay = (b.cy - b.fy * (tx * U[0] + ty * U[1] + tz * U[2]) / td - sy) / 2;
      const steep = Math.abs(ay) > Math.abs(ax) * 2.2; const flat = Math.abs(ax) > Math.abs(ay) * 2.6;
      const glyph = steep ? BAR : flat ? DASH : ax * ay > 0 ? BACK : SLASH;
      const len = Math.max(1, Math.min(5, Math.round(Math.hypot(ax, ay))));
      const strength = lerp(0.85, 0.45, far);
      for (let n = 0; n < len; n++) {
        const cc = col + Math.round(ax * n / len); const rr = row + Math.round(ay * n / len);
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        if (n > 0 && depthAt && depthAt(cc, rr) < depth) continue;
        stats.shown += mark(frame, cc, rr, glyph, rainInk, strength * (1 - 0.5 * n / len), 0.3);
      }
    }
    return stats.shown;
  }
  return { apply, stats, max };
}
