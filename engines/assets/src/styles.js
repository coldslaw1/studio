// A style decides how every shape is finished: outline, shading, glow and palette.
// Recipes only name colours by role ("leaf", "cream"), so one recipe looks right in every style.

export const STYLES = {
  storybook: {
    description: 'Cosy picture-book look: thick tinted outlines, two-tone cel shading, soft ground shadows.',
    shading: 'cel',
    outline: 3.2,
    wobble: 0.9,
    groundShadow: 0.22,
    palette: {
      cream: '#f2dca6', plum: '#8f5fa6', brick: '#c8553d', roof: '#93392b', wood: '#c98b4a',
      leaf: '#4c9a4f', leafDark: '#1f5230', grass: '#2f6b3c', grassAlt: '#2b6338',
      gold: '#f4c542', stone: '#9aa5a8', white: '#fff6e2', ink: '#2a1f2d', slime: '#9ad4c0',
      pink: '#ec8fa6', red: '#d9483b', sky: '#6fb7d9', night: '#3b4a6b', ember: '#ff7a3c', steel: '#aab4c2', bone: '#ece3c8', cloth: '#4a6fa5', flame: '#fff1a8',
    },
  },
  nocturne: {
    description: 'Dark and glowing: no outlines, soft gradient shading, light sources get halos.',
    shading: 'glow',
    outline: 0,
    wobble: 0.6,
    groundShadow: 0,
    palette: {
      cream: '#e9d9b0', plum: '#6d4aa0', brick: '#a2433f', roof: '#5c2738', wood: '#8a5a3a',
      leaf: '#2f7d68', leafDark: '#123a3a', grass: '#12303a', grassAlt: '#102a34',
      gold: '#ffd166', stone: '#5d6680', white: '#f4f1ff', ink: '#120c1f', slime: '#6fe0c8',
      pink: '#ff7fb0', red: '#ff3b4e', sky: '#5ab0ff', night: '#1b1b3a', ember: '#ff9a3c', steel: '#8793ad', bone: '#d9d2c0', cloth: '#4a6fa5', flame: '#fff1a8',
    },
  },
  papercut: {
    description: 'Flat cut-paper layers: no outlines, crisp drop shadows, gentle pastel palette.',
    shading: 'paper',
    outline: 0,
    wobble: 0.3,
    groundShadow: 0.14,
    palette: {
      cream: '#f6e7c8', plum: '#a583c4', brick: '#e07a5f', roof: '#b8503f', wood: '#d9a066',
      leaf: '#81b29a', leafDark: '#3d6b5a', grass: '#a8cf9a', grassAlt: '#9cc68e',
      gold: '#f2cc8f', stone: '#b8c0c8', white: '#fffaf0', ink: '#3d405b', slime: '#b8e6d8',
      pink: '#f4a6b8', red: '#e5604d', sky: '#9cc9e8', night: '#5a6690', ember: '#f59e5b', steel: '#c3ccd6', bone: '#f3ecd8', cloth: '#4a6fa5', flame: '#fff1a8',
    },
  },
  crypt: {
    description: 'Torch-lit dungeon look: muted dark palette, painted four-tone shading, thin dark linework, no gloss. Made to be used with "pixel" and the "crypt" palette.',
    shading: 'painted',
    outline: 1.3,
    wobble: 0.35,
    groundShadow: 0.4,
    rampStrength: 1.6,
    palette: {
      cream: '#d9cfa6', plum: '#5b3a86', brick: '#8a3a28', roof: '#5a1c1c', wood: '#6b3a26',
      leaf: '#4f7d48', leafDark: '#1c3327', grass: '#2f5438', grassAlt: '#284a32',
      gold: '#c9973e', stone: '#5d6170', white: '#d9cfa6', ink: '#0b0a12', slime: '#86b060',
      pink: '#a8556a', red: '#a8372a', sky: '#3460a8', night: '#1a2030', ember: '#e07a2c',
      steel: '#8794a8', bone: '#cfc49c', cloth: '#3f4d66', flame: '#f8dc7a',
    },
  },
};

export function resolveStyle(name = 'storybook', paletteOverrides = {}) {
  const base = STYLES[name];
  if (!base) throw new Error(`Unknown style "${name}". Known styles: ${Object.keys(STYLES).join(', ')}`);
  return { name, ...base, palette: { ...base.palette, ...paletteOverrides } };
}
