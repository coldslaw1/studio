// createGame: one call that wires canvas + loop + input + scenes + saves.
// This is the only core file that touches the browser.
import { createLoop } from './loop.js';
import { createInput, attachInput, pollGamepad } from './input.js';
import { createScenes } from './scenes.js';
import { createSaves } from './saves.js';

/**
 * fitRect(width, height, boxWidth, boxHeight) -> { scale, x, y, width, height }
 * Largest rectangle with the game's aspect ratio that fits the box, centered.
 */
export function fitRect(width, height, boxWidth, boxHeight) {
  const scale = Math.max(0, Math.min(boxWidth / width, boxHeight / height));
  const w = width * scale;
  const h = height * scale;
  return { scale, x: (boxWidth - w) / 2, y: (boxHeight - h) / 2, width: w, height: h };
}

/**
 * createGame(options) -> game
 * options:
 *   canvas      required. The <canvas> element.
 *   gameId      required. Short unique id, used for save keys.
 *   width, height   logical size in pixels. Default 640 x 360. Scenes always draw
 *               in these coordinates; the canvas is scaled to fit the window.
 *   scenes      { name: sceneOrFactory }. Factory: (game) => scene.
 *   start       name of the first scene. Default: the first key of `scenes`.
 *   actions     input bindings. Default DEFAULT_ACTIONS.
 *   background  CSS color cleared before each draw. Default '#000'. null = do not clear.
 *   slots, saveVersion, migrate   passed to createSaves.
 *   state       () => object shown as window.game.state for play-tests.
 *               Default: the top scene's `state` property.
 *   autoStart   default true. false = call game.start() yourself.
 *   window      default globalThis.window (tests pass a fake).
 * game: { canvas, ctx, width, height, input, scenes, saves, loop, start(), stop(), resize() }
 */
export function createGame(options = {}) {
  const win = options.window || globalThis.window;
  const { canvas, gameId, width = 640, height = 360, background = '#000' } = options;
  if (!canvas || typeof canvas.getContext !== 'function') throw new Error('createGame: options.canvas must be a <canvas> element');
  if (!(width > 0) || !(height > 0)) throw new Error(`createGame: width and height must be > 0, got ${width} x ${height}`);
  const sceneDefs = options.scenes || {};
  const names = Object.keys(sceneDefs);
  if (names.length === 0) throw new Error('createGame: options.scenes needs at least one scene');
  const startName = options.start || names[0];
  if (!names.includes(startName)) throw new Error(`createGame: start scene "${startName}" is not in options.scenes`);

  const ctx = canvas.getContext('2d');
  const input = createInput({ actions: options.actions });
  const saves = createSaves({
    gameId,
    slots: options.slots,
    version: options.saveVersion,
    migrate: options.migrate,
    storage: options.storage,
  });
  const game = { canvas, ctx, width, height, input, saves, scenes: null, loop: null, pixelScale: 1 };
  const scenes = createScenes(game);
  game.scenes = scenes;
  for (const name of names) scenes.add(name, sceneDefs[name]);

  let rect = { scale: 1, x: 0, y: 0, width, height };
  game.resize = () => {
    rect = fitRect(width, height, win.innerWidth, win.innerHeight);
    const dpr = Math.min(win.devicePixelRatio || 1, 3);
    game.pixelScale = Math.max(rect.scale * dpr, 0.01);
    canvas.width = Math.max(1, Math.round(width * game.pixelScale));
    canvas.height = Math.max(1, Math.round(height * game.pixelScale));
    if (canvas.style) {
      canvas.style.position = 'absolute';
      canvas.style.left = `${rect.x}px`;
      canvas.style.top = `${rect.y}px`;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
  };

  const detach = attachInput(input, {
    target: win,
    canvas,
    toLogical(cx, cy) {
      const r = canvas.getBoundingClientRect();
      return { x: ((cx - r.left) * width) / (r.width || 1), y: ((cy - r.top) * height) / (r.height || 1) };
    },
  });

  const loop = createLoop({
    step: options.step,
    raf: options.raf || ((fn) => win.requestAnimationFrame(fn)),
    cancelRaf: options.cancelRaf || ((id) => win.cancelAnimationFrame(id)),
    update(dt) {
      scenes.update(dt);
      input.endUpdate();
    },
    draw() {
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      if (background !== null) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
      }
      scenes.draw(ctx);
    },
  });
  // Read the gamepad once per frame, before that frame's updates.
  const tick = loop.tick;
  loop.tick = (seconds) => {
    const nav = win.navigator;
    if (nav && typeof nav.getGamepads === 'function') pollGamepad(input, nav.getGamepads());
    tick(seconds);
  };
  game.loop = loop;

  game.start = () => {
    if (scenes.depth === 0) scenes.go(startName);
    loop.start();
  };
  game.stop = () => loop.stop();
  game.destroy = () => { loop.stop(); detach(); win.removeEventListener('resize', game.resize); };

  win.addEventListener('resize', game.resize);
  game.resize();

  // Play-test hook (anvil-playtest reads window.game.state).
  win.game = {
    get state() { return options.state ? options.state() : (scenes.top?.state ?? null); },
    get scene() { return scenes.current; },
    core: game,
  };

  if (options.autoStart !== false) game.start();
  return game;
}
