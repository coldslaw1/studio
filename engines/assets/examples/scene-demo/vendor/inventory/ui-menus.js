// The inventory on screen, built from the ui engine's kit (ui.open, ui.toast,
// ui.hud). Because the screens are ordinary kit menus they work with keyboard,
// gamepad, mouse and touch, pause the game like any menu, and follow the theme.
// Nothing is imported from ui: the game passes its `ui` object in.

import { applyInventoryAction } from './actions.js';
import { createSender } from './ui-send.js';
import { drawItemIcon, iconKind } from './item-icons.js';
import { shopMoney } from './shop.js';
import { LABELS, REASON_TEXT, bagScreen, itemScreen, chestScreen, shopScreen, sellScreen, craftScreen } from './ui-screens.js';

export { REASON_TEXT };

/**
 * createInventoryMenus(options) -> view   (the list-style screens; createInventoryUi in ui-view.js picks the style)
 *   ui           required, from the ui engine's createUi
 *   inventory    required, from createInventory
 *   crafting     from createCrafting (needed for view.openCrafting)
 *   money(shop)  how a shop's prices are shown (see shopMoney). Default: the inventory's coins, sign 'c'
 *   env          object, or function returning one, passed to applyInventoryAction
 *                ({ drops, position, shops, station, onUse }). With drops + position
 *                the item screen offers "Drop", otherwise "Throw away".
 *   send(action) how an action is carried out. Default: applied to `inventory`
 *                at once. Multiplayer: (action) => room.send(action).
 *   labels, reasons   replace words (see LABELS in ui-screens.js and REASON_TEXT)
 *   discard = true    false hides "Throw away"
 *   onClose()         called when the last inventory screen closes
 *   onResult(action, result)   called after every action (play a sound, apply effects)
 * view: open({ bag, title }), openChest(name, { title }), openShop(shop, { name, title }),
 *       openCrafting({ station, title }), close(), isOpen(), refresh(), screen (current kind or null), dispose()
 * The screens redraw themselves whenever the inventory changes.
 */
