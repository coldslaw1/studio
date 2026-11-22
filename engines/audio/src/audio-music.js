// Music playback for createAudio: looping songs and adaptive scores.
// A score is several stems (pad, bass, melody, drums...) of the same length
// that loop together, sample-locked. Changing the game state only moves the
// stems' volumes, so the music never restarts and never falls out of time.
// Layers that come in arrive on the next bar line; layers that leave fade away
// slowly; a short swell leads into a louder state.

import { songPlan, parseSong, isSong } from './song.js';
import { soundPlan } from './render.js';

/** isScore(value) -> true when the value looks like a score from generateScore (has a stems list). */
export function isScore(value) {
  return Boolean(value) && typeof value === 'object' && Array.isArray(value.stems) && value.stems.length > 0;
}

const ORDER = ['calm', 'explore', 'danger', 'combat'];

function stemsOf(piece) {
  if (isScore(piece)) return piece.stems;
  return [{ name: 'song', song: piece, pan: 0 }];
}
function levelsFor(piece, state, fn) {
  if (!isScore(piece)) return { song: 1 };
  if (state && typeof state === 'object') return state;
  const name = state ?? piece.state ?? Object.keys(piece.states)[0];
  if (!Object.hasOwn(piece.states, name)) throw new Error(`${fn}: unknown music state "${name}". This score has: ${Object.keys(piece.states).join(', ')}`);
  return piece.states[name];
}
// A dial across the states: 0 = the first, 1 = the last, between = a blend of the two nearest.
function blend(piece, amount) {
  const names = ORDER.filter((s) => Object.hasOwn(piece.states, s));
  const list = names.length >= 2 ? names : Object.keys(piece.states);
  const x = Math.max(0, Math.min(1, amount)) * (list.length - 1), i = Math.min(list.length - 2, Math.floor(x)), t = x - i;
  const a = piece.states[list[i]], b = piece.states[list[Math.max(0, i + 1)]], out = {};
  for (const stem of piece.stems) out[stem.name] = (a[stem.name] ?? 0) * (1 - t) + (b[stem.name] ?? 0) * t;
  return { levels: out, nearest: list[Math.round(x)] };
}
function timeFor(piece, time, fn) {
  if (!isScore(piece) || time === undefined || time === null) return { tone: 0, levels: {} };
  const table = piece.times ?? {};
  if (!Object.hasOwn(table, time)) throw new Error(`${fn}: unknown time of day "${time}". This score has: ${Object.keys(table).join(', ') || 'none'}`);
  return table[time];
}

/**
 * createMusicPlayer(core) -> { play, stop, setState, setIntensity, setTime, start, name, state, time, intensity }
 * core is createAudio's inside: { ctx(), nodes(), getBuffer(item, cb), note(type, name, played), unlocked(), startVoice }.
 */
