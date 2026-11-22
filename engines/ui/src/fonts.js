// Fonts for the Kiln themes. The files in ./fonts are open fonts under the SIL Open Font License 1.1
// (each family's license text sits beside them as <family>-OFL.txt and must travel with the files).
// They are the Latin subsets from the Fontsource project, unchanged.
//
// A theme names its fonts first and the system fonts after them, so a game that never loads these
// files looks exactly as before. Load them once at start-up:
//
//   import { loadFonts } from './vendor/ui/index.js';
//   await loadFonts({ baseUrl: new URL('./vendor/ui/fonts/', import.meta.url).href });   // then start drawing
//
// Canvas text only uses a font once the browser has loaded it, so wait for the promise (or redraw
// when it resolves; the kit forgets its remembered text sizes when you call ui.setTheme or resize).

/** Every font family the kit ships: files by weight, and the credit its license asks to keep. */
export const FONT_FAMILIES = {
  Alegreya: { file: 'alegreya', weights: [400, 700, 800], license: 'OFL-1.1', copyright: 'Copyright 2011 The Alegreya Project Authors (https://github.com/huertatipografica/Alegreya)' },
  Nunito: { file: 'nunito', weights: [400, 600, 700, 800], license: 'OFL-1.1', copyright: 'Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)' },
  'Grenze Gotisch': { file: 'grenze-gotisch', weights: [500, 700], license: 'OFL-1.1', copyright: 'Copyright 2020 The Grenze Gotisch Project Authors (https://github.com/Omnibus-Type/Grenze-Gotisch)' },
  Cinzel: { file: 'cinzel', weights: [400, 700], license: 'OFL-1.1', copyright: 'Copyright 2020 The Cinzel Project Authors (https://github.com/NDISCOVER/Cinzel)' },
  'Baloo 2': { file: 'baloo-2', weights: [500, 700, 800], license: 'OFL-1.1', copyright: 'Copyright 2019 The Baloo 2 Project Authors (https://github.com/EkType/Baloo2)' },
  VT323: { file: 'vt323', weights: [400], license: 'OFL-1.1', copyright: 'Copyright 2011, The VT323 Project Authors (peter.hull@oikoi.com)' },
};
export const FONT_NAMES = Object.keys(FONT_FAMILIES);

/**
 * Which families each Kiln theme draws with: { title, text }. Themes not listed use system fonts only.
 * VT323 (a terminal face) is shipped but no theme uses it by default, because it draws much smaller than
 * other fonts at the same size: opt in with createTheme('terminal', { font: fontStack('VT323', MONO_FONT) })
 * and loadFonts({ families: ['VT323'] }).
 */
export const THEME_FONTS = {
  storybook: { title: 'Alegreya', text: 'Nunito' },
  nocturne: { title: 'Cinzel', text: 'Nunito' },
  papercut: { title: 'Baloo 2', text: 'Baloo 2' },
  crypt: { title: 'Grenze Gotisch', text: 'Alegreya' },
};

const quote = (family) => (/\s|\d/.test(family) ? `"${family}"` : family);
/** fontStack('Baloo 2', 'system-ui, sans-serif') -> '"Baloo 2", system-ui, sans-serif' */
export function fontStack(family, fallback) {
  if (!FONT_FAMILIES[family]) throw new Error(`fontStack: unknown font "${family}". Known: ${FONT_NAMES.join(', ')}`);
  return `${quote(family)}, ${fallback}`;
}

function wanted(options) {
  const themes = options.themes ?? Object.keys(THEME_FONTS);
  for (const t of themes) if (!THEME_FONTS[t]) throw new Error(`fonts: theme "${t}" has no fonts of its own. Themes with fonts: ${Object.keys(THEME_FONTS).join(', ')}`);
  const families = options.families ?? [...new Set(themes.flatMap((t) => [THEME_FONTS[t].title, THEME_FONTS[t].text]))];
  for (const f of families) if (!FONT_FAMILIES[f]) throw new Error(`fonts: unknown font "${f}". Known: ${FONT_NAMES.join(', ')}`);
  return families;
}

/**
 * The font files to load: [{ family, weight, url }].
 * @param {{ baseUrl?: string, themes?: string[], families?: string[] }} [options]
 *   baseUrl: where the kit's fonts folder is served, ending in "/" (default "vendor/ui/fonts/").
 *   themes: only the fonts of these themes (default: all). families: or name the families.
 */
export function fontFiles(options = {}) {
  const base = options.baseUrl ?? 'vendor/ui/fonts/';
  if (typeof base !== 'string' || !base.endsWith('/')) throw new Error(`fonts: baseUrl must end with "/", got ${JSON.stringify(base)}`);
  return wanted(options).flatMap((family) => FONT_FAMILIES[family].weights.map((weight) => ({ family, weight, url: `${base}${FONT_FAMILIES[family].file}-latin-${weight}-normal.woff2` })));
}

/** @font-face rules as CSS text, for a page that would rather link the fonts in its stylesheet. */
export function fontFaceCss(options = {}) {
  return fontFiles(options).map((f) => `@font-face { font-family: ${quote(f.family)}; font-weight: ${f.weight}; font-style: normal; font-display: swap; src: url("${f.url}") format("woff2"); }`).join('\n') + '\n';
}

/**
 * Load the fonts into the page. Resolves when every file has loaded or failed; never rejects, so a
 * game still starts (in system fonts) when a file is missing.
 * @param {{ baseUrl?: string, themes?: string[], families?: string[], document?: object, FontFace?: Function }} [options]
 *   document and FontFace default to the page's own; pass fakes in tests.
 * @returns {Promise<{ loaded: string[], failed: Array<{ font: string, reason: string }> }>}  "Family weight" names.
 */
export async function loadFonts(options = {}) {
  const files = fontFiles(options);
  const doc = options.document ?? globalThis.document;
  const Face = options.FontFace ?? globalThis.FontFace;
  if (!doc || !doc.fonts || !Face) return { loaded: [], failed: files.map((f) => ({ font: `${f.family} ${f.weight}`, reason: 'no page to load fonts into' })) };
  const loaded = []; const failed = [];
  await Promise.all(files.map(async (f) => {
    try {
      const face = new Face(f.family, `url("${f.url}") format("woff2")`, { weight: String(f.weight), style: 'normal' });
      doc.fonts.add(await face.load());
      loaded.push(`${f.family} ${f.weight}`);
    } catch (e) { failed.push({ font: `${f.family} ${f.weight}`, reason: String(e?.message ?? e) }); }
  }));
  return { loaded: loaded.sort(), failed };
}

/** The credit lines for the fonts in use, one per family: "Nunito: Copyright ... (SIL Open Font License 1.1)". */
export function fontCredits(options = {}) {
  return wanted(options).map((family) => `${family}: ${FONT_FAMILIES[family].copyright}. SIL Open Font License 1.1.`);
}
