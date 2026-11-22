// The game on top of the stage (main.js). This file only wires the engines together:
//   core      the loop, input actions, scenes (title, play, cellar) and save slots (wired in fit-game.js)
//   ui        menus, HUD, toasts, settings            audio     steps, ambience, hits, music
//   dialogue  the guard, the elder, Tobin and quests  levels    the cellar rooms, proven solvable
//   physics   the ball, barrels and thrown stones     playbot   the auto-play bot (and Node play-tests)
//   net       optional two-player over Parley         inventory the bag, equipment on the puppet, loot
//   ai        the merchant and the farmer live their own day    sky   one clock for the time of day
//   combat    the training skeleton: blows, guard, health   clock   the 42-tick loop (fit-game.js)
//   world     the open world scene stands on world-stage.js (world engine + Kiln pages)
// collision, puppet and camera are already at work in the stage.
import { createRng } from '../vendor/core/index.js';
import { createFitGame } from './fit-game.js';
import { loadSceneOrbit } from '../../../src/scene-orbit-view.js';
import { createBakedLook, createBlendedOrbit, skyOptionsOfScene } from '../vendor/sky/index.js';
import { THEMES, controlsSchema, applyControls } from '../vendor/ui/index.js';
import { uiPlugin } from '../vendor/ui/plugin.js';
import { createDialogueBox } from '../vendor/dialogue/index.js';
import { ACTIONS } from './actions.js';
import { createSound } from './sound.js';
import { createCombatView } from './combat-view.js';
import { collisionPlugin } from '../vendor/collision/plugin.js';
import { combatPlugin } from '../vendor/combat/plugin.js';
import { statsPlugin } from '../vendor/stats/plugin.js';
import { navPlugin } from '../vendor/nav/plugin.js';
import { bindAudio, syncFighter } from '../vendor/combat/index.js';
import { HERO_HP } from './fight.js';
import { economyPlugin } from '../vendor/economy/plugin.js';
import { audioPlugin } from '../vendor/audio/plugin.js';
import { createQuest, stoneHit } from './model.js';
import { createHamlet } from './hamlet.js';
import { createMenus } from './menus.js';
import { createAutoplay } from './autoplay.js';
import { createNetplay } from './netplay.js';
import { titleScene, playScene } from './play.js';
import { cellarScene } from './cellar.js';
import { worldScene } from './world.js';
import { createItems } from './items.js';
import { createFight } from './fight.js';
import { createControls } from './controls.js';
import { createMinds } from './minds.js';
import { fxPlugin } from '../vendor/fx/plugin.js';
import { skyPlugin } from '../vendor/sky/plugin.js';
import { weatherPlugin } from '../vendor/weather/plugin.js';
import { eventsPlugin } from '../vendor/events/plugin.js';
import { EVENTS } from './events.js';
import { STORY, SIDE_QUEST } from './story.js';
import { procgenPlugin } from '../vendor/procgen/plugin.js';
import { createWeatherSound, isoAxes, KIND_NAMES } from '../vendor/weather/index.js';
import { generateAmbience, generateSound } from '../vendor/audio/index.js';
import { createWorldFight } from './world-fight.js';
import { createWorldWalk } from './world-walk.js';

/**
 * Start the showcase game on a stage.
 * @param {object} stage  What main.js built: canvas, width, height, player, npc, actors, world,
 *   collision, camera, sceneCamera, update(dt, intent), draw(), addCharacter(...).
 * @returns {object} core's game object, with the shared services on `game.shared`.
 */
/**
 * A slight CRT look over the canvas: faint scanlines, a soft vignette and a touch of glow. It is a
 * still overlay made with CSS (nothing is drawn per frame and nothing flickers), so it costs nothing
 * in the game loop and is safe with reduced motion.
 */
function createCrt(canvas) {
  const doc = canvas.ownerDocument;
  const layer = doc.createElement('div');
  layer.id = 'crt';
  layer.style.cssText = 'position:absolute;pointer-events:none;z-index:1;border-radius:10px;'
    + 'background:repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0, rgba(0,0,0,0) 2px, rgba(0,0,0,0.13) 3px, rgba(0,0,0,0) 4px),'
    + 'radial-gradient(ellipse at center, rgba(255,255,255,0.035) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.34) 100%);'
    + 'box-shadow:inset 0 0 60px rgba(0,0,0,0.35);';
  canvas.parentNode.appendChild(layer);
  let on = true;
  const crt = {
    get on() { return on; },
    // only an overlay: a CSS filter on the canvas itself makes the browser re-filter every frame, which is slow (worst in Firefox)
    set(value) { on = !!value; layer.style.display = on ? 'block' : 'none'; canvas.style.borderRadius = on ? '10px' : ''; },
    place() { for (const k of ['left', 'top', 'width', 'height']) layer.style[k] = canvas.style[k]; },
  };
  crt.set(true);
  return crt;
}

const WORLD_SIZE = [1120, 700]; // canvas pixels of the open world view (its pages are a little bigger)

