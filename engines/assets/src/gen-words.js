// The generator's vocabulary: which kinds and types of asset exist, and how the words of a short
// description ("tall stone watchtower", "hooded goblin with a spear") turn into choices.
// Pure data plus one parser; nothing here is random.

/** Every type the generator can make, by kind. The first type of a kind is its plain default. */
export const TYPES = {
  building: ['house', 'cottage', 'hut', 'shop', 'inn', 'barn', 'smithy', 'tower', 'keep', 'chapel', 'shrine', 'lighthouse'],
  prop: ['crates', 'barrels', 'cart', 'stall', 'bench', 'table', 'fountain', 'statue', 'campfire', 'chest', 'tombstone', 'signpost', 'lamp', 'rack', 'anvil', 'woodpile', 'cauldron', 'banner', 'obelisk', 'altar', 'trough'],
  player: ['warrior', 'mage', 'ranger', 'rogue'],
  npc: ['villager', 'farmer', 'merchant', 'guard', 'priest', 'smith', 'elder', 'child', 'noble', 'bard'],
  mob: ['goblin', 'orc', 'ogre', 'skeleton', 'ghoul', 'imp', 'golem', 'bandit', 'cultist', 'wolf', 'boar', 'rat', 'slime', 'bat'],
};

export const KINDS = Object.keys(TYPES);

// word -> type (the type decides the kind). Types name themselves; these are the other words for them.
const TYPE_WORDS = {
  home: 'house', manor: 'house', cabin: 'cottage', farmhouse: 'cottage', shack: 'hut', hovel: 'hut', roundhouse: 'hut',
  store: 'shop', bakery: 'shop', market: 'stall', tavern: 'inn', pub: 'inn', stable: 'barn', granary: 'barn',
  forge: 'smithy', blacksmith: 'smithy', watchtower: 'tower', turret: 'tower', castle: 'keep', fort: 'keep', fortress: 'keep',
  church: 'chapel', temple: 'chapel', beacon: 'lighthouse',
  crate: 'crates', box: 'crates', boxes: 'crates', barrel: 'barrels', keg: 'barrels', kegs: 'barrels', wagon: 'cart', wheelbarrow: 'cart',
  booth: 'stall', seat: 'bench', desk: 'table', monument: 'statue', fire: 'campfire', bonfire: 'campfire', treasure: 'chest',
  grave: 'tombstone', gravestone: 'tombstone', headstone: 'tombstone', sign: 'signpost', lantern: 'lamp', lamppost: 'lamp', streetlamp: 'lamp',
  weapons: 'rack', logs: 'woodpile', firewood: 'woodpile', pot: 'cauldron', flag: 'banner', standard: 'banner', pillar: 'obelisk', column: 'obelisk',
  menhir: 'obelisk', pedestal: 'altar',
  fighter: 'warrior', knight: 'warrior', soldier: 'warrior', paladin: 'warrior', wizard: 'mage', sorcerer: 'mage', witch: 'mage',
  archer: 'ranger', hunter: 'ranger', scout: 'ranger', thief: 'rogue', assassin: 'rogue',
  peasant: 'villager', townsfolk: 'villager', citizen: 'villager', trader: 'merchant', shopkeeper: 'merchant', innkeeper: 'merchant',
  sentry: 'guard', watchman: 'guard', monk: 'priest', cleric: 'priest', kid: 'child', boy: 'child', girl: 'child', lord: 'noble', lady: 'noble',
  king: 'noble', queen: 'noble', minstrel: 'bard', grandmother: 'elder', grandfather: 'elder',
  troll: 'ogre', brute: 'orc', undead: 'skeleton', zombie: 'ghoul', demon: 'imp', devil: 'imp', construct: 'golem',
  robber: 'bandit', brigand: 'bandit', outlaw: 'bandit', acolyte: 'cultist', hound: 'wolf', dog: 'wolf', pig: 'boar', vermin: 'rat',
  ooze: 'slime', blob: 'slime', jelly: 'slime',
};

