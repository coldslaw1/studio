// Kiln's own lighting for 3D scenes. The Asciicker renderer is asked for unlit colours, and this
// pass lights every character cell in full colour; for pictures too fine for the renderer, Kiln
// draws and lights every pixel itself (shadePicture). The geometry work (which triangle is where,
// shadows, sky light) is in scene-raster.js and scene-light.js, the surface patterns in
// scene-materials.js. Pure and browser-safe.
import { parseHex } from './color.js';
import { fieldAt, ROLES, ZS, lightMap, rasterise } from './scene-raster.js';
import { prepareScene, reconcile, sunVisibility, skyVisibility, looker, sample } from './scene-light.js';
import { sceneStyle, banded, pullTable, pulled, edgeMask } from './scene-grade.js';
import { grassPlants, drawGrass, GRASS_LAYERS, FLOWERS } from './scene-grass.js';
import { environment, collectLights, flickerOf, cloudAt, fireflies } from './scene-sky.js';
import { texture, tex, waterSurface, wave, surfaceOfRole, surfaceOfMaterial, noise2, SURFACE_NAMES } from './scene-materials.js';

/** Shading settings with defaults filled in, or null for the renderer's own ("classic") lighting. */
export function shadingOptions(scene) {
  const s = scene.shading ?? 'smooth';
  if (s === 'classic' || s === false) return null;
  const o = typeof s === 'object' ? s : {};
  const st = sceneStyle(scene)?.shading ?? {}; // a style moves the defaults; the scene's own values still win
  const num = (v, d) => (typeof v === 'number' ? v : d);
  return {
    shadows: num(o.shadows, st.shadows ?? (scene.terrain ? 0.75 : 0.3)), // 0 = none, 1 = black shadows; sprites (no terrain) get gentler defaults
    occlusion: num(o.occlusion, (st.occlusion ?? 0.5) * (scene.terrain ? 1 : 0.3)), // darkening in corners, under eaves and at the foot of walls
    softness: num(o.softness, st.softness ?? 1),      // shadow edge softness; 0 = hard
    sun: o.sun ?? '#fff2d6',           // light colour
    sky: o.sky ?? '#a8bce8',           // colour of the fill light in shadow
    water: o.water !== false,          // tint water by depth, ripples and shore foam
    materials: num(o.materials === false ? 0 : o.materials === true ? 1 : o.materials, st.materials ?? 1), // strength of surface patterns (tiles, boards, grass mottling); 0 = flat colour
    gloss: num(o.gloss, st.gloss ?? 1),            // strength of highlights on water, glass, metal and roofs; 0 = matt
    grass: num(o.grass === false ? 0 : o.grass === true ? 1 : o.grass, st.grass ?? 1), // blades and tufts on grassy ground, 0 to 1.5; 0 = none
    bloom: num(o.bloom, st.bloom ?? 1),            // halo around lit lamps and windows; 0 = none
    saturation: num(o.saturation, st.saturation ?? 0.8), // 1 = the materials' full colour
    smoothEdges: o.smoothEdges !== false, // pictures drawn by Kiln: soften stair-steps along edges
    exposure: num(o.exposure, st.exposure ?? 0.95),    // overall brightness
  };
}

const SEA = [90, 106, 208]; // the sea's own colour when Kiln draws the picture
const WATER = SURFACE_NAMES.indexOf('water');

/** Which ground material is at x, y (index into the material list), by the scene's paint rules. */
function painter(scene, field) {
  const names = Object.keys(scene.materials ?? {});
  const paint = scene.terrain?.paint ?? [{ material: names[0] }];
  const rules = paint.map((p) => ({ id: Math.max(0, names.indexOf(p.material)), above: p.above, below: p.below, rect: p.rect, near: p.near }));
  // terrain.cells: a material for every 1 x 1 unit of ground, given by the caller (it wins over the rules)
  const cells = scene.terrain?.cells ?? null;
  const cellId = cells ? cells.materials.map((m) => Math.max(0, names.indexOf(m))) : null;
  return (x, y, wobble) => {
    const px = x + wobble * 0.5; const py = y - wobble * 0.5;
    if (cells && px >= 0 && py >= 0 && px < cells.cols && py < cells.rows) return cellId[cells.data[Math.floor(py) * cells.cols + Math.floor(px)]];
    let id = rules[0].id;
    const h = fieldAt(field, field.H, x, y) + wobble * 2.5;
    for (let k = 0; k < rules.length; k++) {
      const p = rules[k];
      if (p.above !== undefined && h < p.above) continue;
      if (p.below !== undefined && h > p.below) continue;
      if (p.rect && !(px >= p.rect[0] && py >= p.rect[1] && px < p.rect[2] && py < p.rect[3])) continue;
      if (p.near && Math.hypot(px - p.near[0], py - p.near[1]) > p.near[2]) continue;
      id = p.id;
    }
    return id;
  };
}

