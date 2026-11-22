// Songs are plain data: a tempo plus tracks, each track a text pattern.
//
//   { bpm: 120, tracks: [
//       { instrument: 'lead',  pattern: 'C4 . E4 . G4 - - .' },
//       { instrument: 'drums', pattern: 'k . h . s . h .' } ] }
//
// Pattern tokens, separated by spaces, one token = one step:
//   C4 F#3 Bb2   play that note        .   silence
//   -            hold the note before  |   ignored (use it to mark bars)
//   C4+E4+G4     chord                 k s h o c t   drums (k+h = both)
//   C4^  k^      played stronger       C4_  h_       played softer
// A song may also set swing: 0..0.6, which delays every off-beat for a lilting feel.

import { noteToFreq, isNote } from './notes.js';
import { addTone, limit } from './synth.js';
import { INSTRUMENTS, DRUMS, INSTRUMENT_NAMES } from './instruments.js';

function patternTokens(pattern) {
  const text = Array.isArray(pattern) ? pattern.join(' ') : pattern;
  return String(text).split(/\s+/).filter((tok) => tok && tok !== '|');
}

/**
 * parseSong(song) -> { bpm, stepSeconds, steps, loop, seconds, tracks: [{ instrument, volume, events }] }
 * events are { step, length, parts } where parts are note names or drum letters.
 * Throws an Error naming the track and token when something is wrong.
 */
export function parseSong(song) {
  const fn = 'parseSong';
  if (!song || typeof song !== 'object' || !Array.isArray(song.tracks) || song.tracks.length === 0) {
    throw new Error(`${fn}: a song needs a tracks list, like { bpm: 120, tracks: [{ instrument: 'lead', pattern: 'C4 . E4 .' }] }`);
  }
  const bpm = song.bpm ?? 120;
  const stepsPerBeat = song.stepsPerBeat ?? 4;
  if (!(bpm >= 30 && bpm <= 300)) throw new Error(`${fn}: song.bpm must be a number from 30 to 300, got ${JSON.stringify(song.bpm)}`);
  if (![1, 2, 3, 4, 6, 8].includes(stepsPerBeat)) throw new Error(`${fn}: song.stepsPerBeat must be 1, 2, 3, 4, 6 or 8, got ${JSON.stringify(song.stepsPerBeat)}`);

  const tracks = song.tracks.map((track, index) => {
    const where = `${fn}: track ${index} ("${track && track.instrument}")`;
    if (!track || !INSTRUMENT_NAMES.includes(track.instrument)) {
      throw new Error(`${where}: instrument must be one of ${INSTRUMENT_NAMES.join(', ')}`);
    }
    if (typeof track.pattern !== 'string' && !Array.isArray(track.pattern)) throw new Error(`${where}: pattern must be a string or a list of strings`);
    const volume = track.volume ?? 1;
    if (!(volume >= 0 && volume <= 2)) throw new Error(`${where}: volume must be a number from 0 to 2, got ${JSON.stringify(track.volume)}`);
    const tokens = patternTokens(track.pattern);
    if (tokens.length === 0) throw new Error(`${where}: pattern is empty`);
    const isDrums = track.instrument === 'drums';
    const events = [];
    tokens.forEach((token, step) => {
      if (token === '.') return;
      if (token === '-') { if (events.length && events.at(-1).step + events.at(-1).length === step) events.at(-1).length++; return; }
      const mark = token.at(-1), gain = mark === '^' ? 1.3 : mark === '_' ? 0.62 : 1;
      const parts = (gain === 1 ? token : token.slice(0, -1)).split('+');
      for (const part of parts) {
        if (isDrums && !Object.hasOwn(DRUMS, part)) {
          throw new Error(`${where}: unknown drum "${part}" at step ${step}. Drums are ${Object.keys(DRUMS).join(' ')} (join with + to hit two at once), "." is silence`);
        }
        if (!isDrums && !isNote(part)) {
          throw new Error(`${where}: unknown note "${part}" at step ${step}. Notes look like C4, F#3 or Bb2; "." is silence, "-" holds the note before`);
        }
      }
      events.push(gain === 1 ? { step, length: 1, parts } : { step, length: 1, parts, gain });
    });
    return { instrument: track.instrument, volume, events, steps: tokens.length };
  });

  const steps = Math.max(...tracks.map((t) => t.steps));
  const stepSeconds = 60 / bpm / stepsPerBeat;
  const swing = song.swing ?? 0;
  if (!(swing >= 0 && swing <= 0.6)) throw new Error(`${fn}: song.swing must be a number from 0 to 0.6, got ${JSON.stringify(song.swing)}`);
  if (steps * stepSeconds > 180) throw new Error(`${fn}: song is longer than 180 seconds, shorten the patterns`);
  return { bpm, stepSeconds, steps, stepsPerBeat, swing, loop: song.loop !== false, seconds: steps * stepSeconds, tracks };
}

