// Instruments for music. Each one turns (frequency, seconds) into one or more
// tones for the synthesizer. Drums are tones picked by a letter.

/** Melodic instruments: name -> function(freq, seconds) -> list of tones. */
export const INSTRUMENTS = {
  // bright, clear melody voice
  lead: (f, d) => [{ wave: 'square', duty: 0.25, freq: f, duration: d, decay: 0.18, sustain: 0.6, release: 0.04, vibratoDepth: 0.12, vibratoRate: 5.5, volume: 0.22 }],
  // plain chiptune square
  chip: (f, d) => [{ wave: 'square', freq: f, duration: d, release: 0.02, volume: 0.2 }],
  // round low end
  bass: (f, d) => [{ wave: 'triangle', freq: f, duration: d, decay: 0.3, sustain: 0.7, release: 0.03, volume: 0.5 }],
  // soft held chords
  pad: (f, d) => [
    { wave: 'saw', freq: f * 1.004, duration: d + 0.2, attack: 0.1, release: 0.28, lowpass: 1500, volume: 0.09 },
    { wave: 'saw', freq: f * 0.996, duration: d + 0.2, attack: 0.1, release: 0.28, lowpass: 1500, volume: 0.09 },
  ],
  // short picked note
  pluck: (f, d) => [{ wave: 'triangle', freq: f, duration: Math.max(d, 0.25), decay: 0.22, sustain: 0, release: 0.03, volume: 0.4 }],
  // ringing bell
  bell: (f, d) => [
    { wave: 'sine', freq: f, duration: d + 0.5, decay: 0.6, sustain: 0, release: 0.1, volume: 0.3 },
    { wave: 'sine', freq: f * 3.01, duration: d + 0.25, decay: 0.25, sustain: 0, release: 0.05, volume: 0.07 },
  ],
  // warm steady tone
  organ: (f, d) => [
    { wave: 'sine', freq: f, duration: d, attack: 0.01, release: 0.05, volume: 0.25 },
    { wave: 'sine', freq: f * 2, duration: d, attack: 0.01, release: 0.05, volume: 0.1 },
  ],
  // breathy wooden flute
  flute: (f, d) => [
    { wave: 'sine', freq: f, duration: d, attack: 0.05, release: 0.08, vibratoDepth: 0.15, vibratoRate: 5, volume: 0.3 },
    { wave: 'triangle', freq: f * 2, duration: d, attack: 0.06, release: 0.08, volume: 0.05 },
    { wave: 'noise', freq: 6000, duration: Math.min(d, 0.25), attack: 0.02, decay: 0.2, sustain: 0.15, bandpass: Math.min(9000, f * 2), q: 1.5, volume: 0.05, seed: 31 },
  ],
  // plucked harp string
  harp: (f, d) => [
    { wave: 'triangle', freq: f, duration: Math.max(d, 0.5) + 0.4, decay: 0.5, sustain: 0, release: 0.1, volume: 0.34 },
    { wave: 'sine', freq: f * 2, duration: Math.max(d, 0.3) + 0.1, decay: 0.2, sustain: 0, volume: 0.1 },
  ],
  // bowed string section, slow to speak
  strings: (f, d) => [
    { wave: 'saw', freq: f * 1.003, duration: d + 0.25, attack: 0.14, release: 0.3, lowpass: 2200, vibratoDepth: 0.1, vibratoRate: 5.2, volume: 0.085 },
    { wave: 'saw', freq: f * 0.997, duration: d + 0.25, attack: 0.16, release: 0.3, lowpass: 2000, volume: 0.085 },
  ],
  // glass bell, long and clear
  glass: (f, d) => [
    { wave: 'sine', freq: f, fm: 3.5, fmDepth: 1.1, duration: d + 0.9, decay: 0.9, sustain: 0, release: 0.2, volume: 0.24 },
    { wave: 'sine', freq: f * 2.001, duration: d + 0.5, decay: 0.5, sustain: 0, volume: 0.06 },
  ],
  // wordless voices
  choir: (f, d) => [
    { wave: 'saw', freq: f * 1.002, duration: d + 0.3, attack: 0.2, release: 0.35, bandpass: 780, q: 2.5, vibratoDepth: 0.12, vibratoRate: 4.6, volume: 0.2 },
    { wave: 'saw', freq: f * 0.998, duration: d + 0.3, attack: 0.22, release: 0.35, bandpass: 1150, q: 3.5, volume: 0.12 },
  ],
  // wooden bars
  marimba: (f, d) => [
    { wave: 'sine', freq: f, duration: Math.max(d, 0.3), decay: 0.24, sustain: 0, volume: 0.4 },
    { wave: 'sine', freq: f * 4, duration: 0.08, decay: 0.05, sustain: 0, volume: 0.1 },
  ],
  // thumb piano: soft metal tines
  kalimba: (f, d) => [
    { wave: 'sine', freq: f, fm: 2.8, fmDepth: 0.7, duration: Math.max(d, 0.4) + 0.2, decay: 0.4, sustain: 0, volume: 0.32 },
    { wave: 'triangle', freq: f * 2, duration: 0.12, decay: 0.09, sustain: 0, volume: 0.07 },
  ],
  // tiny music box
  musicbox: (f, d) => [
    { wave: 'sine', freq: f * 2, fm: 4.01, fmDepth: 0.5, duration: Math.max(d, 0.5) + 0.4, decay: 0.55, sustain: 0, volume: 0.22 },
    { wave: 'sine', freq: f * 4.02, duration: 0.2, decay: 0.15, sustain: 0, volume: 0.04 },
  ],
  // dark bowed solo string
  cello: (f, d) => [
    { wave: 'saw', freq: f, duration: d + 0.1, attack: 0.07, release: 0.16, lowpass: 1300, vibratoDepth: 0.14, vibratoRate: 5, volume: 0.22 },
    { wave: 'triangle', freq: f, duration: d + 0.1, attack: 0.05, release: 0.16, volume: 0.12 },
  ],
  // short hard string hit, for driving patterns
  stab: (f, d) => [{ wave: 'saw', freq: f, duration: Math.min(d, 0.16), attack: 0.004, decay: 0.12, sustain: 0.15, release: 0.03, lowpass: 2600, lowpassEnd: 900, volume: 0.4 }],
  // soft piano: a struck string with a little hammer noise
  piano: (f, d) => [
    { wave: 'triangle', freq: f, duration: Math.max(d, 0.6) + 0.5, attack: 0.003, decay: 0.7, sustain: 0.05, release: 0.2, volume: 0.3 },
    { wave: 'sine', freq: f * 2.003, duration: Math.max(d, 0.4) + 0.2, decay: 0.35, sustain: 0, volume: 0.1 },
    { wave: 'sine', freq: f * 3.01, duration: 0.25, decay: 0.15, sustain: 0, volume: 0.04 },
    { wave: 'noise', freq: 3000, duration: 0.02, decay: 0.015, sustain: 0, lowpass: 2500, volume: 0.05, seed: 33 },
  ],
  // plucked lute or guitar: a bright pick through a small wooden body
  lute: (f, d) => [
    { wave: 'saw', freq: f, duration: Math.max(d, 0.4) + 0.3, decay: 0.4, sustain: 0, lowpass: 3200, lowpassEnd: 700, volume: 0.24 },
    { wave: 'triangle', freq: f, duration: Math.max(d, 0.4) + 0.3, decay: 0.5, sustain: 0, bandpass: 220, q: 1.5, volume: 0.25 },
  ],
  // mellow horn: opens up as it speaks
  horn: (f, d) => [
    { wave: 'saw', freq: f, duration: d + 0.15, attack: 0.08, release: 0.2, lowpass: 450, lowpassEnd: 1100, vibratoDepth: 0.08, vibratoRate: 4.5, volume: 0.3 },
    { wave: 'sine', freq: f, duration: d + 0.15, attack: 0.06, release: 0.2, volume: 0.14 },
  ],
  // low uneasy hum
  drone: (f, d) => [
    { wave: 'saw', freq: f * 1.006, duration: d + 0.4, attack: 0.5, release: 0.6, lowpass: 420, tremoloDepth: 0.25, tremoloRate: 0.7, volume: 0.2 },
    { wave: 'saw', freq: f * 0.994, duration: d + 0.4, attack: 0.5, release: 0.6, lowpass: 380, volume: 0.2 },
  ],
};

