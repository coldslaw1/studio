// A field of stars that turns with the night. The same stars every time for a seed. A renderer
// asks where each star is now and how bright; the sample's `stars` (0..1) says how visible they are.
const TILT = 0.75; // how far the pole the stars turn about leans from straight up, in radians

/**
 * @param {object} [o]
 * @param {number} [o.count]  How many stars (default 240).
 * @param {number} [o.seed]   Which sky (default 1).
 * @returns {{count:number, brightness:Float32Array, at:Function, visible:Function}}
 */
export function createStars(o = {}) {
  const count = o.count ?? 240;
  if (!(Number.isInteger(count) && count > 0 && count <= 20000)) throw new Error(`createStars: "count" must be a whole number from 1 to 20000, got ${JSON.stringify(o.count)}`);
  let s = ((o.seed ?? 1) * 2654435761) >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const home = new Float32Array(count * 3); // each star's place on the turning sphere
  const brightness = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1; const a = rnd() * Math.PI * 2; const r = Math.sqrt(1 - z * z);
    home[i * 3] = r * Math.cos(a); home[i * 3 + 1] = r * Math.sin(a); home[i * 3 + 2] = z;
    brightness[i] = 0.25 + 0.75 * rnd() ** 3; // a few bright ones, many faint
  }
  const ct = Math.cos(TILT); const st = Math.sin(TILT);
  return {
    count,
    /** How bright each star is, 0.25..1. */
    brightness,
    /**
     * Where star i is for a sample of the sky: writes the unit direction [x, y, z] (z up) into out and
     * returns it. Below the horizon when out[2] < 0. The whole field turns once a game day.
     */
    at(sample, i, out = [0, 0, 0]) {
      if (!(i >= 0 && i < count)) throw new Error(`stars.at: no star ${i} (there are ${count})`);
      const turn = (sample.day + sample.hour / 24) * Math.PI * 2;
      const c = Math.cos(turn); const sn = Math.sin(turn);
      const x = home[i * 3] * c - home[i * 3 + 1] * sn; const y = home[i * 3] * sn + home[i * 3 + 1] * c; const z = home[i * 3 + 2];
      out[0] = x; out[1] = y * ct - z * st; out[2] = y * st + z * ct; // lean the pole
      return out;
    },
    /** How brightly star i shows for a sample, 0..1: nothing by day, less under a bright moon. */
    visible(sample, i) { return sample.stars * brightness[i] * (1 - 0.35 * sample.moonlight); },
  };
}
