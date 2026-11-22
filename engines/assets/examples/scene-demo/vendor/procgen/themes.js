// Content tables: what lives in each kind of dungeon, house and camp. All plain data, so a game
// can pass its own. Creature kinds are the ai engine's archetypes (which are also the character
// types of Kiln's generator). Prop names are procgen's own; adapters.js maps them to Kiln shapes.

/**
 * DUNGEON_THEMES -> { name: theme }
 *   mobs      [[kind, weight, minLevel], ...]   who walks the rooms
 *   boss      kind of the boss in the last room
 *   props     [[prop, weight], ...]             scenery
 *   style     the studio style it suits (storybook, nocturne, papercut, crypt)
 *   faction   for the ai and combat engines
 */
export const DUNGEON_THEMES = {
  crypt: { mobs: [['skeleton', 5, 1], ['rat', 3, 1], ['bat', 3, 1], ['ghoul', 3, 3], ['cultist', 2, 4]], boss: 'ghoul', props: [['gravestones', 4], ['pillar', 3], ['torch', 4], ['altar', 1], ['statue', 1], ['rubble', 2]], style: 'crypt', faction: 'undead' },
  cave: { mobs: [['rat', 3, 1], ['bat', 4, 1], ['slime', 4, 1], ['goblin', 4, 2], ['orc', 2, 4]], boss: 'ogre', props: [['rubble', 6], ['campfire', 1], ['crates', 1], ['barrels', 1], ['torch', 2]], style: 'nocturne', faction: 'monsters' },
  hideout: { mobs: [['bandit', 6, 1], ['rat', 1, 1], ['wolf', 1, 2]], boss: 'bandit', props: [['crates', 4], ['barrels', 4], ['table', 2], ['weapon_rack', 2], ['torch', 3], ['bench', 1]], style: 'storybook', faction: 'bandits' },
  temple: { mobs: [['cultist', 5, 1], ['imp', 3, 2], ['skeleton', 2, 2], ['golem', 1, 5]], boss: 'golem', props: [['pillar', 5], ['statue', 3], ['altar', 2], ['banner', 2], ['cauldron', 1], ['torch', 4]], style: 'crypt', faction: 'cult' },
  warren: { mobs: [['goblin', 6, 1], ['rat', 2, 1], ['orc', 2, 3], ['imp', 1, 3]], boss: 'orc', props: [['woodpile', 2], ['crates', 2], ['campfire', 2], ['banner', 1], ['rubble', 3], ['cauldron', 1]], style: 'storybook', faction: 'goblins' },
};

/**
 * INTERIOR_TYPES -> { name: type }
 *   size      [cols, rows] default outer size in tiles (walls included)
 *   rooms     roles handed to the rooms, biggest room first; extra rooms get the last role
 *   people    [{ kind, role, work, home }] who lives or works here; work / home are room roles
 */
export const INTERIOR_TYPES = {
  cottage: { size: [11, 9], rooms: ['main', 'bedroom', 'pantry'], people: [{ kind: 'villager', role: 'owner', work: 'main', home: 'bedroom' }] },
  farmhouse: { size: [13, 10], rooms: ['main', 'bedroom', 'pantry', 'bedroom'], people: [{ kind: 'farmer', role: 'owner', work: 'main', home: 'bedroom' }, { kind: 'child', role: 'family', work: 'main', home: 'bedroom' }] },
  inn: { size: [17, 12], rooms: ['common', 'kitchen', 'bedroom', 'bedroom', 'store', 'bedroom'], people: [{ kind: 'innkeeper', role: 'owner', work: 'common', home: 'bedroom' }, { kind: 'bard', role: 'guest', work: 'common', home: 'bedroom' }] },
  smithy: { size: [12, 9], rooms: ['forge', 'store', 'bedroom'], people: [{ kind: 'smith', role: 'owner', work: 'forge', home: 'bedroom' }] },
  shop: { size: [12, 9], rooms: ['shopfloor', 'store', 'bedroom'], people: [{ kind: 'merchant', role: 'owner', work: 'shopfloor', home: 'bedroom' }] },
  chapel: { size: [11, 14], rooms: ['nave', 'vestry'], people: [{ kind: 'priest', role: 'owner', work: 'nave', home: 'vestry' }] },
  cellar: { size: [10, 8], rooms: ['store', 'store'], people: [] },
};

/**
 * ROOM_FURNITURE -> { role: [[prop, where, solid], ...] } in the order it is placed.
 * where: 'wall' (against a wall), 'corner', 'middle'.
 */
export const ROOM_FURNITURE = {
  main: [['table', 'middle', true], ['hearth', 'wall', true], ['bench', 'wall', true], ['barrels', 'corner', true], ['rug', 'middle', false]],
  common: [['table', 'middle', true], ['table', 'middle', true], ['counter', 'wall', true], ['hearth', 'wall', true], ['bench', 'wall', true], ['barrels', 'corner', true]],
  bedroom: [['bed', 'wall', true], ['chest', 'corner', true], ['rug', 'middle', false]],
  kitchen: [['cauldron', 'wall', true], ['table', 'middle', true], ['barrels', 'corner', true], ['crates', 'corner', true]],
  pantry: [['barrels', 'corner', true], ['crates', 'corner', true], ['shelf', 'wall', true]],
  store: [['crates', 'corner', true], ['barrels', 'corner', true], ['shelf', 'wall', true], ['chest', 'wall', true]],
  forge: [['anvil', 'middle', true], ['hearth', 'wall', true], ['weapon_rack', 'wall', true], ['trough', 'wall', true], ['woodpile', 'corner', true]],
  shopfloor: [['counter', 'middle', true], ['shelf', 'wall', true], ['shelf', 'wall', true], ['crates', 'corner', true]],
  nave: [['altar', 'wall', true], ['bench', 'middle', true], ['bench', 'middle', true], ['statue', 'corner', true], ['banner', 'wall', false]],
  vestry: [['bed', 'wall', true], ['chest', 'corner', true], ['shelf', 'wall', true]],
};

