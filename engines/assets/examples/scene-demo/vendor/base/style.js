// The style registry: one name for the look and sound of the whole game. A style is a bag of
// tokens; each plugin reads the part it understands (the art engine its render style, the ui its
// skin, the audio its sound palette, the views their colours) and is told when the style changes.

/**
 * The four studio styles. `kiln` is the art engine's style name, `audio` the sound palette,
 * `ui` what the ui kit's setSkin takes, `palette` the colours for anything drawn by the game
 * itself (markers, labels, debug shapes), `font` the text faces, `grade` a tint for live views.
 */
export const STYLES = Object.freeze({
  storybook: { kiln: 'storybook', audio: 'storybook', ui: { style: 'storybook' }, font: { ui: 'Georgia, serif', mono: 'Consolas, monospace' }, grade: [1, 1, 1],
    palette: { bg: '#10131f', panel: '#2a2238', text: '#f6ecd2', textDim: '#b9ad94', accent: '#ffd166', danger: '#e2584d', good: '#7fc77a', marker: '#ffd166', shadow: '#10131f' } },
  nocturne: { kiln: 'nocturne', audio: 'nocturne', ui: { style: 'nocturne' }, font: { ui: 'Georgia, serif', mono: 'Consolas, monospace' }, grade: [0.86, 0.9, 1.08],
    palette: { bg: '#0a0d1c', panel: '#161c36', text: '#e6ebff', textDim: '#96a0c8', accent: '#9fd0ff', danger: '#ff6b8a', good: '#7de0c0', marker: '#9fd0ff', shadow: '#05060f' } },
  papercut: { kiln: 'papercut', audio: 'papercut', ui: { style: 'papercut' }, font: { ui: 'Trebuchet MS, sans-serif', mono: 'Consolas, monospace' }, grade: [1.04, 1, 0.94],
    palette: { bg: '#f1e6d0', panel: '#fff8ea', text: '#2c2430', textDim: '#6d6272', accent: '#d9482b', danger: '#b3261e', good: '#3d8b5f', marker: '#d9482b', shadow: '#2c2430' } },
  crypt: { kiln: 'crypt', audio: 'crypt', ui: { style: 'crypt' }, font: { ui: 'Consolas, monospace', mono: 'Consolas, monospace' }, grade: [0.92, 0.96, 0.9],
    palette: { bg: '#0b0a12', panel: '#1a1822', text: '#d8d4c4', textDim: '#8a8676', accent: '#c8b45a', danger: '#c0392b', good: '#6fae6a', marker: '#e8d27a', shadow: '#000000' } },
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObject(v) && isObject(a[k]) ? merge(a[k], v) : v;
  return out;
}

/**
 * createStyleRegistry(options) -> style
 *   options.style   the style to start with. Default 'storybook'.
 *   options.styles  extra or changed styles: { name: tokens }. Tokens are laid over `extends` (default the starting built-in).
 *   options.bus     optional bus: 'style:changed' { name, previous }.
 * style:
 *   name, tokens      the style that is on, and its tokens (frozen)
 *   set(name)         switch. Every watcher is told. Returns the tokens.
 *   define(name, tokens)   add a style or change one. tokens.extends names the style it starts from (default 'storybook').
 *   extend(part, values)   a plugin adds its own token to styles: extend('fog', { crypt: 0.6, storybook: 0.1 }).
 *   watch(fn)         fn(tokens, name) now and on every change. Returns a function that stops it.
 *   names()           every style name
 *   token(path, fallback)  read 'palette.accent' from the style that is on
 */
export function createStyleRegistry(options = {}) {
  const { bus = null } = options;
  const styles = new Map(Object.entries(STYLES));
  const watchers = [];
  let name = null; let tokens = null;
  const freeze = (o) => { for (const v of Object.values(o)) if (isObject(v)) freeze(v); return Object.freeze(o); };
  const style = {
    get name() { return name; },
    get tokens() { return tokens; },
    define(n, t = {}) {
      if (typeof n !== 'string' || !n) throw new Error(`style.define: name must be a non-empty string, got ${JSON.stringify(n)}`);
      if (!isObject(t)) throw new Error(`style.define: tokens for '${n}' must be an object, got ${JSON.stringify(t)}`);
      const { extends: from = styles.has(n) ? n : 'storybook', ...rest } = t;
      if (!styles.has(from)) throw new Error(`style.define: '${n}' extends unknown style '${from}' (known: ${[...styles.keys()].join(', ')})`);
      styles.set(n, merge(styles.get(from), rest));
      if (n === name) style.set(n, true);
    },
    extend(part, values) {
      if (typeof part !== 'string' || !part) throw new Error(`style.extend: token name must be a non-empty string, got ${JSON.stringify(part)}`);
      if (!isObject(values)) throw new Error(`style.extend: values for '${part}' must be { styleName: value }, got ${JSON.stringify(values)}`);
      for (const [n, v] of Object.entries(values)) {
        if (!styles.has(n)) throw new Error(`style.extend: unknown style '${n}' (known: ${[...styles.keys()].join(', ')})`);
        styles.set(n, merge(styles.get(n), { [part]: v }));
      }
      if (name && Object.hasOwn(values, name)) style.set(name, true);
    },
    set(n, again = false) {
      if (!styles.has(n)) throw new Error(`style.set: unknown style ${JSON.stringify(n)} (known: ${[...styles.keys()].join(', ')})`);
      if (n === name && !again) return tokens;
      const previous = name;
      name = n; tokens = freeze(merge({}, { name: n, ...styles.get(n) }));
      for (const fn of watchers.slice()) fn(tokens, name);
      bus?.emit('style:changed', { name, previous });
      return tokens;
    },
    watch(fn) {
      if (typeof fn !== 'function') throw new Error('style.watch: listener must be a function');
      watchers.push(fn);
      if (tokens) fn(tokens, name);
      return () => { const i = watchers.indexOf(fn); if (i >= 0) watchers.splice(i, 1); };
    },
    names() { return [...styles.keys()]; },
    token(path, fallback) {
      let at = tokens;
      for (const part of String(path).split('.')) { if (!isObject(at) || !(part in at)) return fallback; at = at[part]; }
      return at;
    },
  };
  for (const [n, t] of Object.entries(options.styles ?? {})) style.define(n, t);
  style.set(options.style ?? 'storybook');
  return style;
}
