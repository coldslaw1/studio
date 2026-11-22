// A menu: a list of items with one focused, driven by actions and the pointer.
// State and behaviour only. Positions come from menu-layout.js, drawing from
// menu-draw.js, mouse and touch handling from menu-pointer.js.

import { clamp, approach } from './geometry.js';
import { normalizeItem, isFocusable, adjustItem, setSliderFraction, sliderFraction } from './items.js';
import { layoutMenu, sliderTrack } from './menu-layout.js';
import { gridMetrics, moveInGrid, enterGrid } from './grid.js';
import { RESERVED_KEYS } from './keys.js';
import { createMenuPointer } from './menu-pointer.js';
import { menuSnapshot } from './menu-snapshot.js';
import { createMenuWheel } from './wheel.js';

const NO_SAFE = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * createMenu(options) -> menu
 *   options: {
 *     id = 'menu',          name reported by snapshot(), e.g. 'pause'
 *     title, subtitle,      heading lines (optional)
 *     text,                 a paragraph under the heading (optional, wraps)
 *     footer,               small hint line at the bottom (optional)
 *     items,                array of item objects (see items.js), at least one selectable
 *     variant = 'panel',    'panel' (boxed) or 'title' (big heading, no box)
 *     backdrop = 'dim',     'dim' (game shows through), 'solid' (theme.bg) or 'none'
 *     wide = false,         true lets the panel grow wider (grids, long rows)
 *     focus,                id of the item or grid cell focused first (default: first selectable)
 *     onSelect(id, item),   a button or grid cell was activated
 *     onChange(id, value, item),  a toggle/slider/choice/key changed
 *     onCancel(),           cancel/back was pressed (optional)
 *   }
 * The menu is normally created for you by ui.open() or ui.showPause() etc.
 */
