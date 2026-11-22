// Themes: plain objects of colours and shape tokens. No DOM access.
// `style` picks how boxes are finished (see surface.js); the four Kiln looks
// (storybook, nocturne, papercut, crypt) use the same colours as Kiln's styles.

export const SANS_FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';
export const MONO_FONT = '"Cascadia Mono", Consolas, "Courier New", ui-monospace, monospace';
const SERIF_FONT = 'Georgia, "Palatino Linotype", "Book Antiqua", serif';
// The Kiln themes name the kit's own fonts first (see fonts.js); until a game loads them, the system fonts after them are used.
const withFont = (family, fallback) => `${/\s|\d/.test(family) ? `"${family}"` : family}, ${fallback}`;

const BASE = {
  font: SANS_FONT,
  titleFont: SANS_FONT,
  titleWeight: '800',
  radius: 0.5, // corner radius, in UI units (see unitFor)
  edge: 0.1, // outline thickness, in UI units
  uppercase: false, // draw button labels in capitals
  style: 'flat', // 'flat' | 'cel' | 'glow' | 'paper' | 'painted' | 'ascii'
  shadow: 'rgba(0, 0, 0, 0.35)', // drop shadow under panels
  warn: '#f2b23a', // warnings (toasts, low bars)
  buttonShape: 'round', // 'round' | 'pill' | 'cut' | 'tab' | 'plain'
  ornament: 'none', // panel decoration: 'none' | 'corners' | 'rivets' | 'stitch' | 'double' | 'scanlines' | 'notch'
  titleStyle: 'bar', // 'bar' (accent line under it) | 'banner' | 'shadow' | 'boxed' | 'plain'
  focusStyle: 'fill', // focused row: 'fill' (accent colour) | 'arrow' (pointer beside it) | 'bracket'
  motionStyle: 'smooth', // 'smooth' | 'snappy' | 'bouncy'
  menuAlign: 'center', // where the title screen's menu sits: 'center' | 'left' | 'right'
};

// The values each style token may take. createTheme checks them.
const CHOICES = {
  style: ['flat', 'cel', 'glow', 'paper', 'painted', 'ascii'],
  buttonShape: ['round', 'pill', 'cut', 'tab', 'plain'],
  ornament: ['none', 'corners', 'rivets', 'stitch', 'double', 'scanlines', 'notch'],
  titleStyle: ['bar', 'banner', 'shadow', 'boxed', 'plain'],
  focusStyle: ['fill', 'arrow', 'bracket'],
  motionStyle: ['smooth', 'snappy', 'bouncy'],
  menuAlign: ['center', 'left', 'right'],
};

/** STYLE_OPTIONS: every style token and the values it accepts, e.g. STYLE_OPTIONS.buttonShape. */
export const STYLE_OPTIONS = CHOICES;

/** Names of the box styles a theme's `style` token may use. */
export const STYLE_NAMES = ['flat', 'cel', 'glow', 'paper', 'painted', 'ascii'];

