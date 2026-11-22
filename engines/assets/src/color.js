// Colour maths in OKLCH, so shadows and highlights shift hue the way painted art does.
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function parseHex(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('');
}

export function hexToOklch(hex) {
  const [r, g, b] = parseHex(hex).map((v) => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklchToLinear({ l, c, h }) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

export function oklchToHex(col) {
  let c = { l: clamp01(col.l), c: Math.max(0, col.c), h: ((col.h % 360) + 360) % 360 };
  // Pull chroma in until the colour fits the screen's gamut.
  for (let i = 0; i < 24; i++) {
    const lin = oklchToLinear(c);
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) break;
    c = { ...c, c: c.c * 0.9 };
  }
  return toHex(oklchToLinear(c).map((v) => toSrgb(clamp01(v)) * 255));
}

/** Move hue `h` toward `target` by at most `amount` degrees, the short way round. */
export function hueToward(h, target, amount) {
  const diff = ((target - h + 540) % 360) - 180;
  return h + Math.sign(diff) * Math.min(Math.abs(diff), amount);
}

/** Shadow, base, light and outline tones for one base colour. */
export function ramp(hex, opts = {}) {
  const { shadowHue = 280, lightHue = 95, strength = 1 } = opts;
  const o = hexToOklch(hex);
  return {
    base: hex,
    shadow: oklchToHex({ l: o.l - 0.13 * strength, c: o.c * 1.08, h: hueToward(o.h, shadowHue, 18) }),
    deep: oklchToHex({ l: o.l - 0.24 * strength, c: o.c * 1.05, h: hueToward(o.h, shadowHue, 26) }),
    light: oklchToHex({ l: o.l + 0.1 * strength, c: o.c * 0.95, h: hueToward(o.h, lightHue, 12) }),
    outline: oklchToHex({ l: Math.max(0.06, Math.min(o.l * 0.42, o.l - 0.17)), c: Math.min(o.c, 0.09), h: hueToward(o.h, shadowHue, 28) }),
  };
}

export function mix(hexA, hexB, t) {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
}

export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => toLin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (same) to 21 (black on white). */
export function contrast(hexA, hexB) {
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