/** Drum sounds for a track with instrument 'drums': letter -> list of tones. */
export const DRUMS = {
  k: [{ wave: 'sine', freq: 150, freqEnd: 42, duration: 0.2, decay: 0.16, sustain: 0, volume: 0.85 }], // kick
  s: [ // snare
    { wave: 'noise', freq: 7000, duration: 0.14, decay: 0.11, sustain: 0, highpass: 900, volume: 0.4, seed: 21 },
    { wave: 'triangle', freq: 195, freqEnd: 140, duration: 0.08, decay: 0.07, sustain: 0, volume: 0.4 },
  ],
  h: [{ wave: 'noise', freq: 12000, duration: 0.04, decay: 0.03, sustain: 0, highpass: 6000, volume: 0.22, seed: 22 }], // closed hat
  o: [{ wave: 'noise', freq: 12000, duration: 0.2, decay: 0.18, sustain: 0, highpass: 5000, volume: 0.2, seed: 23 }], // open hat
  c: [{ wave: 'noise', freq: 3000, duration: 0.11, decay: 0.09, sustain: 0, highpass: 1200, lowpass: 5000, volume: 0.45, seed: 24 }], // clap
  t: [{ wave: 'sine', freq: 210, freqEnd: 105, duration: 0.2, decay: 0.18, sustain: 0, volume: 0.6 }], // tom
  b: [ // big deep drum
    { wave: 'sine', freq: 95, freqEnd: 38, duration: 0.5, decay: 0.4, sustain: 0, volume: 0.9 },
    { wave: 'noise', freq: 900, duration: 0.06, decay: 0.05, sustain: 0, lowpass: 700, volume: 0.3, seed: 25 },
  ],
  r: [{ wave: 'triangle', freq: 1700, duration: 0.03, decay: 0.025, sustain: 0, volume: 0.3 }], // rim tick
  m: [{ wave: 'noise', freq: 9000, duration: 0.07, attack: 0.02, decay: 0.05, sustain: 0, highpass: 4500, volume: 0.14, seed: 26 }], // shaker
  w: [{ wave: 'sine', freq: 820, freqEnd: 760, duration: 0.07, decay: 0.05, sustain: 0, volume: 0.35 }], // wood block
};

/** Names a track can use as its instrument. */
export const INSTRUMENT_NAMES = [...Object.keys(INSTRUMENTS), 'drums'];
