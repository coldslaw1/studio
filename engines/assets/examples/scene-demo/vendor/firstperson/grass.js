// Grass: blades that stand on grassy ground near the eye. Nothing is stored: every frame the
// blades in view are made again from a hash of their place, so the same tuft is always in the same
// spot, any size of world costs the same, and the wind can lean them a little differently each frame.
// Far tufts are left out more and more often and the ones that stay are drawn wider, so a meadow
// thins out into the ground's own glyphs instead of flickering.

const hash = (x, y, k) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Room for the blades of one frame. */
export function createGrassBuffer(max = 6000) {
  return { max, count: 0, tris: new Float32Array(max * 9), base: new Float32Array(max), height: new Float32Array(max), mat: new Uint8Array(max), tone: new Float32Array(max), flower: new Uint8Array(max) };
}

/**
 * Make the blades in view.
 * @param {object} world  From createFpWorld, with world.grass = { on (per material), density, height, far, width, wind, sway }.
 * @param {object} cam    Camera basis.
 * @param {number} time   Seconds, for the wind.
 * @param {object} out    From createGrassBuffer.
 * @returns {number} Blades made (also out.count).
 */
export function buildGrass(world, cam, time, out) {
  const g = world.grass;
  out.count = 0;
  if (!g) return 0;
  if (g.source) return buildPlants(world, cam, time, out);
  out.flower.fill(0);
  const { eye, F, R, fx, cx } = cam;
  const cell = 1 / Math.sqrt(g.density);
  const far = g.far; const full = far * 0.35; // every tuft up to here, then fewer and fewer
  const tanH = cx / fx;
  // the look direction on the ground (straight down has none: then everything round the eye counts)
  let fwx = F[0]; let fwy = F[1]; const fl = Math.hypot(fwx, fwy);
  const level = fl > 0.35;
  if (level) { fwx /= fl; fwy /= fl; }
  let rx = R[0]; let ry = R[1]; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
  const i0 = Math.floor((eye[0] - far) / cell); const i1 = Math.floor((eye[0] + far) / cell);
  const j0 = Math.floor((eye[1] - far) / cell); const j1 = Math.floor((eye[1] + far) / cell);
  const gr = world.ground;
  const wind = g.wind; const { tris, base, height, mat, tone } = out;
  let n = 0;
  for (let j = j0; j <= j1 && n < out.max - 2; j++) {
    for (let i = i0; i <= i1 && n < out.max - 2; i++) {
      const x = (i + hash(i, j, 1)) * cell; const y = (j + hash(i, j, 2)) * cell;
      if (x < gr.x0 || y < gr.y0 || x > gr.x1 || y > gr.y1) continue;
      const dx = x - eye[0]; const dy = y - eye[1];
      const d2 = dx * dx + dy * dy;
      if (d2 > far * far) continue;
      if (level) {
        const ahead = dx * fwx + dy * fwy;
        if (ahead < -1.5) continue;
        if (Math.abs(dx * rx + dy * ry) > (ahead + 1.5) * tanH * 1.15 + 1.5) continue; // off to the side of the picture
      }
      const d = Math.sqrt(d2 + (eye[2] - 1) * (eye[2] - 1) * 0.5);
      if (d > far) continue;
      const keep = d <= full ? 1 : ((far - d) / (far - full)) ** 2;
      if (hash(i, j, 3) > keep) continue;
      const m = world.materialAt(x, y);
      if (!g.on[m]) continue;
      const z = world.heightAt(x, y);
      if (world.water && z < world.water.level + 0.05) continue;
      const half = Math.max(g.width / 2, 0.55 * d / fx); // never thinner than about one sample
      // the wind: a slow wave across the land, and each tuft a little out of step
      const sway = g.sway * Math.sin(time * 1.9 + x * 0.35 + y * 0.22 + hash(i, j, 4) * 2.5) * (0.6 + 0.4 * Math.sin(time * 0.6 + x * 0.05));
      for (let b = 0; b < 2; b++) {
        const h = g.height * (0.55 + 0.75 * hash(i, j, 5 + b)) * (0.85 + 0.3 * keep);
        const ox = (hash(i, j, 7 + b) - 0.5) * 0.16; const oy = (hash(i, j, 9 + b) - 0.5) * 0.16;
        const lx = (hash(i, j, 11 + b) - 0.5) * 0.5 * h + (wind[0] * 0.25 + wind[0] * sway) * h; const ly = (hash(i, j, 13 + b) - 0.5) * 0.5 * h + (wind[1] * 0.25 + wind[1] * sway) * h;
        const bx = x + ox; const by = y + oy; const o = n * 9;
        tris[o] = bx - rx * half; tris[o + 1] = by - ry * half; tris[o + 2] = z - 0.02;
        tris[o + 3] = bx + rx * half; tris[o + 4] = by + ry * half; tris[o + 5] = z - 0.02;
        tris[o + 6] = bx + lx; tris[o + 7] = by + ly; tris[o + 8] = z + h;
        base[n] = z; height[n] = h; mat[n] = m; tone[n] = 0.82 + 0.36 * hash(i, j, 15 + b);
        n++;
      }
    }
  }
  out.count = n;
  return n;
}

