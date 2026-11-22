// Moving a body through the world: stop at solid things, slide along them, never tunnel.
// Internal: games call world.move(body, dx, dy).
import { shapeAt } from './shapes.js';
import { castShape, overlapsOf } from './cast.js';

/**
 * If the body starts inside something solid (spawned in a wall, or a solid was moved onto
 * it), push it out the shortest way. Gives up quietly after a few tries.
 */
export function pushOut(ctx, body, opts) {
  let moved = false;
  for (let i = 0; i < 8; i++) {
    const found = overlapsOf(ctx, shapeAt(body), { ...opts, self: body, pushOut: true });
    if (found.length === 0) break;
    const hit = found[0];
    body.x += hit.nx * (hit.depth + ctx.skin);
    body.y += hit.ny * (hit.depth + ctx.skin);
    moved = true;
  }
  return moved;
}

/**
 * Move a body by (dx, dy), stopping at solid bodies and tiles.
 * @param {object} ctx   { hash, skin, slop, maxSlides }
 * @param {object} body  the body to move; its x and y are changed
 * @param {object} opts  { slide=true, mask, ignore }
 * @returns {{dx:number, dy:number, hits:Array, legs:Array, touching:object}}
 *   dx, dy    how far the body really moved
 *   hits      one entry per surface it ran into: { body, nx, ny, col?, row? }
 *   legs      straight pieces of the path: [x, y, dx, dy] (used for triggers)
 *   touching  { left, right, up, down } - which sides ran into something
 */
export function moveBody(ctx, body, dx, dy, opts = {}) {
  const { slide = true, mask = -1, ignore = null } = opts;
  const filter = { self: body, mask, ignore };
  const x0 = body.x;
  const y0 = body.y;
  const hits = [];
  const legs = [];
  const touching = { left: false, right: false, up: false, down: false };
  pushOut(ctx, body, filter);
  let rx = dx;
  let ry = dy;
  const normals = [];
  for (let i = 0; i <= ctx.maxSlides; i++) {
    const len = Math.hypot(rx, ry);
    if (len < 1e-12) break;
    const hit = castShape(ctx, shapeAt(body), rx, ry, { ...filter, skipOverlap: true });
    if (!hit) {
      legs.push([body.x, body.y, rx, ry]);
      body.x += rx;
      body.y += ry;
      break;
    }
    const ux = rx / len;
    const uy = ry / len;
    const into = -(hit.nx * ux + hit.ny * uy);
    // stop `skin` short of the surface so the next move starts cleanly outside it
    const travel = Math.max(0, hit.t * len - ctx.skin / Math.max(into, 1e-9));
    if (travel > 0) {
      legs.push([body.x, body.y, ux * travel, uy * travel]);
      body.x += ux * travel;
      body.y += uy * travel;
    }
    const entry = { body: hit.body, nx: hit.nx, ny: hit.ny };
    if (hit.col !== undefined) {
      entry.col = hit.col;
      entry.row = hit.row;
    }
    hits.push(entry);
    if (hit.ny < -0.5) touching.down = true;
    else if (hit.ny > 0.5) touching.up = true;
    if (hit.nx < -0.5) touching.right = true;
    else if (hit.nx > 0.5) touching.left = true;
    if (!slide) break;
    // keep the part of the leftover move that runs along the surface
    const left = len - travel;
    rx = ux * left;
    ry = uy * left;
    const dot = rx * hit.nx + ry * hit.ny;
    if (dot < 0) {
      rx -= dot * hit.nx;
      ry -= dot * hit.ny;
    }
    // in a corner the leftover would push back into an earlier surface: stop there
    if (normals.some((n) => rx * n[0] + ry * n[1] < -1e-9)) break;
    normals.push([hit.nx, hit.ny]);
  }
  return { dx: body.x - x0, dy: body.y - y0, hits, legs, touching };
}
