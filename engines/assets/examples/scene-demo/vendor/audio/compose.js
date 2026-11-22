// The composer behind generateScore: harmony, voicing, bass, melody and
// counter-melody as plain note lists. Everything works in "scale steps" (0 = the
// key note, 7 = an octave up in a seven-note scale) and is turned into note
// names at the end. No audio here, only the writing of the music.

import { pick } from './rng.js';
import { SCALES, midiToNote } from './notes.js';

// Eight-bar progressions as scale degrees (0 = I). Bar 4 ends on V (a question),
// bar 8 ends on V again so the loop falls back onto I when it restarts (the answer).
const PROGRESSIONS = {
  major: [[0, 4, 5, 3, 0, 4, 3, 4], [0, 5, 3, 4, 0, 5, 1, 4], [0, 3, 0, 4, 5, 3, 0, 4], [0, 2, 3, 4, 5, 3, 4, 4]],
  minor: [[0, 5, 2, 6, 0, 5, 3, 4], [0, 3, 6, 2, 5, 3, 4, 4], [0, 0, 3, 4, 5, 6, 0, 4], [0, 6, 5, 4, 0, 6, 5, 4]],
};
const MAJORISH = ['major', 'mixolydian', 'pentatonic'];
const CHORD_SCALE = { major: 'major', mixolydian: 'mixolydian', pentatonic: 'major', minor: 'minor', dorian: 'dorian', harmonicMinor: 'minor', minorPentatonic: 'minor' };

// One-bar rhythms on a 16-step grid as [start, length]. `busy` 0 calm .. 2 lively.
const RHYTHMS = [
  [[[0, 6], [6, 2], [8, 8]], [[0, 4], [4, 4], [8, 8]], [[0, 8], [8, 4], [12, 4]], [[0, 6], [8, 4], [12, 4]]],
  [[[0, 4], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 3], [3, 3], [6, 2], [8, 6], [14, 2]], [[0, 4], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 2], [2, 2], [4, 4], [8, 6], [14, 2]]],
  [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]], [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 4]], [[0, 2], [2, 1], [3, 1], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]]],
];
const CADENCE = [[0, 4], [4, 4], [8, 6]]; // ends early: the tune breathes before the next phrase
const ENDING = [[0, 4], [4, 2], [6, 2], [8, 8]];
// How high each bar of an eight-bar tune aims, in scale steps above its start: rise, rest, rise further to one peak, come home.
const ARC = [0, 1, 2, 1, 2, 3, 5, 0];

/**
 * compose({ rng, scaleName, root, bars, busy, sevenths }) -> the written music
 *   root: MIDI note of the key (36..52)   busy: 0, 1 or 2   sevenths: add the seventh to pad chords
 * Returns { progression, chords: [{ degree, tones (MIDI, low octave), classes }], pad, bass, melody, counter, arp }
 * where pad[b] is a list of MIDI notes and bass / melody / counter / arp are lists of bars, each a list of
 * { step, length, midi, accent } with step 0..15 and accent -1 soft, 0 plain, 1 strong.
 */
