// The particle pool: every particle lives in a few flat number arrays made once, so spawning and
// stepping never allocate. Live particles are kept packed at the front (0 .. n-1).

/** The most particles the engine ever holds (Detail 'high'). Lower Detail uses less of the pool. */
export const POOL_SIZE = 900;

/** A small seeded random source (mulberry32): rng() -> float in [0, 1). */
export function createRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * createPool(size) -> pool
 *   n      live particles
 *   cap    how many may be alive at once (set from Detail; at most size)
 *   x y z  metres: x and y on the ground, z above it      vx vy vz  metres per second
 *   age life  seconds      size  metres across (0 = always one cell)      seed  0..1, fixed per particle
 *   def    index of the preset      sx sy  where it was last drawn (NaN before the first picture)
 */
export function createPool(size = POOL_SIZE) {
  const f = () => new Float32Array(size);
  return { size, n: 0, cap: size, cursor: 0, x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(), age: f(), life: f(), size_: f(), seed: f(), sx: f(), sy: f(), def: new Uint8Array(size) };
}

/**
 * allocSlot(pool, important) -> slot index, or -1 when the pool is full and the particle may be dropped.
 * An important particle (hit sparks, magic) takes over a slot in turn when the pool is full.
 */
export function allocSlot(pool, important) {
  if (pool.n < pool.cap) return pool.n++;
  if (!important || pool.cap === 0) return -1;
  pool.cursor = (pool.cursor + 1) % pool.cap;
  return pool.cursor;
}

function move(p, from, to) {
  p.x[to] = p.x[from]; p.y[to] = p.y[from]; p.z[to] = p.z[from];
  p.vx[to] = p.vx[from]; p.vy[to] = p.vy[from]; p.vz[to] = p.vz[from];
  p.age[to] = p.age[from]; p.life[to] = p.life[from]; p.size_[to] = p.size_[from]; p.seed[to] = p.seed[from];
  p.sx[to] = p.sx[from]; p.sy[to] = p.sy[from]; p.def[to] = p.def[from];
}

/**
 * stepPool(pool, defs, dt, wind) -> live count. Ages, moves and retires particles.
 *   defs  presets by index: { gravity, drag, wind, grow, ground ('bounce' | 'die' | 'rest' | null), bounce }
 *   wind  { x, y } metres per second
 */
export function stepPool(pool, defs, dt, wind) {
  const p = pool;
  let i = 0;
  while (i < p.n) {
    const age = p.age[i] + dt;
    if (age >= p.life[i]) { p.n--; if (i < p.n) move(p, p.n, i); continue; }
    p.age[i] = age;
    const d = defs[p.def[i]];
    let vx = p.vx[i]; let vy = p.vy[i]; let vz = p.vz[i] - d.gravity * dt;
    const keep = Math.max(0, 1 - d.drag * dt);
    const wx = wind.x * d.wind; const wy = wind.y * d.wind; // drag pulls toward the moving air, so wind carries what it slows
    vx = wx + (vx - wx) * keep; vy = wy + (vy - wy) * keep; vz *= keep;
    p.x[i] += vx * dt; p.y[i] += vy * dt;
    let z = p.z[i] + vz * dt;
    if (z < 0 && d.ground) {
      if (d.ground === 'die') { p.n--; if (i < p.n) move(p, p.n, i); continue; }
      z = d.ground === 'bounce' ? -z * d.bounce : 0;
      vz = d.ground === 'bounce' ? -vz * d.bounce : 0;
      vx *= 0.6; vy *= 0.6;
    }
    p.z[i] = z; p.vx[i] = vx; p.vy[i] = vy; p.vz[i] = vz;
    if (d.grow) p.size_[i] += d.grow * dt;
    i++;
  }
  return p.n;
}