export function createInventoryMenus(options = {}) {
  const { ui, inventory: inv } = options;
  if (!ui || typeof ui.open !== 'function' || typeof ui.back !== 'function') throw new Error('createInventoryUi: options.ui is required (the object from the ui engine\'s createUi)');
  if (!inv || typeof inv.list !== 'function') throw new Error('createInventoryUi: options.inventory is required (from createInventory)');
  const L = { ...LABELS, ...(options.labels || {}) };
  const reasons = { ...REASON_TEXT, ...(options.reasons || {}) };
  const env = () => ({ crafting: options.crafting, ...((typeof options.env === 'function' ? options.env() : options.env) || {}) });
  const stack = []; // open screens, top last: { kind, ...arguments, focus }
  let menu = null;
  let busy = false;

  function build(s) {
    const e = env();
    if (s.kind === 'bag') return bagScreen(inv, L, s);
    if (s.kind === 'item') return itemScreen(inv, L, s.ref, { canDrop: !!(e.drops && e.position), canDiscard: options.discard !== false });
    if (s.kind === 'chest') return chestScreen(inv, L, s.name, s);
    if (s.kind === 'shop') return shopScreen(inv, L, s.shop, { ...s, money: shopMoney(inv, s.shop, options.money) });
    if (s.kind === 'sell') return sellScreen(inv, L, s.shop, { ...s, money: shopMoney(inv, s.shop, options.money) });
    return craftScreen(inv, L, options.crafting, s);
  }
  const valid = (s) => !s.done && (s.kind !== 'item' || !!inv.at(s.ref));

  // Exactly one kit menu is open for the top screen; it is rebuilt after every change.
  function show() {
    const replacing = !!menu;
    if (menu) {
      const top = stack[stack.length - 1];
      if (top && top.menu === menu) top.focus = menu.focusId;
      if (ui.current() === menu) ui.back();
      else if (ui.isOpen()) return; // another menu (pause, a message) is on top: leave it alone
      else stack.length = 0; // the game closed every menu (ui.closeAll): stay closed
      menu = null;
    }
    while (stack.length && !valid(stack[stack.length - 1])) stack.pop();
    const s = stack[stack.length - 1];
    if (!s) { if (replacing && typeof options.onClose === 'function') options.onClose(); return; }
    const o = build(s);
    const focusable = (id) => o.items.some((i) => i.id === id && i.type !== 'text' && !i.disabled);
    menu = ui.open({ ...o, focus: focusable(s.focus) ? s.focus : undefined, onSelect: (id) => select(s, id), onCancel: pop });
    if (replacing && s.menu) menu.age = 10; // a refresh of the same screen: skip the opening animation
    s.menu = menu;
  }
  function push(s) {
    // Our menu is no longer the top one (the game closed it, or opened its own
    // on top): forget the old screens and open the new one on top.
    if (menu && ui.current() !== menu) { menu = null; stack.length = 0; }
    stack.push(s);
    show();
    return view;
  }
  function pop() { stack.pop(); show(); }

  function finish(action, result) {
    if (!result.ok) ui.toast(reasons[result.reason] ?? String(result.reason));
    if (typeof options.onResult === 'function') options.onResult(action, result);
  }
  // Send one action. Works with a plain result or a promise (net's room.send).
  // `leave` is the screen to close when the action succeeds (the item screen after "Equip").
  function act(action, leave) {
    if (busy) return;
    const done = (result) => {
      busy = false;
      if (result.ok && leave) leave.done = true;
      finish(action, result);
      if (menu) show();
    };
    busy = true; // also keeps the 'change' listener from redrawing half-way
    let out;
    try {
      out = typeof options.send === 'function' ? options.send(action) : applyInventoryAction(inv, action, env());
    } catch (err) { busy = false; throw err; } // a bug in the game's own hooks must surface
    if (out && typeof out.then === 'function') {
      out.then((r) => (r && typeof r.ok === 'boolean' ? r : { ok: true }), (err) => ({ ok: false, reason: err && err.message })).then(done);
    } else done(out && typeof out.ok === 'boolean' ? out : { ok: true });
  }

  function select(s, id) {
    const n = Number(id.slice(id.indexOf('-') + 1));
    if (id === 'close' || id === 'back') return pop();
    if (s.kind === 'bag') {
      if (id === 'sort') return act({ type: 'inv.sort', bag: s.bag });
      if (id.startsWith('slot-')) return push({ kind: 'item', ref: s.bag === undefined ? { index: n } : { bag: s.bag, index: n } });
      if (id.startsWith('equip-')) return push({ kind: 'item', ref: { equip: id.slice(6) } });
    }
    if (s.kind === 'item') {
      const from = s.ref;
      const count = inv.at(from)?.n ?? 1;
      if (id === 'use') return act({ type: 'inv.use', from });
      if (id === 'equip') return act({ type: 'inv.equip', from }, s);
      if (id === 'unequip') return act({ type: 'inv.unequip', slot: from.equip }, s);
      if (id === 'split') return act({ type: 'inv.split', from, n: Math.floor(count / 2) }, s);
      if (id === 'drop') return act({ type: 'inv.drop', from }, s);
      if (id === 'drop-one') return act({ type: 'inv.drop', from, n: 1 });
      if (id === 'discard') return act({ type: 'inv.discard', from }, s);
    }
    if (s.kind === 'chest') {
      if (id === 'take-all') return act({ type: 'inv.takeAll', from: s.name });
      if (id.startsWith('chest-')) return act({ type: 'inv.transfer', from: { bag: s.name, index: n }, to: inv.bags()[0] });
      if (id.startsWith('bag-')) return act({ type: 'inv.transfer', from: { index: n }, to: s.name });
    }
    if (s.kind === 'shop') {
      if (id === 'sell') return push({ kind: 'sell', shop: s.shop, name: s.name });
      if (id.startsWith('buy-')) return act({ type: 'inv.buy', shop: s.name, index: n });
    }
    if (s.kind === 'sell' && id.startsWith('sell-')) return act({ type: 'inv.sell', shop: s.name, from: { index: n }, n: 1 });
    if (s.kind === 'craft' && id.startsWith('craft-')) return act({ type: 'inv.craft', recipe: id.slice(6) });
    return undefined;
  }

  const off = inv.on('change', () => { if (menu && !busy) show(); });
  const view = {
    get screen() { return stack.length ? stack[stack.length - 1].kind : null; },
    isOpen: () => stack.length > 0,
    open: (o = {}) => push({ kind: 'bag', bag: o.bag, title: o.title }),
    /** openItem(ref) opens the action menu (Use, Equip, Split, Drop) for one slot. */
    openItem: (ref) => (inv.at(ref) ? push({ kind: 'item', ref }) : view),
    openChest(name, o = {}) {
      inv.bag(name); // throws when the chest was not attached with inventory.attach(name, container)
      return push({ kind: 'chest', name, title: o.title });
    },
    openShop(shop, o = {}) {
      if (!shop || !Array.isArray(shop.stock)) throw new Error('inventoryUi.openShop: expected a shop (from createShop)');
      const name = o.name ?? 'shop';
      if (typeof options.send !== 'function' && env().shops?.[name] !== shop) {
        throw new Error(`inventoryUi.openShop: env.shops["${name}"] must be this shop, so buy and sell actions can find it`);
      }
      return push({ kind: 'shop', shop, name, title: o.title });
    },
    openCrafting(o = {}) {
      if (!options.crafting) throw new Error('inventoryUi.openCrafting: pass `crafting` (from createCrafting) to createInventoryUi');
      return push({ kind: 'craft', station: o.station, title: o.title });
    },
    refresh: () => { if (menu) show(); return view; },
    close() { stack.length = 0; show(); return view; },
    dispose() { view.close(); off(); },
  };
  return view;
}

