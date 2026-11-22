// createBase: the one runtime a studio game stands on. It owns the loop, the order of a tick,
// who gets the player's input, the hour of the day, the settings, the style, the views, the
// actors and the save, and it installs the engines as plugins. A game is a list of plugins plus
// its own content; no game writes wiring between engines.
import { createBus } from './bus.js';
import { createFocus, GAME_LAYER } from './focus.js';
import { createRouter } from './router.js';
import { createSettingsRegistry, SHARED_SETTINGS } from './settings.js';
import { createStyleRegistry } from './style.js';
import { createTime } from './time.js';
import { createSaveRegistry } from './saves.js';
import { createPhases, TICK_PHASES, PAUSABLE, DRAW_LAYERS, STEADY } from './phases.js';
import { createViews, DETAIL_LEVELS } from './views.js';
import { createActors } from './actors.js';
import { createEnv } from './env.js';
import { checkPlugin, sortPlugins } from './plugins.js';
import { createFixedLoop } from './loop.js';

const FPS = { low: 30, balanced: 72, full: 0 };

/**
 * createBase(options) -> base
 * options (all optional):
 *   gameId       prefix of saves. Default 'game'.
 *   plugins      [plugin, ...] installed in dependency order (see plugins.js)
 *   canvas       the <canvas>. Without one the base runs headless (Node tests, servers): nothing is drawn.
 *   core         the core engine's module (import * as core from './vendor/core/index.js'): the base makes the input
 *                (options.actions, default core's DEFAULT_ACTIONS) and the save slots (options.slots, default 3) from it
 *   clock        the clock engine's module: the base runs on its 42-tick clock (stall limits, hit-stop, tasks)
 *   input        instead of `core`: a ready core createInput(...) object. Without either nothing is ever pressed.
 *   saves        instead of `core`: a ready core createSaves(...) object: the settings store and the save slots.
 *   store        a { get, set } store for settings, when there is no `saves`.
 *   createLoop   the clock engine's createClock. Default: a small built-in fixed-step loop.
 *   hz           ticks per second. Default 42.
 *   style        starting style name. Default 'storybook'.   styles: extra styles { name: tokens }.
 *   mode         starting mode. Default 'play'. Modes are the game's big states ('title', 'play', ...).
 *   dayLength, startHour   the built-in day clock (the sky plugin replaces it)
 *   window, raf, cancelRaf browser pieces; tests pass fakes
 * base:
 *   bus          events: on(name, fn), emit(name, payload)            (bus.js)
 *   focus        who owns the input: push({ id }), pop(id), free      (focus.js)
 *   input        input.for(layerId), input.game                       (router.js)
 *   settings     declare, get, set, watch                             (settings.js)
 *   style        name, tokens, set(name), watch(fn)                   (style.js)
 *   time         hour, part, now, setHour, hold, run                  (time.js)
 *   views        add(name, view), set(name), next(), toScreen         (views.js)
 *   actors       add, remove, get, list, near                         (actors.js)
 *   env          shared facts one plugin owns and many read (weather, wind): provide, set, get, watch   (env.js)
 *   saves        register(name, part), collect, restore, saveSlot, loadSlot   (saves.js)
 *   on(phase, fn, { order, modes })   hook into a tick phase ('input', 'ui', 'sim', 'late', 'post', 'steady')
 *                                     or a draw layer ('draw:world', 'draw:actors', 'draw:effects', 'draw:overlay', 'draw:ui'). Tick hooks get
 *                                     (dt, base); draw hooks get (ctx, alpha, base).
 *   use(plugin)  install one more plugin now.   plugin(name) -> what its install returned.   has(name)
 *   openModal(id, options), closeModal(id)   shorthand for focus.push / focus.pop
 *   mode, setMode(name)                      'mode:changed' { mode, previous } on the bus
 *   start(), stop(), advance(n), drawNow()   run on screen frames; or n ticks by hand; or one picture by hand
 *   tick, dt, alpha, detail, width, height, canvas, ctx, loop, paused
 *   snapshot()   plain data for play-tests: { tick, mode, focus, view, style, hour, part, settings, plugins, actors }
 */
