// Where the sun and the moon are. Not astronomy: a game sky that is tuned so its noon, dawn, dusk
// and night agree with Kiln's baked times of day (scene-sky.js in the assets engine), and that is
// smooth everywhere in between. Angles in degrees, directions as unit vectors [x, y, z] in ground
// coordinates (z up), pointing from the ground TOWARD the sun or moon. Pure, no allocation.
const RAD = Math.PI / 180;

/** Hours of Kiln's own time-of-day table that the day is stretched onto (see warpHours). */
export const KILN_HOURS = [0, 5, 6.5, 9, 16, 18.5, 20.5, 24];

/**
 * The game hours that stand for Kiln's table hours, for a day with this sunrise and sunset. With
 * sunrise 5.75 and sunset 19.5 they are Kiln's own hours, so the game hour IS the Kiln hour.
 * @returns {number[]} eight rising hours, 0 first and 24 last
 */
export function warpHours(sunrise, sunset) {
  return [0, sunrise - 0.75, sunrise + 0.75, sunrise + 3.25, sunset - 3.5, sunset - 1, sunset + 1, 24];
}

/** The Kiln hour (0..24) that looks like game hour `hour` (0..24). `hours` comes from warpHours. */
export function kilnHourOf(hours, hour) {
  let i = 0;
  while (i < 6 && hour >= hours[i + 1]) i++;
  return KILN_HOURS[i] + (KILN_HOURS[i + 1] - KILN_HOURS[i]) * (hour - hours[i]) / (hours[i + 1] - hours[i]);
}

function aim(out, altitude, azimuth) {
  const a = altitude * RAD; const z = azimuth * RAD; const c = Math.cos(a);
  out.altitude = altitude; out.azimuth = ((azimuth % 360) + 360) % 360; out.up = altitude > 0;
  out.dir[0] = c * Math.cos(z); out.dir[1] = c * Math.sin(z); out.dir[2] = Math.sin(a);
}

/**
 * The sun at an hour of the day. It rises at cfg.sunrise, stands highest (cfg.noonAltitude, at
 * compass angle cfg.noonAzimuth) half way to cfg.sunset, and swings cfg.swing degrees to either
 * side between rising and setting. At night it goes on round below the horizon.
 * @param {object} cfg  { sunrise, sunset, noonAltitude, noonAzimuth, swing, nightDepth }
 * @param {number} hour 0..24
 * @param {{dir:number[], altitude:number, azimuth:number, up:boolean}} out  Filled and returned.
 */
export function sunAt(cfg, hour, out) {
  const len = cfg.sunset - cfg.sunrise;
  if (hour >= cfg.sunrise && hour <= cfg.sunset) {
    const f = (hour - cfg.sunrise) / len;
    aim(out, cfg.noonAltitude * Math.sin(Math.PI * f), cfg.noonAzimuth + cfg.swing * (2 * f - 1));
  } else {
    const f = ((hour - cfg.sunset + 24) % 24) / (24 - len);
    aim(out, -cfg.nightDepth * Math.sin(Math.PI * f), cfg.noonAzimuth + cfg.swing + (360 - 2 * cfg.swing) * f);
  }
  return out;
}

/** How far through its month the moon is at a time in game days: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonPhaseAt(cfg, days) {
  const p = (cfg.moonPhase + days / cfg.moonDays) % 1;
  return p < 0 ? p + 1 : p;
}

export const MOON_NAMES = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full', 'waning gibbous', 'last quarter', 'waning crescent'];

/**
 * The moon at an hour of the day and a phase. A full moon stands highest at midnight, a new moon at
 * noon (with the sun), so it rises about 24 / cfg.moonDays hours later every day, like the real one.
 * @param {object} cfg  { sunrise, sunset, noonAzimuth, moonAltitude, moonTurn, moonSwing }
 * @param {number} hour   0..24
 * @param {number} phase  0..1 from moonPhaseAt
 * @param {object} out    Filled and returned: { dir, altitude, azimuth, up, phase, lit, waxing, name, rise, set }.
 *   lit: share of the disc that is bright, 0..1. rise and set: hours of the day.
 */
export function moonAt(cfg, hour, phase, out) {
  const noon = (cfg.sunrise + cfg.sunset) / 2;
  const top = noon + 24 * phase; // the hour it stands highest
  const t = ((hour - top) % 24 + 36) % 24 - 12; // hours since then, -12..12
  const base = cfg.noonAzimuth + cfg.moonTurn;
  const side = t < 0 ? -1 : 1; const far = Math.abs(t);
  aim(out, cfg.moonAltitude * Math.cos(Math.PI * t / 12), base + side * (far <= 6 ? cfg.moonSwing * far / 6 : cfg.moonSwing + (180 - cfg.moonSwing) * (far - 6) / 6));
  out.phase = phase; out.lit = (1 - Math.cos(2 * Math.PI * phase)) / 2; out.waxing = phase < 0.5;
  out.name = MOON_NAMES[Math.round(phase * 8) % 8];
  out.rise = ((top - 6) % 24 + 24) % 24; out.set = ((top + 6) % 24 + 24) % 24;
  return out;
}

/** 'day', 'civil', 'nautical', 'astronomical' or 'night' for a sun altitude in degrees (the usual 6 degree steps). */
export function twilightOf(altitude) {
  return altitude > 0 ? 'day' : altitude > -6 ? 'civil' : altitude > -12 ? 'nautical' : altitude > -18 ? 'astronomical' : 'night';
}

/** 'night', 'dawn', 'day' or 'dusk' for a Kiln hour: which of the four named times it is nearest in look. */
export function partOfDay(kilnHour) {
  return kilnHour < 5 || kilnHour >= 20.5 ? 'night' : kilnHour < 8 ? 'dawn' : kilnHour < 17.5 ? 'day' : 'dusk';
}
