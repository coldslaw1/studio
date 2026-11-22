// The demo's menus, built with the ui kit: title, pause, save and load slots, controls, quest log.
import { formatTime } from '../vendor/ui/index.js';
import { CONTROLS } from './actions.js';

const SLOTS = [1, 2, 3];
const slotName = (n) => (n === 1 ? 'Autosave' : `Slot ${n}`);

/**
 * @param {object} game    core's game.
 * @param {object} shared  { ui, sound, hamlet, quest, bot, net, stage }.
 * @returns {object} menus
 */
export function createMenus(game, shared) {
  const { ui } = shared;
  const { saves } = game;
  const click = () => shared.sound.play('select', { volume: 0.5 });

  function describe(slot) {
    const info = saves.info(slot);
    if (info.empty) return `${slotName(slot)}: empty`;
    const data = saves.load(slot);
    const when = info.savedAt ? new Date(info.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `${slotName(slot)}: ${data ? (data.mode === 'world' ? 'open world, ' : 'hamlet quest, ') + formatTime(data.seconds ?? 0) : 'unreadable'}${when ? ', ' + when : ''}`;
  }
  /** The slot saved most recently, or 0 when every slot is empty. */
  function latestSlot() {
    let best = 0; let bestAt = -1;
    for (const info of saves.list()) if (!info.empty && saves.load(info.slot) && (info.savedAt ?? 0) > bestAt) { best = info.slot; bestAt = info.savedAt ?? 0; }
    return best;
  }
  /** Write the game to a slot and say so. */
  function saveTo(slot, quiet = false) {
    if (shared.mode === 'world' && !shared.world) return false;
    const ok = saves.save(slot, shared.mode === 'world' ? shared.worldScene.save() : shared.hamlet.save());
    if (!quiet) ui.toast(ok ? `Saved to ${slotName(slot).toLowerCase()}` : 'The browser refused to save');
    return ok;
  }
  /** Continue from a slot. Returns false when it is empty or broken. */
  function loadFrom(slot) {
    const data = saves.load(slot);
    if (!data) { ui.toast(`${slotName(slot)} is empty`); return false; }
    ui.closeAll();
    game.scenes.go(data.mode === 'world' ? 'world' : 'play', { saved: data });
    return true;
  }

  function openSlots(mode) {
    click();
    ui.open({
      id: mode, title: mode === 'save' ? 'Save game' : 'Load game',
      footer: saves.persistent ? '' : 'This browser will forget saves when the page closes',
      items: [
        ...SLOTS.filter((n) => mode === 'load' || n !== 1).map((n) => ({ id: 'slot' + n, label: describe(n), disabled: mode === 'load' && saves.info(n).empty, onSelect: () => { if (mode === 'save') { saveTo(n); ui.back(); } else loadFrom(n); } })),
        { id: 'back', label: 'Back', icon: 'back', onSelect: () => ui.back() },
      ],
      onCancel: () => ui.back(),
    });
  }

  function openControls() {
    click();
    ui.open({
      id: 'controls', title: 'Controls',
      items: [
        ...CONTROLS.map(([keys, what]) => ({ type: 'text', label: keys, value: what })),
        { id: 'back', label: 'Back', icon: 'back', onSelect: () => ui.back() },
      ],
      onCancel: () => ui.back(),
    });
  }

  function openLog() {
    click();
    const story = shared.quest.story;
    const lines = [];
    for (const quest of story.quests()) {
      if (quest.status === 'inactive') continue;
      lines.push({ type: 'text', label: quest.title, value: quest.status === 'done' ? 'done' : '' });
      for (const o of quest.objectives) lines.push({ type: 'text', label: `  ${o.done ? '[x]' : '[ ]'} ${o.text}`, value: o.target > 1 ? `${Math.min(o.count, o.target)}/${o.target}` : '' });
    }
    if (!lines.length) lines.push({ type: 'text', label: 'No quests yet. Talk to the guard on the path.', value: '' });
    ui.open({
      id: 'log', title: 'Quest log', subtitle: `${shared.sheet.line()}, ${story.getVar('coins')} coins, ${story.getVar('stones')} stones`,
      items: [...lines, { id: 'back', label: 'Back', icon: 'back', onSelect: () => ui.back() }],
      onCancel: () => ui.back(),
    });
  }

  function openTitle() {
    const latest = latestSlot();
    ui.closeAll();
    ui.open({
      id: 'title', variant: 'title', backdrop: 'dim',
      title: 'Kiln Hamlet', subtitle: 'One small game, every studio engine',
      footer: 'Arrows and Enter, mouse, touch or gamepad',
      focus: latest ? 'continue' : 'play',
      items: [
        ...(latest ? [{ id: 'continue', label: 'Continue', icon: 'play', onSelect: () => loadFrom(latest) }] : []),
        { id: 'play', label: 'New game: open world', icon: latest ? undefined : 'play', onSelect: () => { ui.closeAll(); game.scenes.go('world', {}); } },
        { id: 'hamlet', label: 'Hamlet quest', onSelect: () => { ui.closeAll(); game.scenes.go('play', { intro: true }); } },
        { id: 'watch', label: 'Watch auto-play', icon: 'star', onSelect: () => { ui.closeAll(); game.scenes.go('play', { bot: true }); } },
        ...(latest ? [{ id: 'load', label: 'Load game', onSelect: () => openSlots('load') }] : []),
        { id: 'settings', label: 'Settings', icon: 'gear', onSelect: () => { click(); ui.showSettings({}); } },
        { id: 'controls', label: 'Controls', onSelect: openControls },
        shared.credits.creditsItem(),
      ],
    });
  }

  function openPause() {
    shared.sound.play('select', { volume: 0.5 });
    const net = shared.net;
    ui.open({
      id: 'pause', title: 'Paused',
      items: [
        { id: 'resume', label: 'Resume', icon: 'play', onSelect: () => ui.closeAll() },
        { id: 'save', label: 'Save game', onSelect: () => openSlots('save') },
        { id: 'load', label: 'Load game', onSelect: () => openSlots('load') },
        { id: 'log', label: 'Quest log', onSelect: openLog },
        { id: 'bag', label: 'Bag', onSelect: () => { ui.closeAll(); shared.items.view.open({ title: 'Bag' }); } },
        { id: 'bot', label: shared.bot.on ? 'Stop auto-play' : 'Auto-play', icon: 'star', onSelect: () => { ui.closeAll(); shared.bot.toggle(); } },
        ...(shared.mode === 'hamlet' ? [{ id: 'net', label: net.on ? 'Leave multiplayer' : 'Multiplayer', onSelect: () => { ui.closeAll(); net.toggle(); } }] : []),
        shared.mode === 'world'
          ? { id: 'hamlet', label: 'Go to the hamlet quest', onSelect: () => { saveTo(1, true); ui.closeAll(); game.scenes.go('play', {}); } }
          : { id: 'world', label: 'Go to the open world', onSelect: () => { saveTo(1, true); ui.closeAll(); game.scenes.go('world', {}); } },
        { id: 'settings', label: 'Settings', icon: 'gear', onSelect: () => { click(); ui.showSettings({}); } },
        { id: 'controls', label: 'Controls', onSelect: openControls },
        shared.credits.creditsItem(),
        { id: 'quit', label: 'Quit to title', icon: 'home', danger: true, onSelect: () => { saveTo(1, true); ui.closeAll(); game.scenes.go('title'); } },
      ],
      onCancel: () => ui.closeAll(),
    });
  }

  return { openTitle, openPause, openSlots, openControls, openLog, saveTo, loadFrom, latestSlot };
}
