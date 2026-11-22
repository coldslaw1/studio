// Finishing effects for a whole sound, song or ambience: room reverb, echo,
// tone (lowpass / highpass), grit and bit-crush. Pure maths on stereo buffers.

/** Every effect setting with its default (all off). Used as sound.fx. */
export const FX_DEFAULTS = {
  reverb: 0, // 0..1 how much room sound is mixed in
  room: 0.5, // 0..1 size of the room: 0.1 cupboard .. 1 cathedral
  damp: 0.5, // 0..1 how dark the room is (1 = stone cellar, 0 = tiled hall)
  echo: 0, // 0..1 volume of a single repeating echo
  echoTime: 0.25, // seconds between echoes
  lowpass: 0, // Hz, 0 = off. Dulls the whole sound (far away, behind a wall)
  highpass: 0, // Hz, 0 = off. Thins the whole sound
  drive: 0, // 0..1 soft distortion
  crush: 0, // 0 = off, else bit depth 2..12 for a crunchy retro sound
};
const RANGES = { reverb: [0, 1], room: [0, 1], damp: [0, 1], echo: [0, 1], echoTime: [0.02, 2], lowpass: [0, 20000], highpass: [0, 20000], drive: [0, 1], crush: [0, 12] };
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491], ALLPASSES = [556, 441, 341], SPREAD = 23;

/** validateFx(fx, fn?) -> fx with defaults filled in. Throws an Error that names the bad setting. */
export function validateFx(fx, fn = 'validateFx') {
  if (fx === undefined || fx === null) return { ...FX_DEFAULTS };
  if (typeof fx !== 'object' || Array.isArray(fx)) throw new Error(`${fn}: fx must be an object like { reverb: 0.3, room: 0.6 }, got ${JSON.stringify(fx)}`);
  for (const key of Object.keys(fx)) {
    if (!Object.hasOwn(FX_DEFAULTS, key)) throw new Error(`${fn}: unknown fx setting "${key}". Valid settings: ${Object.keys(FX_DEFAULTS).join(', ')}`);
    const [min, max] = RANGES[key], v = fx[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${fn}: fx.${key} must be a number from ${min} to ${max}, got ${JSON.stringify(v)}`);
  }
  return { ...FX_DEFAULTS, ...fx };
}

/** fxTail(fx) -> extra seconds the effects ring on after the dry sound ends. */
export function fxTail(fx) {
  const f = validateFx(fx, 'fxTail');
  return (f.reverb > 0 ? 0.35 + f.room * 2.4 : 0) + (f.echo > 0 ? f.echoTime * (2 + Math.round(f.echo * 4)) : 0);
}

/** isActive(fx) -> true when any effect is switched on. */
export function fxActive(fx) {
  if (!fx) return false;
  return Boolean(fx.reverb || fx.echo || fx.lowpass || fx.highpass || fx.drive || fx.crush);
}

/**
 * createReverb(sampleRate, { room, damp }) -> { process(left, right, from, to, mix) }
 * process adds the room's answer to samples from..to in place. It keeps its
 * state between calls, so a long buffer can be done in pieces.
 */
export function createReverb(sampleRate, { room = 0.5, damp = 0.5 } = {}) {
  const k = sampleRate / 44100;
  const feedback = 0.72 + room * 0.255, d1 = damp * 0.45, d2 = 1 - d1;
  const side = (shift) => ({
    combs: COMBS.map((len) => ({ buf: new Float32Array(Math.round((len + shift) * k)), at: 0, store: 0 })),
    alls: ALLPASSES.map((len) => ({ buf: new Float32Array(Math.round((len + shift) * k)), at: 0 })),
  });
  const L = side(0), R = side(SPREAD);
  const run = (ch, input) => {
    let out = 0;
    for (const c of ch.combs) {
      const y = c.buf[c.at];
      c.store = y * d2 + c.store * d1;
      c.buf[c.at] = input + c.store * feedback;
      if (++c.at >= c.buf.length) c.at = 0;
      out += y;
    }
    for (const a of ch.alls) {
      const b = a.buf[a.at];
      a.buf[a.at] = out + b * 0.5;
      if (++a.at >= a.buf.length) a.at = 0;
      out = b - out;
    }
    return out;
  };
  return {
    process(left, right, from, to, mix) {
      const wet = mix * 1.4, dry = 1 - mix * 0.3;
      for (let i = from; i < to; i++) {
        const input = (left[i] + right[i]) * 0.022;
        const l = run(L, input), r = run(R, input);
        left[i] = left[i] * dry + l * wet;
        right[i] = right[i] * dry + r * wet;
      }
    },
  };
}

/**
 * applyFx(left, right, fx, sampleRate) -> changes both buffers in place.
 * The buffers should already include fxTail(fx) seconds of room at the end.
 */
export function applyFx(left, right, fx, sampleRate) {
  const f = validateFx(fx, 'applyFx');
  const n = left.length;
  if (f.drive > 0) {
    const g = 1 + f.drive * 7, norm = 1 / Math.tanh(g);
    for (let i = 0; i < n; i++) { left[i] = Math.tanh(left[i] * g) * norm; right[i] = Math.tanh(right[i] * g) * norm; }
  }
  if (f.crush > 0) {
    const steps = Math.pow(2, Math.max(2, f.crush) - 1), hold = Math.max(1, Math.round(sampleRate / 11025));
    let l = 0, r = 0;
    for (let i = 0; i < n; i++) {
      if (i % hold === 0) { l = Math.round(left[i] * steps) / steps; r = Math.round(right[i] * steps) / steps; }
      left[i] = l; right[i] = r;
    }
  }
  if (f.highpass > 0 || f.lowpass > 0) {
    const hp = f.highpass > 0 ? 1 - Math.exp((-2 * Math.PI * f.highpass) / sampleRate) : 0;
    const lp = f.lowpass > 0 ? 1 - Math.exp((-2 * Math.PI * Math.min(f.lowpass, sampleRate * 0.45)) / sampleRate) : 0;
    for (const ch of [left, right]) {
      let h = 0, a = 0, b = 0;
      for (let i = 0; i < n; i++) {
        let s = ch[i];
        if (hp) { h += hp * (s - h); s -= h; }
        if (lp) { a += lp * (s - a); b += lp * (a - b); s = b; } // two stages: a firmer cut than one
        ch[i] = s;
      }
    }
  }
  if (f.echo > 0) {
    const d = Math.round(f.echoTime * sampleRate), fb = 0.25 + f.echo * 0.4;
    for (let i = d; i < n; i++) { left[i] += right[i - d] * fb * f.echo * 1.2; right[i] += left[i - d] * fb * f.echo; }
  }
  if (f.reverb > 0) createReverb(sampleRate, f).process(left, right, 0, n, f.reverb);
}