const P = { x: 0, y: 0, height: 0, lean: 0, tint: 0, flower: 0 };
/**
 * The same, with the plants of another renderer (world.grass.source): each layer is a grid of ground
 * squares holding at most one plant. A layer shows where a metre covers between its `from` and
 * `full` samples, so single blades stand close by and broad tufts take over further off.
 */
function buildPlants(world, cam, time, out) {
  const g = world.grass; const src = g.source;
  const { eye, F, R, fx, cx } = cam;
  const tanH = cx / fx;
  let fwx = F[0]; let fwy = F[1]; const fl = Math.hypot(fwx, fwy);
  const level = fl > 0.35;
  if (level) { fwx /= fl; fwy /= fl; }
  let rx = R[0]; let ry = R[1]; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
  const gr = world.ground; const wind = g.wind;
  const { tris, base, height, mat, tone, flower } = out;
  const up2 = (eye[2] - world.heightAt(eye[0], eye[1]) - 1.6) ** 2; // an eye high above the ground sees every plant smaller
  let n = 0;
  for (let li = 0; li < src.layers.length; li++) {
    const layer = src.layers[li]; const cell = layer.cell;
    const far = fx / layer.from; const full = fx / layer.full; // samples per metre fall off as 1 / distance
    const broad = layer.width > 0.12; // a tuft: three blades fanned out
    const i0 = Math.floor((eye[0] - far) / cell); const i1 = Math.floor((eye[0] + far) / cell);
    const j0 = Math.floor((eye[1] - far) / cell); const j1 = Math.floor((eye[1] + far) / cell);
    for (let j = j0; j <= j1 && n < out.max - 3; j++) {
      for (let i = i0; i <= i1 && n < out.max - 3; i++) {
        // the square's middle decides quickly whether it can be in the picture at all
        const mx = (i + 0.5) * cell; const my = (j + 0.5) * cell;
        const dx = mx - eye[0]; const dy = my - eye[1];
        const d2 = dx * dx + dy * dy + up2;
        if (d2 > far * far) continue;
        if (level) {
          const ahead = dx * fwx + dy * fwy;
          if (ahead < -1.5) continue;
          if (Math.abs(dx * rx + dy * ry) > (ahead + 1.5) * tanH * 1.15 + 1.5) continue;
        }
        const d = Math.sqrt(d2);
        const strength = d <= full ? 1 : (far - d) / (far - full);
        // a layer fades by leaving plants out, the same ones every frame
        if (strength < 1 && (((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ (li * 83492791)) >>> 0) % 1024) / 1024 > strength) continue;
        const m = world.materialAt(mx, my);
        if (!g.on[m] || !src.plantIn(layer, i, j, g.amount[m], P)) continue;
        const x = P.x; const y = P.y;
        if (x < gr.x0 || y < gr.y0 || x > gr.x1 || y > gr.y1) continue;
        const z = world.heightAt(x, y);
        if (world.water && z < world.water.level + 0.05) continue;
        const h = P.height;
        const blow = (src.lean ? src.lean(x, y, time) : 0.14) * h; const own = P.lean * h;
        const lx = wind[0] * blow - wind[1] * own; const ly = wind[1] * blow + wind[0] * own;
        const thin = 0.55 * d / fx;
        const tn = 0.82 + 0.36 * P.tint;
        if (!broad) {
          const half = Math.max(layer.width / 2, thin); const o = n * 9;
          tris[o] = x - rx * half; tris[o + 1] = y - ry * half; tris[o + 2] = z - 0.02;
          tris[o + 3] = x + rx * half; tris[o + 4] = y + ry * half; tris[o + 5] = z - 0.02;
          tris[o + 6] = x + lx; tris[o + 7] = y + ly; tris[o + 8] = z + h;
          base[n] = z; height[n] = h; mat[n] = m; tone[n] = tn; flower[n] = P.flower; n++;
        } else {
          const half = Math.max(layer.width * 0.22, thin); const spread = layer.width * 0.42;
          for (let b = -1; b <= 1; b++) {
            const bx = x + rx * spread * b; const by = y + ry * spread * b; const hb = h * (b === 0 ? 1 : 0.72); const o = n * 9;
            tris[o] = bx - rx * half; tris[o + 1] = by - ry * half; tris[o + 2] = z - 0.02;
            tris[o + 3] = bx + rx * half; tris[o + 4] = by + ry * half; tris[o + 5] = z - 0.02;
            tris[o + 6] = bx + lx + rx * spread * b * 0.8; tris[o + 7] = by + ly + ry * spread * b * 0.8; tris[o + 8] = z + hb;
            base[n] = z; height[n] = hb; mat[n] = m; tone[n] = tn * (b === 0 ? 1 : 0.92); flower[n] = 0; n++;
          }
        }
      }
    }
  }
  out.count = n;
  return n;
}