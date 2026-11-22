// Playback. createAudio() gives the game one object for all sound: effects,
// music that follows the game state, ambience, footsteps, positional sound,
// volumes and mute. Under Node (or any place without Web Audio) it runs
// silent but still checks names and keeps a log, so game tests can assert
// which sounds were played.

import { sfx } from './sfx.js';
import { soundLayers } from './synth.js';
import { soundPlan } from './render.js';
import { recordedMatch, recordedPlan } from './recorded.js';
import { songPlan, parseSong, isSong } from './song.js';
import { createRenderQueue } from './render-queue.js';
import { createScheduler } from './scheduler.js';
import { createMusicPlayer } from './audio-music.js';
import { attachWorld } from './audio-world.js';
import { spatialize, occlusion, toPoint, DEFAULT_RANGE } from './spatial.js';
import { spaceOf, impulsePlan } from './spaces.js';
import { createRng } from './rng.js';
import { LIMITER } from './mix.js';

const BUSES = ['master', 'sfx', 'music', 'ambience'];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SYNC_COST = 250000; // sounds smaller than this many samples are built at once, bigger ones over several frames

/**
 * createAudio(options?) -> audio
 *   volume, sfxVolume, musicVolume, ambienceVolume: start volumes 0..1 (defaults 1, 1, 0.6, 0.7)
 *   store: { get(key), set(key, value) } to remember volumes and mute (core kit: saves.settings)
 *   autoUnlock: start sound on the first key press or tap by itself (default true)
 *   style: sound palette for step() and other generated sounds (default 'storybook')
 *   maxVoices: most effects sounding at once (default 32); maxSame: most copies of one effect (default 4)
 *   range: hearing distance in pixels for positional sound (default 480)
 *   space: the acoustic space to start in (default 'none'); see setSpace
 *   latency: 'interactive', 'balanced' (default) or 'playback'; larger is safer against crackle on a busy page
 *   rng: rng() for step and ambience variation (default: a seeded one)
 *   window, AudioContext, setTimeout, setInterval, clearInterval: browser objects; tests pass fakes
 */