/** Built-in themes. Use a name with createTheme('moss') or as `base`. */
export const THEMES = {
  midnight: {
    ...BASE, name: 'midnight',
    bg: '#0f1424', dim: 'rgba(6, 8, 18, 0.72)', panel: '#1b2238', panelEdge: '#3a4670',
    row: '#28324f', text: '#f2f4ff', textDim: '#a9b3d6', accent: '#ffc857', accentText: '#1a1405',
    track: '#0d111f', danger: '#ff6b6b', good: '#5fd38d',
  },
  moss: {
    ...BASE, name: 'moss',
    bg: '#10231a', dim: 'rgba(5, 14, 9, 0.72)', panel: '#1c3a2a', panelEdge: '#3f7a55',
    row: '#28523a', text: '#f3f0e0', textDim: '#b5cdb4', accent: '#f0d9a0', accentText: '#1d2a14',
    track: '#0c1a12', danger: '#f08a6b', good: '#9ad4c0',
  },
  ember: {
    ...BASE, name: 'ember',
    bg: '#1d0f0c', dim: 'rgba(15, 6, 4, 0.74)', panel: '#33191a', panelEdge: '#7a3b2c',
    row: '#4a2523', text: '#fff1e0', textDim: '#e0b8a0', accent: '#ff8a3d', accentText: '#221003',
    track: '#160a08', danger: '#ff5d73', good: '#ffd166',
  },
  paper: {
    ...BASE, name: 'paper', radius: 0.25, shadow: 'rgba(60, 48, 30, 0.3)', warn: '#8a5a00',
    bg: '#f4ecd8', dim: 'rgba(60, 48, 30, 0.55)', panel: '#fffaf0', panelEdge: '#5b4a3a',
    row: '#eadfc6', text: '#2b2118', textDim: '#6a5947', accent: '#2f5d8a', accentText: '#ffffff',
    track: '#d4c6a6', danger: '#a8322d', good: '#2a7348',
  },
  arcade: {
    ...BASE, name: 'arcade', radius: 0, edge: 0.16, uppercase: true,
    font: '"Courier New", ui-monospace, monospace', titleFont: '"Courier New", ui-monospace, monospace',
    bg: '#000000', dim: 'rgba(0, 0, 0, 0.8)', panel: '#101018', panelEdge: '#00e5ff',
    row: '#1c1c2c', text: '#ffffff', textDim: '#9fa8c7', accent: '#ff4f9a', accentText: '#14000a',
    track: '#000000', danger: '#ff5544', good: '#39ff14',
  },
  // Kiln "storybook": cream paper, thick ink outlines, solid cel shadows.
  storybook: {
    ...BASE, name: 'storybook', style: 'cel', radius: 0.6, edge: 0.16, font: withFont('Nunito', SANS_FONT), titleFont: withFont('Alegreya', SERIF_FONT),
    ornament: 'stitch', titleStyle: 'banner', motionStyle: 'bouncy',
    shadow: '#2a1f2d', warn: '#8a5200',
    bg: '#ecd9a8', dim: 'rgba(42, 31, 45, 0.6)', panel: '#fff6e2', panelEdge: '#2a1f2d',
    row: '#f2dca6', text: '#2a1f2d', textDim: '#5f4b58', accent: '#b8452f', accentText: '#fff6e2',
    track: '#d9c188', danger: '#a32a20', good: '#2f6b3c',
  },
  // Kiln "nocturne": deep night, no outlines, light sources glow.
  nocturne: {
    ...BASE, name: 'nocturne', style: 'glow', radius: 0.7, edge: 0.05, font: withFont('Nunito', SANS_FONT), titleFont: withFont('Cinzel', SERIF_FONT), titleWeight: '700',
    buttonShape: 'pill', titleStyle: 'shadow',
    shadow: 'rgba(255, 209, 102, 0.5)',
    bg: '#120c1f', dim: 'rgba(8, 5, 16, 0.76)', panel: '#1b1b3a', panelEdge: '#4a4a8a',
    row: '#28285a', text: '#f4f1ff', textDim: '#b0acd8', accent: '#ffd166', accentText: '#1a1405',
    track: '#0c0816', danger: '#ff7f8f', good: '#6fe0c8',
  },
  // Kiln "papercut": flat pastel layers with crisp drop shadows, no outlines.
  papercut: {
    ...BASE, name: 'papercut', style: 'paper', radius: 0.35, edge: 0, font: withFont('Baloo 2', SANS_FONT), titleFont: withFont('Baloo 2', SANS_FONT),
    buttonShape: 'tab', titleStyle: 'banner', motionStyle: 'bouncy',
    shadow: 'rgba(61, 64, 91, 0.32)', warn: '#8a5a12',
    bg: '#f2cc8f', dim: 'rgba(61, 64, 91, 0.5)', panel: '#fffaf0', panelEdge: '#3d405b',
    row: '#f6e7c8', text: '#3d405b', textDim: '#4c4f68', accent: '#3d6b5a', accentText: '#fffaf0',
    track: '#e3d2ac', danger: '#b8402c', good: '#3d6b5a',
  },
  // Kiln "crypt": torch-lit stone, painted shading, thin dark linework.
  crypt: {
    ...BASE, name: 'crypt', style: 'painted', radius: 0.15, edge: 0.08, font: withFont('Alegreya', SERIF_FONT), titleFont: withFont('Grenze Gotisch', SERIF_FONT), titleWeight: '700',
    buttonShape: 'cut', ornament: 'corners', titleStyle: 'boxed',
    shadow: 'rgba(0, 0, 0, 0.6)',
    bg: '#0b0a12', dim: 'rgba(11, 10, 18, 0.78)', panel: '#231d2e', panelEdge: '#0b0a12',
    row: '#352b3f', text: '#efe8cc', textDim: '#b3a678', accent: '#e07a2c', accentText: '#16131f',
    track: '#16131f', danger: '#f0705a', good: '#86b060',
  },
  // For games drawn in ASCII: monospace text, square corners, frames made of + - | characters.
  terminal: {
    ...BASE, name: 'terminal', style: 'ascii', radius: 0, edge: 0.08, font: MONO_FONT, titleFont: MONO_FONT,
    titleWeight: '700', shadow: 'rgba(0, 0, 0, 0)', warn: '#ffd24a',
    ornament: 'scanlines', titleStyle: 'plain', focusStyle: 'bracket', motionStyle: 'snappy',
    bg: '#020a04', dim: 'rgba(0, 6, 2, 0.84)', panel: '#04140a', panelEdge: '#33ff66',
    row: '#0a2212', text: '#b6ffc8', textDim: '#6fcf8a', accent: '#33ff66', accentText: '#021006',
    track: '#010602', danger: '#ff7a66', good: '#33ff66',
  },
  // High contrast, for players who need it (also used by the `highContrast` setting).
  contrast: {
    ...BASE, name: 'contrast', radius: 0.3, edge: 0.16, shadow: 'rgba(0, 0, 0, 0)', warn: '#ffe600',
    bg: '#000000', dim: 'rgba(0, 0, 0, 0.9)', panel: '#000000', panelEdge: '#ffffff',
    row: '#1c1c1c', text: '#ffffff', textDim: '#e2e2e2', accent: '#ffe600', accentText: '#000000',
    track: '#000000', danger: '#ff9a8f', good: '#7dff9a',
  },
};

