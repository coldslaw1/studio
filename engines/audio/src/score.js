// Adaptive music. generateScore() writes one piece of music as stems (pad,
// bass, melody, counter-melody, harmony, percussion, tension, drive, drums)
// that share a tempo, a key and a chord progression, plus a table of states
// saying how loud each stem is when the game is calm, exploring, in danger or
// in combat. Because every stem keeps looping in time, moving between states
// is only a volume change: seamless, and always on the beat. The writing of
// the notes themselves is in compose.js.

import { createRng, pick } from './rng.js';
import { noteToMidi, midiToNote, midiToFreq } from './notes.js';
import { soundStyle } from './palettes.js';
import { renderSong, parseSong } from './song.js';
import { applyFx, fxActive, fxTail } from './fx.js';
import { limitPair } from './render.js';
import { INSTRUMENTS } from './instruments.js';
import { addTone } from './synth.js';
import { compose, barPattern } from './compose.js';

const DRIVES = ['R^ . R_ R . R_ R^ . R . R_ R . R_ F^ .', 'R^ R_ . R R_ . R^ R_ . R R_ . F^ . R_ .', 'R^ . R_ . R R_ . R^ R_ . R . F^ F_ R .'];
// Drum kits. light: gentle percussion (explore, danger). combat: two driving bars that alternate.
// turn: the bar that ends every four-bar phrase. fill: the bar that ends the loop. pulse: the danger heartbeat.
const KITS = {
  folk: { light: ['r . . . m_ . . . r . m_ . m . . .', 'r . . m_ m . . . r . . . m_ . r_ .'], combat: ['k^ . m_ . s . m_ k k . m_ . s^ . m_ m', 'k^ . m_ k s . m_ . k k m_ . s^ . m m_'], turn: 'k^ . m_ . s . m_ k k . s_ . s s_ t t', fill: 'k^ . s_ s s . t t k s_ s s t^ t t^ t', pulse: 'b^ . . . . . . . b_ . . . . . . .' },
  soft: { light: ['m_ . . . . . . . m . . . . . r_ .', 'm_ . . . . . r_ . m . . . . . . .'], combat: ['k^ . . h_ . . k . s . . h_ . k_ . .', 'k^ . . h_ . k_ k . s^ . . h_ . . h_ .'], turn: 'k^ . . h_ . . k . s . . s_ . t t_ .', fill: 'k^ . . s_ . s . t s_ . t . t^ t_ t .', pulse: 'b^ . . . . . . . . . . . b_ . . .' },
  paper: { light: ['w . . . r_ . . . w . r_ . r . . .', 'w . . r_ . . w_ . w . . . r_ . r .'], combat: ['k^ . w_ . c . w_ k k . w_ . c^ . w w_', 'k^ . w_ k c . w_ . k k w_ . c^ . w_ w'], turn: 'k^ . w_ . c . w_ . k . c_ . c c_ w w', fill: 'k^ . c_ c c . w w k c_ c c w^ w w^ w', pulse: 'w^ . . w_ . . . . w . . w_ . . . .' },
  taiko: { light: ['b_ . . . . . . . . . m_ . . . m_ .', 'b_ . . . . . m_ . . . . . b_ . . .'], combat: ['b^ . . b_ . . b . b^ . m_ . b b_ . m', 'b^ . b_ b . . b^ . b . m_ b . b_ b m'], turn: 'b^ . . b_ . . b . b^ b_ . b b b_ t t', fill: 'b^ b_ . b b_ . b . b^ b_ b b t^ t t^ t', pulse: 'b^ . . b_ . . . . . . . . . . . .' },
  chip: { light: ['h . . . h_ . . . h . . . h_ . h .', 'h . h_ . h . . . h . . h_ h . . .'], combat: ['k^ . h_ h s . h_ k k . h_ h s^ . h_ h', 'k^ . h_ k s . h_ h k k h_ . s^ . h h_'], turn: 'k^ . h_ . s . h_ . k . s_ . s s_ t t', fill: 'k^ . s_ s s . t t k s_ s s t^ t t^ t', pulse: 'k^ . . . . . . . k_ . . . . . . .' },
};

