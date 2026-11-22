// Colour tones for shading. Kiln's own ramp() can be passed to the renderers instead (it returns
// the same five names), so rigs match a Kiln style exactly.

const parse = (hex) => {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`tones: not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const hex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * Five tones of one colour: { deep, shadow, base, light, outline }. Shadows lean cool and
 * highlights lean warm, the way painted art does.
 */
export function tones(color) {
  const c = parse(color);
  return {
    deep: hex(mix(c, [22, 18, 48], 0.56)),
    shadow: hex(mix(c, [34, 28, 66], 0.32)),
    base: hex(c),
    light: hex(mix(c, [255, 246, 220], 0.34)),
    outline: hex(mix(c, [20, 14, 34], 0.76)),
  };
}

/** Tone names from darkest to lightest, as used by the ASCII renderer's shade levels 0..3. */
export const TONE_ORDER = ['deep', 'shadow', 'base', 'light'];