/** Blur a w x h picture of `ch` channels in place with a box of the given radius, three times (close to a soft round blur). */
function blur(buf, w, h, ch, radius) {
  const tmp = new Float32Array(buf.length);
  const k = 1 / (2 * radius + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) for (let c = 0; c < ch; c++) {
      let sum = 0; const row = y * w;
      for (let i = -radius; i <= radius; i++) sum += buf[(row + Math.min(w - 1, Math.max(0, i))) * ch + c];
      for (let x = 0; x < w; x++) { tmp[(row + x) * ch + c] = sum * k; sum += buf[(row + Math.min(w - 1, x + radius + 1)) * ch + c] - buf[(row + Math.max(0, x - radius)) * ch + c]; }
    }
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += tmp[(Math.min(h - 1, Math.max(0, i)) * w + x) * ch + c];
      for (let y = 0; y < h; y++) { buf[(y * w + x) * ch + c] = sum * k; sum += tmp[(Math.min(h - 1, y + radius + 1) * w + x) * ch + c] - tmp[(Math.max(0, y - radius) * w + x) * ch + c]; }
    }
  }
}

/**
 * The lighting loop shared by both kinds of picture. Calls
 * `emit(i, kind, mr, mg, mb, ar, ag, ab, mat)` for every sample: the colour of whatever is there
 * is multiplied by mr, mg, mb, then ar, ag, ab (0 to 255) is added. mat is the ground material
 * index at the sample (-1 on objects). For empty samples (kind 0) ar, ag, ab is the sky colour
 * when the scene has a time of day, else -1.
 * @param {object} env  From environment().
 * @param {number} t    Animation time 0..1 for looping scenes, -1 for a still picture.
 */
