// World sound for createAudio: ambience beds with live sprinkles, footsteps
// by surface, and looping emitters that sit at a place in the world.

import { ambiencePlan, generateAmbience, isAmbience } from './ambience.js';
import { footstep } from './gen-sfx.js';
import { SURFACE_NAMES, WEIGHTS } from './footsteps.js';
import { toPoint } from './spatial.js';

const STEP_VARIANTS = 5;

/** attachWorld(audio, core) -> adds playAmbience, stopAmbience, step and emitter to the audio object. */
export function attachWorld(audio, core) {
  let wanted = null, current = null, token = 0;
  const byKind = new Map(), steps = new Map(), emitters = new Set();
  const between = ([lo, hi]) => lo + core.rng() * (hi - lo);

  core.ambienceItem = (amb) => ({ key: amb, plan: (rate) => ambiencePlan(amb, rate, { sprinkles: false }) });

  function endCurrent(fade) {
    if (!current) return;
    const ctx = core.ctx(), end = ctx.currentTime + Math.max(0.01, core.finite(fade, 1.5, 'an ambience fade'));
    current.gain.gain.cancelScheduledValues(ctx.currentTime);
    current.gain.gain.setValueAtTime(current.gain.gain.value, ctx.currentTime);
    current.gain.gain.linearRampToValueAtTime(0, end);
    current.source.stop(end + 0.02);
    for (const task of current.tasks) core.scheduler.cancel(task);
    current = null;
  }

  function startAmbience() {
    const ctx = core.ctx();
    if (!ctx || !wanted) return;
    if (current && current.amb === wanted.amb) return;
    const mine = ++token, want = wanted;
    core.getBuffer(core.ambienceItem(want.amb), (buffer) => {
      if (mine !== token || wanted !== want || !core.ctx()) return;
      endCurrent(want.fade);
      const t0 = ctx.currentTime + 0.03;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(want.volume, t0 + Math.max(0.01, want.fade));
      const source = ctx.createBufferSource();
      source.buffer = buffer; source.loop = true;
      source.connect(gain); gain.connect(core.nodes().ambience);
      source.start(t0);
      // The small sounds are not part of the loop: each is scheduled at its own random times, so the place never repeats.
      const tasks = want.amb.sprinkles.map((s) => {
        const item = core.resolve(s.sound, undefined, s.name);
        return core.scheduler.repeat(t0 + between(s.every) * core.rng(), (time) => {
          if (core.on() && core.makeRoom(item.key, 1)) {
            core.startVoice(item, { volume: want.volume * between(s.volume), pan: (core.rng() * 2 - 1) * s.spread, pitch: between(s.pitch), when: time, bus: 'ambience', priority: 1 });
          }
          return time + between(s.every);
        });
      });
      current = { amb: want.amb, source, gain, tasks };
    });
  }

  function startEmitter(e) {
    if (e.voice || e.stopped || !core.unlocked()) return;
    const heard = core.hear(e, { range: e.range }, 'audio.emitter');
    e.voice = core.startVoice(e.item, { loop: true, volume: e.volume * heard.volume, pan: heard.pan, lowpass: heard.lowpass, send: heard.send, pitch: e.pitch, when: 0, priority: 9, fadeIn: 0.2, bus: e.bus });
  }
  function placeEmitter(e) {
    const chain = e.voice && e.voice.chain;
    if (!chain) return;
    const heard = core.hear(e, { range: e.range }, 'audio.emitter');
    if (chain.send) core.setParam(chain.send.gain, heard.send * (e.voice.sendScale ?? 1), 'an emitter send');
    core.setParam(chain.gain.gain, e.volume * heard.volume, 'an emitter volume');
    if (chain.filter) core.setParam(chain.filter.frequency, heard.lowpass);
    if (chain.panner) core.setParam(chain.panner.pan, heard.pan);
  }

  core.onUnlock = () => { startAmbience(); for (const e of emitters) startEmitter(e); };
  core.onListener = () => { for (const e of emitters) placeEmitter(e); };
  core.onDestroy = () => { wanted = null; current = null; token++; emitters.clear(); };

  Object.defineProperty(audio, 'ambienceName', { enumerable: true, get: () => (wanted ? wanted.amb.name : null) });

  /**
   * playAmbience(ambience, { fade, volume }?) -> loops the bed of a place and scatters its small
   * sounds at random times. ambience: from generateAmbience(), or a kind name ('forest', 'cave'...)
   * which is generated in the audio's style. Swapping cross-fades over `fade` seconds (default 1.5).
   */
  audio.playAmbience = (ambience, opts = {}) => {
    let amb = ambience;
    if (typeof ambience === 'string') {
      if (!byKind.has(ambience)) byKind.set(ambience, generateAmbience({ describe: ambience, style: core.style }));
      amb = byKind.get(ambience);
    }
    if (!isAmbience(amb)) throw new Error(`audio.playAmbience: expected an ambience from generateAmbience or a kind name like 'forest', got ${JSON.stringify(ambience)}`);
    const volume = opts.volume ?? 1;
    if (!(volume >= 0 && volume <= 1)) throw new Error(`audio.playAmbience: volume must be a number from 0 to 1, got ${JSON.stringify(opts.volume)}`);
    wanted = { amb, fade: core.num(opts.fade, 1.5, 'audio.playAmbience: fade'), volume };
    core.note('ambience', amb.name, core.unlocked());
    startAmbience();
  };

  /** stopAmbience({ fade }?) -> fades the ambience out (default 1.5 seconds). */
  audio.stopAmbience = (opts = {}) => {
    wanted = null; token++;
    core.note('stopAmbience', null, core.unlocked());
    if (core.ctx()) endCurrent(opts.fade ?? 1.5);
  };

  /**
   * step(surface, { volume, weight, at, pan, pitch }?) -> true if it was started
   * A footstep on 'grass', 'stone', 'wood'... (SURFACE_NAMES). Each call picks a different take
   * and nudges the pitch, so walking never sounds like one sample on repeat.
   * weight: 'light', 'normal' or 'heavy'. at: { x, y } for someone else's steps. Logged as 'step-<surface>'.
   */
  audio.step = (surface, opts = {}) => {
    if (!SURFACE_NAMES.includes(surface)) throw new Error(`audio.step: unknown surface "${surface}". Surfaces: ${SURFACE_NAMES.join(', ')}`);
    const weight = opts.weight ?? 'normal';
    if (!Object.hasOwn(WEIGHTS, weight)) throw new Error(`audio.step: weight must be one of ${Object.keys(WEIGHTS).join(', ')}, got ${JSON.stringify(opts.weight)}`);
    const key = `${surface}:${weight}`;
    if (!steps.has(key)) steps.set(key, { takes: [], last: -1 });
    const set = steps.get(key);
    let pickAt;
    if (set.takes.length < STEP_VARIANTS) { // takes are made one per call, so the first step never stalls a frame
      pickAt = set.takes.length;
      set.takes.push(footstep(surface, { seed: pickAt + 1, style: core.style, weight }).sound);
    } else {
      pickAt = Math.floor(core.rng() * (STEP_VARIANTS - 1));
      if (pickAt >= set.last) pickAt++;
    }
    set.last = pickAt;
    return audio.play({ name: `step-${surface}`, sound: set.takes[pickAt] }, {
      volume: opts.volume, pan: opts.pan, at: opts.at, range: opts.range, delay: opts.delay,
      pitch: core.num(opts.pitch, 1, 'audio.step: pitch') * (0.94 + core.rng() * 0.12), priority: opts.priority ?? 2,
    });
  };

  /**
   * emitter(sound, { x, y, range, volume, pitch }) -> { move(x, y), setVolume(v), stop({ fade }?), playing }
   * A looping sound at a place in the world (a campfire, a waterfall, a machine). It gets louder,
   * clearer and moves left or right as the listener (setListener) moves. sound: anything play()
   * takes, or an ambience (its bed is used). Started before unlock, it begins when sound is allowed.
   */
  audio.emitter = (sound, opts = {}) => {
    const p = toPoint([opts.x, opts.y], 'audio.emitter');
    const item = isAmbience(sound) ? core.ambienceItem(sound) : core.resolve(sound);
    const volume = opts.volume ?? 1;
    if (!(volume >= 0 && volume <= 1)) throw new Error(`audio.emitter: volume must be a number from 0 to 1, got ${JSON.stringify(opts.volume)}`);
    const e = { item, x: p.x, y: p.y, range: opts.range ?? core.range, volume, pitch: opts.pitch, bus: isAmbience(sound) ? 'ambience' : 'sfx', voice: null, stopped: false };
    emitters.add(e);
    startEmitter(e);
    return {
      get playing() { return !e.stopped; },
      // move and setVolume are called every step: a NaN or Infinity keeps the old value instead of stopping the game
      move(x, y) {
        if (typeof x === 'number' && typeof y === 'number' && !(Number.isFinite(x) && Number.isFinite(y))) { core.bad(`emitter.move: position was ${x}, ${y}`); return; }
        const q = toPoint([x, y], 'emitter.move'); e.x = q.x; e.y = q.y; placeEmitter(e);
      },
      setVolume(v) {
        if (typeof v !== 'number') throw new Error(`emitter.setVolume: volume must be a number from 0 to 1, got ${JSON.stringify(v)}`);
        if (!Number.isFinite(v)) { core.bad(`emitter.setVolume: volume was ${v}`); return; }
        e.volume = Math.max(0, Math.min(1, v)); placeEmitter(e);
      },
      stop(o = {}) {
        if (e.stopped) return;
        e.stopped = true; emitters.delete(e);
        const voice = e.voice, ctx = core.ctx();
        if (!voice) return;
        voice.stopped = true;
        if (!voice.source || !ctx) return;
        const end = ctx.currentTime + Math.max(0.01, core.num(o.fade, 0.3, 'emitter.stop: fade')), g = voice.chain.gain.gain;
        g.cancelScheduledValues?.(ctx.currentTime);
        g.setValueAtTime(g.value, ctx.currentTime);
        g.linearRampToValueAtTime(0, end);
        voice.source.stop(end + 0.02);
      },
    };
  };
}
