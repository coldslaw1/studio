// Links to the other engines. Each one takes the other engine's object from the caller and only
// calls or writes what that engine documents; this file imports nothing from them.
//   createFirstPersonWeather  fog distance and grass wind of a first-person / orbit world
//   createWeatherSound        rain and wind layers and thunder through the audio engine
import { clamp } from './noise.js';

const SNOW = [236, 240, 248]; const SNOW_INK = [202, 212, 230];

/**
 * Joins the weather to a world of the first-person engine (createFpWorld), which also draws the
 * orbit view. Each frame it sets how far one can see (world.haze) and how the grass blows, and
 * it lays snow on the ground and on roofs and darkens wet ground as weather.now.snowCover and
 * wetness change.
 * The colour of the fog and the light come from the sky: light the world with
 * skyLink.apply(world, weatherSky(sky.now, weather.now, lit)) first, then call this.
 * @param {object} [o]
 * @param {boolean} [o.grass]  false leaves the grass alone (default true).
 * @param {boolean} [o.ground] false leaves the colours of the ground and roofs alone: no lying snow, no wet ground (default true).
 * @param {number} [o.breeze]  Wind speed in m/s at which grass moves as the world was built (default 5).
 * @returns {{adopt:Function, apply:Function}}
 */
export function createFirstPersonWeather(o = {}) {
  const breeze = o.breeze ?? 5;
  if (!(breeze > 0)) throw new Error(`createFirstPersonWeather: "breeze" must be above 0 m/s, got ${JSON.stringify(o.breeze)}`);
  const known = new WeakMap();

  /** Remember a world's own haze and grass (apply() does this by itself for a world it has not seen). */
  function adopt(world) {
    if (!world || typeof world.haze !== 'number' || !world.hazeColor) throw new Error('firstPersonWeather: expected a world from createFpWorld');
    const g = o.grass === false ? null : world.grass ?? null;
    const st = { haze: world.haze, sway: g ? g.sway : 0, gain: 1, lean: null, cover: 0, wet: 0, mats: null, objs: null };
    if (o.ground !== false && Array.isArray(world.materials)) {
      // the world's own colours, kept so snow and rain can be laid over them and taken off again
      st.mats = world.materials.map((m) => ({ fg: m.fg.slice(), bg: m.bg.slice() }));
      st.objs = world.objColors ? world.objColors.slice() : null;
    }
    if (g && g.source && typeof g.source.lean === 'function') {
      // plants handed in by Kiln lean by its own formula: scale that with the wind's strength
      st.lean = g.source.lean;
      g.source = { ...g.source, lean: (x, y, time) => st.lean(x, y, time) * st.gain };
    }
    known.set(world, st);
    return st;
  }

  /**
   * @param {object} world  From createFpWorld.
   * @param {object} w      weather.now
   */
  function apply(world, w) {
    const st = known.get(world) ?? adopt(world);
    const near = (st.haze > 0 ? 1 / st.haze : 0) + (w.visibility < 15000 ? 1 / w.visibility : 0);
    world.haze = near > 0 ? 1 / near : 0;
    const g = o.grass === false ? null : world.grass;
    if (g) {
      st.gain = clamp(w.wind.speed / breeze, 0.12, 2.6);
      g.wind[0] = w.wind.dir[0]; g.wind[1] = w.wind.dir[1];
      g.sway = st.sway * st.gain;
    }
    if (st.mats && (Math.abs(w.snowCover - st.cover) > 0.015 || Math.abs(w.wetness - st.wet) > 0.03 || (w.snowCover === 0) !== (st.cover === 0) || (w.wetness === 0) !== (st.wet === 0))) paintGround(world, st, w.snowCover, w.wetness);
    return world;
  }

  // Lying snow and wet ground: the ground's materials and everything that faces up (roofs, tree tops)
  // turn white with the snow cover; rain darkens and cools the ground. Only when the amounts have moved.
  function paintGround(world, st, cover, wet) {
    st.cover = cover; st.wet = wet;
    const lie = cover * cover * (3 - 2 * cover) * 0.94; const dark = 1 - 0.3 * wet * (1 - lie);
    world.materials.forEach((m, i) => {
      const base = st.mats[i];
      for (let c = 0; c < 3; c++) {
        const cool = c === 2 ? 1 : 1 - 0.06 * wet;
        m.bg[c] = Math.round(base.bg[c] * dark * cool + (SNOW[c] - base.bg[c] * dark * cool) * lie);
        m.fg[c] = Math.round(base.fg[c] * dark * cool + (SNOW_INK[c] - base.fg[c] * dark * cool) * lie);
      }
    });
    const oc = world.objColors; const on = world.objNormals;
    if (st.objs && on && oc.length === st.objs.length) {
      const rain = 1 - 0.14 * wet;
      for (let q = 0; q < oc.length; q += 3) {
        const up = clamp((on[q + 2] - 0.3) / 0.45); const a = lie * up; const d = a > 0 ? 1 : rain;
        for (let c = 0; c < 3; c++) oc[q + c] = st.objs[q + c] * d * (1 - a) + SNOW[c] * a;
      }
    }
  }
  return { adopt, apply };
}