export function createAudio(options = {}) {
  const win = options.window ?? (typeof window !== 'undefined' ? window : null);
  const Ctx = options.AudioContext ?? (win && (win.AudioContext || win.webkitAudioContext)) ?? null;
  const timer = (name) => options[name] ?? (win && typeof win[name] === 'function' ? win[name].bind(win) : null);
  const store = options.store ?? null;
  // recorded instruments (a sample bank from loadSamplePack): fixed for this audio object, as built music is remembered
  const samples = options.samples ?? null;
  if (samples && typeof samples.addNote !== 'function') throw new Error('createAudio: samples must be a sample bank from loadSamplePack, readSamplePack or createSampleBank');
  const saved = (store && store.get('audio')) || {};
  const volumes = {
    master: clamp01(saved.master ?? options.volume ?? 1),
    sfx: clamp01(saved.sfx ?? options.sfxVolume ?? 1),
    music: clamp01(saved.music ?? options.musicVolume ?? 0.6),
    ambience: clamp01(saved.ambience ?? options.ambienceVolume ?? 0.7),
  };
  const maxVoices = options.maxVoices ?? 32, maxSame = options.maxSame ?? 4;
  if (!(maxVoices >= 1) || !(maxSame >= 1)) throw new Error(`createAudio: maxVoices and maxSame must be 1 or more, got ${JSON.stringify([options.maxVoices, options.maxSame])}`);
  let muted = Boolean(saved.muted);
  let ctx = null, nodes = null, anchor = -1, gameTime = 0, lastUpdate = -1, worstGap = 0;
  const custom = new Map(), takes = new Map(), named = new Map(), objects = new WeakMap();
  const lastNamed = new Map(), lastObject = new WeakMap();
  const active = new Set(), pools = new Map();
  const stats = { played: 0, stolen: 0, dropped: 0, badValues: 0 };
  let lastBad = null;
  // A game can hand over NaN or Infinity (a division by a zero dt while the page is hidden, a
  // position that was never set). The browser throws on such a number, which would stop the game's
  // own frame. So: a number that is not finite is replaced by a safe one, counted, and remembered
  // in stats().badValues / lastBadValue for whoever looks. Wrong types (a string) still throw.
  const num = (value, fallback, what) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'number') throw new Error(`${what} must be a number, got ${JSON.stringify(value)}`);
    stats.badValues++; lastBad = `${what} was ${value}`;
    return fallback;
  };
  const finite = (value, fallback, what) => { if (Number.isFinite(value)) return value; stats.badValues++; lastBad = `${what} was ${value}`; return fallback; };
  // The only place a value is written straight onto an audio setting.
  const put = (param, value, fallback, what) => { param.cancelScheduledValues?.(0); param.value = finite(value, fallback, what); };
  const listener = { x: 0, y: 0 };
  let space = spaceOf(options.space ?? 'none', 'createAudio'), walls = [], room = null; // room: { convolver, wet } of the space now heard
  const responses = new Map();
  const log = [];
  // Effects asked for in the instant before sound is allowed (the very key press or click that
  // unlocks it, or while the device is still starting) are kept for a moment and played then.
  const early = [], clock = options.now ?? (() => Date.now());
  const queue = createRenderQueue({ setTimeout: timer('setTimeout') });
  const scheduler = createScheduler({ now: () => (ctx ? ctx.currentTime : 0), setInterval: timer('setInterval'), clearInterval: timer('clearInterval') });

  const note = (type, name, played) => { const entry = { type, name, played }; log.push(entry); if (log.length > 200) log.shift(); return entry; };
  function playEarly() {
    if (!ctx || ctx.state !== 'running' || muted) return;
    for (const e of early.splice(0)) {
      if (clock() - e.at > 400 || !makeRoom(e.item.key, e.o.priority ?? 5)) continue;
      e.entry.played = true;
      startVoice(e.item, { ...e.o, when: ctx.currentTime });
    }
  }
  const save = () => { if (store) store.set('audio', { ...volumes, muted }); };
  const setParam = (param, raw, what = 'a setting') => {
    if (!Number.isFinite(raw)) { stats.badValues++; lastBad = `${what} was ${raw}`; return; } // keep the value it had
    const value = raw;
    // Glide to the new value over a few milliseconds: a jump in volume or pan is heard as a click.
    if (param.setTargetAtTime && ctx) { param.cancelScheduledValues?.(ctx.currentTime); param.setTargetAtTime(value, ctx.currentTime, 0.012); }
    else param.value = value;
  };
  const applyVolumes = () => {
    if (!nodes) return;
    setParam(nodes.master.gain, muted ? 0 : volumes.master);
    for (const bus of ['sfx', 'music', 'ambience']) { setParam(nodes[bus].gain, volumes[bus]); if (nodes.sends) setParam(nodes.sends[bus].gain, volumes[bus]); }
  };
  const rate = () => (ctx && ctx.sampleRate) || 44100;
  // Sounds played from several game steps that ran in one frame keep their spacing (see update):
  // a step's sounds start at its place in game time, never earlier than now, at most 0.1 s ahead.
  const playTime = () => Math.max(ctx.currentTime, Math.min(anchor + gameTime, ctx.currentTime + 0.1));

  // Works out what to play. Returns { name, key, plan(rate) } or throws on a bad sound.
  function resolve(sound, seed, label) {
    if (typeof sound === 'string') {
      if (takes.has(sound)) { // several versions of one sound: never the same one twice in a row, pitch nudged a little
        const set = takes.get(sound);
        let at = Math.floor(core.rng() * (set.list.length - (set.list.length > 1 ? 1 : 0)));
        if (set.list.length > 1 && at >= set.last) at++;
        set.last = at;
        return { ...resolve(set.list[at], seed, sound), nudge: 0.97 + core.rng() * 0.06 };
      }
      if (custom.has(sound)) return resolve(custom.get(sound), seed, sound);
      const data = sfx(sound, seed ?? 0);
      return { name: sound, key: `${sound}:${seed ?? 0}`, plan: (r) => soundPlan(data, r) };
    }
    const name = label ?? (sound && sound.name) ?? 'custom';
    if (isSong(sound)) { parseSong(sound); return { name, key: sound, plan: (r) => songPlan({ ...sound, loop: false }, r, { samples }) }; }
    if (sound && typeof sound === 'object' && sound.sound && typeof sound.sound === 'object') {
      // a described sound: a fitting recording from the sample pack becomes its body (recorded.js)
      if (samples && recordedMatch(samples, sound)) { soundLayers(sound.sound, 'audio.play'); return { name, key: sound.sound, plan: (r) => recordedPlan(sound, samples, r) }; }
      return resolve(sound.sound, seed, name);
    }
    soundLayers(sound, 'audio.play');
    return { name, key: sound, plan: (r) => soundPlan(sound, r) };
  }

  // Hands cb the AudioBuffer for an item, building it first if needed (big ones over several frames).
  function getBuffer(item, cb) {
    const cache = typeof item.key === 'string' ? named : objects;
    let entry = cache.get(item.key);
    if (entry && entry.buffer) { cb(entry.buffer); return; }
    if (entry) { entry.waiters.push(cb); return; }
    entry = { buffer: null, waiters: [cb] };
    cache.set(item.key, entry);
    const plan = item.plan(rate());
    const done = (channels) => {
      if (!ctx) { cache.delete(item.key); return; }
      const buffer = ctx.createBuffer(channels.length, channels[0].length, rate());
      channels.forEach((data, c) => buffer.getChannelData(c).set(data));
      entry.buffer = buffer;
      for (const waiter of entry.waiters.splice(0)) waiter(buffer);
    };
    const cost = plan.jobs.reduce((sum, job) => sum + job[0], 0);
    if (cost <= SYNC_COST) { for (const [, run] of plan.jobs) run(); done(plan.done()); } else queue.render(plan, done);
  }

  // Voice chains (gain -> [lowpass] -> pan -> bus) are kept and reused; only the one-shot source is new each time.
  function takeChain(bus, filtered) {
    const key = `${bus}:${filtered ? 'f' : 'p'}`;
    if (!pools.has(key)) pools.set(key, []);
    const spare = pools.get(key).pop();
    if (spare) return spare;
    const gain = ctx.createGain();
    let last = gain, filter = null, panner = null;
    if (filtered && ctx.createBiquadFilter) { filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; last.connect(filter); last = filter; }
    if (ctx.createStereoPanner) { panner = ctx.createStereoPanner(); last.connect(panner); last = panner; }
    last.connect(nodes[bus]);
    // a second path into the room: how much of this voice the current space answers to
    let send = null;
    if (nodes.reverbIn) { send = ctx.createGain(); gain.connect(send); send.connect(nodes.sends[bus]); }
    return { key, gain, filter, panner, send };
  }
  function release(voice) {
    active.delete(voice);
    if (voice.source && voice.source.disconnect) voice.source.disconnect();
    if (voice.chain && ctx) { pools.get(voice.chain.key).push(voice.chain); voice.chain = null; }
  }
  function steal(voice) {
    voice.stolen = true;
    active.delete(voice);
    stats.stolen++;
    if (!voice.source) return;
    const t = ctx.currentTime, g = voice.chain.gain.gain;
    g.cancelScheduledValues?.(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.012);
    voice.source.stop(t + 0.015);
  }
  // Makes room for one more voice. Returns false when the new sound is the least important.
  function makeRoom(key, priority) {
    let same = 0, oldestSame = null, victim = null;
    for (const v of active) {
      if (v.key === key) { same++; oldestSame ??= v; }
      if (!victim || v.priority < victim.priority) victim = v;
    }
    if (same >= maxSame) { steal(oldestSame); return true; }
    if (active.size < maxVoices) return true;
    if (victim.priority > priority) { stats.dropped++; return false; }
    steal(victim);
    return true;
  }

  /** Starts one voice. o: { volume, pan, lowpass, pitch, when, bus, priority, loop }. Returns the voice. */
  function startVoice(item, o) {
    const voice = { key: item.key, priority: o.priority ?? 5, source: null, chain: null, stolen: false, stopped: false };
    active.add(voice);
    stats.played++;
    getBuffer(item, (buffer) => {
      if (!ctx || voice.stolen || voice.stopped) { active.delete(voice); return; }
      const chain = voice.chain = takeChain(o.bus ?? 'sfx', Boolean(o.lowpass) || Boolean(o.loop));
      const when = Math.max(finite(o.when ?? 0, 0, 'a start time'), ctx.currentTime);
      const volume = clamp01(finite(o.volume, 0, 'a voice volume'));
      const source = voice.source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = Boolean(o.loop);
      source.playbackRate.value = clamp(finite(o.pitch ?? 1, 1, 'a voice pitch'), 0.25, 4);
      put(chain.gain.gain, volume, 0, 'a voice volume');
      if (o.fadeIn > 0 && Number.isFinite(o.fadeIn)) { chain.gain.gain.setValueAtTime(0, when); chain.gain.gain.linearRampToValueAtTime(volume, when + o.fadeIn); }
      if (chain.filter) put(chain.filter.frequency, clamp(finite(o.lowpass || 20000, 20000, 'a voice lowpass'), 40, 20000), 20000, 'a voice lowpass');
      if (chain.panner) put(chain.panner.pan, clamp(finite(o.pan ?? 0, 0, 'a voice pan'), -1, 1), 0, 'a voice pan');
      if (chain.send) {
        // a generated sound already carries its style's small room; give it that much less of the live one
        const own = item.key && item.key.fx && item.key.fx.reverb ? item.key.fx.reverb : 0;
        voice.sendScale = Math.max(0.15, 1 - own * 2.2);
        put(chain.send.gain, clamp(finite(o.send ?? 1, 1, 'a voice send'), 0, 8) * voice.sendScale, 0, 'a voice send');
      }
      source.connect(chain.gain);
      source.onended = () => release(voice);
      source.start(when);
    });
    return voice;
  }

  const recently = (key, when) => {
    const map = typeof key === 'string' ? lastNamed : lastObject;
    const soon = map.has(key) && Math.abs(when - map.get(key)) < 0.03;
    if (!soon) map.set(key, when);
    return soon;
  };

  // Puts the current space on the output: a new room fades in while the old one fades out.
  function applySpace(fade) {
    if (!ctx || !nodes.reverbIn) return;
    const t = ctx.currentTime, over = Math.max(0.02, fade);
    if (room) {
      const old = room;
      old.wet.gain.cancelScheduledValues?.(t); old.wet.gain.setValueAtTime(old.wet.gain.value, t); old.wet.gain.linearRampToValueAtTime(0, t + over);
      scheduler.at(t + over + 0.1, () => { old.convolver.disconnect?.(); old.wet.disconnect?.(); });
      room = null;
    }
    if (!(space.reverb > 0 || space.echo > 0)) return;
    const key = JSON.stringify(space) + rate(), wanted = space;
    const enter = (buffer) => {
      if (!ctx || space !== wanted || room) return; // another space was asked for meanwhile
      const now = ctx.currentTime, convolver = ctx.createConvolver(), wet = ctx.createGain();
      convolver.normalize = false; convolver.buffer = buffer;
      wet.gain.setValueAtTime(0, now); wet.gain.linearRampToValueAtTime(1, now + over);
      nodes.reverbIn.connect(convolver); convolver.connect(wet); wet.connect(nodes.master);
      room = { convolver, wet };
    };
    if (responses.has(key)) { enter(responses.get(key)); return; }
    // a room's answer is built once, a little per frame, then kept
    queue.render(impulsePlan(space, rate()), ([left, right]) => {
      if (!ctx) return;
      const buffer = ctx.createBuffer(2, left.length, rate());
      buffer.getChannelData(0).set(left); buffer.getChannelData(1).set(right);
      responses.set(key, buffer);
      enter(buffer);
    });
  }
  // How a sound at a place is heard: volume, side, dullness (distance and walls) and how much room it gets.
  function hear(at, opts, fn) {
    const p = toPoint(at, fn);
    const muffle = clamp01(num(opts.muffle, walls.length ? occlusion(p, listener, walls) : 0, `${fn}: muffle`));
    const heard = spatialize(p, listener, { range: opts.range ?? core.range, muffle });
    return { ...heard, send: 1 + heard.far * space.distance + muffle * 0.5 };
  }

  const positionOk = (at) => { const x = Array.isArray(at) ? at[0] : at && at.x, y = Array.isArray(at) ? at[1] : at && at.y; return !(typeof x === 'number' && typeof y === 'number') || (Number.isFinite(x) && Number.isFinite(y)); };

  const core = {
    hear, num, finite, bad: (what) => { stats.badValues++; lastBad = what; },
    ctx: () => ctx, nodes: () => nodes, unlocked: () => audio.unlocked, on: () => audio.unlocked && !muted,
    samples, getBuffer, resolve, startVoice, steal, makeRoom, note, scheduler, playTime, listener, setParam,
    rng: options.rng ?? createRng('studio-audio'), style: options.style ?? 'storybook', range: options.range ?? DEFAULT_RANGE,
  };
  const music = createMusicPlayer(core);

  const gestures = ['pointerdown', 'keydown', 'touchend'];
  const onGesture = () => { audio.unlock(); };
  const onVisibility = () => {
    if (!ctx) return;
    lastUpdate = -1; // a hidden tab is not a slow frame
    if (win.document.hidden) ctx.suspend(); else ctx.resume();
  };
  const removeGestures = () => { if (win && win.removeEventListener) gestures.forEach((g) => win.removeEventListener(g, onGesture)); };

  const audio = {
    /** true when there is no Web Audio here (Node tests): nothing can make sound. */
    silent: !Ctx,
    /** List of { type: 'sfx'|'music'|'stopMusic'|'musicState'|'musicTime'|'ambience'|'stopAmbience'|'space', name, played } for tests and play-tests (newest last, max 200). */
    log,
    /** true once the browser has allowed sound (after the first key press or tap). */
    get unlocked() { return Boolean(ctx) && ctx.state === 'running'; },
    get muted() { return muted; },
    /** Name of the music that is playing or waiting to play, or null. */
    get musicName() { return music.name; },
    /** State of the playing score ('calm', 'combat'...), or null when the music is a plain song. */
    get musicState() { return music.state; },
    /** Time of day of the playing score ('day', 'dusk', 'night'), or null when none was set. */
    get musicTime() { return music.time; },
    /** The intensity dial 0..1 when setMusicIntensity is in use, else null. */
    get musicIntensity() { return music.intensity; },

    /** unlock() -> turns sound on. Must run inside a key press or tap handler. Safe to call many times. */
    unlock() {
      if (!Ctx) return false;
      if (!ctx) {
        try { ctx = new Ctx({ latencyHint: options.latency ?? 'balanced' }); } catch { audio.silent = true; return false; }
        const master = ctx.createGain(), sfxBus = ctx.createGain(), musicBus = ctx.createGain(), ambienceBus = ctx.createGain();
        // A limiter, not a compressor: it leaves a normal mix alone and only catches peaks that would clip.
        const limiter = ctx.createDynamicsCompressor(), meter = ctx.createAnalyser();
        for (const [key, value] of Object.entries(LIMITER)) if (limiter[key]) limiter[key].value = value;
        sfxBus.connect(master); musicBus.connect(master); ambienceBus.connect(master);
        master.connect(limiter); limiter.connect(meter); meter.connect(ctx.destination);
        nodes = { master, sfx: sfxBus, music: musicBus, ambience: ambienceBus, meter };
        if (ctx.createConvolver) { // the room: every effect voice and (more quietly) the music feed it
          nodes.reverbIn = ctx.createGain();
          const musicSend = ctx.createGain();
          musicSend.gain.value = 0.5;
          musicBus.connect(musicSend); musicSend.connect(nodes.reverbIn); // taken after the music volume
          // voices reach the room through a gain per bus that follows that bus's volume slider
          nodes.sends = { sfx: ctx.createGain(), music: ctx.createGain(), ambience: ctx.createGain() };
          for (const send of Object.values(nodes.sends)) send.connect(nodes.reverbIn);
        }
        applyVolumes();
        applySpace(0.02);
      }
      // The device may take a moment to start; whatever was waiting begins as soon as it runs.
      const started = () => { if (ctx && ctx.state === 'running') { playEarly(); music.start(); core.onUnlock?.(); } };
      if (ctx.state === 'suspended') { const p = ctx.resume(); if (p && p.then) p.then(started, () => {}); }
      if (ctx.addEventListener) ctx.addEventListener('statechange', started);
      removeGestures();
      scheduler.start();
      started();
      return true;
    },

    /**
     * play(sound, { volume, pitch, pan, seed, at, range, delay, priority }?) -> true if it was started
     *   sound: a built-in name ('coin'), a name from define(), a sound object, a generated
     *          asset from generateSound(), or a jingle song
     *   volume 0..1 (default 1), pitch 0.25..4 speed multiplier (default 1),
     *   pan -1 left .. 1 right (default 0), seed: variation of a built-in sound,
     *   at: { x, y } position in the world; volume, pan and dullness then follow the listener,
     *   delay: seconds from now, priority: 0..10 (default 5; low ones give way when many sounds play)
     */
    play(sound, opts = {}) {
      const item = resolve(sound, opts.seed);
      let volume = clamp01(num(opts.volume, 1, 'audio.play: volume')), pan = clamp(num(opts.pan, 0, 'audio.play: pan'), -1, 1), lowpass = 0, send = 1;
      const pitch = num(opts.pitch, 1, 'audio.play: pitch'), delay = Math.max(0, num(opts.delay, 0, 'audio.play: delay'));
      if (opts.at !== undefined && opts.at !== null && !positionOk(opts.at)) { // somewhere that is not a place (NaN): nothing to hear
        stats.badValues++; lastBad = `audio.play: at was ${JSON.stringify(opts.at)}`;
        note('sfx', item.name, false);
        return false;
      }
      if (opts.at !== undefined && opts.at !== null) {
        const heard = hear(opts.at, opts, 'audio.play');
        volume *= heard.volume; pan = heard.pan; lowpass = heard.lowpass < 19000 ? heard.lowpass : 0; send = heard.send;
      }
      const o = { volume, pan, lowpass, send, pitch: pitch * (item.nudge ?? 1), priority: num(opts.priority, 5, 'audio.play: priority'), bus: opts.bus };
      if (!audio.unlocked) {
        const entry = note('sfx', item.name, false);
        if (Ctx && !muted && volume > 0.0005 && !audio.silent) { early.push({ item, o, entry, at: clock() }); if (early.length > 8) early.shift(); }
        return false;
      }
      const when = playTime() + delay;
      const ok = !muted && volume > 0.0005 && !recently(item.key, when) && makeRoom(item.key, opts.priority ?? 5);
      note('sfx', item.name, ok);
      if (!ok) return false;
      startVoice(item, { ...o, when });
      return true;
    },

    /**
     * define(name, sound) -> registers your own sound (or overrides a built-in) so play(name) works.
     * sound may be a list of sounds or assets (see generateTakes): play(name) then picks a different
     * one each time and nudges its pitch, so a sound that repeats a lot never sounds copied.
     */
    define(name, sound) {
      if (typeof name !== 'string' || !name) throw new Error(`audio.define: name must be a non-empty string, got ${JSON.stringify(name)}`);
      if (Array.isArray(sound)) {
        if (sound.length === 0) throw new Error('audio.define: the list of takes is empty');
        const list = sound.map((s) => (s && typeof s === 'object' && s.sound && !isSong(s) ? s.sound : s));
        for (const s of list) soundLayers(s, 'audio.define');
        takes.set(name, { list, last: -1 }); custom.delete(name);
        return;
      }
      takes.delete(name);
      const data = sound && typeof sound === 'object' && sound.sound && !isSong(sound) ? sound.sound : sound;
      if (isSong(data)) parseSong(data); else soundLayers(data, 'audio.define');
      custom.set(name, data);
    },

    /**
     * preload(sounds, onDone?) -> builds the listed sounds, songs or scores now, a little per frame,
     * so the first play has no wait. Call after unlock. onDone() runs when all are ready.
     */
    preload(sounds, onDone) {
      const items = [];
      for (const s of sounds) {
        if (s && Array.isArray(s.stems)) for (const stem of s.stems) { parseSong(stem.song); items.push({ key: stem.song, plan: (r) => songPlan(stem.song, r, { samples }) }); }
        else if (isSong(s) && s.loop !== false) { parseSong(s); items.push({ key: s, plan: (r) => songPlan(s, r, { samples }) }); }
        else if (s && typeof s === 'object' && s.bed) items.push(core.ambienceItem(s));
        else items.push(resolve(s));
      }
      let left = items.length;
      const one = () => { if (--left === 0 && onDone) onDone(); };
      if (!ctx || left === 0) { if (onDone) onDone(); return; }
      for (const item of items) getBuffer(item, one);
    },

    /**
     * playMusic(music, { fade, state }?) -> loops a song (generateSong or hand-written) or an
     * adaptive score (generateScore). Swapping cross-fades over `fade` seconds (default 0.5).
     * Asking for the music that is already playing does nothing. If sound is not unlocked yet,
     * it starts as soon as it is. `state` picks the score's starting state.
     */
    playMusic(piece, opts = {}) { music.play(piece, opts); },

    /**
     * setMusicState(state, { fade, quantize, swell }?) -> moves a playing score to another state
     * ('calm', 'explore', 'danger', 'combat') without restarting it. Layers that come in enter on the
     * next bar line (quantize: 'bar' default, 'beat' or 'now'); layers that leave fade out over
     * `fade` seconds (default 1.2). A short swell leads into a much louder state (swell: false to skip).
     */
    setMusicState(state, opts = {}) { music.setState(state, opts); },

    /**
     * setMusicIntensity(amount, { fade }?) -> a smooth dial instead of named states: 0 is calm, 1 is
     * combat, and anything between blends the two nearest states. Safe to call every game step
     * (for example with how close the nearest enemy is); the layers follow gradually.
     */
    setMusicIntensity(amount, opts = {}) { music.setIntensity(amount, opts); },

    /** setMusicTime(time, { fade }?) -> 'day', 'dusk' or 'night': the same score, thinner and duller at night (4 s fade). */
    setMusicTime(time, opts = {}) { music.setTime(time, opts); },

    /** stopMusic({ fade }?) -> fades the music out (default 0.5 seconds). */
    stopMusic(opts = {}) { music.stop(opts); },

    /**
     * setSpace(space, { fade }?) -> the place the listener is in: 'none', 'field', 'forest', 'room', 'hall',
     * 'cave', 'crypt', 'canyon' (SPACE_NAMES), 'style:<style>' or your own { reverb, room, damp, predelay,
     * echo, echoTime, distance }. Every effect, footstep and the music is heard in that room from then on,
     * and far sounds get more of it than near ones. The change cross-fades over `fade` seconds (default 1.5).
     */
    setSpace(value, opts = {}) {
      const next = spaceOf(value, 'audio.setSpace');
      if (JSON.stringify(next) === JSON.stringify(space)) return;
      space = next;
      note('space', space.name, audio.unlocked);
      applySpace(num(opts.fade, 1.5, 'audio.setSpace: fade'));
      core.onListener?.();
    },
    /** Name of the current space ('none', 'cave', 'custom'...). */
    get space() { return space.name; },

    /**
     * setWalls(walls) -> things that block sound: a list of { x1, y1, x2, y2 } lines or { x, y, w, h }
     * boxes, each with an optional density 0..1. Positional sounds and emitters behind one are quieter
     * and duller. Pass [] to clear. (Or pass `muffle` 0..1 yourself on a single play.)
     */
    setWalls(list) {
      occlusion([0, 0], [1, 1], list); // checks the shapes, throws on a bad one
      walls = list.slice();
      core.onListener?.();
    },

    /** setListener(x, y) -> where the player's ears are, in world pixels. Call when the player or camera moves. */
    setListener(x, y) {
      if (typeof x === 'number' && typeof y === 'number' && !(Number.isFinite(x) && Number.isFinite(y))) { // called every step: a NaN keeps the old place
        stats.badValues++; lastBad = `audio.setListener: position was ${x}, ${y}`;
        return;
      }
      const p = toPoint([x, y], 'audio.setListener');
      listener.x = p.x; listener.y = p.y;
      core.onListener?.();
    },

    /**
     * update(dt) -> call once per game step (dt in seconds). Optional but recommended: when the
     * game runs several steps in one frame to catch up, their sounds keep their spacing instead
     * of all landing on the same instant, and timed events stay on schedule.
     */
    update(dt) {
      if (!ctx) return;
      const now = ctx.currentTime;
      const since = lastUpdate >= 0 ? now - lastUpdate : Infinity;
      if (lastUpdate >= 0 && ctx.state === 'running') worstGap = Math.max(worstGap, since);
      lastUpdate = now;
      // Game time runs beside the audio clock. While the game keeps up (one step per frame) they
      // agree and sounds start at once. When several steps run in one frame, game time gets ahead,
      // and each step's sounds start that much later instead of all at the same instant.
      const step = dt > 0 && dt < 1 ? dt : 0; // a zero, negative, endless or not-a-number step moves nothing
      // A step that comes a whole step after the last one is an ordinary frame: start from the clock.
      // Only steps that follow each other faster than that (catching up inside one frame) run ahead.
      // Without this, a game whose frames are a hair shorter than its step would creep ahead of the
      // clock a little every frame and its sounds would start later and later.
      if (anchor < 0 || step === 0 || since >= step * 0.9) { anchor = now; gameTime = 0; } else gameTime += step;
      if (anchor + gameTime <= now) { anchor = now; gameTime = 0; }
      scheduler.pump();
    },

    /** setVolume(bus, value) -> bus is 'master', 'sfx', 'music' or 'ambience'; value 0..1. Saved to the store if one was given. */
    setVolume(bus, value) {
      if (!BUSES.includes(bus)) throw new Error(`audio.setVolume: bus must be one of ${BUSES.join(', ')}, got ${JSON.stringify(bus)}`);
      if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`audio.setVolume: value must be a number from 0 to 1, got ${JSON.stringify(value)}`);
      volumes[bus] = clamp01(value);
      applyVolumes(); save();
    },
    /** getVolume(bus) -> 0..1 */
    getVolume(bus) {
      if (!BUSES.includes(bus)) throw new Error(`audio.getVolume: bus must be one of ${BUSES.join(', ')}, got ${JSON.stringify(bus)}`);
      return volumes[bus];
    },
    /** setMuted(true|false) -> silences or restores everything. Saved to the store if one was given. */
    setMuted(value) { muted = Boolean(value); applyVolumes(); save(); },
    /** toggleMute() -> flips mute, returns the new muted value. */
    toggleMute() { audio.setMuted(!muted); return muted; },

    /** count(name) -> how many times play(name) was asked for (played or not). For tests. */
    count(name) { return log.filter((e) => e.type === 'sfx' && e.name === name).length; },
    /** level() -> loudness right now, 0 (silence) .. about 1. For meters and play-tests. */
    level() {
      if (!nodes) return 0;
      const data = new Float32Array(nodes.meter.fftSize);
      nodes.meter.getFloatTimeDomainData(data);
      let sum = 0;
      for (const x of data) sum += x * x;
      return Math.sqrt(sum / data.length);
    },
    /**
     * stats() -> numbers for play-tests and for finding out why sound is late or rough:
     *   voices, played, stolen, dropped: effect voices now and since the start
     *   rendering, scheduled: sounds still being built, timed events waiting
     *   sampleRate, latency: the device's rate and its delay in seconds (speaker lag the page cannot remove)
     *   worstGap: longest time in seconds between two update() calls since the last stats() call. Sounds can
     *             only start when the game runs, so a gap of 0.2 means some sound was up to 0.2 s late
     *             because the page was busy, not because of audio. Needs update(dt) every game step.
     *   underruns: times the device ran out of audio (crackle), where the browser reports it; else null
     *   badValues, lastBadValue: how often the game handed over NaN or Infinity (a safe value was used
     *             instead) and what the last one was, e.g. "audio.play: pitch was NaN". Should stay 0.
     */
    stats() {
      const gap = worstGap, device = ctx && ctx.playbackStats;
      worstGap = 0;
      return {
        voices: active.size, ...stats, rendering: queue.pending, scheduled: scheduler.size, sampleRate: rate(),
        latency: ctx ? (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0) : 0,
        worstGap: Math.round(gap * 1000) / 1000, underruns: device ? device.underrunEvents : null, lastBadValue: lastBad,
      };
    },
    /** destroy() -> stops everything and releases the browser audio device. */
    destroy() {
      removeGestures();
      if (win && win.document && win.document.removeEventListener) win.document.removeEventListener('visibilitychange', onVisibility);
      scheduler.stop(); scheduler.clear(); queue.clear();
      music.reset(); core.onDestroy?.();
      active.clear(); pools.clear(); room = null; responses.clear();
      if (ctx && ctx.close) ctx.close();
      ctx = null; nodes = null;
    },
  };

  attachWorld(audio, core);
  if (Ctx && win && win.addEventListener && options.autoUnlock !== false) gestures.forEach((g) => win.addEventListener(g, onGesture));
  if (Ctx && win && win.document && win.document.addEventListener) win.document.addEventListener('visibilitychange', onVisibility);
  return audio;
}