export function createMenu(options) {
  if (!options || !Array.isArray(options.items)) {
    throw new Error('createMenu: options.items must be an array of menu items');
  }
  const items = options.items.map(normalizeItem);
  const ids = new Set();
  const claim = (id) => {
    if (ids.has(id)) throw new Error(`createMenu: two items share the id "${id}"`);
    ids.add(id);
  };
  for (const item of items) {
    claim(item.id);
    if (item.type === 'grid') for (const cell of item.cells) claim(cell.id);
  }
  if (!items.some(isFocusable)) {
    throw new Error('createMenu: the menu needs at least one item that can be selected');
  }
  const S = { focus: items.findIndex(isFocusable), column: 0 };
  let viewport = { width: 320, height: 180, unit: 9, safe: NO_SAFE };
  let cache = null;
  let version = 0;

  /** Where an item id or grid cell id lives: { index, cell } or null. */
  function locate(id) {
    for (let index = 0; index < items.length; index++) {
      if (items[index].id === id) return { index, cell: -1 };
      if (items[index].type === 'grid') {
        const cell = items[index].cells.findIndex((c) => c.id === id);
        if (cell >= 0) return { index, cell };
      }
    }
    return null;
  }
  function focusOn(spot) {
    if (!isFocusable(items[spot.index])) return false;
    S.focus = spot.index;
    if (spot.cell >= 0) items[spot.index].cursor = spot.cell;
    menu.focusAge = 0;
    return true;
  }
  const hasHints = () => items.some((i) => i.hint || (i.type === 'grid' && i.cells.some((c) => c.label || c.hint)));

  const menu = {
    id: options.id ?? 'menu',
    title: options.title ?? '',
    subtitle: options.subtitle ?? '',
    text: options.text ?? '',
    footer: options.footer ?? '',
    variant: options.variant ?? 'panel',
    backdrop: options.backdrop ?? 'dim',
    wide: !!options.wide,
    canCancel: typeof options.onCancel === 'function',
    hasHints: hasHints(),
    items,
    scroll: 0,
    scrollShown: 0, // what is drawn: follows `scroll` smoothly
    age: 0, // seconds since opened, used for the open animation
    focusAge: 1, // seconds since the focus last moved
    capturing: null, // id of the key row waiting for a key press, or null
    pressedId: null, // id under a held mouse button or finger
    get focusId() {
      const item = items[S.focus];
      return item.type === 'grid' ? item.cells[item.cursor].id : item.id;
    },
    get focusIndex() { return S.focus; },
    /** setViewport({width, height, unit, safe, hint}) - called by the ui before layout. */
    setViewport(v) { viewport = { safe: NO_SAFE, ...v }; },
    layout() {
      const sig = `${version}|${menu.title}|${menu.subtitle}|${menu.text}|${menu.footer}`;
      if (cache && cache.viewport === viewport && cache.scroll === menu.scroll && cache.sig === sig) return cache.l;
      const l = layoutMenu(menu, viewport);
      menu.scroll = l.scroll;
      cache = { viewport, scroll: l.scroll, sig, l };
      return l;
    },
    /** item(id) -> the item object, or throws. */
    item(id) {
      const found = items.find((i) => i.id === id);
      if (!found) throw new Error(`menu.item: no item with id "${id}"`);
      return found;
    },
    /** setValue(id, value) sets a toggle/slider/choice/key value without firing onChange. */
    setValue(id, value) {
      const index = items.findIndex((i) => i.id === id);
      if (index < 0) throw new Error(`menu.setValue: no item with id "${id}"`);
      items[index] = normalizeItem({ ...items[index], value }, index);
    },
    /** setCells(id, cells) replaces the cells of a grid item; the cursor stays where it was if it can. */
    setCells(id, cells) {
      const index = items.findIndex((i) => i.id === id && i.type === 'grid');
      if (index < 0) throw new Error(`menu.setCells: no grid item with id "${id}"`);
      const next = normalizeItem({ ...items[index], cells }, index);
      const taken = new Set(items.flatMap((it, i) => (i === index ? [it.id] : [it.id, ...(it.cells || []).map((c) => c.id)])));
      for (const cell of next.cells) {
        if (taken.has(cell.id)) throw new Error(`menu.setCells: the id "${cell.id}" is already used in this menu`);
        taken.add(cell.id);
      }
      items[index] = next;
      version += 1;
      menu.hasHints = hasHints();
      if (!isFocusable(items[S.focus])) S.focus = items.findIndex(isFocusable);
    },
    /** setFocus(id) moves the focus to an item or a grid cell. */
    setFocus(id) {
      const spot = locate(id);
      if (!spot) throw new Error(`menu.setFocus: no item with id "${id}"`);
      if (focusOn(spot)) reveal();
    },
    /** focusHint() -> { title, text } to show for the focused row or cell, or null. */
    focusHint() {
      const item = items[S.focus];
      if (item.type === 'grid') {
        const cell = item.cells[item.cursor];
        return cell.label || cell.hint ? { title: cell.label, text: cell.hint ?? '' } : null;
      }
      return item.hint ? { title: '', text: String(item.hint) } : null;
    },
    /**
     * action(name) handles one menu action:
     * 'up' 'down' 'left' 'right' 'confirm' 'cancel'. Returns true if it did something.
     */
    action(name) {
      if (menu.capturing) {
        if (name === 'cancel') { menu.capturing = null; return true; }
        return false;
      }
      const item = items[S.focus];
      if (name === 'up' || name === 'down') {
        if (item.type === 'grid' && moveInGrid(item, columnsOf(item), name)) return moved();
        return move(name === 'up' ? -1 : 1);
      }
      if (name === 'left' || name === 'right') {
        if (item.type === 'grid') {
          const cols = columnsOf(item);
          const did = moveInGrid(item, cols, name);
          S.column = item.cursor % cols;
          return did ? moved() : false;
        }
        const changed = adjustItem(item, name === 'left' ? -1 : 1);
        if (changed) changedItem(item);
        return changed;
      }
      if (name === 'confirm') return activate(item, 1);
      if (name === 'cancel') {
        if (typeof options.onCancel === 'function') { options.onCancel(); return true; }
        return false;
      }
      throw new Error(`menu.action: unknown action "${name}". Use up, down, left, right, confirm or cancel`);
    },
    /**
     * captureKey(code) gives the key row that is waiting its new key. Returns
     * true when the menu was waiting for one. 'Escape' leaves the old key.
     * A key already used by another key row in this menu swaps with it.
     */
    captureKey(code) {
      if (!menu.capturing) return false;
      if (typeof code !== 'string' || !code) throw new Error(`menu.captureKey: code must be a non-empty string, got ${String(code)}`);
      if (code === 'Escape') { menu.capturing = null; return true; }
      if (RESERVED_KEYS.includes(code)) return true;
      const item = menu.item(menu.capturing);
      const old = item.value;
      menu.capturing = null;
      if (old.length === 1 && old[0] === code) return true;
      item.value = [code];
      for (const other of items) {
        if (other === item || other.type !== 'key' || !other.value.includes(code)) continue;
        const rest = other.value.filter((c) => c !== code);
        other.value = rest.length ? rest : old.filter((c) => c !== code);
        changedItem(other);
      }
      changedItem(item);
      return true;
    },
    /** tick(dt, motion) advances the menu's animations. Called by the ui once per update. */
    tick(dt, motion = true) {
      menu.age += dt;
      menu.focusAge += dt;
      menu.scrollShown = motion ? approach(menu.scrollShown, menu.scroll, dt, 22) : menu.scroll;
      for (const item of items) {
        if (item.type !== 'toggle' && item.type !== 'slider') continue;
        const target = item.type === 'toggle' ? (item.value ? 1 : 0) : sliderFraction(item);
        item.shown = motion ? approach(item.shown ?? target, target, dt, 26) : target;
      }
    },
    /** snapshot() -> plain data describing the menu, for tests and play-tests. */
    snapshot() { return menuSnapshot(menu); },
  };

  const columnsOf = (item) => { const l = menu.layout(); return gridMetrics(item, l.view.w, l.unit).cols; };
  function moved() { menu.focusAge = 0; reveal(); return true; }

  function move(dir) {
    const n = items.length;
    for (let step = 1; step <= n; step++) {
      const i = (S.focus + dir * step + n * step) % n;
      if (!isFocusable(items[i])) continue;
      const before = menu.focusId;
      S.focus = i;
      if (items[i].type === 'grid') enterGrid(items[i], columnsOf(items[i]), dir < 0, S.column);
      const changed = menu.focusId !== before;
      if (changed) menu.focusAge = 0;
      reveal();
      return changed;
    }
    return false;
  }

  // Scroll so the focused row (or grid cell) is fully inside the visible area.
  function reveal() {
    const l = menu.layout();
    const row = l.rows[S.focus];
    const rect = row.cells ? row.cells[items[S.focus].cursor].rect : row.rect;
    let scroll = menu.scroll;
    if (rect.y < l.view.y) scroll -= l.view.y - rect.y;
    const over = rect.y + rect.h - (l.view.y + l.view.h);
    if (over > 0) scroll += over;
    menu.scroll = clamp(scroll, 0, l.maxScroll);
  }

  function changedItem(item) {
    if (typeof item.onChange === 'function') item.onChange(item.value, item);
    if (typeof options.onChange === 'function') options.onChange(item.id, item.value, item);
  }

  function activate(item, dir) {
    if (!isFocusable(item)) return false;
    if (item.type === 'button') {
      if (typeof item.onSelect === 'function') item.onSelect(item);
      if (typeof options.onSelect === 'function') options.onSelect(item.id, item);
      return true;
    }
    if (item.type === 'grid') {
      const cell = item.cells[item.cursor];
      if (cell.disabled) return false;
      if (typeof item.onSelect === 'function') item.onSelect(cell, item);
      if (typeof options.onSelect === 'function') options.onSelect(cell.id, cell);
      return true;
    }
    if (item.type === 'key') { menu.capturing = item.id; return true; }
    if (item.type === 'slider') return false;
    const changed = adjustItem(item, dir);
    if (changed) changedItem(item);
    return changed;
  }

  function dragSlider(item, row, unit, x) {
    const track = sliderTrack(row.control, unit);
    if (setSliderFraction(item, (x - track.x) / track.w)) changedItem(item);
  }

  menu.pointer = createMenuPointer(menu, items, S, { activate, dragSlider, focusOn });
  /** wheel(deltaY, pointer, time): the mouse wheel or a trackpad scroll (see wheel.js). */
  menu.wheel = createMenuWheel(menu, items, focusOn);
  if (options.focus !== undefined) {
    const spot = locate(options.focus);
    if (!spot) throw new Error(`createMenu: focus "${options.focus}" is not an item id`);
    focusOn(spot);
    menu.focusAge = 1;
  }
  return menu;
}