/** The states every generated score has, from quietest to loudest. */
export const MUSIC_STATES = ['calm', 'explore', 'danger', 'combat'];
/** Names of the stems in a generated score, in order. */
export const STEM_NAMES = ['pad', 'bass', 'melody', 'counter', 'harmony', 'perc', 'tension', 'drive', 'drums'];
const LEVELS = {
  calm: { pad: 0.7, bass: 0.4, melody: 0.7, counter: 0, harmony: 0.25, perc: 0, tension: 0, drive: 0, drums: 0 },
  explore: { pad: 0.65, bass: 0.7, melody: 0.8, counter: 0.6, harmony: 0.7, perc: 0.8, tension: 0, drive: 0, drums: 0 },
  danger: { pad: 0.4, bass: 0.7, melody: 0, counter: 0.35, harmony: 0.15, perc: 0.5, tension: 0.8, drive: 0.5, drums: 0 },
  combat: { pad: 0.55, bass: 1, melody: 0.8, counter: 0.6, harmony: 0, perc: 0.5, tension: 0.6, drive: 1, drums: 1 },
};
// Times of day: stem volumes are multiplied by these, and `tone` dulls the whole music (Hz, 0 = clear).
const TIMES = {
  day: { tone: 0, levels: {} },
  dusk: { tone: 6500, levels: { melody: 0.85, harmony: 0.8, perc: 0.7, drums: 0.9 } },
  night: { tone: 3200, levels: { melody: 0.65, counter: 1.15, harmony: 0.55, perc: 0.4, drums: 0.8, pad: 1.1 } },
};
// Instruments differ a lot in loudness. Each stem's track volume is set from how loud its
// instrument really is, so every style comes out balanced the same way.
const WANT = { pad: 0.045, bass: 0.13, melody: 0.13, counter: 0.11, harmony: 0.08, tension: 0.1, drive: 0.13 };
const measured = new Map();
function trackVolume(role, instrument) {
  if (!measured.has(instrument)) {
    const out = new Float32Array(11025);
    for (const tone of INSTRUMENTS[instrument](220, 0.4)) addTone(out, 22050, tone);
    let sum = 0;
    for (let i = 0; i < 8820; i++) sum += out[i] * out[i];
    measured.set(instrument, Math.sqrt(sum / 8820));
  }
  return Math.round(Math.max(0.15, Math.min(1.5, WANT[role] / measured.get(instrument))) * 100) / 100;
}
const PANS = { pad: 0, bass: 0, melody: 0.15, counter: -0.25, harmony: -0.35, perc: 0.3, tension: 0.2, drive: -0.15, drums: 0 };

/**
 * generateScore({ style, seed, bars, bpm }?) -> score
 *   style: one of SOUND_STYLE_NAMES; picks scale, tempo, instruments and drums (default 'storybook')
 *   seed:  number or string; same style + seed -> same music (default 1)
 *   bars:  4, 8 or 16 bars per loop (default 8)        bpm: override the style's tempo
 * score = { name, style, seed, key, bpm, bars, chords, state: 'calm', states, times, stems: [{ name, song, pan }], rise, fx }
 *   stems[n].song is an ordinary looping song (see song.js); states[name] maps stem name -> volume;
 *   times[name] is { tone, levels } for 'day', 'dusk', 'night'; rise is the swell played into a louder state.
 * Play it with audio.playMusic(score), move it with audio.setMusicState('combat') or audio.setMusicIntensity(0..1).
 */