function light(prep, scene, opt, env, t, emit) {
  const { w, h, field, water, geo, S } = prep;
  const n = w * h;
  const L = env.L; const ambient = env.ambient;
  const sunVis = opt.shadows > 0 ? sunVisibility(prep, L, opt.softness) : null;
  const skyVis = opt.occlusion > 0 ? skyVisibility(prep) : null;
  const sun = env.sun; const sky = env.sky;
  const sunK = (1.25 - ambient * 0.5) * env.sunPower; const skyK = (0.45 + ambient * 0.5) * env.skyPower;
  // halfway between the light and the eye: where highlights sit
  const V = S.toCamera;
  const hl = Math.hypot(L[0] + V[0], L[1] + V[1], L[2] + V[2]) || 1;
  const Hx = (L[0] + V[0]) / hl; const Hy = (L[1] + V[1]) / hl; const Hz = (L[2] + V[2]) / hl;
  const roleSurface = ROLES.map(surfaceOfRole);
  const matSurface = Object.entries(scene.materials ?? {}).map(([name, m]) => surfaceOfMaterial(name, m));
  const paint = field && matSurface.length ? painter(scene, field) : null;
  const ppu = S.perUnit;
  const strength = opt.materials;
  // grass: how much grows on each ground material (its "grass", or 1 for grassy ones), and the test for a plant in front of a sample
  const GRASS = SURFACE_NAMES.indexOf('grass');
  const grassOf = Object.values(scene.materials ?? {}).map((m, k) => Math.min(1.5, Math.max(0, (typeof m.grass === 'number' ? m.grass : matSurface[k] === GRASS ? 1 : 0) * opt.grass)));
  // a plant's colour: the material's bg x 0.62 at the foot, its fg at the tip (as multipliers of the colour the ground is drawn in)
  const grassTone = Object.values(scene.materials ?? {}).map((m) => { const bg = parseHex(m.bg); const fg = parseHex(m.fg); return bg.map((v, k) => { const base = Math.max(1, v + (fg[k] - v) * 0.15); return [v * 0.62 / base, fg[k] / base]; }); });
  let grass = null; let plants = null;
  if (paint && grassOf.some((g) => g > 0) && ppu > Math.min(...GRASS_LAYERS.map((l) => l.from))) {
    const edgeX = (field.w - 1) / field.g; const edgeY = (field.h - 1) / field.g;
    const matAt = (x, y) => paint(x, y, noise2(x * 0.55, y * 0.55) - 0.5);
    // the plants of this ground are found once (they only sway from frame to frame); none under water
    plants = prep.cache['grass:' + opt.grass + ':' + (ppu > GRASS_LAYERS[1].from)] ??= (() => {
      const found = grassPlants(0, 0, edgeX, edgeY, { layers: GRASS_LAYERS.filter((l) => ppu > l.from).map((l) => l.name), amount: (x, y) => (water !== null && fieldAt(field, field.H, x, y) <= water + 1 ? 0 : grassOf[matAt(x, y)]) });
      found.mat = Uint8Array.from(found.x, (x, k) => matAt(x, found.y[k]));
      return found;
    })();
    const tris = prep.tri; const zs = prep.z;
    grass = drawGrass(plants, S, w, h, (x, y) => fieldAt(field, field.H, x, y), (i) => tris[i] >= 0 && tris[i] < geo.ground && (water === null || zs[i] > water), t, Array.isArray(scene.wind) ? scene.wind : undefined);
  }
  const look = prep.look;
  const s = prep.sample;

  // lamps: found once per frame, sorted into ground squares so a sample only meets the ones near it
  const lamps = collectLights(scene, geo, env.dark, (x, y) => (field ? fieldAt(field, field.H, x, y) : 0));
  const lights = lamps.list;
  const bright = lights.map((l) => flickerOf(l, t) * l.power);
  const b = geo.bounds;
  const CELL = 3; const gx0 = b[0] - 1; const gy0 = b[1] - 1;
  const gw = lights.length ? Math.max(1, Math.ceil((b[3] - b[0] + 2) / CELL)) : 0; const gh = lights.length ? Math.max(1, Math.ceil((b[4] - b[1] + 2) / CELL)) : 0;
  const bins = new Array(gw * gh).fill(null);
  lights.forEach((l, k) => {
    for (let j = Math.max(0, Math.floor((l.y - l.radius - gy0) / CELL)); j <= Math.min(gh - 1, Math.floor((l.y + l.radius - gy0) / CELL)); j++) {
      for (let i = Math.max(0, Math.floor((l.x - l.radius - gx0) / CELL)); i <= Math.min(gw - 1, Math.floor((l.x + l.radius - gx0) / CELL)); i++) (bins[j * gw + i] ??= []).push(k);
    }
  });
  // the scene seen from straight above: how high things stand, for what blocks a lamp's light
  let top = null;
  if (lights.length) {
    top = prep.cache.top ??= (() => {
      const map = lightMap([0, 0, 1], b, Math.round(Math.min(1024, Math.max(128, Math.hypot(b[3] - b[0], b[4] - b[1]) * 8))));
      return { map, D: rasterise(geo, map, map.width, map.height, { depthOnly: true }).depth };
    })();
  }
  const topAt = (x, y) => {
    const m = top.map; const iu = (m.u[0] + m.u[1] * x + m.u[2] * y) | 0; const iv = (m.v[0] + m.v[1] * x + m.v[2] * y) | 0;
    return iu < 0 || iv < 0 || iu >= m.width || iv >= m.height ? -1e6 : top.D[iv * m.width + iu] * ZS;
  };

  // glow: what shines by itself (lamp glass, lit windows) is gathered small, blurred, and added back as a halo
  let glow = null; let gstep = 1; let gcw = 0; let gch = 0;
  // fireflies: each is a dot of a few samples, drawn where nothing is in front of it
  let sparks = null;
  if (env.fireflies > 0 && env.dark > 0.3 && Number.isFinite(b[0])) {
    const flies = fireflies(env.fireflies, b, (x, y) => (field ? fieldAt(field, field.H, x, y) : 0), t, water);
    const rad = Math.max(0.5, ppu * 0.05);
    for (const f of flies) {
      const cx = (S.c0 + S.ax * (f.x - S.ox) + S.ay * (f.y - S.oy) + S.az * (f.z - S.oz)) * S.px;
      const cy = (S.r0 + S.bx * (f.x - S.ox) + S.by * (f.y - S.oy) + S.bz * (f.z - S.oz)) * S.px;
      if (!(cx >= 1 && cy >= 1 && cx < w - 1 && cy < h - 1)) continue;
      // hidden when the surface seen there is nearer the eye than the firefly
      if (look(Math.floor(cy) * w + Math.floor(cx)) !== 0 && S.bx * s.x + S.by * s.y > S.bx * f.x + S.by * f.y + 0.5) continue;
      sparks ??= new Map();
      for (let y = Math.floor(cy - rad); y <= Math.floor(cy + rad); y++) for (let x = Math.floor(cx - rad); x <= Math.floor(cx + rad); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rad + 0.3) continue;
        sparks.set(y * w + x, Math.max(sparks.get(y * w + x) ?? 0, f.glow * (env.dark - 0.3) / 0.7));
      }
    }
  }
  const glowing = opt.bloom > 0 && (lights.some((l) => l.glow > 0) || sparks);
  if (glowing) {
    gstep = Math.max(1, Math.ceil(Math.sqrt(n / 200000)));
    gcw = Math.ceil(w / gstep); gch = Math.ceil(h / gstep);
    glow = new Float32Array(gcw * gch * 3);
    const tri = prep.tri; const share = 1 / (gstep * gstep);
    for (let i = 0; i < n; i++) {
      const tr = tri[i];
      if (tr < 0 || lamps.ofTri[tr] < 0) continue;
      const k = lamps.ofTri[tr]; const l = lights[k];
      const e = 255 * l.glow * (bright[k] / (l.power || 1)) * share;
      const o = (Math.floor(Math.floor(i / w) / gstep) * gcw + Math.floor((i % w) / gstep)) * 3;
      glow[o] += e * l.color[0]; glow[o + 1] += e * l.color[1]; glow[o + 2] += e * l.color[2];
    }
    if (sparks) for (const [i, v] of sparks) { const o = (Math.floor(Math.floor(i / w) / gstep) * gcw + Math.floor((i % w) / gstep)) * 3; glow[o] += 150 * v * share; glow[o + 1] += 255 * v * share; glow[o + 2] += 90 * v * share; }
    blur(glow, gcw, gch, 3, Math.max(1, Math.round(0.4 * ppu / gstep)));
  }

  // the scene's style: stepped light, outlines, grain
  const style = sceneStyle(scene);
  const bands = style?.bands ?? 0; const grain = style?.grain ?? 0;
  const lineW = (style?.outline ?? 0) * ppu;
  const edge = lineW >= 0.7 ? (prep.cache['edge:' + Math.round(lineW)] ??= edgeMask(prep.tri, geo, w, h, Math.max(1, Math.round(lineW)))) : null;
  const ink = style?.ink ?? 0;

  // fog thickens up the picture (further away) and mist lies in the low ground
  const misty = env.fog > 0 || env.haze > 0;
  const low = water ?? (Number.isFinite(b[2]) ? b[2] : 0);
  const rowsS = h; const pxs = S.px;

  for (let i = 0; i < n; i++) {
    const kind = look(i);
    if (kind === 0) {
      if (!env.timed) { emit(i, 0, 1, 1, 1, -1, -1, -1, -1); continue; }
      // the sky: lighter towards the horizon, with stars when it is dark
      const cx = i % w; const cy = (i - cx) / w;
      const f = Math.min(1, cy / h * 1.3);
      let r = 255 * (env.skyTop[0] + (env.skyBottom[0] - env.skyTop[0]) * f); let g = 255 * (env.skyTop[1] + (env.skyBottom[1] - env.skyTop[1]) * f); let bl = 255 * (env.skyTop[2] + (env.skyBottom[2] - env.skyTop[2]) * f);
      if (env.dark > 0.5) {
        const sx = Math.floor(cx / pxs); const sy = Math.floor(cy / pxs);
        const hsh = Math.abs(Math.sin(sx * 127.1 + sy * 311.7) * 43758.5453) % 1;
        if (hsh > 0.994) { const tw = t >= 0 ? 0.7 + 0.3 * Math.sin(2 * Math.PI * (t * (1 + Math.floor(hsh * 3000) % 3)) + hsh * 500) : 1; const st = 200 * (env.dark - 0.5) * 2 * tw * (hsh - 0.994) / 0.006; r += st; g += st; bl += st; }
      }
      emit(i, 0, 1, 1, 1, r, g, bl, -1);
      continue;
    }
    let nx = s.nx; let ny = s.ny; let nz = s.nz;
    let mat = -1; let tl = 1; let tw = 0; let gloss = 0; let shine = 8; let foam = 0; let depth = 1; let flower = 0; let grown = null; let up = 0;
    if (kind === 2) {
      if (paint) mat = paint(s.x, s.y, 0);
      depth = Math.min(1, Math.max(0, (water - s.floor) / 24));
      if (opt.water) {
        waterSurface(s.x, s.y, water - s.floor, ppu, t);
        nx = wave.nx; ny = wave.ny; nz = 1; const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l; nz /= l;
        tl = 1 + (wave.l - 1) * strength; foam = wave.foam; gloss = 0.55; shine = 48;
      }
    } else {
      let id = 0; let rise = 0;
      if (s.tri >= geo.ground) { id = roleSurface[geo.role[s.tri]]; rise = (s.z - geo.base[geo.obj[s.tri]]) / ZS; }
      else if (s.tri >= 0 && paint) { mat = paint(s.x, s.y, noise2(s.x * 0.55, s.y * 0.55) - 0.5); id = matSurface[mat]; }
      if (strength > 0) {
        texture(id, s.x, s.y, s.z / ZS, nx, ny, nz, ppu, rise, t);
        tl = 1 + (tex.l - 1) * strength; tw = tex.w * strength; gloss = tex.gloss; shine = tex.shine;
      }
      // a blade or tuft drawn over this bit of ground: it has the colour of the ground it grows from
      if (grass && grass.id[i] >= 0) {
        const k = grass.id[i]; const a = grass.strength[plants.layer[k]];
        if (a > 0.45) { mat = plants.mat[k]; grown = grassTone[mat]; up = grass.up[i] / 255; tl = 0.82 + 0.36 * plants.tint[k]; tw = 0; flower = plants.flower[k] && up > 0.78 ? plants.flower[k] : 0; } else tl *= 1 - 0.3 * a;
        gloss = 0;
      }
    }
    const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    let lit = sunVis ? 1 - opt.shadows * (1 - sunVis[i] / 255) : 1;
    if (env.clouds > 0) lit *= 1 - 0.7 * env.clouds * cloudAt(s.x, s.y, t);
    const occ = skyVis && kind === 1 ? Math.min(0.9, opt.occlusion * 1.5 * (1 - skyVis[i] / 255)) : 0;
    const direct = ndl * lit * sunK;
    const fill = skyK * (1 - occ) * (0.8 + 0.2 * nz);
    let lr = sun[0] * direct + sky[0] * fill; let lg = sun[1] * direct + sky[1] * fill; let lb = sun[2] * direct + sky[2] * fill;
    let ar = 0; let ag = 0; let ab = 0;
    if (gloss > 0 && opt.gloss > 0 && ndl > 0) {
      const ndh = nx * Hx + ny * Hy + nz * Hz;
      if (ndh > 0) { const sp = 255 * gloss * opt.gloss * ndh ** shine * lit * env.sunPower; ar = sp * sun[0]; ag = sp * sun[1]; ab = sp * sun[2]; }
    }
    if (lights.length) {
      const bi = Math.floor((s.x - gx0) / CELL); const bj = Math.floor((s.y - gy0) / CELL);
      const near = bi >= 0 && bj >= 0 && bi < gw && bj < gh ? bins[bj * gw + bi] : null;
      if (near) {
        for (let q = 0; q < near.length; q++) {
          const k = near[q]; const l = lights[k];
          const dx = l.x - s.x; const dy = l.y - s.y; const dz = (l.z - s.z) / ZS;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= l.radius * l.radius) continue;
          const d = Math.sqrt(d2) || 1e-3;
          const fall = 1 - d2 / (l.radius * l.radius);
          // facing the lamp counts, with a little wrap so nothing near a lamp is quite black
          const face = Math.max(0, (nx * dx + ny * dy + nz * dz) / d) * 0.85 + 0.15;
          // walk from the sample to the lamp: anything standing higher than the ray blocks it
          let open = 1;
          const flatD = Math.hypot(dx, dy);
          if (flatD > 1.2) {
            // (stopping short of the lamp, so its own post and cap do not count)
            for (let m = 1; m <= 5 && open > 0; m++) {
              const f = 0.1 + (0.9 - 0.9 / flatD) * m / 5.5;
              if (topAt(s.x + dx * f, s.y + dy * f) > s.z + dz * f * ZS + 3) open -= 0.5;
            }
            if (open < 0) open = 0;
          }
          const e = bright[k] * fall * fall * face * open * (kind === 1 ? 1 - occ * 0.5 : 1) * 1.5;
          lr += l.color[0] * e; lg += l.color[1] * e; lb += l.color[2] * e;
          if (gloss > 0 && opt.gloss > 0 && kind === 2) { const sp = 90 * e * gloss * opt.gloss; ar += sp * l.color[0]; ag += sp * l.color[1]; ab += sp * l.color[2]; }
        }
      }
      // the lamp glass or lit window itself
      const own = s.tri >= 0 ? lamps.ofTri[s.tri] : -1;
      if (own >= 0) { const l = lights[own]; const e = 235 * l.glow * bright[own] / (l.power || 1); ar += e * l.color[0]; ag += e * l.color[1]; ab += e * l.color[2]; }
    }
    if (bands > 0) { const lum = 0.3 * lr + 0.59 * lg + 0.11 * lb; const k = banded(lum, bands) / Math.max(lum, 1e-4); lr *= k; lg *= k; lb *= k; }
    let mr = lr * tl * (1 + tw); let mg = lg * tl; let mb = lb * tl * (1 - tw);
    if (grown) { mr *= grown[0][0] + (grown[0][1] - grown[0][0]) * up; mg *= grown[1][0] + (grown[1][1] - grown[1][0]) * up; mb *= grown[2][0] + (grown[2][1] - grown[2][0]) * up; }
    if (flower) { const f = FLOWERS[flower]; ar += f[0] * lr * 0.9; ag += f[1] * lg * 0.9; ab += f[2] * lb * 0.9; mr *= 0.1; mg *= 0.1; mb *= 0.1; }
    if (kind === 2 && opt.water) {
      // deeper water is darker and bluer, shallows are lighter and greener
      mr *= 1.05 - 0.45 * depth; mg *= 1.2 - 0.4 * depth; mb *= 1.08 - 0.2 * depth;
      if (foam > 0) {
        const fl = 215 * foam * (lr + lg + lb) / 3 * 0.7;
        mr *= 1 - 0.6 * foam; mg *= 1 - 0.6 * foam; mb *= 1 - 0.6 * foam;
        ar += fl; ag += fl; ab += fl;
      }
    }
    if (glow) {
      const cx = i % w; const cy = (i - cx) / w;
      const fx = Math.min(gcw - 1.001, Math.max(0, (cx + 0.5) / gstep - 0.5)); const fy = Math.min(gch - 1.001, Math.max(0, (cy + 0.5) / gstep - 0.5));
      const x0 = fx | 0; const y0 = fy | 0; const u = fx - x0; const v = fy - y0; const o = (y0 * gcw + x0) * 3; const o2 = o + gcw * 3;
      const k = opt.bloom * 2.2;
      if (gcw > 1 && gch > 1) {
        ar += k * ((glow[o] * (1 - u) + glow[o + 3] * u) * (1 - v) + (glow[o2] * (1 - u) + glow[o2 + 3] * u) * v);
        ag += k * ((glow[o + 1] * (1 - u) + glow[o + 4] * u) * (1 - v) + (glow[o2 + 1] * (1 - u) + glow[o2 + 4] * u) * v);
        ab += k * ((glow[o + 2] * (1 - u) + glow[o + 5] * u) * (1 - v) + (glow[o2 + 2] * (1 - u) + glow[o2 + 5] * u) * v);
      }
    }
    if (edge && edge[i]) { const e = 1 - ink * edge[i] / 255; mr *= e; mg *= e; mb *= e; ar *= e; ag *= e; ab *= e; }
    if (grain > 0) { const e = 1 + grain * (((Math.imul(i, 2654435761) >>> 8) & 0xffff) / 32768 - 1); mr *= e; mg *= e; mb *= e; }
    if (sparks) { const v = sparks.get(i); if (v) { ar += 190 * v; ag += 255 * v; ab += 110 * v; } }
    if (misty) {
      const cy = (i - (i % w)) / w;
      // how far up the picture the ground under this sample is
      const far = Math.min(1, Math.max(0, 1 - ((cy + 0.5) / pxs - S.bz * (s.z - S.oz)) / (rowsS / pxs)));
      let f = env.fog * 0.85 * far ** 1.4;
      if (env.haze > 0) {
        const drift = t >= 0 ? Math.sin(2 * Math.PI * t) * 0.6 : 0;
        const hz = env.haze * Math.exp(-Math.max(0, s.z - low) / 14) * (0.45 + 0.9 * noise2(s.x / 5 + drift, s.y / 5 + 2));
        f = 1 - (1 - f) * (1 - Math.min(0.9, hz));
      }
      const fc = 255 * f * (0.35 + 0.65 * Math.min(1, env.skyPower + env.sunPower * 0.4));
      mr *= 1 - f; mg *= 1 - f; mb *= 1 - f;
      ar = ar * (1 - f) + fc * env.fogColor[0]; ag = ag * (1 - f) + fc * env.fogColor[1]; ab = ab * (1 - f) + fc * env.fogColor[2];
    }
    emit(i, kind, mr, mg, mb, ar, ag, ab, mat);
  }
}

