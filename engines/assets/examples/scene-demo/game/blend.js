// Smooth drawing between ticks. The game steps 42 times a second; screens draw 60 to 240 times.
// Before each step the game remembers where things were, and while drawing it shows them part of
// the way (alpha) from there to where they are now. Nothing here changes game state for good.

/**
 * @param {number} [snap]  A move longer than this in one tick is a teleport: shown at once, not blended.
 * @returns {{ remember(things: Iterable<object>): void, draw(alpha: number, things: Iterable<object>, fn: () => void): void }}
 *   `things` are objects with numeric x and y (collision bodies, world entities).
 */
export function createBlend(snap = 3) {
  const before = new WeakMap();
  const moved = [];
  return {
    /** Call at the start of an update, before anything moves. */
    remember(things) {
      for (const t of things) { const b = before.get(t); if (b) { b.x = t.x; b.y = t.y; } else before.set(t, { x: t.x, y: t.y }); }
    },
    /** Run `fn` (the drawing) with every thing placed between its last two positions, then put them back. */
    draw(alpha, things, fn) {
      moved.length = 0;
      if (alpha < 1) {
        for (const t of things) {
          const b = before.get(t);
          if (!b || (b.x === t.x && b.y === t.y) || Math.hypot(t.x - b.x, t.y - b.y) > snap) continue;
          moved.push(t, t.x, t.y);
          t.x = b.x + (t.x - b.x) * alpha; t.y = b.y + (t.y - b.y) * alpha;
        }
      }
      try { fn(); } finally { for (let i = 0; i < moved.length; i += 3) { moved[i].x = moved[i + 1]; moved[i].y = moved[i + 2]; } }
    },
  };
}
