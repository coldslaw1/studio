// Two-legged characters: players, townsfolk and humanoid monsters. Each type is a recipe: a body
// plan (ranges for height, bulk, head, legs), an outfit with chances, colours from the style's
// palette and the equipment it may carry. The result is a puppet-engine model: { def, equipment }.
import { twoLegged } from './gen-body.js';
import { WEAR, HATS } from './gen-wear.js';
import { GEAR, shield, pack } from './gen-gear.js';
import { POOLS } from './gen-palette.js';

const HUMAN = { height: [1.62, 1.92], bulk: [0.88, 1.12], head: [1.06, 1.14] };
const GREEN = ['leaf~cream~0.25', 'leaf~stone~0.35', 'slime~leaf~0.5', 'leaf~gold~0.25'];
const DARK = ['night', 'ink~night~0.5', 'plum~ink~0.4', 'leafDark', 'wood~ink~0.4', 'stone~ink~0.4'];

// wear: piece -> chance (1 = always). hats, weapons: lists to pick from ('' = none). shield, pack, cape: chances.
const RECIPES = {
  warrior: { plan: HUMAN, wear: { plate: 1, greaves: 0.7, tabard: 0.7, belt: 1 }, hats: ['helm', 'kettle', '', ''], weapons: ['sword', 'sword', 'axe', 'mace', 'spear'], shield: 0.7, cape: 0.5, cloth: POOLS.cloth },
  mage: { plan: { ...HUMAN, bulk: [0.82, 1] }, wear: { robe: 1, belt: 0.6, beard: 0.35 }, hats: ['pointed', 'pointed', '', 'hood'], weapons: ['staff'], cape: 0.3, cloth: ['plum', 'cloth', 'night', 'leafDark', 'red'] },
  ranger: { plan: HUMAN, wear: { skirt: 0.6, belt: 1 }, hats: ['hood', 'hood', 'feather', ''], weapons: ['spear', 'sword', 'dagger'], cape: 0.8, pack: 0.6, cloth: ['leaf', 'leafDark', 'wood', 'cream~wood~0.5'] },
  rogue: { plan: { ...HUMAN, bulk: [0.82, 0.98] }, wear: { belt: 1, mask: 0.5 }, hats: ['hood', 'hood', ''], weapons: ['dagger', 'dagger', 'sword'], cape: 0.4, cloth: DARK },
  villager: { plan: HUMAN, wear: { skirt: 0.7, belt: 0.8, beard: 0.2 }, hats: ['straw', 'cap', '', '', ''], weapons: ['', '', '', 'staff'], pack: 0.15, cloth: POOLS.cloth },
  farmer: { plan: HUMAN, wear: { skirt: 0.5, belt: 0.6, beard: 0.3, apron: 0.2 }, hats: ['straw', 'straw', 'cap', ''], weapons: ['fork', 'fork', ''], cloth: POOLS.dull },
  merchant: { plan: { ...HUMAN, bulk: [1, 1.25], belly: [0.3, 0.9] }, wear: { robe: 0.6, skirt: 0.4, belt: 1, beard: 0.4 }, hats: ['cap', 'feather', ''], weapons: [''], pack: 0.6, cloth: ['plum', 'gold', 'red', 'cloth', 'leaf'] },
  guard: { plan: { ...HUMAN, height: [1.72, 1.95] }, wear: { plate: 1, greaves: 0.5, tabard: 1, belt: 1 }, hats: ['kettle', 'kettle', 'helm'], weapons: ['spear', 'spear', 'sword'], shield: 0.6, cloth: POOLS.cloth },
  priest: { plan: HUMAN, wear: { robe: 1, belt: 0.5, beard: 0.3 }, hats: ['', '', 'hood'], weapons: ['', 'staff'], hair: ['bald', 'short', 'short'], cloth: ['white', 'cream', 'plum', 'night', 'stone~white~0.4'] },
  smith: { plan: { ...HUMAN, bulk: [1.12, 1.3], shoulder: [1.05, 1.15] }, wear: { apron: 1, belt: 1, beard: 0.6 }, hats: [''], weapons: ['hammer'], hair: ['bald', 'short'], bareArms: true, cloth: POOLS.dull },
  elder: { plan: { height: [1.5, 1.68], bulk: [0.85, 1.05], head: [1.08, 1.16], hunch: [0.35, 0.7] }, wear: { robe: 0.6, skirt: 0.4, belt: 0.6, beard: 0.6 }, hats: ['', '', 'cap', 'hood'], weapons: ['staff', 'staff', ''], hairColors: ['stone~white~0.4', 'white~stone~0.3', 'white'], cloth: POOLS.dull },
  child: { plan: { height: [1.08, 1.32], bulk: [0.9, 1.05], head: [1.28, 1.4] }, wear: { skirt: 0.7, belt: 0.3 }, hats: ['', '', 'cap', 'straw'], weapons: [''], cloth: POOLS.cloth },
  noble: { plan: HUMAN, wear: { robe: 0.7, tabard: 0.3, belt: 1, beard: 0.3 }, hats: ['crown', 'feather', ''], weapons: ['', 'sword'], cape: 0.8, cloth: ['plum', 'red', 'cloth', 'gold'], rich: true },
  bard: { plan: { ...HUMAN, bulk: [0.85, 1] }, wear: { skirt: 0.6, belt: 1 }, hats: ['feather', 'feather', 'cap'], weapons: [''], cape: 0.6, capeLength: 0.7, cloth: ['red', 'gold', 'leaf', 'pink', 'sky'] },
  goblin: { plan: { height: [1.02, 1.3], bulk: [0.78, 0.95], head: [1.3, 1.42], leg: [0.82, 0.9], hunch: [0.3, 0.7], arm: [1.02, 1.1] }, skin: GREEN, face: 'glow', wear: { ears: 1, rag: 0.8, belt: 0.5, mask: 0.1 }, hats: ['', '', 'hood', 'kettle'], hair: ['bald', 'bald', 'mohawk'], weapons: ['club', 'dagger', 'spear', 'axe'], shield: 0.25, bareArms: true, bareLegs: true, cloth: POOLS.dull },
  orc: { plan: { height: [1.9, 2.12], bulk: [1.22, 1.38], head: [0.98, 1.06], shoulder: [1.08, 1.2], hunch: [0.1, 0.35] }, skin: ['leafDark~stone~0.4', 'leaf~stone~0.5', 'stone~leaf~0.3'], wear: { tusks: 1, belt: 1, plate: 0.45, greaves: 0.3, rag: 0.5 }, hats: ['', '', 'kettle'], hair: ['bald', 'mohawk', 'tail'], weapons: ['axe', 'axe', 'club', 'mace'], shield: 0.3, bareArms: true, cloth: DARK },
  ogre: { plan: { height: [2.4, 2.9], bulk: [1.38, 1.52], head: [0.84, 0.92], shoulder: [1.1, 1.22], hunch: [0.3, 0.6], arm: [1.05, 1.12], belly: [0.4, 1] }, skin: ['stone~wood~0.4', 'slime~stone~0.5', 'cream~wood~0.6', 'stone~leaf~0.25'], wear: { rag: 1, belt: 0.7, tusks: 0.5, horns: 0.25 }, hats: [''], hair: ['bald', 'bald', 'mohawk'], weapons: ['club', 'club', 'hammer', ''], bareArms: true, bareLegs: true, cloth: POOLS.dull },
  skeleton: { plan: { height: [1.6, 1.9], bulk: [0.44, 0.5], head: [1.08, 1.14] }, skin: ['bone', 'bone~stone~0.25', 'bone~wood~0.2'], face: 'sockets', wear: { ribs: 1, rag: 0.7 }, hats: ['', '', 'kettle', 'helm'], hair: ['bald'], weapons: ['sword', 'sword', 'spear', 'axe', ''], shield: 0.35, allSkin: true, cloth: ['roof', 'brick~ink~0.3', 'plum~ink~0.4', 'night'] },
  ghoul: { plan: { height: [1.55, 1.85], bulk: [0.72, 0.88], head: [1.08, 1.16], hunch: [0.6, 1], arm: [1.08, 1.14] }, skin: ['slime~stone~0.6', 'stone~leaf~0.3', 'stone~cream~0.3', 'bone~leaf~0.3'], face: 'glow', wear: { rag: 1 }, hats: [''], hair: ['bald', 'bald', 'long'], weapons: [''], bareArms: true, bareLegs: true, cloth: DARK },
  imp: { plan: { height: [0.85, 1.1], bulk: [0.8, 0.95], head: [1.28, 1.4], leg: [0.85, 0.95] }, skin: ['red', 'red~plum~0.4', 'plum', 'ember~red~0.5', 'night~plum~0.4'], face: 'glow', wear: { horns: 1, tail: 1, ears: 0.6 }, hats: [''], hair: ['bald'], weapons: ['', 'dagger', 'torch', 'fork'], allSkin: true, cloth: DARK },
  golem: { plan: { height: [2.2, 2.7], bulk: [1.4, 1.55], head: [0.78, 0.86], shoulder: [1.12, 1.22], arm: [1.06, 1.12] }, skin: ['stone', 'stone~ink~0.25', 'stone~cream~0.4', 'stone~leafDark~0.3', 'wood~stone~0.5'], face: 'glow', wear: { slabs: 1 }, hats: [''], hair: ['bald'], weapons: [''], allSkin: true, cloth: ['stone'] },
  bandit: { plan: HUMAN, wear: { belt: 1, mask: 0.7, beard: 0.3, skirt: 0.3 }, hats: ['hood', 'cap', ''], weapons: ['dagger', 'sword', 'club', 'axe'], shield: 0.15, cape: 0.3, cloth: POOLS.dull },
  cultist: { plan: { ...HUMAN, bulk: [0.82, 1] }, face: 'glow', faceChance: 0.4, wear: { robe: 1, hood: 1, belt: 0.5 }, hats: [''], weapons: ['dagger', 'staff', 'torch', ''], cloth: ['roof', 'plum~ink~0.4', 'night', 'ink~night~0.5', 'brick~ink~0.3'] },
};

