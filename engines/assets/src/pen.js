// The pen turns plain geometry into finished, styled SVG.
// Recipes describe *what* to draw; the pen and the style decide *how it looks*.
import { ramp, mix } from './color.js';

const f = (n) => (Math.round(n * 100) / 100).toString();

/** Smooth closed curve through points (Catmull-Rom converted to cubic Beziers). */
export function smoothPath(pts, closed = true) {
  const n = pts.length;
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.min(n - 1, Math.max(0, i))]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? d + 'Z' : d;
}

/** Polygon with rounded corners. */
export function roundedPoly(pts, r = 3) {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const [p, c, q] = [pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]];
    const toward = (a, b) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const t = Math.min(r, len / 2) / len;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    const a = toward(c, p);
    const b = toward(c, q);
    d += `${i === 0 ? 'M' : 'L'}${f(a[0])} ${f(a[1])}Q${f(c[0])} ${f(c[1])} ${f(b[0])} ${f(b[1])}`;
  }
  return d + 'Z';
}

export class Pen {
  constructor(style, rng, id = 's') {
    this.style = style;
    this.rng = rng;
    this.id = id;
    this.n = 0;
    this.parts = [];
    this.defs = [];
    this.flip = false; // set when the sprite is mirrored, so light still comes from the top left
  }

  color(key) {
    if (typeof key !== 'string') throw new Error('Colour must be a palette name or hex string');
    if (key.startsWith('#')) return key;
    const hex = this.style.palette[key];
    if (!hex) throw new Error(`Unknown colour "${key}". Palette: ${Object.keys(this.style.palette).join(', ')}`);
    return hex;
  }

  ramp(key) { return ramp(this.color(key), { strength: this.style.rampStrength ?? 1 }); }
  uid(tag) { return `${this.id}-${tag}${this.n++}`; }
  raw(svg) { this.parts.push(svg); return this; }

  jitter(pts, amount = this.style.wobble) {
    return pts.map(([x, y]) => [x + this.rng.range(-amount, amount), y + this.rng.range(-amount, amount)]);
  }

