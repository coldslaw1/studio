// The drawn inventory panel: a grid of item cells, equipment slots, an optional
// chest or shop beside the bag, quick slots, drag and drop. This file holds the
// behaviour (cursor, drag, what a drop means); panel-layout.js places things
// and panel-draw.js paints them. It knows nothing about the ui kit: the caller
// gives it a theme, a unit, a screen size and a way to send actions.

import { layoutPanel, targetAt, nextTarget, contains } from './panel-layout.js';
import { drawPanel } from './panel-draw.js';
import { tooltipFor } from './panel-tip.js';
import { buyPrice, shopMoney } from './shop.js';

const DIRS = ['up', 'down', 'left', 'right'];
const HINTS = {
  keys: 'Enter: pick up, put down',
  pointer: 'Drag to move, double-click to use',
  chest: 'Double-click to move across',
  shop: 'Double-click to buy or sell',
  chestKeys: 'Enter: pick up, then put down on the other side',
  shopKeys: 'Enter: buy or sell one',
};

/**
 * createInventoryPanel(options) -> panel
 *   inventory        required
 *   theme()          required: returns the ui kit theme (colours, fonts)
 *   unit()           required: returns the ui unit in pixels
 *   act(action)      required: carries out one inventory action
 *   env()            the env object ({ drops, position, shops }) - used to know if "drop" is possible
 *   openActions(ref) open the Use / Equip / Split / Drop menu for a slot
 *   icons(ctx, stack, def, x, y, size)   draw an item's icon; return true when drawn (else the built-in icon is used)
 *   drawDoll(ctx, rect)   draw the character between the equipment slots
 *   labels           words: { bag, equipped, chest, shop, hotbar, sort, close, takeAll, actions, coins }
 *   money(shop)      how a shop's prices are shown: { symbol, balance, sellPrice(stack) } (see shopMoney). Default: coins
 *   keys             extra input actions: { quick: ['interact'], toggle: ['inventory'] } (ignored when not bound)
 *   cellSize         wanted cell size in ui units (default 2.6)
 *   onClose()
 * panel: open(mode), close(), isOpen(), mode, setViewport(width, height), update(dt, input) -> true while open,
 *        action(name), pointer(p), wheel(deltaY, pointer), draw(ctx, kit), snapshot(), layout()
 *   mode: { kind: 'bag' | 'chest' | 'shop', name (chest bag name or shop name), shop, title, bag }
 */
