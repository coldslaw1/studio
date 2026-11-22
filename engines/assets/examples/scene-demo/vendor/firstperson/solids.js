// Rounded solids (capsules, balls, boxes) drawn in true 3D by casting a ray through every sample
// they may cover. This is the shape list a puppet-engine rig gives (puppet.shapes()), so rigged
// characters and props stand in the first-person view with the same depth buffer as the scenery.

/**
 * @param {object} buf   Buffers from createBuffers (already holding the scenery).
 * @param {object} cam   A camera basis (see cameraBasis).
 * @param {Array<{at:number[], shapes:object[]}>} solids  Each: where its ground point is, and its shapes relative to that:
 *   capsule { shape, a, b, r0, r1 }, ball { shape, c, m, r: [x, y, z] }, box { shape, c, m, half: [x, y, z] };
 *   m is a 3x3 rotation (9 numbers, row by row). All carry { color: '#hex', flat?: boolean }.
 * @param {object[]} drawn  Emptied, then filled with the shapes that were drawn: sample id -2 - n is drawn[n].
 * @returns {number} Samples filled.
 */
export function drawSolids(buf, cam, solids, drawn) {
  const { eye, F, R, U, fx, fy, cx, cy, near, far } = cam;
  const { w, h, iz, id, nx, ny, nz } = buf;
  drawn.length = 0;
  let filled = 0;
  for (const solid of solids) {
    const ox = solid.at[0] - eye[0]; const oy = solid.at[1] - eye[1]; const oz = solid.at[2] - eye[2];
    for (const s of solid.shapes) {
      // centre and reach of the shape, relative to the eye
      let px; let py; let pz; let reach;
      if (s.shape === 'capsule') {
        px = (s.a[0] + s.b[0]) / 2 + ox; py = (s.a[1] + s.b[1]) / 2 + oy; pz = (s.a[2] + s.b[2]) / 2 + oz;
        reach = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]) / 2 + Math.max(s.r0, s.r1);
      } else {
        px = s.c[0] + ox; py = s.c[1] + oy; pz = s.c[2] + oz;
        const e = s.shape === 'ball' ? s.r : s.half;
        reach = s.shape === 'ball' ? Math.max(e[0], e[1], e[2]) : Math.hypot(e[0], e[1], e[2]);
      }
      const depth = px * F[0] + py * F[1] + pz * F[2];
      if (depth + reach < near || depth - reach > far) continue;
      const thin = 0.55 * Math.max(depth, near) / fx; // nothing thinner than about half a character, or limbs break into dots
      reach = Math.max(reach, thin);
      let x0 = 0; let x1 = w - 1; let y0 = 0; let y1 = h - 1;
      const side = px * R[0] + py * R[1] + pz * R[2]; const rise = px * U[0] + py * U[1] + pz * U[2];
      // wholly outside the picture's edges (matters for shapes close beside or behind the eye)
      const th = cx / fx; const tv = cy / fy;
      if (Math.abs(side) - depth * th > reach * Math.sqrt(1 + th * th) || Math.abs(rise) - depth * tv > reach * Math.sqrt(1 + tv * tv)) continue;
      if (depth - reach > near) {
        const sx = cx + fx * side / depth; const sy = cy - fy * rise / depth;
        const rs = fx * reach / (depth - reach) * 1.05 + 1;
        x0 = Math.max(0, Math.floor(sx - rs)); x1 = Math.min(w - 1, Math.ceil(sx + rs));
        y0 = Math.max(0, Math.floor(sy - rs * 2)); y1 = Math.min(h - 1, Math.ceil(sy + rs * 2));
        if (x0 > x1 || y0 > y1) continue;
      }
      if (s.shape === 'capsule') {
        // a capsule is tighter than the ball round its middle: the box round its two end balls
        const ra = Math.max(s.r0, thin); const rb = Math.max(s.r1, thin);
        const a0 = s.a[0] + ox; const a1 = s.a[1] + oy; const a2 = s.a[2] + oz; const b0 = s.b[0] + ox; const b1 = s.b[1] + oy; const b2 = s.b[2] + oz;
        const da = a0 * F[0] + a1 * F[1] + a2 * F[2]; const db = b0 * F[0] + b1 * F[1] + b2 * F[2];
        if (da - ra > near && db - rb > near) {
          const ka = fx * ra / (da - ra) * 1.05 + 1; const kb = fx * rb / (db - rb) * 1.05 + 1;
          const xa = cx + fx * (a0 * R[0] + a1 * R[1] + a2 * R[2]) / da; const ya = cy - fy * (a0 * U[0] + a1 * U[1] + a2 * U[2]) / da;
          const xb = cx + fx * (b0 * R[0] + b1 * R[1] + b2 * R[2]) / db; const yb = cy - fy * (b0 * U[0] + b1 * U[1] + b2 * U[2]) / db;
          x0 = Math.max(x0, Math.floor(Math.min(xa - ka, xb - kb))); x1 = Math.min(x1, Math.ceil(Math.max(xa + ka, xb + kb)));
          y0 = Math.max(y0, Math.floor(Math.min(ya - ka * 2, yb - kb * 2))); y1 = Math.min(y1, Math.ceil(Math.max(ya + ka * 2, yb + kb * 2)));
          if (x0 > x1 || y0 > y1) continue;
        }
      }
      const idx = -2 - drawn.length;
      let any = false;
      const capsule = s.shape === 'capsule';
      // capsule numbers
      let ax = 0; let ay = 0; let az = 0; let wx = 0; let wy = 0; let wz = 0; let ww = 0; let r0 = 0; let r1 = 0;
      // ball and box numbers
      const m = s.m; let e0 = 0; let e1 = 0; let e2 = 0; let lx = 0; let ly = 0; let lz = 0;
      if (capsule) {
        ax = s.a[0] + ox; ay = s.a[1] + oy; az = s.a[2] + oz;
        wx = s.b[0] - s.a[0]; wy = s.b[1] - s.a[1]; wz = s.b[2] - s.a[2]; ww = wx * wx + wy * wy + wz * wz;
        r0 = Math.max(s.r0, thin); r1 = Math.max(s.r1, thin);
      } else {
        const e = s.shape === 'ball' ? s.r : s.half; const least = thin * (s.flat ? 0.8 : 0.6);
        e0 = Math.max(e[0], least); e1 = Math.max(e[1], least); e2 = Math.max(e[2], least);
        // the eye in the shape's own axes
        lx = -(m[0] * px + m[3] * py + m[6] * pz); ly = -(m[1] * px + m[4] * py + m[7] * pz); lz = -(m[2] * px + m[5] * py + m[8] * pz);
      }
      for (let y = y0; y <= y1; y++) {
        const b = (cy - (y + 0.5)) / fy;
        for (let x = x0; x <= x1; x++) {
          const a = (x + 0.5 - cx) / fx;
          // the ray through this sample; its depth along F is exactly t
          const dx = F[0] + a * R[0] + b * U[0]; const dy = F[1] + a * R[1] + b * U[1]; const dz = F[2] + a * R[2] + b * U[2];
          let t; let qx; let qy; let qz;
          if (capsule) {
            const dd = dx * dx + dy * dy + dz * dz; const dw = dx * wx + dy * wy + dz * wz;
            const ra = -(dx * ax + dy * ay + dz * az); const rw = -(wx * ax + wy * ay + wz * az);
            const den = dd * ww - dw * dw;
            let u = den > 1e-12 ? (dd * rw - dw * ra) / den : 0;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            const rad = r0 + (r1 - r0) * u;
            const mx = -(ax + wx * u); const my = -(ay + wy * u); const mz = -(az + wz * u);
            const B = mx * dx + my * dy + mz * dz; const C = mx * mx + my * my + mz * mz - rad * rad;
            const disc = B * B - dd * C;
            if (disc <= 0) continue;
            t = (-B - Math.sqrt(disc)) / dd;
            if (t < near) continue;
            qx = (mx + dx * t) / rad; qy = (my + dy * t) / rad; qz = (mz + dz * t) / rad;
          } else {
            const ux = m[0] * dx + m[3] * dy + m[6] * dz; const uy = m[1] * dx + m[4] * dy + m[7] * dz; const uz = m[2] * dx + m[5] * dy + m[8] * dz;
            let gx; let gy; let gz;
            if (s.shape === 'ball') {
              const sx = lx / e0; const sy = ly / e1; const sz = lz / e2; const tx = ux / e0; const ty = uy / e1; const tz = uz / e2;
              const A = tx * tx + ty * ty + tz * tz; const B = sx * tx + sy * ty + sz * tz; const C = sx * sx + sy * sy + sz * sz - 1;
              const disc = B * B - A * C;
              if (disc <= 0) continue;
              t = (-B - Math.sqrt(disc)) / A;
              if (t < near) continue;
              gx = (sx + tx * t) / e0; gy = (sy + ty * t) / e1; gz = (sz + tz * t) / e2;
              const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
            } else {
              let tn = -Infinity; let tf = Infinity; let axis = 0;
              if (Math.abs(ux) < 1e-9) { if (Math.abs(lx) > e0) continue; } else { const p1 = (-e0 - lx) / ux; const p2 = (e0 - lx) / ux; const lo = p1 < p2 ? p1 : p2; const hi = p1 < p2 ? p2 : p1; if (lo > tn) { tn = lo; axis = 0; } if (hi < tf) tf = hi; }
              if (Math.abs(uy) < 1e-9) { if (Math.abs(ly) > e1) continue; } else { const p1 = (-e1 - ly) / uy; const p2 = (e1 - ly) / uy; const lo = p1 < p2 ? p1 : p2; const hi = p1 < p2 ? p2 : p1; if (lo > tn) { tn = lo; axis = 1; } if (hi < tf) tf = hi; }
              if (Math.abs(uz) < 1e-9) { if (Math.abs(lz) > e2) continue; } else { const p1 = (-e2 - lz) / uz; const p2 = (e2 - lz) / uz; const lo = p1 < p2 ? p1 : p2; const hi = p1 < p2 ? p2 : p1; if (lo > tn) { tn = lo; axis = 2; } if (hi < tf) tf = hi; }
              if (tn > tf || tn < near) continue;
              t = tn;
              const sign = (axis === 0 ? ux : axis === 1 ? uy : uz) > 0 ? -1 : 1;
              gx = axis === 0 ? sign : 0; gy = axis === 1 ? sign : 0; gz = axis === 2 ? sign : 0;
            }
            qx = m[0] * gx + m[1] * gy + m[2] * gz; qy = m[3] * gx + m[4] * gy + m[5] * gz; qz = m[6] * gx + m[7] * gy + m[8] * gz;
          }
          const k = y * w + x;
          const z = 1 / t;
          if (z <= iz[k]) continue;
          iz[k] = z; id[k] = idx; nx[k] = qx; ny[k] = qy; nz[k] = qz;
          any = true; filled++;
        }
      }
      if (any) drawn.push(s); else drawn.push(null);
    }
  }
  return filled;
}
