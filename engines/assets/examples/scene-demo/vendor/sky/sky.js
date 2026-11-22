// The sky of a game: one clock of game time, and what the sun, the moon and the light are doing
// at that time. Step it from the game's update; read `sky.now`; hand that to the views.
import { skyConfig, createSample, skyAt } from './sample.js';

const EVENTS = ['sunrise', 'sunset', 'lampsOn', 'lampsOff', 'hour', 'day', 'part', 'moon'];
const LAMPS_ON = 0.5; const LAMPS_OFF = 0.35; // darkness at which lamps light and go out (apart, so they never flutter)

/**
 * @param {object} [options]
 * @param {number} [options.dayLength]  Seconds of play in one game day (default 1200, the ai engine's default).
 * @param {number} [options.startHour]  Hour of the day when the game begins (default 8, the ai engine's default).
 * @param {number} [options.sunrise]    Hour the sun rises (default 5.75). With the defaults a game hour looks exactly like the same Kiln hour.
 * @param {number} [options.sunset]     Hour the sun sets (default 19.5).
 * @param {number[]} [options.light]    The scene's own "light": [x, y, z] toward the noon sun (default [1, 0.4, 1]). The sun passes through it at noon.
 * @param {number} [options.swing]      Degrees the sun swings to each side of noon between rising and setting (default 72.5).
 * @param {{sun?:string, sky?:string}} [options.colors]  Daytime light and sky-fill colours (default Kiln's '#fff2d6' and '#a8bce8').
 * @param {{days?:number, phase?:number, altitude?:number, turn?:number, swing?:number}} [options.moon]  days: game days from one new moon
 *   to the next (default 8). phase: where the moon is in that at time 0 (0 new, 0.5 full; default: full on the first midnight).
 *   altitude: how high it climbs (default 52). turn: compass turn from the noon sun to where it stands highest (default 140).
 * @param {number} [options.rate]       Game seconds per second of play (default 1). 0 stops the sky.
 * @param {number} [options.time]       Seconds of game time already played (default 0).
 * @returns {object} sky
 */
