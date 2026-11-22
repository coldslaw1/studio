import { PHRASES, SYNONYMS, DEGREES, nearestWord } from './understand.js';

// The vocabulary of sound descriptions: "heavy wooden door creak" is read as
// size (heavy), material (wooden -> wood), thing (door) and kind (creak).
// Plain tables, so a new word is one entry.

const list = (text) => text.split(/\s+/).filter(Boolean);

// kind -> the words that ask for it
const KIND_WORDS = {
  impact: 'hit knock thud slam bang punch thump clang clank bump kick stomp smack whack strike clash clunk tap impact',
  creak: 'creak squeak groan creaking',
  squelch: 'squelch squish splat slurp gloop squirt goo ooze',
  pickup: 'pickup collect grab chime sparkle twinkle jingle ding loot reward bonus treasure',
  whoosh: 'whoosh swing swish swoosh throw dash slash swipe gust woosh wind breeze blow',
  explosion: 'explosion explode boom blast burst detonate bomb gunshot shot gun cannon firework',
  rumble: 'rumble thunder quake earthquake avalanche',
  zap: 'zap laser shoot spell cast beam shock spark bolt lightning fire-ball fireball buzz electric electricity energy',
  ui: 'click blip beep tick select confirm cancel error menu button hover toggle back accept deny notify pop type',
  splash: 'splash drip plop bubble pour dribble droplet rain wave ocean river waterfall',
  creature: 'roar growl snarl hiss screech chirp tweet grunt bark croak moan howl cricket hoot cluck squeal purr meow moo oink quack caw scream cry whistle',
  jump: 'jump hop bounce spring boing leap',
  break: 'break shatter crack crumble smash snap crash destroy crunch chop',
  fire: 'burn ignite sizzle crackle flame blaze',
  bell: 'bell gong toll ring chime-bell',
  powerup: 'powerup heal levelup upgrade buff charge teleport warp portal revive save win victory',
  hurt: 'hurt damage ouch death die lose fail defeat',
  door: 'open close latch lock unlock shut',
  rustle: 'rustle flap shuffle flutter turn',
  step: 'footstep step walk footfall',
  alarm: 'alarm siren warning alert',
  hum: 'hum drone engine motor machine generator whir purring',
};

// material -> the words that name it
const MATERIAL_WORDS = {
  wood: 'wood wooden timber plank oak', metal: 'metal metallic iron steel brass copper tin', stone: 'stone rock rocky brick concrete marble',
  glass: 'glass', crystal: 'crystal gem diamond', bone: 'bone skeleton skull', cloth: 'cloth fabric cape flag curtain silk', paper: 'paper page book scroll parchment',
  leather: 'leather', ice: 'ice icy frozen', flesh: 'flesh body meat', slime: 'slime slimy mud muddy goo gooey jelly', water: 'water watery liquid',
  grass: 'grass grassy', dirt: 'dirt earth soil ground', gravel: 'gravel pebble', sand: 'sand sandy', snow: 'snow snowy', leaves: 'leaf leaves foliage bush', carpet: 'carpet rug',
};

// things: a material and the kind to use when no kind word is given
const OBJECTS = {
  door: ['wood', 'door'], gate: ['metal', 'creak'], chest: ['wood', 'door'], crate: ['wood', 'impact'], barrel: ['wood', 'impact'], box: ['wood', 'impact'],
  coin: ['metal', 'pickup'], key: ['metal', 'pickup'], sword: ['metal', 'whoosh'], blade: ['metal', 'whoosh'], axe: ['metal', 'whoosh'], hammer: ['metal', 'impact'],
  anvil: ['metal', 'impact'], chain: ['metal', 'rustle'], armor: ['metal', 'impact'], shield: ['metal', 'impact'], bottle: ['glass', 'impact'], window: ['glass', 'break'],
  potion: ['glass', 'pickup'], vase: ['glass', 'break'], boulder: ['stone', 'impact'], wall: ['stone', 'impact'], floor: ['wood', 'creak'], stairs: ['wood', 'creak'],
  bridge: ['wood', 'creak'], ship: ['wood', 'creak'], arrow: ['wood', 'whoosh'], bow: ['wood', 'whoosh'], torch: [null, 'fire'], campfire: [null, 'fire'], fire: [null, 'fire'],
  monster: [null, 'creature'], beast: [null, 'creature'], dragon: [null, 'creature'], bird: [null, 'creature'], frog: [null, 'creature'], owl: [null, 'creature'],
  ghost: [null, 'creature'], wolf: [null, 'creature'], dog: [null, 'creature'], cat: [null, 'creature'], cow: [null, 'creature'], pig: [null, 'creature'],
  duck: [null, 'creature'], crow: [null, 'creature'], bear: [null, 'creature'], lion: [null, 'creature'], mouse: [null, 'creature'], zombie: [null, 'creature'], goblin: [null, 'creature'], enemy: [null, 'creature'],
  gem: ['crystal', 'pickup'], ring: ['metal', 'pickup'], book: ['paper', 'rustle'], tree: ['wood', 'creak'], rock: ['stone', 'impact'], bone: ['bone', 'impact'], footsteps: [null, 'step'], snake: [null, 'creature'], rat: [null, 'creature'], bat: [null, 'creature'], chicken: [null, 'creature'],
  magic: [null, 'zap'], lever: ['metal', 'door'], switch: ['metal', 'ui'], drum: ['leather', 'impact'], heart: [null, 'powerup'], star: ['crystal', 'pickup'],
};

