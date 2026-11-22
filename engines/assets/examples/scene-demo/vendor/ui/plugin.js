// The ui kit as a base plugin: menus, HUD, toasts and the settings screen, hooked into the base so
// that an open menu owns the input and pauses the game by itself.
//   plugins: [uiPlugin({ skin: { genre: 'adventure' }, scale: 0.62 })]
//   const { ui } = base.plugin('ui');   ui.showPause({...});  ui.hud.add({...});  ui.toast('Saved');
import { createUi } from './ui.js';
import { loadFonts, THEME_FONTS } from './fonts.js';
import { fontCreditEntries, iconCreditEntries, creditsFrom, creditsItem, creditsScreen, creditsLine } from './credits.js';
import { createIconSet } from './icon-set.js';
import { GAME_ICONS } from './game-icons.js';

// where this kit's own fonts folder is served: beside this file, wherever the game put the kit
const OWN_FONTS = (() => { try { return new URL('./fonts/', import.meta.url).href; } catch { return 'vendor/ui/fonts/'; } })();

/** The focus layer an open menu holds. Read its input with base.input.for(UI_LAYER). */
export const UI_LAYER = 'ui';

/**
 * A settings object in the ui kit's shape, backed by the base's settings registry, so the
 * settings screen always lists what the plugins have declared, including ones installed later.
 */
function settingsBridge(base) {
  const listeners = [];
  base.settings.watchAll((id, value) => { for (const fn of listeners.slice()) fn(id, value, base.settings.values()); });
  return {
    get: (id) => base.settings.get(id),
    set: (id, value) => { base.settings.set(id, value); },
    values: () => base.settings.values(),
    reset: () => base.settings.reset(),
    items: () => base.settings.schema().filter((item) => item.type !== 'text' && item.hidden !== true),
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
  };
}

/**
 * uiPlugin(options) -> plugin
 *   options: anything createUi takes (scale, sizing, hints, safeArea, genre via skin.genre ...) except
 *   width, height and settings, which come from the base. `pixelRatio` (number or function) draws the
 *   ui that many canvas pixels per ui pixel (HiDPI canvases).
 *   fonts   the kit's own fonts for the game's style are loaded in a page by default, and again when the style
 *           changes, from the fonts folder beside this file. { baseUrl } names another place (ending in "/");
 *           false keeps system fonts. Outside a page (tests, Node) nothing is loaded unless fonts is given.
 *   icons   the set the game draws its icons from: 'game-icons' (the kit's 156 game-icons.net icons, CC BY 3.0:
 *           the credit for the icons you draw is REQUIRED and reported) or your own createIconSet(...).
 * base.plugin('ui') -> { ui, layer, open, snapshot(), icons, fonts, credits(), allCredits(), creditsItem(), showCredits(), creditsLine() }
 *   ui      the createUi object: showTitle, showPause, showSettings, open, hud, toast, ...
 *   The plugin calls ui.update and ui.draw; a game never does.
 *   credits()      what this kit's fonts and icons ask for.   allCredits()  the same from every plugin (models, recordings, ...)
 *   creditsItem()  a "Credits" button for ui.showPause({ items: [...] });   showCredits() opens that screen now
 *   creditsLine()  one sentence naming what a license requires to be credited, '' when nothing does (for a footer)
 * While any menu or screen is open the plugin holds focus layer 'ui' (the game is paused and
 * gets no input); it lets go when the last one closes.
 */
export function uiPlugin(options = {}) {
  return {
    name: 'ui',
    install(base) {
      const ratio = () => (typeof options.pixelRatio === 'function' ? options.pixelRatio() : options.pixelRatio ?? 1);
      const genre = options.skin?.genre;
      const settings = settingsBridge(base);
      const ui = createUi({ ...options, skin: undefined, theme: undefined, width: (base.width || 640) / ratio(), height: (base.height || 360) / ratio(), settings });
      // one look for the whole game: the ui follows the base style (and keeps the game's genre)
      // fonts: on by default where there is a page to load them into
      const inPage = Boolean(globalThis.document?.fonts && globalThis.FontFace);
      const fontOptions = options.fonts === false ? null : options.fonts ? { baseUrl: OWN_FONTS, ...options.fonts } : (inPage ? { baseUrl: OWN_FONTS } : null);
      if (options.icons !== undefined && options.icons !== null && options.icons !== 'game-icons' && typeof options.icons?.credits !== 'function') throw new Error("uiPlugin: icons must be 'game-icons' or a set from createIconSet(...)");
      const icons = options.icons === 'game-icons' ? createIconSet(GAME_ICONS) : (options.icons ?? null);
      let themeName = null; let fonts = Promise.resolve({ loaded: [], failed: [] });
      base.style.watch((tokens) => {
        const spec = { ...(genre ? { genre } : {}), ...(tokens.ui ?? {}) }; if (spec.genre || spec.style || spec.palette) ui.setSkin(spec);
        themeName = THEME_FONTS[tokens.ui?.style] ? tokens.ui.style : null;
        if (fontOptions && themeName) fonts = loadFonts({ ...fontOptions, themes: [themeName] }).then((r) => { base.bus.emit('ui:fonts', r); return r; });
      });
      const credits = () => [...(fontOptions && themeName ? fontCreditEntries({ themes: [themeName] }) : []), ...iconCreditEntries(icons)];
      const allCredits = () => creditsFrom(base);
      const scaled = { x: 0, y: 0, down: false, pressed: false, released: false };
      const facade = (input) => (ratio() === 1 ? input : {
        pressed: (n) => input.pressed(n), down: (n) => input.down(n), released: (n) => input.released(n),
        get lastDevice() { return input.lastDevice; },
        get pointer() { const p = input.pointer; const k = ratio(); return Object.assign(scaled, p, { x: p.x / k, y: p.y / k }); },
      });
      const sync = () => {
        const open = ui.isOpen();
        if (open && !base.focus.has(UI_LAYER)) base.focus.push({ id: UI_LAYER, pausesSim: true, pointer: 'free', kind: 'menu' });
        else if (!open && base.focus.has(UI_LAYER)) base.focus.pop(UI_LAYER);
      };
      base.on('ui', (dt) => {
        sync(); // a menu the game opened since the last tick
        // the HUD's own buttons are part of the game layer; menus read their own layer
        const layer = base.focus.has(UI_LAYER) ? UI_LAYER : base.focus.top.id;
        ui.update(dt, facade(base.input.for(layer)));
        sync();
      }, { order: -100, owner: 'ui' });
      base.on('post', sync, { order: 1000, owner: 'ui' });
      base.on('draw:ui', (ctx) => {
        const k = ratio();
        if (k === 1) { ui.draw(ctx); return; }
        ctx.save(); ctx.scale(k, k); ui.draw(ctx); ctx.restore();
      }, { order: 100, owner: 'ui' });
      base.bus.on('base:resized', ({ width, height }) => ui.resize(width / ratio(), height / ratio()));
      return {
        ui, layer: UI_LAYER, get open() { return ui.isOpen(); }, snapshot: () => ui.snapshot(),
        icons, get fonts() { return fonts; },
        credits, allCredits, creditsLine: () => creditsLine(allCredits()),
        creditsItem: (o) => creditsItem(ui, allCredits, o), showCredits: (o) => ui.open(creditsScreen(ui, allCredits(), o)),
      };
    },
  };
}