/**
 * CAMP_TYPES -> { name: type }
 *   radius    how far the camp reaches from its centre, metres
 *   hostile   false for camps you can talk to
 *   band      [[kind, min, max], ...] who is there; the first entry gives the leader
 *   ring      props standing in a ring round the fire: [[prop, min, max], ...]
 *   scatter   props scattered between the ring and the edge
 *   fire      true when there is a fire in the middle
 *   biomes    world biomes it may stand in (omit for any)
 *   spacing, chance   how often the world engine places it (tiles between sites, share used)
 */
export const CAMP_TYPES = {
  bandit_camp: { radius: 9, hostile: true, faction: 'bandits', fire: true, band: [['bandit', 3, 5]], ring: [['tent', 2, 3]], scatter: [['crates', 1, 2], ['barrels', 1, 2], ['weapon_rack', 0, 1], ['cart', 0, 1]], palisade: true, spacing: 144, chance: 0.5, names: ['Cutpurse', 'Red Knife', 'Black Sash', 'Crow', 'Hollow'] },
  goblin_camp: { radius: 8, hostile: true, faction: 'goblins', fire: true, band: [['goblin', 3, 6], ['orc', 0, 1]], ring: [['tent', 1, 3]], scatter: [['banner', 1, 2], ['woodpile', 0, 2], ['cauldron', 0, 1], ['crates', 0, 1]], spacing: 128, chance: 0.5, names: ['Snaggletooth', 'Mudfoot', 'Boneheap', 'Rat-Eater', 'Sourmoss'] },
  wolf_den: { radius: 7, hostile: true, faction: 'wild', fire: false, band: [['wolf', 3, 5]], ring: [['rock', 3, 5]], scatter: [['rock', 1, 3]], biomes: ['forest', 'taiga', 'meadow'], spacing: 120, chance: 0.4, names: ['Greyfang', 'Howling', 'Lean Winter', 'Moonback'] },
  hunter_camp: { radius: 6, hostile: false, faction: 'villagers', fire: true, band: [['farmer', 1, 2]], ring: [['tent', 1, 1]], scatter: [['woodpile', 1, 1], ['weapon_rack', 0, 1], ['barrels', 0, 1]], biomes: ['forest', 'taiga', 'meadow'], spacing: 160, chance: 0.4, names: ['Quiet Arrow', 'Long Trail', 'Ash Bough', 'Hart'] },
  merchant_camp: { radius: 7, hostile: false, faction: 'villagers', fire: true, band: [['merchant', 1, 1], ['guard', 1, 2]], ring: [['tent', 1, 1], ['stall', 1, 1]], scatter: [['cart', 1, 1], ['crates', 1, 2], ['barrels', 0, 1]], biomes: ['meadow', 'steppe'], spacing: 176, chance: 0.35, names: ['Far Road', 'Honest Scales', 'Three Mules', 'Lucky Wheel'] },
  ruin: { radius: 8, hostile: true, faction: 'undead', fire: false, band: [['skeleton', 2, 4], ['ghoul', 0, 1]], ring: [['ruin', 1, 1]], scatter: [['rubble', 2, 4], ['pillar', 1, 3], ['gravestones', 0, 2], ['statue', 0, 1]], spacing: 136, chance: 0.45, names: ['Old Watch', 'Fallen Hall', 'Sunken Chapel', 'Broken Crown'] },
  shrine: { radius: 5, hostile: false, faction: 'villagers', fire: false, band: [['priest', 0, 1]], ring: [['statue', 1, 1]], scatter: [['altar', 1, 1], ['banner', 0, 2], ['bench', 0, 1], ['torch', 1, 2]], spacing: 168, chance: 0.35, names: ['Quiet Mother', 'Wayfarer', 'Morning Star', 'Green Saint'] },
  graveyard: { radius: 8, hostile: true, faction: 'undead', fire: false, band: [['skeleton', 1, 3], ['ghoul', 1, 2]], ring: [['gravestones', 4, 7]], scatter: [['gravestones', 2, 4], ['statue', 0, 1], ['torch', 0, 2]], fence: true, spacing: 152, chance: 0.35, names: ['Pauper', 'Last Rest', 'Nameless', 'Hollow Hill'] },
  dungeon_entrance: { radius: 6, hostile: true, faction: 'monsters', fire: false, band: [['rat', 0, 2], ['bat', 0, 2]], ring: [['ruin', 1, 1]], scatter: [['rubble', 2, 4], ['pillar', 0, 2], ['torch', 1, 2]], entrance: true, spacing: 200, chance: 0.5, names: ['Deep Stair', 'Black Door', 'Cold Mouth', 'Under-Hall'] },
};

/** Props nobody can walk through. Everything else (rugs, banners, torches on a wall) is walked over or past. */
export const SOLID_PROPS = new Set(['crates', 'barrels', 'table', 'bench', 'statue', 'campfire', 'chest', 'gravestones', 'weapon_rack', 'anvil', 'woodpile', 'cauldron', 'pillar', 'altar', 'trough', 'cart', 'stall', 'tent', 'rock', 'rubble', 'ruin', 'bed', 'hearth', 'counter', 'shelf']);