const COLOR_KEYS = ['bg', 'dim', 'panel', 'panelEdge', 'row', 'text', 'textDim', 'accent',
  'accentText', 'track', 'danger', 'good'];

/**
 * createTheme(spec) -> theme object
 *   spec: a built-in name (see THEMES), or an object
 *         { base: 'moss', accent: '#ff0', style: 'ascii', ... } overriding any token.
 * Throws on an unknown name, unknown token or unknown style.
 */
export function createTheme(spec = 'midnight') {
  if (typeof spec === 'string') {
    if (!THEMES[spec]) {
      throw new Error(`createTheme: unknown theme "${spec}". Use one of: ${Object.keys(THEMES).join(', ')}`);
    }
    return { ...THEMES[spec] };
  }
  if (!spec || typeof spec !== 'object') {
    throw new Error(`createTheme: expected a theme name or an object, got ${String(spec)}`);
  }
  const { base = 'midnight', ...overrides } = spec;
  const theme = createTheme(base);
  for (const key of Object.keys(overrides)) {
    if (!(key in theme)) {
      throw new Error(`createTheme: unknown theme token "${key}". Tokens: ${Object.keys(theme).join(', ')}`);
    }
    theme[key] = overrides[key];
  }
  for (const [token, allowed] of Object.entries(CHOICES)) {
    if (!allowed.includes(theme[token])) {
      const what = token === 'style' ? 'style' : token;
      throw new Error(`createTheme: unknown ${what} "${theme[token]}". Use one of: ${allowed.join(', ')}`);
    }
  }
  if (!('name' in overrides)) theme.name = `${base}-custom`;
  return theme;
}

function channels(color) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!hex) return null;
  let h = hex[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function luminance(color) {
  const rgb = channels(color);
  if (!rgb) throw new Error(`contrastRatio: "${color}" is not a #rgb or #rrggbb colour`);
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** contrastRatio('#fff', '#000') -> 21. WCAG contrast between two hex colours (1 to 21). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// [text colour, surface, lowest contrast]. Body text needs 4.5, large or bold marks need 3.
export const CONTRAST_PAIRS = [
  ['text', 'panel', 4.5], ['text', 'row', 4.5], ['text', 'bg', 4.5], ['textDim', 'panel', 4.5],
  ['textDim', 'bg', 4.5], ['accentText', 'accent', 4.5], ['accent', 'panel', 3], ['danger', 'row', 3],
  ['danger', 'panel', 3], ['good', 'track', 3], ['warn', 'panel', 3],
];

/**
 * checkTheme(theme) -> array of problem strings (empty when the theme is fine).
 * Checks that every colour token exists and that text, the focus colour and
 * the status colours can be told apart from the surfaces they are drawn on.
 */
export function checkTheme(theme) {
  const problems = [];
  for (const key of COLOR_KEYS) {
    if (typeof theme[key] !== 'string') problems.push(`missing colour "${key}"`);
  }
  if (problems.length) return problems;
  for (const [fg, bg, need] of CONTRAST_PAIRS) {
    if (typeof theme[fg] !== 'string' || !channels(theme[fg]) || !channels(theme[bg])) continue;
    const ratio = contrastRatio(theme[fg], theme[bg]);
    if (ratio < need) {
      problems.push(fg === 'accent'
        ? `accent on panel has contrast ${ratio.toFixed(2)}, below 3, focus would be hard to see`
        : `${fg} on ${bg} has contrast ${ratio.toFixed(2)}, needs ${need}`);
    }
  }
  return problems;
}