export function compose({ rng, scaleName, root, bars, busy = 1, sevenths = false }) {
  const major = MAJORISH.includes(scaleName);
  const melodyScale = SCALES[scaleName], chordScale = SCALES[CHORD_SCALE[scaleName] ?? scaleName], n = melodyScale.length;
  const at = (scale, s) => root + 12 * Math.floor(s / scale.length) + scale[((s % scale.length) + scale.length) % scale.length];
  const template = pick(rng, PROGRESSIONS[major ? 'major' : 'minor']);
  const progression = Array.from({ length: bars }, (_, b) => (bars === 4 ? [template[0], template[1], template[2], 4][b] : template[b % 8]));

  // chords: stacked thirds in the chord scale; in minor keys the V chord gets its major third (the pull back home)
  const chords = progression.map((degree) => {
    const tones = [0, 2, 4, 6].map((k) => at(chordScale, degree + k));
    if (!major && degree === 4 && tones[1] - tones[0] === 3) tones[1] += 1;
    const used = sevenths ? tones : tones.slice(0, 3);
    return { degree, tones, classes: used.map((m) => ((m % 12) + 12) % 12), triad: tones.slice(0, 3).map((m) => ((m % 12) + 12) % 12) };
  });

  // pad: every chord is voiced as close as possible around one fixed centre, so the voices move by
  // small steps from chord to chord instead of jumping in parallel
  const centre = 58 + ((root % 12) > 6 ? -2 : 2);
  const pad = chords.map((c) => c.classes.map((pc) => { let m = centre - 6 + ((pc - (centre - 6)) % 12 + 12) % 12; if (m > centre + 6) m -= 12; return m; }).sort((a, b) => a - b));

  // bass: the chord's root low down, the fifth half-way, and a step that walks into the next bar's root
  let lastBass = null;
  const lowOf = (pc) => { let m = 28 + ((pc - 28) % 12 + 12) % 12; if (lastBass !== null && m - lastBass > 7) m -= 12; if (m < 26) m += 12; return m; };
  const bass = chords.map((c, b) => {
    const low = lowOf(c.triad[0]); lastBass = low;
    const nextPc = chords[(b + 1) % bars].triad[0];
    let next = 28 + ((nextPc - 28) % 12 + 12) % 12; if (next - low > 7) next -= 12; if (low - next > 7) next += 12;
    const fifth = low + ((c.tones[2] - c.tones[0]) % 12);
    // the walking note is the scale note next to the coming root, on the side we arrive from
    const inScale = (m) => chordScale.includes((((m - root) % 12) + 12) % 12);
    const side = next > low ? -1 : 1;
    const walk = next === low ? fifth : inScale(next + side) ? next + side : next + side * 2;
    const line = [{ step: 0, length: 6, midi: low, accent: 1 }, { step: 8, length: 4, midi: fifth > low + 7 ? fifth - 12 : fifth, accent: 0 }];
    if (busy > 0) line.splice(1, 0, { step: 6, length: 2, midi: low, accent: -1 });
    line.push({ step: 14, length: 2, midi: Math.abs(walk - low) > 9 ? low : walk, accent: -1 });
    return line;
  });

  // melody: two short ideas (a rhythm plus a shape) that come back over new chords, a breath at the
  // half-way cadence, one highest note late in the tune, and a long home note at the end
  const inChord = (c, s) => c.triad.includes(((at(melodyScale, s) % 12) + 12) % 12);
  const snap = (c, s, prefer = 0) => { for (const d of n <= 5 ? [0, 1, -1, 2, -2] : [0, 1, -1, 2, -2, 3, -3]) { const t = s + (prefer < 0 ? -d : d); if (inChord(c, t)) return t; } return s; };
  let base = 0; while (at(melodyScale, base) < 67) base++; // the tune sits around the G above middle C and upward
  const lo = base - (n <= 5 ? 1 : 2), hi = base + n + (n <= 5 ? 0 : 2);
  const idea = () => { const rhythm = pick(rng, RHYTHMS[busy]); return { rhythm, shape: rhythm.map((_, i) => (i === 0 ? 0 : pick(rng, [-2, -1, -1, 1, 1, 1, 2]))) }; };
  const ideas = [idea(), idea(), idea()];
  const form = bars === 4 ? [0, 1, 0, 'end'] : [0, 1, 0, 'cadence', 0, 1, 2, 'end'];
  let pos = base + pick(rng, [0, 2, 4]), peak = -Infinity, previous = null;
  const melody = chords.map((c, b) => {
    const kind = form[b % form.length], last = b === bars - 1 || kind === 'end', cadence = kind === 'cadence';
    const use = typeof kind === 'number' ? ideas[kind] : null;
    const rhythm = use ? use.rhythm : cadence ? CADENCE : ENDING;
    const aim = base + Math.round((bars === 4 ? [0, 2, 5, 0][b] : ARC[b % 8]) * n / 7); // the arc is written for seven-note scales
    const climax = bars === 4 ? b === 2 : b % 8 === 6;
    let leap = 0;
    const before = pos;
    // stay in range by turning back, not by dropping an octave (which would be a huge jump)
    const top = !climax && bars >= 8 && b % 8 < 6 ? hi - (n <= 5 ? 2 : 3) : hi; // the first bars keep below the ceiling, so the peak is still to come
    const fold = (p) => (p > top ? top - (p - top) : p < lo ? lo + (lo - p) : p);
    return rhythm.map(([step, length], i) => {
      let move = use ? use.shape[i] : pick(rng, [-1, -1, 1]);
      if (leap) { move = leap > 0 ? -1 : 1; leap = 0; } // after a jump, step back the other way
      if (i === 0) pos = snap(c, fold(Math.round((pos + aim) / 2)), aim - pos); // each bar starts on a chord note, pulled toward the arc
      else pos = fold(pos + move);
      if (Math.abs(move) >= 2 && i > 0) leap = move;
      if (i > 0 && step % 8 === 0) pos = snap(c, pos, move); // the strong beats land on chord notes; the notes between pass by step
      if (cadence && i === rhythm.length - 1) pos = snap(c, pos, -1);
      if (last && i === rhythm.length - 2) pos = n * Math.round(pos / n) + (pos > n * Math.round(pos / n) ? 1 : -1); // step into the home note
      if (last && i === rhythm.length - 1) pos = n * Math.round(pos / n);
      if (pos > top + 2) pos = snap(c, top, -1);
      if (pos < lo - 2) pos = snap(c, lo, 1);
      if (climax && i === 0 && pos <= peak) { const up = snap(c, Math.min(peak + 1, before + n - 1), 1); pos = up <= hi + 2 ? up : snap(c, hi, -1); } // the one high point of the tune // the one high point of the tune
      // last resort: never jump more than an octave; the same note an octave nearer is always available
      while (previous !== null && at(melodyScale, pos) - previous > 12) pos -= n;
      while (previous !== null && previous - at(melodyScale, pos) > 12) pos += n;
      previous = at(melodyScale, pos);
      peak = Math.max(peak, pos);
      return { step, length, midi: at(melodyScale, pos), accent: step === 0 ? 1 : step % 4 === 0 ? 0 : -1 };
    });
  });

  // counter-melody: long notes below the tune that hold each chord's third, then lean toward the next bar's
  const mid = (pc, near) => { let m = near - 6 + ((pc - (near - 6)) % 12 + 12) % 12; while (m < 52) m += 12; while (m > 74) m -= 12; return m; };
  let voice = 62;
  const counter = chords.map((c, b) => {
    const third = mid(c.triad[1], voice), nextThird = mid(chords[(b + 1) % bars].triad[1], third);
    voice = Math.max(55, Math.min(69, third));
    const options = [mid(c.triad[2], third), mid(c.triad[0], third)]; // stay on chord notes: the fifth or the root, whichever is nearer to where the line goes next
    const lean = Math.abs(options[0] - nextThird) <= Math.abs(options[1] - nextThird) ? options[0] : options[1];
    return [{ step: 0, length: 8, midi: third, accent: 0 }, { step: 8, length: b % 2 ? 4 : 8, midi: lean, accent: -1 }, ...(b % 2 ? [{ step: 12, length: 4, midi: third, accent: -1 }] : [])];
  });

  // arpeggio: the pad's own notes one at a time, an octave up, so it moves as smoothly as the pad does
  const order = pick(rng, [[0, 1, 2, 1, 0, 1, 2, 1], [0, 2, 1, 2, 0, 2, 1, 2], [2, 1, 0, 1, 2, 1, 0, 1], [0, 1, 2, 3, 2, 1, 2, 1]]);
  const arp = pad.map((voicing) => {
    const notes = [...voicing.slice(0, 3), voicing[0] + 12].map((m) => m + 12);
    return order.map((k, i) => ({ step: i * 2, length: 2, midi: notes[k], accent: i % 4 === 0 ? 1 : i % 2 ? -1 : 0 }));
  });

  return { major, progression, chords, pad, bass, melody, counter, arp };
}

/**
 * barPattern(notes, steps?) -> one bar as a song pattern string ("C4^ - - . E4_ - ...")
 * notes: [{ step, length, midi | [midi...], accent }]. Later notes cut earlier ones short.
 */
export function barPattern(notes, steps = 16) {
  const cells = Array(steps).fill('.');
  for (const note of [...notes].sort((a, b) => a.step - b.step)) {
    if (note.step >= steps) continue;
    const names = (Array.isArray(note.midi) ? note.midi : [note.midi]).map((m) => midiToNote(Math.max(24, Math.min(100, m)))).join('+');
    cells[note.step] = names + (note.accent > 0 ? '^' : note.accent < 0 ? '_' : '');
    for (let s = 1; s < note.length && note.step + s < steps; s++) cells[note.step + s] = '-';
  }
  return cells.join(' ');
}
