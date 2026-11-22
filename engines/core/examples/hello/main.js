// Smallest complete game on the core kit: title -> play -> pause, with a save slot.
// In a real game the import path is './vendor/core/index.js'.
import { createGame, createRng } from '../../src/index.js';

const W = 640;
const H = 360;

function text(ctx, str, x, y, size = 20, color = '#e8ecff') {
  ctx.fillStyle = color;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(str, x, y);
}

// Title: shows the saved best score, waits for confirm.
const title = (game) => ({
  state: { best: game.saves.load(1)?.best ?? 0 },
  update() {
    if (game.input.pressed('confirm')) game.scenes.go('play');
  },
  draw(ctx) {
    text(ctx, 'Core kit demo', W / 2, 140, 36);
    text(ctx, 'Enter, tap or gamepad A to start', W / 2, 190);
    text(ctx, `Best: ${this.state.best}`, W / 2, 230, 16, '#9aa4d6');
  },
});

// Play: move the square onto the dot. All logic uses dt and the seeded rng.
const play = (game) => {
  const rng = createRng(7);
  const state = { x: W / 2, y: H / 2, score: 0, dot: { x: 100, y: 100 } };
  return {
    state,
    update(dt) {
      const { input } = game;
      if (input.pressed('pause')) return game.scenes.push('paused');
      const speed = 220;
      state.x += (input.axis('left', 'right') || input.stick.x) * speed * dt;
      state.y += (input.axis('up', 'down') || input.stick.y) * speed * dt;
      if (input.pointer.down) { // touch or mouse: glide toward the finger
        state.x += Math.sign(input.pointer.x - state.x) * Math.min(speed * dt, Math.abs(input.pointer.x - state.x));
        state.y += Math.sign(input.pointer.y - state.y) * Math.min(speed * dt, Math.abs(input.pointer.y - state.y));
      }
      state.x = Math.max(12, Math.min(W - 12, state.x));
      state.y = Math.max(12, Math.min(H - 12, state.y));
      if (Math.hypot(state.x - state.dot.x, state.y - state.dot.y) < 20) {
        state.score++;
        state.dot = { x: rng.int(20, W - 20), y: rng.int(40, H - 20) };
        const best = Math.max(state.score, game.saves.load(1)?.best ?? 0);
        game.saves.save(1, { best });
      }
    },
    draw(ctx) {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(state.dot.x, state.dot.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5bc0eb';
      ctx.fillRect(state.x - 12, state.y - 12, 24, 24);
      text(ctx, `Score ${state.score}   (P pauses)`, W / 2, 24, 16);
    },
  };
};

// Paused: pushed on top of play, which keeps drawing underneath but stops updating.
const paused = (game) => ({
  update() {
    if (game.input.pressed('pause') || game.input.pressed('confirm')) game.scenes.pop();
    if (game.input.pressed('cancel')) game.scenes.go('title');
  },
  draw(ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, W, H);
    text(ctx, 'Paused', W / 2, 170, 32);
    text(ctx, 'P or Enter resumes, Esc quits to title', W / 2, 210, 16);
  },
});

createGame({
  canvas: document.getElementById('game'),
  gameId: 'core-demo',
  width: W,
  height: H,
  background: '#0b1020',
  scenes: { title, play, paused },
});
