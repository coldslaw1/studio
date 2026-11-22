// Joins the sky to pictures that were baked ahead for a few times of day (Kiln scene orbits, open
// world pages). A baked picture has its light painted in, so between two baked times the two
// pictures are faded into each other, and what a fade cannot give (a thin moon, a dawn that was
// never baked) is a tint on top. Pure except drawGrade, which draws on a 2D canvas context.
import { createSample } from './sample.js';
import { paletteAt } from './palette.js';

// Kiln's named times: the Kiln hours over which that picture is exactly right.
const SPANS = { night: [20.5, 29], dawn: [6.5, 6.5], day: [9, 16], dusk: [18.5, 18.5] };
const lum = (t) => 0.3 * t[0] + 0.59 * t[1] + 0.11 * t[2];

/**
 * @param {object} [o]
 * @param {Array<string|{name:string, hour?:number, from?:number, to?:number}>} [o.bakes]  The times that were baked
 *   (default ['day', 'dusk', 'night'], the hamlet's). A name of Kiln's ('night', 'dawn', 'day', 'dusk') is enough;
 *   others need the Kiln hour they were baked at.
 * @param {{sun:number[], sky:number[]}} [o.day]  Daytime colours, 0..1 (default: sky.config.day of a default sky).
 * @returns {{at:Function, tintFor:Function, bakes:object[]}}
 */
export function createBakedLook(o = {}) {
  const day = o.day ?? { sun: [1, 0.949, 0.839], sky: [0.659, 0.737, 0.91] };
  const list = (o.bakes ?? ['day', 'dusk', 'night']).map((b) => {
    const e = typeof b === 'string' ? { name: b } : b;
    const span = Number.isFinite(e.hour) ? [e.hour, e.hour] : Number.isFinite(e.from) && Number.isFinite(e.to) ? [e.from, e.to] : SPANS[e?.name];
    if (!e || typeof e.name !== 'string' || !span) throw new Error(`createBakedLook: a bake must be 'night', 'dawn', 'day', 'dusk' or { name, hour }, got ${JSON.stringify(b)}`);
    const s = createSample();
    paletteAt(((span[0] + span[1]) / 2) % 24, day, 1, s); // the light it was baked in (a full moon, for night)
    return { name: e.name, from: span[0], to: span[1], tone: s.tone.slice(), dark: s.dark };
  }).sort((p, q) => p.from - q.from);
  if (list.length === 0) throw new Error('createBakedLook: "bakes" must name at least one baked time');
  const n = list.length;

  /**
   * What to draw for a sample of the sky.
   * @param {object} sample  sky.now.
   * @param {object} [out]   Filled and returned (make it once with look.at(sample) and pass it back in):
   *   a, b, mix: draw picture `a`, then picture `b` over it with alpha `mix` (b is null when mix is 0).
   *   multiply: [r, g, b] 0..1 to multiply the faded pictures by; identity: true when it changes nothing.
   *   base, baseMultiply, baseIdentity: for a view that can show ONE picture only: the picture, and the
   *   tint that brings it to this hour (pictures are only ever darkened, so the brighter neighbour is the base).
   */
  function at(sample, out = { a: '', b: null, mix: 0, multiply: [1, 1, 1], identity: true, base: '', baseMultiply: [1, 1, 1], baseIdentity: true }) {
    // which two bakes the hour lies between (the list wraps round midnight)
    let k = sample.kilnHour; if (k < list[0].from) k += 24;
    let i = n - 1;
    for (let j = 0; j < n; j++) if (k >= list[j].from) i = j;
    const a = list[i]; const b = list[(i + 1) % n];
    const next = i + 1 < n ? b.from : b.from + 24;
    let mix = k <= a.to || n === 1 || next <= a.to ? 0 : Math.min(1, (k - a.to) / (next - a.to));
    // A time with no picture of its own (a dawn that was never baked) can be brighter or warmer than the plain
    // fade at that moment, and a tint can only darken. So the fade is pushed toward the brighter picture until
    // it is at least as bright as the hour in every colour, and the tint then takes it down to the right
    // colour: a pink dawn out of the night and day pictures. Where the fade is already right, nothing changes.
    if (mix > 0) {
      for (let c = 0; c < 3; c++) {
        const span = b.tone[c] - a.tone[c];
        if (span > 1e-4) mix = Math.max(mix, Math.min(1, (sample.tone[c] - a.tone[c]) / span));
      }
    }
    out.a = a.name; out.b = mix > 0 ? b.name : null; out.mix = mix;
    const base = mix > 0 && lum(b.tone) > lum(a.tone) ? b : a;
    out.base = base.name;
    let same = true; let baseSame = true;
    for (let c = 0; c < 3; c++) {
      const faded = a.tone[c] + (b.tone[c] - a.tone[c]) * mix;
      const m = Math.min(1, sample.tone[c] / Math.max(1e-4, faded)); const bm = Math.min(1, sample.tone[c] / Math.max(1e-4, base.tone[c]));
      out.multiply[c] = m; out.baseMultiply[c] = bm;
      if (m < 0.985) same = false; if (bm < 0.985) baseSame = false;
    }
    out.identity = same; out.baseIdentity = baseSame;
    return out;
  }
  /**
   * The tint that brings ONE named baked picture to a sample's hour: for a view whose picture on screen
   * is not (yet) the one at() names as base, such as pages still being rendered in a new look.
   * @returns {{multiply:number[], identity:boolean}} out, filled
   */
  function tintFor(name, sample, out = { multiply: [1, 1, 1], identity: true }) {
    const bake = list.find((b) => b.name === name);
    if (!bake) throw new Error(`bakedLook.tintFor: no bake named "${name}" (there are ${list.map((b) => b.name).join(', ')})`);
    out.identity = true;
    for (let c = 0; c < 3; c++) { const m = Math.min(1, sample.tone[c] / Math.max(1e-4, bake.tone[c])); out.multiply[c] = m; if (m < 0.985) out.identity = false; }
    return out;
  }
  return { at, tintFor, bakes: list };
}

