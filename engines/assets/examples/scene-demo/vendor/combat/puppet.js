// Glue to the `puppet` engine. Nothing is imported from it: pass in a puppet
// character (createCharacter) and this drives its animation from combat
// events, so the swing you see lands on the frame the damage is applied.
//
// Facing needs no conversion: combat's facing IS puppet's yaw.
import { need } from './util.js';

/**
 * combatAnimator(def, { height = 1.8 }) -> the same animator description with combat extras on its "upper" layer:
 * states `thrust`, `throw` and `block` (with their clips), and playback of the attack states scaled by the
 * `attackRate` parameter so any wind-up length can match the clip. `def` is puppet's humanoidAnimator().
 * Use it as createCharacter({ model, animator: combatAnimator(humanoidAnimator()) }).
 */
export function combatAnimator(def, options = {}) {
  need(def && def.clips && Array.isArray(def.layers), 'combatAnimator: pass puppet\'s humanoidAnimator() (it needs clips and an "upper" layer)');
  const upper = def.layers.find((l) => l.name === 'upper');
  need(upper, 'combatAnimator: the animator has no "upper" layer');
  const rate = { param: 'attackRate' };
  const clips = {
    // pull the sword hand back, then drive it straight forward; "hit" marks full extension
    thrust: { duration: 0.66, loop: false, events: [[0.24, 'hit']], tracks: {
      chest: [[0, 0, 0, 0], [0.16, 2, 0, -26, 'out'], [0.26, -8, 0, 22, 'outCubic'], [0.66, 0, 0, 0]],
      armR: [[0, 0, 6, 0], [0.16, -34, 20, 0, 'out'], [0.26, 84, 2, 0, 'outCubic'], [0.4, 78, 2, 0], [0.66, 0, 6, 0]],
      foreR: [[0, 14, 0, 0], [0.16, 96, 0, 0, 'out'], [0.26, 4, 0, 0, 'outCubic'], [0.4, 8, 0, 0], [0.66, 14, 0, 0]],
      armL: [[0, 0, -6, 0], [0.16, 20, -14, 0], [0.26, -24, -10, 0], [0.66, 0, -6, 0]],
    } },
    // overhand throw with the right arm; "release" marks the moment the weapon leaves the hand
    throw: { duration: 0.4, loop: false, events: [[0.16, 'release']], tracks: {
      chest: [[0, 0, 0, 0], [0.1, 8, 0, -24, 'out'], [0.18, -14, 0, 20, 'outCubic'], [0.4, 0, 0, 0]],
      armR: [[0, 0, 6, 0], [0.1, 190, 14, 0, 'out'], [0.18, 70, 4, 0, 'outCubic'], [0.26, 24, 4, 0], [0.4, 0, 6, 0]],
      foreR: [[0, 14, 0, 0], [0.1, 100, 0, 0, 'out'], [0.18, 6, 0, 0, 'outCubic'], [0.4, 14, 0, 0]],
      armL: [[0, 0, -6, 0], [0.1, 36, -18, 0], [0.18, -10, -10, 0], [0.4, 0, -6, 0]],
    } },
    // shield arm up across the body, held
    block: { duration: 1, loop: true, tracks: {
      chest: [[0, -4, 0, -10], [1, -4, 0, -10]],
      armL: [[0, 58, 26, 0], [1, 58, 26, 0]],
      foreL: [[0, 82, 0, 0], [1, 82, 0, 0]],
      armR: [[0, -12, 10, 0], [1, -12, 10, 0]],
    } },
  };
  const states = { ...upper.states, thrust: { clip: 'thrust', next: 'none', fade: 0.16, speed: rate }, throw: { clip: 'throw', next: 'none', fade: 0.14, speed: rate }, block: { clip: 'block' } };
  if (states.attack) states.attack = { ...states.attack, speed: rate };
  return {
    ...def, clips: { ...def.clips, ...clips }, params: { ...def.params, attackRate: 1 },
    layers: def.layers.map((l) => (l === upper ? { ...l, states } : l)),
  };
}

