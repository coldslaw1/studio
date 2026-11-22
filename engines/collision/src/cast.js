// World-level tests: sweep, overlap and ray against everything in a collision world.
// Internal: games use the methods on the world from createCollisionWorld.
import { boundsOf } from './shapes.js';
import { collide } from './narrow.js';
import { sweep } from './sweep.js';
import { raycast, raycastGrid } from './ray.js';

const TIE = 1e-9;

/** True when the layers and masks of two bodies let them interact. */
export function pairOk(a, b) {
  return (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0;
}

/** Call fn(rect, col, row, oneWay) for every blocking tile of a tile body inside a box. */
export function eachTile(body, bx, by, bw, bh, fn) {
  const map = body.tiles;
  const ts = map.tileSize;
  let c0 = Math.floor((bx - body.x) / ts);
  let c1 = Math.floor((bx + bw - body.x) / ts);
  let r0 = Math.floor((by - body.y) / ts);
  let r1 = Math.floor((by + bh - body.y) / ts);
  if (body.finite) { // nothing is solid outside a finite map, so a long sweep need not look there
    c0 = Math.max(c0, 0);
    r0 = Math.max(r0, 0);
    c1 = Math.min(c1, map.cols - 1);
    r1 = Math.min(r1, map.rows - 1);
  }
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const solid = map.isSolid(col, row);
      const oneWay = !solid && typeof map.isOneWay === 'function' && map.isOneWay(col, row);
      if (solid || oneWay) fn({ x: body.x + col * ts, y: body.y + row * ts, w: ts, h: ts }, col, row, oneWay);
    }
  }
}

function makeFilter(opts) {
  const { self = null, mask = -1, ignore = null, triggers = false, solids = true } = opts;
  const skip = Array.isArray(ignore) ? ignore : ignore ? [ignore] : [];
  return (other) => other !== self && !skip.includes(other) &&
    (other.trigger ? triggers : solids) &&
    (other.layer & mask) !== 0 && (!self || pairOk(self, other));
}

// A face of a tile that has another solid tile right behind it can never really be touched.
const innerFace = (map, col, row, nx, ny) =>
  (Math.abs(nx) === 1 || Math.abs(ny) === 1) && map.isSolid(col + Math.round(nx), row + Math.round(ny));

/**
 * Move a shape by (dx, dy) and find the first thing it touches.
 * @param {object} ctx   { hash, slop }
 * @param {object} opts  { self, mask, ignore, triggers, solids, skipOverlap }
 * @returns {null|object} { t, nx, ny, overlap, depth?, body, col?, row? }
 */
export function castShape(ctx, shape, dx, dy, opts = {}) {
  const ok = makeFilter(opts);
  const b = boundsOf(shape);
  const pad = ctx.slop * 2;
  const bx = Math.min(b.x, b.x + dx) - pad;
  const by = Math.min(b.y, b.y + dy) - pad;
  const bw = b.w + Math.abs(dx) + pad * 2;
  const bh = b.h + Math.abs(dy) + pad * 2;
  let best = null;
  let bestInto = 0;
  const consider = (target, body, oneWay, col, row) => {
    const hit = sweep(shape, dx, dy, target, ctx.slop);
    if (!hit) return;
    if (hit.overlap) {
      if (opts.skipOverlap || oneWay) return;
    } else {
      if (oneWay && hit.ny > -0.7) return; // one-way things only stop you from above
      if (body.tiles && innerFace(body.tiles, col, row, hit.nx, hit.ny)) return;
    }
    const into = hit.nx * dx + hit.ny * dy;
    if (best && !(hit.t < best.t - TIE || (hit.t < best.t + TIE && into < bestInto))) return;
    best = hit;
    bestInto = into;
    best.body = body;
    if (body.tiles) {
      best.col = col;
      best.row = row;
    }
  };
  for (const other of ctx.hash.query(bx, by, bw, bh)) {
    if (!ok(other)) continue;
    if (other.tiles) eachTile(other, bx, by, bw, bh, (rect, col, row, oneWay) => consider(rect, other, oneWay, col, row));
    else consider(other, other, other.oneWay === true);
  }
  return best;
}

/**
 * Everything a shape overlaps right now.
 * @returns {Array<{body:object, nx:number, ny:number, depth:number, col?:number, row?:number}>}
 *   deepest first; (nx, ny, depth) pushes the shape out of that body
 */
export function overlapsOf(ctx, shape, opts = {}) {
  const ok = makeFilter(opts);
  const b = boundsOf(shape);
  const out = [];
  for (const other of ctx.hash.query(b.x, b.y, b.w, b.h)) {
    if (!ok(other)) continue;
    if (other.tiles) {
      eachTile(other, b.x, b.y, b.w, b.h, (rect, col, row, oneWay) => {
        if (oneWay && opts.pushOut) return;
        const hit = collide(shape, rect);
        if (!hit || hit.depth <= ctx.slop) return;
        if (opts.pushOut && innerFace(other.tiles, col, row, hit.nx, hit.ny)) return;
        out.push({ body: other, nx: hit.nx, ny: hit.ny, depth: hit.depth, col, row });
      });
    } else {
      if (other.oneWay && opts.pushOut) continue;
      const hit = collide(shape, other);
      if (hit && hit.depth > ctx.slop) out.push({ body: other, nx: hit.nx, ny: hit.ny, depth: hit.depth });
    }
  }
  return out.sort((p, q) => q.depth - p.depth || p.body.id - q.body.id);
}

/**
 * Cast a line through the world.
 * @returns {Array<object>} every hit, nearest first: { t, x, y, nx, ny, inside, body, col?, row? }
 */
export function castRay(ctx, x0, y0, x1, y1, opts = {}) {
  const ok = makeFilter(opts);
  const hits = [];
  const bx = Math.min(x0, x1);
  const by = Math.min(y0, y1);
  for (const other of ctx.hash.query(bx, by, Math.abs(x1 - x0), Math.abs(y1 - y0))) {
    if (!ok(other)) continue;
    const hit = other.tiles ? raycastGrid(other.tiles, x0, y0, x1, y1, other.x, other.y) : raycast(x0, y0, x1, y1, other);
    if (!hit) continue;
    hit.body = other;
    hits.push(hit);
  }
  return hits.sort((p, q) => p.t - q.t || p.body.id - q.body.id);
}
