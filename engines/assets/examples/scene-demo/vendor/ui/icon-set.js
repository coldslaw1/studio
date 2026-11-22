// Icon sets: hundreds of ready-made icons picked by name, drawn in one colour so they take any
// theme's ink. The data comes from game-icons.net (see game-icons.js and tools/pick-icons.mjs).
//
//   import { createUi, createIconSet } from './vendor/ui/index.js';
//   import { GAME_ICONS } from './vendor/ui/game-icons.js';
//   const icons = createIconSet(GAME_ICONS);
//   { id: 'slot-0', label: 'Iron sword', icon: icons.get('broadsword') }      // anywhere the kit takes an icon
//   icons.credits()   // the line the license requires the game to show: put it on a credits screen
//
// The icons are licensed CC BY 3.0: a game that uses them MUST show icons.credits() somewhere a
// player can find it (a credits screen or an "About" entry in the pause menu).

/** The credit sentence the icon authors ask for; {authors} is replaced by the names. */
export const ICON_SET_CREDIT = 'Icons made by {authors}. Available on https://game-icons.net (CC BY 3.0)';

/**
 * createIconSet(data, options?) -> set
 * @param {{ icons: Object<string, string|string[]>, authors?: string[], byIcon?: Object<string,string>, license?: string, source?: string }} data
 *   icons: SVG path data per name, on a 512 x 512 square. authors: everyone to credit when it is not
 *   known who drew which icon. byIcon: the author of each icon, when known (credits then name only
 *   the authors of the icons the game asked for).
 * @param {{ Path2D?: Function, box?: number, fill?: number }} [options]
 *   Path2D defaults to the page's own. fill: how much of the kit's icon square the drawing covers (default 1.15,
 *   as these icons carry their own margin).
 */
export function createIconSet(data, options = {}) {
  if (!data || typeof data.icons !== 'object' || data.icons === null) throw new Error('createIconSet: data.icons must be an object of name -> SVG path data');
  const box = options.box ?? data.box ?? 512;
  const fill = options.fill ?? 1.15;
  const names = Object.keys(data.icons);
  const paths = new Map();
  const used = new Set();
  const made = new Map();
  const pathsOf = (name) => {
    if (!paths.has(name)) {
      const P = options.Path2D ?? globalThis.Path2D;
      if (!P) throw new Error('createIconSet: no Path2D here; pass options.Path2D (in a browser it exists already)');
      const d = data.icons[name];
      paths.set(name, (Array.isArray(d) ? d : [d]).map((one) => new P(one)));
    }
    return paths.get(name);
  };
  const set = {
    names,
    has: (name) => Object.hasOwn(data.icons, name),
    /** Names holding every word of the query ("sword", "potion health"), for choosing an icon. */
    find(query) {
      const words = String(query).toLowerCase().split(/[\s,-]+/).filter(Boolean);
      return names.filter((n) => words.every((w) => n.includes(w)));
    },
    /**
     * get(name) -> a draw function (ctx, cx, cy, size, color) for any `icon` field of the kit.
     * The same function comes back for the same name. Throws on an unknown name, naming near ones.
     */
    get(name) {
      if (!set.has(name)) {
        const near = set.find(String(name).split('-')[0]).slice(0, 8);
        throw new Error(`icons.get: unknown icon "${name}".${near.length ? ` Similar: ${near.join(', ')}.` : ''} Search with icons.find('word'); ${names.length} icons are in this set.`);
      }
      used.add(name);
      if (!made.has(name)) {
        const draw = (ctx, cx, cy, size) => {
          const k = size * fill / box;
          ctx.save();
          ctx.translate(cx - (box / 2) * k, cy - (box / 2) * k);
          ctx.scale(k, k);
          for (const p of pathsOf(name)) ctx.fill(p);
          ctx.restore();
        };
        draw.iconName = name;
        draw.toJSON = () => name; // so ui.snapshot() and saved data show the name, not a function
        made.set(name, draw);
      }
      return made.get(name);
    },
    /** The names asked for so far with get(). */
    used: () => [...used],
    /** The authors to credit: of the icons used when the set knows them per icon, otherwise all of the set's authors. */
    authors() {
      if (data.byIcon) { const list = [...new Set([...used].map((n) => data.byIcon[n]).filter(Boolean))]; if (list.length) return list.sort(); }
      return [...(data.authors ?? [])];
    },
    /** The credit line the license requires, or '' when no icon was used. Show it on a credits screen. */
    credits() {
      if (used.size === 0) return '';
      const who = set.authors();
      return ICON_SET_CREDIT.replace('{authors}', who.length ? who.join(', ') : 'the game-icons.net contributors');
    },
    license: data.license ?? 'CC-BY-3.0',
    source: data.source ?? 'https://game-icons.net',
  };
  return set;
}
