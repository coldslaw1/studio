// The weather as a plugin of the base engine (studio-engines/base). One line in a game's plugin
// list gives it weather that every view, the light, the grass and the sound share:
//   createBase({ plugins: [skyPlugin(), audioPlugin(), weatherPlugin({ climate: 'temperate' })] })
// It imports only its own engine; everything else comes through `base` or the options.
import { createWeather } from './weather.js';
import { KIND_NAMES } from './presets.js';
import { weatherSky, precipLight } from './light.js';
import { createWeatherOverlay } from './overlay.js';
import { createCellWeather } from './cells.js';
import { createFirstPersonWeather, createWeatherSound } from './links.js';

const AMOUNT = { off: 0, low: 0.45, full: 1 };

/**
 * weatherPlugin(options) -> plugin for createBase({ plugins: [...] })
 * @param {object} [options]  Everything createWeather takes (kind, kinds, climate, transition, wind, rng, seed), and:
 * @param {string} [options.setting]            Starting value of the 'weather' setting: 'auto' (default) or a kind name.
 * @param {object} [options.overlay]            Options for createWeatherOverlay (max, axes, metres).
 * @param {object} [options.cells]              Options for createCellWeather (max, reach).
 * @param {Function} [options.generateAmbience] The audio engine's generateAmbience (else taken from the audio plugin).
 * @param {Function} [options.generateSound]    The audio engine's generateSound, for thunder.
 * @param {boolean} [options.sound]             false: no weather sound even when the audio plugin is in.
 */
export function weatherPlugin(options = {}) {
  const names = [...KIND_NAMES, ...Object.keys(options.kinds ?? {})];
  return {
    name: 'weather',
    requires: [],
    uses: ['sky', 'audio'],
    settings: [
      { id: 'weather', label: 'Weather', type: 'choice', value: options.setting ?? 'auto', options: ['auto', ...names] },
      { id: 'weather.effects', label: 'Weather effects', type: 'choice', value: 'full', options: ['off', 'low', 'full'] },
    ],
    install(base) {
      const { setting, overlay: overlayOptions, cells: cellOptions, generateAmbience, generateSound, sound: wantSound, ...rest } = options;
      const dayLength = rest.dayLength ?? base.time.source?.config?.dayLength ?? 1200; // climate hours follow the game's own day
      const weather = createWeather({ ...rest, dayLength });
      const now = weather.now;
      const overlay = createWeatherOverlay({ rng: rest.rng, ...(overlayOptions ?? {}) });
      const cells = createCellWeather({ rng: rest.rng, ...(cellOptions ?? {}) });
      const worldLink = createFirstPersonWeather();
      const wind = { x: 0, y: 0, gust: 0, speed: 0 };
      const lit = {};
      let amount = 1; let flash = true; let sound = null; let soundStyle; let applying = false;
      const hasSky = () => Boolean((base.time.raw ?? base.time.now)?.light);
      const publish = () => { wind.x = now.wind.x; wind.y = now.wind.y; wind.gust = now.wind.gust; wind.speed = now.wind.speed; base.env.set('weather', now); base.env.set('wind', wind); };

      // shared state: every plugin reads base.env.get('weather') and base.env.get('wind')
      base.env.provide('weather', 'weather', now);
      base.env.provide('wind', 'weather', wind);
      // every reader of base.time.now gets the sky with the weather laid over it
      base.time.modify?.((sample) => (sample && sample.light ? weatherSky(sample, now, lit, { flash }) : sample));

      function makeSound() {
        if (sound || wantSound === false || !base.has('audio')) return;
        const api = base.plugin('audio'); const audio = api.audio ?? api;
        const ambience = generateAmbience ?? api.generateAmbience; const one = generateSound ?? api.generateSound;
        if (typeof audio?.emitter !== 'function' || typeof ambience !== 'function') return;
        sound = createWeatherSound({ audio, generateAmbience: ambience, generateSound: one, weather, style: soundStyle, seed: rest.seed });
      }

      base.on('sim', (dt) => {
        weather.step(dt);
        overlay.update(dt, now);
        publish();
        if (!sound) makeSound();
        sound?.update(now);
      }, { owner: 'weather' });
      base.on('draw:effects', (ctx) => {
        if (amount <= 0 || !ctx) return;
        const view = base.views.current;
        if (view && (view.weather === 'cells' || view.weather === 'none')) return; // cell views draw their own (api.cells)
        overlay.draw(ctx, 0, 0, base.width, base.height, now, { grade: !hasSky(), light: precipLight(base.time.now), flash, amount });
      }, { owner: 'weather' });

      base.settings.watch('weather', (value) => {
        if (applying) return;
        if (value === 'auto') weather.auto = true;
        else { weather.auto = false; if (weather.kind !== value) weather.set(value); }
      });
      base.settings.watch('weather.effects', (value) => { amount = AMOUNT[value] ?? 1; });
      base.settings.watch('reducedMotion', (on) => { flash = !on; });
      base.style.watch((tokens) => { soundStyle = tokens.audio; });
      for (const [event, name] of [['change', 'changed'], ['settled', 'settled'], ['precip', 'precip'], ['lightning', 'lightning'], ['thunder', 'thunder']]) {
        weather.on(event, (e) => base.bus.emit(`weather:${name}`, e));
      }
      publish();

      return {
        weather, overlay,
        /** The sample (also base.env.get('weather')). */
        get now() { return now; },
        /** Change the weather by hand: a kind name or channel numbers. Turns the climate off (the setting stays as it is). */
        set(kind, opts) { weather.auto = false; weather.set(kind, opts); },
        /** Let the climate choose again. */
        auto() { weather.auto = true; },
        /** For a view made of character cells (first person, orbit): call between view.render and view.draw.
         *  opts: { basis, depthAt, dt, center, reach } as createCellWeather's apply takes them. */
        cells(frame, opts = {}) { return amount > 0 ? cells.apply(frame, now, { light: precipLight(base.time.now), amount, ...opts }) : 0; },
        /** For a first-person / orbit world: fog distance and grass wind. Call each frame before view.render. */
        world(world) { return worldLink.apply(world, now); },
        get sound() { return sound; },
        save: () => weather.save(),
        load: (data) => {
          weather.load(data); publish();
          applying = true; // the setting follows the save without changing the weather again
          try { if (!weather.auto && base.settings.has('weather') && names.includes(weather.kind)) base.settings.set('weather', weather.kind); } finally { applying = false; }
        },
      };
    },
  };
}
