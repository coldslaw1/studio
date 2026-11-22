// The world the first-person view draws: a ground height grid, object triangles, water, materials,
// a sky and a light. Built once from plain data; the light maps (cast shadows, corner darkening)
// are worked out here so each frame only looks them up.
import { hexRgb, glyphBitmap } from './color.js';
import { buildLightMaps, castShadows } from './light.js';

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * @param {object} def
 * @param {object} def.ground  { x0?, y0?, step, cols, rows, heights }: heights[j * cols + i] is the height in
 *   metres at x = x0 + i * step, y = y0 + j * step. Optional `materials`: { cols, rows, cell?, data }, one index
 *   into def.materials for every `cell` x `cell` metres of ground (default cell 1), starting at x0, y0.
 * @param {Array<{glyph:string, fg:string, bg:string}>} def.materials  Ground materials (at least one).
 * @param {Float32Array|number[]} [def.triangles]  Objects: 9 numbers a triangle (x, y, z of three corners, metres).
 * @param {Uint8Array|number[]} [def.colors]       3 numbers a triangle (r, g, b, 0..255).
 * @param {{level:number, deep?:string, shallow?:string, reach?:number}|null} [def.water]  A flat sea at `level` metres.
 * @param {object} [def.light]  { dir: [x, y, z] toward the sun, ambient, sun, sky, sunPower, skyPower, shadows, occlusion, softness, saturation, exposure }.
 * @param {object} [def.sky]    { top, horizon, fg, glyph, density } colours of the backdrop and its specks.
 * @param {Array<{at:number[], color?:string, radius?:number, power?:number}>} [def.lights]  Lamps: at = [x, y, z] in metres; they light what is within
 *   `radius` metres (default 8) and faces them, and are blocked by what stands between.
 * @param {{bands?:number, contrast?:number, lift?:number}} [def.grade]  A look: light in steps (cel bands), contrast, a pastel lift.
 * @param {string} [def.hazeColor]  What distance fades into (default the sky's horizon colour).
 * @param {object} [def.grass]  Blades on grassy ground: { materials: [indexes that grow grass], density (tufts a square metre, default 6),
 *   height (metres, default 0.34), far (metres they reach, default 24), width, wind: [x, y], sway (0 = still), max (blades a frame, default 6000) }.
 *   Or the plants of another renderer, so both show the very same meadow: amounts (per material, 0 to 1.5) and
 *   plants: { layers: [{ cell, width, from, full }], plantIn(layer, ix, iy, amount, out) -> boolean filling out.x, y, height, lean, tint, flower;
 *   lean(x, y, time) -> push of the tip along the wind as a share of the height }, flowers: [null, [r, g, b], ...]. rom and ull are
 *   samples per metre: a layer shows from rom and is whole at ull, so blades give way to broad tufts further off.
 * @param {number} [def.mottle]  How uneven the ground's colour is, 0 to 0.5 (default 0.14).
 * @param {number} [def.haze]   Distance in metres at which things are half faded into the horizon (default 260; 0 = none).
 * @returns {object} world  Give it to createFirstPerson. Has heightAt(x, y) for placing the eye and characters.
 */
export function createFpWorld(def) {
  const g = def?.ground;
  if (!g || !(g.step > 0) || !Number.isInteger(g.cols) || !Number.isInteger(g.rows) || g.cols < 2 || g.rows < 2 || !g.heights || g.heights.length !== g.cols * g.rows) {
    throw new Error('createFpWorld: "ground" must be { step, cols, rows, heights } with cols x rows heights (at least 2 x 2)');
  }
  if (!Array.isArray(def.materials) || def.materials.length === 0) throw new Error('createFpWorld: "materials" must list at least one { glyph, fg, bg }');
  const { step, cols, rows } = g;
  const x0 = g.x0 ?? 0; const y0 = g.y0 ?? 0;
  const H = Float32Array.from(g.heights);
  const x1 = x0 + (cols - 1) * step; const y1 = y0 + (rows - 1) * step;

  /** Ground height in metres at x, y: exactly the drawn surface; held at the edges. */
  function heightAt(x, y) {
    const gx = Math.min(cols - 1, Math.max(0, (x - x0) / step)); const gy = Math.min(rows - 1, Math.max(0, (y - y0) / step));
    const i = Math.min(cols - 2, Math.floor(gx)); const j = Math.min(rows - 2, Math.floor(gy));
    const u = gx - i; const v = gy - j; const k = j * cols + i;
    const a = H[k]; const c = H[k + cols + 1];
    return u >= v ? a + u * (H[k + 1] - a) + v * (c - H[k + 1]) : a + u * (c - H[k + cols]) + v * (H[k + cols] - a);
  }

  // a smooth direction for every grid corner, so hills are lit without facets
  const GN = new Float32Array(cols * rows * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const at = (ii, jj) => H[Math.min(rows - 1, Math.max(0, jj)) * cols + Math.min(cols - 1, Math.max(0, ii))];
      const sx = (at(i + 1, j) - at(i - 1, j)) / (2 * step); const sy = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
      const l = Math.hypot(sx, sy, 1);
      GN.set([-sx / l, -sy / l, 1 / l], (j * cols + i) * 3);
    }
  }

  const materials = def.materials.map((m, i) => {
    if (typeof m?.glyph !== 'string') throw new Error(`createFpWorld: materials[${i}] needs a "glyph"`);
    return { glyph: m.glyph, code: m.glyph.codePointAt(0), fg: hexRgb(m.fg, `createFpWorld: materials[${i}].fg`), bg: hexRgb(m.bg, `createFpWorld: materials[${i}].bg`), bitmap: m.bitmap ?? glyphBitmap(m.glyph) };
  });
  const mm = g.materials ?? null;
  if (mm && (!mm.data || mm.data.length !== mm.cols * mm.rows)) throw new Error('createFpWorld: ground.materials must be { cols, rows, data } with cols x rows indexes');
  const matCell = mm?.cell ?? 1;

  const objTris = Float32Array.from(def.triangles ?? []);
  if (objTris.length % 9) throw new Error(`createFpWorld: "triangles" needs 9 numbers a triangle, got ${objTris.length}`);
  const nObj = objTris.length / 9;
  const objColors = Uint8Array.from(def.colors ?? new Array(nObj * 3).fill(200));
  if (objColors.length !== nObj * 3) throw new Error(`createFpWorld: "colors" needs 3 numbers a triangle (${nObj * 3}), got ${objColors.length}`);

  const water = def.water && Number.isFinite(def.water.level) ? { level: def.water.level, deep: hexRgb(def.water.deep ?? '#3c4a9c'), shallow: hexRgb(def.water.shallow ?? '#7f8fe0'), reach: num(def.water.reach, 500), ripple: num(def.water.ripple, 1) } : null;

  // all triangles in one list: ground first, then the sea, then objects; a triangle's place tells its kind
  const nGround = (cols - 1) * (rows - 1) * 2;
  const nWater = water ? 2 : 0;
  const tris = new Float32Array((nGround + nWater + nObj) * 9);
  let o = 0;
  const put = (x, y, z) => { tris[o++] = x; tris[o++] = y; tris[o++] = z; };
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const k = j * cols + i; const xa = x0 + i * step; const ya = y0 + j * step;
      put(xa, ya, H[k]); put(xa + step, ya, H[k + 1]); put(xa + step, ya + step, H[k + cols + 1]);
      put(xa, ya, H[k]); put(xa + step, ya + step, H[k + cols + 1]); put(xa, ya + step, H[k + cols]);
    }
  }
  if (water) {
    const r = water.reach; const z = water.level;
    put(x0 - r, y0 - r, z); put(x1 + r, y0 - r, z); put(x1 + r, y1 + r, z);
    put(x0 - r, y0 - r, z); put(x1 + r, y1 + r, z); put(x0 - r, y1 + r, z);
  }
  tris.set(objTris, o);
  const objNormals = new Float32Array(nObj * 3);
  for (let t = 0; t < nObj; t++) {
    const p = t * 9;
    const ux = objTris[p + 3] - objTris[p]; const uy = objTris[p + 4] - objTris[p + 1]; const uz = objTris[p + 5] - objTris[p + 2];
    const vx = objTris[p + 6] - objTris[p]; const vy = objTris[p + 7] - objTris[p + 1]; const vz = objTris[p + 8] - objTris[p + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    objNormals[t * 3] = nx / l; objNormals[t * 3 + 1] = ny / l; objNormals[t * 3 + 2] = nz / l;
  }

  const lt = def.light ?? {};
  const d = lt.dir ?? [1, 0.4, 1];
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  const light = {
    dir: [d[0] / dl, d[1] / dl, d[2] / dl],
    ambient: Math.min(1, Math.max(0, num(lt.ambient, 0.5))),
    sun: hexRgb(lt.sun ?? '#fff2d6').map((v) => v / 255 * num(lt.sunPower, 1)),
    sky: hexRgb(lt.sky ?? '#a8bce8').map((v) => v / 255 * num(lt.skyPower, 1)),
    shadows: num(lt.shadows, 0.75), occlusion: num(lt.occlusion, 0.5), softness: num(lt.softness, 1),
    saturation: num(lt.saturation, 0.8), exposure: num(lt.exposure, 0.95),
  };
  const sk = def.sky ?? {};
  const sky = { top: hexRgb(sk.top ?? '#5f7fc8'), horizon: hexRgb(sk.horizon ?? '#b9cdea'), fg: hexRgb(sk.fg ?? '#ffffff'), glyph: sk.glyph ?? '.', density: num(sk.density, 0.012) };
  sky.code = sky.glyph.codePointAt(0); sky.bitmap = glyphBitmap(sky.glyph);

  const lamps = (def.lights ?? []).map((l, i) => {
    if (!Array.isArray(l?.at) || l.at.length !== 3 || !l.at.every(Number.isFinite)) throw new Error(`createFpWorld: lights[${i}].at must be [x, y, z] in metres`);
    const radius = num(l.radius, 8);
    return { x: l.at[0], y: l.at[1], z: l.at[2], color: hexRgb(l.color ?? '#ffc070', `createFpWorld: lights[${i}].color`).map((v) => v / 255), r2: radius * radius, power: num(l.power, 1) };
  });
  const gr = def.grade ?? {};
  const grade = { bands: num(gr.bands, 0), contrast: num(gr.contrast, 1), lift: num(gr.lift, 0) };

  // grass: which materials grow it, and how
  const gs = def.grass;
  let grass = null;
  if (gs && gs !== false) {
    const on = new Uint8Array(materials.length);
    for (const i of gs.materials ?? (gs.amounts ? [] : [0])) { if (!(Number.isInteger(i) && i >= 0 && i < materials.length)) throw new Error(`createFpWorld: grass.materials must list indexes into "materials", got ${i}`); on[i] = 1; }
    // amounts: how much of the usual grass each material grows (0 none, 1 usual, up to 1.5)
    const amount = Float32Array.from(materials, (_, i) => (gs.amounts ? Math.min(1.5, Math.max(0, num(gs.amounts[i], 0))) : on[i]));
    for (let i = 0; i < amount.length; i++) on[i] = amount[i] > 0 ? 1 : 0;
    const src = gs.plants ?? null;
    if (src && !(Array.isArray(src.layers) && typeof src.plantIn === 'function')) throw new Error('createFpWorld: grass.plants must be { layers: [{ cell, width, from, full }], plantIn(layer, ix, iy, amount, out), lean?(x, y, time) }');
    const wd = gs.wind ?? [0.8, 0.3]; const wl = Math.hypot(wd[0], wd[1]) || 1;
    grass = { on, amount, source: src, flowers: gs.flowers ?? [], density: Math.min(40, Math.max(0.2, num(gs.density, 6))), height: num(gs.height, 0.34), far: Math.min(60, Math.max(4, num(gs.far, 24))), width: num(gs.width, 0.05), wind: [wd[0] / wl, wd[1] / wl], sway: num(gs.sway, 0.35), max: Math.round(num(gs.max, src ? 9000 : 6000)) };
  }

  const world = {
    grass, mottle: Math.min(0.5, Math.max(0, num(def.mottle, 0.14))),
    lamps, grade, hazeColor: hexRgb(def.hazeColor ?? sk.horizon ?? '#b9cdea'),
    ground: { x0, y0, x1, y1, step, cols, rows, heights: H, normals: GN, materials: mm ? { cols: mm.cols, rows: mm.rows, cell: matCell, data: Uint8Array.from(mm.data) } : null },
    materials, water, light, sky, haze: num(def.haze, 260),
    tris, nGround, nWater, nObj, objColors, objNormals,
    heightAt,
    /** Index into `materials` of the ground at x, y. */
    materialAt(x, y) {
      if (!mm) return 0;
      const i = Math.min(mm.cols - 1, Math.max(0, Math.floor((x - x0) / matCell))); const j = Math.min(mm.rows - 1, Math.max(0, Math.floor((y - y0) / matCell)));
      return world.ground.materials.data[j * mm.cols + i];
    },
    /** True where the ground is under the sea. */
    isWater: (x, y) => water !== null && heightAt(x, y) < water.level,
    /**
     * The sun or moon has moved: point the light along dir ([x, y, z] toward it, z above 0) and cast the
     * shadows again. A few milliseconds; do it when the light has turned a couple of degrees, not every
     * frame. The light's colours (world.light.sun, world.light.sky: 0..1, already times their strength),
     * the backdrop (world.sky.top, horizon, fg: 0..255), world.hazeColor and world.lamps may be changed
     * at any time without calling anything: every frame reads them afresh.
     */
    relight(dir) {
      if (!Array.isArray(dir) && !ArrayBuffer.isView(dir) || dir.length < 3 || !(dir[2] > 0)) throw new Error(`world.relight: dir must be [x, y, z] toward the light with z above 0, got ${JSON.stringify(dir)}`);
      const l = Math.hypot(dir[0], dir[1], dir[2]);
      light.dir[0] = dir[0] / l; light.dir[1] = dir[1] / l; light.dir[2] = dir[2] / l;
      castShadows(world, world.maps);
      return world;
    },
  };
  world.maps = buildLightMaps(world, { cellsPerMetre: def.light?.cellsPerMetre });
  return world;
}
