// Light maps, worked out once for a world: a top-down height map of everything, the height the
// shadow of everything up-light reaches over each spot, and for the ground itself how shadowed and
// how hemmed in each spot is. The same method as Kiln's scene lighting, in metres.

/**
 * @param {object} world  From createFpWorld (before its maps exist).
 * @param {{cellsPerMetre?: number}} [o]  Fineness of the maps (default 4, lowered for very large grounds).
 * @returns {{g:number, gw:number, gh:number, x0:number, y0:number, hm:Float32Array, S:Float32Array, groundShadow:Float32Array, groundOcc:Float32Array, base:Float32Array}}
 *   base: the ground (or sea) height under each map cell, kept so shadows can be cast again (castShadows).
 */
export function buildLightMaps(world, o = {}) {
  const { ground, water } = world;
  const pad = 1;
  const x0 = ground.x0 - pad; const y0 = ground.y0 - pad;
  const spanX = ground.x1 - ground.x0 + 2 * pad; const spanY = ground.y1 - ground.y0 + 2 * pad;
  let g = o.cellsPerMetre ?? 4;
  while (g > 0.5 && Math.max(spanX, spanY) * g > 2048) g /= 2;
  const gw = Math.ceil(spanX * g) + 1; const gh = Math.ceil(spanY * g) + 1;
  const base = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      let h = world.heightAt(x0 + i / g, y0 + j / g);
      if (water && h < water.level) h = water.level;
      base[j * gw + i] = h;
    }
  }
  // objects seen from straight above: the highest point over each map cell
  const hm = base.slice();
  const T = world.tris; const first = (world.nGround + world.nWater) * 9;
  for (let p = first; p < T.length; p += 9) {
    const ax = (T[p] - x0) * g; const ay = (T[p + 1] - y0) * g; const az = T[p + 2];
    const bx = (T[p + 3] - x0) * g; const by = (T[p + 4] - y0) * g; const bz = T[p + 5];
    const cx = (T[p + 6] - x0) * g; const cy = (T[p + 7] - y0) * g; const cz = T[p + 8];
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue; // upright faces cover no ground; their top edge belongs to a roof or lid
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))); const i1 = Math.min(gw - 1, Math.floor(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))); const j1 = Math.min(gh - 1, Math.floor(Math.max(ay, by, cy)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w0 = ((bx - i) * (cy - j) - (cx - i) * (by - j)) / area;
        const w1 = ((cx - i) * (ay - j) - (ax - i) * (cy - j)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        if (z > hm[j * gw + i]) hm[j * gw + i] = z;
      }
    }
  }

  const S = new Float32Array(gw * gh);
  // how hemmed in each spot of the ground is depends only on the place, so it is stored
  const groundShadow = new Float32Array(gw * gh);
  const groundOcc = new Float32Array(gw * gh);
  const AO = [[1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]];
  const reach = Math.max(1, Math.round(0.9 * g));
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i; const h = base[k];
      const wet = water !== null && h <= water.level;
      let occ = 0;
      for (const [ax, ay] of AO) {
        const ii = Math.min(gw - 1, Math.max(0, i + Math.round(ax * reach))); const jj = Math.min(gh - 1, Math.max(0, j + Math.round(ay * reach)));
        occ += Math.min(1, Math.max(0, (hm[jj * gw + ii] - h - 0.1875) / 1.875));
      }
      groundOcc[k] = wet ? 0 : occ / AO.length;
    }
  }
  const maps = { g, gw, gh, x0, y0, hm, S, groundShadow, groundOcc, base };
  castShadows(world, maps);
  return maps;
}

/**
 * Cast the shadows again for the world's light as it is now (world.light.dir): the shadow height
 * over every spot, and how shadowed the ground itself is. The height map and the corner darkening
 * do not depend on the light and are left alone, so this is a small part of buildLightMaps: call
 * it when the sun or moon has moved (world.relight does). Works in place, no allocation.
 * @param {object} world  From createFpWorld.
 * @param {object} maps   From buildLightMaps.
 * @returns {object} maps
 */
export function castShadows(world, maps) {
  const { water, light } = world;
  const { g, gw, gh, hm, S, groundShadow, base } = maps;
  S.set(hm);
  // shadow height: sweep away from the sun, carrying each height along and letting it sink
  const L = light.dir;
  const lxy = Math.hypot(L[0], L[1]);
  if (light.shadows > 0 && lxy > 1e-3 && L[2] > 0.02) {
    const m = Math.max(Math.abs(L[0]), Math.abs(L[1]));
    const dx = L[0] / m; const dy = L[1] / m;
    const drop = Math.hypot(dx, dy) / g * (L[2] / lxy);
    const at = (i, j) => (i < 0 || j < 0 || i >= gw || j >= gh ? -1e6 : S[j * gw + i]);
    if (Math.abs(L[0]) >= Math.abs(L[1])) {
      const from = dx > 0 ? gw - 1 : 0; const stepI = dx > 0 ? -1 : 1;
      for (let a = 0, i = from; a < gw; a++, i += stepI) {
        for (let j = 0; j < gh; j++) {
          const fj = j + dy; const j0 = Math.floor(fj); const t = fj - j0;
          const up = at(i + Math.sign(dx), j0) * (1 - t) + at(i + Math.sign(dx), j0 + 1) * t - drop;
          if (up > S[j * gw + i]) S[j * gw + i] = up;
        }
      }
    } else {
      const from = dy > 0 ? gh - 1 : 0; const stepJ = dy > 0 ? -1 : 1;
      for (let a = 0, j = from; a < gh; a++, j += stepJ) {
        for (let i = 0; i < gw; i++) {
          const fi = i + dx; const i0 = Math.floor(fi); const t = fi - i0;
          const up = at(i0, j + Math.sign(dy)) * (1 - t) + at(i0 + 1, j + Math.sign(dy)) * t - drop;
          if (up > S[j * gw + i]) S[j * gw + i] = up;
        }
      }
    }
  }

  const soft = 1 / (0.375 * light.softness);
  const level = water ? water.level : -Infinity;
  for (let k = 0; k < gw * gh; k++) {
    const h = base[k];
    const v = (S[k] - (h + (h <= level ? 0.0625 : 0.25))) * soft;
    groundShadow[k] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return maps;
}
