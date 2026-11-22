// Note names, frequencies and scales.

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_RE = /^([A-Ga-g])([#b]?)(-?\d)$/;

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

/** isNote('C4') -> true. Notes are a letter, optional # or b, and an octave: C4, F#3, Bb2. */
export function isNote(name) {
  return typeof name === 'string' && NOTE_RE.test(name);
}

/** noteToMidi('A4') -> 69. Middle C is C4 = 60. */
export function noteToMidi(name) {
  const m = NOTE_RE.exec(String(name));
  if (!m) throw new Error(`Bad note "${name}". Notes look like C4, F#3 or Bb2.`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return SEMITONES[m[1].toUpperCase()] + accidental + (Number(m[3]) + 1) * 12;
}

/** midiToFreq(69) -> 440 */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** midiToNote(61) -> 'C#4' */
export function midiToNote(midi) {
  const n = Math.round(midi);
  return NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

/** noteToFreq('A4') -> 440 */
export function noteToFreq(name) {
  return midiToFreq(noteToMidi(name));
}

/**
 * scaleNotes('C4', 'major', 8) -> ['C4','D4','E4','F4','G4','A4','B4','C5']
 * Walks up the scale from the root for `count` notes.
 */
export function scaleNotes(root, scale = 'major', count = 8) {
  const steps = SCALES[scale];
  if (!steps) throw new Error(`Unknown scale "${scale}". Use one of: ${Object.keys(SCALES).join(', ')}.`);
  const base = noteToMidi(root);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(midiToNote(base + 12 * Math.floor(i / steps.length) + steps[i % steps.length]));
  }
  return out;
}
