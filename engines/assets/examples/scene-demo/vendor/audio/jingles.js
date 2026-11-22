// Short one-shot tunes for big moments. Each is an ordinary song with
// loop: false. Play one with audio.play(jingle('win')).

const JINGLES = {
  win: { bpm: 150, tracks: [
    { instrument: 'lead', pattern: 'C5 E5 G5 C6 - . G5 . C6 - - - - - . .' },
    { instrument: 'bass', pattern: 'C3 - - - E3 - G3 - C3 - - - - - . .' },
    { instrument: 'drums', pattern: 'k . h . s . s . k+o . . . . . . .' },
  ] },
  lose: { bpm: 96, tracks: [
    { instrument: 'lead', pattern: 'E4 - - D#4 - - D4 - - C#4 - - C4 - - - - - - -' },
    { instrument: 'bass', pattern: 'A2 - - - - - G#2 - - - - - A2 - - - - - - -' },
  ] },
  levelUp: { bpm: 160, tracks: [
    { instrument: 'lead', pattern: 'G4 C5 E5 G5 C6 - E6 - - - . .' },
    { instrument: 'pluck', pattern: 'C4 . G4 . C5 . C5+E5+G5 - - - . .' },
  ] },
  gameOver: { bpm: 84, tracks: [
    { instrument: 'organ', pattern: 'C4+Eb4 - - - Bb3+D4 - - - Ab3+C4 - - - G3+B3 - - - - - - -' },
    { instrument: 'bass', pattern: 'C3 - - - Bb2 - - - Ab2 - - - G2 - - - - - - -' },
  ] },
  start: { bpm: 140, tracks: [
    { instrument: 'lead', pattern: 'C5 . C5 . G5 - - . ' },
    { instrument: 'drums', pattern: 'k . k . k+c . . .' },
  ] },
  secret: { bpm: 132, tracks: [
    { instrument: 'bell', pattern: 'G5 F#5 D#5 A4 G#4 E5 G#5 C6 - - - .' },
  ] },
};

/** Names of all built-in jingles. */
export const JINGLE_NAMES = Object.keys(JINGLES);

/** jingle(name) -> a fresh song object with loop: false */
export function jingle(name) {
  if (!Object.hasOwn(JINGLES, name)) throw new Error(`jingle: unknown jingle "${name}". Jingles: ${JINGLE_NAMES.join(', ')}`);
  const j = JINGLES[name];
  return { name, bpm: j.bpm, stepsPerBeat: 4, loop: false, tracks: j.tracks.map((t) => ({ ...t })) };
}
