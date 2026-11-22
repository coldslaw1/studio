// The game's spine, on the base engine (studio-engines/base): one 42-tick loop, one input, one
// settings list, one save, and plugins. core's createGame scales a fixed-size canvas to the window;
// Kiln pictures are text cells that must not be stretched, so the canvas here is always one canvas
// pixel per screen pixel (or a whole multiple), exactly as before the port.
import * as core from '../vendor/core/index.js';
import * as clock from '../vendor/clock/index.js';
import { createBase } from '../vendor/base/index.js';

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {string} o.gameId            Prefix of the save keys.
 * @param {object} o.actions           Input bindings.
 * @param {object} o.scenes            { name: (game) => scene }.
 * @param {(w: number, h: number) => [number, number, number?]} o.fit  Given the room there is (screen
 *   pixels), returns the canvas size to use, and optionally how many screen pixels one canvas pixel takes.
 * @param {(w: number, h: number) => void} [o.onResize]  Called after the size changed.
 * @param {(dt: number) => void} [o.steady]  Called at the tick rate even while the game is paused or frozen (audio).
 * @param {object[]} [o.plugins]       Base plugins.
 * @param {number} [o.slots]           Save slots (default 3).
 * @param {() => object} [o.state]     What window.game.state shows.
 * @param {object} [o.window]          Default globalThis.window.
 * @returns {object} game: { base, canvas, ctx, width, height, input, scenes, saves, loop, tasks, pace, start(), stop(), resize(), destroy() }
 */
export function createFitGame(o) {
  const win = o.window ?? globalThis.window;
  const { canvas } = o;
  if (!canvas || typeof canvas.getContext !== 'function') throw new Error('createFitGame: options.canvas must be a <canvas> element');
  const base = createBase({
    gameId: o.gameId, core, clock, canvas, window: win, actions: o.actions, slots: o.slots ?? 3,
    plugins: o.plugins ?? [], mode: 'title', expose: false, style: o.style,
  });
  let width = canvas.width; let height = canvas.height; let ratio = 1;
  const game = {
    base, canvas, ctx: base.ctx, saves: base.slots, loop: base.loop, tasks: base.tasks, pace: base.pace, scenes: null,
    /** What the player presses. Scenes read the game layer: it reads as "nothing" under a menu, the bag, a dialogue or a cutscene. */
    input: base.input.raw,
    get width() { return width; }, get height() { return height; },
    /** Canvas pixels per CSS pixel (2 on a HiDPI screen): draw text and menus this much bigger. */
    get pixelRatio() { return ratio; },
    get alpha() { return base.alpha; }, get frameSeconds() { return base.frameSeconds; },
  };
  const scenes = game.scenes = core.createScenes(game);
  for (const name of Object.keys(o.scenes)) scenes.add(name, o.scenes[name]);

  game.resize = () => {
    const was = ratio;
    const device = win.devicePixelRatio || 1;
    // fit may also return a whole number to show each canvas pixel as that many screen pixels
    // (a picture of fixed size on a big or HiDPI screen); whole numbers keep text cells even
    const [w, h, zoom = 1] = o.fit(win.innerWidth * device, win.innerHeight * device);
    ratio = device / zoom;
    canvas.style.position = 'absolute';
    canvas.style.width = `${w / ratio}px`; canvas.style.height = `${h / ratio}px`;
    canvas.style.left = `${Math.max(0, (win.innerWidth - w / ratio) / 2)}px`; canvas.style.top = `${Math.max(0, (win.innerHeight - h / ratio) / 2)}px`;
    if (canvas.width !== w || canvas.height !== h) base.resize(w, h);
    if (w !== width || h !== height || was !== ratio) { width = w; height = h; o.onResize?.(w, h); }
  };
  // The scenes (title, play, world, cellar) are the game's own states. They run in the base's 'ui'
  // phase, which never stops, because they open and close their own menus; what must stand still
  // under a menu hooks into 'sim' through its plugin.
  base.on('ui', (dt) => scenes.update(dt), { order: 100, owner: 'scenes' });
  base.on('draw:world', (ctx, alpha) => scenes.draw(ctx, alpha), { owner: 'scenes' });
  if (o.steady) base.on('steady', (dt) => o.steady(dt), { owner: 'game' });
  game.start = (first) => { if (scenes.depth === 0) scenes.go(first ?? Object.keys(o.scenes)[0]); base.start(); };
  game.stop = () => base.stop();
  game.destroy = () => { base.stop(); win.removeEventListener('resize', game.resize); };
  win.addEventListener('resize', game.resize);
  // a key let go while the page is hidden never tells the page: let go of everything when it hides
  win.document?.addEventListener('visibilitychange', () => { if (win.document.hidden) base.input.raw.releaseAll?.(); });
  win.game = { // the play-test hook, as core's createGame makes it
    get state() { return o.state ? o.state() : (scenes.top?.state ?? null); },
    get scene() { return scenes.current; },
    core: game, base,
  };
  return game;
}
