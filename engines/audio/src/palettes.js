// Sound palettes, one per Kiln art style, so a game's sound matches its look.
// A palette says how generated effects are voiced and finished, which scales
// and instruments its music uses, and how its ambience is coloured.

/** The palettes: storybook, nocturne, papercut and crypt match Kiln's styles; retro is plain chiptune. */
export const SOUND_STYLES = {
  storybook: {
    description: 'Warm and woody: soft triangle tones, a small friendly room, folk instruments in major keys.',
    sfx: { wave: 'triangle', pitch: 1, soft: 0.004, fx: { reverb: 0.12, room: 0.3, damp: 0.5, lowpass: 10000 } },
    music: { scales: ['major', 'mixolydian', 'pentatonic'], bpm: [92, 108], roots: ['C3', 'D3', 'F2', 'G2'], melody: 'flute', counter: 'lute', harmony: 'harp', pad: 'strings', bass: 'bass', tension: 'cello', drive: 'stab', kit: 'folk', swing: 0.12, busy: 1, fx: { reverb: 0.18, room: 0.45, damp: 0.5 } },
    ambience: { fx: { reverb: 0.1, room: 0.4, damp: 0.5 }, bright: 1 },
  },
  nocturne: {
    description: 'Glassy and spacious: pure sines and bells, long shimmering reverb, slow minor and dorian music.',
    sfx: { wave: 'sine', pitch: 1.12, soft: 0.008, fx: { reverb: 0.3, room: 0.75, damp: 0.25 } },
    music: { scales: ['dorian', 'minor', 'minorPentatonic'], bpm: [72, 88], roots: ['A2', 'D3', 'E2', 'F#2'], melody: 'glass', counter: 'piano', harmony: 'musicbox', pad: 'choir', bass: 'bass', tension: 'drone', drive: 'stab', kit: 'soft', busy: 0, sevenths: true, fx: { reverb: 0.34, room: 0.8, damp: 0.25 } },
    ambience: { fx: { reverb: 0.25, room: 0.8, damp: 0.3 }, bright: 0.8 },
  },
  papercut: {
    description: 'Light and dry: short plucked and tapped sounds, almost no room, playful pentatonic music.',
    sfx: { wave: 'triangle', pitch: 1.2, soft: 0.002, fx: { reverb: 0.04, room: 0.15, damp: 0.6, highpass: 120 } },
    music: { scales: ['pentatonic', 'major'], bpm: [100, 120], roots: ['C3', 'F2', 'G2', 'A2'], melody: 'kalimba', counter: 'musicbox', harmony: 'marimba', pad: 'organ', bass: 'pluck', tension: 'marimba', drive: 'pluck', kit: 'paper', swing: 0.2, busy: 2, fx: { reverb: 0.07, room: 0.25, damp: 0.6 } },
    ambience: { fx: { reverb: 0.04, room: 0.2, damp: 0.6 }, bright: 1.15 },
  },
  crypt: {
    description: 'Dark and heavy: low, dull, slightly gritty sounds in a big stone room, slow harmonic-minor music with deep drums.',
    sfx: { wave: 'saw', pitch: 0.82, soft: 0.003, fx: { reverb: 0.34, room: 0.85, damp: 0.8, lowpass: 4200 } },
    music: { scales: ['harmonicMinor', 'minor'], bpm: [66, 80], roots: ['D2', 'E2', 'A2', 'C3'], melody: 'cello', counter: 'horn', harmony: 'harp', pad: 'choir', bass: 'bass', tension: 'drone', drive: 'cello', kit: 'taiko', busy: 0, fx: { reverb: 0.36, room: 0.9, damp: 0.75, lowpass: 7000 } },
    ambience: { fx: { reverb: 0.35, room: 0.9, damp: 0.8, lowpass: 5000 }, bright: 0.6 },
  },
  retro: {
    description: 'Chiptune: square waves, no room, crunchy. The sound of the built-in effects.',
    sfx: { wave: 'square', pitch: 1, soft: 0.001, fx: { crush: 7 } },
    music: { scales: ['major', 'minor'], bpm: [110, 140], roots: ['C3', 'A2', 'G2', 'D3'], melody: 'lead', counter: 'pluck', harmony: 'chip', pad: 'pad', bass: 'bass', tension: 'chip', drive: 'chip', kit: 'chip', busy: 2, fx: {} },
    ambience: { fx: {}, bright: 1 },
  },
};

/** Names of the sound palettes. */
export const SOUND_STYLE_NAMES = Object.keys(SOUND_STYLES);

/** soundStyle(name, fn?) -> the palette. Throws on an unknown name, listing the valid ones. */
export function soundStyle(name = 'storybook', fn = 'soundStyle') {
  if (!Object.hasOwn(SOUND_STYLES, name)) throw new Error(`${fn}: unknown style "${name}". Styles: ${SOUND_STYLE_NAMES.join(', ')}`);
  return SOUND_STYLES[name];
}

/**
 * Materials: how a struck or scraped thing sounds.
 *   f: main pitch in Hz, modes: overtone ratios, ring: seconds it rings, noise: brightness of the strike, q: how ringing
 */
export const MATERIALS = {
  wood: { f: 240, modes: [1, 2.4, 3.9], ring: 0.09, noise: 1800, q: 6 },
  metal: { f: 620, modes: [1, 2.76, 5.4, 8.93], ring: 0.6, noise: 5200, q: 24 },
  stone: { f: 150, modes: [1, 1.7], ring: 0.05, noise: 1300, q: 3 },
  glass: { f: 1500, modes: [1, 2.32, 4.25], ring: 0.35, noise: 7000, q: 22 },
  crystal: { f: 2100, modes: [1, 2, 3.01, 4.2], ring: 0.9, noise: 9000, q: 28 },
  bone: { f: 480, modes: [1, 2.7], ring: 0.06, noise: 2600, q: 8 },
  cloth: { f: 120, modes: [1], ring: 0.03, noise: 900, q: 1 },
  paper: { f: 300, modes: [1], ring: 0.02, noise: 3500, q: 1 },
  leather: { f: 180, modes: [1, 1.6], ring: 0.07, noise: 1100, q: 2 },
  ice: { f: 1100, modes: [1, 2.5, 4.4], ring: 0.12, noise: 6500, q: 14 },
  flesh: { f: 110, modes: [1], ring: 0.05, noise: 700, q: 1.5 },
  slime: { f: 130, modes: [1], ring: 0.05, noise: 800, q: 2 },
  water: { f: 400, modes: [1], ring: 0.05, noise: 3000, q: 2 },
  grass: { f: 140, modes: [1], ring: 0.03, noise: 2400, q: 1 },
  dirt: { f: 110, modes: [1], ring: 0.04, noise: 1000, q: 1 },
  gravel: { f: 200, modes: [1], ring: 0.03, noise: 3200, q: 1.5 },
  sand: { f: 120, modes: [1], ring: 0.03, noise: 4200, q: 1 },
  snow: { f: 100, modes: [1], ring: 0.03, noise: 1700, q: 1.2 },
  leaves: { f: 160, modes: [1], ring: 0.02, noise: 3800, q: 1 },
  carpet: { f: 90, modes: [1], ring: 0.03, noise: 600, q: 1 },
};
