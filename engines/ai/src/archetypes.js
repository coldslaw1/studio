// Archetypes: what each kind of creature and person is like before its own seed makes it an individual.
// The names match the character types of Kiln's asset generator (generateAsset), so a generated wolf
// can be given a wolf's mind with one call. All lengths are in METRES and seconds; createAi multiplies
// lengths by its `unit` when an agent is made.
import { need, clamp, q, sortedKeys } from './util.js';
import { hashInts, hashSeed } from './rng.js';

const mob = (o) => ({ role: 'mob', brain: 'mob', faction: 'monsters', voice: 'beast', speed: 1.4, run: 3.2, hp: 10, radius: 0.35, leash: 18, fleeAt: 0.25, tactic: 'surround', pack: false, schedule: null, needs: [], ...o,
  senses: { sight: 9, fov: 140, hearing: 1, memory: 6, ...(o.senses || {}) },
  traits: { aggression: 0.6, bravery: 0.5, curiosity: 0.5, sociability: 0.3, discipline: 0.4, ...(o.traits || {}) },
  attack: { style: 'melee', range: 1.1, keep: 0, telegraph: 0.4, cooldown: 1, recover: 0.35, damage: 2, arc: 100, accuracy: 0.75, ...(o.attack || {}) } });
const npc = (o) => ({ role: 'npc', brain: 'npc', faction: 'villagers', voice: 'person', speed: 1.3, run: 3, hp: 8, radius: 0.33, leash: 400, fleeAt: 1, tactic: 'none', pack: false, schedule: 'villager', needs: ['hunger', 'rest', 'social'], ...o,
  senses: { sight: 10, fov: 150, hearing: 1, memory: 8, ...(o.senses || {}) },
  traits: { aggression: 0.1, bravery: 0.3, curiosity: 0.5, sociability: 0.6, discipline: 0.5, ...(o.traits || {}) },
  attack: { style: 'melee', range: 1, keep: 0, telegraph: 0.5, cooldown: 1.2, recover: 0.4, damage: 1, arc: 100, accuracy: 0.6, ...(o.attack || {}) } });

/**
 * ARCHETYPES -> { type: definition }. Fields: role ('mob' | 'npc'), brain (a name in BRAINS), faction, voice
 * (a name in BARKS), speed and run (m/s), hp, radius, leash (how far from home it will chase), fleeAt (share
 * of health below which it wants to run; 0 never), tactic ('surround' | 'flank' | 'swarm' | 'none'), pack
 * (keeps close to its squad), schedule (a name in SCHEDULES) and needs (names in NEEDS) for people,
 * senses { sight, fov (degrees), hearing (multiplier on a sound's loudness), memory (seconds) },
 * traits { aggression, bravery, curiosity, sociability, discipline } each 0..1,
 * attack { style: 'melee' | 'ranged' | 'charge', range, keep (preferred distance for ranged), telegraph,
 *          cooldown, recover (seconds), damage, arc (degrees), accuracy (ranged, 0..1) }.
 */
