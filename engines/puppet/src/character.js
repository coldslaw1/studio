// The easy way in: one call gives a rigged, animated character with foot IK, springs and a
// head that can look at things. The game owns movement; each frame it tells the character
// where it is and how fast it is going, and the character animates to match.
import { createPuppet } from './puppet.js';
import { createAnimator } from './animator.js';
import { createFootIk, createLookAt } from './ik.js';
import { createSprings } from './spring.js';
import { MODELS } from './characters.js';
import { humanoidAnimator } from './clips-humanoid.js';
import { damp, dampAngle, yawFromVelocity } from './math.js';

/**
 * @param {object} [o]
 * @param {string|object} [o.model]   'villager' | 'knight' | 'skeleton', or a model object { def, equipment, height?, animator? }:
 *   a rig description with its equipment, such as the ones Kiln's asset generator makes. Its own height and
 *   animator are used unless `height` or `animator` is given here. A rig that is not two-legged needs an animator.
 * @param {number} [o.height]         World units tall (default 1.8).
 * @param {number} [o.scale]          Extra size multiplier for drawing (default 1).
 * @param {Object<string,string>} [o.colors]     Colour overrides.
 * @param {Object<string,object|null>} [o.equipment]  Slot overrides: an item, or null to leave a default slot empty.
 * @param {(x:number, y:number) => number} [o.groundAt]  World ground height; turns on foot IK.
 * @param {number[]} [o.wind]         Steady wind for capes and plumes.
 * @param {number} [o.gust]           0..1 wind variation (needs rng).
 * @param {() => number} [o.rng]      Injected random source.
 * @param {number} [o.turnRate]       How fast the character turns to face its movement (default 12 per second).
 * @param {object} [o.animator]       A full animator description to use instead of humanoidAnimator().
 * @returns {object} character
 */
export function createCharacter(o = {}) {
  const given = o.model && typeof o.model === 'object' ? o.model : null;
  const height = o.height ?? given?.height ?? given?.def?.meta?.height ?? 1.8;
  if (!(height > 0)) throw new Error(`createCharacter: "height" must be a positive number, got ${height}`);
  const model = typeof (o.model ?? 'villager') === 'string' ? MODELS[o.model ?? 'villager'] : () => o.model;
  if (!model) throw new Error(`createCharacter: unknown model "${o.model}". Models: ${Object.keys(MODELS).join(', ')}`);
  const built = model({ height, colors: o.colors });
  if (!built || !built.def) throw new Error('createCharacter: "model" must be a model name or { def, equipment }');
  const equipment = { ...(built.equipment ?? {}), ...(o.equipment ?? {}) };
  for (const k of Object.keys(equipment)) if (!equipment[k]) delete equipment[k];
  const puppet = createPuppet(built.def, { equipment, colors: given ? o.colors : undefined, scale: o.scale ?? 1, position: o.position, yaw: o.yaw });
  const rig = puppet.rig;
  const animDef = o.animator ?? built.animator ?? humanoidAnimator({ height });
  const animator = createAnimator(rig, animDef);
  const walkSpeed = (animator.clips.walk?.meta.stride ?? height) / (animator.clips.walk?.duration ?? 1);
  // foot IK needs legs: a slime or a bat simply goes without
  const feet = o.groundAt && (rig.chains.legL || rig.chains.legR) ? createFootIk(rig, { groundAt: o.groundAt }) : null;
  const look = rig.has('head') ? createLookAt(rig) : null;
  const springs = rig.springs.length ? createSprings(rig, { wind: o.wind, gust: o.gust, rng: o.rng }) : null;
  if (look) puppet.use(look);
  if (feet) puppet.use(feet);
  if (springs) puppet.use(springs);
  let last = null;

  const character = {
    puppet, rig, animator, feet, look, springs,
    /** Ground speed (world units per second) at which the walk cycle matches the ground. Running is about 2.6 times this. */
    walkSpeed: walkSpeed * puppet.scale,
    /** Current animation state: move, jump, fall, land, hurt or die. */
    get state() { return animator.state; },
    /**
     * Call once per frame.
     * @param {number} dt  Seconds.
     * @param {{x?:number, y?:number, z?:number, vx?:number, vy?:number, vz?:number, grounded?:boolean, facing?:number}} [m]
     *   Where the character is and how it moves. Velocity defaults to the change in position; z defaults
     *   to groundAt(x, y) when grounded. `facing` (degrees) overrides the automatic turn toward movement.
     * @returns {string[]} Animation events this frame, e.g. "step", "hit", "land", "enter:jump".
     */
    update(dt, m = {}) {
      if (!(dt >= 0)) throw new Error(`character.update: dt must be seconds >= 0, got ${dt}`);
      const grounded = m.grounded ?? true;
      const p = puppet.position;
      const x = m.x ?? p[0]; const y = m.y ?? p[1];
      const z = m.z ?? (grounded && o.groundAt ? o.groundAt(x, y) : p[2]);
      const vx = m.vx ?? (last && dt > 0 ? (x - last[0]) / dt : 0);
      const vy = m.vy ?? (last && dt > 0 ? (y - last[1]) / dt : 0);
      const vz = m.vz ?? (last && dt > 0 ? (z - last[2]) / dt : 0);
      p[0] = x; p[1] = y; p[2] = z;
      last = [x, y, z];
      const speed = Math.hypot(vx, vy);
      const dead = Boolean(animator.params.dead);
      animator.params.speed = damp(animator.params.speed ?? 0, dead ? 0 : speed / character.walkSpeed, 10, dt);
      animator.params.grounded = grounded;
      animator.params.vz = vz;
      if (!dead) {
        if (typeof m.facing === 'number') puppet.yaw = dampAngle(puppet.yaw, m.facing, o.turnRate ?? 12, dt);
        else if (speed > 0.05 * character.walkSpeed) puppet.yaw = dampAngle(puppet.yaw, yawFromVelocity(vx, vy), o.turnRate ?? 12, dt);
      }
      const events = animator.update(dt);
      if (feet) feet.weight = grounded && !dead ? 1 : 0;
      puppet.update(dt, animator.pose);
      return events;
    },
    /** Swing the weapon (upper body only, so it works while walking). Listen for the "hit" event to apply damage. */
    attack() { animator.trigger('attack'); return character; },
    /** Flinch. */
    hurt() { animator.trigger('hurt'); return character; },
    /** Fall over and stay down until revive(). */
    die() { animator.params.dead = true; return character; },
    revive() { animator.params.dead = false; return character; },
    /** Start or stop waving with the left arm. */
    wave(on = true) { if ((animator.layerState('upper') === 'wave') !== on && animator.layerState('upper') !== 'attack') animator.play(on ? 'wave' : 'none', { layer: 'upper', fade: 0.2 }); return character; },
    /** Look at a world point [x, y, z], or pass null to face forward. */
    lookAt(point) { if (look) look.target = point; return character; },
    /** Listen for animation events; see animator.on. */
    on(name, fn) { return animator.on(name, fn); },
    equip(slot, item) { puppet.equip(slot, item); return character; },
    unequip(slot) { return puppet.unequip(slot); },
  };
  return character;
}
