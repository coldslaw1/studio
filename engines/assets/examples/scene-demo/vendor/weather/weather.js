// createWeather: the air over the game. One object holds what the weather is doing right now
// (cloud, rain, snow, fog, wind, lightning, how wet or snowy the ground is), eases smoothly from one
// kind of weather to the next, and can choose the next kind by itself from a climate. Step it once
// per update and hand `weather.now` to every view, the sound and the game rules.
import { CHANNELS, KINDS, CLIMATES, channelsOf, pickKind } from './presets.js';
import { fbm1, noise1, smooth, clamp, lerp, seededRng } from './noise.js';
import { createLightningState, stepLightning, flashOf } from './lightning.js';

const GALE = 24; // metres a second when the wind channel is 1
const DEG = Math.PI / 180;
const N = CHANNELS.length;
const [CLOUD, RAIN, SNOW, FOG, WIND, GUST, STORM] = [0, 1, 2, 3, 4, 5, 6];

/** An empty sample for the weather to fill. See the README ("The sample") for every field. */
export function createWeatherSample() {
  return {
    time: 0, kind: 'clear', from: 'clear', mix: 1, settled: true,
    cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0,
    precip: 'none', intensity: 0,
    wind: { x: 0, y: 0, speed: 0, steady: 0, gust: 0, angle: 0, dir: [1, 0] },
    wetness: 0, snowCover: 0, flash: 0, visibility: 20000, sun: 1, fill: 1,
  };
}

/**
 * @param {object} [options]
 * @param {string|object} [options.kind]   Weather to start with: a kind name or channel numbers (default 'clear').
 * @param {object} [options.kinds]         Your own kinds, { name: { cloud, rain, snow, fog, wind, gust, storm } }, added to the built-in ones.
 * @param {number} [options.transition]    Seconds a change takes when set() is given none (default 25).
 * @param {boolean} [options.auto]         Let the climate choose the weather (default false).
 * @param {string|object} [options.climate]  A climate name or { hours: [min, max], weights: { kind: n } } (default 'temperate').
 * @param {number} [options.dayLength]     Seconds of play in a game day, for the climate's hours (default 1200, the sky's).
 * @param {{angle?:number, wander?:number, turn?:number}} [options.wind]  angle: degrees the wind blows toward
 *   (0 along +x, 90 along +y; default 20). wander: degrees it strays either way (default 35). turn: degrees a second it can turn (default 6).
 * @param {() => number} [options.rng]     Random numbers for lightning and the climate (default: seeded).
 * @param {number} [options.seed]          Picks the pattern of gusts (default 1).
 * @returns {object} weather
 */