  // ---- geometry (returns path data) ----
  ellipse(cx, cy, rx, ry = rx, { n = 10, rot = 0, wobble } = {}) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const [x, y] = [Math.cos(a) * rx, Math.sin(a) * ry];
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return smoothPath(this.jitter(pts, wobble));
  }

  blob(cx, cy, r, { n = 9, bumpy = 0.14 } = {}) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 + this.rng.range(-bumpy, bumpy));
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return smoothPath(pts);
  }

  curve(pts, wobble) { return smoothPath(this.jitter(pts, wobble)); }
  poly(pts, r = 3, wobble) { return roundedPoly(this.jitter(pts, wobble), r); }
  rect(x, y, w, h, r = 3) { return this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r); }

  // ---- finished shapes ----
  /** A fully styled shape: shading, highlight and outline as the style dictates. */
  fill(d, color, { depth = 4, outline = true, opacity = 1, glow = 0 } = {}) {
    const c = this.ramp(color);
    const sx = this.flip ? -1 : 1;
    const style = this.style;
    const group = [];
    if (glow) this.halo(...glow.at, glow.r, glow.color ?? color, glow.opacity ?? 0.5);

    if (style.shading === 'cel') {
      const clip = this.uid('c');
      const mask = this.uid('m');
      this.defs.push(`<clipPath id="${clip}"><path d="${d}"/></clipPath>`);
      this.defs.push(`<mask id="${mask}"><path d="${d}" fill="#fff"/><path d="${d}" fill="#000" transform="translate(${f(depth * 0.55 * sx)} ${f(depth * 0.55)})"/></mask>`);
      group.push(`<g clip-path="url(#${clip})"><path d="${d}" fill="${c.shadow}"/><path d="${d}" fill="${c.base}" transform="translate(${f(-depth * sx)} ${f(-depth)})"/></g>`);
      group.push(`<path d="${d}" fill="${c.light}" mask="url(#${mask})" opacity="0.85"/>`);
    } else if (style.shading === 'painted') {
      // Four tones: deep edge, shadow, base, light, plus a small bright catch-light band.
      const clip = this.uid('c');
      const mask = this.uid('m');
      const t = (k) => `translate(${f(depth * k * sx)} ${f(depth * k)})`;
      this.defs.push(`<clipPath id="${clip}"><path d="${d}"/></clipPath>`);
      this.defs.push(`<mask id="${mask}"><path d="${d}" fill="#fff"/><path d="${d}" fill="#000" transform="${t(0.8)}"/></mask>`);
      group.push(`<g clip-path="url(#${clip})"><path d="${d}" fill="${c.deep}"/><path d="${d}" fill="${c.shadow}" transform="${t(-0.6)}"/><path d="${d}" fill="${c.base}" transform="${t(-1.7)}"/></g>`);
      group.push(`<path d="${d}" fill="${c.light}" mask="url(#${mask})"/>`);
    } else if (style.shading === 'glow') {
      const grad = this.uid('g');
      this.defs.push(`<radialGradient id="${grad}" cx="${this.flip ? 0.65 : 0.35}" cy="0.3" r="0.85"><stop offset="0" stop-color="${c.light}"/><stop offset="0.55" stop-color="${c.base}"/><stop offset="1" stop-color="${c.deep}"/></radialGradient>`);
      group.push(`<path d="${d}" fill="url(#${grad})"/>`);
      group.push(`<path d="${d}" fill="none" stroke="${c.light}" stroke-width="0.9" opacity="0.45"/>`);
    } else {
      const mask = this.uid('m');
      this.defs.push(`<mask id="${mask}"><path d="${d}" fill="#fff"/><path d="${d}" fill="#000" transform="translate(${f(depth * 0.5 * sx)} ${f(depth * 0.5)})"/></mask>`);
      group.push(`<path d="${d}" fill="#1b1b2b" opacity="0.22" transform="translate(${f(1.4 * sx)} 2.4)"/>`);
      group.push(`<path d="${d}" fill="${c.base}"/>`);
      group.push(`<path d="${d}" fill="${c.light}" mask="url(#${mask})" opacity="0.7"/>`);
    }
    if (outline && style.outline > 0) {
      group.push(`<path d="${d}" fill="none" stroke="${c.outline}" stroke-width="${style.outline}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    this.parts.push(opacity < 1 ? `<g opacity="${opacity}">${group.join('')}</g>` : group.join(''));
    return this;
  }

  /** Plain fill with no styling (details, eyes, tile backgrounds). */
  flat(d, color, { opacity = 1 } = {}) {
    this.parts.push(`<path d="${d}" fill="${this.color(color)}"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`);
    return this;
  }

  /** A stroked line. With `outlined`, it gets the style's outline underneath (stalks, stems, handles). */
  line(d, color, width = 2, { opacity = 1, outlined = false } = {}) {
    const hex = this.color(color);
    if (outlined && this.style.outline > 0) {
      this.parts.push(`<path d="${d}" fill="none" stroke="${ramp(hex).outline}" stroke-width="${f(width + this.style.outline * 1.7)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    this.parts.push(`<path d="${d}" fill="none" stroke="${hex}" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`);
    return this;
  }

  dot(cx, cy, r, color, opts) { return this.flat(this.ellipse(cx, cy, r, r, { n: 8, wobble: 0 }), color, opts); }

  /** Soft radial glow, strongest in glowing styles. */
  halo(cx, cy, r, color, opacity = 0.5) {
    const grad = this.uid('h');
    const hex = this.color(color);
    const k = this.style.shading === 'glow' ? 1 : 0.55;
    this.defs.push(`<radialGradient id="${grad}"><stop offset="0" stop-color="${hex}" stop-opacity="${f(opacity * k)}"/><stop offset="0.5" stop-color="${hex}" stop-opacity="${f(opacity * k * 0.35)}"/><stop offset="1" stop-color="${hex}" stop-opacity="0"/></radialGradient>`);
    this.parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="url(#${grad})"/>`);
    return this;
  }

  /** Soft shadow on the ground under a sprite. */
  groundShadow(cx, cy, rx, ry = rx * 0.2) {
    const o = this.style.groundShadow;
    if (o > 0) this.parts.push(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="#0b0b18" opacity="${o}"/>`);
    return this;
  }

  tone(color, which) { return this.ramp(color)[which]; }
  blend(a, b, t) { return mix(this.color(a), this.color(b), t); }

  /** Inner SVG for a 100x100 sprite. */
  svg() {
    const body = this.parts.join('');
    const inner = this.flip ? `<g transform="translate(100 0) scale(-1 1)">${body}</g>` : body;
    return (this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '') + inner;
  }
}

/** Factory for a pen: createPen(style, rng, idPrefix). */
export function createPen(style, rng, id) { return new Pen(style, rng, id); }
