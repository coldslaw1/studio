// The first-person camera: where the eye is and which way it looks. Only numbers; the view reads it
// each frame. World space: x and y are the ground, z is up, 1 unit = 1 metre.

const DEG = Math.PI / 180;

/**
 * @param {object} [o]
 * @param {number} [o.x] @param {number} [o.y] @param {number} [o.z]  The eye, in metres.
 * @param {number} [o.yaw]    Degrees, counter-clockwise from above: 0 looks along +x, 90 along +y.
 * @param {number} [o.pitch]  Degrees up (+) or down (-).
 * @param {number} [o.fov]    Horizontal field of view in degrees (default 90).
 * @param {number} [o.near]   Nearest distance drawn, in metres (default 0.08). Keep it under the player's collision radius.
 * @param {number} [o.far]    Farthest distance drawn (default 600).
 * @returns {{x:number, y:number, z:number, yaw:number, pitch:number, fov:number, near:number, far:number}}
 */
export function createFpCamera(o = {}) {
  const cam = { x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 1.65, yaw: o.yaw ?? 0, pitch: o.pitch ?? 0, fov: o.fov ?? 90, near: o.near ?? 0.08, far: o.far ?? 600 };
  for (const [k, v] of Object.entries(cam)) if (!Number.isFinite(v)) throw new Error(`createFpCamera: "${k}" must be a number, got ${v}`);
  if (!(cam.fov > 10 && cam.fov < 170)) throw new Error(`createFpCamera: "fov" must be between 10 and 170 degrees, got ${cam.fov}`);
  if (!(cam.near > 0 && cam.far > cam.near)) throw new Error(`createFpCamera: need 0 < near < far, got near ${cam.near}, far ${cam.far}`);
  return cam;
}

/**
 * The camera's axes and lens for a picture of cols x rows character cells. Each cell holds two
 * samples, one above the other, so the sample grid is cols wide and rows * 2 high.
 * A point p is seen at sample x = cx + fx * (p - eye).R / depth, y = cy - fy * (p - eye).U / depth,
 * where depth = (p - eye).F.
 * @returns {{eye:number[], F:number[], R:number[], U:number[], fx:number, fy:number, cx:number, cy:number, w:number, h:number, near:number, far:number}}
 */
export function cameraBasis(cam, cols, rows) {
  const cy = Math.cos(cam.yaw * DEG); const sy = Math.sin(cam.yaw * DEG);
  const cp = Math.cos(cam.pitch * DEG); const sp = Math.sin(cam.pitch * DEG);
  const fx = cols / 2 / Math.tan(cam.fov * DEG / 2);
  return {
    eye: [cam.x, cam.y, cam.z],
    F: [cp * cy, cp * sy, sp],
    R: [sy, -cy, 0],
    U: [-cy * sp, -sy * sp, cp],
    fx, fy: fx * 2, cx: cols / 2, cy: rows, w: cols, h: rows * 2, near: cam.near, far: cam.far,
  };
}

/**
 * The ground direction for a walking intent: `forward` (-1..1, + is where the camera looks) and
 * `strafe` (-1..1, + is to the right). Returns [dx, dy], at most 1 long.
 */
export function walkDirection(yaw, forward, strafe) {
  const c = Math.cos(yaw * DEG); const s = Math.sin(yaw * DEG);
  const x = c * forward + s * strafe; const y = s * forward - c * strafe;
  const l = Math.hypot(x, y);
  return l > 1 ? [x / l, y / l] : [x, y];
}
