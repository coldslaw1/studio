// Positional sound for 2D games: how loud, how far left or right and how
// muffled a sound is, from where it is and where the listener is. Pure maths;
// createAudio uses it for play(name, { at }) and for emitters.

/** Default hearing distance in logical pixels. */
export const DEFAULT_RANGE = 480;

function point(p, fn) {
  const x = Array.isArray(p) ? p[0] : p && p.x, y = Array.isArray(p) ? p[1] : p && p.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${fn}: a position must be { x, y } or [x, y] with numbers, got ${JSON.stringify(p)}`);
  return { x, y };
}

/**
 * spatialize(source, listener, { range, near, width, muffle }?) -> { volume, pan, lowpass, distance }
 *   source, listener: { x, y } or [x, y] in logical pixels (y is ignored for left/right)
 *   range:  distance at which the sound has faded to nothing (default 480)
 *   near:   inside this distance the sound is at full volume (default range / 10)
 *   width:  how strongly sideways distance pans, 0 = always centre .. 1 (default 1)
 *   muffle: 0..1 extra dulling, for a sound behind a wall (default 0)
 * Returns volume 0..1, pan -1 (left) .. 1 (right), lowpass in Hz (20000 = clear)
 * and the distance. A sound on top of the listener is centred, not hard to one side.
 */
export function spatialize(source, listener = { x: 0, y: 0 }, options = {}) {
  const s = point(source, 'spatialize'), l = point(listener, 'spatialize');
  const range = options.range ?? DEFAULT_RANGE;
  if (!(range > 0)) throw new Error(`spatialize: range must be a number above 0, got ${JSON.stringify(options.range)}`);
  const near = Math.min(options.near ?? range / 10, range * 0.9);
  const width = Math.max(0, Math.min(1, options.width ?? 1));
  const muffle = Math.max(0, Math.min(1, options.muffle ?? 0));
  const dx = s.x - l.x, dy = s.y - l.y;
  const distance = Math.hypot(dx, dy);
  const far = Math.max(0, Math.min(1, (distance - near) / (range - near))); // 0 close .. 1 at the edge
  const volume = (1 - far) * (1 - far) * (1 - 0.5 * muffle);
  const pan = Math.max(-1, Math.min(1, (dx / Math.hypot(dx, dy * 0.5, range * 0.2)) * width));
  // Distance and walls take the highs first: 20 kHz close by, about 1.5 kHz at the edge.
  const lowpass = Math.round(20000 * Math.pow(0.075, Math.min(1, far * 0.9 + muffle * 0.8)));
  return { volume, pan, lowpass, distance, far };
}

const cross = (ax, ay, bx, by, cx, cy, dx, dy) => {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (d === 0) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t > 0 && t < 1 && u >= 0 && u <= 1;
};

/**
 * occlusion(source, listener, walls) -> 0..1, how much of the straight line between them is blocked.
 *   walls: a list of { x1, y1, x2, y2 } lines or { x, y, w, h } boxes, each with an optional
 *          `density` 0..1 (default 0.6; a curtain 0.2, a stone wall 1)
 * 0 = clear line of sight. Pass the result as `muffle` to spatialize, or give the walls to
 * audio.setWalls() and positional sounds are muffled by themselves.
 */
export function occlusion(source, listener, walls) {
  const s = point(source, 'occlusion'), l = point(listener, 'occlusion');
  if (!Array.isArray(walls)) throw new Error(`occlusion: walls must be a list of { x1, y1, x2, y2 } or { x, y, w, h }, got ${JSON.stringify(walls)}`);
  let blocked = 0;
  for (const wall of walls) {
    const density = wall.density ?? 0.6;
    let lines;
    if (Number.isFinite(wall.x1) && Number.isFinite(wall.y1) && Number.isFinite(wall.x2) && Number.isFinite(wall.y2)) lines = [[wall.x1, wall.y1, wall.x2, wall.y2]];
    else if (Number.isFinite(wall.x) && Number.isFinite(wall.y) && wall.w > 0 && wall.h > 0) lines = [[wall.x, wall.y, wall.x + wall.w, wall.y], [wall.x + wall.w, wall.y, wall.x + wall.w, wall.y + wall.h], [wall.x, wall.y + wall.h, wall.x + wall.w, wall.y + wall.h], [wall.x, wall.y, wall.x, wall.y + wall.h]];
    else throw new Error(`occlusion: a wall must be { x1, y1, x2, y2 } or { x, y, w, h }, got ${JSON.stringify(wall)}`);
    // a box is one obstacle however many of its sides the line crosses
    if (lines.some(([ax, ay, bx, by]) => cross(s.x, s.y, l.x, l.y, ax, ay, bx, by))) blocked += density;
  }
  return Math.min(1, blocked);
}

/** toPoint(value, fn) -> { x, y }. Accepts { x, y } or [x, y]; throws with fn's name on anything else. */
export const toPoint = point;
