// Weather over a flat picture: the baked isometric view, the open world's pages, or any 2D game.
// It is drawn on top of the finished picture with the 2D canvas: a grey tint for cloud, a veil
// and drifting banks of fog, streaks of rain and flakes of snow in three depths that slant with
// the wind, and the white flash of lightning.
import { clamp, lerp, seededRng } from './noise.js';
import { weatherGrade } from './light.js';

const DEG = Math.PI / 180;
const wrap1 = (v) => v - Math.floor(v);

/**
 * Where the world's +x and +y point on screen in an isometric picture, for the wind's slant.
 * @param {number} [yaw]   Degrees the picture is turned (default 45, the classic diamond).
 * @param {number} [tilt]  How much the ground is squashed (default 0.5).
 * @returns {{x:number[], y:number[]}}
 */
export function isoAxes(yaw = 45, tilt = 0.5) {
  const c = Math.cos(yaw * DEG); const s = Math.sin(yaw * DEG);
  return { x: [c, s * tilt], y: [-s, c * tilt] };
}

/**
 * @param {object} [o]
 * @param {number} [o.max]     Most streaks or flakes at once (default 500).
 * @param {{x:number[], y:number[]}} [o.axes]  Screen directions of the world's +x and +y (default isoAxes()). Settable later as overlay.axes.
 * @param {number} [o.metres]  How many metres of world the picture's height shows (default 30): sets how far the wind carries drops.
 * @param {() => number} [o.rng]
 * @returns {{update:Function, draw:Function, axes:object, stats:{shown:number}}}
 */
