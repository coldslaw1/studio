// A Kiln scene as a world for the first-person engine (studio-engines/firstperson): the same
// terrain, materials, object meshes, water, light and shading settings the isometric picture is
// made from, as plain data in metres. Pure and browser-safe; nothing is rendered here.
//
//   import { createFpWorld, createFirstPerson } from './vendor/firstperson/index.js';
//   const world = createFpWorld(sceneFirstPersonWorld(scene));
import { sceneAtFrame, terrainHeight, validateScene } from './scene3d.js';
import { shapeMesh, SHAPE_NAMES } from './scene-shapes.js';
import { shapeSize } from './scene-shapes.js';
import { shadingOptions } from './scene-shade.js';
import { environment } from './scene-sky.js';
import { sceneStyle } from './scene-grade.js';
import { surfaceOfMaterial, SURFACE_NAMES } from './scene-materials.js';
import { GRASS_LAYERS, FLOWERS, WIND, plant, plantIn, windLean } from './scene-grass.js';

const ZS = 16; // Kiln height units per metre

/**
 * @param {object} sceneIn  A Kiln scene description (the JSON given to writeScene).
 * @param {object} [o]
 * @param {number} [o.frame]   Animation frame to take object positions from (default 0).
 * @param {string[]} [o.skip]  Shape names to leave out (for example the scene's own baked characters).
 * @param {object|false} [o.grass]  false for no grass; default: the same plants as Kiln's own pictures (scene-grass.js).
 * @param {object} [o.sky]     Backdrop colours { top, horizon, fg, glyph, density }. Default: Kiln's sky for the
 *   scene's time of day, with the scene's own sky glyph as faint specks (stars at night).
 * @returns {object} The `def` for createFpWorld: { ground, materials, triangles, colors, water, light, lights, grade, sky, hazeColor, haze }.
 */
