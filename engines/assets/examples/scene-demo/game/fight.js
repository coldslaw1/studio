// Fighting in the hamlet, by the combat engine: a training skeleton haunts the north-west field.
// J swings what you hold (fists, or a sword or staff equipped from the bag), H raises a guard.
// The stage still moves the player (so walls and people stop them as always); combat is told where
// the player is, decides blows, health and knockback, and moves the skeleton itself.
import { combatAnimator, bindPuppet } from '../vendor/combat/index.js';
import { createCharacter, humanoidAnimator } from '../vendor/puppet/index.js';

const HOME = [29.5, 23.5]; // where the skeleton waits, away from the quest's paths
export const HERO_HP = 12;

/**
 * @param {object} game    The game (loop, for hit-stop).
 * @param {object} shared  { stage, sound, ui, items, hamlet }.
 * @param {() => number} rng
 * @returns {object} fight: { combat, mob, update(dt, input, facing), walkScale(), draw(ctx), reset() }
 */
export function createFight(game, shared, rng) {
  const { stage, sound, ui, items } = shared;
  const { collision, layers, player } = stage;
  const combat = game.base.plugin('combat').combat; // the game's one combat, with its hero (see game/index.js)
  const here = () => game.base.mode !== 'world';
  const maxHp = () => combat.fighter('hero').maxHp; // the hero's sheet sets it: it grows with the level // the same combat also holds the open world's fights: this file acts on the hamlet's only

  // the skeleton: a puppet with combat's own animation states, drawn by the stage like everyone else
  const home = shared.hamlet.nav.open(HOME[0], HOME[1]) ? HOME : [33, 26];
  const bones = createCharacter({ model: 'skeleton', groundAt: stage.groundAt, rng, animator: combatAnimator(humanoidAnimator()) });
  bones.update(0);
  const spawn = () => { shared.sheet.gone('bones'); addBones(); shared.sheet.mob('bones', 'skeleton'); };
  const addBones = () => combat.addFighter('bones', { faction: 'mob', x: home[0], y: home[1], hp: 10, maxHp: 10, weapon: 'rustyBlade', speed: 2.2, ai: { brain: 'melee', sight: 6, leash: 10, home: { x: home[0], y: home[1] }, telegraph: 0.45, cooldown: 0.9 } });
  spawn();
  const bound = bindPuppet(combat, 'bones', bones);
  // the stage animates its actors by calling actor.update; for the skeleton that is combat's binding
  const actor = Object.create(bones, { update: { value: (dt) => { if (!combat.has('bones')) return []; const e = bound.update(dt * combat.timeScale('bones')); return Array.isArray(e) ? e : []; } } });
  const mob = { name: 'skeleton', actor, sprites: new WeakMap(), body: collision.add({ x: home[0], y: home[1], r: 0.36, layer: layers.CHARACTER }), vx: 0, vy: 0, hidden: false };
  stage.actors.push(mob);

  let respawn = 0; let down = 0; let warned = false; let wasDodging = false;
  combat.on('hit', (e) => {
    if (!here()) return;
    if (e.target === 'hero') { if (!e.blocked) player.actor.hurt(); ui.hud.set('hp', combat.fighter('hero').hp); }
    // sparks where the blow lands, a nudge of the screen; a kill adds a flash and a puff
    const hitAt = combat.has(e.target) ? combat.fighter(e.target) : null;
    if (hitAt && shared.fx) {
      const from = combat.has(e.source) ? combat.fighter(e.source) : null;
      const dx = from ? hitAt.x - from.x : 0; const dy = from ? hitAt.y - from.y : 0; const d = Math.hypot(dx, dy) || 1;
      shared.fx.burst('spark', { x: hitAt.x, y: hitAt.y, z: 1, dir: [dx / d, dy / d, 0.6] });
      shared.fx.kick((dx / d) * (e.blocked ? 0.12 : 0.3), 0);
      if (e.killed) { shared.fx.flash('#ffffff', 0.08, 0.3); shared.fx.burst('poof', { x: hitAt.x, y: hitAt.y, z: 0.8 }); }
    }
  }); // (the combat plugin freezes the game for a moment on a kill)
  combat.on('death', (e) => {
    if (!here()) return;
    if (e.id === 'bones') {
      respawn = 25; mob.dying = 1.6;
      const f = combat.fighter('bones');
      const got = items.lootAt(Math.round(shared.hamlet.seconds), f.x, f.y);
      if (got.coins) { const story = shared.quest.story; story.setVar('coins', story.getVar('coins') + got.coins); } // loose coins among the bones
      ui.toast(got.coins ? `The skeleton falls apart, and ${got.coins} coins with it. It will be back.` : 'The skeleton falls apart. It will be back.', 3); sound.play('quest');
    } else { down = 3; player.actor.die(); ui.toast('You are knocked down', 2.5); }
  });
  ui.hud.add({ id: 'hp', type: 'bar', label: 'HP', value: HERO_HP, max: HERO_HP, anchor: 'top-left' });

  const fight = {
    combat, mob,
    /** Share of walking speed the player has right now (slower while swinging or guarding). */
    walkScale() { return down > 0 ? 0 : combat.moveScale('hero'); },
    /** One tick, after the stage has moved the player. `facing` is the player's ground direction. */
    update(dt, input, facing, aim = null, free = true) {
      const hero = combat.fighter('hero');
      if (down > 0) { // knocked down: a short rest, then back on your feet where you fell
        down -= dt;
        if (down <= 0) { combat.revive('hero', maxHp()); combat.fighter('hero').iframes = 1.5; player.actor.revive(); ui.hud.set('hp', maxHp()); } // a moment to get clear before the next blow can land
      }
      combat.place('hero', player.body.x, player.body.y, stage.groundAt(player.body.x, player.body.y));
      const act = shared.controls.drive(combat, facing, aim, free); // keys, mouse and touch, with aim help
      combat.step(dt);
      if (act.dodging && !wasDodging) shared.fx?.burst('dust', { x: player.body.x, y: player.body.y, count: 5 });
      wasDodging = act.dodging;
      const push = combat.pushOf('hero'); // the roll, a blow's lunge and knockback: the stage's collision still decides where the player may go
      if (push && (push.dx || push.dy)) collision.move(player.body, push.dx, push.dy);
      if (combat.has('bones')) {
        const f = combat.fighter('bones');
        mob.vx = (f.x - mob.body.x) / dt; mob.vy = (f.y - mob.body.y) / dt;
        collision.teleport(mob.body, f.x, f.y);
        if (mob.dying > 0) { mob.dying -= dt; if (mob.dying <= 0) { mob.hidden = true; collision.teleport(mob.body, -50, -50); combat.removeFighter('bones'); } }
        const near = Math.hypot(f.x - player.body.x, f.y - player.body.y);
        if (near < 9 && !warned && f.alive) { warned = true; ui.toast('A training skeleton rattles nearby. J swings, H guards.', 4); }
      } else if (respawn > 0) {
        respawn -= dt;
        if (respawn <= 0) { spawn(); bound.update(0); mob.hidden = false; mob.dying = 0; collision.teleport(mob.body, home[0], home[1]); warned = false; }
      }
      shared.combatView.update(dt);
      ui.hud.set('hp', Math.max(0, hero.hp));
    },
    /** Health over the skeleton's head, and a warning mark while it winds up. */
    draw(ctx) {
      if (!combat.has('bones') || mob.hidden) return;
      const f = combat.fighter('bones');
      if (!f.alive) return;
      const p = stage.toScreen ? stage.toScreen(f.x, f.y, 2.1) : null;
      if (!p || p.visible === false) return;
      const k = game.pixelRatio; const w = 44 * k; const h = 5 * k;
      ctx.save();
      ctx.fillStyle = '#10131f'; ctx.fillRect(p.x - w / 2 - 1, p.y - h - 1, w + 2, h + 2);
      ctx.fillStyle = '#d0483c'; ctx.fillRect(p.x - w / 2, p.y - h, w * Math.max(0, f.hp / f.maxHp), h);
      const move = combat.moveOf('bones');
      if (move && move.phase === 'windup') { ctx.font = `bold ${Math.round(20 * k)}px Consolas, monospace`; ctx.textAlign = 'center'; ctx.fillStyle = '#ff6a4a'; ctx.fillText('!', p.x, p.y - h - 6 * k); }
      ctx.restore();
    },
    /** The game goes to the open world: the skeleton leaves the combat until the hamlet is back (reset). */
    away() { shared.combatView.clear(); if (combat.has('bones')) combat.removeFighter('bones'); shared.sheet.gone('bones'); mob.hidden = true; collision.teleport(mob.body, -50, -50); respawn = 0; },
    /** A new game or a loaded one: everyone back on their feet. */
    reset() {
      down = 0; respawn = 0; warned = false;
      if (combat.has('bones')) combat.removeFighter('bones');
      spawn(); bound.update(0); mob.hidden = false; mob.dying = 0; collision.teleport(mob.body, home[0], home[1]);
      if (combat.fighter('hero').alive) combat.heal('hero', maxHp()); else combat.revive('hero', maxHp());
      if (!ui.hud.has('hp')) ui.hud.add({ id: 'hp', type: 'bar', label: 'HP', value: maxHp(), max: maxHp(), anchor: 'top-left' });
      ui.hud.set('hp', maxHp());
    },
  };
  return fight;
}
