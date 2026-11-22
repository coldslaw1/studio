// Sound for the demo, all made in code by the audio engine: footsteps from the puppets' `step`
// events, ambience (music, birds, wind), hits and menu sounds.
import { generateScore, jingle } from '../vendor/audio/index.js';

/**
 * @param {object} o
 * @param {object} o.audio  The audio engine's audio (the base's audio plugin makes it; volumes follow the Sound and Music settings).
 * @param {object} o.input  core's input (sound starts on the first key or tap).
 * @param {() => number} o.rng  seeded random, for pitch variation and bird timing.
 * @returns {object} sound: { audio, step, at, ambience(dt), music(name), play(name, options) }
 */
export function createSound({ audio, input, rng }) {
  // every sound the game uses is built ahead (the long wind gust took 60 ms on its first play, six seconds in); songs and jingles too (spread over frames by the engine), so the first play of one never stalls a frame
  input.onFirstGesture(() => { audio.unlock(); audio.preload?.(['wind', 'bird', 'step', 'swish', 'hit', 'thud', 'wood', 'crate', 'herb', 'pickup', 'blip', 'coin', ...Object.values(songs), ...Object.values(jingles)]); });
  audio.define('bird', { layers: [
    { wave: 'sine', freq: 2900, freqEnd: 3700, duration: 0.09, volume: 0.16, attack: 0.01, release: 0.04 },
    { wave: 'sine', freq: 3300, freqEnd: 2600, duration: 0.12, delay: 0.13, volume: 0.14, attack: 0.01, release: 0.05 },
    { wave: 'sine', freq: 3000, freqEnd: 3900, duration: 0.08, delay: 0.3, volume: 0.12, attack: 0.01, release: 0.04 },
  ] });
  audio.define('wind', { wave: 'noise', freq: 500, duration: 2.6, volume: 0.1, attack: 1.0, release: 1.2, lowpass: 420, lowpassEnd: 800 });
  audio.define('crate', { layers: [
    { wave: 'noise', freq: 900, duration: 0.16, volume: 0.3, release: 0.1, lowpass: 1200 },
    { wave: 'square', freq: 90, freqEnd: 60, duration: 0.12, volume: 0.25, release: 0.06 },
  ] });
  audio.define('herb', { wave: 'triangle', freq: 660, duration: 0.25, volume: 0.35, arp: [0, 5, 12], arpSpeed: 0.07, release: 0.1 });
  audio.define('wood', { layers: [
    { wave: 'square', freq: 180, freqEnd: 110, duration: 0.09, volume: 0.4, decay: 0.08, sustain: 0, lowpass: 1500 },
    { wave: 'noise', freq: 2000, duration: 0.05, volume: 0.25, release: 0.04 },
  ] });
  // One adaptive score per area: its layers come and go with the danger (intensity) and the time of
  // day, without the music ever starting over. Each area is also heard in its own room.
  const songs = {
    hamlet: generateScore({ style: 'storybook', seed: 11 }),
    world: generateScore({ style: 'storybook', seed: 23 }),
    cellar: generateScore({ style: 'crypt', seed: 4 }),
    title: generateScore({ style: 'storybook', seed: 2 }),
  };
  const SPACES = { hamlet: 'forest', world: 'forest', cellar: 'crypt', title: 'hall' };
  let danger = 0; let timeOfDay = 'day';
  const jingles = { quest: jingle('levelUp'), win: jingle('win'), start: jingle('start'), secret: jingle('secret') };
  let bird = 3; let wind = 6; let current = null; let silent = false;
  const sound = {
    audio,
    /** Play an effect: a built-in name, one defined above, or a jingle name (quest, win, start, secret). */
    play(name, options) { return silent ? false : audio.play(jingles[name] ?? name, options); },
    /** Stop making any sound (true) or carry on (false), without changing the player's volume or mute setting. */
    quiet(on) { silent = !!on; },
    /** Start the music that was playing before a quiet spell. */
    resumeMusic() { if (current && !silent) audio.playMusic(songs[current], { fade: 0.8 }); },
    /** A footstep, quieter and to one side when it is not the player's. `near` 0..1, `pan` -1..1. */
    step(near = 1, pan = 0, run = false) {
      if (near <= 0.02 || silent) return;
      audio.play('step', { volume: (run ? 0.5 : 0.34) * near, pitch: 0.85 + rng() * 0.3, pan });
    },
    /** Loudness and side for a sound at a ground point, heard from the listener: { near, pan }. */
    at(x, y, listener, reach = 9) { // other people's steps are only heard close by, or a walking guard patters all the time
      const dx = x - listener.x; const dy = y - listener.y;
      return { near: Math.max(0, 1 - Math.hypot(dx, dy) / reach), pan: Math.max(-1, Math.min(1, dx / reach * 2)) };
    },
    /** Birds and wind now and then. Call every update while outdoors. */
    ambience(dt) {
      if (silent) return;
      bird -= dt; wind -= dt;
      if (bird <= 0) { bird = 2.5 + rng() * 6; audio.play('bird', { volume: 0.5 + rng() * 0.4, pitch: 0.85 + rng() * 0.4, pan: rng() * 2 - 1 }); }
      if (wind <= 0) { wind = 5 + rng() * 7; audio.play('wind', { volume: 0.6 + rng() * 0.4, pan: rng() * 1.4 - 0.7 }); }
    },
    /** One line for the debug overlay: is sound late because of the page (gap), the device (latency) or neither. */
    debugLine() {
      const s = audio.stats ? audio.stats() : null;
      if (!s) return '';
      const ms = (v) => (Number.isFinite(v) ? Math.round(v * 1000) + ' ms' : 'n/a');
      const clock = globalThis.window?.game?.core?.loop?.stats?.summary?.() ?? '';
      const pace = globalThis.window?.game?.core?.pace;
      const draw = pace ? `draw ${pace.cost.toFixed(1)} ms, cap ${pace.maxFps || 'screen'} fps  ` : '';
      return `${draw}${clock ? clock + '  ' : ''}audio: worst gap ${ms(s.worstGap)}, underruns ${s.underruns ?? 0}, device latency ${ms(s.latency)}`;
    },
    /** How much danger the music should carry, 0 (calm) to 1 (a fight). Call every tick; it only acts on a real change. */
    danger(level) {
      const v = Math.max(0, Math.min(1, level));
      if (Math.abs(v - danger) < 0.04 && !(v === 0 && danger !== 0)) return;
      danger = v;
      audio.setMusicIntensity?.(v, { fade: 1.2 });
    },
    /** 'day', 'dusk' or 'night': the same music, thinner and duller as it gets dark. */
    timeOfDay(name) {
      if (name === timeOfDay || !['day', 'dusk', 'night'].includes(name)) return;
      timeOfDay = name;
      audio.setMusicTime?.(name, { fade: 3 });
    },
    /** Switch the looping music: 'hamlet', 'cellar' or 'title'. Safe to call whenever a scene starts. */
    music(name) {
      if (!songs[name]) throw new Error(`sound.music: unknown song ${JSON.stringify(name)}, expected ${Object.keys(songs).join(', ')}`);
      if (SPACES[name] && audio.setSpace) audio.setSpace(SPACES[name], { fade: 0.6 });
      current = name;
      if (!silent) audio.playMusic(songs[name], { fade: 0.8 });
    },
  };
  return sound;
}
