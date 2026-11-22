// Recipes for struck, scraped and moving things: one function per kind of
// sound. Each gets a context `c` and returns a list of tones.
//   c.v(x, spread?)  the value nudged by the seed      c.P(hz)  pitch after size and style
//   c.D(seconds)     length after size and "long"      c.mat(fallback)  the material's numbers
//   c.has(texture)   'rusty' or 'wet' was asked for    c.said(word)     the description used this word
//   c.pick(list)     seeded choice                     c.seed()         a seed for a noise layer
//   c.wave           the style's tonal wave            c.rng()          seeded random 0..1

const strike = (c, m, vol = 0.5, len = 0.05) => ({
  wave: 'noise', freq: m.noise, duration: c.D(len + m.ring * 0.25), decay: len * 0.8 + m.ring * 0.2, sustain: 0,
  lowpass: Math.min(18000, m.noise * 1.6), volume: vol, seed: c.seed(),
});
const ring = (c, m, f, vol = 0.35) => m.modes.map((ratio, i) => ({
  wave: 'sine', freq: f * ratio * (i ? c.v(1, 0.03) : 1), duration: c.D(m.ring * 3.2 / (i + 1) + 0.05), decay: m.ring * 2.4 / (i + 1) + 0.03,
  sustain: 0, volume: vol / (i + 1), ...(c.has('rusty') ? { jitter: 0.25, seed: c.seed() } : {}),
}));