// word -> a trait. size: multiplier on the type's usual size. Others are tags the makers look for.
const TRAIT_WORDS = {
  tiny: { size: 0.72 }, small: { size: 0.84 }, little: { size: 0.84 }, short: { size: 0.86 }, low: { size: 0.86 },
  big: { size: 1.15 }, large: { size: 1.15 }, tall: { size: 1.18 }, grand: { size: 1.22 }, huge: { size: 1.3 }, giant: { size: 1.3 },
  stone: { material: 'stone' }, wooden: { material: 'wood' }, wood: { material: 'wood' }, timber: { material: 'wood' }, brick: { material: 'brick' },
  plaster: { material: 'cream' }, whitewashed: { material: 'white' }, iron: { material: 'steel' }, steel: { material: 'steel' },
  red: { color: 'red' }, blue: { color: 'blue' }, green: { color: 'green' }, gold: { color: 'gold' }, golden: { color: 'gold' }, yellow: { color: 'gold' },
  purple: { color: 'purple' }, white: { color: 'white' }, black: { color: 'black' }, dark: { color: 'black' }, pink: { color: 'pink' },
  brown: { color: 'brown' }, grey: { color: 'grey' }, gray: { color: 'grey' }, orange: { color: 'orange' },
  ruined: { tag: 'ruined' }, broken: { tag: 'ruined' }, abandoned: { tag: 'ruined' }, round: { tag: 'round' }, square: { tag: 'square' },
  chimney: { tag: 'chimney' }, porch: { tag: 'porch' }, awning: { tag: 'awning' }, annex: { tag: 'annex' }, rich: { tag: 'rich' }, fancy: { tag: 'rich' },
  poor: { tag: 'poor' }, ragged: { tag: 'poor' }, storey: { tag: 'storeys2' }, story: { tag: 'storeys2' }, storeys: { tag: 'storeys2' },
  armoured: { tag: 'armour' }, armored: { tag: 'armour' }, armour: { tag: 'armour' }, armor: { tag: 'armour' }, hooded: { tag: 'hood' }, hood: { tag: 'hood' },
  caped: { tag: 'cape' }, cape: { tag: 'cape' }, cloak: { tag: 'cape' }, cloaked: { tag: 'cape' }, bearded: { tag: 'beard' }, beard: { tag: 'beard' },
  bald: { tag: 'bald' }, horned: { tag: 'horns' }, horns: { tag: 'horns' }, tail: { tag: 'tail' }, tailed: { tag: 'tail' },
  fat: { tag: 'heavy' }, heavy: { tag: 'heavy' }, stout: { tag: 'heavy' }, burly: { tag: 'heavy' }, thin: { tag: 'thin' }, slim: { tag: 'thin' }, lanky: { tag: 'thin' },
  hat: { tag: 'hat' }, helm: { tag: 'helm' }, helmet: { tag: 'helm' }, crown: { tag: 'crown' }, crowned: { tag: 'crown' }, pack: { tag: 'pack' }, backpack: { tag: 'pack' },
  robe: { tag: 'robe' }, robed: { tag: 'robe' }, robes: { tag: 'robe' }, masked: { tag: 'mask' }, mask: { tag: 'mask' },
  sword: { gear: 'sword' }, blade: { gear: 'sword' }, axe: { gear: 'axe' }, mace: { gear: 'mace' }, club: { gear: 'club' }, spear: { gear: 'spear' },
  staff: { gear: 'staff' }, dagger: { gear: 'dagger' }, knife: { gear: 'dagger' }, hammer: { gear: 'hammer' }, shield: { gear: 'shield' },
  torch: { gear: 'torch' }, unarmed: { tag: 'unarmed' },
};

