// Smallest working use in a browser, without the core kit. With core, call
// box.update(dt, input) from scene.update and box.draw(ctx, rect) from scene.draw.
import { createStory, createDialogueBox } from '../src/index.js';

const data = await (await fetch('./gullrock.json')).json();
const story = createStory(data);
const box = createDialogueBox(story);
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const toasts = [];
story.on('questStarted', (e) => toasts.push(`Quest started: ${story.quest(e.quest).title}`));
story.on('questDone', (e) => toasts.push(`Quest done: ${story.quest(e.quest).title}`));
story.on('event', (e) => toasts.push(`Game event: ${e.name}`));

// Tiny stand-in for core's input object.
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'confirm', ' ': 'confirm' };
const pressed = new Set();
const pointer = { x: -1, y: -1, pressed: false };
const input = { pressed: (name) => pressed.has(name), pointer };
addEventListener('keydown', (e) => {
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code); // core binds these for you: choice1..choice9
  if (digit) pressed.add(`choice${digit[1]}`);
  if (KEYS[e.key]) { pressed.add(KEYS[e.key]); e.preventDefault(); }
  if (!story.view().active && e.key === 'k') story.start('keeper');
  if (!story.view().active && e.key === 'm') story.start('merchant');
});
const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  pointer.x = (e.clientX - r.left) * (canvas.width / r.width);
  pointer.y = (e.clientY - r.top) * (canvas.height / r.height);
};
canvas.addEventListener('pointermove', toCanvas);
canvas.addEventListener('pointerdown', (e) => { toCanvas(e); pointer.pressed = true; });

window.game = { get state() { return { view: story.view(), quests: story.quests(), coins: story.getVar('coins') }; } };

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  box.update(dt, input);
  pressed.clear();
  pointer.pressed = false;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#c9d4ea';
  ctx.font = '16px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`${data.title}    Coins: ${story.getVar('coins')}`, 16, 14);
  let y = 44;
  for (const quest of story.quests().filter((q) => q.status !== 'inactive')) {
    ctx.fillStyle = '#ffd27a';
    ctx.fillText(`${quest.title} (${quest.status})`, 16, y);
    y += 22;
    for (const o of quest.objectives) {
      ctx.fillStyle = o.done ? '#7fd69b' : '#c9d4ea';
      ctx.fillText(`${o.done ? '[x]' : '[ ]'} ${o.text}${o.optional ? ' (optional)' : ''}`, 28, y);
      y += 20;
    }
  }
  ctx.fillStyle = '#8fa3c7';
  toasts.slice(-3).forEach((toast, i) => ctx.fillText(toast, 380, 44 + i * 20));
  box.draw(ctx, { x: 16, y: 200, width: 608, height: 148 });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
