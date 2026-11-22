// Ready-made screens. Each function turns simple options into createMenu options.
// Rule for every built-in button: the menus close first, then your callback
// runs. The one exception is "Settings", which opens on top of the current menu.

function need(fn, who, name) {
  if (typeof fn !== 'function') throw new Error(`${who}: "${name}" must be a function`);
}

function settingsButton(ui, o, who) {
  if (typeof o.onSettings === 'function') {
    return [{ id: 'settings', label: 'Settings', icon: 'gear', onSelect: () => o.onSettings() }];
  }
  if (o.settings) {
    return [{ id: 'settings', label: 'Settings', icon: 'gear', onSelect: () => ui.showSettings({ settings: o.settings }) }];
  }
  return [];
}

// Buttons a game with save slots gets by itself. o.game: { saves, saveData, onLoad, slotName, describe, skipSave }.
function saveButtons(ui, o, where) {
  const g = o.game;
  if (!g || !g.saves || typeof g.saves.list !== 'function') return { used: [] };
  const used = g.saves.list().filter((info) => !info.empty);
  const common = { saves: g.saves, slotName: g.slotName, describe: g.describe };
  const out = { used };
  if (typeof g.onLoad === 'function' && used.length) {
    const newest = used.reduce((a, b) => ((b.savedAt ?? 0) > (a.savedAt ?? 0) ? b : a));
    out.continue = {
      id: 'continue', label: 'Continue', icon: 'play',
      onSelect: () => {
        const data = g.saves.load(newest.slot);
        if (data === null) { ui.showSaves({ ...common, mode: 'load', onLoad: g.onLoad }); return; }
        ui.closeAll();
        g.onLoad(newest.slot, data);
      },
    };
    out.load = { id: 'load', label: 'Load game', icon: 'save', onSelect: () => ui.showSaves({ ...common, mode: 'load', onLoad: g.onLoad }) };
  }
  if (where === 'pause' && typeof g.saveData === 'function') {
    out.save = { id: 'save', label: 'Save game', icon: 'save', onSelect: () => ui.showSaves({ ...common, mode: 'save', data: g.saveData, skip: g.skipSave ?? [] }) };
  }
  return out;
}

function closing(ui, fn) {
  return () => { ui.closeAll(); if (typeof fn === 'function') fn(); };
}

/**
 * Title screen. options: { title, subtitle, footer, onPlay, onContinue, onSettings, settings, items }
 *   onPlay is required unless you pass your own `items` (then also pass onSelect).
 *   Buttons: Continue (if onContinue), Play, Settings (if onSettings or settings).
 */
export function titleOptions(ui, o = {}) {
  if (typeof o.title !== 'string' || !o.title) throw new Error('ui.showTitle: "title" must be a non-empty string');
  let items = o.items;
  if (!items) {
    need(o.onPlay, 'ui.showTitle', 'onPlay');
    const saved = saveButtons(ui, o, 'title');
    const cont = o.onContinue ? { id: 'continue', label: 'Continue', icon: 'play', onSelect: closing(ui, o.onContinue) } : saved.continue;
    items = [
      ...(cont ? [cont] : []),
      { id: 'play', label: cont ? 'New game' : 'Play', icon: cont ? undefined : 'play', onSelect: closing(ui, o.onPlay) },
      ...(saved.load && saved.used.length > 1 ? [saved.load] : []),
      ...settingsButton(ui, o),
    ];
  }
  return {
    id: 'title', variant: 'title', backdrop: 'solid',
    title: o.title, subtitle: o.subtitle, footer: o.footer, items, onSelect: o.onSelect, focus: o.focus,
  };
}

/**
 * Pause menu. options: { title = 'Paused', onResume, onRestart, onQuit, onSettings, settings, items }
 *   Buttons: Resume (always), Restart (if onRestart), Settings, Quit to title (if onQuit),
 *   then any extra `items`. Cancel / pause / Escape resumes.
 */
