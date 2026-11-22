// Vector renderer: draws a puppet on a 2D canvas as smooth shaded shapes, back to front.
// It follows a Kiln style (outline width, shading kind, palette), so the same character can
// be storybook, nocturne, papercut or crypt.
import { tones as defaultTones } from './color.js';
import { frontProjection, project } from './projection.js';
import { apply, dot } from './math.js';

/** Convex hull of 2D points (for the outline of a projected box). */
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => { const h = []; for (const q of list) { while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } h.pop(); return h; };
  return [...half(p), ...half(p.reverse())];
}

/** Outline tracer for one shape: returns fn(ctx, ox, oy) that adds the closed path, plus where it is. */
function tracer(s, proj) {
  if (s.shape === 'capsule') {
    const a = project(s.a, proj); const b = project(s.b, proj);
    const r0 = Math.max(0.3, s.r0 * proj.unitX); const r1 = Math.max(0.3, s.r1 * proj.unitX);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const depth = (a[2] + b[2]) / 2;
    if (d + Math.min(r0, r1) <= Math.max(r0, r1) + 1e-6) {
      // seen end-on: one circle covers the other
      const [c, r] = r0 >= r1 ? [a, r0] : [b, r1];
      return { depth, size: r, trace: (ctx, ox, oy) => { ctx.moveTo(c[0] + ox + r, c[1] + oy); ctx.arc(c[0] + ox, c[1] + oy, r, 0, Math.PI * 2); } };
    }
    const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const be = Math.acos(Math.min(1, Math.max(-1, (r0 - r1) / d)));
    return {
      depth, size: Math.max(r0, r1),
      trace: (ctx, ox, oy) => {
        ctx.moveTo(a[0] + ox + r0 * Math.cos(th + be), a[1] + oy + r0 * Math.sin(th + be));
        ctx.arc(a[0] + ox, a[1] + oy, r0, th + be, th - be + Math.PI * 2);
        ctx.arc(b[0] + ox, b[1] + oy, r1, th - be, th + be);
        ctx.closePath();
      },
    };
  }
  const c = project(s.c, proj);
  if (s.shape === 'ball') {
    // the picture of an ellipsoid is an ellipse: find its axes
    let xx = 0; let xy = 0; let yy = 0;
    for (let k = 0; k < 3; k++) {
      const axis = [s.m[k] * s.r[k], s.m[3 + k] * s.r[k], s.m[6 + k] * s.r[k]];
      const u = dot(proj.col, axis); const v = dot(proj.row, axis);
      xx += u * u; xy += u * v; yy += v * v;
    }
    const mid = (xx + yy) / 2; const dif = Math.hypot((xx - yy) / 2, xy);
    const ra = Math.sqrt(mid + dif); const rb = Math.sqrt(Math.max(0.05, mid - dif));
    const rot = 0.5 * Math.atan2(2 * xy, xx - yy);
    return { depth: c[2], size: Math.min(ra, rb), trace: (ctx, ox, oy) => { ctx.moveTo(c[0] + ox + ra * Math.cos(rot), c[1] + oy + ra * Math.sin(rot)); ctx.ellipse(c[0] + ox, c[1] + oy, ra, rb, rot, 0, Math.PI * 2); } };
  }
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const v = apply(s.m, [i & 1 ? s.half[0] : -s.half[0], i & 2 ? s.half[1] : -s.half[1], i & 4 ? s.half[2] : -s.half[2]]);
    corners.push([c[0] + dot(proj.col, v), c[1] + dot(proj.row, v)]);
  }
  const h = hull(corners);
  return { depth: c[2], size: Math.min(...s.half) * proj.unitX, trace: (ctx, ox, oy) => { h.forEach((p, i) => (i ? ctx.lineTo(p[0] + ox, p[1] + oy) : ctx.moveTo(p[0] + ox, p[1] + oy))); ctx.closePath(); } };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.style]  A Kiln style (resolveStyle(name)) or { shading, outline, palette, groundShadow }.
 *   shading: 'cel' | 'painted' | 'glow' | 'paper' | 'soft' | 'flat'. Default: soft shading with an outline.
 * @param {(hex:string) => object} [opts.tones]  Tone function; pass Kiln's `ramp` to match its colours exactly.
 * @param {object} [opts.projection]  Default frontProjection({ unit, pitch }).
 * @param {number} [opts.unit]   Pixels per world unit (default 60).
 * @param {number} [opts.pitch]  Camera pitch in degrees (default 0, side-on).
 * @returns {{draw:Function, projection:object}}
 */
