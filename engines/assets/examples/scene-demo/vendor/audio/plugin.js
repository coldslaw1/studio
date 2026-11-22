// The audio engine as a base plugin: volumes follow the shared Sound and Music settings, the
// sound palette follows the game's style, timing runs in the steady phase (so music keeps time
// while the game is paused), and the listener follows an actor.
//   plugins: [audioPlugin({ listener: 'hero' })]
//   base.plugin('audio').play('coin');
import { createAudio } from './audio.js';
import { createSampleBank, loadSamplePack } from './samples.js';
import { generateSound, generateScore, generateAmbience } from './index.js';

/**
 * audioPlugin(options) -> plugin
 *   options: anything createAudio takes (maxVoices, range, space, window, AudioContext ...), plus
 *   listener   id of the actor that hears (default 'hero'); positions are ground metres times `unit`
 *   unit       audio pixels per ground metre for positional sound (default 32)
 *   musicScale how loud music is at Music = 1 (default 0.5)
 *   quietWhenHidden  stop sounding while the page is hidden or not in front (default true; needs a window)
 *   samples    recordings: music plays the recorded instruments and a described sound takes a fitting recording
 *              as its body. Either a sample bank you loaded (loadSamplePack, see samples.js), or the names of
 *              library sample packs, fetched after the game starts: ['impacts', 'rpg'] (small, the default when
 *              `library` is given), 'orchestra' (22 MB of instruments) on request. An entry may be
 *              { pack: 'orchestra', only: ['piano', 'strings'] }. false or left out with no library: all synthesised.
 *   library    url of the game's library folder, ending in "/": packs are read from <library>samples/<pack>/
 *   load       { loadSamplePack } replacement (tests)
 *   Sounds made before a pack has arrived stay synthesised; wait for plugin('audio').ready to be sure.
 * base.plugin('audio') -> { audio, play(name, opts), music(state), sound(describe, seed), score(seed), style, quiet(on), samples, ready, loaded, credits() }
 *   ready      a Promise that resolves when the named packs are in (a pack that fails is reported on the bus as 'audio:error' and left out)
 *   loaded     names of the packs that have arrived
 *   credits()  the recordings in use, as credit entries (see the ui kit's credits.js)
 *   play: opts.at may be an actor id or { x, y } in ground metres.
 * Bus: listens for 'audio:play' { name, ...opts } and 'audio:music' { state }, so plugins can ask for sound without importing this one.
 */
export function audioPlugin(options = {}) {
  return {
    name: 'audio',
    install(base) {
      const unit = options.unit ?? 32; const musicScale = options.musicScale ?? 0.5;
      const win = options.window === undefined ? (globalThis.window ?? null) : options.window;
      let style = base.style.tokens.audio ?? 'storybook';
      // recordings: a bank the game loaded itself, or library packs by name, which fill one bank as they arrive
      if (options.library !== undefined && (typeof options.library !== 'string' || !options.library.endsWith('/'))) throw new Error(`audioPlugin: library must be a folder address ending in "/", got ${JSON.stringify(options.library)}`);
      const given = options.samples;
      const wanted = Array.isArray(given) ? given : (given === undefined && options.library !== undefined ? ['impacts', 'rpg'] : null);
      if (given !== undefined && given !== false && given !== null && !Array.isArray(given) && typeof given.addNote !== 'function') throw new Error('audioPlugin: samples must be a sample bank or a list of library pack names such as ["impacts", "rpg"]');
      if (wanted && options.library === undefined) throw new Error('audioPlugin: samples names library packs, so give library too (the url of the game\'s library folder, for example "library/")');
      const bank = wanted ? createSampleBank() : (given && typeof given.addNote === 'function' ? given : null);
      const loaded = [];
      const loadPack = options.load?.loadSamplePack ?? loadSamplePack;
      const ready = Promise.all((wanted ?? []).map(async (entry) => {
        const pack = typeof entry === 'string' ? entry : entry?.pack;
        try {
          if (typeof pack !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(pack)) throw new Error(`a sample pack is named like "impacts" or given as { pack, only }, got ${JSON.stringify(entry)}`);
          bank.merge(await loadPack(`${options.library}samples/${pack}/`, typeof entry === 'object' && entry.only ? { only: entry.only } : {}));
          loaded.push(pack); base.bus.emit('audio:samples', { pack });
        } catch (e) { base.bus.emit('audio:error', { pack, message: String(e?.message ?? e) }); }
      })).then(() => loaded);
      const audio = createAudio({ ...options, samples: bank ?? undefined, window: win, style, store: undefined, autoUnlock: !base.input.raw.onFirstGesture });
      base.input.raw.onFirstGesture?.(() => audio.unlock());
      base.style.watch((t) => { style = t.audio ?? style; if ('style' in audio) { try { audio.style = style; } catch { /* fixed at creation in this audio version */ } } });
      base.settings.watch('sound', (v) => audio.setVolume('sfx', v));
      base.settings.watch('music', (v) => audio.setVolume('music', v * musicScale));
      const place = (at) => {
        const p = typeof at === 'string' ? base.actors.get(at) : at;
        return p ? { x: p.x * unit, y: p.y * unit } : undefined;
      };
      const play = (name, opts = {}) => audio.play(name, opts.at === undefined ? opts : { ...opts, at: place(opts.at) });
      const music = (state) => audio.setMusicState(state);
      base.on('steady', (dt) => {
        const ear = base.actors.get(options.listener ?? 'hero');
        if (ear) audio.setListener(ear.x * unit, ear.y * unit);
        audio.update?.(dt);
      }, { owner: 'audio' });
      base.bus.on('audio:play', (e) => { if (e?.name) play(e.name, e); });
      base.bus.on('audio:music', (e) => { if (e?.state) music(e.state); });
      let quiet = false; const before = {};
      /** Silence everything without touching the player's own volume settings (window not in front). */
      const setQuiet = (on) => {
        if (!!on === quiet) return;
        quiet = !!on;
        if (quiet) { before.master = audio.getVolume('master'); audio.setVolume('master', 0); } else audio.setVolume('master', before.master ?? 1);
      };
      const doc = win?.document;
      if (doc && options.quietWhenHidden !== false && typeof doc.addEventListener === 'function') {
        const watch = () => setQuiet(doc.hidden || (typeof doc.hasFocus === 'function' && !doc.hasFocus()));
        doc.addEventListener('visibilitychange', watch); win.addEventListener('blur', watch); win.addEventListener('focus', watch);
        watch();
      }
      return {
        audio, play, music, quiet: setQuiet, generateSound, generateAmbience, // the generators, for plugins that make their own sounds (weather)
        samples: bank, ready, loaded,
        credits: () => (bank?.credits?.() ?? []).map((c) => ({ what: c.uses.some((n) => bank.has(n)) ? 'music' : 'sounds', pack: c.pack, author: c.author, license: c.license, url: c.url, required: c.required })),
        get style() { return style; },
        /** A generated sound in the game's style: sound('heavy wooden door creak', 3). */
        sound: (describe, seed = 1) => generateSound({ describe, seed, style }),
        /** An adaptive score in the game's style. */
        score: (seed = 1) => generateScore({ style, seed }),
      };
    },
  };
}
