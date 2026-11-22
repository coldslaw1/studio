// The open world scene: the same game services (input, HUD, menus, sound, dialogue, the bag,
// saves) standing on the world stage (world-stage.js), where the world engine makes land and
// hamlets without end and Kiln renders the part around the player.
import { screenDirection, groundUnder, keysToward } from './nav.js';
import { propSprite } from './props.js';
import { createBlend } from './blend.js';
import { drawGrade } from '../vendor/sky/index.js';
import { updateCameraInput, attachCameraMouse } from '../vendor/camera/index.js';

const PLACES = ['Ashby', 'Brindle', 'Calder', 'Dunmere', 'Elmstead', 'Fenwick', 'Garrow', 'Holt', 'Ivel', 'Kestrel', 'Larkhill', 'Marlow', 'Norbury', 'Oakham', 'Pell', 'Quarry End', 'Rushden', 'Stowe', 'Thorne', 'Wick'];
const placeName = (seed) => PLACES[Math.abs(Math.floor(seed)) % PLACES.length];

/** core scene factory for the open world: (game, shared) => scene. `enter({ saved, bot })`. */
export function worldScene(game, shared) {
  const { ui, sound, quest, box, items } = shared;
  const { input } = game;
  const story = quest.story;
  const intent = { dx: 0, dy: 0, run: false, fly: false };
  const sack = propSprite('sack', undefined, () => shared.stage.detail ?? 3);
  let ws = null; // the world stage, made the first time the scene is entered
  let loading = null; let failed = null; let walkTo = null; let press = null; let talkingTo = null; let fly = false; let seconds = 0; let bob = 0;
  let met = new Set(); let looted = new Set(); let lastBiome = '';
  let waving = false;
  let asked = 'day'; let showing = 'day'; let asking = false; let retry = 0; // which look of the pages is asked for and on screen
  const tintOut = { multiply: [1, 1, 1], identity: true }; const gradeCache = {};
  const facing = { x: 0, y: 1 }; // ground direction the player last walked in
  const viewMode = () => ws?.firstPerson?.mode ?? 'iso';
  /** A point `d` metres ahead (world metres): where first person looks, else the way the villager walks. */
  function lookAhead(d) {
    if (viewMode() === 'first') { const a = ws.firstPerson.camera.yaw * Math.PI / 180; return { x: ws.player.x + Math.cos(a) * d, y: ws.player.y + Math.sin(a) * d }; }
    return { x: ws.player.x + facing.x * d, y: ws.player.y + facing.y * d };
  }
  /** The world point under the mouse in the flat view, or null. */
  function mousePoint() {
    if (viewMode() !== 'iso') return null;
    const g = groundUnder(ws.view, ws.rect, input.pointer.x, input.pointer.y);
    return g ? { x: g.x + ws.page.ox, y: g.y + ws.page.oy } : null;
  }
  /** Where the hero should face in a fight, or null for "the way it walks". */
  const facePoint = () => (viewMode() === 'first' ? lookAhead(3) : viewMode() === 'iso' && input.lastDevice === 'pointer' ? mousePoint() : null);
  /** Where a thrown axe should go. */
  const aimPoint = (d) => (viewMode() === 'iso' && input.lastDevice === 'pointer' ? mousePoint() : null) ?? lookAhead(d);
  const blend = createBlend();
  let lap = 0; // seconds until the next sound of water

  const state = {
    scene: 'world',
    get ready() { return Boolean(ws); }, get error() { return failed?.message ?? null; },
    get x() { return ws?.player.x; }, get y() { return ws?.player.y; },
    get biome() { return ws ? ws.biomeAt(ws.player.x, ws.player.y) : null; },
    get talking() { return story.view().active; },
    get people() { return ws ? ws.people.length : 0; },
    get met() { return met.size; }, get drops() { return items.drops.items.length; },
    get bag() { return items.inventory.snapshot(); },
    get quests() { return Object.fromEntries(story.quests().map((q) => [q.id, q.status])); },
    get swaps() { return ws?.stats.swaps ?? 0; }, get waiting() { return ws?.waiting ?? false; },
    get menu() { return ui.snapshot().screen ?? null; },
    get walk() { return { ...shared.worldWalk.stats }; },
    get fight() { const c = shared.worldFight.combat; return { hp: c.fighter('hero').hp, mobs: [...shared.worldFight.mobs.values()].map((m) => ({ id: m.id, kind: m.kind, hp: c.fighter(m.id).hp, x: +m.character.x.toFixed(1), y: +m.character.y.toFixed(1) })) }; },
    get bot() { return { on: shared.bot.on, goal: shared.bot.on ? 'wander and greet' : '' }; },
  };

  let dbg = 0;
  function text(id, anchor, value) {
    if (!value) { if (ui.hud.has(id)) ui.hud.remove(id); return; }
    if (ui.hud.has(id)) ui.hud.set(id, value); else ui.hud.add({ id, type: 'text', value, anchor });
  }
  function nearest() { // the resident close enough to talk to
    let best = null; let bestD = 2.4;
    for (const e of ws.people) { const d = Math.hypot(e.x - ws.player.x, e.y - ws.player.y); if (d < bestD) { best = e; bestD = d; } }
    return best;
  }
  function refreshHud() {
    dbg -= 1; if (dbg <= 0) { dbg = 60; text('debug', 'bottom-left', shared.stage.outlines ? sound.debugLine() : ''); } // with "Show collision shapes" on
    const q = story.quest('neighbours');
    const o = q.objectives[0];
    ui.hud.set('quest', q.status === 'active' ? `${q.title}: ${o.count}/${o.target}` : q.status === 'done' ? 'Neighbours met. The land goes on.' : 'Find a hamlet and say hello');
    ui.hud.set('coins', story.getVar('coins'));
    ui.hud.set('stones', story.getVar('stones'));
    const near = story.view().active ? null : nearest();
    text('prompt', 'bottom-center', ws.waiting ? 'Rendering the land ahead...' : ws.atEdge ? 'The baked world ends here' : shared.bot.on ? 'Auto-play: wandering (B stops it)' : near ? `Space: talk to the ${near.kind === 'knight' ? 'watchman' : 'villager'}` : '');
    text('net', 'top-left', `${state.biome}, ${Math.abs(Math.round(ws.player.x))} ${ws.player.x < 0 ? 'west' : 'east'} ${Math.abs(Math.round(ws.player.y))} ${ws.player.y < 0 ? 'north' : 'south'}${fly ? ', flying' : ''}`);
  }
  function talk(e) {
    story.setVar('place', placeName(e.home[0] * 31 + e.home[1]));
    story.start(e.kind === 'knight' ? 'watch' : 'folk');
    e.halt = true; talkingTo = e; shared.worldTalking = e; walkTo = null;
    sound.play('blip', { volume: 0.5 });
  }
  function endTalk() {
    const e = talkingTo; talkingTo = null; shared.worldTalking = null;
    if (!e) return;
    e.halt = false;
    if (met.has(e.id)) return;
    met.add(e.id);
    story.progress('neighbours.greet');
    if (e.kind === 'villager') { const { left } = items.inventory.add('apple', 2); ui.toast(left ? 'Your bag is full' : 'The villager hands you two apples'); }
  }
  /** Loot lies near every hamlet, once: the same things for the same hamlet, whatever the order of visits. */
  function scatterLoot() {
    for (const e of ws.people) {
      const key = e.home.join(',');
      if (looted.has(key)) continue;
      looted.add(key);
      const got = items.lootAt(7, e.home[0] + 4, e.home[1] - 3);
      if (got.coins) story.setVar('coins', story.getVar('coins') + got.coins); // loose coins by the road
    }
  }
  function ambience(dt) {
    const biome = state.biome;
    if (biome !== lastBiome) { if (lastBiome) ui.toast(biome[0].toUpperCase() + biome.slice(1), 1.5); lastBiome = biome; }
    if (biome === 'water' || biome === 'shore' || biome === 'fen') { lap -= dt; if (lap <= 0) { lap = 4; sound.play('splash', { volume: 0.12, pitch: 0.6 }); if (biome !== 'shore') shared.fx.burst('splash', { x: ws.player.x, y: ws.player.y }); } }
    sound.ambience(biome === 'steppe' || biome === 'rocky hill' ? dt * 0.4 : dt); // fewer birds where there are no trees
  }
  function sounds() {
    const p = ws.player;
    for (const e of p.events ?? []) if (e === 'step') { const running = Math.hypot(p.vx, p.vy) > p.actor.walkSpeed * 1.5; sound.step(1, 0, running); if (running) shared.fx.burst('dust', { x: p.x, y: p.y, count: 2 }); } else if (e === 'thud') sound.play('thud', { volume: 0.7 });
    for (const c of ws.people) for (const e of c.events ?? []) if (e === 'step') { const h = sound.at(c.x, c.y, p); sound.step(h.near * 0.8, h.pan); }
  }
  function autoplay(dt) { // the bot here only wanders from person to person and says hello, with the real keys
    const held = autoplay.held ??= new Set();
    const hold = (codes) => { for (const c of [...held]) if (!codes.includes(c)) { input.release(c); held.delete(c); } for (const c of codes) if (!held.has(c)) { input.press(c); held.add(c); } };
    if (autoplay.tap) { input.release(autoplay.tap); autoplay.tap = null; }
    if (!shared.bot.on || ui.isOpen() || game.scenes.current !== 'world') { hold([]); return; } // a menu is the player's business
    autoplay.wait = (autoplay.wait ?? 0) - dt;
    if (story.view().active) { hold([]); if (autoplay.wait <= 0) { input.press('Enter'); autoplay.tap = 'Enter'; autoplay.wait = 0.9; } return; }
    const goal = ws.people.filter((e) => !met.has(e.id)).sort((a, b) => Math.hypot(a.x - ws.player.x, a.y - ws.player.y) - Math.hypot(b.x - ws.player.x, b.y - ws.player.y))[0];
    if (goal && Math.hypot(goal.x - ws.player.x, goal.y - ws.player.y) < 2) { hold([]); if (autoplay.wait <= 0) { input.press('Space'); autoplay.tap = 'Space'; autoplay.wait = 0.6; } return; }
    autoplay.turn = (autoplay.turn ?? 0) - dt;
    if (!goal && autoplay.turn <= 0) { autoplay.heading = [[1, 0.3], [0.3, 1], [-1, 0.4], [0.5, -1]][Math.floor(seconds / 9) % 4]; autoplay.turn = 9; }
    const [gx, gy] = goal ? [goal.x - ws.player.x, goal.y - ws.player.y] : autoplay.heading ?? [1, 0.3];
    const keys = keysToward(ws.view, gx, gy);
    // blocked (water, a wall): slide off to one side for a moment
    autoplay.still = Math.hypot(ws.player.vx, ws.player.vy) < 0.2 ? (autoplay.still ?? 0) + dt : 0;
    if (autoplay.still > 0.7) { autoplay.dodge = 0.8; autoplay.still = 0; }
    if ((autoplay.dodge ?? 0) > 0) { autoplay.dodge -= dt; hold(keysToward(ws.view, -gy, gx)); } else hold(goal ? keys : [...keys, 'ShiftLeft']);
  }

  const scene = {
    state,
    enter(params = {}) {
      ui.closeAll(); ui.hud.visible = true; shared.mode = 'world'; game.resize();
      if (ui.hud.has('hp')) ui.hud.remove('hp'); // health belongs to the hamlet's fights
      story.reset(); items.reset(params.saved?.items ?? null);
      shared.sheet.reset(params.saved?.sheet ?? null); // before the fights: they heal the hero to the sheet's health
      shared.fight.away(); shared.worldFight.reset(params.saved?.fight ?? null); // the one combat holds the open world's fighters now
      met = new Set(params.saved?.met ?? []); looted = new Set(params.saved?.looted ?? []); seconds = params.saved?.seconds ?? 0;
      if (params.saved?.story) story.load(params.saved.story);
      shared.shop.sync();
      shared.eventsNew('world');
      if (params.saved?.events) { try { shared.events.load(params.saved.events); } catch { /* an older save */ } }
      if (params.saved?.sky) { try { shared.sky.load(params.saved.sky); } catch { /* an older save: keep the hour */ } }
      if (params.saved?.weather) { try { shared.weather.load(params.saved.weather); } catch { /* an older save: keep the weather */ } }
      if (params.bot) shared.bot.on = true; else shared.bot.stop();
      sound.music('world');
      failed = null;
      // loaded only now, so a page that cannot have the open world (or a broken world module) still gets its title and hamlet
      loading = (ws ? Promise.resolve(ws) : import('../world-stage.js').then((m) => m.createWorldStage({ canvas: game.canvas, query: shared.stage.query, width: game.width, height: game.height })))
        .then(async (stage) => { shared.world = stage; if (!ws) shared.worldWalk.attach(stage); stage.sky = shared.sky; // the first-person and orbit views light themselves from it
          shared.worldFight.attach(stage); if ('cameraPerFrame' in stage) stage.cameraPerFrame = true; if ('detail' in stage && shared.detail) stage.detail = shared.detail; if (stage.sceneCamera && 'levelBias' in stage.sceneCamera) stage.sceneCamera.levelBias = shared.levelBias ?? 0; stage.setViewDetail?.(shared.detail ?? 3); if (!ws && stage.camera) attachCameraMouse(stage.camera, game.canvas, { degreesPerPixel: -0.4, threshold: 8, buttons: [0, 1], wheelKeys: 'held', enabled: () => shared.worldMouseOn() }); shared.items.reset(params.saved?.items ?? null); if (params.saved?.world) await stage.load(params.saved.world); else if (ws) await stage.load({ ...stage.save(), ...shared.worldStart, world: {} }); ws = stage; shared.world = stage; shared.worldStart ??= { x: stage.player.x, y: stage.player.y }; loading = null; })
        .catch((e) => { failed = e; loading = null; });
    },
    exit() { if (talkingTo) talkingTo.halt = false; talkingTo = null; shared.bot.on = false; autoplay(0); shared.mode = 'hamlet'; game.resize(); },
    /** Plain data for a save slot. */
    save() { return { v: 1, mode: 'world', world: ws.save(), story: story.save(), events: shared.events.save(), sheet: shared.sheet.save(), items: items.save(), sky: shared.sky.save(), weather: shared.weather.save(), fight: shared.worldFight.save(), met: [...met], looted: [...looted], seconds: Math.round(seconds) }; },
    update(dt) {
      if (failed) { // no pages to be had (a plain static host): the fixed hamlet is always there
        ui.toast('The open world needs its page server (node examples/scene-demo/serve.mjs). Showing the hamlet instead.', 6);
        game.scenes.go('play', {});
        return;
      }
      if (!ws || loading) return;
      blend.remember([ws.player, ...ws.people]);
      autoplay(dt);
      if (shared.uiBusy()) return;
      if (input.pressed('bot')) { shared.bot.on = !shared.bot.on; ui.toast(shared.bot.on ? 'Auto-play on: wandering and greeting. B stops it.' : 'Auto-play off'); }
      seconds += dt; bob += dt;
      if (story.view().active) {
        box.update(dt, shared.uiInput);
        if (input.pressed('cancel')) story.close();
        shared.worldWalk.update(dt); ws.update(dt); sounds(); ambience(dt); refreshHud();
        if (!story.view().active) endTalk();
        return;
      }
      if (talkingTo) endTalk();
      if (input.pressed('pause') || input.pressed('cancel')) { shared.menus.openPause(); return; }
      if (input.pressed('log')) { shared.menus.openLog(); return; }
      if (ws.camera) updateCameraInput(ws.camera, input); // Q and E turn, + and - zoom, as in the hamlet
      if (ws.camera && input.pressed('camera-reset')) ws.camera.zoomTo(1).rotateTo(0);
      if (input.pressed('crt')) shared.settings.set('crt', !shared.crt.on);
      shared.controls.zoom = (n) => ws.camera?.zoomBy(n);
      shared.controls.update(dt);
      const foeNear = shared.controls.nearestFoe(shared.worldFight.combat, 14);
      if (input.pressed('axe')) { if (!shared.combatView.throwAxe(aimPoint(8))) ui.toast('No axes left', 1.2); }
      if (input.pressed('throw') && !shared.controls.useHeld() && foeNear) shared.combatView.throwAxe(aimPoint(8)); // F: food or tea, else an axe at an enemy near by
      if (input.pressed('swap')) shared.combatView.swapWeapon();
      if (input.pressed('depth')) ws.occlude = !ws.occlude;
      if (input.pressed('fly')) { fly = !fly; ui.toast(fly ? 'Flying: through everything, twice as fast' : 'Walking'); }
      if (input.pressed('wave')) { waving = !waving; ws.player.actor.wave(waving); }
      if (waving && ws.player.actor.animator.layerState('upper') === 'none') ws.player.actor.wave(true); // a swing interrupts a wave
      if (input.pressed('fall')) { if (ws.player.actor.state === 'die') ws.player.actor.revive(); else ws.player.actor.die(); }
      const p = input.pointer; // a click that did not drag walks toward that spot
      if (p.pressed) press = ui.pointerUsed ? null : { x: p.x, y: p.y };
      let aim = null;
      if (p.released && press) {
        if (Math.hypot(p.x - press.x, p.y - press.y) <= 8 && (ws.firstPerson?.mode ?? 'iso') !== 'iso') { // first person or orbit: a click swings ahead in a fight, and never walks
          if (shared.controls.nearestFoe(shared.worldFight.combat, 10)) aim = lookAhead(3);
        } else if (Math.hypot(p.x - press.x, p.y - press.y) <= 8) {
          const g = groundUnder(ws.view, ws.rect, p.x, p.y);
          const at = g ? { x: g.x + ws.page.ox, y: g.y + ws.page.oy } : null;
          // with an enemy near, a click swings toward the mouse; otherwise it walks there
          if (at && shared.controls.nearestFoe(shared.worldFight.combat, 10)) aim = at; else if (at) walkTo = { ...at, time: 0 };
        }
        press = null;
      }
      intent.dx = input.axis('left', 'right') || input.stick.x; intent.dy = input.axis('up', 'down') || input.stick.y;
      intent.run = input.down('run'); intent.fly = fly;
      if (intent.dx || intent.dy) walkTo = null; else if (walkTo) {
        const dx = walkTo.x - ws.player.x; const dy = walkTo.y - ws.player.y; walkTo.time += dt;
        if (Math.hypot(dx, dy) < 0.3 || walkTo.time > 20) walkTo = null; else [intent.dx, intent.dy] = screenDirection(ws.view, dx, dy);
      }
      const slow = shared.worldFight.walkScale(); intent.dx *= slow; intent.dy *= slow; // slower while swinging or guarding
      shared.worldWalk.update(dt); // tells each resident which corner of its path to walk to next
      ws.update(dt, intent);
      if (Math.hypot(ws.player.vx, ws.player.vy) > 0.2) { const v = Math.hypot(ws.player.vx, ws.player.vy); facing.x = ws.player.vx / v; facing.y = ws.player.vy / v; }
      shared.controls.now.moving = Math.hypot(ws.player.vx, ws.player.vy) > 0.2;
      shared.controls.now.aimAt = foeNear ? facePoint() : null;
      shared.worldFight.update(dt, input, facing, aim, !nearest());
      shared.fxTick(dt);
      if (!shared.away()) shared.weatherTick(dt, { x: ws.player.x, y: ws.player.y });
      { const foe = shared.controls.nearestFoe(shared.worldFight.combat, 14); sound.danger(foe ? 1 - Math.hypot(foe.x - ws.player.x, foe.y - ws.player.y) / 14 : 0); }
      scatterLoot();
      items.update(dt, ws.player.x, ws.player.y);
      sounds(); ambience(dt);
      if (input.pressed('confirm') && !ui.pointerUsed) { const e = nearest(); if (e) talk(e); }
      refreshHud();
    },
    draw(ctx) {
      if (!ws) {
        ctx.fillStyle = '#10131f'; ctx.fillRect(0, 0, game.width, game.height);
        ctx.fillStyle = '#c8c8d8'; ctx.font = '20px Consolas, monospace'; ctx.textAlign = 'center';
        ctx.fillText(failed ? 'No open world here' : 'Rendering the first page of the world...', game.width / 2, game.height / 2);
        ctx.textAlign = 'left';
        return;
      }
      // loot on the ground is drawn by the stage with everything else, so it hides behind trees too
      ws.extras.length = 0;
      for (const d of items.drops.items) ws.extras.push({ x: d.x, y: d.y, puppet: sack.puppet, draw: (c, view, rect, lx, ly, occlude) => sack(c, view, rect, lx, ly, occlude) });
      // shown between the last two ticks, with the camera eased once per drawn frame
      // The sky. The world stage fades between two looks of its pages itself (setLook); while the
      // pages for a new look are still arriving, the picture on screen is tinted to the right light.
      const l = shared.skyFrame();
      const drawAll = () => blend.draw(game.alpha, [ws.player, ...ws.people], () => { if (ws.cameraPerFrame && ws.camera) ws.camera.update(game.frameSeconds); ws.draw(); });
      let tint;
      if (typeof ws.setLook === 'function') {
        ws.setLook(l);
        drawAll();
        const on = ws.lookShowing ?? { a: 'day' };
        const same = on.a === l.a && (l.mix > 0 ? on.b === l.b : true);
        tint = same ? l : shared.look.tintFor(on.a, shared.skyNow(), tintOut);
      } else { // an older stage: switch the pages when the base picture changes
        if (retry > 0) retry -= game.frameSeconds;
        if (l.base !== asked && !asking && retry <= 0) {
          const name = asked = l.base; asking = true;
          ws.setSceneOptions(name === 'day' ? {} : { time: name }).then(() => { showing = name; asking = false; }, () => { asking = false; retry = 5; asked = showing; });
        }
        drawAll();
        tint = shared.look.tintFor(showing, shared.sky.now, tintOut);
      }
      if (tint && !tint.identity && tint.multiply) drawGrade(ctx, 0, 0, game.width, game.height, tint.multiply, gradeCache);
      ctx.save();
      ctx.font = `bold ${Math.round(22 * game.pixelRatio)}px Consolas, monospace`; ctx.textAlign = 'center';
      for (const e of ws.people) { // a mark over people not greeted yet
        if (met.has(e.id)) continue;
        const pt = ws.toScreen(e.x, e.y, 2.4); if (pt.visible === false) continue;
        const py = pt.y - 6 + Math.sin(bob * 4) * 3;
        ctx.fillStyle = '#10131f'; ctx.fillText('!', pt.x + 1.5, py + 1.5);
        ctx.fillStyle = '#ffd166'; ctx.fillText('!', pt.x, py);
      }
      ctx.restore();
      shared.fxDraw(ctx, { toScreen: (x, y, h) => ws.toScreen(x, y, h), cellPx: ws.shown?.cellPx ?? 4 });
      shared.weatherDraw(ctx, ws.camera?.yaw ?? 45, ws.firstPerson?.mode ?? 'iso');
      shared.combatView.draw(ctx);
      shared.worldFight.draw(ctx);
      shared.eventsDraw(ctx);
      shared.drawUi(ctx, box);
    },
  };
  shared.worldScene = scene;
  return scene;
}
