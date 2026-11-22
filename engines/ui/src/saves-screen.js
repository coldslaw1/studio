// Save slots screen: pick a slot to load, save into or erase. Works with
// core's `game.saves` (list, load, save, erase); nothing is imported from core.

/** formatSavedAt(ms) -> 'YYYY-MM-DD HH:MM' in local time, or '' when ms is not a number. */
export function formatSavedAt(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * openSaves(ui, options) -> the menu   (normally called as ui.showSaves(options))
 *   options: {
 *     saves,                 required: { list(), load(slot), save(slot, data), erase(slot) } (core's game.saves)
 *     mode = 'load',         'load' or 'save'
 *     data(),                save mode, required: returns the data to store
 *     onLoad(slot, data),    load mode: every menu is closed first, then this runs
 *     onSaved(slot, ok),     save mode: after a save (ok is false when the browser refused)
 *     describe(data, info),  text for a used slot's second line, e.g. 'Level 3, 120 coins'
 *     slotName(slot),        default 'Slot 1', 'Slot 2', ...
 *     skip = [],             slot numbers not offered (e.g. [1] to keep an autosave slot out of save mode)
 *     erase = true,          false hides "Erase a save"
 *     confirmOverwrite = true,
 *     formatDate(ms),        default formatSavedAt
 *     title, onClose()
 *   }
 * Item ids: slot-1, slot-2, ..., erase, back. snapshot().screen is 'load', 'save' or 'erase'.
 */
export function openSaves(ui, options = {}) {
  const o = { mode: 'load', skip: [], erase: true, confirmOverwrite: true, formatDate: formatSavedAt, ...options };
  const { saves } = o;
  if (!saves || typeof saves.list !== 'function' || typeof saves.load !== 'function') {
    throw new Error('ui.showSaves: "saves" must have list(), load(slot), save(slot, data) and erase(slot) (core\'s game.saves)');
  }
  if (o.mode !== 'load' && o.mode !== 'save') throw new Error(`ui.showSaves: mode must be 'load' or 'save', got "${o.mode}"`);
  if (o.mode === 'save' && typeof o.data !== 'function') throw new Error('ui.showSaves: save mode needs data(), a function that returns what to save');
  const name = (n) => (typeof o.slotName === 'function' ? String(o.slotName(n)) : `Slot ${n}`);
  let mode = o.mode;
  let menu = null;

  function build() {
    const list = saves.list().filter((info) => !o.skip.includes(info.slot));
    const newest = list.reduce((best, info) => (!info.empty && (info.savedAt ?? 0) > (best ? best.savedAt ?? 0 : -1) ? info : best), null);
    const items = list.map((info) => {
      let detail = 'Empty';
      if (!info.empty) {
        const data = saves.load(info.slot);
        const about = data === null ? 'Cannot be read' : (typeof o.describe === 'function' ? String(o.describe(data, info) ?? '') : '');
        detail = [about, o.formatDate(info.savedAt)].filter(Boolean).join('  -  ') || 'Saved game';
      }
      return {
        id: `slot-${info.slot}`, label: name(info.slot), detail, icon: mode === 'erase' ? 'trash' : 'save',
        badge: newest === info && list.filter((i) => !i.empty).length > 1 ? 'Newest' : '',
        danger: mode === 'erase', disabled: info.empty && mode !== 'save',
        onSelect: () => pick(info.slot, info.empty),
      };
    });
    const used = list.some((info) => !info.empty);
    if (mode !== 'erase' && o.erase && used && typeof saves.erase === 'function') {
      items.push({ id: 'erase', label: 'Erase a save', icon: 'trash', onSelect: () => { mode = 'erase'; show(); } });
    }
    items.push({ id: 'back', label: 'Back', icon: 'back', onSelect: leave });
    const titles = { load: 'Load game', save: 'Save game', erase: 'Erase a save' };
    return {
      id: mode, title: mode === o.mode ? (o.title ?? titles[mode]) : titles[mode],
      footer: saves.persistent === false ? 'This browser will forget saves when the page closes' : '',
      items, onCancel: leave,
    };
  }
  // The screen is rebuilt in place after every change, keeping the focus where it was.
  function show() {
    let focus;
    const again = menu && ui.current() === menu;
    if (again) { focus = menu.focusId; ui.back(); }
    const spec = build();
    const ok = spec.items.some((i) => i.id === focus && !i.disabled);
    menu = ui.open({ ...spec, focus: ok ? focus : undefined });
    if (again) menu.age = 10;
    return menu;
  }
  function leave() {
    if (mode !== o.mode) { mode = o.mode; show(); return; }
    if (ui.current() === menu) ui.back();
    if (typeof o.onClose === 'function') o.onClose();
  }
  function confirm(title, text, yes, then) {
    ui.showMessage({
      title, text, focus: 'no',
      buttons: [{ id: 'yes', label: yes, danger: true }, { id: 'no', label: 'Cancel' }],
      onSelect: (id) => { if (id === 'yes') then(); },
    });
  }
  function write(slot) {
    const ok = saves.save(slot, o.data()) !== false;
    ui.toast(ok ? { text: `Saved to ${name(slot)}`, kind: 'good' } : { text: 'The browser refused to save', kind: 'danger' });
    if (ok && ui.current() === menu) ui.back(); else show();
    if (typeof o.onSaved === 'function') o.onSaved(slot, ok);
  }
  function pick(slot, empty) {
    if (mode === 'erase') {
      confirm(`Erase ${name(slot)}?`, 'This cannot be undone.', 'Erase', () => {
        saves.erase(slot);
        ui.toast(`${name(slot)} erased`);
        if (!saves.list().some((info) => !info.empty && !o.skip.includes(info.slot))) mode = o.mode;
        show();
      });
    } else if (mode === 'save') {
      if (!empty && o.confirmOverwrite) confirm(`Overwrite ${name(slot)}?`, 'The game saved there will be replaced.', 'Overwrite', () => write(slot));
      else write(slot);
    } else {
      const data = saves.load(slot);
      if (data === null) { ui.toast({ text: `${name(slot)} cannot be read`, kind: 'danger' }); return; }
      ui.closeAll();
      if (typeof o.onLoad === 'function') o.onLoad(slot, data);
    }
  }
  return show();
}