export function createMusicPlayer(core) {
  let wanted = null; // { piece, fade, state, time, intensity }
  let current = null; // { piece, parts: [{ name, source, gain, level }], bus, t0, bar, beat }
  let token = 0;

  function fadeOut(fade) {
    if (!current) return;
    const ctx = core.ctx(), { parts, bus } = current;
    const end = ctx.currentTime + Math.max(0.01, core.finite(fade, 0.5, 'a music fade'));
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(0, end);
    for (const part of parts) part.source.stop(end + 0.02);
    current = null;
  }

  // The volume every stem should have now: the state (or the dial), times the time of day.
  function targets(want, fn) {
    const base = want.intensity !== null && want.intensity !== undefined && isScore(want.piece) ? blend(want.piece, want.intensity).levels : levelsFor(want.piece, want.state, fn);
    const time = timeFor(want.piece, want.time, fn), out = {};
    for (const stem of stemsOf(want.piece)) out[stem.name] = Math.max(0, core.finite((base[stem.name] ?? 0) * (time.levels[stem.name] ?? 1), 0, `${fn}: the level of "${stem.name}"`));
    return { levels: out, tone: time.tone || 0 };
  }

  // Moves the playing stems to their targets. Returns the time the change begins.
  function apply(opts = {}, swell = false) {
    const ctx = core.ctx();
    if (!ctx || !current || !wanted || current.piece !== wanted.piece) return null;
    const { levels, tone } = targets(wanted, 'audio.setMusicState');
    const fade = Math.max(0.02, core.num(opts.fade, 1.2, 'audio.setMusicState: fade'));
    const unit = opts.quantize === 'now' ? 0 : opts.quantize === 'beat' ? current.beat : current.bar;
    const now = ctx.currentTime + 0.02;
    const line = unit ? current.t0 + Math.ceil((now - current.t0) / unit) * unit : now;
    let louder = false;
    for (const part of current.parts) {
      const to = levels[part.name] ?? 0, rising = to > part.level + 0.001;
      if (Math.abs(to - part.level) < 0.001) continue;
      // coming in: on the line, quickly, so a drum pattern starts on its downbeat.
      // going out: from now, slowly, so nothing is cut off.
      const when = rising ? line : now;
      part.gain.gain.cancelScheduledValues(when);
      part.gain.gain.setTargetAtTime(to, when, (rising ? Math.min(fade, 0.6) : fade * 1.5) / 3);
      if (rising && part.level < 0.05 && to > 0.4 && (part.name === 'drums' || part.name === 'drive')) louder = true;
      part.level = to;
    }
    if (current.tone && current.toneAt !== tone) {
      current.tone.frequency.cancelScheduledValues?.(now);
      current.tone.frequency.setTargetAtTime(Math.max(40, core.finite(tone || 20000, 20000, 'a time-of-day tone')), now, fade / 2);
      current.toneAt = tone;
    }
    // a swell into the bar line when the drums or the driving line are about to enter
    const rise = wanted.piece.rise;
    if (swell && louder && rise && unit && opts.swell !== false && core.on() && line - rise.lead > ctx.currentTime + 0.01) {
      core.startVoice({ key: rise.sound, plan: (rate) => soundPlan(rise.sound, rate) }, { volume: 0.8, when: line - rise.lead, bus: 'music', priority: 8 });
    }
    return line;
  }

  function start() {
    const ctx = core.ctx();
    if (!ctx || !wanted) return;
    if (current && current.piece === wanted.piece) return;
    const mine = ++token, want = wanted;
    const stems = stemsOf(want.piece);
    const buffers = [];
    let left = stems.length;
    stems.forEach((stem, i) => {
      core.getBuffer({ key: stem.song, plan: (rate) => songPlan(stem.song, rate, { samples: core.samples }) }, (buffer) => {
        buffers[i] = buffer;
        if (--left > 0 || mine !== token || wanted !== want || !core.ctx()) return;
        fadeOut(want.fade);
        const { levels, tone } = targets(want, 'audio.playMusic');
        const t0 = ctx.currentTime + 0.03; // every stem starts on the same sample
        const bus = ctx.createGain();
        bus.gain.setValueAtTime(0, t0);
        bus.gain.linearRampToValueAtTime(1, t0 + Math.max(0.01, core.finite(want.fade, 0.5, 'audio.playMusic: fade')));
        // scores get a tone control (time of day); plain songs go straight to the music bus
        let filter = null;
        if (isScore(want.piece) && ctx.createBiquadFilter) {
          filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = Math.max(40, core.finite(tone || 20000, 20000, 'a time-of-day tone'));
          bus.connect(filter); filter.connect(core.nodes().music);
        } else bus.connect(core.nodes().music);
        const parts = stems.map((s, n) => {
          const source = ctx.createBufferSource();
          source.buffer = buffers[n];
          source.loop = s.song.loop !== false;
          const gain = ctx.createGain(), level = core.finite(levels[s.name] ?? 0, 0, 'a stem level');
          gain.gain.value = level;
          source.connect(gain);
          if (s.pan && ctx.createStereoPanner) {
            const panner = ctx.createStereoPanner();
            panner.pan.value = Math.max(-1, Math.min(1, core.finite(s.pan, 0, 'a stem pan')));
            gain.connect(panner); panner.connect(bus);
          } else gain.connect(bus);
          source.start(t0);
          return { name: s.name, source, gain, level };
        });
        const parsed = parseSong(stems[0].song);
        const beat = 60 / parsed.bpm;
        current = { piece: want.piece, parts, bus, tone: filter, toneAt: tone, t0, beat, bar: beat * (want.piece.beatsPerBar ?? 4) };
      });
    });
  }

  const needScore = (fn) => { if (!wanted || !isScore(wanted.piece)) throw new Error(`${fn}: play a score from generateScore with playMusic first`); };

  return {
    /** Starts the wanted music if sound is on. Called again by createAudio on unlock. */
    start,
    get name() { return wanted ? (wanted.piece.name ?? 'song') : null; },
    get state() {
      if (!wanted || !isScore(wanted.piece)) return null;
      if (wanted.intensity !== null && wanted.intensity !== undefined) return blend(wanted.piece, wanted.intensity).nearest;
      return typeof wanted.state === 'string' ? wanted.state : wanted.state ? 'custom' : wanted.piece.state ?? Object.keys(wanted.piece.states)[0];
    },
    get time() { return wanted && isScore(wanted.piece) ? wanted.time ?? null : null; },
    get intensity() { return wanted && isScore(wanted.piece) ? wanted.intensity ?? null : null; },
    play(piece, opts = {}) {
      if (isScore(piece)) {
        for (const stem of piece.stems) parseSong(stem.song);
        levelsFor(piece, opts.state, 'audio.playMusic');
        timeFor(piece, opts.time, 'audio.playMusic');
      } else if (isSong(piece)) parseSong(piece);
      else throw new Error(`audio.playMusic: expected a song object like generateSong({ mood: 'happy' }) or a score from generateScore, got ${JSON.stringify(piece)}`);
      const same = wanted && wanted.piece === piece;
      wanted = {
        piece, fade: opts.fade ?? 0.5,
        state: opts.state ?? (same ? wanted.state : undefined),
        time: opts.time ?? (same ? wanted.time : undefined),
        intensity: opts.state !== undefined ? null : same ? wanted.intensity : null,
      };
      core.note('music', piece.name ?? 'song', core.unlocked());
      if (same) apply({}, true);
      start();
    },
    stop(opts = {}) {
      wanted = null; token++;
      core.note('stopMusic', null, core.unlocked());
      if (core.ctx()) fadeOut(opts.fade ?? 0.5);
    },
    /**
     * setState(state, { fade, quantize, swell }) -> moves the stems to the levels of a score state.
     * quantize: 'bar' (default), 'beat' or 'now': the line on which new layers enter.
     */
    setState(state, opts = {}) {
      needScore('audio.setMusicState');
      levelsFor(wanted.piece, state, 'audio.setMusicState');
      const changed = wanted.state !== state || wanted.intensity !== null;
      wanted.state = state; wanted.intensity = null;
      if (changed) core.note('musicState', typeof state === 'string' ? state : 'custom', core.unlocked());
      return apply(opts, true);
    },
    /**
     * setIntensity(amount, { fade }) -> a smooth dial instead of named states: 0 = calm .. 1 = combat.
     * Safe to call every game step; the layers follow gradually.
     */
    setIntensity(amount, opts = {}) {
      needScore('audio.setMusicIntensity');
      if (typeof amount !== 'number') throw new Error(`audio.setMusicIntensity: amount must be a number from 0 to 1, got ${JSON.stringify(amount)}`);
      if (Number.isNaN(amount)) { core.bad('audio.setMusicIntensity: amount was NaN'); return null; } // called every step: keep the music where it is
      const value = Math.max(0, Math.min(1, amount));
      if (wanted.intensity !== null && wanted.intensity !== undefined && Math.abs(wanted.intensity - value) < 0.01) return null;
      const before = this.state;
      wanted.intensity = value;
      if (this.state !== before) core.note('musicState', this.state, core.unlocked());
      return apply({ fade: opts.fade ?? 1.5, quantize: opts.quantize ?? 'beat' }, true);
    },
    /** setTime(time, { fade }) -> 'day', 'dusk' or 'night': thins and dulls the same music. */
    setTime(time, opts = {}) {
      needScore('audio.setMusicTime');
      timeFor(wanted.piece, time, 'audio.setMusicTime');
      if (wanted.time === time) return null;
      wanted.time = time;
      core.note('musicTime', time, core.unlocked());
      return apply({ fade: opts.fade ?? 4, quantize: 'now' }, false);
    },
    /** Forgets the playing music without touching nodes (the context is being closed). */
    reset() { wanted = null; current = null; token++; },
    get playing() { return current; },
  };
}