export function generateScore(options = {}) {
  const { style = 'storybook', seed = 1, bars = 8 } = options;
  const st = soundStyle(style, 'generateScore').music;
  if (![4, 8, 16].includes(bars)) throw new Error(`generateScore: bars must be 4, 8 or 16, got ${JSON.stringify(bars)}`);
  const rng = createRng(`score:${style}:${seed}`);
  const scaleName = pick(rng, st.scales);
  const root = noteToMidi(pick(rng, st.roots));
  const bpm = options.bpm ?? Math.round(st.bpm[0] + rng() * (st.bpm[1] - st.bpm[0]));
  if (!(bpm >= 40 && bpm <= 220)) throw new Error(`generateScore: bpm must be a number from 40 to 220, got ${JSON.stringify(options.bpm)}`);
  const kit = KITS[st.kit], drivePattern = pick(rng, DRIVES);
  const music = compose({ rng, scaleName, root, bars, busy: st.busy ?? 1, sevenths: Boolean(st.sevenths) });
  const name = (midi) => midiToNote(Math.max(24, Math.min(100, midi)));

  const pad = music.pad.map((voicing) => barPattern([{ step: 0, length: 16, midi: voicing, accent: 0 }]));
  const pedal = music.chords.map(() => name(33 + ((root - 33) % 12 + 12) % 12));
  const sustained = !['marimba', 'chip', 'pluck', 'harp', 'kalimba', 'lute', 'piano'].includes(st.tension);
  const drive = music.chords.map((c) => {
    const R = name(36 + ((c.triad[0] - 36) % 12 + 12) % 12), F = name(36 + ((c.triad[2] - 36) % 12 + 12) % 12);
    return drivePattern.split(' ').map((tok) => (tok[0] === 'R' ? R + tok.slice(1) : tok[0] === 'F' ? F + tok.slice(1) : tok)).join(' ');
  });
  const drums = [], light = [], pulse = [];
  for (let b = 0; b < bars; b++) {
    drums.push(b === bars - 1 ? kit.fill : b % 4 === 3 ? kit.turn : kit.combat[b % 2]);
    light.push(kit.light[b % 2]);
    pulse.push(kit.pulse);
  }

  const base = `${style}-${seed}`, swing = st.swing ?? 0;
  // every stem gets the same swing, or the off-beats of two layers would land a few milliseconds apart
  const song = (stem, tracks) => ({ name: `${base}-${stem}`, bpm, stepsPerBeat: 4, loop: true, ...(swing ? { swing } : {}), tracks });
  const part = (role, instrument, notes) => ({ instrument, volume: trackVolume(role, instrument), pattern: notes });
  const stems = [
    { name: 'pad', song: song('pad', [part('pad', st.pad, pad)]) },
    { name: 'bass', song: song('bass', [part('bass', st.bass, music.bass.map((b) => barPattern(b)))]) },
    { name: 'melody', song: song('melody', [part('melody', st.melody, music.melody.map((b) => barPattern(b)))]) },
    { name: 'counter', song: song('counter', [part('counter', st.counter ?? st.harmony, music.counter.map((b) => barPattern(b)))]) },
    { name: 'harmony', song: song('harmony', [part('harmony', st.harmony, music.arp.map((b) => barPattern(b)))]) },
    { name: 'perc', song: song('perc', [{ instrument: 'drums', volume: 0.9, pattern: light }]) },
    { name: 'tension', song: song('tension', [
      part('tension', st.tension, sustained ? pedal.map((p) => `${p} ${Array(15).fill('-').join(' ')}`) : pedal.map((p) => `${p}^ . . ${p}_ . . ${p} . ${p}^ . . ${p}_ . . ${p} .`)),
      { instrument: 'drums', volume: 0.45, pattern: pulse },
    ]) },
    { name: 'drive', song: song('drive', [part('drive', st.drive, drive)]) },
    { name: 'drums', song: song('drums', [{ instrument: 'drums', volume: 0.85, pattern: drums }]) },
  ].map((stem) => ({ ...stem, pan: PANS[stem.name] }));
  for (const stem of stems) parseSong(stem.song);

  // The swell into a louder state: rising air for two beats, then a low hit in the key, on the bar line.
  const lead = Math.round((120 / bpm) * 1000) / 1000, low = midiToFreq(33 + ((root - 33) % 12 + 12) % 12);
  const rise = { lead, sound: { layers: [
    { wave: 'noise', freq: 9000, duration: lead + 0.05, attack: lead, release: 0.04, bandpass: 500, bandpassEnd: 5000, q: 1.4, volume: 0.22, seed: 41 },
    { wave: 'sine', freq: low * 2, freqEnd: low, duration: 1.2, delay: lead, decay: 0.9, sustain: 0, volume: 0.5 },
    { wave: 'noise', freq: 2500, duration: 0.5, delay: lead, decay: 0.4, sustain: 0, lowpass: 1800, volume: 0.2, seed: 42 },
  ] } };

  return {
    name: base, style, seed, key: `${midiToNote(root).replace(/-?\d+$/, '')} ${scaleName}`, bpm, stepsPerBeat: 4, beatsPerBar: 4, bars,
    chords: music.progression, state: 'calm', states: JSON.parse(JSON.stringify(LEVELS)), times: JSON.parse(JSON.stringify(TIMES)), stems, rise, fx: { ...st.fx },
  };
}

/**
 * intensityLevels(score, amount) -> { stem: volume }
 * A smooth dial across the score's states: 0 = the first (calm), 1 = the last (combat),
 * anything between is a blend of the two nearest states.
 */
