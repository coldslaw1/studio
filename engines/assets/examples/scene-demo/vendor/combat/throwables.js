// Things that can be thrown: knives, axes, rocks, spears, fire bottles.
// A definition says how it flies and what happens when it hits a fighter, a
// wall or the ground. Definitions live in the config, never in saved state.
import { need, positive, isId } from './util.js';

const DEFAULTS = {
  radius: 0.12, damage: 3, scale: 0.5, type: 'pierce', speed: 14, loft: 8, gravity: 1, spin: 720, drag: 0,
  windup: 0.16, recovery: 0.22, onHit: 'stick', onWall: 'stick', onGround: 'rest', bounce: 0.45, friction: 0.6,
  maxBounces: 3, restSpeed: 1.2, knockback: 3, hitstop: 0.05, stagger: 0.2, statuses: [], crit: null,
  blockable: true, parryable: true, blade: null, blunt: 0.5, splash: null, pickup: true, restTtl: 30, stuckTtl: 3,
  life: 8, grace: 0.15, item: null,
};
const LENGTHS = ['radius', 'speed', 'restSpeed', 'knockback'];

/**
 * checkThrowable(def, id, unit = 1) -> the throwable with defaults filled in. Lengths in `def` are in game units.
 *   radius, damage, scale (share of the thrower's attack added), type, speed (throw speed), loft (degrees upward when
 *   thrown without an aim point), gravity (multiplier), spin (degrees per second), drag (share of speed lost per second),
 *   windup, recovery (seconds), onHit: 'stick' | 'bounce' | 'drop' | 'break' | 'pierce',
 *   onWall: 'stick' | 'bounce' | 'drop' | 'break', onGround: 'stick' | 'bounce' | 'rest' | 'break',
 *   bounce (speed kept), friction (ground speed kept per bounce), maxBounces, restSpeed, knockback, hitstop, stagger,
 *   statuses, crit, blockable, parryable, blade: null | degrees (a spinning weapon only sticks while the blade leads,
 *   otherwise it hits for `blunt` times the damage and bounces), splash: null | { radius, damage, type, statuses },
 *   pickup, restTtl (seconds it lies around; null = forever), stuckTtl (seconds it stays in a living fighter),
 *   life (longest flight), grace (seconds it cannot hit its thrower), item (inventory item id it stands for)
 */
export function checkThrowable(def, id, unit = 1) {
  const where = `checkThrowable("${id}")`;
  need(isId(id), `checkThrowable: a throwable needs an id, got ${String(id)}`);
  need(def && typeof def === 'object', `${where}: must be an object`);
  for (const key of Object.keys(def)) need(key in DEFAULTS, `${where}: unknown field "${key}". Fields: ${Object.keys(DEFAULTS).join(', ')}`);
  const t = { ...DEFAULTS, ...def, id };
  for (const key of LENGTHS) if (!(key in def)) t[key] = DEFAULTS[key] * unit;
  for (const key of ['radius', 'damage', 'scale', 'speed', 'gravity', 'drag', 'windup', 'recovery', 'bounce', 'friction', 'restSpeed', 'knockback', 'hitstop', 'stagger', 'blunt', 'life', 'grace', 'stuckTtl']) positive(t[key], `${where}: ${key}`);
  need(t.speed > 0 && t.radius > 0, `${where}: speed and radius must be above 0`);
  need(['stick', 'bounce', 'drop', 'break', 'pierce'].includes(t.onHit), `${where}: onHit must be stick, bounce, drop, break or pierce`);
  need(['stick', 'bounce', 'drop', 'break'].includes(t.onWall), `${where}: onWall must be stick, bounce, drop or break`);
  need(['stick', 'bounce', 'rest', 'break'].includes(t.onGround), `${where}: onGround must be stick, bounce, rest or break`);
  need(t.blade === null || (t.blade > 0 && t.blade <= 360), `${where}: blade is null or degrees 1..360`);
  t.statuses = t.statuses.map((s) => (typeof s === 'string' ? { id: s } : { ...s }));
  if (t.splash) {
    t.splash = { radius: unit, damage: t.damage, type: t.type, statuses: [], ...t.splash };
    t.splash.statuses = t.splash.statuses.map((s) => (typeof s === 'string' ? { id: s } : { ...s }));
    positive(t.splash.radius, `${where}: splash radius`);
  }
  return t;
}

/**
 * THROWABLES(unit = 1) -> the built-in throwables, sized for a world where one metre is `unit` game units:
 * knife (sticks), axe (spins, sticks only blade first), rock (bounces), spear (heavy, sticks), firebomb (breaks and burns).
 */
export function THROWABLES(unit = 1) {
  const u = unit;
  return {
    knife: { radius: 0.1 * u, damage: 2.5, type: 'pierce', speed: 16 * u, spin: 0, loft: 5, knockback: 2 * u, crit: { chance: 0.15, mult: 2 } },
    axe: { radius: 0.16 * u, damage: 4.5, type: 'slash', speed: 12 * u, spin: 900, loft: 12, blade: 200, knockback: 5 * u, hitstop: 0.09, stagger: 0.35, statuses: [{ id: 'bleed', chance: 0.4 }] },
    rock: { radius: 0.12 * u, damage: 2, type: 'blunt', speed: 13 * u, spin: 360, loft: 14, onHit: 'bounce', onWall: 'bounce', onGround: 'bounce', knockback: 4 * u, stagger: 0.3 },
    spear: { radius: 0.12 * u, damage: 5, scale: 0.8, type: 'pierce', speed: 15 * u, spin: 0, loft: 10, gravity: 0.8, onGround: 'stick', knockback: 7 * u, hitstop: 0.1, stagger: 0.4, windup: 0.26, recovery: 0.3 },
    firebomb: { radius: 0.14 * u, damage: 1, scale: 0, type: 'fire', speed: 10 * u, spin: 540, loft: 28, onHit: 'break', onWall: 'break', onGround: 'break', pickup: false, parryable: false, knockback: 1 * u,
      splash: { radius: 1.6 * u, damage: 2, type: 'fire', statuses: [{ id: 'burn' }] } },
  };
}
