// Browser demo of the clock: smooth drawing between ticks, stalls, hit-stop, slow motion,
// pause and heavy work sliced across frames. Play-tests read window.game.state.
import { createClock, createTasks, lerp } from '../../src/index.js';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const out = document.getElementById('stats');
const W = canvas.width; const H = canvas.height;

const ball = { x: 40, prevX: 40, vx: 260 }; // pixels and pixels per second
const tasks = createTasks({ budgetMs: 4 });
let lastJob = 'none yet';

/** Keeps the page busy for `ms`, as a bake or a page swap does. */
function burn(ms) { const end = performance.now() + ms; while (performance.now() < end) { /* busy */ } }

const clock = createClock({
  update(dt) {
    ball.prevX = ball.x;
    ball.x += ball.vx * dt;
    if (ball.x > W - 40 || ball.x < 40) { // bounced off a wall: a short hit-stop, as a sword hit would ask for
      ball.x = Math.max(40, Math.min(W - 40, ball.x)); ball.vx = -ball.vx; ball.prevX = ball.x;
      clock.hitStop(0.07);
    }
  },
  draw(alpha) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#7fd1ff';
    ctx.beginPath(); ctx.arc(lerp(ball.prevX, ball.x, alpha), 60, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffb36b';
    ctx.beginPath(); ctx.arc(ball.x, 140, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#cfd8ea'; ctx.font = '12px system-ui';
    ctx.fillText('blended with alpha', 8, 16); ctx.fillText('no blending', 8, 196);
    const s = clock.stats;
    out.textContent = `${s.summary()}\n` +
      `tick ${clock.ticks}, sim time ${clock.simTime.toFixed(2)} s, time scale ${clock.timeScale}, ${clock.paused ? 'PAUSED' : clock.frozen ? 'hit-stop' : 'running'}\n` +
      `lowest tick rate ${s.lowestTickRate}, frozen ticks ${s.frozenTicks}, background ${s.hiddenCount} times (${Math.round(s.hiddenMs)} ms)\n` +
      `last stalls: ${s.recentStalls.slice(-4).map((x) => `${Math.round(x.gapMs)} ms (${x.cause})`).join(', ') || 'none'}\n` +
      `tasks: ${tasks.pending} pending, worst step ${tasks.stats.worstStepMs.toFixed(1)} ms. Last heavy job: ${lastJob}`;
  },
  tasks,
});

const actions = {
  'Stall 100 ms': () => clock.measure('stall button', () => burn(100)),
  'Stall 1.5 s': () => clock.measure('stall button', () => burn(1500)),
  'Heavy job in one go (600 ms)': () => { clock.measure('heavy job', () => burn(600)); lastJob = 'one go: one 600 ms freeze'; },
  'Same job sliced': () => {
    lastJob = 'sliced: running';
    tasks.each(Array.from({ length: 300 }, (_, i) => i), () => burn(2), { label: 'heavy job', chunk: 1 }).done.then(() => { lastJob = 'sliced: done with no stall'; });
  },
  'Hit-stop 0.3 s': () => clock.hitStop(0.3),
  'Slow motion on/off': () => { clock.timeScale = clock.timeScale === 1 ? 0.25 : 1; },
  'Pause on/off': () => { clock.paused = !clock.paused; },
  'Reset stats': () => clock.stats.reset(),
};
for (const [label, fn] of Object.entries(actions)) {
  const b = document.createElement('button');
  b.textContent = label; b.onclick = fn;
  document.getElementById('buttons').append(b);
}

window.game = { get state() { return { ticks: clock.ticks, simTime: clock.simTime, alpha: clock.alpha, paused: clock.paused, frozen: clock.frozen, x: ball.x, stats: clock.stats, tasks: tasks.stats, pending: tasks.pending }; }, clock, tasks, actions };
clock.start();
