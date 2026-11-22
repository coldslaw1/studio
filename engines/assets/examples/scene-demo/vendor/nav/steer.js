// Steering round what is in the way right now. The path says where to go; this picks the heading
// for this step. When the way straight on is blocked (a prop the path cuts close to, another
// walker, something that moved since the path was made) it turns to the nearest free heading and
// keeps to that side until it is round, instead of pushing into the thing or flipping left-right.

const TURNS = [22.5, 45, 67.5, 90, 112.5, 135].map((d) => { const r = d * Math.PI / 180; return [Math.cos(r), Math.sin(r)]; });
// the order headings are tried in when no side is chosen yet (both sides, smallest turn first) and
// when one is (that side up to a right angle, then the other, then the wide turns)
const FREE = []; const KEPT = [];
for (let k = 0; k < 6; k++) FREE.push([k, 1], [k, -1]);
for (let k = 0; k < 4; k++) KEPT.push([k, 1]);
for (let k = 0; k < 4; k++) KEPT.push([k, -1]);
KEPT.push([4, 1], [5, 1], [4, -1], [5, -1]);

/**
 * steerAround(o, probe, mem) -> { x, y, turned, blocked }
 *   o       { x, y, dx, dy, look, first = 1 }: where the body is, the unit heading it wants, how far
 *           ahead to look, and the side tried first (1 = turn right on screen, -1 = left)
 *   probe   (px, py) -> true when the body may stand at that point
 *   mem     { side, hold } kept by the caller between steps (start with { side: 0, hold: 0 })
 * x, y is the unit heading to take; (0, 0) with blocked: true when every heading is shut.
 */
export function steerAround(o, probe, mem) {
  const { x, y, dx, dy, look } = o;
  const free = (ux, uy) => probe(x + ux * look * 0.5, y + uy * look * 0.5) && probe(x + ux * look, y + uy * look);
  if (free(dx, dy)) {
    if (mem.hold > 0) mem.hold -= 1; else mem.side = 0;
    return { x: dx, y: dy, turned: false, blocked: false };
  }
  const first = mem.side || o.first || 1;
  for (const [k, s] of (mem.side ? KEPT : FREE)) {
    const side = s * first; const [c, sn] = TURNS[k];
    const ux = dx * c - dy * sn * side; const uy = dx * sn * side + dy * c;
    if (free(ux, uy)) { mem.side = side; mem.hold = 10; return { x: ux, y: uy, turned: true, blocked: false }; }
  }
  return { x: 0, y: 0, turned: true, blocked: true };
}