/**
 * Tint a rectangle of a canvas: every pixel is multiplied by [r, g, b] (0..1). One filled rectangle.
 * Skip the call when the look says identity. `cache` (any object you keep) saves making the colour text every frame.
 */
export function drawGrade(ctx, x, y, w, h, multiply, cache = null) {
  const r = Math.round(multiply[0] * 255); const g = Math.round(multiply[1] * 255); const b = Math.round(multiply[2] * 255);
  if (r >= 255 && g >= 255 && b >= 255) return;
  const key = (r << 16) | (g << 8) | b;
  let style;
  if (cache && cache.key === key) style = cache.style;
  else { style = `rgb(${r},${g},${b})`; if (cache) { cache.key = key; cache.style = style; } }
  const op = ctx.globalCompositeOperation; const fill = ctx.fillStyle;
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = style;
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = op; ctx.fillStyle = fill;
}

/**
 * One orbit made of several baked ones (the same scene at different times of day), for a scene
 * camera (camera engine, sceneCamera.setOrbit): its views draw the two pictures the hour lies
 * between, faded, and the tint on top. Orbits load when first needed.
 * @param {object} o
 * @param {Record<string, object|(() => Promise<object>)>} o.orbits  By bake name: an orbit (yaws, details, view, load) or a function that loads one.
 * @param {string} o.first  The name of an orbit that is already loaded (not a function); shown until others arrive.
 * @param {(name:string, error:Error) => void} [o.onMissing]  Called once when an orbit cannot be loaded; that time is then left out.
 * @returns {object} orbit  Also has set(look) to call with the result of bakedLook.at(sky.now) each frame.
 */
export function createBlendedOrbit(o) {
  const first = o?.orbits?.[o.first];
  if (!first || typeof first.view !== 'function') throw new Error('createBlendedOrbit: "first" must name an orbit in "orbits" that is already loaded');
  const ready = new Map([[o.first, first]]); const asked = new Set([o.first]); const missing = new Set();
  const want = (name) => {
    if (name === null || ready.has(name)) return ready.get(name) ?? null;
    if (!asked.has(name)) {
      asked.add(name);
      const src = o.orbits[name];
      if (!src) { missing.add(name); o.onMissing?.(name, new Error(`no orbit named "${name}"`)); return null; }
      Promise.resolve(typeof src === 'function' ? src() : src).then((orb) => {
        if (orb.yaws.length !== first.yaws.length || orb.details.length !== first.details.length) throw new Error(`the "${name}" orbit has other angles or detail levels than "${o.first}"`);
        ready.set(name, orb);
      }).catch((e) => { missing.add(name); o.onMissing?.(name, e); });
    }
    return null;
  };
  let A = first; let B = null; let mix = 0; let tint = null;
  const grade = [1, 1, 1]; const cache = { key: -1, style: '' };
  const wraps = new WeakMap();
  const wrap = (va, yi, li) => {
    let w = wraps.get(va);
    if (!w) {
      // the same view (heights, depth, sprites, where things are) with only the drawing changed
      w = Object.create(va);
      w.draw = (ctx, x, y, wd = va.width, h = va.height, d) => {
        va.draw(ctx, x, y, wd, h, d);
        const vb = B && mix > 0.004 ? B.view(yi, li) : null;
        // the second picture gets every option the first got (frame, flipX, the camera's turned, ...), only fainter
        if (vb) vb.draw(ctx, x, y, wd, h, { ...d, alpha: (d?.alpha ?? 1) * mix });
        if (tint) drawGrade(ctx, x, y, wd, h, tint, cache);
      };
      wraps.set(va, w);
    }
    return w;
  };
  const orbit = {
    name: first.name, yaws: first.yaws.slice(), details: first.details.slice(),
    /**
     * Follow the sky: pass bakedLook.at(sky.now) every frame. Costs nothing while the look stays the same.
     * A time whose pictures are not there (not baked, or still loading) is stood in for by the other one and the tint.
     */
    set(look) {
      const a = want(look.a); const b = look.b ? want(look.b) : null;
      if (a) { A = a; B = b; mix = b ? look.mix : 0; } else if (b) { A = b; B = null; mix = 0; } // else: keep what is showing until something arrives
      // the tint belongs to the pictures it was worked out for: both of the fade, or the base alone
      const whole = a && (b || !look.b); const alone = !whole && (a ? look.a : b ? look.b : null) === look.base;
      const m = whole ? look.multiply : look.baseMultiply;
      if (whole ? look.identity : !alone || look.baseIdentity) tint = null; else { grade[0] = m[0]; grade[1] = m[1]; grade[2] = m[2]; tint = grade; }
      return orbit;
    },
    /** Names of the times now showing: { a, b, mix }. */
    get showing() { return { a: [...ready].find(([, v]) => v === A)?.[0], b: B ? [...ready].find(([, v]) => v === B)?.[0] : null, mix }; },
    view(yi, li) { const va = A.view(yi, li); if (B && mix > 0.004) B.view(yi, li); return va ? wrap(va, yi, li) : null; },
    load(yi, li) { if (B && mix > 0.004) B.load(yi, li); return A.load(yi, li).then((va) => wrap(va, yi, li)); },
    has(yi, li) { return typeof A.has === 'function' ? A.has(yi, li) : true; },
    get pending() { return (A.pending ?? 0) + (B ? B.pending ?? 0 : 0); },
    get loaded() { return (A.loaded ?? 0) + (B ? B.loaded ?? 0 : 0); },
  };
  return orbit;
}
