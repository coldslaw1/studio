// Helps the description reader with what people really type: phrases
// ("level up", "game over"), everyday synonyms ("enormous", "bash", "boss"),
// and misspellings ("creek" for creak, "explotion"). Plain tables and two
// small text-distance functions; no audio here.

/** Phrases rewritten before the words are read. Left: what was typed. Right: vocabulary words. */
export const PHRASES = [
  [/8[- ]?bit/g, 'retro'], [/level[- ]up/g, 'levelup'], [/power[- ]up/g, 'powerup'], [/pick(?:ing|ed)?[- ]up/g, 'pickup'], [/game[- ]over/g, 'death'],
  [/foot[- ]?steps?/g, 'footstep'], [/heart[- ]?beat/g, 'soft deep flesh thump'], [/far[- ]away|in the distance|from afar/g, 'distant'], [/close[- ]up|up close|nearby/g, 'dry'],
  [/under[- ]?water/g, 'dark wet'], [/slam(?:s|med|ming)? shut/g, 'slam shut'], [/fall(?:s|ing)? (?:down|over)/g, 'thud'], [/turn(?:s|ing)? (?:a |the )?page/g, 'page turn'],
  [/open(?:s|ing)? up/g, 'open'], [/a (?:little )?bit/g, 'slightly'], [/kind of|sort of/g, 'slightly'], [/sci[- ]?fi/g, 'laser'], [/lock(?:s|ing)? in/g, 'lock'],
];

/** Everyday words -> vocabulary words (one or several). */
export const SYNONYMS = {
  enormous: 'huge', gigantic: 'giant', colossal: 'giant', mini: 'tiny', miniature: 'tiny', wee: 'tiny', faint: 'soft', muted: 'muffled', subtle: 'soft', booming: 'loud deep',
  thunderous: 'loud deep', deafening: 'loud', piercing: 'shrill', harsh: 'hard', crisp: 'sharp bright', dull: 'dark', stony: 'stone', glassy: 'glass', fleshy: 'flesh', boggy: 'mud',
  bash: 'hit', pound: 'thump', clap: 'sharp hit', slap: 'sharp hit', stab: 'slash', cut: 'slash', zoom: 'whoosh', fly: 'whoosh', fall: 'whoosh', drop: 'thud', land: 'thud',
  collapse: 'crumble', rattle: 'metal rustle', clink: 'small metal hit', clatter: 'metal rustle', scrape: 'creak', grind: 'creak', yell: 'scream', shout: 'scream', shriek: 'screech',
  bite: 'crunch', eat: 'crunch', munch: 'crunch', drink: 'water bubble', gulp: 'water bubble', swim: 'splash', mine: 'explosion', rocket: 'whoosh', missile: 'whoosh',
  robot: 'zap', computer: 'beep', phone: 'bell', clock: 'tick', notification: 'notify', message: 'notify', success: 'win', failure: 'fail', correct: 'confirm', wrong: 'error',
  start: 'confirm', pause: 'click', resume: 'confirm', boss: 'giant monster', spawn: 'teleport', respawn: 'revive', block: 'metal hit', parry: 'metal clang', dodge: 'whoosh',
  run: 'step', sprint: 'step', stomp: 'heavy step', trumpet: 'powerup', fanfare: 'powerup', sting: 'zap', electricity: 'electric', spooked: 'spooky', haunted: 'spooky',
  ghostly: 'spooky ghost', creature: 'monster', animal: 'beast', kitten: 'small cat', puppy: 'small dog', rooster: 'chicken', hen: 'chicken', raven: 'crow', toad: 'frog',
  serpent: 'snake', rodent: 'rat', mud: 'slime', goo: 'slime', lava: 'fire', flame: 'fire', torchlight: 'torch', wave: 'splash', sea: 'ocean', stream: 'river', puddle: 'water',
  treasure: 'pickup', loot: 'pickup', jewel: 'gem', ruby: 'gem', emerald: 'gem', money: 'coin', gold: 'coin', cash: 'coin', pot: 'vase', jar: 'bottle', cup: 'glass', mug: 'glass',
  plank: 'wood', log: 'wood', branch: 'wood', twig: 'small wood', trunk: 'heavy wood', pipe: 'metal', sheet: 'metal', pan: 'metal', bucket: 'metal', pebble: 'small stone',
  wall: 'stone', tile: 'stone', pillar: 'stone', statue: 'stone', curtain: 'cloth', flag: 'cloth', cape: 'cloth', rope: 'leather', whip: 'leather whoosh', arrow: 'small whoosh',
};

/** Words that strengthen or weaken the modifier after them: "very big", "slightly distant". */
export const DEGREES = { very: 1.6, really: 1.6, extremely: 2, super: 1.8, incredibly: 2, quite: 1.3, pretty: 1.2, rather: 1.2, slightly: 0.5, somewhat: 0.6, barely: 0.3, mildly: 0.5 };

/** editDistance(a, b) -> how many single-letter changes turn a into b (swapped neighbours count once). */
export function editDistance(a, b) {
  const rows = a.length + 1, cols = b.length + 1, d = [];
  for (let i = 0; i < rows; i++) { d.push(new Array(cols).fill(0)); d[i][0] = i; }
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** likeness(a, b) -> 0..1, how many letter pairs two words share (1 = same word). */
export function likeness(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map();
  for (let i = 0; i < a.length - 1; i++) { const p = a.slice(i, i + 2); pairs.set(p, (pairs.get(p) ?? 0) + 1); }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) { const p = b.slice(i, i + 2), n = pairs.get(p) ?? 0; if (n > 0) { shared++; pairs.set(p, n - 1); } }
  return (2 * shared) / (a.length + b.length - 2);
}

/**
 * nearestWord(word, candidates) -> { word, sure } or null
 *   sure: true  = almost certainly a misspelling or another form of that word (use it)
 *   sure: false = only the most similar word there is (a last resort, never silence)
 */
export function nearestWord(word, candidates) {
  let best = null, bestScore = 0, typo = null;
  for (const c of candidates) {
    if (c.length < 3) continue;
    const allowed = word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0;
    if (allowed && Math.abs(c.length - word.length) <= allowed && c[0] === word[0] && editDistance(word, c) <= allowed && (!typo || c.length > typo.length)) typo = c;
    const score = likeness(word, c);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (typo) return { word: typo, sure: true };
  if (best && bestScore >= 0.7 && word.length >= 6) return { word: best, sure: true };
  return best && bestScore > 0 ? { word: best, sure: false, score: bestScore } : null;
}
