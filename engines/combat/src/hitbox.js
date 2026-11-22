// Melee hit shapes. An arc is tested with plain maths (distance, angle and
// height); a box (thrust) is built with the collision engine's box() and
// tested with its overlaps(). Walls between attacker and target stop a blow.
import { dirOf, facingOf, angleDiff, boxAngle } from './util.js';

const DEG = Math.PI / 180;

/** arcRange(shape, progress) -> [lo, hi] degrees relative to the facing that the swing has covered so far (progress 0..1). */
export function arcRange(shape, progress = 1) {
  const now = shape.sweep ? shape.from + (shape.to - shape.from) * Math.min(1, Math.max(0, progress)) : shape.to;
  return [Math.min(shape.from, now), Math.max(shape.from, now)];
}

/** heightBand(fighter, move) -> [low, high] in world height that the move reaches. */
export function heightBand(f, move) {
  return [f.z + (move.low ?? 0), f.z + (move.high ?? f.height * 1.15)];
}

function arcCovers(f, shape, progress, t) {
  const dx = t.x - f.x; const dy = t.y - f.y;
  const d = Math.hypot(dx, dy);
  if (d - t.radius > shape.reach || d + t.radius < shape.inner) return false;
  if (d <= t.radius) return true;
  const [lo, hi] = arcRange(shape, progress);
  if (hi - lo >= 360) return true;
  const tol = Math.asin(Math.min(1, t.radius / d)) / DEG;
  // positive relative angles are on the attacker's left, the same sense as the facing itself
  const rel = angleDiff(facingOf(dx, dy), f.facing);
  const delta = (((rel - lo) % 360) + 360) % 360;
  return delta <= hi - lo + tol || delta >= 360 - tol;
}

/** boxOf(cfg, fighter, shape) -> the collision polygon of a thrust box in front of the fighter. */
export function boxOf(cfg, f, shape) {
  const [fx, fy] = dirOf(f.facing);
  const mid = shape.start + shape.length / 2;
  return cfg.collision.box(f.x + fx * mid, f.y + fy * mid, shape.length, shape.width, boxAngle(f.facing));
}

/**
 * covers(cfg, attacker, move, progress, target) -> true when the move's shape reaches the target now.
 * progress 0..1 is how far through the active window the swing is (arcs sweep; boxes are whole).
 */
export function covers(cfg, f, move, progress, t) {
  const [low, high] = heightBand(f, move);
  if (t.z > high || t.z + t.height < low) return false;
  if (move.shape.kind === 'arc') return arcCovers(f, move.shape, progress, t);
  return cfg.collision.overlaps(boxOf(cfg, f, move.shape), { x: t.x, y: t.y, r: t.radius });
}

/** sceneryBlocks(body, low, high) -> true when a scenery body stands in the height band (bodies without `height` are endlessly tall). */
export function sceneryBlocks(body, low, high) {
  if (!Number.isFinite(body.height)) return true;
  const base = Number.isFinite(body.base) ? body.base : 0;
  return high > base && low < base + body.height;
}

/** clearLine(cfg, x0, y0, x1, y1, low, high) -> true when no scenery stands between the two ground points. */
export function clearLine(cfg, x0, y0, x1, y1, low, high) {
  if (!cfg.world || (x0 === x1 && y0 === y1)) return true;
  for (const hit of cfg.world.raycastAll(x0, y0, x1, y1, { mask: cfg.sceneryMask })) {
    if (sceneryBlocks(hit.body, low, high)) return false;
  }
  return true;
}

/**
 * moveOutline(cfg, fighter, move, progress = 1) -> a drawable description of the hit shape, for telegraphs and debug views:
 *   { kind: 'arc', x, y, reach, inner, from, to }  from/to are absolute facings in degrees (see dirOf)
 *   { kind: 'box', points: [[x, y], ...] }         world corners
 */
export function moveOutline(cfg, f, move, progress = 1) {
  if (move.shape.kind === 'arc') {
    const [lo, hi] = arcRange(move.shape, progress);
    return { kind: 'arc', x: f.x, y: f.y, reach: move.shape.reach, inner: move.shape.inner, from: f.facing + lo, to: f.facing + hi };
  }
  const poly = boxOf(cfg, f, move.shape);
  return { kind: 'box', points: poly.points.map(([px, py]) => [poly.x + px, poly.y + py]) };
}
