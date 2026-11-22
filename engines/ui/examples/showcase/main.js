// Showcase for the UI kit: every widget on one page, in any theme.
//   index.html?theme=crypt&screen=inventory
//   index.html?genre=scifi&screen=pause                 a skin for a kind of game
//   index.html?genre=rpg&palette=tide&screen=title      the same, in a game's own colours
// Screens: title, play, pause, settings, inventory, dialogue, saves, message.
// Keys while playing: P pause, I inventory, T talk, K saves, 1-4 toasts, H theme.
import {
  createUi, createSettings, STANDARD_SETTINGS, ACCESS_SETTINGS, THEMES, loadFonts, createIconSet,
} from '../../src/index.js';
import { GAME_ICONS } from '../../src/game-icons.js';

// The kit's own fonts (system fonts show until they arrive) and the game-icons.net set. ?plain=1 shows the kit without either.
const plain = new URLSearchParams(location.search).has('plain');
const gameIcons = createIconSet(GAME_ICONS);
const pick = (name, builtIn) => (plain ? builtIn : gameIcons.get(name));
if (!plain) await loadFonts({ baseUrl: new URL('../../src/fonts/', import.meta.url).href });
import { createMiniInput } from '../demo/mini-input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const input = createMiniInput(window, canvas);
const query = new URLSearchParams(location.search);
const themes = Object.keys(THEMES);

// Two made-up games' palettes, with the role names Kiln palettes use.
const PALETTES = {
  tide: { ink: '#0b1d2a', night: '#12384d', white: '#e8f6f3', gold: '#ffc15e', red: '#ff6b6b', leaf: '#4fd1a5', stone: '#5f7f8f' },
  orchard: { ink: '#3b2a1e', cream: '#f8e9c8', white: '#fffaf0', brick: '#c2532d', red: '#c0392b', leaf: '#5a8f3c', leafDark: '#2f5d2a', gold: '#e2a52c' },
};
const genre = query.get('genre');
const skin = genre || query.get('palette')
  ? { genre: genre || undefined, style: query.get('style') || undefined, palette: PALETTES[query.get('palette')], dark: query.has('dark') ? query.get('dark') === '1' : undefined }
  : null;

const settings = createSettings({
  schema: [
    ...STANDARD_SETTINGS, ...ACCESS_SETTINGS,
    ...(skin ? [] : [{ id: 'theme', label: 'Theme', type: 'choice', value: query.get('theme') || 'storybook', options: themes }]),
    { id: 'key:jump', label: 'Jump', type: 'key', value: ['Space'], hint: 'Press Enter, then the new key. Esc keeps the old one.' },
    { id: 'key:use', label: 'Use', type: 'key', value: ['KeyE'] },
  ],
});
const ui = createUi({
  width: 1, height: 1, settings, sizing: 'auto', hints: true, displayScale: 1,
  coarse: query.has('touch') ? true : undefined,
  skin: skin || undefined,
  // What this game has. The title and pause screens add Continue, Load and Save from it.
  game: {
    get saves() { return saves; },
    saveData: () => ({ level: 4, coins: 200 }),
    onLoad: (slot, data) => ui.toast({ text: `Loaded level ${data.level}`, kind: 'good' }),
    slotName: (n) => (n === 1 ? 'Autosave' : `Slot ${n}`),
    describe: (d) => `Level ${d.level}, ${d.coins} coins`,
    skipSave: [1],
  },
});

// A stand-in for core's game.saves, kept in memory.
const slots = { 1: { savedAt: Date.UTC(2026, 10, 20, 18, 5), data: { level: 3, coins: 120 } }, 2: null, 3: { savedAt: Date.UTC(2026, 10, 21, 9, 40), data: { level: 5, coins: 342 } } };
const saves = {
  list: () => [1, 2, 3].map((slot) => ({ slot, empty: !slots[slot], savedAt: slots[slot] ? slots[slot].savedAt : null })),
  load: (slot) => (slots[slot] ? slots[slot].data : null),
  save: (slot, data) => { slots[slot] = { savedAt: Date.now(), data }; return true; },
  erase: (slot) => { slots[slot] = null; },
};

const RARITY = { common: '#9aa5a8', rare: '#5ab0ff', epic: '#b07cf0', gold: '#f4c542' };
const bag = [
  { id: 'slot-0', label: 'Iron sword', icon: pick('broadsword', 'sword'), color: RARITY.rare, hint: 'Attack +4. A plain, honest blade.' },
  { id: 'slot-1', label: 'Round shield', icon: pick('round-shield', 'shield'), color: RARITY.common, hint: 'Defence +2.' },
  { id: 'slot-2', label: 'Red potion', icon: pick('health-potion', 'potion'), count: 3, color: RARITY.common, iconColor: '#e5604d', hint: 'Restores 5 health.' },
  { id: 'slot-3', label: 'Cellar key', icon: pick('key', 'key'), color: RARITY.gold, iconColor: '#f4c542', hint: 'Opens the cellar under the mill.' },
  { id: 'slot-4', label: 'Old map', icon: pick('treasure-map', 'map'), color: RARITY.epic, hint: 'Someone marked a cross near the pond.' },
  { id: 'slot-5', label: 'Coins', icon: pick('two-coins', 'coin'), count: 42, iconColor: '#f4c542', hint: 'Shops take these.' },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `slot-${i + 6}`, empty: true, label: '' })),
];

const state = { time: 0, hp: 7, x: 0.5 };
const face = (c, r) => { c.fillStyle = ui.theme.accent; c.beginPath(); c.arc(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.34, 0, 7); c.fill(); };

