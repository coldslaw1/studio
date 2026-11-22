// Skins: a theme made for one game. A skin starts from the kind of game it is
// (genre), can take the game's own Kiln palette for its colours, and is then
// checked and nudged until all text is readable. The result is an ordinary
// theme object for createUi({ theme }) or ui.setTheme().

import { createTheme, THEMES, contrastRatio, checkTheme, MONO_FONT, CONTRAST_PAIRS } from './theme.js';

/**
 * Looks by kind of game. `base` is the built-in theme a genre starts from;
 * `tokens` are the shapes, ornament, title and motion that give it its feel.
 */
export const GENRES = {
  adventure: { base: 'storybook', tokens: { buttonShape: 'round', ornament: 'stitch', titleStyle: 'banner', motionStyle: 'bouncy' } },
  rpg: { base: 'crypt', tokens: { buttonShape: 'cut', ornament: 'corners', titleStyle: 'boxed', motionStyle: 'smooth' } },
  platformer: { base: 'papercut', tokens: { buttonShape: 'pill', ornament: 'none', titleStyle: 'banner', motionStyle: 'bouncy', radius: 0.8 } },
  puzzle: { base: 'papercut', tokens: { buttonShape: 'round', ornament: 'double', titleStyle: 'bar', motionStyle: 'smooth', radius: 0.5 } },
  cozy: { base: 'storybook', tokens: { buttonShape: 'pill', ornament: 'stitch', titleStyle: 'banner', motionStyle: 'bouncy', radius: 0.9 } },
  horror: { base: 'crypt', tokens: { buttonShape: 'plain', ornament: 'none', titleStyle: 'shadow', focusStyle: 'bracket', motionStyle: 'smooth', radius: 0, accent: '#b8402c', accentText: '#efe8cc' } },
  arcade: { base: 'arcade', tokens: { buttonShape: 'cut', ornament: 'notch', titleStyle: 'shadow', focusStyle: 'arrow', motionStyle: 'snappy' } },
  scifi: { base: 'nocturne', tokens: { style: 'flat', buttonShape: 'cut', ornament: 'notch', titleStyle: 'plain', focusStyle: 'bracket', motionStyle: 'snappy', radius: 0.12, edge: 0.07, uppercase: true, font: MONO_FONT, titleFont: MONO_FONT, accent: '#5ee6ff', accentText: '#04121a', shadow: 'rgba(0, 0, 0, 0.5)' } },
  strategy: { base: 'paper', tokens: { buttonShape: 'plain', ornament: 'double', titleStyle: 'boxed', motionStyle: 'snappy', radius: 0.1 } },
  ascii: { base: 'terminal', tokens: {} },
};