export function createBase(options = {}) {
  const win = options.window ?? globalThis.window ?? null;
  const canvas = options.canvas ?? null;
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  const hz = options.hz ?? 42;
  let tick = 0; let mode = options.mode ?? 'play'; let detail = DETAIL_LEVELS.medium; let started = false;
  const installed = new Map();
  const getTick = () => tick;

  // The two foundation engines are handed over as modules (import * as core from './vendor/core/index.js'),
  // because an engine never imports another engine. With them the base makes the input, the save slots and the clock itself.
  const core = options.core ?? null; const clockKit = options.clock ?? null;
  if (core && typeof core.createInput !== 'function') throw new Error("createBase: options.core must be the core engine's module (import * as core from './vendor/core/index.js')");
  if (clockKit && typeof clockKit.createClock !== 'function') throw new Error("createBase: options.clock must be the clock engine's module (import * as clock from './vendor/clock/index.js')");
  const rawInput = options.input ?? (core ? core.createInput({ actions: options.actions ?? core.DEFAULT_ACTIONS }) : undefined);
  const slotSaves = options.saves ?? (core ? core.createSaves({ gameId: options.gameId ?? 'game', slots: options.slots ?? 3, ...(options.storage ? { storage: options.storage } : {}) }) : null);

  const bus = createBus();
  const focus = createFocus({ bus, getTick });
  const input = createRouter({ input: rawInput, focus, getTick, bus });
  const store = options.store ?? slotSaves?.settings ?? null;
  const settings = createSettingsRegistry({ store, bus });
  const style = createStyleRegistry({ style: options.style, styles: options.styles, bus });
  const time = createTime({ bus, dayLength: options.dayLength, startHour: options.startHour });
  const saves = createSaveRegistry({ gameId: options.gameId ?? 'game', slots: slotSaves, bus });
  const phases = createPhases();
  const actors = createActors({ bus });
  const env = createEnv({ bus });
  let base = null;
  const views = createViews({ bus, focus, context: () => ({ detail, now: time.now, tokens: style.tokens, width: base?.width, height: base?.height }) });

  /** Frame pacing: maxFps (0 = every screen frame), cost (smoothed ms per picture), drawn and skipped counts. */
  const pace = { maxFps: FPS.balanced, lastDraw: null, cost: 0, drawn: 0, skipped: 0 };
  function update(dt) {
    base.dt = dt;
    phases.run('input', mode, dt, base);
    phases.run('ui', mode, dt, base);
    if (!focus.simPaused) {
      time.step(dt);
      phases.run('sim', mode, dt, base);
      const view = views.current;
      if (view) { view.setTime?.(time.now); view.update?.(dt, input.game); }
      phases.run('late', mode, dt, base);
    }
    phases.run('post', mode, dt, base);
    input.endTick();
    tick += 1;
  }
  function paint(alpha) {
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    views.current?.draw(ctx, alpha);
    for (const layer of DRAW_LAYERS) phases.run(layer, mode, ctx, alpha, base);
  }
  function draw(alpha) {
    base.alpha = alpha;
    if (!ctx) return;
    // A 144 or 240 Hz screen asks for a picture every 4 to 7 ms. A picture is drawn at most `maxFps` times a
    // second, and never so often that drawing takes more than about half of the time: a view that is slow to
    // draw is drawn less often and the game itself stays quick. The canvas keeps its picture between draws.
    const clockNow = win?.performance ? win.performance.now() : null;
    if (clockNow !== null) {
      const least = Math.max(pace.maxFps > 0 ? 1000 / pace.maxFps - 1.5 : 0, pace.cost * 2);
      if (pace.lastDraw !== null && clockNow - pace.lastDraw < least) { pace.skipped += 1; return; }
      base.frameSeconds = pace.lastDraw === null ? 0 : Math.max(0, Math.min(0.1, (clockNow - pace.lastDraw) / 1000));
      pace.lastDraw = clockNow;
    }
    paint(alpha);
    if (clockNow !== null) { pace.cost += (win.performance.now() - clockNow - pace.cost) * 0.1; pace.drawn += 1; }
  }
  const tasks = clockKit?.createTasks ? clockKit.createTasks({ budgetMs: options.taskBudgetMs ?? 4 }) : null;
  const makeLoop = options.createLoop ?? clockKit?.createClock ?? createFixedLoop;
  const loop = makeLoop({
    hz, update, draw,
    steady: (dt) => phases.run(STEADY, mode, dt, base),
    ...(options.raf ? { raf: options.raf } : win?.requestAnimationFrame ? { raf: (fn) => win.requestAnimationFrame(fn) } : {}),
    ...(options.cancelRaf ? { cancelRaf: options.cancelRaf } : win?.cancelAnimationFrame ? { cancelRaf: (id) => win.cancelAnimationFrame(id) } : {}),
    ...(tasks ? { tasks } : {}),
    ...(options.loopOptions ?? {}),
  });

  function install(plugin) {
    if (plugin.settings?.length) settings.declare(plugin.settings, plugin.name);
    if (plugin.actions) input.ensure(plugin.actions); // default keys for the plugin's actions; the game's own bindings win
    const api = plugin.install(base) ?? {};
    installed.set(plugin.name, api);
    if (typeof api.save === 'function' && typeof api.load === 'function' && !saves.parts().includes(plugin.name)) saves.register(plugin.name, { save: api.save, load: api.load, version: api.saveVersion ?? 1, migrate: api.migrate });
    bus.emit('plugin:installed', { name: plugin.name });
    return api;
  }

  base = {
    gameId: options.gameId ?? 'game', bus, focus, input, settings, style, time, views, actors, env, saves, loop, tasks, canvas, ctx, core,
    slots: slotSaves,
    dt: 1 / hz, alpha: 1, frameSeconds: 0, pace, // frameSeconds: time since the last drawn picture, for things eased per picture (cameras)
    get tick() { return tick; },
    get detail() { return detail; },
    get width() { return canvas?.width ?? options.width ?? 0; },
    get height() { return canvas?.height ?? options.height ?? 0; },
    get paused() { return focus.simPaused; },
    get mode() { return mode; },
    setMode(next) {
      if (typeof next !== 'string' || !next) throw new Error(`base.setMode: mode must be a non-empty string, got ${JSON.stringify(next)}`);
      if (next === mode) return;
      const previous = mode; mode = next;
      bus.emit('mode:changed', { mode, previous });
    },
    on(phase, fn, o) { return phases.add(phase, fn, o); },
    hooks: (phase) => phases.list(phase),
    use(plugin) {
      checkPlugin(plugin);
      if (installed.has(plugin.name)) throw new Error(`base.use: plugin '${plugin.name}' is already installed`);
      for (const need of plugin.requires ?? []) if (!installed.has(need)) throw new Error(`base.use: plugin '${plugin.name}' requires '${need}', which is not installed (installed: ${[...installed.keys()].join(', ') || 'none'})`);
      return install(plugin);
    },
    plugin(name) {
      if (!installed.has(name)) throw new Error(`base.plugin: no plugin '${name}' (installed: ${[...installed.keys()].join(', ') || 'none'})`);
      return installed.get(name);
    },
    has(name) { return installed.has(name); },
    plugins() { return [...installed.keys()]; },
    openModal(id, o = {}) { return focus.push({ id, ...o }); },
    closeModal(id) { return focus.pop(id); },
    start() {
      if (!started) { started = true; bus.emit('base:started', {}); }
      loop.start();
    },
    stop() { loop.stop(); },
    /** Run exactly n ticks without drawing (tests, bots, replays). */
    advance(n = 1) { loop.advance(n); },
    /** Paint one picture now, ignoring frame pacing (tests, screenshots). */
    drawNow(alpha = 1) { base.alpha = alpha; if (ctx) paint(alpha); },
    resize(width, height) {
      if (canvas) { canvas.width = width; canvas.height = height; }
      views.each((view) => view.resize?.(width, height));
      bus.emit('base:resized', { width, height });
    },
    snapshot() {
      return {
        tick, mode, paused: focus.simPaused, focus: focus.ids(), view: views.name, views: views.names(), style: style.name,
        hour: time.hour, part: time.part, detail, env: env.keys(), settings: settings.values(), plugins: [...installed.keys()],
        actors: actors.list().map((a) => ({ id: a.id, kind: a.kind, x: a.x, y: a.y, z: a.z, hidden: a.hidden })),
      };
    },
  };

  // the shared settings and what they mean for the base itself
  settings.declare(SHARED_SETTINGS.map((s) => ({ ...s })), 'base');
  settings.watch('detail', (name) => { detail = DETAIL_LEVELS[name] ?? DETAIL_LEVELS.medium; views.each((view) => view.setDetail?.(detail)); bus.emit('detail:changed', { detail, name }); });
  settings.watch('fps', (name) => { pace.maxFps = FPS[name] ?? FPS.balanced; });
  style.watch((tokens) => views.each((view) => view.setStyle?.(tokens)));
  bus.on('time:jump', () => views.each((view) => view.setTime?.(time.now)));
  saves.register('base', {
    save: () => ({ time: time.save(), view: views.name, mode, style: style.name }),
    load: (d) => { if (d.time) time.load(d.time); if (d.style && style.names().includes(d.style)) style.set(d.style); if (d.view && views.has(d.view)) views.set(d.view); if (d.mode) base.setMode(d.mode); },
  });

  for (const plugin of sortPlugins(options.plugins ?? [])) install(plugin);

  if (canvas && win && options.attach !== false && typeof canvas.addEventListener === 'function') {
    input.attach({ canvas, window: win });
    if (core && !options.input) {
      core.attachInput(rawInput, { target: win, canvas, toLogical(cx, cy) { const r = canvas.getBoundingClientRect(); return { x: ((cx - r.left) * canvas.width) / (r.width || 1), y: ((cy - r.top) * canvas.height) / (r.height || 1) }; } });
      base.on('input', () => { const nav = win.navigator; if (nav && typeof nav.getGamepads === 'function') core.pollGamepad(rawInput, nav.getGamepads()); }, { order: -1000, owner: 'base' });
    }
  }
  if (win && options.expose !== false) {
    // the play-test hook every studio game has (anvil-playtest reads window.game.state)
    win.game = { get state() { return { ...base.snapshot(), ...(options.state ? options.state(base) : {}) }; }, get scene() { return mode; }, base };
  }
  return base;
}

export { GAME_LAYER, TICK_PHASES, PAUSABLE, DRAW_LAYERS, STEADY };
