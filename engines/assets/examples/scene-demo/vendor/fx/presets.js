// The built-in effects: how each one moves. How it looks (glyphs and colours) comes from the
// style (styles.js), so the same 'smoke' is soft in storybook and coarse in crypt.
// Units: metres and seconds. z is up.

const DEFAULTS = {
  count: 8,            // particles in one burst at Detail 'medium'
  rate: 20,            // particles per second from an emitter at Detail 'medium'
  speed: [1, 2],       // metres per second, picked between the two
  life: [0.4, 0.8],    // seconds
  dir: [0, 0, 1],      // the middle of the spray (a burst may pass its own)
  spread: Math.PI,     // half angle of the spray in radians: 0 = a line, PI/2 = half a ball, PI = every way
  radius: 0,           // particles start within this many metres of the point
  gravity: 0,          // metres per second squared pulling down; negative floats up
  drag: 0,             // share of speed lost per second
  wind: 0,             // share of the wind's speed it ends up drifting at, 0..1 (needs drag above 0)
  size: 0,             // metres across at birth; 0 = always one character cell
  grow: 0,             // metres per second the size grows
  ground: null,        // at z = 0: 'bounce', 'die', 'rest' or null (falls through)
  bounce: 0.4,
  streak: false,       // young particles draw as - / | \ along their path
  twinkle: false,      // glyph flickers
  important: false,    // takes a slot from an older particle when the budget is full
  layer: 1,            // which wins a shared cell: higher draws over lower
  look: null,          // name of the style look to use (default: the preset's own name)
};

/** The built-in presets by name. */
export const PRESETS = Object.freeze({
  spark: { count: 10, speed: [2.5, 6], life: [0.18, 0.45], spread: 1.1, gravity: 9, drag: 1.5, ground: 'bounce', streak: true, important: true, layer: 3 },
  ember: { count: 6, rate: 8, speed: [0.3, 1], life: [0.8, 1.8], spread: 0.7, radius: 0.15, gravity: -0.8, drag: 0.8, wind: 0.5, twinkle: true, layer: 2 },
  smoke: { count: 5, rate: 7, speed: [0.15, 0.5], life: [1.2, 2.4], spread: 0.5, radius: 0.1, gravity: -0.6, drag: 1.2, wind: 1, size: 0.35, grow: 0.45, layer: 0 },
  dust: { count: 5, rate: 12, speed: [0.5, 1.5], life: [0.35, 0.7], dir: [0, 0, 0.25], spread: 1.45, gravity: 0.5, drag: 4, wind: 0.5, size: 0.25, grow: 0.3, ground: 'rest', layer: 0 },
  magic: { count: 8, rate: 30, speed: [0.1, 0.5], life: [0.4, 0.9], radius: 0.06, gravity: -0.2, drag: 2, twinkle: true, important: true, layer: 3 },
  splash: { count: 8, speed: [1.5, 3.5], life: [0.3, 0.6], spread: 0.8, gravity: 9, drag: 0.5, ground: 'die', layer: 2 },
  poof: { count: 14, speed: [0.8, 2.2], life: [0.4, 0.9], radius: 0.15, gravity: -0.3, drag: 3.5, size: 0.3, grow: 0.5, layer: 1 },
  sparkle: { count: 6, rate: 10, speed: [0.4, 1.2], life: [0.4, 0.8], spread: 0.9, radius: 0.2, gravity: -0.5, drag: 2.5, twinkle: true, layer: 3 },
});

/** Names of the built-in presets. */
export const PRESET_NAMES = Object.freeze(Object.keys(PRESETS));

const pair = (v, name, key) => {
  const p = typeof v === 'number' ? [v, v] : v;
  if (!Array.isArray(p) || p.length !== 2 || !(p[0] >= 0) || !(p[1] >= p[0])) throw new Error(`fx.define: '${name}' ${key} must be a number or [low, high] with 0 <= low <= high, got ${JSON.stringify(v)}`);
  return p;
};

/**
 * makePreset(name, def, from) -> a complete, checked preset. `def` is laid over `from`
 * (another complete preset) or over the defaults.
 */
export function makePreset(name, def = {}, from = null) {
  if (typeof name !== 'string' || !name) throw new Error(`fx.define: name must be a non-empty string, got ${JSON.stringify(name)}`);
  if (def === null || typeof def !== 'object' || Array.isArray(def)) throw new Error(`fx.define: the preset for '${name}' must be an object, got ${JSON.stringify(def)}`);
  for (const key of Object.keys(def)) if (!(key in DEFAULTS) && key !== 'extends') throw new Error(`fx.define: '${name}' has an unknown field '${key}' (fields: ${Object.keys(DEFAULTS).join(', ')}, extends)`);
  const p = { ...(from ?? DEFAULTS), ...def, name };
  delete p.extends;
  p.speed = pair(p.speed, name, 'speed'); p.life = pair(p.life, name, 'life');
  if (!(p.life[0] > 0)) throw new Error(`fx.define: '${name}' life must be above 0, got ${JSON.stringify(def.life)}`);
  if (!Array.isArray(p.dir) || p.dir.length !== 3 || !p.dir.every(Number.isFinite) || Math.hypot(...p.dir) === 0) throw new Error(`fx.define: '${name}' dir must be [x, y, z] and not all zero, got ${JSON.stringify(p.dir)}`);
  for (const key of ['count', 'rate', 'spread', 'radius', 'drag', 'wind', 'size', 'bounce', 'layer']) if (!(p[key] >= 0)) throw new Error(`fx.define: '${name}' ${key} must be 0 or more, got ${JSON.stringify(p[key])}`);
  for (const key of ['gravity', 'grow']) if (!Number.isFinite(p[key])) throw new Error(`fx.define: '${name}' ${key} must be a number, got ${JSON.stringify(p[key])}`);
  if (![null, 'bounce', 'die', 'rest'].includes(p.ground)) throw new Error(`fx.define: '${name}' ground must be 'bounce', 'die', 'rest' or null, got ${JSON.stringify(p.ground)}`);
  p.look = p.look ?? (from && !def.look ? from.look : null) ?? name;
  return p;
}