export function startShowcase(stage) {
  const shared = { stage, cellar: null };
  // where the sourced library is served: the demo's own server has it at /library/; a copy of the game
  // picked with `node library.mjs pick --into <game>/library` sets window.KILN_LIBRARY = 'library/'
  const LIBRARY = globalThis.KILN_LIBRARY ?? '/library/';
  const query = stage.query ?? new URLSearchParams('');
  const game = createFitGame({
    canvas: stage.canvas,
    gameId: 'kiln-scene-demo',
    actions: ACTIONS,
    slots: 3,
    scenes: {
      title: (g) => titleScene(g, shared),
      play: (g) => playScene(g, shared),
      world: (g) => worldScene(g, shared),
      cellar: (g) => cellarScene(g, shared),
    },
    // one canvas pixel per screen pixel in the hamlet (the stage says how much of the window is useful);
    // the open world's pages have one size, so there the canvas keeps it and is shown at a whole multiple
    fit(w, h) {
      if (shared.mode !== 'world') return stage.resize(w, h);
      const zoom = Math.max(1, Math.floor(Math.min(w / WORLD_SIZE[0], h / WORLD_SIZE[1])));
      return [...WORLD_SIZE, zoom];
    },
    onResize: (w, h) => shared.ui?.resize(w / game.pixelRatio, h / game.pixelRatio),
    steady(dt) {
      shared.syncView?.();
      // A menu, the bag or a dialogue takes the mouse back from the first-person view: while the
      // pointer is caught there every mouse move turns the camera, and nothing could be clicked.
      // It is let go here; a click on the picture catches it again afterwards.
      if (shared.ui && (shared.ui.isOpen() || shared.quest?.story.view().active)) {
        for (const st of [stage, shared.world]) { const look = st?.firstPerson?.look; if (look?.locked) look.unlock(); }
      }
    },
    state: () => ({ ...describe(game.scenes.top?.state ?? {}), sounds: shared.sound.audio.log.length, pace: { ...game.pace }, clock: { tickRate: game.loop.stats?.tickRate, stalls: game.loop.stats?.stalls, worstGapMs: game.loop.stats?.worstGapMs } }),
  });
  const base = game.base; // the base engine: the loop, the input layers, the one clock of the day, the plugins
  // What is on screen, as the base and its plugins see it. The scenes still draw their own pictures
  // (the stage, the open world, the cellar); this view tells the plugins where a ground point is on
  // screen, how big a character cell is, and whether the view draws its own weather.
  const shown = { view: null, mode: 'iso' };
  base.views.add('stage', {
    draw() {},
    toScreen: (x, y, h = 0) => shown.view?.toScreen(x, y, h) ?? { x: 0, y: 0, visible: false },
    get cellPx() { return shown.view?.cellPx ?? 4; },
    get weather() { return !shown.view ? 'none' : shown.mode === 'iso' ? undefined : 'cells'; },
    get ownCamera() { return !!shown.view && shown.mode !== 'iso'; }, // first person and orbit move their own camera: the camera plugin leaves it alone
  });
  base.on('draw:world', () => { shown.view = null; }, { order: -100, owner: 'game' }); // a scene that draws no world (the cellar) shows no weather and no effects
  // Who has the player's input, and which big state the game is in, told to the base once per tick:
  // a menu or the bag stops the world (time, weather, effects, every plugin's 'sim'); a dialogue or a
  // cutscene takes the input and lets the world go on; the cellar is its own place underground.
  const layers = [
    ['cellar', () => game.scenes.current === 'cellar', { pausesSim: true }],
    ['dialogue', () => shared.quest?.story.view().active, { pausesSim: false }],
  ];
  base.on('input', () => {
    const scene = game.scenes.current ?? 'title';
    if (base.mode !== scene) base.setMode(scene);
    for (const [id, on, options] of layers) {
      const want = !!on();
      if (want && !base.focus.has(id)) base.openModal(id, options); else if (!want && base.focus.has(id)) base.closeModal(id);
    }
  }, { order: -500, owner: 'game' });
  // Drawn over the world, the effects and the weather: cutscene bars, health bars, the HUD and the menus.
  // The scenes ask for them while they draw; they are painted in the base's overlay layer, in the same order.
  const over = [];
  shared.over = (fn) => { over.push(fn); };
  base.on('draw:overlay', (ctx) => { for (const fn of over) fn(ctx); over.length = 0; }, { order: 0, owner: 'game' });
  game.resize();
  const crt = createCrt(stage.canvas);
  shared.crt = crt;
  const fitNow = game.resize; game.resize = () => { fitNow(); crt.place(); }; // the filter lies exactly over the canvas
  globalThis.addEventListener('resize', () => crt.place());
  crt.place();
  const describe = (state) => { const out = {}; for (const key of Object.keys(Object.getOwnPropertyDescriptors(state))) out[key] = state[key]; return out; };
  const rng = createRng('kiln-hamlet');

  // The audio plugin makes the audio: its volumes follow the Sound and Music settings, its timing runs in
  // the base's steady phase (music keeps time under a menu), and other plugins ask for sound on the bus.
  // The demo silences itself when its window is not in front (below), so the plugin's own watch is off.
  // listener 'none': the game pans its own sounds from where they are; no actor is the plugin's ear
  // library: the studio's sourced library (recordings here; see README of studio-engines/library). The
  // small 'impacts' and 'rpg' sample packs are fetched after the game starts, and sounds made from then
  // on take a fitting recording as their body. Without the library the game is all synthesised, as before.
  base.use(audioPlugin({ musicVolume: 0.4, range: 22, quietWhenHidden: false, listener: 'none', library: LIBRARY }));
  base.bus.on('audio:error', (e) => console.warn('sample pack not loaded:', e?.pack ?? '', e?.message ?? e)); // range in metres, like the scenes
  const sound = shared.sound = createSound({ audio: base.plugin('audio').audio, input: game.input, rng });
  // Settings live in the base's registry: the game declares its own rows here, each plugin declares
  // its own (time of day, weather, weather effects, screen shake), and the settings screen lists them all.
  base.settings.declare([
    // 'adventure' is the demo's own skin (made by the ui kit from the game's genre and Kiln's storybook style); the rest are the kit's stock themes
    { id: 'look', label: 'Menu look', type: 'choice', value: 'adventure', options: ['adventure', ...Object.keys(THEMES)] },
    // the view play starts in; V steps through them in this order, and the last one used is kept
    { id: 'view', label: 'View', type: 'choice', value: 'first', options: [{ value: 'first', label: 'first person' }, { value: 'orbit', label: 'orbit' }, { value: 'iso', label: 'isometric' }] },
    { id: 'crt', label: 'CRT filter', type: 'toggle', value: true },
    { id: 'depth', label: 'Depth sorting', type: 'toggle', value: true },
    { id: 'outlines', label: 'Show collision shapes', type: 'toggle', value: !!stage.outlines },
    // keys the player can change (the walking, use and throw keys stay put: auto-play presses those)
    ...controlsSchema(game.input, { attack: 'Key: swing', block: 'Key: guard', dodge: 'Key: dodge', inventory: 'Key: bag', log: 'Key: quest log', wave: 'Key: wave', fall: 'Key: fall down', bot: 'Key: auto-play', pause: 'Key: pause' }),
  ], 'game');
  // the names the demo used before the base had the list still work (play-tests, old code)
  const ALIAS = { sky: 'sky.time', wfx: 'weather.effects' };
  const settings = shared.settings = {
    get: (id) => base.settings.get(ALIAS[id] ?? id),
    set: (id, value) => base.settings.set(ALIAS[id] ?? id, value),
    values: () => base.settings.values(),
    reset: () => base.settings.reset(),
    onChange: (fn) => base.settings.watchAll((id, value) => fn(id, value, base.settings.values())),
  };
  // The sky engine: one clock runs the day for every view. The hamlet's backdrop fades between its
  // baked day, dusk and night pictures; the open world switches its pages when the base picture
  // changes and is tinted in between (game/world.js); the music and the ai follow the same clock.
  // The sky plugin makes the sky the base's clock (base.time): it runs while the game is played and
  // stands still under a menu, with no scene stepping it.
  base.use(skyPlugin({ ...skyOptionsOfScene({ light: [1, -0.5, 1] }), dayLength: 1200, startHour: 8 }));
  const sky = shared.sky = base.plugin('sky').sky;
  stage.sky = sky; // the first-person view reads it from the stage
  const bakedLook = shared.look = createBakedLook({ bakes: ['day', 'dusk', 'night'], day: sky.config.day });
  shared.lookNow = bakedLook.at(sky.now);
  const orbitOf = (name) => () => loadSceneOrbit(new URL(`../assets/hamlet-${name}.orbit.json`, import.meta.url).href, { keep: 10 });
  shared.blended = createBlendedOrbit({
    first: 'day',
    orbits: { day: stage.orbit, dusk: orbitOf('dusk'), night: orbitOf('night') },
    onMissing: (name) => shared.ui?.toast(`The ${name} hamlet is not baked yet (node examples/scene-demo/build.mjs)`, 4),
  });
  stage.sceneCamera.setOrbit(shared.blended);
  /** Before each picture: show the hamlet as the sky has it now, and let the music follow. */
  // The weather engine, next to the sky: clouds, rain, fog, wind, storms and snow on the same clock.
  // Every view is lit by the sky with the weather's grey in it (skyNow); the flat views get rain
  // and snow drawn over them (weatherDraw), and rain, wind and thunder are heard (weatherSound).
  // The weather plugin steps the weather on the base's clock, lays its grey over the sky for every
  // reader of base.time.now, publishes base.env 'weather' and 'wind', and draws rain and snow over
  // the flat views. The first-person and orbit views draw their own (the 'stage' view below says so).
  base.use(weatherPlugin({ climate: 'temperate', rng, overlay: { rng, metres: 40 }, sound: false }));
  const weatherApi = base.plugin('weather');
  const weather = shared.weather = weatherApi.weather;
  shared.weatherAmount = 1; // the first-person view reads it
  shared.skyNow = () => base.time.now; // the sky with the weather's grey in it
  let weatherAt = null; // where the listener stands, for the weather's sound
  base.on('sim', () => { if (!shared.away?.()) shared.weatherSound?.update(weather.now, weatherAt ?? undefined); }, { order: 10, owner: 'game' });
  /** Kept for the scenes: they say where the player is; the plugin does the stepping. */
  shared.weatherTick = (dt, at) => { weatherAt = at ?? null; };
  /** Kept for the scenes: they say which way the camera looks and which kind of view shows; the plugin draws. */
  shared.weatherDraw = (ctx, yaw, mode = 'iso') => { weatherApi.overlay.axes = isoAxes(yaw); shown.mode = mode; };
  shared.skyFrame = () => { const l = bakedLook.at(shared.skyNow(), shared.lookNow); shared.blended.set(l); shared.sound?.timeOfDay(l.base); return l; };
  // Detail: how fine characters and props are drawn (text cells per metre). The other stages take
  // the same number when they offer a detail setter (the open world and the first-person view).
  const DETAILS = { low: 2, medium: 3, high: 5 };
  function setDetail(name) {
    const n = DETAILS[name] ?? 3;
    shared.detail = n;
    stage.detail = n;
    const bias = { low: -1, medium: 0, high: 1 }[name] ?? 0; // one backdrop level coarser or finer than the zoom asks for
    if ('levelBias' in stage.sceneCamera) stage.sceneCamera.levelBias = bias;
    if (shared.world?.sceneCamera && 'levelBias' in shared.world.sceneCamera) shared.world.sceneCamera.levelBias = bias;
    shared.levelBias = bias;
    if (shared.world && 'detail' in shared.world) shared.world.detail = n;
    stage.setViewDetail?.(n); // first-person and orbit views, when they offer it
  }
  const SKIN = { genre: 'adventure', style: 'storybook' };
  let look = 'adventure';
  function setLook(name) { look = name; if (!shared.ui) return; if (name === 'adventure') shared.ui.setSkin(SKIN); else shared.ui.setTheme(name); }
  let booted = false; // after start-up, every change of a setting is confirmed on screen
  const SAID = { weather: 'Weather', 'weather.effects': 'Weather effects', detail: 'Detail', 'sky.time': 'Time of day', fps: 'Frame rate', crt: 'CRT filter', look: 'Menu look', depth: 'Depth sorting', outlines: 'Collision shapes', view: null };
  function apply(id, value) {
    if (booted && SAID[id]) shared.ui?.toast(`${SAID[id]}: ${value === true ? 'on' : value === false ? 'off' : value}`, 1.6);
    if (id === 'depth') stage.occlude = value;
    else if (id === 'crt') crt.set(value);
    else if (id === 'weather.effects') shared.weatherAmount = { off: 0, low: 0.45, full: 1 }[value] ?? 1; // the first-person view reads it
    else if (id === 'fps') game.pace.maxFps = { low: 30, balanced: 72, full: 0 }[value] ?? 72;
    else if (id === 'look') setLook(value);
    else if (id === 'detail') setDetail(value);
    else if (id === 'outlines') stage.outlines = value;
  }
  // settings saved before the base had the list (the ui kit kept them under 'settings'): taken over once
  { const store = game.saves.settings; const old = store.get('settings', null);
    if (old && typeof old === 'object' && !store.get('settings.moved', false)) {
      for (const [id, value] of Object.entries(old)) { const to = ALIAS[id] ?? id; try { if (base.settings.has(to)) base.settings.set(to, value); } catch { /* a value the new list does not take */ } }
      store.set('settings.moved', true);
    } }
  base.settings.watchAll(apply);
  for (const [id, value] of Object.entries(settings.values())) apply(id, value);
  applyControls(settings, game.input);
  booted = true;
  if (query.has('outlines')) stage.outlines = true;

  // the ui kit's rows are finger-sized by default; this is a mouse-and-keyboard page, so they are drawn smaller
  // Menus, HUD and the dialogue box are laid out in CSS pixels and drawn scaled by the screen's pixel
  // ratio, so on a HiDPI screen (where the canvas has more pixels) they keep their size.
  // The ui plugin makes the kit's ui on the base: it updates and draws it, lists the base's settings on
  // the settings screen, and holds the focus layer 'ui' (which pauses the world) while a menu is open.
  // fonts: the kit's own fonts for the look (loaded by default); icons: the kit's game-icons set, whose
  // credit is required and shown on the one Credits screen (menus: Credits).
  base.use(uiPlugin({ scale: 0.62, hints: true, pixelRatio: () => game.pixelRatio, icons: 'game-icons' }));
  shared.credits = base.plugin('ui'); // creditsItem() for the menus, allCredits() for tests
  const gameIcons = base.plugin('ui').icons; // game-icons.net drawings for the HUD: their credit is on the Credits screen
  const ui = shared.ui = base.plugin('ui').ui;
  // The scenes ask this where they used to call ui.update: true while a menu is open, and on the
  // tick it closed (so the Esc that closed a menu is not also the Esc that opens the pause menu).
  let uiBefore = false; let uiBusy = false;
  base.on('ui', () => { uiBefore = ui.isOpen(); }, { order: -101, owner: 'game' });
  base.on('ui', () => { uiBusy = uiBefore || ui.isOpen(); }, { order: -99, owner: 'game' });
  shared.uiBusy = () => uiBusy;
  setLook(look);
  const overlayPointer = { x: 0, y: 0, down: false, pressed: false, released: false };
  shared.uiInput = {
    pressed: (name) => game.input.pressed(name), down: (name) => game.input.down(name),
    get lastDevice() { return game.input.lastDevice; },
    get pointer() { const p = game.input.pointer; return Object.assign(overlayPointer, p, { x: p.x / game.pixelRatio, y: p.y / game.pixelRatio }); },
  };
  /** Draw the HUD and menus, then (if given) the dialogue box, in CSS pixels. */
  // the plugin draws the HUD and the menus in 'draw:ui'; the dialogue box goes over the HUD, as before
  const overUi = [];
  base.on('draw:ui', (ctx) => { for (const fn of overUi) fn(ctx); overUi.length = 0; }, { order: 200, owner: 'game' });
  shared.drawUi = (ctx, box) => { if (box) overUi.push(() => drawUiNow(ctx, box)); };
  const drawUiNow = (ctx, box) => {
    const k = game.pixelRatio; const w = game.width / k; const h = game.height / k;
    ctx.save(); ctx.scale(k, k);
    if (box) { const width = Math.min(780, w - 40); box.draw(ctx, { x: Math.round((w - width) / 2), y: h - 222, width, height: 204 }); }
    ctx.restore();
  };
  ui.hud
    .add({ id: 'quest', type: 'text', value: '' })
    .add({ id: 'pause', type: 'button', icon: 'pause', anchor: 'top-right', onPress: () => shared.menus.openPause() })
    .add({ id: 'coins', type: 'counter', icon: gameIcons.get('two-coins'), value: 0, anchor: 'top-right' })
    .add({ id: 'stones', type: 'counter', icon: gameIcons.get('stone-block'), label: 'Stones', value: 0, anchor: 'top-right' })
;

  // The fx plugin: sparks, dust, smoke and screen shake, drawn as character cells over the picture
  // and under the HUD. Anything in the game asks for an effect with shared.fx.burst(...) or on the bus.
  base.use(fxPlugin({ modes: ['play', 'world'] }));
  const fx = shared.fx = base.plugin('fx').fx;
  /** Kept for the scenes: the plugin updates and draws. The scene only says what is on screen. */
  shared.fxTick = () => {};
  shared.fxDraw = (ctx, view) => { shown.view = view; };
  const quest = shared.quest = createQuest();
  const story = quest.story;
  shared.box = createDialogueBox(story, { style: { font: '18px Consolas, monospace', lineHeight: 25, padding: 16 } });
  story.on('questStarted', (e) => { ui.toast(`New quest: ${story.quest(e.quest).title}`, 3); sound.play('quest'); });
  story.on('objectiveDone', (e) => {
    const o = story.quest(e.quest).objectives.find((x) => x.id === e.objective);
    ui.toast(`Done: ${o.text}`, 2.5); sound.play('confirm', { volume: 0.6 });
  });
  story.on('questDone', (e) => {
    if (e.quest === 'supplies') { const { left } = shared.items.inventory.add('sword'); ui.toast(left ? 'The guard offers a sword, but your bag is full' : 'The guard hands you an iron sword. I opens your bag.', 4); }
    ui.toast(`Quest complete: ${story.quest(e.quest).title}`, 4); sound.play('win'); shared.menus.saveTo(1, true); });
  story.on('varChanged', (e) => { if (e.name === 'coins' && e.value > e.previous) sound.play('coin'); });
  story.on('event', (e) => { if (e.name === 'open_cellar') sound.play('door'); else if (e.name === 'more_stones') sound.play('pickup'); });
  story.on('line', () => sound.play('blip', { volume: 0.25, pitch: 0.9 + rng() * 0.3 }));
  shared.onTargetHit = () => { stoneHit(quest); ui.toast('Hit!', 1); };

  // the bag: whoever the player is on either stage wears what is equipped
  shared.items = createItems({ base, ui, sound, heroes: () => [stage.player.actor, ...(shared.world ? [shared.world.player.actor] : [])] });
  // The economy plugin: the hamlet's merchant keeps a stall. Prices move with the stock, the stall
  // restocks on the game's clock, and what was bought and sold is in the hamlet's save. The coins are
  // the story's (quests pay them, lines speak of them); the bag's purse is kept equal to them.
  base.use(economyPlugin({
    shops: [{ id: 'merchant', name: 'The merchant\'s stall', purse: 60, restock: { every: 24 },
      stock: [{ item: 'apple', n: 8 }, { item: 'tea', n: 4 }, { item: 'axe', n: 4 }, { item: 'staff', n: 1 }, { item: 'shield', n: 1 }, { item: 'helm', n: 1 }] }],
  }));
  const economy = base.plugin('economy');
  const freshEconomy = JSON.stringify(economy.save());
  let purse = false; // true while one side is being set from the other
  const syncPurse = () => { // the story's coins are the truth
    const inv = shared.items.inventory; const want = Math.max(0, Math.round(story.getVar('coins'))); const have = inv.coins;
    if (want === have) return;
    purse = true; try { if (want > have) inv.addCoins(want - have); else inv.spend(have - want); } finally { purse = false; }
  };
  story.on('varChanged', (e) => { if (e.name === 'coins' && !purse) syncPurse(); });
  shared.items.inventory.on('change', () => { // a purchase or a sale: the story hears of it
    if (purse) return;
    const inv = shared.items.inventory;
    if (inv.coins !== story.getVar('coins')) { purse = true; try { story.setVar('coins', inv.coins); } finally { purse = false; } }
  });
  shared.shop = {
    /** Open the merchant's stall. Says so when it cannot. */
    open() { syncPurse(); const r = economy.openShop('merchant'); if (!r.ok) ui.toast('The stall is shut for now'); else sound.play('blip', { volume: 0.5 }); return r.ok; },
    /** After a bag or a story was loaded or started anew. */
    sync: syncPurse,
    save: () => economy.save(),
    /** A saved stall, or a new game's (null). */
    reset(saved = null) { economy.load(saved ?? JSON.parse(freshEconomy)); syncPurse(); },
  };
  // the mouse turns the camera of the scene that is showing, and never under a menu, the bag or a dialogue
  // The events engine: scripted moments (the quest's opening, a line at dusk). While a cutscene has
  // the controls the player does not move, the camera follows its shots, and its fade, bars and
  // spoken lines are drawn over the world.
  // It is a base plugin: it updates in the base's 'sim' (so it stands still under a menu and in the
  // cellar), takes the input with the focus layer 'cutscene', and its scene follows the base's mode.
  const showing = () => (base.mode === 'world' && shared.world ? shared.world : stage);
  // The player as a base actor: one 'hero' wherever the game is, standing where the showing stage's
  // villager stands (ground metres of that stage). Plugins find the player here.
  const hero = shared.hero = base.actors.add({ id: 'hero', x: stage.player.body.x, y: stage.player.body.y, kind: 'person', solid: false, hero: true });
  base.on('input', () => { const st = showing(); const p = st === stage ? stage.player.body : st.player; hero.x = p.x; hero.y = p.y; hero.character = st.player.actor; }, { order: -400, owner: 'game' });
  const castOf = () => (base.mode === 'world' ? { player: shared.world?.player } : { player: stage.player, guard: stage.npc });
  base.use(eventsPlugin({
    data: EVENTS, story, storyData: STORY, sceneFrom: 'mode', promptKey: 'Space', scale: () => game.pixelRatio, // the plugin draws the bars, the fade and the lines
    // the hamlet's people stand where their collision body is; the open world's own x and y are world metres (their body is in page metres)
    actors: (id) => { const c = castOf()[id]; return c ? (base.mode === 'world' ? c : c.body) : null; },
    inputActions: { confirm: 'confirm', skip: 'cancel', interact: 'confirm' }, // the demo has no separate interact key
    clock: { get hour() { return sky.now.hour; }, get part() { return sky.now.part; }, setHour: (h) => sky.setHour(h) },
    drivers: {
      moveActor(body, x, y) { if (base.mode === 'world') { body.x = x; body.y = y; } else stage.collision.teleport(body, x, y); },
      animate(body, clip, { id }) { const c = castOf()[id]?.actor; if (!c) return; if (clip === 'wave') c.wave(true); else if (clip === 'idle') c.wave(false); else if (typeof c[clip] === 'function') c[clip](); },
      sound: (name, o) => sound.play(name, { volume: o?.volume }),
      // where a shot starts from and returns to: what the 3D view shows, or the flat picture's camera
      cameraNow: () => { const st = showing(); const c = st.camera; return st.firstPerson?.shotNow() ?? { x: c.x, y: c.y, zoom: c.zoom, yaw: c.yaw }; },
    },
  }));
  // who an id in the events file is, for the 3D views' point-of-view shots (the open world's own x and y are world metres; a hamlet body is the place)
  shared.actorOf = (id) => { const c = castOf()[id]; return c ? (base.mode === 'world' ? c : c.body ?? c) : null; };
  const eventsApi = base.plugin('events');
  // the stage that shows gets the shot: its first-person and orbit views circle the shot's point, then carry on where they were
  base.on('sim', () => { const st = showing(); if (st) st.shot = eventsApi.events.shot; }, { order: 60, owner: 'game' });
  const events = shared.events = eventsApi.events;
  /** A new game: nothing has fired yet (a loaded save brings its own). `scene` is the mode being entered. */
  shared.eventsNew = (scene) => { events.reset(); eventsApi.setScene(scene); };
  // The open world's points of interest become places for the events' areas as their chunk streams
  // in, and leave with it (the base's world plugin would say so on the bus; this world stage is the game's own).
  let placesOf = null;
  const eachPlace = (chunk, fn) => { for (const f of chunk?.features ?? []) fn(f.name, `${f.tx},${f.ty}`, { x: f.tx + 0.5, y: f.ty + 0.5 }); };
  base.on('sim', () => {
    const gen = shared.world?.genWorld;
    if (!gen || gen === placesOf || typeof gen.on !== 'function') return;
    placesOf = gen;
    for (const poi of ['camp', 'hamlet']) for (const place of events.places(poi)) eventsApi.removePlace(poi, place.key); // a loaded save starts the world again
    gen.forEachChunk((chunk) => eachPlace(chunk, (poi, key, at) => eventsApi.addPlace(poi, key, at)));
    gen.on('load', (chunk) => eachPlace(chunk, (poi, key, at) => eventsApi.addPlace(poi, key, at)));
    gen.on('unload', (chunk) => eachPlace(chunk, (poi, key) => eventsApi.removePlace(poi, key)));
  }, { order: 40, owner: 'game' });
  let shotOn = false; let cutsceneOn = false;
  /** Once per tick in the hamlet, after the stage's update. Returns true while a cutscene has the controls. */
  shared.eventsTick = (dt, input) => {
    const shot = events.shot; const cam = stage.camera;
    if (shot.active) { shotOn = true; cam.follow(null); cam.lookAt(shot.x + shot.shakeX, shot.y + shot.shakeY); cam.zoomTo(shot.zoom); if (shot.yaw !== null && shot.yaw !== undefined) cam.rotateTo(shot.yaw); stage.npc.halt = true; } else if (shotOn) { shotOn = false; cam.follow(stage.player.body); cam.zoomTo(1); }
    if (events.busy !== cutsceneOn) { cutsceneOn = events.busy; ui.hud.visible = !cutsceneOn; } // the HUD steps aside for the bars and the spoken line
    return events.busy;
  };
  /** After the world and its effects, before the HUD. */
  shared.eventsDraw = () => {}; // kept for the scenes: the events plugin draws its own overlay
  story.on('choice', () => sound.play('blip', { volume: 0.4 })); // an answer picked, by number key, Space or a click
  // The procgen plugin keeps the world's seed and the quests made from it. The farmer's side quest is in
  // the story already (game/story.js); its tracker turns what happens in the game into quest progress:
  // every death the combat reports is a 'kill' of that kind, and the story's reward event pays out.
  base.use(procgenPlugin({ seed: 'kiln-hamlet' }));
  { const tracker = base.plugin('procgen').tracker; tracker.add(SIDE_QUEST);
    const KIND = (id) => (id === 'bones' ? 'skeleton' : shared.worldFight?.mobs.get(id)?.kind ?? null);
    base.bus.on('combat:death', (e) => { const kind = KIND(e.id); if (kind) story.apply(tracker.match({ type: 'kill', kind })); });
    story.on('event', (e) => {
      const pay = tracker.payout(e.name);
      if (!pay || pay.kind !== 'reward') return;
      if (pay.rewards.xp) shared.sheet.stats.addXp('hero', pay.rewards.xp, { source: 'quest' });
      for (const id of pay.rewards.items ?? []) if (shared.items.catalog.has(id)) shared.items.inventory.add(id);
    }); }
  // The view. Play starts in first person (Settings > View, kept between visits); the title and the
  // cellar are flat pictures and stay isometric. ?view=iso|first|orbit (or ?fp, ?orbit) picks one for
  // this visit without touching the saved choice: play-tests use it.
  const VIEWS = ['first', 'orbit', 'iso'];
  let visitView = VIEWS.includes(query.get('view')) ? query.get('view') : query.has('fp') ? 'first' : query.has('orbit') ? 'orbit' : null;
  let viewsHeard = false; let settingView = false;
  const inPlay = () => game.scenes.current === 'play' || game.scenes.current === 'world';
  shared.syncView = () => {
    const views = stage.firstPerson;
    if (!views) return; // the 3D views are still loading: the isometric picture shows until they are there
    if (!viewsHeard) {
      viewsHeard = true;
      // the views' page button carried its mouse tips in its label and reached under the hotbar: the label is
      // kept short here (syncView below), and the tip is said once as a toast when the view changes
      const TIP = { first: 'Click the picture to look with the mouse (Esc lets go)', orbit: 'Drag to turn and tilt, Shift + wheel for distance' };
      views.onChange((mode) => { if (TIP[mode] && inPlay() && !settingView) ui.toast(TIP[mode], 3); });
      views.onChange((mode) => { // V or the button: the player's choice sticks
        if (settingView || !inPlay()) return;
        if (visitView) visitView = mode; else settings.set('view', mode);
      });
    }
    { const short = views.button.textContent.split(' - ')[0]; if (short !== views.button.textContent) views.button.textContent = short; } // "Next view: Orbit view (V)"
    const want = inPlay() ? (visitView ?? settings.get('view')) : 'iso';
    if (views.mode !== want && VIEWS.includes(want)) { settingView = true; try { views.setMode(want); } finally { settingView = false; } }
  };
  const free = () => !ui.isOpen() && !story.view().active && !events.busy;
  stage.mouseOn = () => (game.scenes.current === 'play' || game.scenes.current === 'title') && free();
  shared.worldMouseOn = () => game.scenes.current === 'world' && free();
  stage.cameraPerFrame = true; // the play scene eases the camera once per drawn frame
  shared.controls = createControls(game, shared);
  shared.items.onPickup = (x, y) => fx.burst('sparkle', { x, y, z: 0.5 });
  // the weather's sounds are built at the first key or click, like the rest of the sound
  game.input.onFirstGesture(() => { try { shared.weatherSound = createWeatherSound({ audio: sound.audio, generateAmbience, generateSound, weather }); } catch (e) { console.warn('weather sound is off:', e.message); } });
  shared.hamlet = createHamlet(game, shared);
  shared.minds = createMinds(game, shared, [
    { actor: shared.hamlet.extras[0], asset: shared.hamlet.extras[0].asset, home: [49.5, 52], work: [49, 44.6] }, // the merchant: by the blue house
    { actor: shared.hamlet.extras[1], asset: shared.hamlet.extras[1].asset, home: [31.5, 36], work: [30.2, 47.2] }, // the farmer: cottage and haystack
  ]);
  // Collision and combat as base plugins, for both stages. The collision plugin adopts the collision world
  // of the stage that shows (the stages made their bodies themselves, so the plugin makes none): the
  // hamlet's one world, or the open world's world of the page the player is on, whose own metres start at
  // the page's corner (the plugin's origin). The combat plugin makes the game's one combat on it, in the
  // game's metres whatever the page, and tells the bus every blow ('combat:hit', 'combat:death' ...).
  // drive: false, because the stages walk their people and game/controls.js reads the keys, the mouse
  // and the touch buttons. The hamlet's skeleton and the open world's camps join and leave it as the
  // game goes from one to the other (game/fight.js, game/world-fight.js).
  base.use(collisionPlugin({ world: stage.collision, solid: () => false }));
  base.use(combatPlugin({ drive: false, hitStop: 0.08, rng, sceneryMask: stage.layers.SCENERY, groundAt: (x, y) => showing().groundAt(x, y) }));
  { const col = base.plugin('collision'); let at = { world: stage.collision, x: 0, y: 0 };
    base.on('input', () => {
      const ws = base.mode === 'world' ? shared.world : null;
      const world = ws?.collision ?? stage.collision; const x = ws?.collision ? ws.page.ox : 0; const y = ws?.collision ? ws.page.oy : 0;
      if (world === at.world && x === at.x && y === at.y) return;
      at = { world, x, y }; col.setWorld(world, { origin: { x, y } });
    }, { order: -450, owner: 'game' }); }
  // the one hero of the one combat, armed from the bag
  { const combat = base.plugin('combat').combat;
    combat.addFighter('hero', { faction: 'player', x: stage.player.body.x, y: stage.player.body.y, hp: HERO_HP, maxHp: HERO_HP, weapon: 'fists', external: true, hurtIframes: 0.5 }); // half a second of mercy after a blow, as in the combat demo
    const dress = () => {
      syncFighter(combat, 'hero', shared.items.inventory, { weapons: { sword: 'sword', blade: 'rustyBlade', staff: 'staff' } });
      if (!combat.fighter('hero').shield) combat.equip('hero', { shield: 'buckler' }); // bare arms still give a small guard, so H and right click always do something
    };
    shared.items.inventory.on('change', dress); dress();
    bindAudio(combat, { play: (s, o) => sound.play(s, o) }, { listener: () => combat.fighter('hero') }); }
  // The stats plugin: the hero has a character sheet. Beating the skeleton or a camp's band gives
  // experience; a new level means more health and a harder blow, and what is worn guards (a helm, a
  // shield). The sheet owns the hero's health maximum, power and defence in the combat; the mobs have
  // sheets of their kind, so a fight pays what the kind is worth. Kept small on purpose: no points to
  // spend, no mana, and the weapons' own blows are the combat engine's as before.
  base.use(statsPlugin({
    player: 'hero', hud: false, rng,
    rules: {
      builtins: false,
      stats: {
        maxHp: { label: 'Health', base: HERO_HP, perLevel: 2, min: 1, round: 'floor' },
        power: { label: 'Power', base: 0, perLevel: 0.5 },
        defense: { label: 'Defence', base: 0, min: 0 },
        xpGain: { label: 'Experience gain', base: 1, min: 0 },
      },
      resources: { hp: { label: 'Health', max: 'maxHp' } },
      effects: {},
      levels: { curve: { kind: 'power', base: 30, power: 1.5 }, maxLevel: 10, pointsPerLevel: 0, refill: true },
      templates: {
        skeleton: { base: { maxHp: 10 }, xpReward: 20 }, wolf: { base: { maxHp: 7 }, xpReward: 12 },
        goblin: { base: { maxHp: 6 }, xpReward: 10 }, bandit: { base: { maxHp: 9 }, xpReward: 16 }, campSkeleton: { base: { maxHp: 8 }, xpReward: 14 },
      },
    },
    sheets: { hero: {} },
    combatOptions: { stats: { attack: 'power', defense: 'defense', maxHp: 'maxHp', speed: null } },
  }));
  { const sheet = base.plugin('stats'); const stats = sheet.stats;
    ui.hud.add({ id: 'level', type: 'counter', icon: gameIcons.get('upgrade'), label: 'Level', value: 1, anchor: 'top-right' });
    const show = () => ui.hud.set('level', stats.level('hero'));
    stats.on('levelup', (e) => { if (e.id !== 'hero') return; show(); ui.toast(`Level ${e.level}: more health, a harder blow`, 3); sound.play('quest'); });
    stats.on('xp', (e) => { if (e.id === 'hero' && e.gained > 0) ui.toast(`+${Math.round(e.gained)} experience`, 1.4); });
    // the health bar is as long as the hero's health: a level changes its maximum
    let barMax = HERO_HP;
    base.on('sim', () => { const f = base.plugin('combat').combat.fighter('hero'); if (!ui.hud.has('hp') || f.maxHp === barMax) return; barMax = f.maxHp; ui.hud.set('hp', Math.max(0, f.hp), barMax); }, { order: 120, owner: 'game' });
    shared.sheet = {
      stats,
      /** A mob joins the fight: its sheet of that kind (what beating it is worth). */
      mob(id, kind) { if (stats.has(id)) stats.remove(id); stats.add(id, kind); sheet.combatLink?.push(id); },
      gone(id) { if (stats.has(id)) stats.remove(id); },
      /** The hero's level and experience, for the quest log. */
      line() { const p = stats.progress('hero'); return p.atMax ? `level ${p.level}` : `level ${p.level}, ${Math.round(p.into)} of ${Math.round(p.need)} experience`; },
      save: () => sheet.save(),
      /** A saved sheet, or a new game's level 1 (null). */
      reset(saved = null) {
        if (saved) { try { sheet.load(saved); } catch { saved = null; } }
        if (!saved || !stats.has('hero')) { if (stats.has('hero')) stats.remove('hero'); stats.add('hero', {}); }
        for (const id of stats.ids()) if (id !== 'hero') stats.remove(id); // the fights give their mobs a sheet again when they come
        sheet.combatLink?.push('hero'); show();
      },
    }; }
  shared.fight = createFight(game, shared, rng);
  // what a fight looks like, and the hero's swings, axes and weapon swap (game/combat-view.js)
  shared.combatView = createCombatView(game, shared);
  // The fighting keys changed (block K, dodge L, the log on M, falling down on Y): keys saved before that
  // would put the old ones back, so the key rows go to their new defaults once.
  { const store = game.saves.settings;
    if (!store.get('keys.fight2', false)) { for (const item of base.settings.schema()) if (item.type === 'key') { try { base.settings.set(item.id, game.input.bindings()[item.id.slice(4)]?.filter((c) => !c.startsWith('pad:')) ?? item.value); } catch { /* a row the list no longer has */ } } store.set('keys.fight2', true); } }
  shared.worldFight = createWorldFight(game, shared, rng);
  // The nav plugin: one field of walkable ground for the game, in the game's metres. It takes the scenery
  // of the collision world that is in (the hamlet's, or the open world's current page with its origin)
  // as props and follows every swap. The stages' people have bodies of their own in those worlds
  // (layer CHARACTER), so only layer SCENERY counts as something in the way. Ground with nothing known
  // about it is open: the open world has no edge.
  base.use(navPlugin({ focus: 'hero', unloaded: 'open', cellSize: 0.5, scenery: (b) => b.layer === stage.layers.SCENERY }));
  shared.worldWalk = createWorldWalk(shared, base.plugin('nav').nav); // paths round wells, stalls and houses for the open world's residents
  shared.bot = createAutoplay(game, shared);
  shared.net = createNetplay(game, shared);
  shared.menus = createMenus(game, shared);
  for (const part of [shared.fight, shared.minds, shared.net, shared.worldFight]) { const draw = part.draw.bind(part); part.draw = (ctx) => shared.over(() => draw(ctx)); } // their bars and marks go over the effects and the weather
  shared.openPage = (href) => { globalThis.location.href = href; };

  // Never play where nobody is looking: the demo makes no sound unless its window is the one in
  // front, and it also pauses when its tab is hidden or when it sits unfocused inside another page
  // (a preview frame). It carries on when it is shown or clicked again, and the player's own mute
  // and volume settings are not touched.
  const doc = globalThis.document; const win = globalThis.window;
  const embedded = (() => { try { return win.self !== win.top; } catch { return true; } })();
  let quiet = false;
  const watch = () => {
    // silent whenever the window is not the one in front (a window behind others is not "hidden" to
    // the browser, but nobody is looking at it); paused as well when hidden or embedded and unfocused
    const away = doc.hidden || !doc.hasFocus();
    game.loop.paused = doc.hidden || (embedded && !doc.hasFocus());
    if (away === quiet) return;
    quiet = away;
    if (away) { sound.audio.stopMusic({ fade: 0.2 }); sound.quiet(true); shared.weatherSound?.setShelter(1); shared.weatherSound?.update({ ...weather.now, rain: 0, snow: 0, wind: { ...weather.now.wind, speed: 0, gust: 0 }, storm: 0 }); } else { sound.quiet(false); sound.resumeMusic(); shared.weatherSound?.setShelter(0); }
  };
  doc.addEventListener('visibilitychange', watch); win.addEventListener('blur', watch); win.addEventListener('focus', watch);
  shared.away = () => quiet;
  game.shared = shared;
  globalThis.window.game.ui = ui; // play-tests read game.ui.snapshot() and game.audio.log
  globalThis.window.game.audio = sound.audio;
  game.start();
  if (query.has('play') || query.has('bot')) game.scenes.go('play', { bot: query.has('bot') });
  else if (query.has('world')) game.scenes.go('world', {});
  if (query.has('net') && !query.has('lobby')) shared.net.connect(); // ?net=<server> joins at once; with &lobby it only names the server and the pause menu's lobby does the rest
  watch();
  return game;
}
