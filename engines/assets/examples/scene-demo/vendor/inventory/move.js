// Moving stacks between slots and containers: place, merge, split, swap, sort.

import { checkCount, sameItem, stackWeight, stackRarity, clone } from './stack.js';
import { checkIndex, containerWeight, accepts, addItem } from './container.js';

const EPS = 1e-9;
const fail = (reason) => ({ ok: false, reason });
const room = (c, catalog) => (c.maxWeight === null ? Infinity : c.maxWeight - containerWeight(c, catalog));

/**
 * moveItem(from, fromIndex, to, toIndex, catalog, n) -> { ok, moved, swapped? } or { ok: false, reason }
 * Moves n units (default: the whole stack) from one slot to another, in the
 * same container or between two.
 *   empty target      -> the units are placed there (n < stack size splits the stack)
 *   same item         -> merged up to the stack limit (moved may be less than n)
 *   different item    -> the two stacks swap (only when moving the whole stack)
 * reasons: 'empty' 'missing' 'not-accepted' 'too-heavy' 'full' 'occupied'
 */
export function moveItem(from, fromIndex, to, toIndex, catalog, n) {
  checkIndex(from, fromIndex, 'moveItem');
  checkIndex(to, toIndex, 'moveItem');
  const s = from.slots[fromIndex];
  if (!s) return fail('empty');
  const count = n === undefined || n === null ? s.n : checkCount(n, 'moveItem');
  if (count > s.n) return fail('missing');
  if (from === to && fromIndex === toIndex) return { ok: true, moved: 0 };
  if (!accepts(to, catalog, s.id)) return fail('not-accepted');
  const t = to.slots[toIndex];
  const def = catalog.get(s.id);
  const across = from !== to;

  if (!t || sameItem(s, t)) {
    let m = t ? Math.min(count, def.stack - t.n) : count;
    if (m === 0) return count === s.n ? { ok: true, moved: 0 } : fail('full');
    if (across && def.weight > 0) {
      m = Math.min(m, Math.max(0, Math.floor(room(to, catalog) / def.weight + EPS)));
      if (m === 0) return fail('too-heavy');
    }
    if (t) t.n += m;
    else to.slots[toIndex] = { ...clone(s), n: m };
    s.n -= m;
    if (s.n === 0) from.slots[fromIndex] = null;
    return { ok: true, moved: m };
  }

  if (count !== s.n) return fail('occupied');
  if (!accepts(from, catalog, t.id)) return fail('not-accepted');
  if (across) {
    const ws = stackWeight(catalog, s);
    const wt = stackWeight(catalog, t);
    if (room(to, catalog) + wt - ws < -EPS || room(from, catalog) + ws - wt < -EPS) return fail('too-heavy');
  }
  from.slots[fromIndex] = t;
  to.slots[toIndex] = s;
  return { ok: true, moved: count, swapped: true };
}

/**
 * transferAll(from, to, catalog, options) -> { moved, left }
 * Moves everything that fits ("take all"). options.weightRoom limits the extra weight.
 */
export function transferAll(from, to, catalog, options = {}) {
  let moved = 0;
  let left = 0;
  let weightRoom = options.weightRoom ?? Infinity;
  for (let i = 0; i < from.slots.length; i++) {
    const s = from.slots[i];
    if (!s) continue;
    const r = addItem(to, catalog, s.id, s.n, s.data, { weightRoom });
    weightRoom -= catalog.get(s.id).weight * r.added;
    moved += r.added;
    left += r.left;
    s.n -= r.added;
    if (s.n === 0) from.slots[i] = null;
  }
  return { moved, left };
}

/**
 * sortContainer(container, catalog, by = 'rarity') -> the container
 * Merges split stacks and packs everything to the front.
 * by: 'rarity' (best first, then name), 'name', 'value' (dearest first) or 'weight'.
 */
export function sortContainer(container, catalog, by = 'rarity') {
  const KEYS = {
    rarity: (s) => -catalog.rarity(stackRarity(catalog, s)).order,
    name: () => 0,
    value: (s) => -catalog.get(s.id).value,
    weight: (s) => -catalog.get(s.id).weight,
  };
  if (!KEYS[by]) throw new Error(`sortContainer: unknown order "${by}". Use one of: ${Object.keys(KEYS).join(', ')}`);
  if (!container || !Array.isArray(container.slots)) throw new Error('sortContainer: expected a container');
  const merged = [];
  for (const s of container.slots) {
    if (!s) continue;
    let todo = s.n;
    const max = catalog.get(s.id).stack;
    for (const m of merged) {
      if (todo === 0) break;
      if (sameItem(m, s) && m.n < max) {
        const k = Math.min(todo, max - m.n);
        m.n += k;
        todo -= k;
      }
    }
    if (todo > 0) merged.push({ ...clone(s), n: todo });
  }
  // Plain code-unit comparison: the same order on every machine (multiplayer needs that).
  const text = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));
  const name = (s) => catalog.get(s.id).name;
  merged.sort((a, b) => KEYS[by](a) - KEYS[by](b) || text(name(a), name(b)) || text(a.id, b.id) || b.n - a.n);
  container.slots.fill(null);
  merged.forEach((s, i) => { container.slots[i] = s; });
  return container;
}
