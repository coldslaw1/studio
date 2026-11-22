// checkLayout: proves a dungeon or interior can be played. The generators already build maps
// that pass; games call this on hand-edited or model-written maps, and the tests call it on
// thousands of seeds.
import { TILE, distances, isWalkable } from './grid.js';

/**
 * checkLayout(layout) -> { ok, errors: [string, ...] }   never throws.
 * Checks: every walkable tile can be reached from the entrance (solid scenery and chests count
 * as walls); the exit can be reached; every locked door has a key that can be picked up without
 * passing that door; every chest has a free tile beside it; monsters, people and scenery stand on
 * floor and never two on one tile; ids are unique.
 */
export function checkLayout(layout) {
  const errors = [];
  const fail = (message) => { errors.push(message); };
  if (!layout || !Array.isArray(layout.tiles) || layout.tiles.length !== layout.cols * layout.rows) return { ok: false, errors: ['tiles must be an array of cols * rows numbers'] };
  const { cols, tiles } = layout;
  const idx = (t) => t.y * cols + t.x;
  if (!layout.entrance || !isWalkable(tiles[idx(layout.entrance)])) return { ok: false, errors: ['the entrance must be on a walkable tile'] };

  const solid = new Set();
  const stand = new Map();
  const ids = new Set();
  const seen = (kind, thing) => {
    if (ids.has(thing.id)) fail(`id '${thing.id}' is used twice`);
    ids.add(thing.id);
    const i = idx(thing);
    if (tiles[i] !== TILE.floor) fail(`${kind} '${thing.id}' at ${thing.x},${thing.y} is not on a floor tile`);
    if (stand.has(i)) fail(`${kind} '${thing.id}' and '${stand.get(i)}' share tile ${thing.x},${thing.y}`);
    stand.set(i, thing.id);
  };
  for (const p of layout.props ?? []) { seen('prop', p); if (p.solid) solid.add(idx(p)); }
  for (const l of layout.loot ?? []) {
    if (l.prop) { if (!ids.has(l.prop)) fail(`loot '${l.id}' names prop '${l.prop}', which does not exist`); ids.add(l.id); } else seen('loot', l);
    if (l.container === 'chest') solid.add(idx(l));
  }
  for (const s of layout.spawns ?? []) seen('spawn', s);
  for (const p of layout.people ?? []) seen('person', p);
  for (const d of layout.doors ?? []) { if (ids.has(d.id)) fail(`id '${d.id}' is used twice`); ids.add(d.id); if (tiles[idx(d)] !== TILE.door) fail(`door '${d.id}' is not on a door tile`); }

  const open = distances(layout, layout.entrance, solid);
  let cut = 0;
  for (let i = 0; i < tiles.length; i++) if (isWalkable(tiles[i]) && !solid.has(i) && open[i] === -1) cut++;
  if (cut) fail(`${cut} walkable tile(s) cannot be reached from the entrance`);
  if (layout.exit && open[idx(layout.exit)] === -1) fail('the exit cannot be reached from the entrance');
  const beside = (thing, dist) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const x = thing.x + dx; const y = thing.y + dy; return x >= 0 && y >= 0 && x < cols && y < layout.rows && dist[y * cols + x] !== -1; });
  for (const l of layout.loot ?? []) if (l.container === 'chest' && !beside(l, open)) fail(`chest '${l.id}' has no free tile beside it`);

  for (const door of (layout.doors ?? []).filter((d) => d.locked)) {
    const key = (layout.keys ?? []).find((k) => k.door === door.id);
    const holder = key && (layout.loot ?? []).find((l) => l.id === key.loot && l.item === key.id);
    if (!holder) { fail(`locked door '${door.id}' has no key in any loot`); continue; }
    const shut = distances(layout, layout.entrance, new Set([...solid, idx(door)]));
    if (!(holder.container === 'chest' ? beside(holder, shut) : shut[idx(holder)] !== -1)) fail(`the key of door '${door.id}' is behind that door`);
  }
  return { ok: errors.length === 0, errors };
}