export const ARCHETYPES = {
  wolf: mob({ faction: 'wild', voice: 'beast', speed: 1.8, run: 5.2, hp: 8, radius: 0.4, fleeAt: 0.3, tactic: 'flank', pack: true, senses: { sight: 12, hearing: 1.6, memory: 9 }, traits: { aggression: 0.7, bravery: 0.45, sociability: 0.9, discipline: 0.7 }, attack: { range: 1.1, telegraph: 0.3, cooldown: 1.1, damage: 2 } }),
  boar: mob({ faction: 'wild', voice: 'boar', speed: 1.2, run: 4.2, hp: 14, radius: 0.5, leash: 12, fleeAt: 0.15, tactic: 'none', senses: { sight: 5.5, fov: 200, hearing: 0.8, memory: 4 }, traits: { aggression: 0.5, bravery: 0.8, curiosity: 0.2, sociability: 0.1 }, attack: { style: 'charge', range: 6, telegraph: 0.8, cooldown: 2.2, recover: 0.7, damage: 4, arc: 60 } }),
  rat: mob({ faction: 'vermin', voice: 'flyer', speed: 1.6, run: 4, hp: 3, radius: 0.2, leash: 10, fleeAt: 0.5, tactic: 'swarm', pack: true, senses: { sight: 6, hearing: 1.4 }, traits: { aggression: 0.5, bravery: 0.2, sociability: 0.8 }, attack: { range: 0.6, telegraph: 0.2, cooldown: 0.7, damage: 1 } }),
  bat: mob({ faction: 'vermin', voice: 'flyer', speed: 2.4, run: 5, hp: 3, radius: 0.25, leash: 14, fleeAt: 0.4, tactic: 'swarm', senses: { sight: 5, fov: 360, hearing: 2.2 }, traits: { aggression: 0.55, bravery: 0.3, curiosity: 0.8 }, attack: { range: 0.7, telegraph: 0.2, cooldown: 1.6, damage: 1 } }),
  slime: mob({ faction: 'monsters', voice: 'slime', speed: 0.8, run: 1.5, hp: 12, radius: 0.45, leash: 12, fleeAt: 0, tactic: 'swarm', senses: { sight: 6, fov: 360, hearing: 0.4, memory: 12 }, traits: { aggression: 0.8, bravery: 1, curiosity: 0.2, sociability: 0.2, discipline: 0.1 }, attack: { range: 0.8, telegraph: 0.55, cooldown: 1.4, damage: 2, arc: 360 } }),
  goblin: mob({ faction: 'goblins', voice: 'goblin', speed: 1.5, run: 3.8, hp: 6, radius: 0.3, fleeAt: 0.4, tactic: 'surround', pack: true, senses: { sight: 10, hearing: 1.2 }, traits: { aggression: 0.65, bravery: 0.25, curiosity: 0.7, sociability: 0.8, discipline: 0.3 }, attack: { range: 1, telegraph: 0.35, cooldown: 0.9, damage: 2 } }),
  orc: mob({ faction: 'orcs', voice: 'brute', speed: 1.4, run: 3.4, hp: 16, radius: 0.42, fleeAt: 0.12, tactic: 'surround', senses: { sight: 10 }, traits: { aggression: 0.85, bravery: 0.8, discipline: 0.5 }, attack: { range: 1.3, telegraph: 0.45, cooldown: 1.1, damage: 4 } }),
  ogre: mob({ faction: 'orcs', voice: 'brute', speed: 1, run: 2.4, hp: 30, radius: 0.7, leash: 14, fleeAt: 0, tactic: 'none', senses: { sight: 8, hearing: 0.7 }, traits: { aggression: 0.8, bravery: 1, curiosity: 0.2, discipline: 0.2 }, attack: { range: 1.9, telegraph: 0.9, cooldown: 2, recover: 0.8, damage: 8, arc: 120 } }),
  skeleton: mob({ faction: 'undead', voice: 'undead', speed: 1.2, run: 2.6, hp: 9, fleeAt: 0, tactic: 'surround', senses: { sight: 9, hearing: 0.5, memory: 15 }, traits: { aggression: 0.8, bravery: 1, curiosity: 0.1, discipline: 0.9 }, attack: { range: 1.2, telegraph: 0.45, cooldown: 1.1, damage: 3 } }),
  ghoul: mob({ faction: 'undead', voice: 'undead', speed: 1.1, run: 4, hp: 12, fleeAt: 0, tactic: 'swarm', senses: { sight: 7, hearing: 1.8, memory: 10 }, traits: { aggression: 0.95, bravery: 1, curiosity: 0.6, discipline: 0.1 }, attack: { range: 1, telegraph: 0.3, cooldown: 0.8, damage: 3 } }),
  imp: mob({ faction: 'demons', voice: 'goblin', speed: 1.8, run: 4.2, hp: 5, radius: 0.28, fleeAt: 0.35, tactic: 'none', senses: { sight: 12 }, traits: { aggression: 0.7, bravery: 0.35, curiosity: 0.8 }, attack: { style: 'ranged', range: 9, keep: 6, telegraph: 0.5, cooldown: 1.6, damage: 2 } }),
  golem: mob({ faction: 'constructs', voice: 'undead', speed: 0.9, run: 1.8, hp: 40, radius: 0.7, leash: 8, fleeAt: 0, tactic: 'none', senses: { sight: 7, fov: 360, hearing: 0.2, memory: 3 }, traits: { aggression: 0.6, bravery: 1, curiosity: 0, discipline: 1 }, attack: { range: 1.8, telegraph: 1, cooldown: 2.4, recover: 0.9, damage: 9, arc: 90 } }),
  bandit: mob({ faction: 'bandits', voice: 'rogue', speed: 1.5, run: 3.8, hp: 10, fleeAt: 0.25, tactic: 'flank', pack: true, senses: { sight: 11, hearing: 1.2 }, traits: { aggression: 0.6, bravery: 0.45, discipline: 0.6, sociability: 0.6 }, attack: { range: 1.2, telegraph: 0.35, cooldown: 1, damage: 3 } }),
  cultist: mob({ faction: 'cult', voice: 'rogue', speed: 1.3, run: 3.2, hp: 7, fleeAt: 0.1, tactic: 'none', pack: true, senses: { sight: 11 }, traits: { aggression: 0.7, bravery: 0.9, discipline: 0.8 }, attack: { style: 'ranged', range: 10, keep: 7, telegraph: 0.7, cooldown: 2, damage: 3 } }),
  villager: npc({}),
  farmer: npc({ schedule: 'farmer', hp: 10, traits: { bravery: 0.4, sociability: 0.5 } }),
  merchant: npc({ schedule: 'merchant', traits: { sociability: 0.85, bravery: 0.2 } }),
  smith: npc({ schedule: 'villager', hp: 12, traits: { bravery: 0.6, sociability: 0.4 } }),
  priest: npc({ schedule: 'villager', traits: { bravery: 0.5, sociability: 0.7, discipline: 0.9 } }),
  elder: npc({ speed: 0.9, run: 1.8, hp: 5, traits: { sociability: 0.8, curiosity: 0.3 } }),
  child: npc({ speed: 1.5, run: 3.6, hp: 4, radius: 0.25, needs: ['hunger', 'rest'], traits: { curiosity: 0.95, sociability: 0.9, bravery: 0.15, discipline: 0.1 } }),
  noble: npc({ schedule: 'merchant', traits: { sociability: 0.5, bravery: 0.2, discipline: 0.7 } }),
  bard: npc({ schedule: 'innkeeper', traits: { sociability: 1, curiosity: 0.8 } }),
  innkeeper: npc({ schedule: 'innkeeper', traits: { sociability: 0.9 } }),
  guard: npc({ brain: 'guard', faction: 'guards', voice: 'guard', schedule: 'guard', hp: 16, run: 3.6, leash: 30, fleeAt: 0.1, tactic: 'surround', needs: ['hunger', 'rest'], senses: { sight: 13, hearing: 1.3 }, traits: { aggression: 0.6, bravery: 0.9, discipline: 0.95, sociability: 0.4 }, attack: { range: 1.4, telegraph: 0.35, cooldown: 0.9, damage: 4 } }),
};