export function createInventoryPanel(options = {}) {
  const inv = options.inventory;
  if (!inv || typeof inv.list !== 'function') throw new Error('createInventoryPanel: options.inventory is required');
  for (const fn of ['theme', 'unit', 'act']) if (typeof options[fn] !== 'function') throw new Error(`createInventoryPanel: options.${fn} must be a function`);
  const L = { bag: 'Bag', equipped: 'Equipped', chest: 'Chest', shop: 'Shop', hotbar: 'Quick slots', sort: 'Sort', close: 'Close', takeAll: 'Take all', actions: 'Actions', ...(options.labels || {}) };
  const keys = { quick: ['quick', 'interact'], toggle: ['inventory'], ...(options.keys || {}) };
  let mode = null;
  /** How prices are shown right now: the open shop's currency, or plain coins. */
  const money = () => shopMoney(inv, mode && mode.kind === 'shop' ? mode.shop : null, options.money);
  let view = { width: 0, height: 0 };
  let cursor = null; // target id under the keyboard / gamepad cursor
  let lastCell = null; // last item cell the cursor was on (for the Actions button)
  let hover = null; // target id under the mouse
  let held = null; // { from: target id, id: item id, pointer: bool }
  let press = null;
  let lastTap = { id: null, time: -9 };
  let pointerMode = false;
  let point = null; // last pointer position; null until the first sample after opening
  let time = 0;
  let hold = { name: null, t: 0 };
  let wanted = null; // slot ref whose action menu opens on the next update (never in the update that read the key)
  const scroll = { bag: 0, other: 0 };

  const bagName = () => (mode && mode.bag) ?? inv.bags()[0];
  const hotbar = () => (Array.isArray(inv.state.hotbar) ? inv.state.hotbar : []);
  const parse = (id) => { const i = id.indexOf(':'); return { zone: id.slice(0, i), key: id.slice(i + 1), index: Number(id.slice(i + 1)) }; };
  const env = () => (typeof options.env === 'function' ? options.env() : null) || {};
  const pressed = (input, name) => { try { return input.pressed(name); } catch { return false; } };
  const down = (input, name) => { try { return input.down(name); } catch { return false; } };

  function buttons() {
    const list = [];
    if (mode.kind === 'bag' && typeof options.openActions === 'function') list.push({ id: 'actions', label: L.actions });
    if (mode.kind === 'chest') list.push({ id: 'take-all', label: L.takeAll });
    list.push({ id: 'sort', label: L.sort }, { id: 'close', label: L.close });
    return list;
  }
  function layout() {
    if (!mode) throw new Error('inventoryPanel.layout: the panel is not open');
    const bag = inv.bag(bagName());
    let other = null;
    if (mode.kind === 'chest') { const c = inv.bag(mode.name); other = { size: c.slots.length, columns: c.columns, label: mode.title ?? L.chest }; }
    if (mode.kind === 'shop') other = { size: Math.max(1, mode.shop.stock.length), columns: 4, label: mode.title ?? L.shop };
    return layoutPanel({
      width: view.width, height: view.height, unit: options.unit(), cellSize: options.cellSize,
      bag: { size: bag.slots.length, columns: bag.columns, label: mode.kind === 'bag' ? L.bag : (mode.bagLabel ?? L.bag) },
      equipSlots: Object.keys(inv.state.equip), other, hotbar: mode.kind === 'bag' ? hotbar().length : 0,
      buttons: buttons(), scroll, equipLabel: L.equipped, hotbarLabel: L.hotbar,
    });
  }
  /** The slot ref an inventory action needs for a target, or null (shop lines, quick slots, buttons). */
  function refOf(id) {
    const t = parse(id);
    if (t.zone === 'bag') return { bag: bagName(), index: t.index };
    if (t.zone === 'equip') return { equip: t.key };
    if (t.zone === 'other' && mode.kind === 'chest') return { bag: mode.name, index: t.index };
    return null;
  }
  /** What a target shows: { id, n, data?, shop?, price? } or null. */
  function stackAt(id) {
    const t = parse(id);
    if (t.zone === 'btn') return null;
    if (t.zone === 'hot') {
      const item = hotbar()[t.index];
      if (!item || !inv.catalog.has(item)) return null;
      // an item you are wearing is not in the bag, but it is not "run out" either: it counts
      const worn = Object.values(inv.state.equip).filter((s) => s && s.id === item).reduce((n, s) => n + (s.n ?? 1), 0);
      return { id: item, n: inv.count(item) + worn, quick: true };
    }
    if (t.zone === 'other' && mode.kind === 'shop') {
      const line = mode.shop.stock[t.index];
      return line && line.n !== 0 ? { id: line.id, n: line.n ?? 1, data: line.data, shop: true, endless: line.n === null, price: buyPrice(mode.shop, inv.catalog, t.index) } : null;
    }
    return inv.at(refOf(id));
  }

  function dropOn(src, dst) {
    const s = parse(src);
    const d = parse(dst);
    if (d.zone === 'btn' || src === dst) return;
    if (mode.kind === 'shop' && (s.zone === 'other' || d.zone === 'other')) {
      if (s.zone === 'other' && d.zone !== 'other') options.act({ type: 'inv.buy', shop: mode.name, index: s.index, n: 1 });
      else if (d.zone === 'other' && s.zone !== 'other' && refOf(src)) options.act({ type: 'inv.sell', shop: mode.name, from: refOf(src) });
      return;
    }
    if (d.zone === 'hot') {
      const mine = stackAt(src);
      if (!mine) return;
      const action = { type: 'inv.hotbar', slot: d.index, id: mine.id };
      if (s.zone === 'hot') action.swap = s.index; // what was in the target goes where this came from, in one action
      options.act(action);
      return;
    }
    if (s.zone === 'hot') { options.act({ type: 'inv.hotbar', slot: s.index, id: null }); return; }
    options.act({ type: 'inv.move', from: refOf(src), to: refOf(dst) });
  }
  function dropOutside(src) {
    const s = parse(src);
    if (s.zone === 'hot') { options.act({ type: 'inv.hotbar', slot: s.index, id: null }); return; }
    const e = env();
    if (refOf(src) && s.zone !== 'other' && e.drops && e.position) options.act({ type: 'inv.drop', from: refOf(src) });
  }
  /** Double-click, or the quick key: the obvious thing for this item right now. */
  function quick(id) {
    const t = parse(id);
    const stack = stackAt(id);
    if (!stack) return;
    if (mode.kind === 'shop') {
      if (t.zone === 'other') options.act({ type: 'inv.buy', shop: mode.name, index: t.index, n: 1 });
      else if (refOf(id)) options.act({ type: 'inv.sell', shop: mode.name, from: refOf(id), n: 1 });
    } else if (mode.kind === 'chest' && t.zone !== 'equip') {
      options.act({ type: 'inv.transfer', from: refOf(id), to: t.zone === 'other' ? bagName() : mode.name });
    } else if (t.zone === 'equip') options.act({ type: 'inv.unequip', slot: t.key });
    else if (t.zone === 'hot') options.act({ type: 'inv.quick', slot: t.index });
    else if (inv.catalog.get(stack.id).equip) options.act({ type: 'inv.equip', from: refOf(id) });
    else if (inv.catalog.get(stack.id).use !== undefined) options.act({ type: 'inv.use', from: refOf(id) });
  }
  // The menu opens one update later: opened at once, the key press or tap that asked for it would also press its first button.
  function actions(id) {
    const ref = id && refOf(id);
    if (ref && stackAt(id) && parse(id).zone !== 'other' && typeof options.openActions === 'function') wanted = ref;
  }
  function button(t) {
    if (t.scrolls) { scroll[t.scrolls] = Math.max(0, Math.min(layout().grids[t.scrolls].maxScroll, (scroll[t.scrolls] || 0) + t.dir)); return; }
    if (t.button === 'close') panel.close();
    else if (t.button === 'sort') options.act({ type: 'inv.sort', bag: bagName() });
    else if (t.button === 'take-all') options.act({ type: 'inv.takeAll', from: mode.name, to: bagName() });
    else if (t.button === 'actions') actions(lastCell);
  }
  const stillThere = () => held && stackAt(held.from) && stackAt(held.from).id === held.id;
  function setCursor(id) {
    cursor = id;
    if (id && parse(id).zone !== 'btn') lastCell = id;
  }
  /** Confirm on the cursor, or a tap / click on a target. */
  function activate(id, viaPointer) {
    const l = layout();
    const t = l.targets.find((x) => x.id === id);
    if (!t) return;
    if (t.zone === 'btn') { held = null; button(t); return; }
    if (held) {
      const from = held.from;
      const ok = stillThere();
      held = null;
      if (!ok) return;
      if (from === id) actions(id);
      else dropOn(from, id);
      return;
    }
    const stack = stackAt(id);
    if (!stack) return;
    if (viaPointer) {
      if (lastTap.id === id && time - lastTap.time < 0.45) { lastTap = { id: null, time: -9 }; quick(id); } else lastTap = { id, time };
      return;
    }
    // In a shop the keys trade at once (like a double-click): there is nothing to arrange at a counter.
    if (mode.kind === 'shop') { quick(id); return; }
    held = { from: id, id: stack.id, pointer: false };
  }
  function move(dir) {
    const l = layout();
    const t = cursor ? parse(cursor) : null;
    const g = t && l.grids[t.zone];
    if (g && (dir === 'up' || dir === 'down')) {
      const size = t.zone === 'bag' ? inv.bag(bagName()).slots.length : (mode.kind === 'shop' ? mode.shop.stock.length : inv.bag(mode.name).slots.length);
      const next = t.index + (dir === 'down' ? g.cols : -g.cols);
      const row = Math.floor(next / g.cols);
      if (next >= 0 && next < size && (row < g.scroll || row >= g.scroll + g.visibleRows)) {
        scroll[t.zone] = row < g.scroll ? row : row - g.visibleRows + 1;
        setCursor(`${t.zone}:${next}`);
        return;
      }
    }
    setCursor(nextTarget(l, cursor, dir));
  }

  const panel = {
    get mode() { return mode; },
    isOpen: () => mode !== null,
    setViewport(width, height) { if (width > 0 && height > 0) view = { width, height }; },
    layout,
    open(m = {}) {
      const kind = m.kind ?? 'bag';
      if (!['bag', 'chest', 'shop'].includes(kind)) throw new Error(`inventoryPanel.open: unknown kind "${kind}". Use bag, chest or shop`);
      if (kind === 'chest') inv.bag(m.name); // throws when the chest is not attached
      if (kind === 'shop' && (!m.shop || !Array.isArray(m.shop.stock))) throw new Error('inventoryPanel.open: a shop needs { shop, name }');
      mode = { ...m, kind };
      held = null; press = null; hover = null; pointerMode = false; point = null;
      scroll.bag = 0; scroll.other = 0;
      cursor = kind === 'bag' ? 'bag:0' : 'other:0';
      lastCell = cursor;
      return panel;
    },
    close() {
      if (!mode) return panel;
      mode = null; held = null; press = null; wanted = null;
      if (typeof options.onClose === 'function') options.onClose();
      return panel;
    },
    /** action(name): 'up' 'down' 'left' 'right' 'confirm' 'cancel' 'quick'. */
    action(name) {
      if (!mode || !view.width) return false;
      pointerMode = false;
      if (!layout().targets.some((t) => t.id === cursor)) setCursor(layout().targets[0].id);
      if (DIRS.includes(name)) move(name);
      else if (name === 'confirm') activate(cursor, false);
      else if (name === 'quick') { held = null; quick(cursor); } else if (name === 'cancel') { if (held) held = null; else panel.close(); } else throw new Error(`inventoryPanel.action: unknown action "${name}"`);
      return true;
    },
    /** pointer(p): mouse or finger state { x, y, down, pressed, released }. */
    pointer(p) {
      if (!mode || !view.width) return false;
      const l = layout();
      const moved = point !== null && (p.x !== point.x || p.y !== point.y);
      point = { x: p.x, y: p.y };
      const t = targetAt(l, p.x, p.y);
      if (p.pressed) {
        pointerMode = true;
        hover = t ? t.id : null;
        press = { id: t ? t.id : null, x: p.x, y: p.y, drag: false };
        if (t && t.zone !== 'btn') setCursor(t.id);
      } else if (p.down && press) {
        const far = Math.hypot(p.x - press.x, p.y - press.y) > 0.3 * l.cell;
        if (!press.drag && far && press.id && parse(press.id).zone !== 'btn' && stackAt(press.id)) {
          press.drag = true;
          held = { from: press.id, id: stackAt(press.id).id, pointer: true };
        }
        if (press.drag) hover = t ? t.id : null;
      } else if (!p.down && !p.released && moved) {
        pointerMode = true;
        hover = t ? t.id : null;
      }
      if (p.released && press) {
        const pr = press;
        press = null;
        hover = t ? t.id : null;
        if (pr.drag) {
          const from = held ? held.from : null;
          const ok = stillThere();
          held = null;
          if (ok && t) dropOn(from, t.id);
          else if (ok && !contains(l.panel, p.x, p.y)) dropOutside(from);
        } else if (t && t.id === pr.id) activate(t.id, true);
      }
      return true;
    },
    /** update(dt, input) -> true while the panel is open (and on the update that closes it). */
    update(dt, input) {
      if (!(dt >= 0)) throw new Error(`inventoryPanel.update: dt must be seconds >= 0, got ${dt}`);
      time += dt;
      const was = mode !== null;
      if (was && wanted) {
        const ref = wanted;
        wanted = null;
        if (inv.at(ref)) options.openActions(ref);
        return true;
      }
      if (!was || !input || !view.width) return was;
      if (input.lastDevice !== 'pointer') {
        let fired = false;
        for (const name of [...DIRS, 'confirm', 'cancel']) {
          if (mode && (pressed(input, name) || (name === 'cancel' && pressed(input, 'pause')))) { panel.action(name); fired = true; }
        }
        if (mode && !fired && keys.quick.some((k) => pressed(input, k))) { panel.action('quick'); fired = true; }
        if (mode && !fired && keys.toggle.some((k) => pressed(input, k))) panel.close();
        const heldDir = DIRS.find((n) => down(input, n)) || null;
        if (heldDir !== hold.name) hold = { name: heldDir, t: 0 };
        else if (heldDir && !fired && mode) { hold.t += dt; if (hold.t > 0.4) { hold.t -= 0.09; panel.action(heldDir); } }
      } else hold = { name: null, t: 0 };
      if (mode && input.pointer) panel.pointer(input.pointer);
      return true;
    },
    /** wheel(deltaY, pointer): the mouse wheel scrolls the grid under the pointer (or the bag). */
    wheel(deltaY, at) {
      if (!mode || !view.width || !deltaY) return false;
      const l = layout();
      const zone = at && l.grids.other && contains(l.grids.other.rect, at.x, at.y) ? 'other' : 'bag';
      const g = l.grids[zone];
      if (!g || g.maxScroll === 0) return false;
      scroll[zone] = Math.max(0, Math.min(g.maxScroll, g.scroll + (deltaY > 0 ? 1 : -1)));
      return true;
    },
    /** draw(ctx, kit): kit is the ui kit's draw frame ({ drawSurface, focusRing }); without it plain boxes are drawn. */
    draw(ctx, kit) {
      if (!mode || !view.width) return;
      const l = layout();
      const tipId = held ? null : (pointerMode ? hover : cursor);
      drawPanel(ctx, {
        layout: l, theme: options.theme(), inventory: inv, mode, title: mode.title ?? L[mode.kind] ?? L.bag, labels: L, money: money(),
        cursor: pointerMode ? hover : cursor, held, point: point ?? { x: 0, y: 0 }, pointerMode, time, stackAt, tip: tipId ? tipOf(tipId) : null, tipId,
        icons: options.icons, drawDoll: options.drawDoll, hotbar: hotbar(), view, kit: kit && typeof kit.drawSurface === 'function' ? kit : null,
        hint: HINTS[mode.kind === 'bag' ? (pointerMode ? 'pointer' : 'keys') : (pointerMode ? mode.kind : `${mode.kind}Keys`)],
      });
    },
    snapshot() {
      if (!mode || !view.width) return { open: mode !== null, mode: mode ? mode.kind : null, cells: [], buttons: [] };
      const l = layout();
      const centre = (t) => ({ x: Math.round(t.rect.x + t.rect.w / 2), y: Math.round(t.rect.y + t.rect.h / 2) });
      const tipId = held ? null : (pointerMode ? hover : cursor);
      return {
        open: true, mode: mode.kind, cursor: pointerMode ? hover : cursor, held: held ? held.id : null,
        tooltip: tipId && tipOf(tipId) ? tipOf(tipId).title : null,
        cells: l.targets.filter((t) => t.zone !== 'btn').map((t) => { const s = stackAt(t.id); return { id: t.id, item: s ? s.id : null, n: s ? s.n : 0, ...centre(t) }; }),
        buttons: l.targets.filter((t) => t.zone === 'btn').map((t) => ({ id: t.id, ...centre(t) })),
        panel: l.panel,
      };
    },
  };

  function tipOf(id) {
    const stack = stackAt(id);
    if (!stack) return null;
    const t = parse(id);
    const o = { worn: t.zone === 'equip' };
    if (mode.kind === 'shop') o.symbol = money().symbol;
    if (stack.shop) o.price = stack.price;
    else if (mode.kind === 'shop' && t.zone !== 'hot') o.sell = money().sellPrice(stack);
    return tooltipFor(inv, stack.quick ? { id: stack.id, n: Math.max(1, stack.n) } : stack, o);
  }
  return panel;
}