export function pauseOptions(ui, o = {}) {
  const resume = closing(ui, o.onResume);
  const saved = saveButtons(ui, o, 'pause');
  return {
    id: 'pause', title: o.title ?? 'Paused', footer: o.footer,
    items: [
      { id: 'resume', label: 'Resume', icon: 'play', onSelect: resume },
      ...(o.onRestart ? [{ id: 'restart', label: 'Restart', icon: 'restart', onSelect: closing(ui, o.onRestart) }] : []),
      ...(saved.save ? [saved.save] : []),
      ...(saved.load ? [saved.load] : []),
      ...settingsButton(ui, o),
      ...(o.onQuit ? [{ id: 'quit', label: 'Quit to title', icon: 'home', onSelect: closing(ui, o.onQuit) }] : []),
      ...(o.items || []),
    ],
    onSelect: o.onSelect,
    onCancel: resume,
  };
}

/**
 * Settings menu. options: { settings, title = 'Settings', onClose, reset = true }
 *   Shows every setting, "Reset to defaults" and "Back". Changes are saved by
 *   the settings object straight away.
 */
export function settingsOptions(ui, o = {}) {
  const { settings } = o;
  if (!settings || typeof settings.items !== 'function') {
    throw new Error('ui.showSettings: needs a settings object. Pass { settings } here or to createUi');
  }
  const close = () => { ui.back(); if (typeof o.onClose === 'function') o.onClose(); };
  const extra = [];
  if (o.reset !== false) {
    extra.push({
      id: 'reset', label: 'Reset to defaults', icon: 'restart',
      onSelect: () => {
        settings.reset();
        const menu = ui.current();
        for (const item of settings.items()) menu.setValue(item.id, item.value);
      },
    });
  }
  extra.push({ id: 'back', label: 'Back', icon: 'back', onSelect: close });
  for (const item of settings.items()) {
    if (item.id === 'reset' || item.id === 'back') {
      throw new Error(`ui.showSettings: a setting cannot use the id "${item.id}"`);
    }
  }
  return {
    id: 'settings', title: o.title ?? 'Settings',
    items: [...settings.items(), ...extra],
    onChange: (id, value) => settings.set(id, value),
    onCancel: close,
  };
}

/**
 * Message / confirm box. options: { title, text, buttons, onSelect(id), id = 'message' }
 *   buttons default to [{ id: 'ok', label: 'OK' }]. Picking a button closes the
 *   box, then calls onSelect(id). Cancel picks the button with id 'cancel' or 'no', if any.
 */
export function messageOptions(ui, o = {}) {
  if (!o.title && !o.text) throw new Error('ui.showMessage: give a "title" or "text"');
  const buttons = o.buttons ?? [{ id: 'ok', label: 'OK' }];
  const pick = (id) => { ui.back(); if (typeof o.onSelect === 'function') o.onSelect(id); };
  const escape = buttons.find((b) => b.id === 'cancel' || b.id === 'no');
  return {
    id: o.id ?? 'message', title: o.title, text: o.text,
    items: buttons.map((b) => ({ ...b, onSelect: () => pick(b.id) })),
    focus: o.focus,
    onCancel: escape ? () => pick(escape.id) : undefined,
  };
}

/**
 * Results screen (level complete / game over).
 * options: { title = 'Level complete', subtitle, rows, onNext, onRetry, onQuit, nextLabel, items }
 *   rows: [{ label: 'Score', value: 1200 }, ...] shown as text lines.
 *   Buttons: Next (if onNext), Retry (if onRetry), Quit to title (if onQuit), then extra items.
 */
export function resultsOptions(ui, o = {}) {
  const buttons = [
    ...(o.onNext ? [{ id: 'next', label: o.nextLabel ?? 'Next', icon: 'play', onSelect: closing(ui, o.onNext) }] : []),
    ...(o.onRetry ? [{ id: 'retry', label: 'Retry', icon: 'restart', onSelect: closing(ui, o.onRetry) }] : []),
    ...(o.onQuit ? [{ id: 'quit', label: 'Quit to title', icon: 'home', onSelect: closing(ui, o.onQuit) }] : []),
    ...(o.items || []),
  ];
  if (buttons.length === 0) throw new Error('ui.showResults: give at least one of onNext, onRetry, onQuit or items');
  return {
    id: o.id ?? 'results', title: o.title ?? 'Level complete', subtitle: o.subtitle,
    items: [
      ...(o.rows || []).map((r, i) => ({ type: 'text', id: `row-${i}`, label: String(r.label), value: r.value })),
      ...buttons,
    ],
    onSelect: o.onSelect,
  };
}
