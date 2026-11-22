// Fighting in the open world: the bands at the camps (goblins, bandits, skeletons, wolves) are live
// mobs of the combat engine. The world stage walks every character with its own collision, page by
// page; combat is told where they are, gives the mobs their brains, and settles blows and health.
// Mobs come to life when their camp is near and are forgotten when it is far; the dead stay dead
// in the save.
import { generateAsset } from '../../../src/gen.js';
import { HERO_HP } from './fight.js';

const NEAR = 48; const FAR = 70; // metres: camps wake inside NEAR and sleep beyond FAR
const KINDS = {
  // the combat demo's three brains: goblins keep their distance and throw rocks, bandits come on behind a shield and
  // strike twice, skeletons and wolves close in and bite
  goblin: { hp: 6, weapon: 'dagger', speed: 2.6, more: { throwable: 'rock' }, ai: { brain: 'thrower', keep: 6, telegraph: 0.5, cooldown: 1.4 } },
  bandit: { hp: 9, weapon: 'rustyBlade', speed: 2.3, more: { shield: 'shield', poise: 0.2 }, ai: { brain: 'guard', combo: 2, telegraph: 0.5, cooldown: 1.2 } },
  skeleton: { hp: 8, weapon: 'rustyBlade', speed: 2.0 },
  wolf: { hp: 7, weapon: 'fists', speed: 3.2 },
};

/**
 * @param {object} game    The game (loop for hit-stop, pixelRatio).
 * @param {object} shared  { sound, ui, items }.
 * @param {() => number} rng
 * @returns {object} fight: { combat, attach(ws), update(dt, input, facing), walkScale(), draw(ctx), save(), reset(saved), mobs }
 */
