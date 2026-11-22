// The kinds of weather and the climates that choose between them. A kind is nothing but target
// numbers for the seven channels; the engine eases from whatever the air is doing now to those
// numbers, so any kind can follow any other, also half-way through a change.

/** The channels of a kind, each 0..1, in the order the engine stores them. */
export const CHANNELS = Object.freeze(['cloud', 'rain', 'snow', 'fog', 'wind', 'gust', 'storm']);

/**
 * Built-in kinds. cloud: how covered the sky is. rain, snow: how hard it falls. fog: how thick.
 * wind: steady strength (1 = 24 m/s, a gale). gust: how unsteady the wind is. storm: lightning.
 */
export const KINDS = Object.freeze({
  clear: { cloud: 0.05, rain: 0, snow: 0, fog: 0, wind: 0.14, gust: 0.25, storm: 0 },
  cloudy: { cloud: 0.55, rain: 0, snow: 0, fog: 0, wind: 0.22, gust: 0.3, storm: 0 },
  overcast: { cloud: 0.9, rain: 0, snow: 0, fog: 0.05, wind: 0.26, gust: 0.3, storm: 0 },
  windy: { cloud: 0.35, rain: 0, snow: 0, fog: 0, wind: 0.72, gust: 0.75, storm: 0 },
  mist: { cloud: 0.45, rain: 0, snow: 0, fog: 0.42, wind: 0.06, gust: 0.1, storm: 0 },
  fog: { cloud: 0.65, rain: 0, snow: 0, fog: 0.88, wind: 0.04, gust: 0.1, storm: 0 },
  drizzle: { cloud: 0.75, rain: 0.25, snow: 0, fog: 0.1, wind: 0.18, gust: 0.25, storm: 0 },
  rain: { cloud: 0.9, rain: 0.62, snow: 0, fog: 0.15, wind: 0.34, gust: 0.4, storm: 0 },
  storm: { cloud: 1, rain: 1, snow: 0, fog: 0.2, wind: 0.8, gust: 0.9, storm: 1 },
  snow: { cloud: 0.85, rain: 0, snow: 0.5, fog: 0.15, wind: 0.16, gust: 0.25, storm: 0 },
  blizzard: { cloud: 1, rain: 0, snow: 1, fog: 0.55, wind: 0.9, gust: 0.8, storm: 0 },
});

/** Names of the built-in kinds. */
export const KIND_NAMES = Object.freeze(Object.keys(KINDS));

/**
 * Climates for `auto` weather: how likely each kind is to come next (any numbers; they are
 * weighed against each other) and how long a spell lasts, in game hours [shortest, longest].
 * The kind that is on now is never chosen again straight away.
 */
export const CLIMATES = Object.freeze({
  temperate: { hours: [2, 7], weights: { clear: 5, cloudy: 4, overcast: 2, windy: 1.5, mist: 1, fog: 0.8, drizzle: 1.5, rain: 2, storm: 0.8 } },
  wet: { hours: [1.5, 5], weights: { cloudy: 2, overcast: 3, mist: 1.5, fog: 1.5, drizzle: 3, rain: 4, storm: 2, clear: 1 } },
  dry: { hours: [4, 12], weights: { clear: 9, cloudy: 2, windy: 3, storm: 0.3 } },
  alpine: { hours: [2, 6], weights: { clear: 3, cloudy: 3, overcast: 2, windy: 2, fog: 1, snow: 4, blizzard: 1.5 } },
  winter: { hours: [2, 8], weights: { clear: 2, cloudy: 3, overcast: 3, mist: 1, fog: 1, snow: 5, blizzard: 1 } },
});

/** Names of the built-in climates. */
export const CLIMATE_NAMES = Object.freeze(Object.keys(CLIMATES));

/**
 * Check a kind's numbers and fill in the missing channels with 0 (gust with 0.3).
 * @param {object} values  { cloud, rain, snow, fog, wind, gust, storm }, each 0..1.
 * @param {string} who     Name for the error message.
 * @returns {number[]} the channels in CHANNELS order
 */
export function channelsOf(values, who) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new Error(`${who}: a kind must be an object like { cloud: 0.9, rain: 0.6 }, got ${JSON.stringify(values)}`);
  for (const k of Object.keys(values)) if (!CHANNELS.includes(k)) throw new Error(`${who}: unknown channel "${k}" (channels: ${CHANNELS.join(', ')})`);
  return CHANNELS.map((c) => {
    const v = values[c] ?? (c === 'gust' ? 0.3 : 0);
    if (!(typeof v === 'number' && v >= 0 && v <= 1)) throw new Error(`${who}: "${c}" must be a number from 0 to 1, got ${JSON.stringify(values[c])}`);
    return v;
  });
}

/**
 * Pick the next kind of a climate.
 * @param {{weights:object}} climate
 * @param {string} current   The kind that is on (left out of the draw).
 * @param {() => number} rng
 * @returns {string}
 */
export function pickKind(climate, current, rng) {
  const names = Object.keys(climate.weights).filter((k) => k !== current && climate.weights[k] > 0);
  if (!names.length) return current;
  let total = 0;
  for (const k of names) total += climate.weights[k];
  let at = rng() * total;
  for (const k of names) { at -= climate.weights[k]; if (at < 0) return k; }
  return names[names.length - 1];
}