export function createWeather(options = {}) {
  if (options === null || typeof options !== 'object') throw new Error(`createWeather: options must be an object, got ${JSON.stringify(options)}`);
  const kinds = { ...KINDS };
  for (const [name, values] of Object.entries(options.kinds ?? {})) kinds[name] = Object.freeze(Object.fromEntries(channelsOf(values, `createWeather kinds.${name}`).map((v, i) => [CHANNELS[i], v])));
  const transition = options.transition ?? 25;
  if (!(transition >= 0)) throw new Error(`createWeather: "transition" must be 0 or more seconds, got ${JSON.stringify(options.transition)}`);
  const dayLength = options.dayLength ?? 1200;
  if (!(dayLength > 0)) throw new Error(`createWeather: "dayLength" must be above 0 seconds, got ${JSON.stringify(options.dayLength)}`);
  const rng = options.rng ?? seededRng(options.seed ?? 1);
  if (typeof rng !== 'function') throw new Error('createWeather: "rng" must be a function returning 0..1');
  const seed = (options.seed ?? 1) | 0;
  const wo = options.wind ?? {};
  const wander = wo.wander ?? 35; const turn = wo.turn ?? 6;
  const listeners = new Map();
  const now = createWeatherSample();

  const targetOf = (kind, who) => {
    if (typeof kind === 'string') {
      if (!Object.hasOwn(kinds, kind)) throw new Error(`${who}: unknown kind ${JSON.stringify(kind)} (kinds: ${Object.keys(kinds).join(', ')})`);
      return [kind, channelsOf(kinds[kind], who)];
    }
    return ['custom', channelsOf(kind, who)];
  };
  const climateOf = (c, who) => {
    const table = typeof c === 'string' ? CLIMATES[c] : c;
    if (!table || typeof table.weights !== 'object' || !Array.isArray(table.hours)) throw new Error(`${who}: unknown climate ${JSON.stringify(c)} (climates: ${Object.keys(CLIMATES).join(', ')}, or { hours: [min, max], weights: { kind: n } })`);
    for (const k of Object.keys(table.weights)) if (!Object.hasOwn(kinds, k)) throw new Error(`${who}: climate names the unknown kind "${k}"`);
    return table;
  };

  const [startKind, start] = targetOf(options.kind ?? 'clear', 'createWeather');
  // st: everything that changes, and everything that is saved
  const st = {
    time: 0, kind: startKind, from: startKind, cur: start.slice(), a: start.slice(), b: start.slice(), t: 0, len: 0,
    wet: 0, cover: 0, angle: wo.angle ?? 20, angleTo: wo.angle ?? 20,
    auto: options.auto === true, climate: options.climate ?? 'temperate', nextAt: 0, precip: 'none',
    lightning: createLightningState(),
  };
  let climate = climateOf(st.climate, 'createWeather');
  const spell = () => { const [lo, hi] = climate.hours; return lerp(lo, hi, rng()) * dayLength / 24; };
  if (st.auto) st.nextAt = spell();

  const emit = (name, event) => { for (const fn of (listeners.get(name) ?? []).slice()) fn(event, now); };

  function fill() {
    const c = st.cur;
    now.time = st.time; now.kind = st.kind; now.from = st.from;
    now.mix = st.len > 0 ? clamp(st.t / st.len) : 1; now.settled = now.mix >= 1;
    now.cloud = c[CLOUD]; now.rain = c[RAIN]; now.snow = c[SNOW]; now.fog = c[FOG]; now.storm = c[STORM];
    now.precip = c[RAIN] < 0.03 && c[SNOW] < 0.03 ? 'none' : c[RAIN] >= c[SNOW] ? 'rain' : 'snow';
    now.intensity = Math.max(c[RAIN], c[SNOW]);
    // the wind: a steady push, gusts on top, and a direction that strays slowly
    const g = 0.6 * fbm1(st.time / 3.3, seed) + 0.4 * Math.max(0, noise1(st.time / 0.85, seed + 3));
    const steady = c[WIND] * GALE;
    const speed = Math.max(0, steady * (1 + c[GUST] * g));
    const angle = st.angle + wander * fbm1(st.time / 70, seed + 5);
    const w = now.wind;
    w.steady = steady; w.speed = speed; w.gust = steady > 0 ? speed / steady - 1 : 0; w.angle = ((angle % 360) + 360) % 360;
    w.dir[0] = Math.cos(angle * DEG); w.dir[1] = Math.sin(angle * DEG);
    w.x = w.dir[0] * speed; w.y = w.dir[1] * speed;
    now.wetness = st.wet; now.snowCover = st.cover;
    now.flash = flashOf(st.lightning);
    now.visibility = 1 / (1 / 20000 + c[FOG] * c[FOG] / 9 + c[RAIN] / 90 + c[SNOW] / 45);
    now.sun = clamp(1 - 0.82 * Math.pow(c[CLOUD], 1.3));
    now.fill = clamp(1 - 0.4 * c[CLOUD] - 0.15 * now.intensity);
    return now;
  }

  const weather = {
    /** The sample: ONE object, refilled by every step. Copy the numbers you keep. */
    now,
    /** The kinds this weather knows (built-in and your own), by name. */
    kinds,
    get time() { return st.time; },
    get kind() { return st.kind; },
    get auto() { return st.auto; },
    set auto(on) { st.auto = on === true; if (st.auto && !(st.nextAt > st.time)) st.nextAt = st.time + spell(); },
    /** Seconds of play until the climate changes the weather (Infinity when auto is off). */
    get nextChangeIn() { return st.auto ? Math.max(0, st.nextAt - st.time) : Infinity; },
    /**
     * Move the weather on by dt seconds of play. Call once per update.
     * @returns {object} weather.now
     */
    step(dt) {
      if (!(typeof dt === 'number' && dt >= 0 && Number.isFinite(dt))) throw new Error(`weather.step: dt must be seconds, 0 or more, got ${JSON.stringify(dt)}`);
      st.time += dt;
      if (st.auto && st.time >= st.nextAt) { weather.set(pickKind(climate, st.kind, rng)); st.nextAt = st.time + spell(); }
      if (st.t < st.len) {
        st.t = st.t + dt > st.len - 1e-7 ? st.len : st.t + dt; // sums of small steps land a hair short
        const k = smooth(st.t / st.len);
        for (let i = 0; i < N; i++) st.cur[i] = lerp(st.a[i], st.b[i], k);
        if (st.t >= st.len) { for (let i = 0; i < N; i++) st.cur[i] = st.b[i]; emit('settled', { kind: st.kind }); }
      }
      const c = st.cur;
      // the ground: rain wets it, wind and time dry it; snow lies, then melts (faster in rain)
      st.wet = clamp(st.wet + dt * (c[RAIN] > 0.02 ? c[RAIN] / 45 : -(1 + c[WIND]) / 150));
      st.cover = clamp(st.cover + dt * (c[SNOW] > 0.02 ? c[SNOW] / 120 : -1 / 300 - c[RAIN] / 40));
      const d = ((st.angleTo - st.angle + 540) % 360) - 180;
      st.angle += clamp(d, -turn * dt, turn * dt);
      stepLightning(st.lightning, dt, c[STORM], rng, emit);
      const before = st.precip;
      fill();
      if (now.precip !== before) { st.precip = now.precip; emit('precip', { precip: now.precip, previous: before }); }
      return now;
    },
    /**
     * Change the weather. It eases there from whatever the air is doing now.
     * @param {string|object} kind  A kind name, or channel numbers such as { cloud: 1, rain: 0.4, wind: 0.5 }.
     * @param {{seconds?:number, instant?:boolean}} [opts]  How long the change takes (default: the `transition` option).
     */
    set(kind, opts = {}) {
      const [name, target] = targetOf(kind, 'weather.set');
      const seconds = opts.instant ? 0 : opts.seconds ?? transition;
      if (!(seconds >= 0)) throw new Error(`weather.set: "seconds" must be 0 or more, got ${JSON.stringify(opts.seconds)}`);
      const from = st.kind;
      st.from = from; st.kind = name;
      st.a = st.cur.slice(); st.b = target; st.t = 0; st.len = seconds;
      if (seconds === 0) st.cur = target.slice();
      fill();
      emit('change', { kind: name, from, seconds });
      if (seconds === 0) emit('settled', { kind: name });
      return weather;
    },
    /** Turn the wind to blow toward `angle` degrees (0 along +x, 90 along +y). It swings round at the `turn` rate. */
    setWind(angle) {
      if (!Number.isFinite(angle)) throw new Error(`weather.setWind: angle must be degrees, got ${JSON.stringify(angle)}`);
      st.angleTo = ((angle % 360) + 360) % 360;
    },
    /** Use another climate for auto weather: a name or { hours, weights }. */
    setClimate(c) { climate = climateOf(c, 'weather.setClimate'); st.climate = c; if (st.auto) st.nextAt = st.time + spell(); },
    /** Set how wet (0..1) and how snowy (0..1) the ground is, for a scene that starts after rain. */
    setGround(wetness, snowCover = st.cover) { st.wet = clamp(wetness); st.cover = clamp(snowCover); fill(); },
    /** Listen: 'change' { kind, from, seconds }, 'settled' { kind }, 'precip' { precip, previous },
     *  'lightning' { distance, bearing, power }, 'thunder' { distance, power, delay }. Returns a function that stops it. */
    on(name, fn) {
      if (!['change', 'settled', 'precip', 'lightning', 'thunder'].includes(name)) throw new Error(`weather.on: unknown event ${JSON.stringify(name)} (events: change, settled, precip, lightning, thunder)`);
      if (typeof fn !== 'function') throw new Error(`weather.on: the listener for '${name}' must be a function`);
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
      return () => { const l = listeners.get(name); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
    },
    /** Everything needed to carry on later, as plain data. */
    save() { return JSON.parse(JSON.stringify({ v: 1, ...st })); },
    /** Take up a save() again. No events are sent. */
    load(data) {
      if (!data || data.v !== 1 || !Array.isArray(data.cur) || data.cur.length !== N) throw new Error(`weather.load: expected data from weather.save(), got ${JSON.stringify(data)?.slice(0, 80)}`);
      const next = JSON.parse(JSON.stringify(data)); delete next.v;
      if (typeof next.climate === 'string' || next.climate) climate = climateOf(next.climate, 'weather.load');
      Object.assign(st, next);
      fill();
      return weather;
    },
  };
  fill();
  return weather;
}
