// Finding the way on the hamlet's ground: a walkable grid read once from the collision world,
// shortest paths over it from the levels engine, and the maths between screen and ground.
import { makeGrid, set, get, findPath, DIRS } from '../vendor/levels/index.js';

const CELL = 0.5; // ground units per grid cell

/**
 * @param {object} stage  The stage from main.js (collision, layers, world).
 * @param {number} radius How wide the walker is, in ground units.
 * @returns {object} nav
 */
export function createNav(stage, radius) {
  const { collision, layers } = stage;
  const size = Math.ceil(80 / CELL);
  const grid = makeGrid(size, size, '#');
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = (col + 0.5) * CELL; const y = (row + 0.5) * CELL;
      if (collision.query({ x, y, r: radius + 0.08 }, { mask: layers.SCENERY, triggers: false }).length === 0) set(grid, col, row, '.');
    }
  }
  const cellOf = (x, y) => ({ x: Math.max(0, Math.min(size - 1, Math.floor(x / CELL))), y: Math.max(0, Math.min(size - 1, Math.floor(y / CELL))) });
  /** The open cell nearest a ground point (the point itself may be inside a wall or a person). */
  function nearestOpen(x, y) {
    const c = cellOf(x, y);
    for (let ring = 0; ring < 12; ring++) {
      let best = null; let bestD = Infinity;
      for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring || get(grid, c.x + dx, c.y + dy) !== '.') continue;
        const d = Math.hypot((c.x + dx + 0.5) * CELL - x, (c.y + dy + 0.5) * CELL - y);
        if (d < bestD) { bestD = d; best = { x: c.x + dx, y: c.y + dy }; }
      }
      if (best) return best;
    }
    return null;
  }
  return {
    grid, cell: CELL,
    /** True when a walker can stand at the ground point. */
    open: (x, y) => get(grid, Math.floor(x / CELL), Math.floor(y / CELL)) === '.',
    /**
     * Shortest walk between two ground points.
     * @returns {Array<[number, number]> | null} ground points to pass in order (the last is the goal's nearest open spot), or null when there is no way.
     */
    path(fromX, fromY, toX, toY) {
      const a = nearestOpen(fromX, fromY); const b = nearestOpen(toX, toY);
      if (!a || !b) return null;
      const steps = findPath(grid, a, b);
      if (steps === null) return null;
      const points = []; let { x, y } = a;
      for (const ch of steps) {
        const d = DIRS.find((dir) => dir.name === ch);
        x += d.dx; y += d.dy;
        points.push([(x + 0.5) * CELL, (y + 0.5) * CELL]);
      }
      // keep only the corners: a point stays when the straight walk past it would hit something
      const out = []; let from = [fromX, fromY];
      for (let i = 0; i < points.length; i++) {
        const next = points[i + 1];
        if (!next) { out.push(points[i]); break; }
        const hit = collision.cast({ x: from[0], y: from[1], r: radius }, next[0] - from[0], next[1] - from[1], { mask: layers.SCENERY });
        if (hit) { out.push(points[i]); from = points[i]; }
      }
      return out;
    },
  };
}

/**
 * The screen direction (dx, dy; right and down are positive) that walks toward a ground direction
 * on the picture being shown. It is the inverse of the camera engine's screenStep.
 */
export function screenDirection(view, gx, gy) {
  const o = view.toCell(0, 0, 0); const a = view.toCell(1, 0, 0); const b = view.toCell(0, 1, 0);
  const dx = (a.col - o.col) * gx + (b.col - o.col) * gy;
  const dy = (a.row - o.row) * gx + (b.row - o.row) * gy;
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/** The eight key directions; `keys` are core input codes. */
export const KEY_DIRECTIONS = [
  { dx: 1, dy: 0, keys: ['ArrowRight'] }, { dx: -1, dy: 0, keys: ['ArrowLeft'] },
  { dx: 0, dy: 1, keys: ['ArrowDown'] }, { dx: 0, dy: -1, keys: ['ArrowUp'] },
  { dx: 1, dy: 1, keys: ['ArrowRight', 'ArrowDown'] }, { dx: 1, dy: -1, keys: ['ArrowRight', 'ArrowUp'] },
  { dx: -1, dy: 1, keys: ['ArrowLeft', 'ArrowDown'] }, { dx: -1, dy: -1, keys: ['ArrowLeft', 'ArrowUp'] },
];

/** The arrow keys to hold so the walker heads along a ground direction, as well as eight directions allow. */
export function keysToward(view, gx, gy) {
  const glen = Math.hypot(gx, gy) || 1;
  const o = view.toCell(0, 0, 0); const a = view.toCell(1, 0, 0); const b = view.toCell(0, 1, 0);
  const m = [[a.col - o.col, b.col - o.col], [a.row - o.row, b.row - o.row]];
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  let best = KEY_DIRECTIONS[0]; let bestDot = -Infinity;
  for (const k of KEY_DIRECTIONS) { // compare on the ground, where the walking happens
    const x = (k.dx * m[1][1] - k.dy * m[0][1]) / det; const y = (k.dy * m[0][0] - k.dx * m[1][0]) / det;
    const dot = (x * gx + y * gy) / ((Math.hypot(x, y) || 1) * glen);
    if (dot > bestDot) { bestDot = dot; best = k; }
  }
  return best.keys;
}

/** The ground point under a canvas point (logical pixels), following the hills. */
export function groundUnder(view, rect, px, py) {
  const p0 = view.toPoint(0, 0, rect, 0); const pa = view.toPoint(1, 0, rect, 0); const pb = view.toPoint(0, 1, rect, 0); const pz = view.toPoint(0, 0, rect, 16);
  const m = [[pa.x - p0.x, pb.x - p0.x], [pa.y - p0.y, pb.y - p0.y]];
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  if (!det) return null;
  let x = 40; let y = 40;
  for (let i = 0; i < 6; i++) {
    const h = view.heightAt(Math.max(0, Math.min(80, x)), Math.max(0, Math.min(80, y))) / 16;
    const rx = px - p0.x - (pz.x - p0.x) * h; const ry = py - p0.y - (pz.y - p0.y) * h;
    x = (rx * m[1][1] - ry * m[0][1]) / det; y = (ry * m[0][0] - rx * m[1][0]) / det;
  }
  return { x, y };
}