// modifiers: [group, value]
const MODS = {
  tiny: ['size', 0.5], small: ['size', 0.7], little: ['size', 0.7], light: ['size', 0.8], big: ['size', 1.35], large: ['size', 1.35], heavy: ['size', 1.55],
  huge: ['size', 1.85], giant: ['size', 2.1], massive: ['size', 2.1], thick: ['size', 1.3], thin: ['size', 0.75],
  short: ['length', 0.6], quick: ['length', 0.6], fast: ['length', 0.6], brief: ['length', 0.5], long: ['length', 1.7], slow: ['length', 1.7],
  soft: ['force', 0.55], gentle: ['force', 0.55], quiet: ['force', 0.5], muffled: ['force', 0.5], hard: ['force', 1.3], loud: ['force', 1.4], sharp: ['force', 1.3], violent: ['force', 1.5],
  high: ['pitch', 1.5], shrill: ['pitch', 1.8], squeaky: ['pitch', 1.6], low: ['pitch', 0.66], deep: ['pitch', 0.6],
  distant: ['space', 'far'], far: ['space', 'far'], faraway: ['space', 'far'], echo: ['space', 'echo'], echoing: ['space', 'echo'], cavernous: ['space', 'echo'],
  hall: ['space', 'echo'], cave: ['space', 'echo'], close: ['space', 'dry'], dry: ['space', 'dry'],
  rusty: ['texture', 'rusty'], rust: ['texture', 'rusty'], rusted: ['texture', 'rusty'], old: ['texture', 'rusty'], ancient: ['texture', 'rusty'], wet: ['texture', 'wet'], soggy: ['texture', 'wet'],
  magical: ['texture', 'magic'], enchanted: ['texture', 'magic'], dark: ['texture', 'dark'], bright: ['texture', 'bright'], retro: ['texture', 'retro'],
  chiptune: ['texture', 'retro'], spooky: ['texture', 'spooky'], eerie: ['texture', 'spooky'], creepy: ['texture', 'spooky'], cute: ['texture', 'cute'], happy: ['texture', 'cute'],
};

const STOP = new Set(list('a an the of with and or but so if on in at for to from being some any all i ive ve s t re ll d m me my your its his her their it they we you he she there here when while has have had was were are be been do does did can could would should will just want need hear make give please like good nice thing something someone sound sfx noise effect one item up down out off by is it as into onto then that this'));
const LOCAL_TEXTURES = ['rusty', 'wet']; // only some kinds use these; the others apply to every sound

const TABLE = new Map();
const put = (word, entry) => { if (!TABLE.has(word)) TABLE.set(word, entry); };
for (const [kind, words] of Object.entries(KIND_WORDS)) for (const w of list(words)) put(w, { kind });
for (const [material, words] of Object.entries(MATERIAL_WORDS)) for (const w of list(words)) put(w, { material });
for (const [word, [material, kind]] of Object.entries(OBJECTS)) put(word, { object: true, material, defaultKind: kind });
for (const [word, [group, value]] of Object.entries(MODS)) put(word, { mod: group, value });

/** Kinds of sound generateSound can make. */
export const SOUND_KINDS = Object.keys(KIND_WORDS);
/** Materials a description can name. */
export const MATERIAL_NAMES = Object.keys(MATERIAL_WORDS);

// lookup(word) -> [entry, base word] or null. Tries the word, then the word without common endings.
function lookup(word) {
  if (TABLE.has(word)) return [TABLE.get(word), word];
  for (const [end, add] of [['ies', 'y'], ['es', ''], ['s', ''], ['ing', ''], ['ing', 'e'], ['ed', ''], ['ed', 'e'], ['en', ''], ['ly', ''], ['y', ''], ['ling', 'le']]) {
    if (word.length > end.length + 2 && word.endsWith(end)) {
      const stem = word.slice(0, -end.length) + add;
      if (TABLE.has(stem)) return [TABLE.get(stem), stem];
      const single = stem.slice(0, -1); // "dripping" -> "dripp" -> "drip"
      if (stem.length > 3 && stem.at(-1) === stem.at(-2) && TABLE.has(single)) return [TABLE.get(single), single];
    }
  }
  return null;
}

const VOCABULARY = [...TABLE.keys(), ...Object.keys(SYNONYMS)];
const KIND_VOCABULARY = [...TABLE.entries()].filter(([, e]) => e.kind || e.defaultKind).map(([w]) => w);