/** Names of the genres createSkin knows. */
export const GENRE_NAMES = Object.keys(GENRES);

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function rgb(color) {
  if (!HEX.test(color)) throw new Error(`createSkin: "${color}" is not a #rgb or #rrggbb colour`);
  let h = color.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
/** mixColor('#000', '#fff', 0.25) -> a hex colour a quarter of the way from the first to the second. */
export function mixColor(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const isDark = (color) => contrastRatio(color, '#ffffff') > contrastRatio(color, '#000000');

// Colour tokens from a Kiln palette (roles like ink, cream, gold, red, leaf, night).
function fromPalette(p, dark) {
  const has = (...roles) => roles.map((r) => p[r]).find((c) => typeof c === 'string' && HEX.test(c));
  const ink = has('ink') ?? '#15121c';
  const light = has('white', 'cream', 'bone') ?? '#f6efdc';
  const red = has('red', 'brick') ?? '#d9483b';
  const [r, g, b] = rgb(ink);
  const out = { dim: `rgba(${r}, ${g}, ${b}, ${dark ? 0.76 : 0.58})` };
  if (dark) {
    const night = has('night', 'stone') ?? mixColor(ink, light, 0.14);
    out.bg = mixColor(ink, night, 0.2);
    out.panel = mixColor(ink, night, 0.62);
    out.row = mixColor(out.panel, light, 0.12);
    out.panelEdge = mixColor(out.panel, light, 0.3);
    out.text = light;
    out.textDim = mixColor(light, out.panel, 0.32);
    out.accent = has('gold', 'ember', 'flame') ?? '#ffd166';
    out.accentText = ink;
    out.track = mixColor(ink, '#000000', 0.3);
    out.danger = mixColor(red, light, 0.3);
    out.good = has('slime', 'leaf') ?? '#6fe0c8';
    out.warn = has('ember', 'gold') ?? '#f2b23a';
  } else {
    const cream = has('cream', 'bone', 'white') ?? light;
    out.bg = cream;
    out.panel = mixColor(cream, '#ffffff', 0.6);
    out.row = mixColor(cream, ink, 0.05);
    out.panelEdge = ink;
    out.text = ink;
    out.textDim = mixColor(ink, cream, 0.3);
    out.accent = has('brick', 'plum', 'roof') ?? red;
    out.accentText = out.panel;
    out.track = mixColor(cream, ink, 0.18);
    out.danger = mixColor(red, ink, 0.3);
    out.good = has('leafDark', 'leaf') ?? '#2f6b3c';
    out.warn = mixColor(has('gold', 'ember') ?? '#f2b23a', ink, 0.5);
  }
  return out;
}

/**
 * fixContrast(theme) -> the same theme object, with any text, focus or status
 * colour that was hard to read moved toward black or white until checkTheme
 * passes. Colours that are already fine are not touched.
 */
export function fixContrast(theme) {
  for (let pass = 0; pass < 3 && checkTheme(theme).length; pass++) {
    for (const [fg, bg, need] of CONTRAST_PAIRS) {
      if (!HEX.test(theme[fg] ?? '') || !HEX.test(theme[bg] ?? '')) continue;
      const toward = isDark(theme[bg]) ? '#ffffff' : '#000000';
      for (let i = 0; i < 12 && contrastRatio(theme[fg], theme[bg]) < need; i++) theme[fg] = mixColor(theme[fg], toward, 0.15);
    }
  }
  return theme;
}

/**
 * createSkin(spec) -> theme object made for one game.
 *   spec: {
 *     genre,      one of GENRE_NAMES: sets shapes, ornament, title style and motion feel
 *     style,      the game's Kiln style ('storybook', 'nocturne', 'papercut', 'crypt') or any theme name:
 *                 sets how boxes are finished and the default colours
 *     palette,    the game's own Kiln palette ({ ink, cream, gold, red, leaf, night, ... }): sets the colours
 *     dark,       true / false to force a dark or light UI from the palette (default: as the base theme)
 *     accent,     one colour for focus and highlights
 *     name,       the theme's name (default '<genre>-skin')
 *     ...tokens   any other theme token wins over everything above (font, radius, titleStyle, ...)
 *   }
 * At least one of genre, style or palette is needed. The result always passes checkTheme.
 */
export function createSkin(spec = {}) {
  if (!spec || typeof spec !== 'object') throw new Error(`createSkin: expected an object, got ${String(spec)}`);
  const { genre, style, palette, dark, accent, name, ...tokens } = spec;
  if (genre === undefined && style === undefined && palette === undefined) {
    throw new Error('createSkin: give at least one of genre, style or palette');
  }
  if (genre !== undefined && !GENRES[genre]) throw new Error(`createSkin: unknown genre "${genre}". Use one of: ${GENRE_NAMES.join(', ')}`);
  if (style !== undefined && !THEMES[style]) throw new Error(`createSkin: unknown style "${style}". Use one of: ${Object.keys(THEMES).join(', ')}`);
  if (palette !== undefined && (!palette || typeof palette !== 'object')) throw new Error('createSkin: palette must be an object of colours, e.g. { ink: "#2a1f2d", cream: "#f2dca6" }');
  const g = genre ? GENRES[genre] : null;
  const base = style ?? (g ? g.base : 'midnight');
  // A genre's own colours only apply when the game brings no style or palette of its own.
  const feel = { ...(g ? g.tokens : {}) };
  if (style || palette) for (const key of ['accent', 'accentText', 'shadow', 'style']) delete feel[key];
  const wantDark = dark ?? isDark(THEMES[base].bg);
  const colours = palette ? fromPalette(palette, wantDark) : {};
  const theme = createTheme({
    base, ...colours, ...feel, ...(accent ? { accent } : {}), ...tokens,
    name: name ?? `${genre ?? style ?? 'palette'}-skin`,
  });
  if (accent && !('accentText' in tokens)) theme.accentText = isDark(accent) ? '#ffffff' : '#000000';
  return fixContrast(theme);
}