/**
 * Rain and wind as two looping layers of the audio engine, and thunder after each lightning strike.
 * The layers are made once (two ambience beds and three thunder takes) and only their volume
 * changes afterwards, so weather never restarts a sound.
 * @param {object} o
 * @param {object} o.audio                From the audio engine's createAudio.
 * @param {Function} o.generateAmbience   The audio engine's generateAmbience.
 * @param {Function} [o.generateSound]    The audio engine's generateSound (for thunder; without it there is none).
 * @param {object} [o.weather]            The weather: its 'thunder' events are played. Or call thunder(event) yourself.
 * @param {string} [o.style]              Sound style (default: the audio's own).
 * @param {number} [o.seed]               Seed of the generated sounds (default 1).
 * @param {number} [o.volume]             Overall loudness of the weather, 0..1 (default 0.9).
 * @returns {{update:Function, thunder:Function, setShelter:Function, stop:Function, levels:object}}
 */
export function createWeatherSound(o = {}) {
  const { audio, generateAmbience, generateSound } = o;
  if (!audio || typeof audio.emitter !== 'function' || typeof audio.play !== 'function') throw new Error('createWeatherSound: "audio" must come from the audio engine\'s createAudio');
  if (typeof generateAmbience !== 'function') throw new Error('createWeatherSound: pass the audio engine\'s generateAmbience as "generateAmbience"');
  const volume = o.volume ?? 0.9; const seed = o.seed ?? 1;
  const styled = (req) => (o.style ? { ...req, style: o.style } : req);
  const levels = { rain: 0, wind: 0, shelter: 0 };
  const layers = { rain: null, wind: null };
  let takes = null; let take = 0; let off = null; let place = [0, 0];

  // a layer is made the first time it is heard, so a dry game never builds the rain
  function layer(name, describe) {
    if (!layers[name]) layers[name] = audio.emitter(generateAmbience(styled({ describe, seed })), { x: place[0], y: place[1], volume: 0, range: 1e6 });
    return layers[name];
  }
  function set(name, describe, level) {
    levels[name] = level;
    if (level < 0.004 && !layers[name]) return;
    const e = layer(name, describe);
    e.move(place[0], place[1]);
    e.setVolume(clamp(level * volume * (1 - 0.7 * levels.shelter)));
  }

  const sound = {
    /** The loudness last asked for: { rain, wind, shelter }, each 0..1. */
    levels,
    /**
     * Follow the weather. Call once per update (it only moves two volumes).
     * @param {object} w         weather.now
     * @param {{x:number, y:number}} [listener]  Where the player's ears are (the point given to audio.setListener).
     */
    update(w, listener) {
      if (listener) place = [listener.x, listener.y];
      set('rain', 'heavy rain', Math.pow(w.rain, 0.7));
      set('wind', 'howling wind', clamp((w.wind.speed - 4.5) / 14) * (0.75 + 0.25 * clamp(1 + w.wind.gust)) + 0.25 * w.snow);
    },
    /** Play a thunderclap for a 'thunder' event { distance, power }. Far ones are quiet and low. */
    thunder(event) {
      if (!generateSound) return false;
      takes ??= [1, 2, 3].map((n) => generateSound(styled({ describe: 'heavy thunder rumble', seed: seed * 10 + n })));
      const far = clamp(event.distance / 7000);
      take = (take + 1) % takes.length;
      return audio.play(takes[take], { volume: clamp((1 - 0.75 * far) * volume * (1 - 0.6 * levels.shelter)), pitch: 1.05 - 0.3 * far, priority: 7 });
    },
    /** 0 outdoors .. 1 deep indoors: the weather is heard less. */
    setShelter(amount) { levels.shelter = clamp(amount); },
    /** Fade the layers out and stop listening to the weather. */
    stop(opts = {}) {
      for (const k of ['rain', 'wind']) { layers[k]?.stop({ fade: opts.fade ?? 1 }); layers[k] = null; levels[k] = 0; }
      off?.(); off = null;
    },
  };
  if (o.weather) off = o.weather.on('thunder', (e) => sound.thunder(e));
  return sound;
}