export function createWeatherOverlay(o = {}) {
  const max = o.max ?? 500;
  if (!(Number.isInteger(max) && max >= 0 && max <= 20000)) throw new Error(`createWeatherOverlay: "max" must be a whole number from 0 to 20000, got ${JSON.stringify(o.max)}`);
  const metres = o.metres ?? 30;
  if (!(metres > 0)) throw new Error(`createWeatherOverlay: "metres" must be above 0, got ${JSON.stringify(o.metres)}`);
  const rng = o.rng ?? seededRng(11);
  const px = new Float32Array(max); const py = new Float32Array(max); const pd = new Float32Array(max); const own = new Float32Array(max);
  for (let i = 0; i < max; i++) { px[i] = rng(); py[i] = rng(); pd[i] = 0.4 + 0.6 * rng(); own[i] = rng(); }
  const banks = [0, 1, 2, 3, 4].map(() => ({ x: rng(), y: rng(), r: 0.35 + rng() * 0.4 }));
  const grade = { multiply: [1, 1, 1], identity: true };
  const stats = { shown: 0 };
  let clock = 0; let vx = 0; let vy = 0; let nRain = 0; let nSnow = 0;

  const overlay = {
    axes: o.axes ?? isoAxes(),
    stats,
    /**
     * Move the drops on. Call once per update.
     * @param {number} dt  Seconds.
     * @param {object} w   weather.now
     */
    update(dt, w) {
      clock += dt;
      const a = overlay.axes;
      // the wind as the picture sees it, in picture heights a second
      vx = (w.wind.x * a.x[0] + w.wind.y * a.y[0]) / metres; vy = (w.wind.x * a.x[1] + w.wind.y * a.y[1]) / metres;
      nRain = Math.round(max * Math.pow(w.rain, 0.8)); nSnow = Math.min(max - nRain, Math.round(max * Math.pow(w.snow, 0.8)));
      for (let i = 0; i < nRain + nSnow; i++) {
        const d = pd[i];
        if (i < nRain) { px[i] = wrap1(px[i] + vx * d * dt); py[i] = wrap1(py[i] + (1.5 + vy) * d * dt); }
        else { px[i] = wrap1(px[i] + (vx * 0.8 + Math.sin(clock * 1.2 + own[i] * 40) * 0.02) * d * dt); py[i] = wrap1(py[i] + (0.13 + 0.07 * own[i] + vy * 0.5) * d * dt); }
      }
      for (const b of banks) { b.x = wrap1(b.x + (vx * 0.25 + 0.004) * dt); b.y = wrap1(b.y + vy * 0.12 * dt); }
    },
    /**
     * Draw the weather over a rectangle of a finished picture.
     * @param {object} ctx   2D canvas context. Its state is restored.
     * @param {number} x @param {number} y @param {number} w @param {number} h  The rectangle, in canvas pixels.
     * @param {object} s     weather.now
     * @param {object} [opts]
     * @param {boolean} [opts.grade]  false skips the grey tint (when the picture is already lit for the weather; default true).
     * @param {number} [opts.light]   How bright fog and drops are, 0..1 (precipLight(sky sample); default 1).
     * @param {boolean} [opts.flash]  false leaves the lightning out (reduced motion; default true).
     * @param {number} [opts.amount]  Share of the drops to draw, 0..1 (the effects setting; default 1).
     * @param {boolean} [opts.ground] false leaves out the frost of lying snow and the darkening of wet ground (default true).
     */
    draw(ctx, x, y, w, h, s, opts = {}) {
      const light = clamp(opts.light ?? 1, 0.05, 1); const amount = clamp(opts.amount ?? 1);
      stats.shown = 0;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      if (opts.grade !== false && !weatherGrade(s, grade).identity) {
        const m = grade.multiply;
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${Math.round(m[0] * 255)},${Math.round(m[1] * 255)},${Math.round(m[2] * 255)})`;
        ctx.fillRect(x, y, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (opts.ground !== false) {
        // a flat picture cannot tell ground from wall, so lying snow is a frost over all of it (dark
        // parts lighten most) and wet ground a cool darkening
        if (s.wetness > 0.02 && s.snowCover < 0.5) {
          const k = 1 - 0.2 * s.wetness * (1 - 2 * s.snowCover);
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = `rgb(${Math.round(255 * k * 0.97)},${Math.round(255 * k)},${Math.round(255 * Math.min(1, k * 1.03))})`;
          ctx.fillRect(x, y, w, h);
        }
        if (s.snowCover > 0.02) {
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = `rgba(${Math.round(226 * light)},${Math.round(232 * light)},${Math.round(244 * light)},${(s.snowCover * 0.55).toFixed(3)})`;
          ctx.fillRect(x, y, w, h);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      const veil = clamp(s.fog * 0.62 + s.snow * 0.12 + s.rain * 0.08);
      if (veil > 0.01) {
        const g = Math.round(205 * light); const fog = `${g},${Math.round(g * 1.02)},${Math.min(255, Math.round(g * 1.06))}`;
        ctx.fillStyle = `rgba(${fog},${veil.toFixed(3)})`;
        ctx.fillRect(x, y, w, h);
        if (s.fog > 0.05 && typeof ctx.createRadialGradient === 'function') {
          for (const b of banks) { // banks of thicker fog drifting through
            const bx = x + (b.x * 1.6 - 0.3) * w; const by = y + (b.y * 1.4 - 0.2) * h; const r = b.r * Math.max(w, h);
            const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
            grad.addColorStop(0, `rgba(${fog},${(s.fog * 0.3).toFixed(3)})`); grad.addColorStop(1, `rgba(${fog},0)`);
            ctx.fillStyle = grad; ctx.fillRect(bx - r, by - r, r * 2, r * 2);
          }
        }
      }
      const rainN = Math.round(nRain * amount); const snowN = Math.round(nSnow * amount);
      if (rainN > 0) {
        const c = `${Math.round(190 * light)},${Math.round(205 * light)},${Math.round(228 * light)}`;
        for (let band = 0; band < 3; band++) { // far, middle, near: one path each
          const lo = 0.4 + band * 0.2; const hi = lo + 0.2;
          ctx.strokeStyle = `rgba(${c},${lerp(0.22, 0.5, band / 2).toFixed(2)})`; ctx.lineWidth = Math.max(1, h / 520 * (1 + band * 0.5));
          ctx.beginPath();
          for (let i = 0; i < rainN; i++) {
            const d = pd[i]; if (d < lo || d >= hi + (band === 2 ? 1 : 0)) continue;
            const X = x + px[i] * w; const Y = y + py[i] * h; const len = 0.045 * d;
            ctx.moveTo(X, Y); ctx.lineTo(X - vx * len * h, Y - (1.5 + vy) * len * h);
            stats.shown++;
          }
          ctx.stroke();
        }
      }
      if (snowN > 0) {
        ctx.fillStyle = `rgba(${Math.round(245 * light)},${Math.round(248 * light)},${Math.round(255 * light)},0.85)`;
        for (let i = nRain; i < nRain + snowN; i++) {
          const size = Math.max(1, Math.round(h / 300 * (0.6 + 1.6 * (pd[i] - 0.4))));
          ctx.fillRect(Math.round(x + px[i] * w), Math.round(y + py[i] * h), size, size);
          stats.shown++;
        }
      }
      if (opts.flash !== false && s.flash > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,255,255,${(s.flash * 0.55).toFixed(3)})`;
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    },
  };
  return overlay;
}
