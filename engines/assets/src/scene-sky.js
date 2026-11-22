// The setting of a 3D scene: time of day (where the sun or moon is, what colour the light and the
// sky are, how dark it is), fog and mist, drifting cloud shadows, and the scene's lamps: lights
// that shine on what is around them. Pure and browser-safe.
import { parseHex } from './color.js';
import { ZS, ROLES } from './scene-raster.js';
import { noise2 } from './scene-materials.js';

export const TIMES = { night: 0, dawn: 6.5, day: 12, dusk: 18.5 };

// hour, height of the light above the horizon (degrees, null = the scene's own), turn of its
// compass direction (degrees), light colour and strength, sky colour and strength, fog colour,
// how dark it is (0 day, 1 night: lamps and windows are lit by this much), top and bottom of the sky
const KEYS = [
  [0, 52, 140, '#9db4ff', 0.3, '#3d4f96', 0.5, '#161d3a', 1, '#070a1c', '#1b2550'],
  [5, 52, 140, '#9db4ff', 0.3, '#3d4f96', 0.5, '#161d3a', 1, '#070a1c', '#1b2550'],
  [6.5, 13, -62, '#ffb27c', 0.85, '#9a94c8', 0.8, '#eabfae', 0.4, '#5a6aa8', '#f2b79a'],
  [9, null, 0, null, 1, null, 1, '#d3e2f0', 0, '#5a93d8', '#bcd9f0'],
  [16, null, 0, null, 1, null, 1, '#d3e2f0', 0, '#5a93d8', '#bcd9f0'],
  [18.5, 10, 62, '#ff8040', 0.85, '#7d6cab', 0.72, '#dc8f6e', 0.7, '#3b3a78', '#f08a50'],
  [20.5, 52, 140, '#9db4ff', 0.3, '#3d4f96', 0.5, '#161d3a', 1, '#070a1c', '#1b2550'],
  [24, 52, 140, '#9db4ff', 0.3, '#3d4f96', 0.5, '#161d3a', 1, '#070a1c', '#1b2550'],
];

/** The hour (0 to 24) a scene's "time" stands for, or null when it has none. */
export function sceneHour(scene) {
  const t = scene.time;
  if (t === undefined || t === null) return null;
  if (typeof t === 'number') return ((t % 24) + 24) % 24;
  return TIMES[t] ?? null;
}

/**
 * Light, sky and weather for a scene.
 * @param {object} scene
 * @param {{sun:string, sky:string}} opt  From shadingOptions (the daytime colours).
 * @returns {{L:number[], ambient:number, sun:number[], sunPower:number, sky:number[], skyPower:number,
 *   dark:number, fog:number, haze:number, fogColor:number[], clouds:number, skyTop:number[], skyBottom:number[], timed:boolean}}
 *   Colours are 0..1.
 */
export function environment(scene, opt) {
  const lt = scene.light ?? [1, 0.4, 1, 0.5];
  const ll = Math.hypot(lt[0], lt[1], lt[2]) || 1;
  let L = [lt[0] / ll, lt[1] / ll, lt[2] / ll];
  const rgb = (hex) => parseHex(hex).map((v) => v / 255);
  const env = {
    L, ambient: Math.min(1, Math.max(0, lt[3] ?? 0.5)), sun: rgb(opt.sun), sunPower: 1, sky: rgb(opt.sky), skyPower: 1, dark: 0,
    fog: 0, haze: 0, fogColor: rgb('#d3e2f0'), clouds: 0, skyTop: rgb('#5a93d8'), skyBottom: rgb('#bcd9f0'), timed: false,
  };
  const hour = sceneHour(scene);
  if (hour !== null) {
    let k = 0;
    while (k < KEYS.length - 2 && hour >= KEYS[k + 1][0]) k++;
    const a = KEYS[k]; const b = KEYS[k + 1];
    const f = Math.min(1, Math.max(0, (hour - a[0]) / (b[0] - a[0])));
    const mixN = (x, y) => x + (y - x) * f;
    const mixC = (x, y) => x.map((v, i) => v + (y[i] - v) * f);
    const ownUp = Math.asin(Math.min(1, Math.max(0.05, L[2]))) * 180 / Math.PI;
    const up = mixN(a[1] ?? ownUp, b[1] ?? ownUp) * Math.PI / 180;
    const turn = (Math.atan2(L[1], L[0]) * 180 / Math.PI + mixN(a[2], b[2])) * Math.PI / 180;
    L = [Math.cos(up) * Math.cos(turn), Math.cos(up) * Math.sin(turn), Math.sin(up)];
    Object.assign(env, {
      L, timed: true,
      sun: mixC(rgb(a[3] ?? opt.sun), rgb(b[3] ?? opt.sun)), sunPower: mixN(a[4], b[4]),
      sky: mixC(rgb(a[5] ?? opt.sky), rgb(b[5] ?? opt.sky)), skyPower: mixN(a[6], b[6]),
      fogColor: mixC(rgb(a[7]), rgb(b[7])), dark: mixN(a[8], b[8]),
      skyTop: mixC(rgb(a[9]), rgb(b[9])), skyBottom: mixC(rgb(a[10]), rgb(b[10])),
    });
  }
  const at = scene.atmosphere ?? {};
  const num = (v) => (typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 0);
  env.fog = num(at.fog); env.haze = num(at.haze); env.clouds = num(at.clouds); env.fireflies = num(at.fireflies);
  if (at.fogColor) env.fogColor = rgb(at.fogColor);
  return env;
}