export function intensityLevels(score, amount) {
  if (typeof amount !== 'number' || Number.isNaN(amount)) throw new Error(`intensityLevels: amount must be a number from 0 to 1, got ${JSON.stringify(amount)}`);
  const names = MUSIC_STATES.filter((s) => Object.hasOwn(score.states, s));
  const x = Math.max(0, Math.min(1, amount)) * (names.length - 1), i = Math.min(names.length - 2, Math.floor(x)), t = x - i;
  const a = score.states[names[i]], b = score.states[names[i + 1]], out = {};
  for (const stem of score.stems) out[stem.name] = Math.round(((a[stem.name] ?? 0) * (1 - t) + (b[stem.name] ?? 0) * t) * 1000) / 1000;
  return out;
}

/** scoreSeconds(score) -> length of one loop in seconds */
export function scoreSeconds(score) {
  return (score.bars * score.beatsPerBar * 60) / score.bpm;
}

/**
 * renderScore(score, { state, timeline, fade, sampleRate, samples }?) -> { left, right, seconds }
 *   samples:  a sample bank (samples.js): recorded instruments play the stems that name them
 *   state:    render one loop in this state (default the score's own)
 *   timeline: or a list like [{ state: 'calm', bars: 4 }, { state: 'combat', bars: 8 }] to hear the changes
 *   fade:     seconds a change takes (default 1.2)
 * For listening and WAV files; in a game use audio.playMusic(score).
 */
export function renderScore(score, options = {}) {
  if (!score || !Array.isArray(score.stems) || !score.states) throw new Error('renderScore: expected a score from generateScore');
  const sampleRate = options.sampleRate ?? 44100, fade = Math.max(0.02, options.fade ?? 1.2);
  const timeline = options.timeline ?? [{ state: options.state ?? score.state, bars: score.bars }];
  const barSamples = Math.round(((score.beatsPerBar * 60) / score.bpm) * sampleRate);
  const marks = [];
  let at = 0;
  for (const part of timeline) {
    if (!Object.hasOwn(score.states, part.state)) throw new Error(`renderScore: unknown state "${part.state}". This score has: ${Object.keys(score.states).join(', ')}`);
    if (!(part.bars >= 1)) throw new Error(`renderScore: timeline bars must be 1 or more, got ${JSON.stringify(part.bars)}`);
    marks.push({ at, levels: score.states[part.state] });
    at += Math.round(part.bars) * barSamples;
  }
  const dry = at, fx = fxActive(score.fx) ? score.fx : null;
  const n = dry + (fx ? Math.round(fxTail(fx) * sampleRate) : 0);
  const left = new Float32Array(n), right = new Float32Array(n);
  // like the live player: a layer coming in arrives quickly on the bar line, a layer leaving lingers
  const up = 1 - Math.exp(-1 / ((Math.min(fade, 0.6) / 3) * sampleRate)), down = 1 - Math.exp(-1 / ((fade / 2) * sampleRate));
  for (const stem of score.stems) {
    const loop = renderSong(stem.song, sampleRate, { samples: options.samples });
    const angle = ((stem.pan ?? 0) + 1) * Math.PI / 4, gl = Math.cos(angle) * Math.SQRT2, gr = Math.sin(angle) * Math.SQRT2;
    let gain = marks[0].levels[stem.name] ?? 0, target = gain, next = 1;
    for (let i = 0; i < dry; i++) {
      if (next < marks.length && i >= marks[next].at) target = marks[next++].levels[stem.name] ?? 0;
      gain += (target - gain) * (target > gain ? up : down);
      if (gain < 0.0005 && target === 0) continue;
      const x = loop[i % loop.length] * gain;
      left[i] += x * gl; right[i] += x * gr;
    }
  }
  if (fx) applyFx(left, right, fx, sampleRate);
  // Stems are loops, so the first sample carries the tail of the last bar: fade the ends of the file.
  const fadeIn = Math.round(sampleRate * 0.01), fadeOut = Math.min(n, Math.round(sampleRate * 0.3));
  for (const ch of [left, right]) {
    for (let i = 0; i < fadeIn; i++) ch[i] *= i / fadeIn;
    for (let i = 0; i < fadeOut; i++) ch[n - 1 - i] *= i / fadeOut;
  }
  limitPair(left, right, 0.9);
  return { left, right, seconds: n / sampleRate };
}
