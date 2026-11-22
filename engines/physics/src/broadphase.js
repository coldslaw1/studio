// Broad phase: quickly find pairs of bodies that are near each other.
import { boundsOf } from './collide.js';

/**
 * Find candidate pairs using a grid of square cells.
 * @param {Array} bodies    bodies with a numeric `id`, sorted by id
 * @param {number} cellSize cell size in pixels (about the size of a typical body or larger)
 * @param {function} wanted (a, b) => boolean, called once per candidate pair
 * @param {number} [margin=0] grow every body by this many pixels first
 * @returns {Array<[object, object]>} pairs [a, b] with a.id < b.id, in a stable order
 */
export function findPairs(bodies, cellSize, wanted, margin = 0) {
  const cells = new Map();
  const seen = new Set();
  const pairs = [];
  for (const body of bodies) {
    const b = boundsOf(body);
    const c0 = Math.floor((b.x - margin) / cellSize);
    const c1 = Math.floor((b.x + b.w + margin) / cellSize);
    const r0 = Math.floor((b.y - margin) / cellSize);
    const r1 = Math.floor((b.y + b.h + margin) / cellSize);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = c + ',' + r;
        const list = cells.get(key);
        if (!list) {
          cells.set(key, [body]);
          continue;
        }
        for (const other of list) {
          const pairKey = other.id + ':' + body.id;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          if (wanted(other, body)) pairs.push([other, body]);
        }
        list.push(body);
      }
    }
  }
  return pairs;
}
