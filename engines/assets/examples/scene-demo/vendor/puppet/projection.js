// Projections: how a point in space lands on the screen. Both renderers use the same thing:
// { col: [x, y, z], row: [x, y, z], toward: [x, y, z] } where screen x = col . p, screen y = row . p
// (y grows downward) and `toward` is the unit vector pointing at the camera (used for depth).
import { cross, norm, dot, DEG } from './math.js';

const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Build a projection from its two screen axes; works out which way the camera is. */
export function makeProjection(col, row) {
  if (!isVec(col) || !isVec(row)) throw new Error(`makeProjection: col and row must be [x, y, z], got ${JSON.stringify(col)} and ${JSON.stringify(row)}`);
  const c = cross(col, row);
  if (Math.hypot(...c) < 1e-9) throw new Error('makeProjection: col and row point the same way, so there is no picture');
  let toward = norm([-c[0], -c[1], -c[2]]);
  if (toward[2] < -1e-6) toward = toward.map((v) => -v); // the camera is never below the ground
  // pre-solve "which point on the picture plane lands at screen (u, v)": p = u * U + v * V
  const cc = dot(col, col); const cr = dot(col, row); const rr = dot(row, row);
  const det = cc * rr - cr * cr;
  const U = [0, 1, 2].map((i) => (rr * col[i] - cr * row[i]) / det);
  const V = [0, 1, 2].map((i) => (cc * row[i] - cr * col[i]) / det);
  return { col: col.slice(), row: row.slice(), toward, U, V, unitX: Math.sqrt(cc), unitY: Math.sqrt(rr) };
}

/**
 * A camera looking at the character from the front (the character faces the viewer at yaw 0).
 * @param {object} [o]
 * @param {number} [o.unit]   Screen units (pixels, or character cells) per world unit. Default 60.
 * @param {number} [o.pitch]  Degrees the camera looks down: 0 = side-on (platformer), 30 to 60 = top-down-ish. Default 0.
 * @param {number} [o.yaw]    Degrees the camera is turned around the up axis. Default 0.
 * @param {number} [o.squash] Extra vertical scale (0.5 for half-height text cells). Default 1.
 */
export function frontProjection({ unit = 60, pitch = 0, yaw = 0, squash = 1 } = {}) {
  const sp = Math.sin(pitch * DEG); const cp = Math.cos(pitch * DEG);
  const sa = Math.sin(yaw * DEG); const ca = Math.cos(yaw * DEG);
  return makeProjection([unit * ca, unit * sa, 0], [unit * squash * sp * sa, -unit * squash * sp * ca, -unit * squash * cp]);
}

/**
 * The projection of a Kiln scene (a view from createSceneView), in character cells per world unit,
 * so a puppet drawn with it lines up with the backdrop. Heights are in the same unit as x and y here
 * (Kiln's own z is in sixteenths; this converts).
 * @param {{toCell:Function}} view  A Kiln scene view with a projection (not a perspective scene).
 */
export function projectionFromScene(view) {
  if (!view || typeof view.toCell !== 'function') throw new Error('projectionFromScene: expected a Kiln scene view (createSceneView / loadSceneView)');
  const o = view.toCell(0, 0, 0); const x = view.toCell(1, 0, 0); const y = view.toCell(0, 1, 0); const z = view.toCell(0, 0, 16);
  return makeProjection([x.col - o.col, y.col - o.col, z.col - o.col], [x.row - o.row, y.row - o.row, z.row - o.row]);
}

/** Screen position and depth of a point: [x, y, depth] (larger depth = nearer the camera). */
export const project = (p, proj) => [dot(proj.col, p), dot(proj.row, p), dot(proj.toward, p)];