/**
 * bindPuppet(combat, id, character, options) -> { update(dt, extra), dispose() }
 * Makes a puppet character act out fighter `id`: swings, thrusts, throws, raising the shield, flinching, dying.
 *   scale = 1 / combat unit   puppet units per game unit (puppet works in metres)
 *   anims                     { moveName or anim: upper-layer state }, default: the move's `anim`, else 'attack'
 *   syncWindup = true         stretch the swing so its "hit" frame lands when the active window opens
 * Call binding.update(dt) every frame INSTEAD of character.update: it places the puppet at the fighter,
 * turns it to the fighter's facing and freezes it during hit-stop. `extra` is merged into character.update's
 * second argument (for example { grounded }). A fighter with timing: 'event' strikes on the puppet's "hit" event.
 */
export function bindPuppet(combat, id, character, options = {}) {
  need(character && typeof character.update === 'function' && character.animator, 'bindPuppet: pass a puppet character (createCharacter(...))');
  combat.fighter(id);
  const anim = character.animator;
  const scale = options.scale ?? 1 / combat.config.unit;
  const upperHas = (state) => { try { anim.layerState('upper'); } catch { return false; } return !!state && hasState(state); };
  // the animator does not list its layer states, so probe by trying play() once and remembering the answer
  const known = new Map();
  function hasState(state) {
    if (!known.has(state)) {
      const before = anim.layerState('upper');
      try { anim.play(state, { layer: 'upper', fade: 0 }); anim.play(before, { layer: 'upper', fade: 0 }); known.set(state, true); } catch { known.set(state, false); }
    }
    return known.get(state);
  }
  const play = (state, fade) => { if (upperHas(state)) { anim.play(state, { layer: 'upper', fade }); return true; } return false; };
  const hitTime = (clipName) => {
    const clip = anim.clips[clipName];
    const e = clip && (clip.events || []).find((x) => (Array.isArray(x) ? x[1] : x.name) === 'hit' || (Array.isArray(x) ? x[1] : x.name) === 'release');
    return e ? (Array.isArray(e) ? e[0] : e.t ?? e.time) : null;
  };
  let baseRate = 1;
  const setRate = (clipName, windup) => {
    const t = hitTime(clipName);
    baseRate = options.syncWindup !== false && t > 0 && windup > 0 ? t / windup : 1;
    anim.params.attackRate = baseRate * combat.attackSpeed(id);
  };
  const mine = (fn) => (e) => { if (e.id === id) fn(e); };
  const offs = [
    combat.on('attack', mine((e) => {
      const state = options.anims?.[e.move] ?? options.anims?.[e.anim] ?? (e.move === 'thrust' && upperHas('thrust') ? 'thrust' : e.anim);
      const used = play(state, 0.05) ? state : (play('attack', 0.05) ? 'attack' : null);
      if (used) setRate(used, e.windup); else character.attack();
    })),
    combat.on('throwStart', mine((e) => { if (play('throw', 0.04)) setRate('throw', e.windup); else if (play('attack', 0.05)) setRate('attack', e.windup); else character.attack(); })),
    combat.on('guard', mine((e) => { if (e.on) play('block', 0.08); else if (upperHas('block') && anim.layerState('upper') === 'block') anim.play('none', { layer: 'upper', fade: 0.12 }); })),
    combat.on('stagger', mine(() => { if (upperHas('none')) anim.play('none', { layer: 'upper', fade: 0.06 }); character.hurt(); })),
    combat.on('hit', (e) => { if (e.target === id && !e.killed && e.damage > 0 && !e.blocked) character.hurt(); }),
    combat.on('death', mine(() => { if (upperHas('none')) anim.play('none', { layer: 'upper', fade: 0.06 }); character.die(); })),
    combat.on('revive', mine(() => character.revive())),
    character.on('hit', () => { if (combat.has(id) && combat.fighter(id).timing === 'event') combat.strike(id); }),
  ];
  let last = null;
  return {
    /** update(dt, extra) -> the puppet's animation events this frame. */
    update(dt, extra = {}) {
      const f = combat.fighter(id);
      const x = f.x * scale; const y = f.y * scale; const z = f.z * scale;
      const vx = last && dt > 0 ? (x - last[0]) / dt : 0; const vy = last && dt > 0 ? (y - last[1]) / dt : 0;
      last = [x, y];
      anim.params.attackRate = baseRate * combat.attackSpeed(id); // chill and haste slow or speed the swing on screen too
      return character.update(dt * combat.timeScale(id), { x, y, z, vx, vy, facing: f.facing, grounded: f.vz === 0, ...extra });
    },
    /** dispose() stops listening. */
    dispose() { for (const off of offs) off(); },
  };
}
