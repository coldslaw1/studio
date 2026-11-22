// Small shared helpers: argument checks, rounding that keeps saved state stable, and a binary heap.

/** need(condition, message) throws Error(message) when the condition is false. */
export function need(condition, message) {
  if (!condition) throw new Error(message);
}

/** q(v) rounds to 5 decimals, so saved positions are identical on every machine. */
export const q = (v) => Math.round(v * 1e5) / 1e5 + 0;

/** dist(ax, ay, bx, by) -> distance between two points. */
export const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

/** pointOf(p) -> [x, y] from [x, y] or { x, y }. */
export const pointOf = (p) => (Array.isArray(p) ? p : [p.x, p.y]);

/** isId(v) -> true for ids made of letters, digits and _ . : - */
export const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_.:-]+$/.test(v);

/**
 * createHeap(f) -> { size, push(i), pop() }: a binary heap of indices ordered by f[i]; ties go to the
 * lower index, so a search gives the same result on every run.
 */
export function createHeap(f) {
  const items = [];
  const less = (a, b) => f[a] < f[b] || (f[a] === f[b] && a < b);
  return {
    get size() { return items.length; },
    push(v) {
      let i = items.push(v) - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(items[i], items[p])) break;
        const t = items[i]; items[i] = items[p]; items[p] = t; i = p;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1; const r = l + 1;
          let m = i;
          if (l < items.length && less(items[l], items[m])) m = l;
          if (r < items.length && less(items[r], items[m])) m = r;
          if (m === i) break;
          const t = items[i]; items[i] = items[m]; items[m] = t; i = m;
        }
      }
      return top;
    },
  };
}
