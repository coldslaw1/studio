// Demo game for the UI kit: move the dot onto the coins. Shows the title
// screen, HUD, pause menu, settings (with live theme switching), a confirm
// box, toasts and the results screen.
import { createUi, createSettings, STANDARD_SETTINGS, THEMES } from '../../src/index.js';
import { createMiniInput } from './mini-input.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const input = createMiniInput(window, canvas);

// A store with get/set. Core's saves.settings has the same shape.
const store = {
  get: (key) => JSON.parse(localStorage.getItem(`ui-demo:${key}`) || 'null'),
  set: (key, value) => localStorage.setItem(`ui-demo:${key}`, JSON.stringify(value)),
};

const settings = createSettings({
  store,
  schema: [
    ...STANDARD_SETTINGS,
    { id: 'theme', label: 'Theme', type: 'choice', value: 'midnight', options: Object.keys(THEMES) },
    { id: 'speed', label: 'Speed', type: 'choice', value: 'normal', options: ['slow', 'normal', 'fast'] },
  ],
});

// sizing 'auto': finger-sized rows on a phone, smaller ones with a mouse or keyboard.
// The canvas is as big as the window, so one canvas pixel is one CSS pixel.
const ui = createUi({ width: 1, height: 1, settings, sizing: 'auto', displayScale: 1, hints: true });
const GOAL = 5;
let state = { mode: 'title', x: 0, y: 0, coin: { x: 0, y: 0 }, score: 0, lives: 3, time: 0 };

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ui.resize(canvas.width, canvas.height);
}

function placeCoin() {
  const m = ui.unit * 4;
  state.coin = {
    x: m + Math.random() * (canvas.width - m * 2),
    y: m + Math.random() * (canvas.height - m * 2),
  };
}

function showTitle() {
  state.mode = 'title';
  ui.hud.clear();
  ui.showTitle({
    title: 'Coin Dot',
    subtitle: 'A demo of the studio UI kit',
    footer: 'Arrows or WASD, Enter, Esc. Or just tap.',
    onPlay: startGame,
  });
}

function startGame() {
  state = { mode: 'play', x: canvas.width / 2, y: canvas.height / 2, coin: { x: 0, y: 0 }, score: 0, lives: 3, time: 0 };
  placeCoin();
  ui.hud.clear();
  ui.hud
    .add({ id: 'score', type: 'counter', label: 'Coins', value: 0, icon: 'coin' })
    .add({ id: 'lives', type: 'pips', value: 3, max: 3 })
    .add({ id: 'energy', type: 'bar', value: 10, max: 10, label: 'Energy' })
    .add({ id: 'time', type: 'timer', value: 0, anchor: 'top-center' })
    .add({ id: 'pause', type: 'button', icon: 'pause', anchor: 'top-right', onPress: pause });
  ui.toast(`Collect ${GOAL} coins`);
}

function pause() {
  ui.showPause({
    onRestart: startGame,
    onQuit: () => ui.showMessage({
      title: 'Quit to title?',
      text: 'Your coins in this run will be lost.',
      buttons: [{ id: 'yes', label: 'Quit', danger: true }, { id: 'no', label: 'Keep playing' }],
      focus: 'no',
      onSelect: (id) => (id === 'yes' ? showTitle() : pause()),
    }),
  });
}

function update(dt) {
  // The UI goes first. While a menu is open the game stands still.
  if (ui.update(dt, input)) return;
  if (input.pressed('pause')) { pause(); return; }

  const speed = { slow: 6, normal: 10, fast: 16 }[settings.get('speed')] * ui.unit;
  let dx = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
  let dy = (input.down('down') ? 1 : 0) - (input.down('up') ? 1 : 0);
  // Touch: hold a finger down and the dot follows it. Taps on the HUD do not count.
  if (input.pointer.down && !ui.pointerUsed) {
    const px = input.pointer.x - state.x;
    const py = input.pointer.y - state.y;
    const len = Math.hypot(px, py);
    if (len > ui.unit * 0.3) { dx = px / len; dy = py / len; }
  }
  state.x = Math.min(canvas.width, Math.max(0, state.x + dx * speed * dt));
  state.y = Math.min(canvas.height, Math.max(0, state.y + dy * speed * dt));
  state.time += dt;
  ui.hud.set('time', state.time);
  ui.hud.set('energy', Math.max(0, 10 - (state.time % 10)));

  if (Math.hypot(state.x - state.coin.x, state.y - state.coin.y) < ui.unit * 1.2) {
    state.score += 1;
    ui.hud.set('score', state.score);
    placeCoin();
    if (state.score >= GOAL) {
      state.mode = 'won';
      ui.showResults({
        title: 'All coins!',
        rows: [{ label: 'Coins', value: state.score }, { label: 'Time', value: `${state.time.toFixed(1)} s` }],
        onRetry: startGame,
        onQuit: showTitle,
      });
    }
  }
}

function draw() {
  const t = ui.theme;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (state.mode !== 'title') {
    ctx.fillStyle = t.accent;
    ctx.beginPath();
    ctx.arc(state.coin.x, state.coin.y, ui.unit * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.good;
    ctx.beginPath();
    ctx.arc(state.x, state.y, ui.unit * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ui.draw(ctx); // always last, so the UI is on top
}

let last = null;
function frame(now) {
  // First frame has no previous time. Clamp so dt is never negative or huge.
  const dt = last === null ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  update(dt);
  input.endFrame();
  draw();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
showTitle();
requestAnimationFrame(frame);

// Play-test hook: specs can read game.state and game.ui.snapshot().
window.game = { get state() { return state; }, ui, settings };
