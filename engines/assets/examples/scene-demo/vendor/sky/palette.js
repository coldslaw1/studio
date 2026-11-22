// The colours of the light and the sky through the day. The rows are the SAME numbers as Kiln's
// time-of-day table (assets/src/scene-sky.js, KEYS), so a picture Kiln baked at "dusk" and a view
// lit by this engine at the same hour show the same light. tests/kiln-anchor.test.js checks it
// against the real file. Colours are [r, g, b] in 0..1. Pure, no allocation.

/** '#rrggbb' or '#rgb' -> [r, g, b] in 0..1. Throws for anything else. */
export function hexRgb(hex, where = 'hexRgb') {
  const m = typeof hex === 'string' && /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) throw new Error(`${where}: expected a hex colour such as "#ffc070", got ${JSON.stringify(hex)}`);
  const s = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
}

/** [r, g, b] in 0..1 -> '#rrggbb'. */
export function rgbHex(c) {
  return '#' + [0, 1, 2].map((i) => Math.round(Math.min(1, Math.max(0, c[i])) * 255).toString(16).padStart(2, '0')).join('');
}

// One row: light colour (null = the scene's daytime colour), light strength, sky fill colour (null =
// the scene's), fill strength, fog colour, how dark it is (0 day, 1 night), top and bottom of the sky.
const row = (sun, power, sky, skyPower, fog, dark, top, bottom, night = false) => ({ sun: sun && hexRgb(sun), power, sky: sky && hexRgb(sky), skyPower, fog: hexRgb(fog), dark, top: hexRgb(top), bottom: hexRgb(bottom), night });
const NIGHT = row('#9db4ff', 0.3, '#3d4f96', 0.5, '#161d3a', 1, '#070a1c', '#1b2550', true);
const DAWN = row('#ffb27c', 0.85, '#9a94c8', 0.8, '#eabfae', 0.4, '#5a6aa8', '#f2b79a');
const DAY = row(null, 1, null, 1, '#d3e2f0', 0, '#5a93d8', '#bcd9f0');
const DUSK = row('#ff8040', 0.85, '#7d6cab', 0.72, '#dc8f6e', 0.7, '#3b3a78', '#f08a50');
const HOURS = [0, 5, 6.5, 9, 16, 18.5, 20.5, 24];
const ROWS = [NIGHT, NIGHT, DAWN, DAY, DAY, DUSK, NIGHT, NIGHT];

/** Kiln hours at which the light changes hands between the sun and the moon (in the middle of each twilight). */
export const HANDOVER = [5.75, 19.5];

const mix3 = (out, a, b, f) => { out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f; };

/**
 * Fill the colours of a sample for a Kiln hour.
 * @param {number} k  Kiln hour, 0..24.
 * @param {{sun:number[], sky:number[]}} day  The scene's daytime light and fill colours (0..1).
 * @param {number} moonlight  0..1: how much of a full, high moon's light there is (scales the night rows only).
 * @param {object} out  A sample (see createSample): light.color, light.power, fill.color, fill.power,
 *   fogColor, dark, skyTop, skyBottom and tone are written. tone is the overall colour of the light: what a
 *   white wall half in sun and half in shade averages to; baked pictures are compared and tinted by it.
 */
export function paletteAt(k, day, moonlight, out) {
  let i = 0;
  while (i < HOURS.length - 2 && k >= HOURS[i + 1]) i++;
  const a = ROWS[i]; const b = ROWS[i + 1];
  const f = Math.min(1, Math.max(0, (k - HOURS[i]) / (HOURS[i + 1] - HOURS[i])));
  // a thin or low moon gives less light and a slightly darker sky fill than the full moon Kiln bakes
  const np = 0.35 + 0.65 * moonlight; const nf = 0.85 + 0.15 * moonlight;
  const pa = a.night ? a.power * np : a.power; const pb = b.night ? b.power * np : b.power;
  const sa = a.night ? a.skyPower * nf : a.skyPower; const sb = b.night ? b.skyPower * nf : b.skyPower;
  mix3(out.light.color, a.sun ?? day.sun, b.sun ?? day.sun, f);
  mix3(out.fill.color, a.sky ?? day.sky, b.sky ?? day.sky, f);
  mix3(out.fogColor, a.fog, b.fog, f); mix3(out.skyTop, a.top, b.top, f); mix3(out.skyBottom, a.bottom, b.bottom, f);
  out.light.power = pa + (pb - pa) * f; out.fill.power = sa + (sb - sa) * f; out.dark = a.dark + (b.dark - a.dark) * f;
  // The overall tone: mixed between the two rows' own tones (not worked out from the mixed light), so a
  // fade between two baked pictures has exactly this tone; and taken before the dip below, so they do not blink.
  const asun = a.sun ?? day.sun; const bsun = b.sun ?? day.sun; const asky = a.sky ?? day.sky; const bsky = b.sky ?? day.sky;
  for (let c = 0; c < 3; c++) {
    const ta = asun[c] * pa * 0.6 + asky[c] * sa * 0.4; const tb = bsun[c] * pb * 0.6 + bsky[c] * sb * 0.4;
    out.tone[c] = ta + (tb - ta) * f;
  }
  // the sun's light is gone a moment before the moon's takes over, so shadows never jump while they show
  const near = Math.min(Math.abs(k - HANDOVER[0]), Math.abs(k - HANDOVER[1]));
  if (near < 0.15) { const n = near / 0.15; out.light.power *= n * n * (3 - 2 * n); }
}