// light, then pull the colour a little towards grey and compress highlights, for a grounded look
// With a style: contrast, a pastel lift, and a pull towards the style's palette.
function grader(opt, style = null) {
  const soft = (v) => { v *= opt.exposure; return v < 180 ? v : 180 + (v - 180) * 75 / (v - 180 + 75); };
  const out = [0, 0, 0];
  const table = style && style.pull > 0 ? pullTable(style.palette, style.pull) : null;
  const contrast = style?.contrast ?? 1; const lift = style?.lift ?? 0;
  return (r, g, b) => {
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    out[0] = Math.max(0, soft(lum + (r - lum) * opt.saturation));
    out[1] = Math.max(0, soft(lum + (g - lum) * opt.saturation));
    out[2] = Math.max(0, soft(lum + (b - lum) * opt.saturation));
    if (style) {
      for (let c = 0; c < 3; c++) out[c] = Math.min(255, Math.max(0, (118 + (out[c] - 118) * contrast) * (1 - lift) + 255 * lift));
      if (table) pulled(table, out[0], out[1], out[2], out);
    }
    return out;
  };
}

function ready(prep) {
  prep.look = looker(prep); prep.sample = sample;
  return prep;
}

/**
 * Relight a character grid from the Asciicker renderer. Returns a new grid whose fg/bg index into
 * the returned palette (shared through `palette`, so several frames can use one palette).
 * @param {{cols:number, rows:number, ch:string[], fg:number[], bg:number[], hit:number[], height:(number|null)[]}} grid
 * @param {object} scene       The scene at this frame (light, terrain, water, objects, shading).
 * @param {{origin:number[], col:number[], row:number[]}} projection  For this grid's size.
 * @param {string[]} basePalette  Palette the grid's colours index into (xterm256()).
 * @param {{map: Map<number,number>, list: string[]}} palette  Output palette under construction.
 * @param {{prep?: object, time?: number}} [more]  prep: a prepareScene result for this frame, to reuse
 *   its shadows. time: 0..1 through the loop of an animated scene (default: a still picture).
 */