/** songDuration(song) -> length of one pass through the song, in seconds */
export function songDuration(song) {
  return parseSong(song).seconds;
}

/** isSong(value) -> true when the value looks like a song (has a tracks list) */
export function isSong(value) {
  return Boolean(value) && typeof value === 'object' && Array.isArray(value.tracks);
}

/**
 * renderSong(song, sampleRate?, { samples }?) -> Float32Array of samples in -1..1
 * samples: a sample bank (see samples.js); its recorded instruments play the tracks that name them.
 * Tracks shorter than the longest one repeat to fill it. Looping songs
 * (the default) wrap note tails back to the start so the loop is seamless;
 * songs with loop: false get one extra second for the last notes to fade.
 */
export function renderSong(song, sampleRate = 44100, options = {}) {
  const plan = songPlan(song, sampleRate, options);
  for (const [, run] of plan.jobs) run();
  return plan.done()[0];
}

/**
 * songPlan(song, sampleRate?) -> { jobs: [[cost, run], ...], done() -> [samples] }
 * The same work as renderSong, cut into small jobs (one per note) so a browser
 * can spread it over several frames instead of freezing. Run every job in
 * order, then call done(). cost is the job's size in samples.
 */
export function songPlan(song, sampleRate = 44100, options = {}) {
  const parsed = parseSong(song);
  const bank = options.samples ?? null;
  const loopSamples = Math.round(parsed.seconds * sampleRate);
  const out = new Float32Array(loopSamples + (parsed.loop ? 0 : sampleRate));
  const jobs = [];
  for (const track of parsed.tracks) {
    for (let offset = 0; offset < parsed.steps; offset += track.steps) {
      for (const event of track.events) {
        const step = offset + event.step;
        if (step >= parsed.steps) break;
        // swing: the note half-way through each beat comes late (and the one after it a little), like a skip
        const inBeat = parsed.stepsPerBeat === 4 ? step % 4 : -1;
        const delay = (step + (inBeat === 2 ? parsed.swing : inBeat === 3 ? parsed.swing / 2 : 0)) * parsed.stepSeconds;
        const seconds = Math.min(event.length, parsed.steps - step) * parsed.stepSeconds;
        for (const part of event.parts) {
          if (bank && track.instrument !== 'drums' && bank.has(track.instrument)) {
            // a recorded instrument plays this note
            const note = { instrument: track.instrument, freq: noteToFreq(part), delay, seconds, volume: Math.min(1.5, track.volume * (event.gain ?? 1)) };
            jobs.push([Math.round(bank.noteSeconds(track.instrument, seconds) * sampleRate), () => bank.addNote(out, sampleRate, note, parsed.loop)]);
            continue;
          }
          const tones = track.instrument === 'drums' ? DRUMS[part] : INSTRUMENTS[track.instrument](noteToFreq(part), seconds);
          for (const tone of tones) {
            const placed = { ...tone, delay, volume: Math.min(1, tone.volume * track.volume * (event.gain ?? 1)) };
            jobs.push([Math.round((tone.duration ?? 0.2) * sampleRate), () => addTone(out, sampleRate, placed, parsed.loop)]);
          }
        }
      }
    }
  }
  return { jobs, done: () => [limit(out, 0.9)] };
}