export const KINDS_A = {
  // something hits something: a strike of noise, a low body thump, and the material ringing
  impact(c) {
    const m = c.mat('wood'), f = c.P(c.v(m.f));
    const out = [strike(c, m, 0.55), { wave: 'sine', freq: c.P(m.f * 0.55), freqEnd: c.P(m.f * 0.3), duration: c.D(0.14), decay: 0.11, sustain: 0, volume: 0.6 }, ...ring(c, m, f)];
    if (c.has('wet')) out.push({ wave: 'noise', freq: 5000, freqEnd: 1500, duration: c.D(0.2), attack: 0.01, decay: 0.16, sustain: 0, highpass: 800, volume: 0.25, seed: c.seed() });
    return out;
  },
  // stick-slip: a slow, wandering buzz ringing through the body of the thing
  creak(c) {
    const m = c.mat('wood'), d = c.D(c.v(0.95)), rate = c.P(c.v(36)), body = c.P(m.f), wobble = c.has('rusty') ? 1 : 0.75;
    return [
      { wave: 'saw', freq: rate, freqEnd: rate * c.v(1.9, 0.3), duration: d, attack: 0.07, release: 0.16, jitter: wobble, bandpass: body * 3.2, bandpassEnd: body * c.v(4.4, 0.2), q: Math.min(22, m.q + 4), drive: 0.3, volume: 0.8, seed: c.seed() },
      { wave: 'saw', freq: rate * 1.01, freqEnd: rate * c.v(1.7, 0.3), duration: d * 0.92, delay: 0.03, attack: 0.08, release: 0.14, jitter: wobble, bandpass: body * 7.1, bandpassEnd: body * 6.2, q: Math.min(26, m.q + 8), volume: 0.5, seed: c.seed() },
      { wave: 'noise', freq: 3000, duration: d, attack: d * 0.3, release: d * 0.4, bandpass: body * 5, q: 2, tremoloDepth: 0.8, tremoloRate: Math.min(190, rate), volume: 0.1, seed: c.seed() },
    ];
  },
  // a door or lid: thunk, answer thunk, latch click; "open" adds a short creak, "slam" a heavy thud
  door(c) {
    const m = c.mat('wood'), f = c.P(c.v(m.f * 0.75));
    const out = [
      { wave: 'triangle', freq: f, freqEnd: f * 0.62, duration: c.D(0.11), decay: 0.09, sustain: 0, volume: 0.6 },
      { wave: 'triangle', freq: f * 0.8, freqEnd: f * 0.5, duration: c.D(0.15), delay: c.D(0.1), decay: 0.11, sustain: 0, volume: 0.55 },
      { ...strike(c, m, 0.3, 0.03) },
      { wave: 'square', freq: c.P(c.v(2300)), duration: 0.018, delay: c.D(0.07), volume: 0.16, lowpass: 6000 }, // latch
    ];
    if (c.said('lock') || c.said('unlock') || c.said('latch')) out.push({ wave: 'sine', freq: c.P(3100), fm: 2.76, fmDepth: 1.5, duration: 0.09, delay: c.D(0.2), decay: 0.07, sustain: 0, volume: 0.25 });
    if (c.said('open')) out.push({ wave: 'saw', freq: c.P(40), freqEnd: c.P(70), duration: c.D(0.35), delay: c.D(0.16), attack: 0.05, release: 0.12, jitter: 0.8, bandpass: c.P(m.f * 3.5), q: 9, volume: 0.45, seed: c.seed() });
    if (c.said('slam') || c.said('shut')) out.push({ wave: 'sine', freq: c.P(90), freqEnd: c.P(38), duration: c.D(0.3), decay: 0.24, sustain: 0, volume: 0.85 });
    return out;
  },
  // breaking: glass and crystal burst into pings, wood snaps and splinters, stone crumbles
  break(c) {
    const m = c.mat('glass'), brittle = m.ring > 0.1, out = [strike(c, m, 0.7, 0.07)];
    const bits = brittle ? 9 : 5;
    for (let i = 0; i < bits; i++) {
      const at = c.D(0.02 + c.rng() * (brittle ? 0.45 : 0.3));
      if (brittle) out.push({ wave: 'sine', freq: c.P(m.f * (0.7 + c.rng() * 2.6)), fm: 2.3, fmDepth: 0.6, duration: 0.06 + c.rng() * 0.2, delay: at, decay: 0.05 + c.rng() * 0.15, sustain: 0, volume: 0.1 + c.rng() * 0.14, pan: c.rng() * 1.4 - 0.7 });
      else out.push({ wave: 'noise', freq: m.noise * (0.5 + c.rng()), duration: 0.03 + c.rng() * 0.07, delay: at, decay: 0.05, sustain: 0, lowpass: m.noise * 1.5, volume: 0.2 + c.rng() * 0.25, seed: c.seed(), pan: c.rng() * 1.2 - 0.6 });
    }
    out.push({ wave: 'sine', freq: c.P(m.f * 0.5), freqEnd: c.P(m.f * 0.25), duration: c.D(0.12), decay: 0.1, sustain: 0, volume: brittle ? 0.25 : 0.6 });
    return out;
  },
  // a bell or gong: the material's overtones, long and clear
  bell(c) {
    const low = c.said('gong') || c.said('toll'), m = c.mat('metal'), f = c.P(c.v(low ? 110 : 660, 0.06)), d = c.D(low ? 3.2 : 1.6);
    return [
      strike(c, m, 0.18, 0.01),
      ...[1, 2.0, 2.76, 4.07, 5.4].map((ratio, i) => ({ wave: 'sine', freq: f * ratio, fm: i ? 0 : 1.4, fmDepth: i ? 0 : 0.5, duration: d / (1 + i * 0.5), decay: d * 0.6 / (1 + i * 0.6), sustain: 0, release: 0.2, volume: 0.36 / (i + 1), vibratoDepth: low ? 0.08 : 0, vibratoRate: 3 })),
    ];
  },
  // soft things moving: a few bursts of shaped noise
  rustle(c) {
    const m = c.mat('paper'), n = 3 + Math.floor(c.rng() * 3), out = [];
    for (let i = 0; i < n; i++) {
      out.push({ wave: 'noise', freq: m.noise * c.v(1.6, 0.3), duration: c.D(0.07 + c.rng() * 0.09), delay: c.D(i * 0.075 + c.rng() * 0.03), attack: 0.02, release: 0.05, bandpass: c.P(m.noise * c.v(1, 0.3)), q: 1.2, volume: 0.3 + c.rng() * 0.2, seed: c.seed(), pan: c.rng() * 0.8 - 0.4 });
    }
    if (m.ring > 0.3) for (let i = 0; i < n; i++) out.push({ wave: 'sine', freq: c.P(m.f * (1.5 + c.rng() * 3)), fm: 2.76, fmDepth: 1, duration: 0.09, delay: c.D(i * 0.075 + c.rng() * 0.04), decay: 0.07, sustain: 0, volume: 0.16 }); // chain links
    return out;
  },
  // wet and sticky: band-passed noise that gurgles, a low blob and a little suck back up
  squelch(c) {
    const d = c.D(c.v(0.34));
    return [
      { wave: 'noise', freq: 4000, duration: d, attack: 0.02, release: 0.12, bandpass: c.P(c.v(480)), bandpassEnd: c.P(c.v(1500)), q: 3.5, tremoloDepth: 0.75, tremoloRate: c.v(27), volume: 0.75, seed: c.seed() },
      { wave: 'sine', freq: c.P(c.v(190)), freqEnd: c.P(85), duration: c.D(0.13), decay: 0.11, sustain: 0, volume: 0.5 },
      { wave: 'sine', freq: c.P(c.v(250)), freqEnd: c.P(c.v(560)), duration: c.D(0.09), delay: d * 0.55, attack: 0.01, decay: 0.08, sustain: 0, volume: 0.32 },
      { wave: 'noise', freq: 900, duration: c.D(0.08), decay: 0.07, sustain: 0, lowpass: 1100, volume: 0.35, seed: c.seed() },
    ];
  },
  // water: a burst of hiss and bubbles; "drip" and "bubble" are a single small blip
  splash(c) {
    if (c.said('drip') || c.said('plop') || c.said('droplet') || c.said('bubble') || c.said('dribble')) {
      const f = c.P(c.v(c.said('bubble') ? 420 : 900, 0.2));
      return [
        { wave: 'sine', freq: f, freqEnd: f * c.v(2.1, 0.2), duration: c.D(0.07), attack: 0.004, decay: 0.06, sustain: 0, volume: 0.5 },
        { wave: 'noise', freq: 6000, duration: 0.012, volume: 0.1, highpass: 2500, seed: c.seed() },
      ];
    }
    const out = [
      { wave: 'noise', freq: c.v(6500), freqEnd: 1500, duration: c.D(c.v(0.5)), attack: 0.03, decay: 0.4, sustain: 0, highpass: 600, volume: 0.6, seed: c.seed() },
      { wave: 'sine', freq: c.P(150), freqEnd: c.P(60), duration: c.D(0.16), decay: 0.13, sustain: 0, volume: 0.45 },
    ];
    for (let i = 0; i < 4; i++) { const f = c.P(500 + c.rng() * 900); out.push({ wave: 'sine', freq: f, freqEnd: f * 1.8, duration: 0.05, delay: c.D(0.08 + c.rng() * 0.3), decay: 0.04, sustain: 0, volume: 0.16, pan: c.rng() - 0.5 }); }
    return out;
  },
  // fire: a soft roar that swells in, with seeded crackles; "sizzle" is thin and hissy
  fire(c) {
    const d = c.D(c.v(1.1)), out = [];
    if (c.said('sizzle')) return [{ wave: 'noise', freq: 9000, duration: d, attack: 0.02, decay: d * 0.8, sustain: 0.1, highpass: 3500, tremoloDepth: 0.4, tremoloRate: 45, volume: 0.45, seed: c.seed() }];
    out.push({ wave: 'noise', freq: 900, duration: d, attack: 0.12, release: d * 0.5, lowpass: c.P(500), lowpassEnd: c.P(1400), tremoloDepth: 0.35, tremoloRate: 11, volume: 0.6, seed: c.seed() });
    out.push({ wave: 'noise', freq: 2500, freqEnd: 6000, duration: c.D(0.3), attack: 0.1, release: 0.15, bandpass: 1800, bandpassEnd: 3600, q: 1, volume: 0.3, seed: c.seed() });
    for (let i = 0; i < 7; i++) out.push({ wave: 'noise', freq: 3000 + c.rng() * 5000, duration: 0.012 + c.rng() * 0.02, delay: 0.1 + c.rng() * (d - 0.2), decay: 0.02, sustain: 0, highpass: 1500, volume: 0.25 + c.rng() * 0.3, seed: c.seed(), pan: c.rng() - 0.5 });
    return out;
  },
  // air moving fast: a band of noise sweeping up and through; metal things add a thin "shing"
  whoosh(c) {
    const d = c.D(c.v(0.32)), m = c.mat('cloth');
    const out = [
      { wave: 'noise', freq: 8000, duration: d, attack: d * 0.45, release: d * 0.5, bandpass: c.P(c.v(500)), bandpassEnd: c.P(c.v(2600)), q: 1.6, volume: 0.7, seed: c.seed() },
      { wave: 'noise', freq: 3000, duration: d * 0.8, delay: d * 0.1, attack: d * 0.35, release: d * 0.4, lowpass: 700, volume: 0.3, seed: c.seed() },
    ];
    if (m.ring > 0.3) out.push({ wave: 'sine', freq: c.P(m.f * 4.2), freqEnd: c.P(m.f * 5), fm: 2.76, fmDepth: 0.8, duration: d * 1.6, delay: d * 0.3, attack: 0.03, decay: d, sustain: 0, volume: 0.14 });
    return out;
  },
};
