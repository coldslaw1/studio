// The shading pass: one colour for every sample the rasteriser filled. Sun and sky light, cast
// shadows and corner darkening come from the world's light maps, with the same formulas as Kiln's
// scene lighting, so a first-person picture matches the isometric one. Solids (characters) are lit
// in a few flat bands, like the puppet engine's text sprites.
import { hexRgb } from './color.js';

const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * @param {object} world   From createFpWorld.
 * @param {object} buf     Filled buffers.
 * @param {object} cam     Camera basis.
 * @param {object} out     { col: Uint32Array (0xRRGGBB per sample), mat: Uint8Array (ground material + 1, +128 where a glyph belongs), ink: Uint32Array (glyph colour) }.
 * @param {object[]} drawn Solids' shapes by id (from drawSolids).
 * @param {Array<{x:number, y:number, r:number, h:number}>} casters  Standing things that throw a shadow on the ground.
 * @param {Map<string, number[]>} colorCache
 * @param {object} tuft    { size, density, near, far }: how ground glyphs are scattered and fade with distance.
 * @param {object} [grass] This frame's grass blades (from buildGrass); their sample ids follow the world's triangles.
 * @param {number} [time]  Seconds, for the water's ripples.
 */
export function shade(world, buf, cam, out, drawn, casters, colorCache, tuft, grass = null, time = 0) {
  const { w, h, iz, id } = buf;
  const { eye, F, R, U, fx, fy, cx, cy } = cam;
  const { ground, materials, water, light, maps, nGround, nWater, objColors, objNormals, haze } = world;
  const { g, gw, gh, hm, S, groundShadow, groundOcc } = maps;
  const mx0 = maps.x0; const my0 = maps.y0;
  const L = light.dir; const amb = light.ambient; const sun = light.sun; const sky = light.sky;
  const kDirect = 1.25 - amb * 0.5; const kFill = 0.45 + amb * 0.5;
  const sat = light.saturation; const expo = light.exposure;
  const hz = world.hazeColor;
  const lamps = world.lamps;
  const bands = world.grade.bands; const contrast = world.grade.contrast; const lift = world.grade.lift;
  const graded = contrast !== 1 || lift !== 0;
  const GN = ground.normals; const gcols = ground.cols; const grows = ground.rows; const gstep = ground.step;
  const mm = ground.materials;
  const firstObj = nGround + nWater;
  const { col, mat, ink } = out;
  const lz = Math.max(0.05, L[2]);
  // shadows of standing things: a line on the ground from the feet away from the sun
  const cast = casters.map((c) => ({ x: c.x, y: c.y, ex: -L[0] / lz * c.h, ey: -L[1] / lz * c.h, r: c.r, z: c.z ?? null }));
  const tuftK = 1 / tuft.size;
  const paired = tuft.pair !== false;
  const nAll = world.tris.length / 9; // ids from here on are grass blades
  const mottle = world.mottle; const ripple = water ? water.ripple : 0;

  const samp = (map, x, y) => {
    let fi = (x - mx0) * g; let fj = (y - my0) * g;
    fi = fi < 0 ? 0 : fi > gw - 1.001 ? gw - 1.001 : fi; fj = fj < 0 ? 0 : fj > gh - 1.001 ? gh - 1.001 : fj;
    const i = fi | 0; const j = fj | 0; const u = fi - i; const v = fj - j; const k = j * gw + i;
    return (map[k] * (1 - u) + map[k + 1] * u) * (1 - v) + (map[k + gw] * (1 - u) + map[k + gw + 1] * u) * v;
  };
  const near = (map, x, y) => {
    let i = Math.round((x - mx0) * g); let j = Math.round((y - my0) * g);
    i = i < 0 ? 0 : i >= gw ? gw - 1 : i; j = j < 0 ? 0 : j >= gh ? gh - 1 : j;
    return map[j * gw + i];
  };
  const soft = (v) => { v *= expo; return v < 180 ? v : 180 + (v - 180) * 75 / (v - 180 + 75); };

  for (let y = 0; y < h; y++) {
    const b = (cy - (y + 0.5)) / fy;
    const bx = F[0] + b * U[0]; const by = F[1] + b * U[1]; const bz = F[2] + b * U[2];
    for (let x = 0, k = y * w; x < w; x++, k++) {
      const idv = id[k];
      mat[k] = 0;
      if (idv === -1) continue;
      // A character cell holds two samples, one above the other. Where both show the same surface (the same
      // triangle, or both the ground) the lower one is shaded and the upper one takes its colour: half the work
      // for most of the picture, and edges between different things keep their full sharpness.
      let pair = false;
      if (paired && idv < nAll) {
        const other = (y & 1) === 0 ? id[k + w] : id[k - w];
        pair = other >= 0 && other < nAll && (other === idv || (idv < nGround && other < nGround));
        if (pair && (y & 1) === 0) continue;
      }
      const a = (x + 0.5 - cx) / fx;
      const dx = bx + a * R[0]; const dy = by + a * R[1]; const dz = bz + a * R[2];
      const t = 1 / iz[k];
      const px = eye[0] + dx * t; const py = eye[1] + dy * t; const pz = eye[2] + dz * t;
      let nx = 0; let ny = 0; let nz = 1;
      let cr; let cg; let cb;
      let shadow = 0; let occ = 0; let direct; let fill;
      if (idv >= nAll) {
        // a blade of grass: dark at the root, the material's bright colour at the tip, lit like the ground it stands on
        const b = idv - nAll; const m = materials[grass.mat[b]];
        let up = (pz - grass.base[b]) / grass.height[b]; up = up < 0 ? 0 : up > 1 ? 1 : up;
        const tn = grass.tone[b] * (0.62 + 0.38 * up); const tip = up * up * 0.55;
        cr = (m.bg[0] + (m.fg[0] - m.bg[0]) * tip) * tn; cg = (m.bg[1] + (m.fg[1] - m.bg[1]) * tip) * tn; cb = (m.bg[2] + (m.fg[2] - m.bg[2]) * tip) * tn;
        const fw = grass.flower[b] && up > 0.78 ? world.grass.flowers[grass.flower[b]] : null; // a flower is the top fifth of its blade
        if (fw) { cr = fw[0]; cg = fw[1]; cb = fw[2]; }
        shadow = samp(groundShadow, px, py); occ = samp(groundOcc, px, py) * light.occlusion * (1 - up);
        direct = Math.max(0.25, L[2]) * (1 - light.shadows * shadow) * kDirect;
        fill = kFill * (1 - occ);
      } else if (idv >= 0 && idv < firstObj) {
        const inside = px >= ground.x0 && py >= ground.y0 && px <= ground.x1 && py <= ground.y1;
        if (idv < nGround) {
          let mi = 0;
          if (mm) {
            let i = ((px - ground.x0) / mm.cell) | 0; let j = ((py - ground.y0) / mm.cell) | 0;
            i = i < 0 ? 0 : i >= mm.cols ? mm.cols - 1 : i; j = j < 0 ? 0 : j >= mm.rows ? mm.rows - 1 : j;
            mi = mm.data[j * mm.cols + i];
          }
          const m = materials[mi];
          cr = m.bg[0]; cg = m.bg[1]; cb = m.bg[2];
          // smooth direction from the grid corners
          let fi = (px - ground.x0) / gstep; let fj = (py - ground.y0) / gstep;
          fi = fi < 0 ? 0 : fi > gcols - 1.001 ? gcols - 1.001 : fi; fj = fj < 0 ? 0 : fj > grows - 1.001 ? grows - 1.001 : fj;
          const i = fi | 0; const j = fj | 0; const u = fi - i; const v = fj - j; const q = (j * gcols + i) * 3; const q2 = q + gcols * 3;
          const w00 = (1 - u) * (1 - v); const w10 = u * (1 - v); const w01 = (1 - u) * v; const w11 = u * v;
          nx = GN[q] * w00 + GN[q + 3] * w10 + GN[q2] * w01 + GN[q2 + 3] * w11;
          ny = GN[q + 1] * w00 + GN[q + 4] * w10 + GN[q2 + 1] * w01 + GN[q2 + 4] * w11;
          nz = GN[q + 2] * w00 + GN[q + 5] * w10 + GN[q2 + 2] * w01 + GN[q2 + 5] * w11;
          const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= nl; ny *= nl; nz *= nl;
          shadow = samp(groundShadow, px, py); occ = samp(groundOcc, px, py) * light.occlusion;
          mat[k] = mi + 1;
          const fade = t <= tuft.near ? 1 : (tuft.far - t) / (tuft.far - tuft.near);
          const hv = hash(Math.floor(px * tuftK), Math.floor(py * tuftK));
          if (fade > 0.08 && hv < tuft.density) mat[k] |= 128;
          if (mottle > 0) {
            // the ground is not one flat colour: broad soft patches, and a little grain close by
            const mo = 1 + mottle * ((Math.sin(px * 0.83 + Math.sin(py * 0.47) * 1.7) * Math.sin(py * 0.71 + Math.sin(px * 0.39) * 1.3)) * 0.8 + (hv - 0.5) * 0.5 * (fade > 0 ? fade : 0));
            cr *= mo; cg *= mo; cb *= mo;
          }
        } else {
          // the sea: lighter and greener in the shallows, darker and bluer where it is deep
          const depth = inside ? Math.min(1, Math.max(0, (water.level - world.heightAt(px, py)) / 1.5)) : 1;
          cr = water.shallow[0] + (water.deep[0] - water.shallow[0]) * depth; cg = water.shallow[1] + (water.deep[1] - water.shallow[1]) * depth; cb = water.shallow[2] + (water.deep[2] - water.shallow[2]) * depth;
          if (inside) shadow = samp(groundShadow, px, py);
          if (ripple > 0) {
            // ripples: two sets of small waves crossing, calmer with distance so the far sea does not shimmer
            const rp = 1 + ripple * 0.09 * (Math.sin(px * 2.1 + time * 1.7 + Math.sin(py * 0.9 + time * 0.4) * 1.5) + Math.sin(py * 2.7 - time * 1.3 + px * 0.6)) / (1 + t * 0.06);
            cr *= rp; cg *= rp; cb *= rp;
          }
        }
        for (let c = 0; c < cast.length; c++) {
          const s = cast[c];
          const rx = px - s.x; const ry = py - s.y;
          if (rx > 12 || rx < -12 || ry > 12 || ry < -12) continue;
          const ee = s.ex * s.ex + s.ey * s.ey;
          let u = ee > 1e-9 ? (rx * s.ex + ry * s.ey) / ee : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
          const qx = rx - s.ex * u; const qy = ry - s.ey * u; const dd = Math.sqrt(qx * qx + qy * qy);
          const sh = (s.r * 1.15 - dd) / (s.r * 0.5);
          if (sh > shadow) shadow = sh > 1 ? 1 : sh;
        }
        const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        direct = ndl * (1 - light.shadows * shadow) * kDirect;
        fill = kFill * (1 - occ) * (0.8 + 0.2 * nz);
      } else if (idv >= 0) {
        const tri = idv - firstObj; const q = tri * 3;
        nx = objNormals[q]; ny = objNormals[q + 1]; nz = objNormals[q + 2];
        if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; } // the side that faces the eye
        cr = objColors[q]; cg = objColors[q + 1]; cb = objColors[q + 2];
        if (light.shadows > 0) {
          const lift = 0.25; const nh = Math.sqrt(nx * nx + ny * ny);
          let over;
          if (nz < 0.3 && nh > 0.3) {
            // The top-down map sees a wall, and eaves over it, as solid down to the ground. So a wall
            // looks outwards over a short distance and counts as lit if any open spot there is.
            const ux = nx / nh; const uy = ny / nh;
            over = Infinity;
            for (let s = 2.5 / g + 0.1; s < 1.6 && over > 0; s += 1.5 / g + 0.1) {
              const qx = px + ux * s; const qy = py + uy * s;
              if (near(hm, qx, qy) > pz + lift && over < Infinity) continue;
              over = Math.min(over, samp(S, qx, qy) - (pz + lift));
            }
          } else over = samp(S, px + nx * 0.2, py + ny * 0.2) - (pz + lift);
          shadow = over / (0.375 * light.softness); shadow = shadow < 0 ? 0 : shadow > 1 ? 1 : shadow;
        }
        if (light.occlusion > 0) {
          // how much nearby things rise above this point, looking four ways
          let v = (near(hm, px + 0.9, py) - pz - 0.1875) / 1.875; let sum = v < 0 ? 0 : v > 1 ? 1 : v;
          v = (near(hm, px - 0.9, py) - pz - 0.1875) / 1.875; sum += v < 0 ? 0 : v > 1 ? 1 : v;
          v = (near(hm, px, py + 0.9) - pz - 0.1875) / 1.875; sum += v < 0 ? 0 : v > 1 ? 1 : v;
          v = (near(hm, px, py - 0.9) - pz - 0.1875) / 1.875; sum += v < 0 ? 0 : v > 1 ? 1 : v;
          occ = sum / 4 * light.occlusion;
        }
        const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        direct = ndl * (1 - light.shadows * shadow) * kDirect;
        fill = kFill * (1 - occ) * (0.8 + 0.2 * nz);
      } else {
        const s = drawn[-2 - idv];
        let rgb = colorCache.get(s.color);
        if (!rgb) { rgb = hexRgb(s.color, 'firstperson solid colour'); colorCache.set(s.color, rgb); }
        cr = rgb[0]; cg = rgb[1]; cb = rgb[2];
        nx = buf.nx[k]; ny = buf.ny[k]; nz = buf.nz[k];
        shadow = samp(S, px, py) - (pz + 0.25); shadow = shadow < 0 ? 0 : shadow > 0.375 ? 1 : shadow / 0.375;
        const v = s.flat ? 0.55 : Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]) * (1 - light.shadows * shadow);
        let band = v >= 0.68 ? 1 : v >= 0.38 ? 0.62 : v >= 0.12 ? 0.3 : 0.04;
        fill = kFill * (0.85 + 0.15 * nz);
        // edges turn darker, so limbs read against the body
        if (!s.flat && -(nx * dx + ny * dy + nz * dz) / Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.3) { band *= 0.6; fill *= 0.8; }
        direct = band * kDirect;
      }
      let lr = sun[0] * direct + sky[0] * fill; let lg = sun[1] * direct + sky[1] * fill; let lb = sun[2] * direct + sky[2] * fill;
      for (let q = 0; q < lamps.length; q++) {
        // a lamp: fades to nothing at its radius, counts more on what faces it, blocked by what stands between
        const l = lamps[q];
        const ex = l.x - px; const ey = l.y - py; const ez = l.z - pz;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= l.r2) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const fall = 1 - d2 / l.r2;
        const face = Math.max(0, (nx * ex + ny * ey + nz * ez) / d) * 0.85 + 0.15;
        let open = 1;
        const flat = Math.sqrt(ex * ex + ey * ey);
        if (flat > 1.2) {
          for (let m = 1; m <= 5 && open > 0; m++) {
            const f = 0.1 + (0.9 - 0.9 / flat) * m / 5.5;
            if (near(hm, px + ex * f, py + ey * f) > pz + ez * f + 0.19) open -= 0.5;
          }
          if (open < 0) open = 0;
        }
        const e = l.power * fall * fall * face * open * (1 - occ * 0.5) * 1.5;
        lr += l.color[0] * e; lg += l.color[1] * e; lb += l.color[2] * e;
      }
      if (bands > 0) {
        // a style with cel shading: light in a few steps
        const lv = 0.3 * lr + 0.59 * lg + 0.11 * lb;
        const st = lv * bands; const lo = Math.floor(st); const fr = st - lo;
        const k = (lo + (fr < 0.42 ? 0 : fr > 0.58 ? 1 : (fr - 0.42) / 0.16) + 0.35) / bands / Math.max(lv, 1e-4);
        lr *= k; lg *= k; lb *= k;
      }
      let r = cr * lr; let gr = cg * lg; let bl = cb * lb;
      const lum = 0.3 * r + 0.59 * gr + 0.11 * bl;
      r = soft(lum + (r - lum) * sat); gr = soft(lum + (gr - lum) * sat); bl = soft(lum + (bl - lum) * sat);
      if (graded) { r = (118 + (r - 118) * contrast) * (1 - lift) + 255 * lift; gr = (118 + (gr - 118) * contrast) * (1 - lift) + 255 * lift; bl = (118 + (bl - 118) * contrast) * (1 - lift) + 255 * lift; }
      const f = haze > 0 ? t / (t + haze) : 0;
      r += (hz[0] - r) * f; gr += (hz[1] - gr) * f; bl += (hz[2] - bl) * f;
      col[k] = ((r < 0 ? 0 : r > 255 ? 255 : r) << 16) | ((gr < 0 ? 0 : gr > 255 ? 255 : gr) << 8) | (bl < 0 ? 0 : bl > 255 ? 255 : bl);
      if (mat[k] & 128) {
        // the glyph: the material's foreground under the same light, fading into the ground with distance
        const m = materials[(mat[k] & 127) - 1];
        const fade = t <= tuft.near ? 1 : (tuft.far - t) / (tuft.far - tuft.near);
        const sr = cr > 0 ? m.fg[0] / cr : 1; const sg = cg > 0 ? m.fg[1] / cg : 1; const sb = cb > 0 ? m.fg[2] / cb : 1;
        let ir = soft(r * Math.min(4, sr)); let ig = soft(gr * Math.min(4, sg)); let ib = soft(bl * Math.min(4, sb));
        ir = r + (ir - r) * fade; ig = gr + (ig - gr) * fade; ib = bl + (ib - bl) * fade;
        ink[k] = ((ir > 255 ? 255 : ir) << 16) | ((ig > 255 ? 255 : ig) << 8) | (ib > 255 ? 255 : ib);
      }
      if (pair) { col[k - w] = col[k]; mat[k - w] = mat[k] & 127; }
    }
  }
}
