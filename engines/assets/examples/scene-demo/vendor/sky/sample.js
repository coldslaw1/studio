// One sample of the sky: everything a renderer, a game rule or an NPC needs to know about one
// moment. skyAt fills a sample in place, so a game can take one every tick without making garbage.
import { warpHours, kilnHourOf, sunAt, moonAt, moonPhaseAt, twilightOf, partOfDay } from './orbit.js';
import { paletteAt, hexRgb, HANDOVER } from './palette.js';

const DEG = 180 / Math.PI;
const fail = (msg) => { throw new Error(msg); };
const num = (v, d, name, lo, hi) => {
  const x = v ?? d;
  if (!(typeof x === 'number' && x >= lo && x <= hi)) fail(`createSky: "${name}" must be a number from ${lo} to ${hi}, got ${JSON.stringify(v)}`);
  return x;
};

/**
 * Check and complete the settings of a sky. Used by createSky; see its options.
 * @returns {object} cfg  Plain numbers and colours, never changed afterwards.
 */
export function skyConfig(o = {}) {
  if (typeof o !== 'object' || o === null) fail(`createSky: options must be an object, got ${JSON.stringify(o)}`);
  const sunrise = num(o.sunrise, 5.75, 'sunrise', 1, 12); const sunset = num(o.sunset, 19.5, 'sunset', 12, 22.5);
  if (sunset - sunrise < 8) fail(`createSky: the day from sunrise ${sunrise} to sunset ${sunset} must be at least 8 hours long`);
  const lt = o.light ?? [1, 0.4, 1];
  if (!(Array.isArray(lt) && lt.length >= 3 && lt.slice(0, 3).every(Number.isFinite) && lt[2] > 0)) fail(`createSky: "light" must be [x, y, z] toward the noon sun with z above 0 (a Kiln scene's "light"), got ${JSON.stringify(o.light)}`);
  const ll = Math.hypot(lt[0], lt[1], lt[2]);
  const noonAltitude = num(o.noonAltitude, Math.asin(Math.max(0.05, lt[2] / ll)) * DEG, 'noonAltitude', 10, 90);
  const m = o.moon ?? {};
  const moonDays = num(m.days, 8, 'moon.days', 1, 1e12);
  const dayLength = num(o.dayLength, 1200, 'dayLength', 1, 1e9);
  const startHour = num(o.startHour, 8, 'startHour', 0, 24);
  const colors = o.colors ?? {};
  return {
    dayLength, startHour, sunrise, sunset, noonAltitude,
    noonAzimuth: num(o.noonAzimuth, Math.atan2(lt[1], lt[0]) * DEG, 'noonAzimuth', -360, 360),
    swing: num(o.swing, 72.5, 'swing', 0, 120),
    nightDepth: num(o.nightDepth, noonAltitude * (24 - (sunset - sunrise)) / (sunset - sunrise), 'nightDepth', 6, 90),
    // by default the first midnight of the game has a full moon, like the night Kiln bakes
    moonDays, moonPhase: num(m.phase, ((0.5 - (24 - startHour) / 24 / moonDays) % 1 + 1) % 1, 'moon.phase', 0, 1),
    moonAltitude: num(m.altitude, 52, 'moon.altitude', 5, 90), moonTurn: num(m.turn, 140, 'moon.turn', -360, 360), moonSwing: num(m.swing, 60, 'moon.swing', 0, 120),
    minAltitude: num(o.minAltitude, 8, 'minAltitude', 3, 30),
    day: { sun: hexRgb(colors.sun ?? '#fff2d6', 'createSky colors.sun'), sky: hexRgb(colors.sky ?? '#a8bce8', 'createSky colors.sky') },
    hours: warpHours(sunrise, sunset),
  };
}

const body = () => ({ dir: [0, 0, 1], altitude: 0, azimuth: 0, up: false });

/** An empty sample for skyAt to fill. See the README ("The sample") for every field. */
export function createSample() {
  return {
    time: 0, day: 0, hour: 0, kilnHour: 0, part: 'day', twilight: 'day',
    sunrise: 0, sunset: 0,
    sun: body(),
    moon: { ...body(), phase: 0, lit: 0, waxing: true, name: 'new', rise: 0, set: 0 },
    light: { dir: [0, 0, 1], color: [1, 1, 1], power: 1, source: 'sun' },
    fill: { color: [1, 1, 1], power: 1 },
    skyTop: [0, 0, 0], skyBottom: [0, 0, 0], fogColor: [0, 0, 0],
    dark: 0, stars: 0, moonlight: 0, lamps: 0, lampsOn: false, tone: [1, 1, 1],
  };
}

/**
 * The sky at a time. Pure: the same cfg and time always give the same sample.
 * @param {object} cfg    From skyConfig.
 * @param {number} time   Seconds of game time since the game began.
 * @param {object} [out]  A sample to fill (from createSample); a new one is made when left out.
 * @returns {object} out
 */
export function skyAt(cfg, time, out = createSample()) {
  const days = time / cfg.dayLength + cfg.startHour / 24; // game days since midnight before the start
  const day = Math.floor(days); const hour = (days - day) * 24;
  const k = kilnHourOf(cfg.hours, hour);
  out.time = time; out.day = day; out.hour = hour; out.kilnHour = k;
  out.sunrise = cfg.sunrise; out.sunset = cfg.sunset;
  sunAt(cfg, hour, out.sun);
  const moon = moonAt(cfg, hour, moonPhaseAt(cfg, time / cfg.dayLength), out.moon);
  // moonlight: a full moon well above the horizon is 1; it fades with the phase and as the moon sinks
  const moonlight = moon.up ? moon.lit * Math.min(1, moon.altitude / 15) : 0;
  out.moonlight = moonlight;
  paletteAt(k, cfg.day, moonlight, out);
  // The light that casts shadows: the sun by day, the moon by night. Never lower than minAltitude,
  // or shadows would stretch across the whole land. With no moon up the faint night light keeps
  // the direction Kiln's night pictures are baked with.
  const L = out.light.dir; const sunny = k > HANDOVER[0] && k < HANDOVER[1];
  out.light.source = sunny ? 'sun' : 'moon';
  const from = sunny ? out.sun : moon;
  const alt = sunny || moon.up ? Math.max(cfg.minAltitude, from.altitude) : cfg.moonAltitude;
  const az = sunny || moon.up ? from.azimuth : cfg.noonAzimuth + cfg.moonTurn;
  const ca = Math.cos(alt / DEG);
  L[0] = ca * Math.cos(az / DEG); L[1] = ca * Math.sin(az / DEG); L[2] = Math.sin(alt / DEG);
  out.part = partOfDay(k); out.twilight = twilightOf(out.sun.altitude);
  const d = out.dark;
  out.lamps = d; out.lampsOn = d > 0.425;
  const s = d <= 0.7 ? 0 : (d - 0.7) / 0.3; out.stars = s * s * (3 - 2 * s);
  return out;
}
