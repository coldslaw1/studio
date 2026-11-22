// Credits for the libraries a game uses. Every engine that brings licensed material (Kiln's
// imported models, the audio engine's recordings, this kit's fonts and icons) reports it as
// entries of one shape; this file gathers them and shows them.
//
//   entry: { what: 'models' | 'music' | 'sounds' | 'fonts' | 'icons', pack, author, license, url,
//            required: true when the license asks for a visible credit (CC BY), text: the line to show }
//
//   const entries = creditsFrom(base);              // from every installed plugin that has credits()
//   ui.open(creditsScreen(ui, entries));            // a scrolling Credits screen
//   ui.showPause({ items: [creditsItem(ui, () => creditsFrom(base))] });   // a "Credits" button in the pause menu
import { FONT_FAMILIES, THEME_FONTS, FONT_NAMES } from './fonts.js';

const LICENSE_NAMES = { 'CC0-1.0': 'CC0', 'CC-BY-3.0': 'CC BY 3.0', 'CC-BY-4.0': 'CC BY 4.0', 'OFL-1.1': 'SIL Open Font License 1.1', MIT: 'MIT', ISC: 'ISC' };

/** creditEntry(fields) -> a complete entry; text is written from pack, author and license when not given. */
export function creditEntry(e) {
  if (!e || typeof e.license !== 'string' || !e.license) throw new Error(`creditEntry: an entry needs "license" (an SPDX id), got ${JSON.stringify(e)}`);
  const required = e.required ?? !/^CC0|^Unlicense|^0BSD|^OFL/i.test(e.license);
  const text = e.text ?? `${e.pack || 'Untitled'}${e.author ? ` by ${e.author}` : ''} (${LICENSE_NAMES[e.license] ?? e.license})`;
  return { what: e.what ?? 'assets', pack: e.pack ?? '', author: e.author ?? '', license: e.license, url: e.url ?? '', required, text };
}

/** fontCreditEntries({ themes, families }) -> one entry per font family in use (see fonts.js). */
export function fontCreditEntries(options = {}) {
  const themes = options.themes ?? Object.keys(THEME_FONTS);
  const families = options.families ?? [...new Set(themes.filter((t) => THEME_FONTS[t]).flatMap((t) => [THEME_FONTS[t].title, THEME_FONTS[t].text]))];
  return families.map((family) => {
    const f = FONT_FAMILIES[family];
    if (!f) throw new Error(`fontCreditEntries: unknown font "${family}". Known: ${FONT_NAMES.join(', ')}`);
    return creditEntry({ what: 'fonts', pack: family, author: '', license: 'OFL-1.1', url: f.url ?? '', required: false, text: `${family}: ${f.copyright}. SIL Open Font License 1.1.` });
  });
}

/** iconCreditEntries(iconSet) -> the entry for a createIconSet set, or [] when the game drew none of its icons. */
export function iconCreditEntries(set) {
  const text = set?.credits?.() ?? '';
  return text ? [creditEntry({ what: 'icons', pack: 'game-icons.net', author: set.authors().join(', '), license: set.license, url: set.source, text })] : [];
}

/**
 * creditsFrom(base) -> entries from every installed plugin whose API has credits(), without repeats.
 * A plugin that throws is skipped: credits must never stop a game.
 */
export function creditsFrom(base) {
  const out = []; const seen = new Set();
  for (const name of base.plugins()) {
    let list = [];
    try { list = base.plugin(name).credits?.() ?? []; } catch { list = []; }
    for (const e of list) { const entry = creditEntry(e); const key = `${entry.what}|${entry.text}`; if (!seen.has(key)) { seen.add(key); out.push(entry); } }
  }
  return out.sort((a, b) => Number(b.required) - Number(a.required));
}

/** creditLines(entries, { width }?) -> text lines, credits a license requires first, long ones wrapped at `width` characters (default 64). */
export function creditLines(entries, options = {}) {
  const width = options.width ?? 64; const lines = [];
  const titles = { models: 'Models', music: 'Instruments', sounds: 'Sounds', fonts: 'Fonts', icons: 'Icons', assets: 'Assets' };
  let last = null;
  for (const e of [...entries].sort((a, b) => Number(b.required) - Number(a.required))) {
    if (e.what !== last) { lines.push(titles[e.what] ?? e.what); last = e.what; }
    let line = ' ';
    for (const word of e.text.split(' ')) {
      if (line.length + word.length + 1 > width && line.trim()) { lines.push(line); line = '   '; }
      line += (line.trim() ? ' ' : '') + word;
    }
    lines.push(line);
  }
  return lines;
}

/** creditsLine(entries) -> one short sentence for a footer: only what a license requires, '' when nothing does. */
export function creditsLine(entries) {
  const need = entries.filter((e) => e.required);
  return need.length ? `Uses ${[...new Set(need.map((e) => (e.what === 'icons' ? 'icons from game-icons.net (CC BY 3.0)' : `${e.pack} (${LICENSE_NAMES[e.license] ?? e.license})`)))].join(', ')}. See Credits.` : '';
}

/** creditsScreen(ui, entries, { title }?) -> options for ui.open(): the lines and a Back button. */
export function creditsScreen(ui, entries, options = {}) {
  const lines = entries.length ? creditLines(entries, options) : ['This game uses no outside material.'];
  return {
    id: 'credits', title: options.title ?? 'Credits',
    items: [...lines.map((label, i) => ({ id: `credit-${i}`, type: 'text', label })), { id: 'back', label: 'Back', onSelect: () => ui.back() }],
    focus: 'back', onCancel: () => ui.back(),
  };
}

/** creditsItem(ui, getEntries) -> a "Credits" button for showPause({ items }) or showTitle; getEntries() is called when it is picked. */
export function creditsItem(ui, getEntries, options = {}) {
  if (typeof getEntries !== 'function') throw new Error('creditsItem: getEntries must be a function that returns the credit entries (for example () => creditsFrom(base))');
  return { id: 'credits', label: options.label ?? 'Credits', onSelect: () => ui.open(creditsScreen(ui, getEntries(), options)) };
}
