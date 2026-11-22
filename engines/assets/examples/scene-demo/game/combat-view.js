// What a fight looks like and the hero's part in it, as in the combat engine's own demo:
// red shapes on the ground where a mob is about to strike, the white arc of a blow that is landing,
// thrown axes and rocks in flight and on the ground, numbers that float off whoever was hit, "PARRY"
// and "block", a guard bar under a raised shield, the name of a status (bleed), and a flicker while
// the hero cannot be hurt. It also plays the hero's swings (each blow of a combo is its own swing),
// throws axes from the bag, picks them up again, and swaps the weapon in hand.
// Everything is placed with the showing stage's toScreen, so it works in all three views.
import { dirOf, throwFromInventory, pickupToInventory } from '../vendor/combat/index.js';

const WEAPONS = ['sword', 'blade', 'staff']; // what the swap key steps through, when the bag has them

/**
 * @param {object} game    The game (base, pixelRatio).
 * @param {object} shared  { stage, world?, items, sound, ui }.
 * @returns {object} view: { update(dt), draw(ctx), throwAxe(aim), swapWeapon(), clear() }
 */
export function createCombatView(game, shared) {
  const { base } = game;
  const combat = base.plugin('combat').combat;
  const { items, sound, ui } = shared;
  const stageNow = () => (base.mode === 'world' && shared.world ? shared.world : shared.stage);
  const heroOf = (st) => st.player;
  let floats = []; let telegraphs = [];

  const say = (x, y, z, text, color) => floats.push({ x, y, z, text, color, t: 0 });
  base.bus.on('combat:hit', (e) => {
    if (!combat.has(e.target)) return;
    const t = combat.fighter(e.target);
    say(t.x, t.y, (t.z ?? 0) + (t.height ?? 1.8), `${e.crit ? '!' : ''}${Math.round(e.damage * 10) / 10}`, e.target === 'hero' ? '#ff6b6b' : e.via === 'status' ? '#c98bff' : '#fff2b3');
  });
  base.bus.on('combat:parry', (e) => { say(e.x, e.y, (e.z ?? 1) + 0.6, 'PARRY', '#7fd4ff'); sound.play('confirm', { volume: 0.5 }); });
  base.bus.on('combat:block', (e) => say(e.x, e.y, (e.z ?? 1) + 0.6, 'block', '#9fb4c8'));
  base.bus.on('combat:guardbreak', (e) => { if (combat.has(e.id)) { const f = combat.fighter(e.id); say(f.x, f.y, 2.2, 'guard broken', '#ffb86b'); } });
  base.bus.on('combat:telegraph', (e) => { if (e.shape) telegraphs.push({ shape: e.shape, t: e.time }); });
  // every blow of a combo is its own swing of the hero's arm (the mobs' rigs are their fights' business)
  base.bus.on('combat:attack', (e) => { if (e.id === 'hero') { heroOf(stageNow()).actor.attack?.(); sound.play('swish', { volume: 0.5 }); shared.net?.act?.('swing'); } });

  function poly(ctx, st, points, fill, stroke) {
    const pts = points.map(([x, y, z]) => st.toScreen(x, y, z ?? 0.02));
    if (pts.some((p) => !p || p.visible === false || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return; // partly behind the camera: not drawn
    ctx.beginPath();
    pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, game.pixelRatio); ctx.stroke(); }
  }
  /** An arc or a box from a move's outline or a telegraph, flat on the ground. */
  function shape(ctx, st, s, fill, stroke) {
    if (!s) return;
    if (s.kind === 'box') { poly(ctx, st, s.points.map(([x, y]) => [x, y, 0.02]), fill, stroke); return; }
    const pts = []; const n = Math.max(2, Math.ceil(Math.abs(s.to - s.from) / 12));
    for (let i = 0; i <= n; i++) { const [dx, dy] = dirOf(s.from + (s.to - s.from) * i / n); pts.push([s.x + dx * s.reach, s.y + dy * s.reach, 0.02]); }
    for (let i = n; i >= 0; i--) { const [dx, dy] = dirOf(s.from + (s.to - s.from) * i / n); pts.push([s.x + dx * s.inner, s.y + dy * s.inner, 0.02]); }
    poly(ctx, st, pts, fill, stroke);
  }
  function projectile(ctx, st, p) {
    const k = game.pixelRatio;
    const ground = st.toScreen(p.x, p.y, 0.02); const s = st.toScreen(p.x, p.y, Math.max(0.05, p.z ?? 0));
    if (!s || s.visible === false) return;
    if (ground && ground.visible !== false) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(ground.x, ground.y, 5 * k, 2.5 * k, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.save();
    ctx.translate(s.x, s.y);
    if (p.kind === 'rock') { ctx.fillStyle = '#9a9a9a'; ctx.beginPath(); ctx.arc(0, 0, 3.5 * k, 0, Math.PI * 2); ctx.fill(); } else {
      ctx.rotate((p.mode === 'fly' ? (p.angle ?? 0) : 135) * Math.PI / 180);
      ctx.strokeStyle = '#8a5a33'; ctx.lineWidth = 2.5 * k; ctx.beginPath(); ctx.moveTo(-7 * k, 0); ctx.lineTo(6 * k, 0); ctx.stroke();
      ctx.fillStyle = '#cfd6e4'; ctx.fillRect(2 * k, -5 * k, 6 * k, 6 * k);
    }
    ctx.restore();
  }

  const view = {
    /** Once per tick of a scene that fights, after the combat has stepped. */
    update(dt) {
      for (const f of floats) f.t += dt;
      floats = floats.filter((f) => f.t < 0.9);
      for (const t of telegraphs) t.t -= dt;
      telegraphs = telegraphs.filter((t) => t.t > 0);
      const hero = combat.fighter('hero');
      if (hero.alive) { const got = pickupToInventory(combat, 'hero', items.inventory); if (got.ok) { sound.play('pickup', { volume: 0.5 }); ui.toast('Picked the axe up again', 1.2); } } // walking over a thrown axe
      // while the hero cannot be hurt (just hit, or rolling) the flat picture's villager flickers
      const st = stageNow(); const me = heroOf(st);
      const blink = hero.alive && hero.iframes > 0 && Math.floor(hero.iframes * 20) % 2 === 1;
      if (me.blink !== blink) { me.blink = blink; me.hidden = blink; }
    },
    /** Throw one axe from the bag toward a ground point (game metres). Returns false when there is none. */
    throwAxe(aim) {
      const slot = items.inventory.list().find((s) => s.id === 'axe');
      if (!slot) return false;
      const r = throwFromInventory(combat, 'hero', items.inventory, slot.index, { aim });
      if (r.ok) sound.play('swish', { volume: 0.6, pitch: 0.8 });
      return r.ok;
    },
    /** Put the next weapon from the bag in the hand (only between blows). */
    swapWeapon() {
      if (combat.fighter('hero').act.kind !== 'idle') return false;
      const inv = items.inventory; const have = WEAPONS.filter((id) => inv.count(id) > 0 || inv.equipment().mainHand?.id === id);
      if (have.length < 2 && !(have.length === 1 && inv.equipment().mainHand?.id !== have[0])) { ui.toast('No other weapon in the bag', 1.4); return false; }
      const now = inv.equipment().mainHand?.id ?? null;
      const want = have[(have.indexOf(now) + 1) % have.length];
      const slot = inv.list().find((s) => s.id === want);
      if (!slot) return false;
      inv.equip(slot.index);
      ui.toast(items.catalog.get(want).name, 1.2); sound.play('tick', { volume: 0.4 });
      return true;
    },
    /** Leaving a stage: nothing of its fights stays in the air or on the ground. */
    clear() { floats = []; telegraphs = []; combat.state.projectiles = []; const me = heroOf(stageNow()); if (me.blink) { me.blink = false; me.hidden = false; } },
    /** Over the world, under the HUD. */
    draw(ctx) {
      const st = stageNow();
      if (!st?.toScreen) return;
      const k = game.pixelRatio;
      ctx.save();
      for (const t of telegraphs) shape(ctx, st, t.shape, 'rgba(255,80,60,0.22)', 'rgba(255,120,90,0.7)');
      for (const f of combat.fighters()) {
        if (!f.alive) continue;
        const m = combat.moveOf(f.id);
        if (m && m.phase === 'active') shape(ctx, st, m.outline, 'rgba(255,255,255,0.3)', null);
        // the guard bar under a raised shield, and the names of what ails the fighter
        const p = st.toScreen(f.x, f.y, (f.height ?? 1.8) + 0.25);
        if (!p || p.visible === false) continue;
        const w = 40 * k;
        if (f.guard?.on) {
          const full = combat.config.shields[f.shield]?.guard ?? combat.config.weapons[f.weapon]?.guard?.guard ?? 1;
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p.x - w / 2 - 1, p.y + 3 * k, w + 2, 3 * k + 2);
          ctx.fillStyle = '#7fd4ff'; ctx.fillRect(p.x - w / 2, p.y + 3 * k + 1, w * Math.max(0, Math.min(1, f.guard.meter / full)), 3 * k);
        }
        if (f.statuses?.length) { ctx.fillStyle = '#c98bff'; ctx.font = `${Math.round(11 * k)}px Consolas, monospace`; ctx.textAlign = 'center'; ctx.fillText(f.statuses.map((x) => x.id).join(' '), p.x, p.y - 10 * k); }
      }
      for (const p of combat.projectiles) projectile(ctx, st, p);
      ctx.textAlign = 'center'; ctx.font = `bold ${Math.round(14 * k)}px Consolas, monospace`;
      for (const f of floats) {
        const p = st.toScreen(f.x, f.y, f.z + f.t * 1.2);
        if (!p || p.visible === false) continue;
        ctx.globalAlpha = 1 - f.t / 0.9;
        ctx.fillStyle = '#10131f'; ctx.fillText(f.text, p.x + k, p.y + k);
        ctx.fillStyle = f.color; ctx.fillText(f.text, p.x, p.y);
      }
      ctx.restore();
    },
  };
  return view;
}
