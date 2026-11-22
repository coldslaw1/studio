// The hamlet scene: walking, talking, picking things up, swinging, throwing, the HUD and sounds.
import { updateCameraInput } from '../vendor/camera/index.js';
import { screenDirection, groundUnder } from './nav.js';
import { propSprite } from './props.js';
import { createBlend } from './blend.js';
import { gatherHerb, useStone, stoneHit, canEnterCellar } from './model.js';


/** The title scene: the hamlet goes on behind the title menu. */
export function titleScene(game, shared) {
  const { stage, ui, sound } = shared;
  return {
    state: { scene: 'title' },
    enter() {
      shared.bot.stop(); shared.hamlet.reset(); shared.items.reset(); ui.hud.visible = false; shared.mode = 'title';
      shared.menus.openTitle(); sound.music('title');
    },
    update(dt) {
      stage.update(dt); shared.hamlet.update(dt);
    },
    draw(ctx) { shared.skyFrame(); stage.camera.update(game.frameSeconds); stage.draw(); shared.drawUi(ctx); },
  };
}

/** core scene factory for the hamlet: (game, shared) => scene. `enter({ saved, bot })`. */
export function playScene(game, shared) {
  const { stage, ui, sound, quest, hamlet, box, bot, net } = shared;
  const { input } = game;
  const { player, camera, orbit } = stage;
  const story = quest.story;
  const facing = { x: 0, y: 1 }; // ground direction the player last walked in
  const intent = { dx: 0, dy: 0, run: false };
  let walkTo = null; // { path, i } from a click on the ground
  let press = null; // where the pointer went down, to tell a click from a camera drag
  let bob = 0; let waving = false; let clickAim = null;
  const blend = createBlend();
  const sack = propSprite('sack', undefined, () => stage.detail ?? 3);
  const state = {
    scene: 'play',
    get bag() { return shared.items.inventory.snapshot(); },
    get minds() { return shared.minds.snapshot(); }, get hour() { return +shared.sky.now.hour.toFixed(2); },
    get fight() { const c = shared.fight.combat; const m = c.has('bones') ? c.fighter('bones') : null; const h = c.fighter('hero'); return { hp: h.hp, alive: h.alive, weapon: h.weapon, mob: m ? { hp: m.hp, alive: m.alive, x: m.x, y: m.y } : null }; },
    get x() { return player.body.x; }, get y() { return player.body.y; },
    get talking() { return story.view().active; },
    get quests() { return Object.fromEntries(story.quests().map((q) => [q.id, q.status])); },
    get coins() { return story.getVar('coins'); }, get stones() { return story.getVar('stones'); },
    get herbs() { return quest.herbs.filter(Boolean).length; }, get room() { return quest.room; },
    get near() { return hamlet.nearest()?.id ?? null; },
    get bot() { return { on: bot.on, goal: bot.goal, done: bot.done, log: bot.log.slice(-8) }; },
    get net() { return { on: net.on, status: net.status, others: net.others }; },
    get menu() { return ui.snapshot().screen ?? null; },
  };

  function objectiveText() {
    for (const id of ['supplies', 'practice']) {
      const q = story.quest(id);
      if (q.status !== 'active') continue;
      const o = q.objectives.find((x) => !x.done);
      if (o) return `${q.title}: ${o.text}${o.target > 1 ? ` (${o.count}/${o.target})` : ''}`;
    }
    return story.quest('supplies').status === 'done' ? 'All done. Kick the ball about, or try auto-play (B).' : 'Talk to the guard on the path';
  }
  /** A line of HUD text that is only there while it has something to say. */
  let dbg = 0;
  function text(id, anchor, value) {
    if (!value) { if (ui.hud.has(id)) ui.hud.remove(id); return; }
    if (ui.hud.has(id)) ui.hud.set(id, value); else ui.hud.add({ id, type: 'text', value, anchor });
  }
  function refreshHud() {
    dbg -= 1; if (dbg <= 0) { dbg = 60; text('debug', 'bottom-left', shared.stage.outlines ? sound.debugLine() : ''); } // with "Show collision shapes" on
    ui.hud.set('quest', objectiveText());
    ui.hud.set('coins', story.getVar('coins'));
    ui.hud.set('stones', story.getVar('stones'));
    const near = hamlet.nearest();
    text('prompt', 'bottom-center', story.view().active ? '' : bot.on ? `Auto-play: ${bot.goal || 'thinking'}  (B stops it)` : near ? `Space: ${near.label}` : '');
    text('net', 'top-left', net.on ? `Multiplayer: ${net.status}` : '');
  }

  function use(thing) {
    if (thing.kind === 'shop') { shared.shop.open(); walkTo = null; } else if (thing.kind === 'talk') { story.start(thing.id); sound.play('blip', { volume: 0.5 }); walkTo = null; } else if (thing.kind === 'herb') {
      if (gatherHerb(quest, thing.index)) { sound.play('herb'); shared.items.inventory.add('moonleaf'); }
    } else if (thing.kind === 'cellar') {
      if (canEnterCellar(quest)) { sound.play('door'); game.scenes.push('cellar'); } else { sound.play('error', { volume: 0.4 }); ui.toast(thing.label); }
    }
  }
  function throwStone() {
    if (!useStone(quest)) { ui.toast('No stones left. Tobin has more.'); sound.play('error', { volume: 0.4 }); return; }
    // a little help with aim: a throw roughly toward the practice barrel goes straight at it
    let dx = facing.x; let dy = facing.y;
    const aim = hamlet.yard.loose.find((p) => p.kind === 'target');
    if (aim) {
      const ax = aim.body.x - player.body.x; const ay = aim.body.y - player.body.y; const d = Math.hypot(ax, ay);
      if (d > 0.5 && d < 9 && (ax * dx + ay * dy) / d > 0.8) { dx = ax / d; dy = ay / d; }
    }
    hamlet.yard.throwStone(player.body.x, player.body.y, dx, dy);
    net.act('throw');
    player.actor.attack();
    sound.play('swish', { volume: 0.6, pitch: 1.3 });
  }

  function walkIntent() {
    intent.dx = input.axis('left', 'right') || input.stick.x;
    intent.dy = input.axis('up', 'down') || input.stick.y;
    intent.run = input.down('run');
    if (intent.dx || intent.dy) { walkTo = null; return; }
    if (!walkTo) return;
    const [tx, ty] = walkTo.path[walkTo.i];
    const dx = tx - player.body.x; const dy = ty - player.body.y;
    if (Math.hypot(dx, dy) < 0.3) { walkTo.i += 1; if (walkTo.i >= walkTo.path.length) walkTo = null; return; }
    [intent.dx, intent.dy] = screenDirection(stage.view, dx, dy);
    walkTo.time += game.loop.step;
    if (walkTo.time > 30) walkTo = null;
  }
  const viewMode = () => stage.firstPerson?.mode ?? 'iso';
  /** A point `d` metres ahead: where first person looks, else the way the villager walks. */
  function lookAhead(d) {
    if (viewMode() === 'first') { const a = stage.firstPerson.camera.yaw * Math.PI / 180; return { x: player.body.x + Math.cos(a) * d, y: player.body.y + Math.sin(a) * d }; }
    return { x: player.body.x + facing.x * d, y: player.body.y + facing.y * d };
  }
  /** The ground point under the mouse in the flat view, or null. */
  const mousePoint = () => (viewMode() === 'iso' ? groundUnder(stage.view, stage.rect, input.pointer.x, input.pointer.y) : null);
  /** Where the hero should face in a fight, or null for "the way it walks". */
  const facePoint = () => (viewMode() === 'first' ? lookAhead(3) : viewMode() === 'iso' && input.lastDevice === 'pointer' ? mousePoint() : null);
  /** Where a thrown axe should go. */
  const aimPoint = (d) => (viewMode() === 'iso' && input.lastDevice === 'pointer' ? mousePoint() : null) ?? lookAhead(d);
  function pointerWalk() { // a click or tap that did not drag walks to that ground point
    const p = input.pointer;
    if (p.pressed) press = ui.pointerUsed ? null : { x: p.x, y: p.y };
    if (!p.released || !press) return;
    const moved = Math.hypot(p.x - press.x, p.y - press.y); press = null;
    if (moved > 8) return;
    if ((stage.firstPerson?.mode ?? 'iso') !== 'iso') { // in first person or orbit a click is not a place on the flat picture: it swings ahead in a fight, and never walks
      if (shared.controls.nearestFoe(shared.fight.combat, 10)) clickAim = lookAhead(3);
      return;
    }
    const g = groundUnder(stage.view, stage.rect, p.x, p.y);
    if (!g) return;
    // with an enemy near, a click swings toward the mouse; otherwise it walks there
    if (shared.controls.nearestFoe(shared.fight.combat, 10)) { clickAim = g; return; }
    const path = hamlet.nav.path(player.body.x, player.body.y, g.x, g.y);
    if (path && path.length) { walkTo = { path, i: 0, time: 0 }; sound.play('tick', { volume: 0.3 }); }
  }

  function sounds() {
    for (const c of stage.actors) {
      if (!c.events || !c.events.length) continue;
      const mine = c === player;
      const heard = mine ? { near: 1, pan: 0 } : sound.at(c.body.x, c.body.y, player.body);
      for (const e of c.events) {
        if (e === 'step') { const running = Math.hypot(c.vx, c.vy) > c.actor.walkSpeed * 1.5; sound.step(heard.near * (mine ? 1 : 0.8), heard.pan, running); if (running) shared.fx.burst('dust', { x: c.body.x, y: c.body.y, count: 2 }); }
        else if (e === 'thud') sound.play('thud', { volume: 0.7 * heard.near, pan: heard.pan });
        else if (e === 'hit' && mine) {
          const struck = hamlet.yard.strike(player.body.x, player.body.y, facing.x, facing.y);
          if (struck.length) { sound.play('hit', { volume: 0.7 }); for (const s of struck) shared.fx.burst('spark', { x: s.body.x, y: s.body.y, z: 0.5, dir: [facing.x, facing.y, 0.6] }); shared.fx.kick(facing.x * 0.2, 0); }
        }
      }
    }
  }

  return {
    state,
    enter(params = {}) {
      hamlet.reset(params.saved ?? null);
      shared.items.reset(params.saved?.items ?? null);
      shared.shop.reset(params.saved?.shop ?? null); // after the quest and the bag: the purse follows the story's coins
      shared.sheet.reset(params.saved?.sheet ?? null); // before the fights: they heal the hero to the sheet's health
      shared.worldFight.away(); shared.fight.reset(); // the one combat holds the hamlet's fighters now
      shared.minds.reset();
      if (!params.saved) shared.items.lootAt(3, 41.5, 46); // something by the road to pick up
      ui.closeAll(); ui.hud.visible = true; shared.mode = 'hamlet';
      walkTo = null; facing.x = 0; facing.y = 1; waving = false;
      sound.music('hamlet');
      if (params.saved?.sky) { try { shared.sky.load(params.saved.sky); } catch { /* an older save: keep the hour */ } }
      if (params.saved?.weather) { try { shared.weather.load(params.saved.weather); } catch { /* an older save: keep the weather */ } }
      if (!params.saved) sound.play('start');
      shared.eventsNew('play');
      if (params.saved?.events) { try { shared.events.load(params.saved.events); } catch { /* an older save */ } }
      if (params.intro && !params.saved && !params.bot) shared.events.run('intro');
      if (params.bot) bot.start(); else bot.stop();
      refreshHud();
    },
    resume(result) {
      sound.music('hamlet');
      if (result && result.solved) { ui.toast('The cellar is in order'); shared.menus.saveTo(1, true); }
    },
    update(dt) {
      bot.update(dt); // presses keys through core's input, so everything below sees them as a player's
      blend.remember(stage.actors.map((c) => c.body));
      if (shared.uiBusy()) return;
      net.update(dt);
      if (input.pressed('bot')) bot.toggle();
      if (story.view().active) { // talking: the world goes on, the player stands still
        box.update(dt, shared.uiInput);
        if (input.pressed('cancel')) story.close();
        stage.update(dt); hamlet.update(dt); sounds(); sound.ambience(dt); refreshHud();
        return;
      }
      if (shared.events.busy) { // a cutscene has the controls: the world goes on, the player waits (hold Esc to skip)
        stage.update(dt); hamlet.update(dt); shared.minds.update(dt); shared.fxTick(dt);
        shared.eventsTick(dt, input); sounds(); sound.ambience(dt); refreshHud();
        return;
      }
      if (input.pressed('pause') || input.pressed('cancel')) { shared.menus.openPause(); return; }
      if (input.pressed('log')) { shared.menus.openLog(); return; }
      updateCameraInput(camera, input);
      shared.controls.zoom = (n) => camera.zoomBy(n);
      shared.controls.update(dt);
      if (input.pressed('camera-reset')) camera.zoomTo(1).rotateTo(orbit.yaws[0]);
      if (input.pressed('crt')) shared.settings.set('crt', !shared.crt.on);
      if (input.pressed('depth')) { stage.occlude = !stage.occlude; shared.settings.set('depth', stage.occlude); }
      // (the hero's swings are played by the combat: each blow of a combo is its own, see game/combat-view.js)
      const foeNear = shared.controls.nearestFoe(shared.fight.combat, 14);
      if (input.pressed('axe')) { if (!shared.combatView.throwAxe(aimPoint(8))) ui.toast('No axes left', 1.2); }
      // F uses the picked food or tea; else, with an enemy near and an axe in the bag, throws the axe; else a stone
      if (input.pressed('throw') && !shared.controls.useHeld() && !(foeNear && shared.combatView.throwAxe(aimPoint(8)))) throwStone();
      if (input.pressed('swap')) shared.combatView.swapWeapon();
      if (input.pressed('wave')) { waving = !waving; player.actor.wave(waving); net.act('wave'); }
      if (waving && player.actor.animator.layerState('upper') === 'none') player.actor.wave(true); // a swing interrupts a wave; pick it up again after
      if (input.pressed('fall')) { if (player.actor.state === 'die') player.actor.revive(); else player.actor.die(); }
      pointerWalk();
      walkIntent();
      const slow = shared.fight.walkScale(); intent.dx *= slow; intent.dy *= slow; // slower while swinging or guarding, still while knocked down
      stage.update(dt, intent);
      if (Math.hypot(player.vx, player.vy) > 0.2) { const v = Math.hypot(player.vx, player.vy); facing.x = player.vx / v; facing.y = player.vy / v; }
      hamlet.update(dt);
      shared.minds.update(dt);
      shared.fxTick(dt);
      if (!shared.away()) shared.weatherTick(dt, { x: player.body.x, y: player.body.y });
      { const foe = shared.controls.nearestFoe(shared.fight.combat, 14); sound.danger(foe ? 1 - Math.hypot(foe.x - player.body.x, foe.y - player.body.y) / 14 : 0); }
      // the hero faces the mouse's ground point while the mouse is in use and an enemy is near (in first person: where you look)
      shared.controls.now.moving = Math.hypot(player.vx, player.vy) > 0.2;
      shared.controls.now.aimAt = foeNear ? facePoint() : null;
      shared.fight.update(dt, input, facing, clickAim, !hamlet.nearest()); clickAim = null;
      shared.items.update(dt, player.body.x, player.body.y);
      shared.eventsTick(dt, input); // triggers (the dusk line) and any sequence they start
      sounds(); sound.ambience(dt);
      if (input.pressed('confirm') && !ui.pointerUsed) { const near = hamlet.nearest(); if (near) use(near); }
      bob += dt;
      refreshHud();
    },
    draw(ctx) {
      // everything is shown between its last two ticks, and the camera eases per frame, so walking is smooth at any refresh rate
      shared.skyFrame(); // the backdrop as the sky has it now
      blend.draw(game.alpha, stage.actors.map((c) => c.body), () => { stage.camera.update(game.frameSeconds); stage.draw(); });
      const { view, rect } = stage;
      for (const d of shared.items.drops.items) sack(ctx, view, rect, d.x, d.y, stage.occlude, stage.spriteScale); // loot on the ground
      ctx.save(); // quest markers bob over what the quest wants next
      ctx.font = `bold ${Math.round(22 * game.pixelRatio)}px Consolas, monospace`; ctx.textAlign = 'center';
      for (const [x, y, h] of hamlet.markers()) {
        // toScreen answers for whichever view is showing (isometric, first person, orbit)
        const p = stage.toScreen ? stage.toScreen(x, y, h) : view.toPoint(x, y, rect, view.heightAt(x, y) + h * 16);
        if (p.visible === false) continue;
        const py = p.y - 6 + Math.sin(bob * 4) * 3;
        ctx.fillStyle = '#10131f'; ctx.fillText('!', p.x + 1.5, py + 1.5);
        ctx.fillStyle = '#ffd166'; ctx.fillText('!', p.x, py);
      }
      ctx.restore();
      shared.fxDraw(ctx, { toScreen: (x, y, h) => (stage.toScreen ? stage.toScreen(x, y, h) : view.toPoint(x, y, rect, view.heightAt(x, y) + (h ?? 0) * 16)), cellPx: Math.max(1, rect.w / view.cols) });
      shared.weatherDraw(ctx, stage.camera.yaw, stage.firstPerson?.mode ?? 'iso');
      shared.eventsDraw(ctx);
      shared.combatView.draw(ctx);
      shared.fight.draw(ctx);
      shared.minds.draw(ctx);
      net.draw(ctx);
      shared.drawUi(ctx, box);
    },
    /** For the auto-play bot and the tests. */
    facing,
    onTargetHit() { stoneHit(quest); sound.play('coin'); },
  };
}