export function createSky(options = {}) {
  const cfg = skyConfig(options);
  let rate = options.rate ?? 1;
  if (!(rate >= 0)) throw new Error(`createSky: "rate" must be 0 or more, got ${JSON.stringify(options.rate)}`);
  let time = options.time ?? 0;
  if (!Number.isFinite(time)) throw new Error(`createSky: "time" must be a number of seconds, got ${JSON.stringify(options.time)}`);
  const now = skyAt(cfg, time);
  let lampsOn = now.dark > (LAMPS_ON + LAMPS_OFF) / 2;
  now.lampsOn = lampsOn;
  const listeners = new Map(EVENTS.map((e) => [e, []]));
  const emit = (name, value) => { const l = listeners.get(name); for (let i = 0; i < l.length; i++) l[i](value, now); };
  const daysOf = (t) => t / cfg.dayLength + cfg.startHour / 24;

  /** Work out `now` for the new time and tell the listeners what happened on the way there. */
  function move(next, quiet) {
    const before = daysOf(time); const after = daysOf(next);
    const hour0 = Math.floor(before * 24); const part0 = now.part; const moon0 = now.moon.name;
    time = next;
    skyAt(cfg, time, now);
    const turnOn = !lampsOn && now.dark > LAMPS_ON; const turnOff = lampsOn && now.dark < LAMPS_OFF;
    if (turnOn) lampsOn = true; else if (turnOff) lampsOn = false;
    now.lampsOn = lampsOn;
    if (quiet) return;
    // did the hour pass a time of day (which comes once every game day)?
    const passed = (h) => Math.floor(after - h / 24) > Math.floor(before - h / 24);
    if (passed(cfg.sunrise)) emit('sunrise', now.day);
    if (passed(cfg.sunset)) emit('sunset', now.day);
    if (turnOn) emit('lampsOn', now.hour); else if (turnOff) emit('lampsOff', now.hour);
    const hour1 = Math.floor(after * 24);
    if (hour1 !== hour0) emit('hour', ((hour1 % 24) + 24) % 24);
    if (Math.floor(after) !== Math.floor(before)) emit('day', now.day);
    if (now.part !== part0) emit('part', now.part);
    if (now.moon.name !== moon0) emit('moon', now.moon.name);
  }

  const sky = {
    /** The settings in use (plain data; do not change them: only setMoonPhase moves config.moonPhase). */
    config: cfg,
    /** The sky right now: ONE object, filled again on every step. Read it, do not keep it; copy what must last. */
    now,
    /** Seconds of game time played. */
    get time() { return time; },
    /** Hour of the day, 0..24. */
    get hour() { return now.hour; },
    /** Whole game days since the midnight before the game began. */
    get day() { return now.day; },
    /** Game seconds per second of play. 0 stops the sky, 60 makes a minute pass every second. */
    get rate() { return rate; },
    set rate(v) { if (!(v >= 0)) throw new Error(`sky.rate: expected 0 or more, got ${JSON.stringify(v)}`); rate = v; },
    /** Move game time on by dt seconds of play (times `rate`). Call once per update. Returns `now`. */
    step(dt) {
      if (!(dt >= 0)) throw new Error(`sky.step: dt must be seconds, 0 or more, got ${JSON.stringify(dt)}`);
      if (dt > 0 && rate > 0) move(time + dt * rate, false);
      return now;
    },
    /** Jump to a time in seconds of game time. No events are sent for what was skipped. */
    setTime(seconds) {
      if (!Number.isFinite(seconds)) throw new Error(`sky.setTime: expected seconds, got ${JSON.stringify(seconds)}`);
      move(seconds, true);
      lampsOn = now.dark > (LAMPS_ON + LAMPS_OFF) / 2; now.lampsOn = lampsOn;
      return sky;
    },
    /**
     * Jump FORWARD to the next time the clock shows `hour` (0..24), so days and the moon never run
     * backwards. sky.setHour(sky.hour) stays put. No events are sent for what was skipped.
     */
    setHour(hour) {
      if (!(Number.isFinite(hour) && hour >= 0 && hour <= 24)) throw new Error(`sky.setHour: hour must be from 0 to 24, got ${JSON.stringify(hour)}`);
      const ahead = ((hour - now.hour) % 24 + 24) % 24;
      return sky.setTime(time + (ahead < 1e-9 ? 0 : ahead) / 24 * cfg.dayLength);
    },
    /** Let `hours` game hours pass at once, sending the events on the way (sleeping in a bed, waiting). */
    advance(hours) {
      if (!(hours >= 0)) throw new Error(`sky.advance: hours must be 0 or more, got ${JSON.stringify(hours)}`);
      for (let left = hours; left > 1e-9; left -= 0.5) move(time + Math.min(0.5, left) / 24 * cfg.dayLength, false);
      return now;
    },
    /**
     * Put the moon at a phase now (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter); it goes on from
     * there. For a fixed "night" preset that should look like the baked night: setHour(0.6), setMoonPhase(0.5).
     */
    setMoonPhase(phase) {
      if (!(Number.isFinite(phase) && phase >= 0 && phase <= 1)) throw new Error(`sky.setMoonPhase: phase must be from 0 to 1, got ${JSON.stringify(phase)}`);
      cfg.moonPhase = ((phase - time / cfg.dayLength / cfg.moonDays) % 1 + 1) % 1;
      move(time, true);
      return sky;
    },
    /** The sky at any time (seconds of game time), without moving the clock: for previews, bakes and forecasts. Fills `out` when given. */
    at(seconds, out) {
      if (!Number.isFinite(seconds)) throw new Error(`sky.at: expected seconds of game time, got ${JSON.stringify(seconds)}`);
      return skyAt(cfg, seconds, out);
    },
    /** The game time (seconds) of the next moment the clock shows `hour`, counted from now. */
    timeOfNext(hour) { return time + (((hour - now.hour) % 24 + 24) % 24) / 24 * cfg.dayLength; },
    /**
     * Listen: 'sunrise' and 'sunset' (fn(day)), 'lampsOn' and 'lampsOff' (fn(hour)), 'hour' (fn(0..23)),
     * 'day' (fn(day)), 'part' (fn('night' | 'dawn' | 'day' | 'dusk')), 'moon' (fn(name of the phase)).
     * Every listener also gets `now` as its second argument. Returns a function that stops it.
     */
    on(name, fn) {
      const l = listeners.get(name);
      if (!l) throw new Error(`sky.on: unknown event "${name}" (use ${EVENTS.join(', ')})`);
      if (typeof fn !== 'function') throw new Error(`sky.on: the listener for "${name}" must be a function`);
      l.push(fn);
      return () => { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
    },
    /** Plain data to keep in a save: { v, time, rate, moonPhase }. */
    save: () => ({ v: 1, time, rate, moonPhase: cfg.moonPhase }),
    /** Take up a save made by save(). */
    load(data) {
      if (!data || data.v !== 1 || !Number.isFinite(data.time)) throw new Error(`sky.load: expected what sky.save() returned, got ${JSON.stringify(data)}`);
      if (data.rate >= 0) rate = data.rate;
      if (data.moonPhase >= 0 && data.moonPhase <= 1) cfg.moonPhase = data.moonPhase;
      return sky.setTime(data.time);
    },
  };
  return sky;
}