/** TRAITS -> the five personality numbers every agent has. */
export const TRAITS = ['aggression', 'bravery', 'curiosity', 'sociability', 'discipline'];

/**
 * personality(seed, base, spread = 0.18) -> traits. Each of the base traits is shifted by a fixed amount
 * in -spread..spread that depends only on the seed, so two wolves from different seeds differ a little
 * and the same seed always gives the same wolf.
 */
export function personality(seed, base, spread = 0.18) {
  const s = typeof seed === 'number' ? seed | 0 : hashSeed(seed);
  const out = {};
  TRAITS.forEach((t, i) => { out[t] = q(clamp((base[t] ?? 0.5) + (hashInts(s, 101 + i) / 4294967296 * 2 - 1) * spread, 0, 1)); });
  return out;
}

/** checkArchetype(def, name) -> def. Throws when a definition added by a game is missing a field. */
export function checkArchetype(def, name) {
  need(def && (def.role === 'mob' || def.role === 'npc'), `createAi: archetype "${name}" needs role 'mob' or 'npc'`);
  for (const k of ['speed', 'run', 'hp', 'radius']) need(def[k] > 0, `createAi: archetype "${name}" needs ${k} above 0, got ${String(def[k])}`);
  need(def.senses && def.traits && def.attack, `createAi: archetype "${name}" needs senses, traits and attack (start from ARCHETYPES.goblin or ARCHETYPES.villager and change fields)`);
  need(['melee', 'ranged', 'charge'].includes(def.attack.style), `createAi: archetype "${name}" attack.style must be melee, ranged or charge`);
  return def;
}

const RANGED_WEAPONS = ['bow', 'crossbow', 'sling', 'staff', 'wand'];
// usual body height of each type in metres, to tell a huge ogre from a plain one (anything not listed: 1.75)
const HEIGHTS = { wolf: 0.9, boar: 0.8, rat: 0.3, bat: 0.4, slime: 0.7, goblin: 1.25, orc: 1.9, ogre: 2.65, imp: 1, golem: 2.6, child: 1.2, elder: 1.65 };

/**
 * agentFromAsset(asset, extra) -> options for ai.add(). `asset` is what Kiln's generateAsset returns
 * (it reads asset.type, asset.kind, asset.seed, asset.facts.bodyHeight and asset.facts.weapon). Unknown
 * types fall back to 'goblin' for mobs and 'villager' for everyone else. The body height against the
 * type's usual height becomes `size` (a huge ogre is tougher and reaches further), and a character
 * generated with a bow, staff or wand fights at range. `extra` is merged on top ({ id, x, y, squad, ... }).
 */
export function agentFromAsset(asset, extra = {}) {
  need(asset && typeof asset === 'object', 'agentFromAsset: asset must be the object generateAsset returned');
  const type = typeof asset.type === 'string' ? asset.type : '';
  const known = sortedKeys(ARCHETYPES).includes(type);
  const out = { kind: known ? type : asset.kind === 'mob' ? 'goblin' : 'villager', seed: asset.seed ?? 0 };
  const tall = asset.facts?.bodyHeight;
  if (tall > 0) out.size = q(clamp(tall / (HEIGHTS[out.kind] ?? 1.75), 0.5, 1.8));
  if (RANGED_WEAPONS.includes(asset.facts?.weapon)) out.attack = { style: 'ranged', range: 9, keep: 6, telegraph: 0.5, cooldown: 1.6 };
  return { ...out, ...extra };
}
