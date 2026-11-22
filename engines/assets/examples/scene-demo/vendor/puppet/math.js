// Small maths kit: 3D vectors as [x, y, z], 3x3 rotation matrices as 9 numbers (row by row),
// easing curves and frame-rate independent smoothing.
//
// Space used by every rig: z is up, the character faces -y, its left side is +x.
// Angles are in degrees everywhere in the public API.

export const DEG = Math.PI / 180;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Matrix product a x b. */
export function mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

/** Matrix times vector. */
export const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

/** Inverse rotation (transpose) times vector. */
export const unapply = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

/** Rotation about the up axis. Positive turns the character to its left (counter-clockwise from above). */
export function rotZ(deg) {
  const c = Math.cos(deg * DEG); const s = Math.sin(deg * DEG);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/**
 * Bone rotation from three angles in degrees: rx (pitch) first, then ry (roll), then rz (twist).
 * rx > 0 swings a hanging limb forward (and tips an upright bone such as the head backward).
 * ry > 0 swings a hanging limb toward -x, the character's right. rz > 0 twists to the character's left.
 */
export function euler(rx = 0, ry = 0, rz = 0) {
  const a = -rx * DEG; const b = ry * DEG; const g = rz * DEG;
  const ca = Math.cos(a); const sa = Math.sin(a); const cb = Math.cos(b); const sb = Math.sin(b); const cg = Math.cos(g); const sg = Math.sin(g);
  // Rz * Ry * Rx
  return [
    cg * cb, cg * sb * sa - sg * ca, cg * sb * ca + sg * sa,
    sg * cb, sg * sb * sa + cg * ca, sg * sb * ca - cg * sa,
    -sb, cb * sa, cb * ca,
  ];
}

/** The smallest rotation that turns unit vector a onto unit vector b. */
export function fromTo(a, b) {
  const c = dot(a, b);
  if (c > 0.999999) return identity();
  if (c < -0.999999) {
    // half turn about any axis at right angles to a
    const axis = norm(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const [x, y, z] = axis;
    return [2 * x * x - 1, 2 * x * y, 2 * x * z, 2 * x * y, 2 * y * y - 1, 2 * y * z, 2 * x * z, 2 * y * z, 2 * z * z - 1];
  }
  const v = cross(a, b);
  const k = 1 / (1 + c);
  return [
    1 - k * (v[1] * v[1] + v[2] * v[2]), k * v[0] * v[1] - v[2], k * v[0] * v[2] + v[1],
    k * v[0] * v[1] + v[2], 1 - k * (v[0] * v[0] + v[2] * v[2]), k * v[1] * v[2] - v[0],
    k * v[0] * v[2] - v[1], k * v[1] * v[2] + v[0], 1 - k * (v[0] * v[0] + v[1] * v[1]),
  ];
}

const outBounce = (t) => {
  const n = 7.5625; const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

/** Easing curves by name. Each maps 0..1 to 0..1 (back and elastic overshoot on the way). */
export const EASES = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => t * t * (3 - 2 * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  back: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  elastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
  bounce: outBounce,
  step: (t) => (t < 1 ? 0 : 1),
};

/** Look up an easing curve; a function is passed through. */
export function ease(name = 'linear') {
  if (typeof name === 'function') return name;
  const fn = EASES[name];
  if (!fn) throw new Error(`ease: unknown easing "${name}". Known: ${Object.keys(EASES).join(', ')}`);
  return fn;
}

/** Move `current` toward `target` smoothly. `rate` is per second (10 = settles in about a third of a second). */
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

/** Shortest signed difference between two angles in degrees (-180..180). */
export const angleDiff = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

/** damp() for angles in degrees, going the short way round. */
export const dampAngle = (current, target, rate, dt) => current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));

/** Facing angle (degrees) for a ground velocity, matching puppet.yaw. */
export const yawFromVelocity = (vx, vy) => Math.atan2(vx, -vy) / DEG;
