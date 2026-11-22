// Factions: who may hurt whom. Two fighters of the same faction are friendly,
// two different factions are hostile unless the config says otherwise.
import { need } from './util.js';

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * createFactions(options) -> { relation(a, b), hostile(a, b), scale(source, target, via) }
 *   allies:  [['player', 'guard'], ...]    pairs that count as friendly
 *   neutral: [['player', 'villager'], ...] pairs that ignore each other (mobs do not aggro on them)
 *   hostile: [['wolf', 'wolf'], ...]       pairs that fight, even inside one faction
 *   other = 'hostile'                      relation of two different factions not listed above
 *   friendlyFire = 0                       share of damage friends take: 0 none, 1 full. Or { melee, projectile }
 *   neutralFire = 0                        the same for neutral pairs
 *   selfHit = 0                            share of damage from your own thrown weapon (a bounce coming back)
 * relation() returns 'friendly', 'neutral' or 'hostile'. scale() returns the damage multiplier
 * for a hit; 0 means the hit does not connect at all.
 */
export function createFactions(options = {}) {
  const table = new Map();
  for (const [name, rel] of [['allies', 'friendly'], ['neutral', 'neutral'], ['hostile', 'hostile']]) {
    for (const pair of options[name] || []) {
      need(Array.isArray(pair) && pair.length === 2 && pair.every((p) => typeof p === 'string'), `createFactions: ${name} must be a list of [factionA, factionB] pairs`);
      table.set(key(pair[0], pair[1]), rel);
    }
  }
  const other = options.other ?? 'hostile';
  need(['hostile', 'neutral', 'friendly'].includes(other), `createFactions: other must be hostile, neutral or friendly, got "${other}"`);
  const share = (value, via, what) => {
    const v = value && typeof value === 'object' ? (value[via] ?? 0) : (value ?? 0);
    need(v >= 0 && v <= 1, `createFactions: ${what} must be 0..1 (or { melee, projectile }), got ${String(v)}`);
    return v;
  };
  for (const via of ['melee', 'projectile']) { share(options.friendlyFire, via, 'friendlyFire'); share(options.neutralFire, via, 'neutralFire'); }
  const selfHit = share(options.selfHit, 'projectile', 'selfHit');

  const factions = {
    /** relation(a, b) -> 'friendly' | 'neutral' | 'hostile' for two faction names. */
    relation(a, b) {
      const listed = table.get(key(a, b));
      if (listed) return listed;
      return a === b ? 'friendly' : other;
    },
    hostile: (a, b) => factions.relation(a, b) === 'hostile',
    /**
     * scale(source, target, via) -> damage multiplier. source and target are fighters (source may be null
     * for the world itself); via is 'melee', 'projectile' or 'status'.
     */
    scale(source, target, via = 'melee') {
      if (!source || via === 'status') return 1;
      if (source.id === target.id) return via === 'projectile' ? selfHit : 0;
      const rel = factions.relation(source.faction, target.faction);
      if (rel === 'hostile') return 1;
      return share(rel === 'friendly' ? options.friendlyFire : options.neutralFire, via, 'fire');
    },
  };
  return factions;
}