export function shadeGrid(grid, scene, projection, basePalette, palette, more = {}) {
  const opt = shadingOptions(scene);
  const { cols, rows } = grid;
  const n = cols * rows;
  const prep = ready(reconcile(more.prep ?? prepareScene(scene, projection, { cols, rows }), grid));
  const rgb = basePalette.map(parseHex);
  const outFg = new Array(n);
  const outBg = new Array(n);
  const put = (r, gr, b) => {
    const key = (Math.min(31, r >> 3) << 10) | (Math.min(31, gr >> 3) << 5) | Math.min(31, b >> 3);
    let idx = palette.map.get(key);
    if (idx === undefined) {
      idx = palette.list.length;
      palette.map.set(key, idx);
      const hx = (v) => Math.min(255, (v >> 3) * 8 + 4).toString(16).padStart(2, '0');
      palette.list.push('#' + hx(r) + hx(gr) + hx(b));
    }
    return idx;
  };
  const grade = grader(opt, sceneStyle(scene));
  const env = environment(scene, opt);
  // grass plants are for Kiln's own pictures; text keeps its mottled ground
  light(prep, scene, { ...opt, grass: 0 }, env, more.time ?? -1, (i, kind, mr, mg, mb, ar, ag, ab) => {
    const fg = grid.fg[i]; const bg = grid.bg[i];
    if (kind === 0) {
      // the backdrop keeps its own colours, or takes the sky's when the scene has a time of day
      if (ar >= 0 && bg >= 0) { const o = grade(ar, ag, ab); outBg[i] = put(o[0] | 0, o[1] | 0, o[2] | 0); const q = grade(ar * 1.25 + 10, ag * 1.25 + 10, ab * 1.25 + 10); outFg[i] = fg < 0 ? -1 : put(q[0] | 0, q[1] | 0, q[2] | 0); return; }
      outFg[i] = fg < 0 ? -1 : put(...rgb[fg]); outBg[i] = bg < 0 ? -1 : put(...rgb[bg]); return;
    }
    if (fg < 0) outFg[i] = -1; else { const c = rgb[fg]; const o = grade(c[0] * mr + ar, c[1] * mg + ag, c[2] * mb + ab); outFg[i] = put(o[0] | 0, o[1] | 0, o[2] | 0); }
    if (bg < 0) outBg[i] = -1; else { const c = rgb[bg]; const o = grade(c[0] * mr + ar, c[1] * mg + ag, c[2] * mb + ab); outBg[i] = put(o[0] | 0, o[1] | 0, o[2] | 0); }
  });
  return { ...grid, fg: outFg, bg: outBg };
}

