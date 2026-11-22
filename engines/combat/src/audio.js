// Glue to the `audio` engine. Nothing is imported from it: pass in the audio
// object (createAudio) or any object with play(sound, options). Combat events
// are mapped to sounds through a table you can replace entry by entry, so a
// new sound tool only has to answer play().

/**
 * SOUNDS -> which sound each combat event plays by default (names of the audio engine's built-in effects).
 * An entry is a sound name, a sound object, null (silence) or a function (event) => name | object | null.
 */
export const SOUNDS = {
  swing: 'swish',
  hit: (e) => (e.via === 'status' ? null : e.killed ? 'explosion' : 'hit'),
  block: 'thud',
  parry: 'zap',
  guardbreak: 'error',
  dodge: 'swish',
  death: null, // the killing 'hit' already made a sound
  throw: 'swish',
  bounce: 'bounce',
  stick: 'thud',
  rest: 'tick',
  break: 'explosion',
  reflect: 'zap',
  pickup: 'pickup',
  heal: 'powerup',
  status: 'blip',
  aggro: 'alarm',
  telegraph: 'tick',
  noammo: 'error',
};

/**
 * bindAudio(combat, audio, options) -> a function that stops the sounds.
 *   sounds    { eventType: entry } replaces or adds entries of SOUNDS (null silences one)
 *   volume    = 1: multiplies every volume
 *   listener  () => ({ x, y }): where the player hears from. With it, sounds pan left and right and fade with
 *             distance; `range` (default 20 * combat unit) is where they fall silent
 *   describe  (event, sound) => options for audio.play, merged over the defaults (for a richer sound tool)
 * Each hit is varied a little in pitch from the event itself (no random numbers, so nothing can desync),
 * and louder for bigger damage. Sounds are cosmetic: this never changes combat state.
 * On a multiplayer client, where combat runs on the server, call the returned handle's `play(event)` from room.onEvent instead.
 */
export function bindAudio(combat, audio, options = {}) {
  if (!audio || typeof audio.play !== 'function') throw new Error('bindAudio: pass the audio object (createAudio()) or anything with play(sound, options)');
  const sounds = { ...SOUNDS, ...(options.sounds || {}) };
  const range = options.range ?? 20 * (combat ? combat.config.unit : 1);
  let n = 0;
  function play(e) {
    let sound = sounds[e.type];
    if (typeof sound === 'function') sound = sound(e);
    if (!sound) return false;
    n += 1;
    const opts = { volume: options.volume ?? 1, pitch: 0.92 + ((n * 7) % 9) * 0.02 };
    if (e.type === 'hit') { opts.volume *= Math.min(1, 0.55 + (e.damage || 0) * 0.06); if (e.crit) opts.pitch *= 1.25; }
    const here = options.listener ? options.listener() : null;
    if (here && Number.isFinite(e.x) && Number.isFinite(e.y)) {
      const dx = e.x - here.x; const dy = e.y - here.y;
      const far = Math.min(1, Math.hypot(dx, dy) / range);
      if (far >= 1) return false;
      opts.volume *= 1 - far * far;
      opts.pan = Math.max(-1, Math.min(1, dx / (range * 0.5)));
    }
    return audio.play(sound, options.describe ? { ...opts, ...options.describe(e, sound) } : opts) !== false;
  }
  const off = combat ? combat.on('*', play) : () => {};
  const stop = () => off();
  stop.play = play;
  return stop;
}
