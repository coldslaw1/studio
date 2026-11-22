// Weather and light. Cloud takes the sun away and leaves the grey light of the sky, fog and rain
// pull the far distance in, lightning throws a moment of white. These functions turn a weather
// sample into numbers for the renderers: a tint for baked pictures, and a sky sample (the sky
// engine's shape) with the weather laid over it for the views that are lit live.
import { clamp, lerp } from './noise.js';

const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/**
 * The tint a baked picture needs under this weather (multiply the picture by it).
 * @param {object} w      weather.now
 * @param {object} [out]  { multiply: [r, g, b], identity } to refill.
 * @returns {{multiply:number[], identity:boolean}} identity is true when there is nothing to do
 */
export function weatherGrade(w, out = { multiply: [1, 1, 1], identity: true }) {
  const b = clamp(lerp(1, 0.6, Math.pow(clamp((w.cloud - 0.1) / 0.9), 1.2)) - 0.08 * w.intensity - 0.05 * w.fog, 0.3, 1); // a few fair-weather clouds dim nothing
  const cool = 0.05 * w.cloud;
  out.multiply[0] = b * (1 - cool); out.multiply[1] = b; out.multiply[2] = Math.min(1, b * (1 + cool));
  out.identity = b > 0.992;
  return out;
}

/** A sky-shaped sample for weatherSky to fill. */
function createLitSample() {
  return {
    light: { dir: [0, 0, 1], color: [1, 1, 1], power: 1, source: 'sun' },
    fill: { color: [1, 1, 1], power: 1 },
    skyTop: [0, 0, 0], skyBottom: [0, 0, 0], fogColor: [0, 0, 0], tone: [1, 1, 1],
  };
}

/**
 * Lay the weather over a sample of the sky engine. Views use the result in place of sky.now:
 * the sun is dimmed by cloud, the sky and the fog colour turn grey, stars and moonlight are
 * hidden, lamps come on in the gloom of a storm, and lightning brightens everything for a moment.
 * The sample given is never written to. Without a sky (no `light` in the sample) it is returned as it is.
 * @param {object} sky    sky.now (or base.time.raw).
 * @param {object} w      weather.now
 * @param {object} [out]  The object to refill; keep one and pass it every frame.
 * @param {{flash?:boolean}} [opts]  flash: false leaves the lightning out (reduced motion).
 * @returns {object} a sample with every field of the sky's
 */
export function weatherSky(sky, w, out = {}, opts = {}) {
  if (!sky || !sky.light || !sky.fill) return sky;
  if (!out.light) Object.assign(out, createLitSample());
  for (const k in sky) { const v = sky[k]; if (typeof v !== 'object' || v === null) out[k] = v; }
  out.sun = sky.sun; out.moon = sky.moon;
  const flash = opts.flash === false ? 0 : w.flash;
  const grade = weatherGrade(w, out.grade ??= { multiply: [1, 1, 1], identity: true });
  const cover = Math.pow(w.cloud, 0.8);
  // the light that casts shadows: weaker and greyer under cloud
  const L = sky.light; const l = lum(L.color);
  const d = out.light.dir; d[0] = L.dir[0]; d[1] = L.dir[1]; d[2] = L.dir[2];
  out.light.source = L.source;
  out.light.power = L.power * w.sun + flash * 0.9;
  for (let c = 0; c < 3; c++) out.light.color[c] = lerp(lerp(L.color[c], l, cover * 0.7), 1, flash * 0.8);
  // the light of the sky itself: it carries the day when the sun is gone
  const F = sky.fill; const f = lum(F.color);
  out.fill.power = F.power * w.fill + flash * 0.5;
  for (let c = 0; c < 3; c++) out.fill.color[c] = lerp(lerp(F.color[c], f * (c === 2 ? 1.04 : 0.97), cover * 0.6), 1, flash * 0.6);
  // the backdrop: grey cloud, darker in a storm; fog pulls the top down to the horizon colour
  const deep = 1 - 0.38 * cover * (0.4 + 0.6 * Math.max(w.intensity, w.storm));
  const bottom = lum(sky.skyBottom) * deep; const top = lum(sky.skyTop) * deep; const thick = clamp(w.fog * 0.9 + w.snow * 0.3);
  for (let c = 0; c < 3; c++) {
    const cold = c === 2 ? 1.05 : c === 0 ? 0.95 : 1;
    const b = lerp(sky.skyBottom[c], bottom * cold, cover);
    const t = lerp(lerp(sky.skyTop[c], top * cold * 0.92, cover), b, thick);
    out.skyBottom[c] = clamp(b + flash * 0.45); out.skyTop[c] = clamp(t + flash * 0.55);
    out.fogColor[c] = clamp(lerp(sky.fogColor[c], b, Math.max(cover, w.fog)) + flash * 0.3);
    out.tone[c] = (sky.tone?.[c] ?? 1) * grade.multiply[c]; // the tint baked pictures get: the sky's createBakedLook reads it
  }
  const clearSky = (1 - w.cloud) * (1 - w.cloud) * (1 - w.fog);
  out.stars = (sky.stars ?? 0) * clearSky;
  out.moonlight = (sky.moonlight ?? 0) * lerp(1, 0.2, cover);
  out.lamps = Math.max(sky.lamps ?? 0, clamp((w.cloud - 0.8) * 5) * 0.55 * clamp(w.intensity + w.fog));
  return out;
}

/**
 * How bright rain and snow should be drawn under a sky sample: 0.12 (a dark night) to 1 (day).
 * @param {object} [sky]  sky.now or the result of weatherSky; without one the answer is 1.
 */
export function precipLight(sky) {
  if (!sky || !sky.light || !sky.fill) return 1;
  return clamp(0.12 + 0.75 * sky.fill.power + 0.3 * sky.light.power, 0.12, 1);
}

/**
 * The wind as Kiln wants it in a scene: scene.wind = [x, y], whose length is its strength
 * (Kiln's own default is about 0.85, a light breeze of 5 m/s here).
 * @param {object} w      weather.now
 * @param {number[]} [out]
 */
export function kilnWind(w, out = [0, 0]) {
  const k = clamp(w.wind.speed / 5, 0.1, 3) * 0.85;
  out[0] = w.wind.dir[0] * k; out[1] = w.wind.dir[1] * k;
  return out;
}