export function createVectorRenderer(opts = {}) {
  const style = { shading: 'soft', outline: 2.4, groundShadow: 0.2, palette: null, ...(opts.style ?? {}) };
  const toneOf = opts.tones ?? defaultTones;
  const proj = opts.projection ?? frontProjection({ unit: opts.unit ?? 60, pitch: opts.pitch ?? 0 });
  const k = proj.unitX / 100; // Kiln styles are tuned for 100 units per cell

  function paint(ctx, t, c, flat) {
    const { trace } = t;
    const path = (ox = 0, oy = 0) => { ctx.beginPath(); trace(ctx, ox, oy); };
    const band = (color, dx, dy, alpha = 1) => { // the part of the shape NOT covered by itself shifted by dx, dy
      ctx.beginPath(); trace(ctx, 0, 0); trace(ctx, dx, dy);
      ctx.fillStyle = color; ctx.globalAlpha *= alpha; ctx.fill('evenodd'); ctx.globalAlpha /= alpha;
    };
    const d = Math.min(t.size * 0.55, 7 * k);
    const shading = flat ? 'flat' : style.shading;
    if (shading === 'paper') { path(1.6 * k, 2.6 * k); ctx.fillStyle = 'rgba(20,16,40,0.28)'; ctx.fill(); }
    path();
    if (shading === 'glow') {
      // no outline in glowing styles: a soft light edge on one side and a deep edge on the other
      ctx.fillStyle = c.base; ctx.fill();
      ctx.save(); ctx.clip(); band(c.light, d, d, 0.6); band(c.deep, -d, -d, 0.55); ctx.restore();
    } else {
      ctx.fillStyle = c.base; ctx.fill();
      if (shading !== 'flat' && shading !== 'paper') {
        ctx.save(); ctx.clip();
        if (shading === 'painted') band(c.deep, -d * 0.5, -d * 0.5);
        if (shading === 'cel' || shading === 'painted') band(c.shadow, -d, -d, shading === 'painted' ? 0.85 : 1);
        band(c.light, d * 0.7, d * 0.7, shading === 'soft' ? 0.7 : 0.9);
        ctx.restore();
      }
    }
    if (style.outline > 0) { path(); ctx.strokeStyle = c.outline; ctx.lineWidth = Math.max(0.75, style.outline * k); ctx.lineJoin = 'round'; ctx.stroke(); }
  }

  return {
    projection: proj,
    /**
     * Draw a puppet with its ground point (between the feet) at canvas x, y.
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} puppet
     * @param {number} x
     * @param {number} y
     * @param {{alpha?:number, shadow?:boolean}} [o]
     * @returns {number} How many shapes were drawn.
     */
    draw(ctx, puppet, x, y, o = {}) {
      const shapes = puppet.shapes(style.palette);
      const list = shapes.map((s) => { const t = tracer(s, proj); t.depth += s.bias; t.shape = s; return t; }).sort((a, b) => a.depth - b.depth);
      ctx.save();
      ctx.translate(x, y);
      if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
      if ((o.shadow ?? true) && style.groundShadow > 0) {
        const rx = 0.36 * puppet.scale * proj.unitX;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, Math.max(rx * 0.22, rx * Math.abs(proj.toward[2])), 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(11,11,24,${style.groundShadow})`;
        ctx.fill();
      }
      for (const t of list) paint(ctx, t, toneOf(t.shape.color), t.shape.flat);
      ctx.restore();
      return list.length;
    },
  };
}