/** Messages for a scene's "time", "atmosphere" and "lights" keys that are not right. */
export function validateSetting(scene) {
  const errors = [];
  if (scene.time !== undefined && sceneHour(scene) === null) errors.push(`"time" must be ${Object.keys(TIMES).map((t) => `"${t}"`).join(', ')} or an hour from 0 to 24.`);
  if (typeof scene.time === 'number' && !(scene.time >= 0 && scene.time <= 24)) errors.push('"time" as a number must be an hour from 0 to 24.');
  const at = scene.atmosphere;
  if (at !== undefined) {
    if (typeof at !== 'object' || at === null || Array.isArray(at)) errors.push('"atmosphere" must be an object such as { "fog": 0.4, "haze": 0.3, "clouds": 0.5 }.');
    else {
      for (const k of ['fog', 'haze', 'clouds', 'fireflies']) if (at[k] !== undefined && !(typeof at[k] === 'number' && at[k] >= 0 && at[k] <= 1)) errors.push(`atmosphere.${k} must be a number from 0 to 1.`);
      if (at.fogColor !== undefined) { try { parseHex(at.fogColor); } catch { errors.push('atmosphere.fogColor must be a hex colour.'); } }
    }
  }
  if (scene.wind !== undefined && !(Array.isArray(scene.wind) && scene.wind.length === 2 && scene.wind.every((v) => typeof v === 'number'))) errors.push('"wind" must be [x, y] along the ground, for example [0.8, 0.3]; its length is its strength.');
  if (scene.lights !== undefined && !Array.isArray(scene.lights)) errors.push('"lights" must be a list such as [{ "at": [40, 36], "height": 40, "color": "#ffc070", "radius": 8 }].');
  for (const [i, l] of (Array.isArray(scene.lights) ? scene.lights : []).entries()) {
    if (!Array.isArray(l.at) || l.at.length !== 2) errors.push(`lights[${i}]: "at" must be [x, y].`);
    if (l.color !== undefined) { try { parseHex(l.color); } catch { errors.push(`lights[${i}]: "color" must be a hex colour.`); } }
    for (const k of ['height', 'radius', 'power', 'flicker']) if (l[k] !== undefined && typeof l[k] !== 'number') errors.push(`lights[${i}]: "${k}" must be a number.`);
  }
  return errors;
}

/**
 * Cloud shadow at a ground point: 0 = open sky, 1 = under a cloud. The clouds drift, and the
 * drift closes its loop (two copies one loop apart are faded into each other).
 */
export function cloudAt(x, y, t) {
  const one = (ox) => {
    const v = 0.62 * noise2((x + ox) / 11, y / 11 + 4) + 0.38 * noise2((x + ox) / 4.5 + 9, y / 4.5);
    return v < 0.46 ? 0 : v > 0.62 ? 1 : (v - 0.46) / 0.16;
  };
  if (!(t >= 0)) return one(0);
  return one(t * 14) * (1 - t) + one((t - 1) * 14) * t;
}

/**
 * The lights of a scene: the ones listed under "lights", plus (when it is dark) one for every lamp
 * and every window of the scene's objects.
 * @param {object} scene  At one frame.
 * @param {object} geo    From sceneGeometry.
 * @param {number} dark   0 (day) to 1 (night), from environment().
 * @param {(x:number, y:number) => number} groundAt  Ground height at a point.
 * @returns {{list: Array<{x:number, y:number, z:number, color:number[], radius:number, power:number, flicker:number, phase:number, glow:number}>, ofTri: Int32Array}}
 *   z in height units, colour 0..1. ofTri: for each triangle, the light it belongs to (it glows) or -1.
 */