/**
 * parseDescription(text) -> { words, kind, kindWord, material, materialWord, mods, textures, said, guessed, ignored, fallback }
 *   kind:     one of SOUND_KINDS, or null when no word names a kind
 *   material: one of MATERIAL_NAMES, or null
 *   mods:     { size, length, force, pitch } multipliers (1 = unchanged), space: 'far' | 'echo' | 'dry' | null
 *   textures: Map of texture name -> the word that asked for it
 *   said:     Set of every understood word in its base form ("creaking" -> "creak")
 *   guessed:  [{ word, as }] misspelt or unusual words read as the vocabulary word they resemble
 *   ignored:  words that could not be read at all
 *   fallback: when nothing named a kind, the vocabulary word most like what was typed (used so there is always a real sound)
 * Phrases ("level up", "game over", "in the distance"), everyday synonyms ("enormous", "bash") and
 * degree words ("very big", "slightly distant") are understood.
 */
export function parseDescription(text) {
  if (typeof text !== 'string') throw new Error(`parseDescription: the description must be a string like "heavy wooden door creak", got ${JSON.stringify(text)}`);
  let clean = text.toLowerCase();
  for (const [pattern, to] of PHRASES) clean = clean.replace(pattern, to);
  const words = clean.split(/[^a-z-]+/).filter(Boolean);
  const out = { words, kind: null, kindWord: null, material: null, materialWord: null, objectKind: null, mods: { size: 1, length: 1, force: 1, pitch: 1, space: null }, textures: new Map(), said: new Set(), guessed: [], ignored: [], fallback: null };
  let degree = 1;
  const take = (word, entry, base) => {
    out.said.add(word); out.said.add(base);
    if (entry.kind) {
      if (!out.kind) { out.kind = entry.kind; out.kindWord = word; }
    } else if (entry.object) {
      if (entry.material && !out.material) { out.material = entry.material; out.materialWord = word; out.materialFromObject = true; }
      if (!out.objectKind) { out.objectKind = entry.defaultKind; out.objectWord = word; out.objectMaterial = entry.material; }
    } else if (entry.material) {
      if (!out.material || out.materialFromObject) { out.material = entry.material; out.materialWord = word; out.materialFromObject = false; }
    } else if (entry.mod === 'space') out.mods.space = entry.value;
    else if (entry.mod === 'texture') out.textures.set(entry.value, word);
    else { out.mods[entry.mod] *= Math.pow(entry.value, degree); degree = 1; } // "very big" is bigger than "big"
  };
  const read = (word, depth = 0) => {
    if (STOP.has(word)) return true;
    if (Object.hasOwn(DEGREES, word)) { degree = DEGREES[word]; return true; }
    const found = lookup(word);
    if (found) { take(word, found[0], found[1]); return true; }
    const other = Object.hasOwn(SYNONYMS, word) ? SYNONYMS[word] : word.endsWith('s') && Object.hasOwn(SYNONYMS, word.slice(0, -1)) ? SYNONYMS[word.slice(0, -1)] : null;
    if (other && depth < 2) { out.said.add(word); for (const w of other.split(' ')) read(w, depth + 1); return true; }
    return false;
  };
  // First every word that is known exactly. Then the unknown ones: a word that looks like a
  // misspelling is only used for what is still missing, so a guess never outranks a real word.
  const unknown = words.filter((word) => !read(word));
  for (const word of unknown) {
    const near = nearestWord(word, VOCABULARY);
    const found = near && near.sure ? lookup(near.word) ?? (Object.hasOwn(SYNONYMS, near.word) ? [null] : null) : null;
    const entry = found && found[0];
    const fills = found && (entry === null ? !out.kind && !out.objectKind
      : entry.kind || entry.object ? !out.kind && !out.objectKind
        : entry.material ? !out.material
          : word.length >= 6);
    if (fills && read(near.word, 1)) out.guessed.push({ word, as: near.word });
    else out.ignored.push(word);
  }
  if (!out.kind && !out.objectKind && !out.material && !out.ignored.length && out.said.size) out.kind = 'impact'; // only "big", "soft", "distant"...: a plain knock that shows them
  if (!out.kind && !out.objectKind && !out.material && out.ignored.length) {
    // Nothing says what the sound is. Use the kind word most like anything that was typed: never silence, never a bare blip.
    let best = null;
    for (const word of out.ignored) { const near = nearestWord(word, KIND_VOCABULARY); if (near && (!best || (near.score ?? 1) > best.score)) best = { word: near.word, score: near.score ?? 1 }; }
    if (!best) best = { word: KIND_VOCABULARY[[...clean].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % KIND_VOCABULARY.length] };
    const found = lookup(best.word);
    out.fallback = best.word;
    if (found[0].kind) out.kind = found[0].kind; else { out.objectKind = found[0].defaultKind; out.material = found[0].material; }
  }
  return out;
}

export { LOCAL_TEXTURES };