export const PEOPLE_TYPES = Object.keys(RECIPES);
const HAIR = ['short', 'short', 'long', 'bun', 'tail', 'bald'];
const WEAR_ORDER = ['ribs', 'slabs', 'skirt', 'robe', 'apron', 'tabard', 'plate', 'greaves', 'belt', 'rag', 'tail', 'tusks', 'ears', 'horns', 'beard', 'mask', 'hood'];
const TAG_WEAR = { armour: ['plate', 'greaves'], hood: ['hood'], beard: ['beard'], horns: ['horns'], tail: ['tail'], robe: ['robe'], mask: ['mask'] };

/**
 * Make a two-legged character.
 * @returns {{model:{def:object, equipment:object}, colors:Object<string,string>, facts:object, features:string[]}}
 *   `colors` are specs (palette roles or blends) by rig colour name; the caller resolves them to hex.
 */
export function makePerson(ctx, type) {
  const R = RECIPES[type];
  if (!R) throw new Error(`makePerson: unknown type "${type}". Known: ${PEOPLE_TYPES.join(', ')}`);
  const body = ctx.rng('body'); const look = ctx.rng('palette'); const out = ctx.rng('outfit');
  const c = ctx.colors;
  const pick = (key, d) => (R.plan[key] ? body.range(...R.plan[key]) : d);
  const height = Math.round(pick('height') * ctx.size * 100) / 100;
  let bulk = pick('bulk', 1); let belly = pick('belly', 0);
  if (ctx.has('heavy')) { bulk *= 1.15; belly = Math.max(belly, 0.7); }
  if (ctx.has('thin')) { bulk *= 0.86; belly = 0; }
  const glow = R.face === 'glow' && (R.faceChance === undefined || look.chance(R.faceChance));
  const def = twoLegged({ name: type, height, bulk, belly, head: pick('head', 1.1), leg: pick('leg', 1), arm: pick('arm', 1), shoulder: pick('shoulder', 1), hunch: pick('hunch', 0), face: glow ? 'glow' : R.face === 'glow' ? 'eyes' : R.face, bareArms: R.bareArms, bareLegs: R.bareLegs });

  // ---- colours: all from the style's palette ----
  const word = (ctx.traits.colors[0] && c.word(look, ctx.traits.colors[0])) || null;
  const skin = c.pick(look, R.skin ?? POOLS.skin);
  const cloth = word ?? c.pick(look, R.cloth, [skin], 1.25);
  const legs = R.allSkin ? skin : c.pick(look, POOLS.dull, [cloth], 1.15);
  const metal = ctx.traits.material === 'steel' ? 'steel' : c.pick(look, POOLS.metal, [cloth], 1.2);
  const accent = (ctx.traits.colors[1] && c.word(look, ctx.traits.colors[1])) || c.pick(look, R.rich || ctx.has('rich') ? ['gold', 'white', 'red'] : POOLS.cloth, [cloth], 1.5);
  const eyeGlow = c.pick(look, ['flame', 'ember', 'gold', 'slime', 'sky', 'white'], [skin], 2.2);
  const specs = {
    skin, top: R.allSkin ? skin : cloth, sleeve: R.allSkin || R.bareArms ? skin : look.chance(0.3) ? c.pick(look, POOLS.dull, [skin], 1.2) : cloth,
    legs, shoe: R.allSkin || R.bareLegs ? skin : c.pick(look, ['wood~ink~0.4', 'ink~night~0.5', 'wood'], [], 1),
    eye: R.face === 'sockets' ? 'ink~night~0.3' : glow ? eyeGlow : c.pick(look, ['ink', 'ink~night~0.4'], [skin], 2),
    hair: c.pick(look, R.hairColors ?? POOLS.hair, [skin], 1.3), belt: c.pick(look, ['wood~ink~0.4', 'wood', 'ink~night~0.5'], [cloth], 1.2),
    trim: accent, metal, cloth: R.allSkin ? c.pick(look, R.cloth, [skin], 1.25) : accent, cape: c.pick(look, [accent, cloth, ...DARK], [skin], 1.3),
    apron: c.pick(look, ['wood~ink~0.3', 'wood', 'stone~ink~0.3'], [cloth], 1.2), horn: c.pick(look, ['bone', 'ink~night~0.4', 'cream'], [skin], 1.5),
  };

  // ---- outfit ----
  const wear = {};
  for (const piece of WEAR_ORDER) if (R.wear[piece] !== undefined && out.chance(R.wear[piece])) wear[piece] = true;
  let hat = out.pick(R.hats); let hair = out.pick(R.hair ?? HAIR);
  for (const [tag, pieces] of Object.entries(TAG_WEAR)) if (ctx.has(tag)) for (const p of pieces) wear[p] = true;
  if (ctx.has('bald')) hair = 'bald';
  if (ctx.has('hat')) hat = hat && hat !== 'hood' ? hat : R.hats.find((h) => h && h !== 'hood') ?? 'cap';
  if (ctx.has('helm')) hat = 'helm';
  if (ctx.has('crown')) hat = 'crown';
  if (hat === 'hood') { wear.hood = true; hat = ''; }
  if (wear.hood) { hat = ''; hair = 'bald'; }
  if (wear.robe) delete wear.skirt;
  if (wear.ribs || wear.slabs) { delete wear.belt; delete wear.plate; delete wear.tabard; }
  for (const piece of WEAR_ORDER) if (wear[piece]) WEAR[piece](def, piece === 'horns' ? body.range(0.8, 1.4) : piece === 'ears' ? body.range(0.8, 1.3) : piece === 'tail' ? body.range(0.85, 1.2) : undefined);
  if (!wear.hood) WEAR.hair(def, hair);
  const cape = !wear.slabs && (ctx.has('cape') || out.chance(R.cape ?? 0));
  if (cape) WEAR.cape(def, R.capeLength ?? out.range(0.85, 1.1));

  // ---- equipment ----
  const hexes = (names) => c.resolve(Object.fromEntries(Object.entries(names)));
  const equipment = {};
  if (hat) equipment.head = HATS[hat](height, def.meta.headSize, hexes(hat === 'helm' || hat === 'kettle' ? { hat: metal, visor: 'ink~night~0.3', band: accent } : hat === 'crown' ? { band: 'gold' } : { hat: hat === 'straw' ? 'gold~wood~0.3' : c.pick(look, [cloth, accent, ...POOLS.dull], [skin], 1.25), band: accent }));
  let weapon = ctx.traits.gear.find((g) => GEAR[g]) ?? (ctx.has('unarmed') ? '' : out.pick(R.weapons));
  if (weapon) {
    const item = GEAR[weapon](height, ctx.rng('gear'), hexes({ grip: 'wood~ink~0.25', trim: R.rich ? 'gold' : c.pick(look, ['gold', 'steel~ink~0.3', 'wood'], [], 1), metal: R.skin && type !== 'golem' && look.chance(0.5) ? 'steel~wood~0.35' : metal, glow: c.pick(look, ['flame', 'sky', 'slime', 'pink', 'ember'], [], 1) }));
    equipment.handR = item;
  } else weapon = '';
  const hasShield = (ctx.traits.gear.includes('shield') || out.chance(R.shield ?? 0)) && !['spear', 'staff', 'fork'].includes(weapon) && !ctx.has('unarmed');
  if (hasShield) equipment.armL = shield(height, ctx.rng('gear'), hexes({ face: accent, trim: metal }));
  if (ctx.has('pack') || out.chance(R.pack ?? 0)) { if (!cape) equipment.back = pack(height, ctx.rng('gear'), hexes({ bag: 'wood', strap: 'wood~ink~0.4', roll: accent })); }

  const usedNames = new Set(def.parts.map((p) => p.color));
  const colors = Object.fromEntries(Object.entries(specs).filter(([k]) => usedNames.has(k)));
  const features = [...Object.keys(wear), hair !== 'bald' && !wear.hood ? `${hair} hair` : null, cape ? 'cape' : null, hat || null, weapon || null, hasShield ? 'shield' : null, equipment.back ? 'pack' : null].filter(Boolean);
  return { model: { def, equipment }, colors, facts: { plan: 'twoLegged', bodyHeight: height, bulk: def.meta.bulk, weapon, reach: equipment.handR?.reach ?? 0, range: R.plan.height.map((h) => h * ctx.size) }, features };
}