const screens = {
  title: () => ui.showTitle({ title: 'Lantern Vale', subtitle: 'The studio UI kit', onPlay: () => screens.play() }),
  play: () => ui.closeAll(),
  pause: () => ui.showPause({ onRestart: () => {}, onQuit: () => screens.title() }),
  settings: () => ui.showSettings({}),
  inventory: () => ui.open({
    id: 'inventory', title: 'Inventory', subtitle: '42 coins   Weight 12 / 30', wide: false, focus: 'slot-2',
    items: [
      { id: 'bag', type: 'grid', columns: 5, cells: bag },
      { id: 'sort', label: 'Sort', icon: 'restart' },
      { id: 'close', label: 'Close', icon: 'close', onSelect: () => ui.back() },
    ],
    onSelect: (id, cell) => { if (cell.hint) ui.toast({ text: `Used ${cell.label}`, kind: 'good' }); },
    onCancel: () => ui.back(),
  }),
  dialogue: () => ui.showDialogue([
    { speaker: 'Guard', text: 'Halt. Nobody goes down to the cellar after dark, not since the lanterns started going out by themselves.' },
    { speaker: 'Guard', text: 'Unless you are the one the miller sent for?', choices: ['The miller sent me.', 'What is in the cellar?', 'Never mind.'] },
    { speaker: 'Guard', text: 'Then take this key, and mind the third step.' },
  ], { portrait: face, onDone: () => ui.toast({ text: 'Quest started: The cellar', kind: 'info', icon: 'star' }) }),
  saves: (mode = 'load') => ui.showSaves({
    saves, mode, data: () => ({ level: 4, coins: 200 }), slotName: (n) => (n === 1 ? 'Autosave' : `Slot ${n}`),
    describe: (d) => `Level ${d.level}, ${d.coins} coins`, onLoad: () => ui.toast('Loaded'),
  }),
  message: () => ui.showMessage({
    title: 'Quit to title?', text: 'Progress since the last save will be lost.',
    buttons: [{ id: 'yes', label: 'Quit', danger: true }, { id: 'no', label: 'Stay' }], focus: 'no',
  }),
};

function buildHud() {
  ui.hud
    .add({ id: 'hp', type: 'bar', label: 'HP', value: state.hp, max: 10, showValue: true, segments: 10, hint: 'Health. Potions restore 5.' })
    .add({ id: 'mana', type: 'bar', label: 'MP', value: 6, max: 8, color: '#5ab0ff', width: 5.5 })
    .add({ id: 'coins', type: 'counter', icon: 'coin', value: 42 })
    .add({ id: 'time', type: 'timer', value: 0, anchor: 'top-center' })
    .add({ id: 'map', type: 'minimap', anchor: 'top-right', value: { center: { x: 0, y: 0 }, range: 100, heading: 0, points: [] } })
    .add({ id: 'pause', type: 'button', icon: 'pause', anchor: 'top-right', onPress: screens.pause })
    .add({ id: 'bar', type: 'hotbar', anchor: 'bottom-center', value: 0, onPress: (i) => ui.hud.set('bar', i),
      slots: [{ icon: pick('broadsword', 'sword'), key: '1' }, { icon: pick('health-potion', 'potion'), count: 3, key: '2', cooldown: 0.4 }, { icon: pick('key', 'key'), key: '3' }, null] })
    .add({ id: 'talk', type: 'prompt', value: 'Talk', key: 'T', keys: { gamepad: 'A' }, anchor: 'bottom-center', onPress: screens.dialogue });
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ui.resize(canvas.width, canvas.height);
}

function update(dt) {
  if (ui.update(dt, input)) return;
  if (input.pressed('pause')) { screens.pause(); return; }
  state.time += dt;
  state.x = (state.x + (input.down('right') ? dt : 0) - (input.down('left') ? dt : 0) + 1) % 1;
  ui.hud.set('time', state.time);
  ui.hud.set('map', {
    center: { x: 0, y: 0 }, range: 100, heading: state.time * 0.4,
    points: [{ x: 40, y: -30, kind: 'goal', pin: true }, { x: -55, y: 20, kind: 'enemy' }, { x: 20, y: 60, kind: 'friend' }, { x: -300, y: -200, kind: 'item', pin: true }],
  });
}

function draw() {
  const t = ui.theme;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, w, h);
  // A plain stand-in for a game scene, in the theme's colours.
  ctx.fillStyle = t.row;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  ctx.fillStyle = t.panel;
  for (let i = 0; i < 7; i++) ctx.fillRect(((i / 7 + state.x * 0.2) % 1) * w, h * 0.62 - (60 + (i % 3) * 50), 46, 60 + (i % 3) * 50);
  ctx.fillStyle = t.good;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.62 - 22, 22, 0, Math.PI * 2);
  ctx.fill();
  ui.draw(ctx);
}

window.addEventListener('keydown', (e) => {
  if (ui.isOpen() || ui.dialogue) return;
  if (e.key === 'i') screens.inventory();
  if (e.key === 't') screens.dialogue();
  if (e.key === 'k') screens.saves();
  if (e.key === 'h' && !skin) settings.set('theme', themes[(themes.indexOf(settings.get('theme')) + 1) % themes.length]);
  if (e.key === '1') ui.toast('Checkpoint');
  if (e.key === '2') ui.toast({ text: 'Saved', kind: 'good' });
  if (e.key === '3') ui.toast({ text: 'Low health', kind: 'warn' });
  if (e.key === '4') { ui.toast({ text: 'No room in the bag', kind: 'danger' }); state.hp = Math.max(1, state.hp - 2); ui.hud.set('hp', state.hp); }
});

let last = null;
function frame(now) {
  const dt = last === null ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  update(dt);
  input.endFrame();
  draw();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
buildHud();
(screens[query.get('screen')] || screens.title)();
requestAnimationFrame(frame);

// Play-test and screenshot hook.
window.game = { get state() { return state; }, ui, settings, screens };