export function collectLights(scene, geo, dark, groundAt) {
  const list = [];
  const ofTri = new Int32Array(geo.count).fill(-1);
  for (const [i, l] of (scene.lights ?? []).entries()) {
    list.push({
      x: l.at[0], y: l.at[1], z: groundAt(l.at[0], l.at[1]) + (l.height ?? 32),
      color: parseHex(l.color ?? '#ffc070').map((v) => v / 255), radius: l.radius ?? 8, power: l.power ?? 1,
      flicker: l.flicker ?? 0.5, phase: i * 2.4, glow: 0,
    });
  }
  if (dark > 0.02) {
    const lamp = ROLES.indexOf('light'); const win = ROLES.indexOf('window');
    // triangles of one lamp or one window sit together: gather them into groups by distance
    const groups = [];
    for (let t = geo.ground; t < geo.count; t++) {
      const r = geo.role[t];
      if (r !== lamp && r !== win) continue;
      const o = t * 9; const P = geo.P;
      const cx = (P[o] + P[o + 3] + P[o + 6]) / 3; const cy = (P[o + 1] + P[o + 4] + P[o + 7]) / 3; const cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
      let g = groups.find((q) => q.obj === geo.obj[t] && q.role === r && Math.hypot(q.x / q.n - cx, q.y / q.n - cy, (q.z / q.n - cz) / ZS) < 1.1);
      if (!g) { g = { obj: geo.obj[t], role: r, x: 0, y: 0, z: 0, n: 0, tris: [] }; groups.push(g); }
      g.x += cx; g.y += cy; g.z += cz; g.n++; g.tris.push(t);
    }
    const objects = scene.objects ?? [];
    for (const [k, g] of groups.entries()) {
      const x = g.x / g.n; const y = g.y / g.n; const z = g.z / g.n;
      const o = objects[g.obj - 1] ?? { at: [x, y] };
      const scale = o.scale ?? 1;
      const index = list.length;
      const seed = Math.abs(Math.sin(g.obj * 12.9898 + k * 78.233) * 43758.5453) % 1;
      if (g.role === lamp) {
        const c = geo.C.subarray(g.tris[0] * 3, g.tris[0] * 3 + 3);
        list.push({ x, y, z, color: [c[0] / 255, c[1] / 255, c[2] / 255], radius: 9 * scale, power: 1.25 * dark, flicker: 0.6, phase: seed * 6.28, glow: dark });
      } else {
        if (seed < 0.15) continue; // nobody home behind this one
        // a window lights the ground in front of it: step out from the wall, away from the middle of the building
        const dx = x - o.at[0]; const dy = y - o.at[1]; const dl = Math.hypot(dx, dy) || 1;
        list.push({ x: x + dx / dl * 0.9, y: y + dy / dl * 0.9, z, color: [1, 0.77, 0.43], radius: 4.5 * scale, power: 0.7 * dark, flicker: 0.25, phase: seed * 6.28, glow: dark });
      }
      for (const t of g.tris) ofTri[t] = index;
    }
  }
  return { list, ofTri };
}

/**
 * Fireflies for a dark scene: small lights over the land that drift and blink. The same ones every
 * time (placed by a fixed hash), and their movement closes its loop.
 * @param {number} amount  0..1, from atmosphere.fireflies.
 * @param {number[]} bounds  [x0, y0, z0, x1, y1, z1] of the scene.
 * @param {(x:number, y:number) => number} groundAt
 * @param {number} t  0..1 through the loop, or -1 for a still picture.
 * @param {number|null} water  Sea level: none fly over water.
 * @returns {Array<{x:number, y:number, z:number, glow:number}>}  z in height units, glow 0..1.
 */
export function fireflies(amount, bounds, groundAt, t, water = null) {
  const out = [];
  const count = Math.round(amount * (bounds[3] - bounds[0]) * (bounds[4] - bounds[1]) / 9);
  const rnd = (k, salt) => Math.abs(Math.sin(k * 127.1 + salt * 311.7) * 43758.5453) % 1;
  const p = t >= 0 ? 2 * Math.PI * t : 0;
  for (let k = 0; k < count; k++) {
    const hx = bounds[0] + rnd(k, 1) * (bounds[3] - bounds[0]); const hy = bounds[1] + rnd(k, 2) * (bounds[4] - bounds[1]);
    const ground = groundAt(hx, hy);
    if (water !== null && ground <= water + 1) continue;
    const ph = rnd(k, 3) * 6.283;
    const x = hx + 0.5 * Math.sin(p + ph); const y = hy + 0.5 * Math.cos(p * 2 + ph * 1.7);
    const z = ground + 8 + 14 * rnd(k, 4) + 3 * Math.sin(p * 2 + ph);
    const blink = t >= 0 ? Math.max(0, Math.sin(p * (1 + (k % 3)) + ph)) ** 2 : rnd(k, 5);
    if (blink > 0.05) out.push({ x, y, z, glow: blink });
  }
  return out;
}

/** Brightness of a light at time t (0..1 through the loop; steady for a still picture). */
export function flickerOf(light, t) {
  if (!(t >= 0) || !light.flicker) return 1;
  const p = 2 * Math.PI * t;
  return 1 + light.flicker * (0.13 * Math.sin(3 * p + light.phase) + 0.09 * Math.sin(7 * p + light.phase * 2.3) + 0.05 * Math.sin(13 * p + light.phase * 0.7));
}