export function sceneFirstPersonWorld(sceneIn, o = {}) {
  const errors = validateScene(sceneIn);
  if (errors.length) throw new Error('sceneFirstPersonWorld: invalid scene:\n- ' + errors.join('\n- '));
  if (!sceneIn.terrain) throw new Error('sceneFirstPersonWorld: the scene has no "terrain" to stand on');
  const scene = sceneAtFrame(sceneIn, o.frame ?? 0);
  const terrain = scene.terrain;
  const names = Object.keys(scene.materials);
  const materials = names.map((n) => ({ glyph: scene.materials[n].glyph, fg: scene.materials[n].fg, bg: scene.materials[n].bg }));

  // The ground exactly as the renderer builds it: patches of 8 x 8 units with a height every 2 units.
  const [npx, npy] = terrain.patches;
  const cols = npx * 4 + 1; const rows = npy * 4 + 1;
  const heights = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) heights[j * cols + i] = terrainHeight(terrain, i * 2, j * 2) / ZS;

  // One material for every 1 x 1 unit, by the same rules as buildSceneInput (terrain.cells, else terrain.paint).
  const paint = terrain.paint ?? [{ material: names[0] }];
  const cells = terrain.cells ?? null;
  const materialAt = (x, y) => {
    if (cells && x >= 0 && y >= 0 && x < cells.cols && y < cells.rows) return names.indexOf(cells.materials[cells.data[Math.floor(y) * cells.cols + Math.floor(x)]]);
    let id = names.indexOf(paint[0].material);
    const h = terrainHeight(terrain, x, y);
    for (const p of paint) {
      if (p.above !== undefined && h < p.above) continue;
      if (p.below !== undefined && h > p.below) continue;
      if (p.rect && !(x >= p.rect[0] && y >= p.rect[1] && x < p.rect[2] && y < p.rect[3])) continue;
      if (p.near && Math.hypot(x - p.near[0], y - p.near[1]) > p.near[2]) continue;
      id = names.indexOf(p.material);
    }
    return id;
  };
  const mc = npx * 8; const mr = npy * 8;
  const data = new Uint8Array(mc * mr);
  for (let j = 0; j < mr; j++) for (let i = 0; i < mc; i++) data[j * mc + i] = Math.max(0, materialAt(i + 0.5, j + 0.5));

  // Object meshes, turned, scaled and stood on the ground like the renderer does.
  const skip = o.skip ?? [];
  const triangles = []; const colors = [];
  const cache = new Map();
  for (const obj of scene.objects ?? []) {
    if (!SHAPE_NAMES.includes(obj.shape) || skip.includes(obj.shape)) continue;
    const key = JSON.stringify([obj.shape, obj.params ?? {}]);
    if (!cache.has(key)) cache.set(key, shapeMesh(obj.shape, obj.params ?? {}));
    const m = cache.get(key);
    const sc = obj.scale ?? 1;
    const c = Math.cos((obj.yaw ?? 0) * Math.PI / 180) * sc; const s = Math.sin((obj.yaw ?? 0) * Math.PI / 180) * sc;
    const z0 = terrainHeight(terrain, obj.at[0], obj.at[1]) + (obj.lift ?? 0);
    for (const f of m.faces) {
      for (const vi of f) { const v = m.verts[vi]; triangles.push(c * v[0] - s * v[1] + obj.at[0], s * v[0] + c * v[1] + obj.at[1], (v[2] * sc + z0) / ZS); }
      const v0 = m.verts[f[0]];
      colors.push(v0[3], v0[4], v0[5]);
    }
  }

  // Light, sky and weather exactly as Kiln's own lighting takes them: the time of day moves and
  // colours the sun, sets the sky and how dark it is; fog shortens how far one sees.
  const sh = shadingOptions(scene) ?? shadingOptions({ ...scene, shading: 'smooth' });
  const env = environment(scene, sh);
  const hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  const glow = 0.35 + 0.65 * Math.min(1, env.skyPower + env.sunPower * 0.4);
  const night = env.dark > 0.5;
  const sky = o.sky ?? {
    top: hex(env.skyTop), horizon: hex(env.skyBottom), fg: night ? '#ffffff' : hex(env.skyBottom.map((v) => v + (1 - v) * 0.5)),
    glyph: scene.sky && scene.sky !== 'clear' ? scene.sky.glyph ?? '.' : '.', density: night ? 0.006 : 0.01,
  };
  // Lamps: the scene's "lights", and when it is dark one for every lamp object (as Kiln lights them).
  const lights = (scene.lights ?? []).map((l) => ({ at: [l.at[0], l.at[1], (terrainHeight(terrain, l.at[0], l.at[1]) + (l.height ?? 32)) / ZS], color: l.color ?? '#ffc070', radius: l.radius ?? 8, power: l.power ?? 1 }));
  if (env.dark > 0.02) {
    for (const obj of scene.objects ?? []) {
      if (obj.shape !== 'lamp' || skip.includes('lamp')) continue;
      const sc = obj.scale ?? 1;
      const top = shapeSize('lamp', obj.params ?? {}).height * sc * 0.8; // the glass, under the cap
      lights.push({ at: [obj.at[0], obj.at[1], (terrainHeight(terrain, obj.at[0], obj.at[1]) + (obj.lift ?? 0)) / ZS + top], color: obj.params?.colors?.light ?? '#ffd27a', radius: 9 * sc, power: 1.25 * env.dark });
    }
  }
  const style = sceneStyle(scene);
  return {
    ground: { x0: 0, y0: 0, step: 2, cols, rows, heights, materials: { cols: mc, rows: mr, cell: 1, data } },
    materials,
    triangles: Float32Array.from(triangles),
    colors: Uint8Array.from(colors),
    // Kiln's sea colour, lighter and greener in the shallows, darker and bluer where it is deep
    water: typeof scene.water === 'number' ? { level: scene.water / ZS, shallow: hex([90 * 1.05 / 255, 106 * 1.2 / 255, 208 * 1.08 / 255]), deep: hex([90 * 0.6 / 255, 106 * 0.8 / 255, 208 * 0.88 / 255]) } : null,
    light: { dir: env.L, ambient: env.ambient, sun: hex(env.sun), sky: hex(env.sky), sunPower: env.sunPower, skyPower: env.skyPower, shadows: sh.shadows, occlusion: sh.occlusion, softness: sh.softness, saturation: sh.saturation, exposure: sh.exposure },
    lights,
    grass: grassDef(scene, names, sh, o.grass),
    grade: style ? { bands: style.bands ?? 0, contrast: style.contrast ?? 1, lift: style.lift ?? 0 } : undefined,
    sky,
    hazeColor: hex(env.fog > 0 ? env.fogColor.map((v) => v * glow) : env.skyBottom),
    haze: 260 / (1 + env.fog * 12),
  };
}

/**
 * Grass for the first-person world: the very plants of Kiln's own pictures (scene-grass.js), so a
 * meadow has the same thin and lush patches, tufts, blades and flowers in every view. How much
 * grows on a material is its "grass" amount, else 1 on grassy materials, times shading.grass.
 */
function grassDef(scene, names, sh, given) {
  if (given === false || !(sh.grass > 0)) return null;
  const GRASS = SURFACE_NAMES.indexOf('grass');
  const amounts = names.map((n) => { const m = scene.materials[n]; return Math.min(1.5, Math.max(0, (typeof m.grass === 'number' ? m.grass : surfaceOfMaterial(n, m) === GRASS ? 1 : 0) * sh.grass)); });
  const wind = scene.wind ?? WIND;
  const strength = Math.hypot(wind[0], wind[1]);
  return {
    amounts, wind, flowers: FLOWERS,
    plants: {
      layers: GRASS_LAYERS,
      plantIn(layer, ix, iy, amount, out) {
        if (!plantIn(layer, ix, iy, amount)) return false;
        out.x = plant.x; out.y = plant.y; out.height = plant.height; out.lean = plant.lean; out.tint = plant.tint; out.flower = plant.flower;
        return true;
      },
      // Kiln's wave runs once through a loop; here the clock keeps going, one wave every 4 seconds
      lean: (x, y, time) => (strength > 0 ? windLean(x, y, (time / 4) % 1, wind) / strength : 0),
    },
    ...(given ?? {}),
  };
}