/**
 * bindInventoryHud(ui, inventory, options) -> unbind()
 * Adds HUD widgets that follow the inventory: a coin counter, a weight bar
 * (when the inventory has a carry limit) and, when it has quick slots and the
 * ui kit has the 'hotbar' widget, the quick slots (tap one to use it).
 *   options: { coins = true, weight = true, hotbar = true, anchor = 'top-right', hotbarAnchor = 'bottom-center',
 *              coinsId = 'coins', weightId = 'weight', hotbarId = 'hotbar',
 *              send(action), env, onResult(action, result)   as in createInventoryUi, for the quick slots }
 * unbind.quick(i) uses quick slot i (call it from your own key handling:
 * `if (input.pressed('slot1')) hud.quick(0)`).
 */
export function bindInventoryHud(ui, inv, options = {}) {
  if (!ui || !ui.hud || typeof ui.hud.add !== 'function') throw new Error('bindInventoryHud: expected the ui object from createUi');
  const o = { coins: true, weight: true, hotbar: true, anchor: 'top-right', hotbarAnchor: 'bottom-center', coinsId: 'coins', weightId: 'weight', hotbarId: 'hotbar', ...options };
  const showWeight = o.weight && inv.maxWeight !== null;
  const sender = createSender({
    inventory: inv, send: o.send, env: () => (typeof o.env === 'function' ? o.env() : o.env) || {}, onResult: o.onResult,
    toast: (text) => ui.toast(text), reasons: { ...REASON_TEXT, ...(o.reasons || {}) },
  });
  const quick = (i) => sender.act({ type: 'inv.quick', slot: i });
  const slots = () => inv.hotbar().map((id, i) => {
    if (!id || !inv.catalog.has(id)) return { key: String(i + 1) };
    const def = inv.catalog.get(id);
    const worn = Object.values(inv.state.equip).some((st) => st && st.id === id);
    const icon = typeof def.icon === 'function' ? def.icon : (ctx, cx, cy, size) => drawItemIcon(ctx, iconKind(def), cx - size / 2, cy - size / 2, size, def.color);
    return { icon, count: def.equip ? (worn ? '' : inv.count(id) || '') : inv.count(id), key: String(i + 1) };
  });
  if (o.coins) ui.hud.add({ id: o.coinsId, type: 'counter', icon: 'coin', value: inv.coins, anchor: o.anchor });
  if (showWeight) ui.hud.add({ id: o.weightId, type: 'bar', label: LABELS.weight, value: inv.weight, max: inv.maxWeight, anchor: o.anchor });
  let bar = false;
  if (o.hotbar && inv.hotbar().length > 0 && typeof ui.hud.patch === 'function') {
    try { ui.hud.add({ id: o.hotbarId, type: 'hotbar', slots: slots(), value: -1, anchor: o.hotbarAnchor, onPress: quick }); bar = true; } catch { bar = false; } // an older kit without the hotbar widget
  }
  const off = inv.on('change', () => {
    if (o.coins && ui.hud.has(o.coinsId)) ui.hud.set(o.coinsId, inv.coins);
    if (showWeight && ui.hud.has(o.weightId)) ui.hud.set(o.weightId, inv.weight);
    if (bar && ui.hud.has(o.hotbarId)) ui.hud.patch(o.hotbarId, { slots: slots() });
  });
  const unbind = () => {
    off();
    for (const [on, id] of [[o.coins, o.coinsId], [showWeight, o.weightId], [bar, o.hotbarId]]) if (on && ui.hud.has(id)) ui.hud.remove(id);
  };
  unbind.quick = quick;
  return unbind;
}
