// Colour rules for generated assets. Every colour is a role from the active style's palette
// ("roof", "stone") or a blend of two roles ("cream~wood~0.3"), so a generated asset always sits
// inside the style it was made for. Nothing here invents a free hex colour.
import { resolveStyle } from './styles.js';
import { mix, contrast } from './color.js';

/** What a colour word in a description means, as palette roles to try in order. */
export const COLOR_ROLES = {
  red: ['red', 'brick'], blue: ['cloth', 'sky'], green: ['leaf', 'leafDark'], gold: ['gold'], purple: ['plum'], white: ['white', 'cream'],
  black: ['ink~night~0.5', 'night'], pink: ['pink'], brown: ['wood'], grey: ['stone', 'steel'], orange: ['ember'],
};

/** Pools the makers draw from. Keys are what the colour is for. */
export const POOLS = {
  wall: ['cream', 'white~cream~0.5', 'stone', 'wood', 'brick', 'cream~wood~0.35', 'stone~cream~0.5'],
  roof: ['roof', 'brick', 'wood~ink~0.3', 'night', 'leafDark', 'plum~ink~0.25', 'stone~ink~0.35'],
  cloth: ['red', 'cloth', 'plum', 'leaf', 'gold', 'pink', 'sky', 'brick', 'night', 'leafDark', 'cream'],
  dull: ['wood', 'stone', 'cream~wood~0.5', 'wood~ink~0.3', 'stone~cream~0.4', 'leafDark', 'night'],
  skin: ['cream~wood~0.12', 'cream~wood~0.3', 'cream~pink~0.22', 'cream~wood~0.55', 'wood~ink~0.12', 'wood~cream~0.25'],
  hair: ['wood~ink~0.45', 'wood', 'ink~night~0.4', 'gold~wood~0.3', 'stone~white~0.4', 'brick~wood~0.4', 'white~stone~0.3'],
  metal: ['steel', 'steel~ink~0.3', 'gold~wood~0.2', 'steel~white~0.3'],
  hide: ['wood', 'wood~ink~0.35', 'stone', 'stone~ink~0.3', 'cream~wood~0.5', 'bone~stone~0.4'],
};

/**
 * Colour helper bound to one style.
 * @param {string} [styleName]  storybook, nocturne, papercut or crypt.
 * @param {Object<string,string>} [overrides]  Palette overrides, as in a kiln spec.
 */
export function createColors(styleName = 'storybook', overrides = {}) {
  const style = resolveStyle(styleName, overrides);
  const hex = (spec) => {
    if (typeof spec !== 'string') throw new Error(`gen colour: expected a palette role or "a~b~t", got ${JSON.stringify(spec)}`);
    const [a, b, t] = spec.split('~');
    const one = (role) => {
      const h = style.palette[role];
      if (!h) throw new Error(`gen colour: "${role}" is not in the ${style.name} palette (${Object.keys(style.palette).join(', ')})`);
      return h;
    };
    if (b === undefined) return one(a);
    const k = Number(t);
    if (!(k >= 0 && k <= 1)) throw new Error(`gen colour: bad blend "${spec}"; use "roleA~roleB~0.3"`);
    return mix(one(a), one(b), k);
  };
  const colors = {
    style,
    hex,
    /** Pick from a pool. `against` is a list of specs the pick must stand out from (contrast >= min). */
    pick(rng, pool, against = [], min = 1.25) {
      const start = rng.int(0, pool.length - 1);
      let best = pool[start];
      let bestC = -1;
      for (let i = 0; i < pool.length; i++) {
        const spec = pool[(start + i) % pool.length];
        const c = against.length ? Math.min(...against.map((o) => contrast(hex(spec), hex(o)))) : Infinity;
        if (c >= min) return spec;
        if (c > bestC) { bestC = c; best = spec; }
      }
      return best;
    },
    /** A colour word from the description as a spec, or null when the word is not a colour. */
    word(rng, name) { const pool = COLOR_ROLES[name]; return pool ? pool[rng.int(0, pool.length - 1)] : null; },
    /** A darker or lighter relative of a spec that is still on the palette (blended toward ink or white). */
    shade(spec, amount) {
      const [a, b, t] = spec.split('~');
      const base = b === undefined ? a : Number(t) < 0.5 ? a : b; // keep to two roles: lean on the dominant one
      return `${base}~${amount < 0 ? 'ink' : 'white'}~${Math.min(0.6, Math.abs(amount)).toFixed(2)}`;
    },
    /** Turn { name: spec } into { name: hex }. */
    resolve(specs) { return Object.fromEntries(Object.entries(specs).map(([k, v]) => [k, hex(v)])); },
    contrast: (a, b) => contrast(hex(a), hex(b)),
  };
  return colors;
}

/** True when a hex colour is a palette role or lies on the line between two roles of the style (within rounding). */
export function onPalette(hexColor, style) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const p = rgb(hexColor);
  const roles = [...new Set(Object.values(style.palette))].map(rgb);
  for (let i = 0; i < roles.length; i++) {
    for (let j = i; j < roles.length; j++) {
      const a = roles[i]; const b = roles[j];
      const ab = b.map((v, k) => v - a[k]);
      const len = ab.reduce((s, v) => s + v * v, 0);
      const t = len ? Math.max(0, Math.min(1, p.reduce((s, v, k) => s + (v - a[k]) * ab[k], 0) / len)) : 0;
      if (p.every((v, k) => Math.abs(v - (a[k] + ab[k] * t)) <= 1.5)) return true;
    }
  }
  return false;
}
