// createInventoryUi: the inventory on screen. Two styles:
//   'panel'  the drawn inventory: grid of item icons, equipment slots, drag
//            and drop, tooltips, chest or shop beside the bag. Needs a ui kit
//            with ui.openScreen (custom screens).
//   'menus'  plain kit menus (ui-menus.js). Works with any ui kit version.
// Nothing is imported from ui: the game passes its `ui` object in.

import { createInventoryMenus } from './ui-menus.js';
import { createInventoryPanel } from './panel.js';
import { createSender } from './ui-send.js';
import { REASON_TEXT } from './ui-screens.js';

/**
 * createInventoryUi(options) -> view
 *   ui           required, from the ui engine's createUi
 *   inventory    required, from createInventory
 *   style        'panel' (default when the ui kit has openScreen) or 'menus'
 *   crafting     from createCrafting (needed for view.openCrafting)
 *   money(shop)  how a shop's prices are shown: (shop) => ({ symbol, balance, sellPrice(stack) }) (see shopMoney).
 *                Default: the inventory's coins, sign 'c'. The economy engine's economy.money fits here
 *   env          object, or function returning one, passed to applyInventoryAction
 *                ({ drops, position, shops, station }). With drops + position items can be dropped on the ground.
 *   send(action) how an action is carried out. Default: applied to `inventory` at once.
 *                Multiplayer: (action) => room.send(action).
 *   onResult(action, result)   after every action (play a sound, apply a used item's effect)
 *   onClose()                  when the inventory closes
 *   labels, reasons            replace words (LABELS in ui-screens.js, REASON_TEXT)
 *   discard = true             false hides "Throw away" in the action menu
 *   Panel style only:
 *   icons(ctx, stack, def, x, y, size)   draw an item's icon in that square; return true when drawn
 *   drawDoll(ctx, rect)        draw the character between the equipment slots
 *   keys                       extra input actions { quick: ['interact'], toggle: ['inventory'] }
 *   cellSize                   wanted cell size in ui units (default 2.6)
 * view: open({ bag, title }), openChest(name, { title }), openShop(shop, { name, title }),
 *       openCrafting({ station, title }), close(), isOpen(), screen, snapshot(), refresh(), dispose(), style
 */
export function createInventoryUi(options = {}) {
  const { ui, inventory: inv } = options;
  if (!ui || typeof ui.open !== 'function' || typeof ui.back !== 'function') throw new Error('createInventoryUi: options.ui is required (the object from the ui engine\'s createUi)');
  if (!inv || typeof inv.list !== 'function') throw new Error('createInventoryUi: options.inventory is required (from createInventory)');
  const canDraw = typeof ui.openScreen === 'function';
  const style = options.style ?? (canDraw ? 'panel' : 'menus');
  if (style !== 'panel' && style !== 'menus') throw new Error(`createInventoryUi: unknown style "${style}". Use 'panel' or 'menus'`);
  if (style === 'panel' && !canDraw) throw new Error('createInventoryUi: style "panel" needs a ui kit with ui.openScreen. Vendor the current ui engine, or use style "menus"');
  if (style === 'menus') return Object.assign(createInventoryMenus(options), { style, snapshot: () => ({ open: ui.isOpen(), mode: null, cells: [], buttons: [] }) });

  const env = () => ({ crafting: options.crafting, ...((typeof options.env === 'function' ? options.env() : options.env) || {}) });
  // The action menu (Use, Equip, Split, Drop) and crafting stay kit menus, opened on top of the panel.
  const menus = createInventoryMenus({ ...options, onClose: undefined });
  const sender = createSender({
    inventory: inv, send: options.send, env, onResult: options.onResult,
    toast: (text) => ui.toast(text), reasons: { ...REASON_TEXT, ...(options.reasons || {}) },
  });
  let screen = null;
  let switching = false;
  const panel = createInventoryPanel({
    inventory: inv, theme: () => ui.theme, unit: () => ui.unit, act: (action) => sender.act(action), env,
    openActions: (ref) => menus.openItem(ref), icons: options.icons, drawDoll: options.drawDoll,
    labels: options.labels, keys: options.keys, cellSize: options.cellSize, money: options.money,
    onClose() {
      const s = screen;
      screen = null;
      if (s) s.close();
      if (!switching && typeof options.onClose === 'function') options.onClose();
    },
  });
  function show(mode) {
    switching = true;
    try { if (panel.isOpen()) panel.close(); } finally { switching = false; }
    panel.open(mode);
    const size = (v) => panel.setViewport(v.width, v.height);
    if (typeof ui.viewport === 'function') size(ui.viewport());
    screen = ui.openScreen({
      id: mode.kind === 'bag' ? 'inventory' : mode.kind,
      cancel: false, // the panel reads cancel itself: it first puts down a held item
      update(dt, input, viewport) { size(viewport); panel.update(dt, input); },
      draw(ctx, theme, viewport, frame) { size(viewport); panel.draw(ctx, frame); }, // frame carries the kit's drawSurface and focusRing
      wheel(deltaY, pointer) { panel.wheel(deltaY, pointer); },
      onClose() { if (screen) { screen = null; panel.close(); } },
      snapshot: () => ({ inventory: panel.snapshot() }),
    });
    return view;
  }

  const view = {
    style,
    panel,
    get screen() { return panel.isOpen() ? panel.mode.kind : menus.screen; },
    isOpen: () => panel.isOpen() || menus.isOpen(),
    open: (o = {}) => show({ kind: 'bag', bag: o.bag, title: o.title }),
    openChest: (name, o = {}) => show({ kind: 'chest', name, title: o.title }),
    openShop(shop, o = {}) {
      if (!shop || !Array.isArray(shop.stock)) throw new Error('inventoryUi.openShop: expected a shop (from createShop)');
      const name = o.name ?? 'shop';
      if (typeof options.send !== 'function' && env().shops?.[name] !== shop) {
        throw new Error(`inventoryUi.openShop: env.shops["${name}"] must be this shop, so buy and sell actions can find it`);
      }
      return show({ kind: 'shop', shop, name, title: o.title });
    },
    openCrafting(o) { menus.openCrafting(o); return view; },
    snapshot: () => panel.snapshot(),
    refresh: () => view,
    close() { menus.close(); panel.close(); return view; },
    dispose() { view.close(); menus.dispose(); },
  };
  return view;
}
