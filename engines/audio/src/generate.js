// Writes a looping background song from a seed and a mood. The result is an
// ordinary song object (see song.js), so it can be edited, saved or tweaked.

import { createRng, pick } from './rng.js';
import { SCALES, noteToMidi, midiToNote } from './notes.js';

const DRUM_BARS = {
  full: 'k . h . s . h . k k h . s . h .',
  drive: 'k . h h s . h k k . h h s . h h',
  march: 'k . . h s . s . k . . h s s s .',
  sparse: 'k . . . . . . . . . h . . . . .',
};

// Melody rhythms for one 16-step bar: [start step, length] pairs.
const RHYTHMS = {
  busy: [
    [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]],
    [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
    [[0, 4], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]],
  ],
  medium: [
    [[0, 4], [4, 2], [6, 2], [8, 4], [12, 4]],
    [[0, 4], [4, 4], [8, 2], [10, 2], [12, 4]],
    [[0, 6], [6, 2], [8, 4], [12, 4]],
  ],
  slow: [
    [[0, 8], [8, 4], [12, 4]],
    [[0, 6], [6, 2], [8, 8]],
    [[0, 4], [4, 4], [8, 8]],
  ],
};

/** Moods generateSong understands, with the settings each one uses. */
export const MOODS = {
  happy: { scale: 'major', bpm: 126, roots: ['C3', 'G2', 'D3', 'F2'], chords: [[0, 4, 5, 3], [0, 3, 4, 4], [0, 5, 3, 4]], drums: 'full', lead: 'lead', rhythm: 'busy', bass: 'bounce', pad: false },
  calm: { scale: 'major', bpm: 80, roots: ['C3', 'F2', 'G2'], chords: [[0, 3, 0, 4], [0, 5, 3, 4]], drums: null, lead: 'bell', rhythm: 'slow', bass: 'long', pad: true },
  tense: { scale: 'minor', bpm: 144, roots: ['A2', 'E2', 'D3'], chords: [[0, 0, 5, 4], [0, 6, 5, 4]], drums: 'drive', lead: 'lead', rhythm: 'busy', bass: 'pulse', pad: false },
  sad: { scale: 'minor', bpm: 72, roots: ['A2', 'D3', 'E2'], chords: [[0, 5, 3, 4], [0, 3, 5, 4]], drums: null, lead: 'pluck', rhythm: 'slow', bass: 'long', pad: true },
  heroic: { scale: 'major', bpm: 112, roots: ['D3', 'C3', 'G2'], chords: [[0, 4, 5, 3], [0, 3, 0, 4]], drums: 'march', lead: 'lead', rhythm: 'medium', bass: 'bounce', pad: true },
  spooky: { scale: 'harmonicMinor', bpm: 92, roots: ['D3', 'A2', 'E2'], chords: [[0, 0, 3, 4], [0, 5, 0, 4]], drums: 'sparse', lead: 'bell', rhythm: 'slow', bass: 'long', pad: true },
};

/** Names of the moods generateSong accepts. */
export const MOOD_NAMES = Object.keys(MOODS);

/**
 * generateSong({ mood, seed, bars, bpm, rng }) -> song object
 *   mood: one of MOOD_NAMES (default 'happy')
 *   seed: number or string; same seed + mood -> same song (default 1)
 *   bars: 4, 8, 12 or 16 (default 8)      bpm: override the mood's tempo
 *   rng:  optional rng() function to use instead of the seed
 */
export function generateSong(options = {}) {
  const { mood = 'happy', seed = 1, bars = 8 } = options;
  const m = Object.hasOwn(MOODS, mood) ? MOODS[mood] : null;
  if (!m) throw new Error(`generateSong: unknown mood "${mood}". Moods: ${MOOD_NAMES.join(', ')}`);
  if (![4, 8, 12, 16].includes(bars)) throw new Error(`generateSong: bars must be 4, 8, 12 or 16, got ${JSON.stringify(bars)}`);
  const rng = options.rng ?? createRng(`${mood}:${seed}`);

  const scale = SCALES[m.scale];
  const root = noteToMidi(pick(rng, m.roots));
  const progression = pick(rng, m.chords);
  // degree(n) -> midi note of the n-th scale step above the root (n can pass 7)
  const degree = (n) => root + 12 * Math.floor(n / scale.length) + scale[((n % scale.length) + scale.length) % scale.length];
  const bar = (fill) => Array(16).fill(fill);

  const lead = [], bass = [], pad = [], drums = [];
  let position = 11 + pick(rng, [0, 2, 4]); // melody position, in scale steps above the root
  const phrase = []; // first four bars of melody, reused later so the tune repeats

  for (let b = 0; b < bars; b++) {
    const chord = progression[b % 4];
    const chordSteps = [chord, chord + 2, chord + 4];
    const isChordTone = (p) => chordSteps.some((c) => (((p - c) % 7) + 7) % 7 === 0);
    const lastBar = b === bars - 1;

    // melody
    let cells;
    if (b >= 4 && b % 8 >= 4 && !lastBar && phrase[b % 4]) {
      cells = phrase[b % 4];
    } else {
      cells = bar('.');
      const rhythm = lastBar ? [[0, 4], [4, 4], [8, 8]] : pick(rng, RHYTHMS[m.rhythm]);
      rhythm.forEach(([start, length], i) => {
        position += pick(rng, [-2, -1, -1, 1, 1, 2]);
        if (i === 0 || start === 8) { let guard = 0; while (!isChordTone(position) && guard++ < 7) position++; }
        if (lastBar && i === rhythm.length - 1) position = Math.round(position / 7) * 7;
        while (position > 20) position -= 7;
        while (position < 7) position += 7;
        cells[start] = midiToNote(degree(position));
        for (let s = 1; s < length; s++) cells[start + s] = '-';
      });
      if (b < 4) phrase[b] = cells;
    }
    lead.push(cells.join(' '));

    // bass
    const low = midiToNote(degree(chord)), fifth = midiToNote(degree(chord + 4));
    const line = bar('.');
    if (m.bass === 'long') { line.fill('-'); line[0] = low; }
    else if (m.bass === 'pulse') { for (let s = 0; s < 16; s += 2) line[s] = low; }
    else { line[0] = low; line[1] = '-'; line[6] = low; line[8] = fifth; line[9] = '-'; line[12] = low; line[14] = fifth; }
    bass.push(line.join(' '));

    if (m.pad) pad.push([chordSteps.map((c) => midiToNote(degree(c) + 12)).join('+'), ...Array(15).fill('-')].join(' '));
    if (m.drums) drums.push(lastBar && m.drums !== 'sparse' ? 'k . h . s . h . k . s . s s t t' : DRUM_BARS[m.drums]);
  }

  const tracks = [
    { instrument: m.lead, volume: 1, pattern: lead },
    { instrument: 'bass', volume: 0.9, pattern: bass },
  ];
  if (m.pad) tracks.push({ instrument: 'pad', volume: 1, pattern: pad });
  if (m.drums) tracks.push({ instrument: 'drums', volume: 0.8, pattern: drums });
  return { name: `${mood}-${seed}`, bpm: options.bpm ?? m.bpm, stepsPerBeat: 4, loop: true, tracks };
}