const KIND_WORDS = { building: 'building', buildings: 'building', prop: 'prop', props: 'prop', player: 'player', hero: 'player', heroine: 'player', adventurer: 'player', npc: 'npc', mob: 'mob', monster: 'mob', enemy: 'mob', creature: 'mob' };
const NUMBER_WORDS = { one: 1, single: 1, two: 2, double: 2, three: 3, triple: 3, four: 4, five: 5 };
const FILLER = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'in', 'on', 'for', 'to', 'its', 'his', 'her', 'their', 'that', 'has', 'holding', 'carrying', 'wearing', 'very', 'some', 'made', 'from', 'at', 'by', 'is', 'who', 'looking']);

const typeOf = (word) => {
  for (const kind of KINDS) if (TYPES[kind].includes(word)) return { kind, type: word };
  const t = TYPE_WORDS[word];
  if (t) for (const kind of KINDS) if (TYPES[kind].includes(t)) return { kind, type: t };
  return null;
};
const singular = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/**
 * Read a short description. Understood words become choices; the rest are returned in `ignored`
 * so the caller can see what had no effect. `effects` lists what each understood trait word asks
 * for, so generateAsset can report the ones the chosen type has no use for. Never throws on unknown words.
 * @param {string} text  For example "tall stone watchtower" or "hooded goblin with a spear".
 * @returns {{kind?:string, type?:string, typeKind?:string, size:number, material?:string, colors:string[], tags:string[], gear:string[], count?:number, understood:string[], ignored:string[]}}
 */
export function parseDescription(text = '') {
  if (typeof text !== 'string') throw new Error(`parseDescription: the description must be text, got ${JSON.stringify(text)}`);
  const out = { size: 1, colors: [], tags: [], gear: [], understood: [], ignored: [], effects: [] };
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    if (FILLER.has(raw)) continue;
    const word = [raw, singular(raw)].find((w) => typeOf(w) || TRAIT_WORDS[w] || KIND_WORDS[w] || NUMBER_WORDS[w] !== undefined || /^\d+$/.test(w));
    if (!word) { out.ignored.push(raw); continue; }
    out.understood.push(raw);
    const t = typeOf(word);
    // the first type word wins ("goblin guard" is a goblin); a trait with the same spelling still counts
    if (t && !out.type) { out.type = t.type; out.typeKind = t.kind; }
    else if (t) out.effects.push({ word: raw, key: 'extra type' });
    const trait = TRAIT_WORDS[word];
    if (trait && !t) {
      out.effects.push({ word: raw, key: trait.size ? 'size' : trait.material ? 'material' : trait.color ? 'colors' : trait.gear ? `gear:${trait.gear}` : `tag:${trait.tag}` });
      if (trait.size) out.size *= trait.size;
      if (trait.material) out.material = trait.material;
      if (trait.color && !out.colors.includes(trait.color)) out.colors.push(trait.color);
      if (trait.tag && !out.tags.includes(trait.tag)) out.tags.push(trait.tag);
      if (trait.gear && !out.gear.includes(trait.gear)) out.gear.push(trait.gear);
    }
    if (KIND_WORDS[word]) out.kind = KIND_WORDS[word];
    const n = NUMBER_WORDS[word] ?? (/^\d+$/.test(word) ? Number(word) : undefined);
    if (n !== undefined) { out.count = Math.max(1, Math.min(6, n)); out.effects.push({ word: raw, key: 'count' }); }
  }
  out.size = Math.max(0.6, Math.min(1.5, out.size));
  return out;
}

/** The words the parser understands, for `kiln generate --list` and the docs. */
export function vocabulary() {
  const traits = { sizes: [], materials: [], colors: [], features: [], gear: [] };
  for (const [w, t] of Object.entries(TRAIT_WORDS)) (t.size ? traits.sizes : t.material ? traits.materials : t.color ? traits.colors : t.gear ? traits.gear : traits.features).push(w);
  return { kinds: KINDS, types: TYPES, alsoKnownAs: TYPE_WORDS, traits };
}