/**
 * Draw and light a whole picture with Kiln's own rasteriser: every pixel gets its own triangle,
 * so the picture keeps real detail however fine it is.
 * @param {object} scene       The scene at this frame.
 * @param {object} projection  From measureProjection, for the character grid (cols x rows).
 * @param {{cols:number, rows:number, px?:number, prep?:object, time?:number}} size  px = pixels per
 *   character each way. time: 0..1 through the loop of an animated scene.
 * @returns {{width:number, height:number, rgba:Uint8ClampedArray, prep:object}}
 */
export function shadePicture(scene, projection, size) {
  const opt = shadingOptions(scene) ?? shadingOptions({ ...scene, shading: 'smooth' });
  const prep = ready(size.prep ?? prepareScene(scene, projection, size));
  const { w, h, geo, water } = prep;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const mats = Object.values(scene.materials ?? {}).map((m) => { const b = parseHex(m.bg); const f = parseHex(m.fg); return b.map((v, k) => v + (f[k] - v) * 0.15); });
  const sky = scene.sky && scene.sky !== 'clear' ? parseHex(scene.sky.bg) : null;
  const grade = grader(opt, sceneStyle(scene));
  const s = prep.sample; const C = geo.C;
  const env = environment(scene, opt);
  light(prep, scene, opt, env, size.time ?? -1, (i, kind, mr, mg, mb, ar, ag, ab, mat) => {
    const o = i * 4;
    if (kind === 0) {
      if (!sky) return;
      if (ar >= 0) { const c = grade(ar, ag, ab); rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; } else { rgba[o] = sky[0]; rgba[o + 1] = sky[1]; rgba[o + 2] = sky[2]; }
      rgba[o + 3] = 255;
      return;
    }
    let r; let g; let b;
    if (kind === 2) {
      r = SEA[0]; g = SEA[1]; b = SEA[2];
      // the bed shows through the shallows
      if (mat >= 0 && opt.water) { const k = Math.sqrt(Math.min(1, Math.max(0, (water - s.floor) / 6))); const m = mats[mat]; r = m[0] * 0.5 + (r - m[0] * 0.5) * k; g = m[1] * 0.72 + (g - m[1] * 0.72) * k; b = m[2] * 0.85 + (b - m[2] * 0.85) * k; }
    } else if (s.tri >= geo.ground) { r = C[s.tri * 3]; g = C[s.tri * 3 + 1]; b = C[s.tri * 3 + 2]; }
    else if (mat >= 0) { const m = mats[mat]; r = m[0]; g = m[1]; b = m[2]; }
    else { r = 128; g = 128; b = 128; }
    const c = grade(r * mr + ar, g * mg + ag, b * mb + ab);
    rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
  });
  // soften the stair-steps along the edges of things: edge pixels take in a little of their neighbours
  if (opt.smoothEdges && w > 2 && h > 2) {
    const edge = prep.cache['edge:1'] ??= edgeMask(prep.tri, geo, w, h, 1);
    const src = rgba.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (edge[i] !== 255) continue;
      const o = i * 4;
      if (!src[o + 3] || !src[o - 1] || !src[o + 7] || !src[o - w * 4 + 3] || !src[o + w * 4 + 3]) continue; // keep cut-out edges crisp
      for (let c = 0; c < 3; c++) rgba[o + c] = (src[o + c] * 4 + src[o - 4 + c] + src[o + 4 + c] + src[o - w * 4 + c] + src[o + w * 4 + c]) / 8;
    }
  }
  return { width: w, height: h, rgba, prep };
}

void WATER;