export function createWorldFight(game, shared, rng) {
  const { sound, ui, items } = shared;
  let ws = null;
  // The game's one combat (the base's combat plugin, see game/index.js): the hero is in it already, the
  // camps' mobs join when their camp is near. It works in the game's metres, which here are world metres;
  // the collision plugin holds the current page's world and knows where the page starts.
  const combat = game.base.plugin('combat').combat;

  const mobs = new Map(); // id -> { id, key, character, site }
  let dead = new Set(); // "tx,ty,index" of mobs that were beaten
  let down = 0; let scan = 0; let warned = false; let on = false; let wasDodging = false;

  combat.on('hit', (e) => {
    if (!on || game.base.mode !== 'world') return;
    if (e.target === 'hero') { if (!e.blocked) ws.player.actor.hurt?.(); } else mobs.get(e.target)?.character.actor.hurt?.();
    // sparks where the blow lands, a nudge of the screen; a kill adds a flash and a puff
    const hitAt = combat.has(e.target) ? combat.fighter(e.target) : null;
    if (hitAt && shared.fx) {
      const from = combat.has(e.source) ? combat.fighter(e.source) : null;
      const dx = from ? hitAt.x - from.x : 0; const dy = from ? hitAt.y - from.y : 0; const d = Math.hypot(dx, dy) || 1;
      shared.fx.burst('spark', { x: hitAt.x, y: hitAt.y, z: 1, dir: [dx / d, dy / d, 0.6] });
      shared.fx.kick((dx / d) * (e.blocked ? 0.12 : 0.3), 0);
      if (e.killed) { shared.fx.flash('#ffffff', 0.08, 0.3); shared.fx.burst('poof', { x: hitAt.x, y: hitAt.y, z: 0.8 }); }
    }
    if (e.killed) game.loop.hitStop?.(0.08);
  });
  combat.on('attack', (e) => { mobs.get(e.id)?.character.actor.attack?.(); });
  combat.on('death', (e) => {
    if (!on || game.base.mode !== 'world') return;
    if (e.id === 'hero') { down = 3; ws.player.actor.die?.(); ui.toast('You are knocked down', 2.5); return; }
    const mob = mobs.get(e.id);
    if (!mob) return;
    dead.add(mob.key); mob.gone = 1.5; mob.character.actor.die?.();
    const f = combat.fighter(e.id);
    const got = items.lootAt(mob.site.seed, f.x, f.y);
    if (got.coins) { const story = shared.quest.story; story.setVar('coins', story.getVar('coins') + got.coins); ui.toast(`${got.coins} coins`, 1.4); } // what the band carried
    sound.play('quest');
    if (![...mobs.values()].some((m) => m.site === mob.site && !dead.has(m.key))) ui.toast('The camp is cleared', 3);
  });

  function wake(site) {
    ws.campMobs(site).forEach((spec, i) => {
      const key = `${site.tx}.${site.ty}.${i}`; const id = `mob:${key}`;
      if (dead.has(key) || mobs.has(id)) return;
      const asset = generateAsset({ describe: spec.describe, seed: spec.seed });
      const character = ws.addCharacter(asset.model, spec.x, spec.y, { height: asset.height, animator: asset.model.animator });
      const kind = KINDS[spec.kind] ?? KINDS.bandit;
      combat.addFighter(id, { faction: 'mob', x: spec.x, y: spec.y, facing: spec.yaw, hp: kind.hp, maxHp: kind.hp, weapon: kind.weapon, speed: kind.speed, external: true, ...(kind.more ?? {}), ai: { brain: 'melee', sight: 8, leash: 14, home: { x: spec.x, y: spec.y }, telegraph: 0.45, cooldown: 1, ...(kind.ai ?? {}) } });
      mobs.set(id, { id, key, character, site, kind: spec.kind });
      shared.sheet.mob(id, { goblin: 'goblin', bandit: 'bandit', skeleton: 'campSkeleton', wolf: 'wolf' }[spec.kind] ?? 'bandit');
    });
  }
  function sleep(mob) {
    ws.removeCharacter(mob.character);
    if (combat.has(mob.id)) combat.removeFighter(mob.id);
    shared.sheet.gone(mob.id);
    mobs.delete(mob.id);
  }
  function look() { // which camps are near enough to matter
    const p = ws.player;
    for (const site of ws.terrain.poisIn(Math.floor(p.x - NEAR), Math.floor(p.y - NEAR), Math.ceil(p.x + NEAR), Math.ceil(p.y + NEAR))) if (site.name === 'camp') wake(site);
    for (const mob of [...mobs.values()]) if (Math.hypot(mob.site.tx - p.x, mob.site.ty - p.y) > FAR) sleep(mob);
  }

  const fight = {
    combat, mobs,
    /** Use this world stage (called when the open world scene has one). */
    attach(stage) { ws = stage; },
    walkScale() { return down > 0 ? 0 : combat.moveScale('hero'); },
    /** One tick, after the stage has moved the player. `facing` is the player's ground direction. */
    update(dt, input, facing, aim = null, free = true) {
      if (!ws) return;
      on = true;
      const p = ws.player;
      scan -= dt; if (scan <= 0) { scan = 1; look(); }
      if (down > 0) { down -= dt; if (down <= 0) { combat.revive('hero', combat.fighter('hero').maxHp); combat.fighter('hero').iframes = 1.5; p.actor.revive?.(); } } // a moment to get clear
      combat.place('hero', p.x, p.y, ws.groundAt(p.x, p.y));
      const act = shared.controls.drive(combat, facing, aim, free); // keys, mouse and touch, with aim help
      combat.step(dt);
      if (act.dodging && !wasDodging) shared.fx?.burst('dust', { x: p.x, y: p.y, count: 5 });
      wasDodging = act.dodging;
      const push = combat.pushOf('hero'); // the roll, a blow's lunge and knockback go through the page's own collision
      if (push && (push.dx || push.dy) && p.body) ws.collision.move(p.body, push.dx, push.dy);
      let close = false;
      for (const mob of [...mobs.values()]) {
        const f = combat.fighter(mob.id); const c = mob.character;
        if (mob.gone > 0) { mob.gone -= dt; if (mob.gone <= 0) sleep(mob); continue; }
        // the brain says where it wants to go; the stage walks it there with collision
        const k = f.speed * combat.moveScale(mob.id) * dt; const kb = combat.pushOf(mob.id) ?? { dx: 0, dy: 0 };
        const x0 = c.x; const y0 = c.y;
        c.move((f.input.moveX || 0) * k + kb.dx, (f.input.moveY || 0) * k + kb.dy);
        c.vx = (c.x - x0) / dt; c.vy = (c.y - y0) / dt;
        combat.place(mob.id, c.x, c.y, ws.groundAt(c.x, c.y));
        if (Math.hypot(c.x - p.x, c.y - p.y) < 10) close = true;
      }
      shared.combatView.update(dt);
      if (close && !warned) { warned = true; ui.toast('A camp. They do not look friendly. J swings, H guards.', 4); }
      if (mobs.size || combat.fighter('hero').hp < HERO_HP) { if (!ui.hud.has('hp')) ui.hud.add({ id: 'hp', type: 'bar', label: 'HP', value: HERO_HP, max: HERO_HP, anchor: 'top-left' }); ui.hud.set('hp', Math.max(0, combat.fighter('hero').hp)); }
    },
    /** Health over each mob's head, and a warning mark while it winds up. */
    draw(ctx) {
      if (!ws) return;
      const k = game.pixelRatio; const w = 40 * k; const h = 5 * k;
      ctx.save();
      for (const mob of mobs.values()) {
        const f = combat.fighter(mob.id);
        if (!f.alive) continue;
        const pt = ws.toScreen(f.x, f.y, 2.0);
        if (pt.visible === false) continue;
        ctx.fillStyle = '#10131f'; ctx.fillRect(pt.x - w / 2 - 1, pt.y - h - 1, w + 2, h + 2);
        ctx.fillStyle = '#d0483c'; ctx.fillRect(pt.x - w / 2, pt.y - h, w * Math.max(0, f.hp / f.maxHp), h);
        const move = combat.moveOf(mob.id);
        if (move && move.phase === 'windup') { ctx.font = `bold ${Math.round(20 * k)}px Consolas, monospace`; ctx.textAlign = 'center'; ctx.fillStyle = '#ff6a4a'; ctx.fillText('!', pt.x, pt.y - h - 6 * k); }
      }
      ctx.restore();
    },
    /** The game leaves the open world: its mobs leave the combat (the beaten stay beaten). */
    away() { shared.combatView.clear(); for (const mob of [...mobs.values()]) if (ws) sleep(mob); else mobs.delete(mob.id); on = false; scan = 0; },
    /** Plain data for a save slot: which mobs were beaten. */
    save: () => ({ dead: [...dead] }),
    /** A new game, or a loaded one. */
    reset(saved = null) {
      for (const mob of [...mobs.values()]) if (ws) sleep(mob); else mobs.delete(mob.id);
      dead = new Set(Array.isArray(saved?.dead) ? saved.dead : []);
      down = 0; scan = 0; warned = false;
      if (combat.fighter('hero').alive) combat.heal('hero', combat.fighter('hero').maxHp); else combat.revive('hero', combat.fighter('hero').maxHp);
    },
  };
  return fight;
}
