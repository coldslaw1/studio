// Triangle rasteriser: fills a depth buffer and an id buffer with the nearest triangle under every
// sample. No colour here; the shading pass works out colour once per visible sample afterwards.

/** Buffers for a picture of w x h samples. `iz` is 1 / depth (0 = nothing drawn), `id` the triangle or solid there (-1 = nothing). */
export function createBuffers(w, h) {
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) throw new Error(`createBuffers: width and height must be whole numbers above 0, got ${w} x ${h}`);
  return { w, h, iz: new Float32Array(w * h), id: new Int32Array(w * h), nx: new Float32Array(w * h), ny: new Float32Array(w * h), nz: new Float32Array(w * h) };
}

/** Empty the buffers before a frame. */
export function clearBuffers(buf) { buf.iz.fill(0); buf.id.fill(-1); }

// one triangle already on the screen: sample positions and 1 / depth at each corner
function fill(buf, x0, y0, i0, x1, y1, i1, x2, y2, i2, id) {
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area > -1e-9 && area < 1e-9) return;
  const { w, h, iz, id: ids } = buf;
  let minX = Math.min(x0, x1, x2); let maxX = Math.max(x0, x1, x2);
  let minY = Math.min(y0, y1, y2); let maxY = Math.max(y0, y1, y2);
  if (maxX < 0 || maxY < 0 || minX >= w || minY >= h) return;
  // samples sit at the middle of their square
  minX = Math.max(0, Math.ceil(minX - 0.5)); maxX = Math.min(w - 1, Math.floor(maxX - 0.5));
  minY = Math.max(0, Math.ceil(minY - 0.5)); maxY = Math.min(h - 1, Math.floor(maxY - 0.5));
  if (minX > maxX || minY > maxY) return;
  const inv = 1 / area;
  // edge functions, scaled so the three add up to 1 inside the triangle; each is a*x + b*y + c
  const a0 = (y1 - y2) * inv; const b0 = (x2 - x1) * inv; const c0 = (x1 * y2 - x2 * y1) * inv;
  const a1 = (y2 - y0) * inv; const b1 = (x0 - x2) * inv; const c1 = (x2 * y0 - x0 * y2) * inv;
  const a2 = (y0 - y1) * inv; const b2 = (x1 - x0) * inv; const c2 = (x0 * y1 - x1 * y0) * inv;
  // 1 / depth is a flat plane over the screen
  const za = a0 * i0 + a1 * i1 + a2 * i2; const zb = b0 * i0 + b1 * i1 + b2 * i2; const zc = c0 * i0 + c1 * i1 + c2 * i2;
  const E = -1e-6;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5; const px = minX + 0.5;
    let w0 = a0 * px + b0 * py + c0; let w1 = a1 * px + b1 * py + c1; let w2 = a2 * px + b2 * py + c2;
    let z = za * px + zb * py + zc;
    let k = y * w + minX;
    for (let x = minX; x <= maxX; x++, k++) {
      if (w0 >= E && w1 >= E && w2 >= E && z > iz[k]) { iz[k] = z; ids[k] = id; }
      w0 += a0; w1 += a1; w2 += a2; z += za;
    }
  }
}

/**
 * Draw world triangles (9 numbers each) as seen by a camera basis (see cameraBasis). Triangle n
 * gets id `idBase + n`. Triangles crossing the near plane are cut there; nothing is culled by
 * which way it faces, so thin things such as fence boards show from both sides.
 * @returns {number} How many triangles reached the screen.
 */
export function drawTriangles(buf, cam, tris, count = tris.length / 9, idBase = 0, start = 0) {
  const { eye, F, R, U, fx, fy, cx, cy, near, far } = cam;
  const ex = eye[0]; const ey = eye[1]; const ez = eye[2];
  const v = new Float64Array(9); // view space: x right, y up, z depth, for three corners
  const c = new Float64Array(12); // after cutting: up to four corners
  let drawn = 0;
  for (let n = 0; n < count; n++) {
    const p = (start + n) * 9;
    let behind = 0; let beyond = 0;
    for (let q = 0; q < 3; q++) {
      const dx = tris[p + q * 3] - ex; const dy = tris[p + q * 3 + 1] - ey; const dz = tris[p + q * 3 + 2] - ez;
      const z = dx * F[0] + dy * F[1] + dz * F[2];
      v[q * 3] = dx * R[0] + dy * R[1] + dz * R[2]; v[q * 3 + 1] = dx * U[0] + dy * U[1] + dz * U[2]; v[q * 3 + 2] = z;
      if (z < near) behind++;
      if (z > far) beyond++;
    }
    if (behind === 3 || beyond === 3) continue;
    let m = 3;
    if (behind === 0) c.set(v);
    else {
      m = 0;
      for (let q = 0; q < 3; q++) {
        const a = q * 3; const b = ((q + 1) % 3) * 3;
        const ina = v[a + 2] >= near; const inb = v[b + 2] >= near;
        if (ina) { c[m * 3] = v[a]; c[m * 3 + 1] = v[a + 1]; c[m * 3 + 2] = v[a + 2]; m++; }
        if (ina !== inb) {
          const t = (near - v[a + 2]) / (v[b + 2] - v[a + 2]);
          c[m * 3] = v[a] + (v[b] - v[a]) * t; c[m * 3 + 1] = v[a + 1] + (v[b + 1] - v[a + 1]) * t; c[m * 3 + 2] = near; m++;
        }
      }
      if (m < 3) continue;
    }
    for (let q = 0; q < m; q++) { const i = 1 / c[q * 3 + 2]; c[q * 3] = cx + fx * c[q * 3] * i; c[q * 3 + 1] = cy - fy * c[q * 3 + 1] * i; c[q * 3 + 2] = i; }
    fill(buf, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], idBase + n);
    if (m === 4) fill(buf, c[0], c[1], c[2], c[6], c[7], c[8], c[9], c[10], c[11], idBase + n);
    drawn++;
  }
  return drawn;
}
