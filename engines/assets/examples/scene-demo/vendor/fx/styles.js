// How each effect looks in each of the four studio styles. A look is a row of glyphs and a row of
// colours, both read from young (left) to old (right): an effect fades the ASCII way, by thinning
// its glyph and cooling its colour, never with see-through pixels.
//   glyphs  characters of the fx font (glyphs.js)
//   colors  '#rrggbb'
//   glow    true = makes its own light (not dimmed at night)
//   veil    0..1: how much the cell behind is darkened (smoke)

/** The four studio styles. `streaks: false` keeps fast particles as shapes (papercut). */
export const FX_STYLES = Object.freeze({
  storybook: { streaks: true, veilColor: '#3c363c', looks: {
    spark: { glyphs: '*+:.', colors: ['#fff6d0', '#ffd166', '#f79d3c', '#b8542a'], glow: true },
    ember: { glyphs: 'o*:.', colors: ['#ffe08a', '#ff9f43', '#d9542b', '#7a2e1e'], glow: true },
    smoke: { glyphs: '%o~:.', colors: ['#cfc6b8', '#a89f94', '#857d78', '#5e585a'], veil: 0.18 },
    dust: { glyphs: 'o~:.', colors: ['#e6d3a8', '#c9b184', '#a08a66'] },
    magic: { glyphs: '✦*+·', colors: ['#fff3ff', '#f7b5ff', '#b388ff', '#6c63d9'], glow: true },
    splash: { glyphs: "o:'.", colors: ['#e8fbff', '#9fdcf5', '#5aa9d6'] },
    poof: { glyphs: 'Oo°:.', colors: ['#fffaf0', '#e9dcc6', '#bfb3a2'] },
    sparkle: { glyphs: '✦+·.', colors: ['#ffffff', '#fff1a8', '#ffd166'], glow: true },
  } },
  nocturne: { streaks: true, veilColor: '#0a0d1c', looks: {
    spark: { glyphs: '✦+:.', colors: ['#ffffff', '#bfe3ff', '#7fb2ff', '#3d5ba8'], glow: true },
    ember: { glyphs: '*+:.', colors: ['#ffd9a0', '#ff8f6b', '#a8456b', '#4a2a5a'], glow: true },
    smoke: { glyphs: '%o~:.', colors: ['#8f9ac4', '#6a7399', '#4a5173', '#2f3450'], veil: 0.22 },
    dust: { glyphs: 'o~:.', colors: ['#9aa4c8', '#6f789c', '#4c5374'] },
    magic: { glyphs: '✦*+·', colors: ['#f0fbff', '#9fd0ff', '#7de0c0', '#4a6fd0'], glow: true },
    splash: { glyphs: "o:'.", colors: ['#e6f4ff', '#8fc0ff', '#4a78c8'] },
    poof: { glyphs: 'Oo°:.', colors: ['#e6ebff', '#aab4dc', '#6f789c'] },
    sparkle: { glyphs: '✦+·.', colors: ['#ffffff', '#cfe8ff', '#9fd0ff'], glow: true },
  } },
  papercut: { streaks: false, veilColor: '#2c2430', looks: {
    spark: { glyphs: '◆▲·', colors: ['#d9482b', '#f2a03d'], glow: true },
    ember: { glyphs: '●◆·', colors: ['#f2a03d', '#d9482b'], glow: true },
    smoke: { glyphs: '●o·', colors: ['#6d6272', '#9a8fa0', '#c9bfc9'] },
    dust: { glyphs: '●o·', colors: ['#c9a36b', '#dcc39a'] },
    magic: { glyphs: '◆▲·', colors: ['#7a4fd0', '#d9482b', '#3d8b5f'], glow: true },
    splash: { glyphs: '●▲·', colors: ['#2f7fb8', '#6fb3dc'] },
    poof: { glyphs: '●■o', colors: ['#2c2430', '#6d6272'] },
    sparkle: { glyphs: '◆·', colors: ['#f2a03d', '#d9482b'], glow: true },
  } },
  crypt: { streaks: true, veilColor: '#000000', looks: {
    spark: { glyphs: "*+'.", colors: ['#f4efd0', '#e8d27a', '#a8904a', '#5a4e2c'], glow: true },
    ember: { glyphs: '*:.,', colors: ['#e8d27a', '#c0392b', '#6a2018'], glow: true },
    smoke: { glyphs: '#%~:.', colors: ['#8a8676', '#6a675c', '#4a4842', '#2e2d2a'], veil: 0.28 },
    dust: { glyphs: '%~:.', colors: ['#8a8676', '#5e5b50', '#3a3832'] },
    magic: { glyphs: 'x+:.', colors: ['#d8ffd0', '#7fdc7a', '#3f8f5a', '#1f4a3a'], glow: true },
    splash: { glyphs: "~:'.", colors: ['#b8d4d0', '#6f9a98', '#3a5a5c'] },
    poof: { glyphs: '#%:.', colors: ['#d8d4c4', '#8a8676', '#4a4842'] },
    sparkle: { glyphs: "+'.", colors: ['#f4efd0', '#e8d27a', '#a8904a'], glow: true },
  } },
});

/** Names of the built-in styles. */
export const FX_STYLE_NAMES = Object.freeze(Object.keys(FX_STYLES));

/** '#rrggbb' or '#rgb' -> 0xRRGGBB. */
export function hexPacked(hex, where = 'fx') {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`${where}: not a hex colour: ${JSON.stringify(hex)}`);
  return parseInt(h, 16);
}

/** 0xRRGGBB -> '#rrggbb'. */
export const packedHex = (c) => '#' + c.toString(16).padStart(6, '0');

/**
 * makeStyle(name, def, from) -> a checked style { name, streaks, veilColor, looks }.
 * `def.looks` is laid over the looks of `from` (a complete style), so a custom style only lists what differs.
 */
export function makeStyle(name, def = {}, from = FX_STYLES.storybook) {
  if (typeof name !== 'string' || !name) throw new Error(`fx.defineStyle: name must be a non-empty string, got ${JSON.stringify(name)}`);
  if (def === null || typeof def !== 'object') throw new Error(`fx.defineStyle: the style '${name}' must be an object, got ${JSON.stringify(def)}`);
  const looks = { ...from.looks };
  for (const [key, look] of Object.entries(def.looks ?? {})) {
    const l = { ...(looks[key] ?? {}), ...look };
    if (typeof l.glyphs !== 'string' || !l.glyphs) throw new Error(`fx.defineStyle: look '${key}' of '${name}' needs glyphs (a string), got ${JSON.stringify(l.glyphs)}`);
    if (!Array.isArray(l.colors) || !l.colors.length) throw new Error(`fx.defineStyle: look '${key}' of '${name}' needs colors (an array of '#rrggbb'), got ${JSON.stringify(l.colors)}`);
    l.colors.forEach((c) => hexPacked(c, `fx.defineStyle: look '${key}' of '${name}'`));
    looks[key] = l;
  }
  const veilColor = def.veilColor ?? from.veilColor;
  hexPacked(veilColor, `fx.defineStyle: veilColor of '${name}'`);
  return { name, streaks: def.streaks ?? from.streaks, veilColor, looks };
}
