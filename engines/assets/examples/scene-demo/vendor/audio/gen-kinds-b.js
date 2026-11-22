// Recipes for game-feel sounds: pickups, blasts, magic, menus, creatures.
// Same contract as gen-kinds.js: each function gets a context `c`, returns tones.

const ARPS = [[0, 7], [0, 5, 12], [0, 4, 7, 12], [0, 12], [0, 7, 12, 19]];

export const KINDS_B = {
  // a reward: a quick rising chime; coins and gems ring like their material
  pickup(c) {
    const m = c.mat('metal'), base = c.P(c.v(1050, 0.08)), steps = c.pick(ARPS), speed = c.D(0.062);
    const d = speed * steps.length + c.D(0.3);
    const out = [
      { wave: c.wave, duty: 0.3, freq: base, arp: steps, arpSpeed: speed, duration: d, decay: d * 0.8, sustain: 0, volume: 0.4 },
      { wave: 'sine', freq: base * 2, arp: steps, arpSpeed: speed, fm: 3.01, fmDepth: 0.7, duration: d, delay: 0.01, decay: d * 0.6, sustain: 0, volume: 0.16 },
    ];
    if (m.ring > 0.3) out.push({ wave: 'sine', freq: c.P(m.f * 2.4) * Math.pow(2, steps.at(-1) / 12), fm: 2.76, fmDepth: 1.1, duration: d + m.ring * 0.5, delay: speed * (steps.length - 1), decay: m.ring * 0.8, sustain: 0, volume: 0.2 });
    return out;
  },
  // a blast: noise that starts bright and falls dark, a sub drop, late crackle
  explosion(c) {
    const d = c.D(c.v(1.0));
    const out = [
      { wave: 'noise', freq: c.v(2800), freqEnd: 140, duration: d, decay: d * 0.75, sustain: 0, lowpass: 3400, lowpassEnd: 240, drive: 0.5, volume: 0.8, seed: c.seed() },
      { wave: 'sine', freq: c.P(c.v(120)), freqEnd: c.P(32), duration: d * 0.7, decay: d * 0.5, sustain: 0, drive: 0.3, volume: 0.8 },
      { wave: 'noise', freq: 7000, duration: 0.05, decay: 0.04, sustain: 0, volume: 0.5, seed: c.seed() },
    ];
    for (let i = 0; i < 5; i++) out.push({ wave: 'noise', freq: 1500 + c.rng() * 3000, duration: 0.04 + c.rng() * 0.05, delay: d * (0.25 + c.rng() * 0.5), decay: 0.05, sustain: 0, lowpass: 2500, volume: 0.12 + c.rng() * 0.15, seed: c.seed(), pan: c.rng() * 1.2 - 0.6 });
    return out;
  },
  // thunder, a quake: long, low, rolling
  rumble(c) {
    const d = c.D(c.v(2.4));
    return [
      { wave: 'noise', freq: 600, duration: d, attack: c.said('thunder') ? 0.02 : 0.4, decay: d * 0.8, sustain: 0.1, release: d * 0.3, lowpass: c.P(260), lowpassEnd: c.P(90), tremoloDepth: 0.5, tremoloRate: c.v(5), drive: 0.4, volume: 0.9, seed: c.seed() },
      { wave: 'sine', freq: c.P(52), freqEnd: c.P(34), duration: d * 0.8, attack: 0.1, release: d * 0.4, jitter: 0.5, tremoloDepth: 0.4, tremoloRate: c.v(7), volume: 0.6, seed: c.seed() },
      ...(c.said('thunder') ? [{ wave: 'noise', freq: 9000, freqEnd: 800, duration: 0.3, decay: 0.2, sustain: 0, highpass: 500, volume: 0.6, seed: c.seed() }] : []),
    ];
  },
  // energy: a fast falling buzz; spells and magic get a rising shimmer instead
  zap(c) {
    if (c.said('spell') || c.said('cast') || c.said('magic') || c.said('beam')) {
      const f = c.P(c.v(420)), d = c.D(c.v(0.55));
      return [
        { wave: 'sine', freq: f, freqEnd: f * c.v(3.2, 0.2), fm: 1.5, fmDepth: 2.2, duration: d, attack: 0.02, release: d * 0.4, vibratoDepth: 0.4, vibratoRate: 18, volume: 0.45 },
        { wave: 'noise', freq: 9000, duration: d, attack: d * 0.5, release: d * 0.4, bandpass: f * 4, bandpassEnd: f * 9, q: 4, volume: 0.25, seed: c.seed() },
        { wave: 'sine', freq: f * 4, arp: [0, 7, 12, 19, 24], arpSpeed: d / 6, duration: d, decay: d, sustain: 0, volume: 0.14 },
      ];
    }
    const hi = c.P(c.v(1700)), d = c.D(c.v(0.22));
    return [
      { wave: c.wave === 'sine' ? 'saw' : c.wave, freq: hi, freqEnd: hi * c.v(0.16, 0.3), duration: d, decay: d * 0.9, sustain: 0.1, lowpass: 8000, volume: 0.4 },
      { wave: 'square', freq: hi * 1.5, freqEnd: hi * 0.3, arp: [0, 12], arpSpeed: 0.014, arpLoop: true, duration: d * 0.8, decay: d * 0.7, sustain: 0, volume: 0.18 },
      { wave: 'noise', freq: 8000, duration: 0.03, decay: 0.025, sustain: 0, highpass: 3000, volume: 0.25, seed: c.seed() },
    ];
  },
  // menus: tiny, dry and clear. The word picks the gesture (confirm rises, cancel falls, error buzzes)
  ui(c) {
    const f = c.P(c.v(760, 0.06)), w = c.wave;
    if (c.said('error') || c.said('deny')) return [0, 0.13].map((delay) => ({ wave: 'square', freq: f * 0.2, duration: 0.11, delay, lowpass: 2200, volume: 0.4 }));
    if (c.said('confirm') || c.said('accept') || c.said('select')) return [{ wave: w, duty: 0.25, freq: f, arp: [0, 7], arpSpeed: 0.06, duration: 0.2, decay: 0.16, sustain: 0.1, volume: 0.4 }];
    if (c.said('cancel') || c.said('back')) return [{ wave: w, duty: 0.25, freq: f, arp: [0, -7], arpSpeed: 0.06, duration: 0.2, decay: 0.16, sustain: 0.1, volume: 0.4 }];
    if (c.said('notify')) return [{ wave: 'sine', freq: f * 1.5, arp: [0, 5, 12], arpSpeed: 0.09, fm: 2, fmDepth: 0.4, duration: 0.5, decay: 0.4, sustain: 0, volume: 0.4 }];
    if (c.said('hover') || c.said('tick')) return [{ wave: 'sine', freq: f * 2.2, duration: 0.025, decay: 0.02, sustain: 0, volume: 0.25 }];
    if (c.said('blip') || c.said('beep')) return [{ wave: w, freq: f, duration: c.D(0.07), decay: 0.06, sustain: 0.3, volume: 0.35 }];
    return [ // click, button, menu, toggle
      { wave: 'noise', freq: 5000, duration: 0.012, decay: 0.01, sustain: 0, highpass: 1500, volume: 0.35, seed: c.seed() },
      { wave: 'sine', freq: f * 2.4, freqEnd: f * 1.6, duration: 0.04, decay: 0.035, sustain: 0, volume: 0.35 },
    ];
  },
  // living things. The word picks the voice.
  creature(c) {
    const has = (...ws) => ws.some((w) => c.said(w));
    if (has('chirp', 'tweet', 'bird')) {
      const f = c.P(c.v(3000, 0.15)), n = 2 + Math.floor(c.rng() * 3), out = [];
      for (let i = 0; i < n; i++) { const up = c.rng() < 0.6; out.push({ wave: 'sine', freq: f * c.v(1, 0.1), freqEnd: f * (up ? 1.28 : 0.8), duration: 0.07 + c.rng() * 0.05, delay: i * c.v(0.13), attack: 0.01, release: 0.04, volume: 0.3 }); }
      return out;
    }
    if (has('whistle')) { const f = c.P(c.v(1500, 0.1)); return [
      { wave: 'sine', freq: f, freqEnd: f * c.v(1.5, 0.15), duration: c.D(0.22), attack: 0.03, release: 0.05, vibratoDepth: 0.1, vibratoRate: 7, volume: 0.4 },
      { wave: 'sine', freq: f * 1.5, freqEnd: f * c.v(1.1, 0.1), duration: c.D(0.3), delay: c.D(0.24), attack: 0.03, release: 0.1, vibratoDepth: 0.1, vibratoRate: 7, volume: 0.4 },
      { wave: 'noise', freq: 9000, duration: c.D(0.55), attack: 0.05, release: 0.1, bandpass: f * 1.3, q: 3, volume: 0.05, seed: c.seed() },
    ]; }
    if (has('cricket')) return [0, 0.09, 0.18].map((delay) => ({ wave: 'sine', freq: c.P(c.v(4400, 0.04)), duration: 0.06, delay, attack: 0.008, release: 0.02, tremoloDepth: 1, tremoloRate: 68, volume: 0.22 }));
    if (has('hoot', 'owl')) return [0, 0.34].map((delay, i) => ({ wave: 'sine', freq: c.P(c.v(370, 0.05)) * (i ? 0.94 : 1), duration: i ? 0.45 : 0.22, delay, attack: 0.05, release: 0.15, vibratoDepth: 0.15, vibratoRate: 5, volume: 0.4 }));
    if (has('croak', 'frog')) return [0, 0.2].map((delay) => ({ wave: 'square', duty: 0.2, freq: c.P(c.v(160)), freqEnd: c.P(210), duration: 0.14, delay, attack: 0.01, release: 0.04, tremoloDepth: 0.9, tremoloRate: 42, lowpass: 1800, volume: 0.4 }));
    if (has('cluck', 'chicken', 'quack', 'duck', 'caw', 'crow')) return [0, 0.16, 0.3].map((delay, i) => ({ wave: 'saw', freq: c.P(c.v(520)), freqEnd: c.P(i === 2 ? 900 : 380), duration: i === 2 ? 0.16 : 0.06, delay, attack: 0.005, release: 0.03, bandpass: 1400, q: 3, volume: 0.45 }));
    if (has('hiss', 'snake')) return [{ wave: 'noise', freq: 9000, duration: c.D(c.v(0.7)), attack: 0.12, release: 0.3, highpass: 3800, tremoloDepth: 0.2, tremoloRate: 24, volume: 0.5, seed: c.seed() }];
    if (has('howl', 'wolf', 'moan', 'ghost', 'moo', 'cow', 'meow', 'cat', 'cry')) {
      const small = has('meow', 'cat', 'cry');
      const f = c.P(c.v(has('moan', 'ghost') ? 190 : has('moo', 'cow') ? 140 : small ? 560 : 330)), d = c.D(c.v(small ? 0.6 : 1.5));
      return [
        { wave: 'sine', freq: f, freqEnd: f * 1.45, duration: d * 0.45, attack: 0.12, release: 0.05, vibratoDepth: 0.3, vibratoRate: 5, volume: 0.45 },
        { wave: 'sine', freq: f * 1.45, freqEnd: f * 0.9, duration: d * 0.6, delay: d * 0.42, attack: 0.04, release: d * 0.3, vibratoDepth: 0.4, vibratoRate: 5.5, volume: 0.45 },
        { wave: 'noise', freq: 3000, duration: d, attack: d * 0.3, release: d * 0.4, bandpass: f * 3, q: 3, volume: 0.1, seed: c.seed() },
      ];
    }
    if (has('screech', 'squeal', 'bat', 'rat', 'scream', 'mouse')) return [{ wave: 'saw', freq: c.P(c.v(1500)), freqEnd: c.P(c.v(2400)), duration: c.D(0.4), attack: 0.02, release: 0.12, jitter: 0.6, vibratoDepth: 0.8, vibratoRate: 34, bandpass: 2800, q: 3, volume: 0.5, seed: c.seed() }];
    if (has('purr')) return [{ wave: 'saw', freq: c.P(27), duration: c.D(1.2), attack: 0.2, release: 0.4, bandpass: 220, q: 2, tremoloDepth: 0.6, tremoloRate: 24, volume: 0.6 }];
    // roar, growl, snarl, grunt, bark and anything unnamed: a rough low voice through a moving mouth
    const short = has('grunt', 'bark', 'dog', 'oink', 'pig', 'goblin'), d = c.D(c.v(short ? 0.22 : 0.9)), f = c.P(c.v(has('snarl') ? 110 : 78));
    return [
      { wave: 'saw', freq: f, freqEnd: f * c.v(0.72), duration: d, attack: short ? 0.01 : 0.06, release: d * 0.35, jitter: 0.6, bandpass: c.P(520), bandpassEnd: c.P(c.v(820)), q: 3, drive: 0.6, volume: 0.8, seed: c.seed() },
      { wave: 'saw', freq: f * 1.5, freqEnd: f, duration: d, attack: 0.05, release: d * 0.35, jitter: 0.8, bandpass: c.P(1500), q: 4, drive: 0.4, volume: 0.35, seed: c.seed() },
      { wave: 'noise', freq: 2500, duration: d, attack: d * 0.2, release: d * 0.5, bandpass: c.P(1100), q: 1.5, tremoloDepth: 0.7, tremoloRate: Math.min(190, f * 0.5), volume: 0.25, seed: c.seed() },
    ];
  },
  // a leap: pitch slides up; "bounce" and "boing" wobble back down
  jump(c) {
    const f = c.P(c.v(250));
    if (c.said('bounce') || c.said('boing') || c.said('spring')) return [{ wave: c.wave, freq: f * 2, freqEnd: f * 0.9, duration: c.D(0.3), decay: 0.25, sustain: 0.1, vibratoDepth: 2.5, vibratoRate: 22, volume: 0.45 }];
    return [
      { wave: c.wave, duty: 0.3, freq: f, freqEnd: f * c.v(2.7, 0.15), duration: c.D(c.v(0.22)), decay: 0.2, sustain: 0.2, volume: 0.4 },
      { wave: 'noise', freq: 2000, duration: 0.05, decay: 0.04, sustain: 0, lowpass: 1500, volume: 0.15, seed: c.seed() },
    ];
  },
  // getting stronger: a rising run with a shimmer on top; "teleport" is a long sweep
  powerup(c) {
    const f = c.P(c.v(330, 0.06));
    if (c.said('teleport') || c.said('warp') || c.said('portal')) return [
      { wave: 'sine', freq: f, freqEnd: f * 6, fm: 2, fmDepth: 1.5, duration: c.D(0.55), attack: 0.03, release: 0.2, vibratoDepth: 1.5, vibratoRate: 24, volume: 0.45 },
      { wave: 'noise', freq: 9000, duration: c.D(0.55), attack: 0.3, release: 0.2, bandpass: 900, bandpassEnd: 6000, q: 3, volume: 0.25, seed: c.seed() },
    ];
    const run = c.pick([[0, 4, 7, 12, 16], [0, 5, 7, 12, 17], [0, 4, 7, 11, 14, 19]]), speed = c.D(0.075), d = speed * run.length + c.D(0.45);
    return [
      { wave: c.wave, duty: 0.3, freq: f, arp: run, arpSpeed: speed, duration: d, release: 0.2, decay: d, sustain: 0.3, volume: 0.36 },
      { wave: 'sine', freq: f * 2, arp: run, arpSpeed: speed, fm: 3, fmDepth: 0.6, duration: d, delay: speed / 2, decay: d * 0.8, sustain: 0, volume: 0.18 },
      { wave: 'triangle', freq: f / 2, freqEnd: f, duration: d * 0.7, attack: 0.05, release: 0.2, volume: 0.25 },
    ];
  },
  // pain and loss: pitch falls; "death", "lose" and "fail" fall further and slower
  hurt(c) {
    const f = c.P(c.v(430));
    if (c.said('death') || c.said('die') || c.said('lose') || c.said('fail') || c.said('defeat')) return [
      { wave: c.wave, freq: f, arp: [0, -3, -7, -12], arpSpeed: c.D(0.16), duration: c.D(0.95), release: 0.3, vibratoDepth: 0.4, vibratoRate: 6, volume: 0.45 },
      { wave: 'triangle', freq: f / 2, freqEnd: f / 4, duration: c.D(0.9), release: 0.3, volume: 0.3 },
    ];
    return [
      { wave: 'saw', freq: f, freqEnd: f * c.v(0.3, 0.2), duration: c.D(0.26), decay: 0.22, sustain: 0.1, vibratoDepth: 1.4, vibratoRate: 30, lowpass: 3400, volume: 0.45 },
      { wave: 'noise', freq: 3000, duration: 0.05, decay: 0.04, sustain: 0, volume: 0.3, seed: c.seed() },
    ];
  },
  // a machine or a spell that keeps running: a low buzz with a slow pulse and a little air
  hum(c) {
    const f = c.P(c.v(70)), d = c.D(c.v(1.6));
    return [
      { wave: 'saw', freq: f, duration: d, attack: 0.15, release: 0.3, bandpass: c.P(c.v(260)), q: 2.5, tremoloDepth: 0.35, tremoloRate: c.v(13), jitter: 0.08, volume: 0.7, seed: c.seed() },
      { wave: 'sine', freq: f * 2.01, duration: d, attack: 0.2, release: 0.3, tremoloDepth: 0.25, tremoloRate: c.v(6.5), volume: 0.3 },
      { wave: 'noise', freq: 4000, duration: d, attack: 0.2, release: 0.3, bandpass: c.P(1800), q: 1.2, volume: 0.06, seed: c.seed() },
    ];
  },
  // a warning: two notes swapping
  alarm(c) {
    const f = c.P(c.v(720, 0.06));
    return [{ wave: c.wave === 'sine' ? 'triangle' : c.wave, freq: f, arp: [0, c.pick([5, 6, 7])], arpSpeed: c.D(0.13), arpLoop: true, duration: c.D(0.78), lowpass: 5000, volume: 0.36 }];
  },
};
