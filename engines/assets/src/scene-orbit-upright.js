// Keeps tall things upright while a camera turns between two baked angles.
//
// The camera engine shows a baked picture as if the camera stood a few degrees further round by
// bending the whole picture. That is exact for the ground, but everything standing on it (walls,
// towers, trees) leans with the bend. A baked view knows better: its depth says how high the
// surface in every character is, so the characters that show something standing ON the ground can
// be told from the ground itself, and the view knows where each object stands. So each object is
// cut out of the picture once, as a small picture of its own, and while the camera turns:
//   1. the whole picture is drawn bent (the ground turns as it should),
//   2. a patch of plain ground colour is drawn over each leaning object, bent the same way,
//   3. each object's own picture is drawn upright where its foot now is.
// At rest nothing of this is used: the baked picture is drawn as it is.
// Browser-safe; the cutting (canvas work) is separate from the working-out (plain numbers).
import { shapeFootprint } from './scene-shapes.js';

/** Height above the ground (sixteenths of a unit) from which a surface counts as standing on it. */
export const STANDING_MIN = 6;

/**
 * Which characters of a view show each object.
 * @param {object} o
 * @param {number} o.cols  Depth cells across (one per character, or coarser for large pictures).
 * @param {number} o.rows
 * @param {number} o.step  Characters per depth cell.
 * @param {(c:number, r:number) => number|null} o.depth  Depth of a depth cell (see scene-run.js depthGrid), null where there is no surface.
 * @param {{origin:number[], col:number[], row:number[]}} o.projection  In characters.
 * @param {(x:number, y:number) => number} o.heightAt  Ground height (sixteenths).
 * @param {number|null} [o.water]  Sea level, or null.
 * @param {Array<{at:number[], reach:number}>} o.objects  Where each object stands and how far its parts reach sideways (ground units).
 * @param {number} [o.tall]  How high above the ground anything may reach (ground units, default 16).
 * @returns {(index:number) => ({c0:number, r0:number, cw:number, rh:number, mask:Uint8Array, count:number}|null)}
 *   For one object: the box of depth cells it may show in, and 1 for every cell that shows it
 *   (grown by one cell so soft edges come along), or null when it shows in none.
 */
export function standingCells(o) {
  const { cols, rows, step, depth, projection: p, heightAt, objects } = o;
  const water = typeof o.water === 'number' ? o.water : -Infinity;
  const tall = o.tall ?? 16;
  const [ox, oy, oz] = p.origin;
  const k = p.row[3];
  const det = p.col[1] * p.row[2] - p.col[2] * p.row[1];
  if (!det || !k) throw new Error('standingCells: this projection has no ground mapping');
  /** Ground point and height of the surface in depth cell c, r, or null. */
  const surface = (c, r) => {
    const d = depth(c, r);
    if (d === null || d === undefined) return null;
    const col = (c + 0.5) * step; const row = (r + 0.5) * step;
    const zRel = (row - d) / k; // depth is the row the point would have at the camera target's height
    const u = col - p.col[0] - p.col[3] * zRel; const v = d - p.row[0];
    const x = ox + (u * p.row[2] - v * p.col[2]) / det; const y = oy + (v * p.col[1] - u * p.row[1]) / det;
    return [x, y, oz + zRel];
  };
  const nearest = (x, y) => {
    let best = -1; let bestGap = Infinity;
    for (let i = 0; i < objects.length; i++) {
      const gap = Math.hypot(x - objects[i].at[0], y - objects[i].at[1]) - objects[i].reach;
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    return bestGap <= 0 ? best : -1;
  };
  return (index) => {
    const obj = objects[index];
    if (!obj) throw new Error(`standingCells: no object ${index}`);
    const z = Math.max(heightAt(obj.at[0], obj.at[1]), water);
    const cc = p.col[0] + p.col[1] * (obj.at[0] - ox) + p.col[2] * (obj.at[1] - oy) + p.col[3] * (z - oz);
    const rr = p.row[0] + p.row[1] * (obj.at[0] - ox) + p.row[2] * (obj.at[1] - oy) + p.row[3] * (z - oz);
    const across = obj.reach * Math.hypot(p.col[1], p.col[2]); const down = obj.reach * Math.hypot(p.row[1], p.row[2]);
    const up = down + tall * 16 * Math.abs(k);
    const c0 = Math.max(0, Math.floor((cc - across) / step) - 1); const c1 = Math.min(cols - 1, Math.ceil((cc + across) / step) + 1);
    const r0 = Math.max(0, Math.floor((rr - up) / step) - 1); const r1 = Math.min(rows - 1, Math.ceil((rr + down) / step) + 1);
    if (c1 < c0 || r1 < r0) return null;
    const cw = c1 - c0 + 1; const rh = r1 - r0 + 1;
    const hit = new Uint8Array(cw * rh);
    let count = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const s = surface(c, r);
        if (!s) continue;
        if (s[2] - Math.max(heightAt(s[0], s[1]), water) < STANDING_MIN) continue; // the ground itself
        if (nearest(s[0], s[1]) !== index) continue;
        hit[(r - r0) * cw + (c - c0)] = 1; count++;
      }
    }
    if (!count) return null;
    // grow by one cell: the picture's soft edges belong to the object
    const mask = new Uint8Array(cw * rh);
    for (let r = 0; r < rh; r++) {
      for (let c = 0; c < cw; c++) {
        if (!hit[r * cw + c]) continue;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr2 = r + dr; const cc2 = c + dc; if (rr2 >= 0 && cc2 >= 0 && rr2 < rh && cc2 < cw) mask[rr2 * cw + cc2] = 1; }
      }
    }
    return { c0, r0, cw, rh, mask, count };
  };
}

/**
 * From the pixels of the box an object shows in, make its own picture (everything else see-through)
 * and the patch that hides it (ground colour where the object is, see-through elsewhere). The ground
 * colour of each row is run in from the ground pixels on either side of the object.
 * @param {Uint8ClampedArray} rgba  The box's pixels (changed in place: becomes the object's picture).
 * @param {number} w  Box width in pixels.
 * @param {number} h
 * @param {(px:number, py:number) => boolean} inside  True where a pixel shows the object.
 * @returns {Uint8ClampedArray} the patch's pixels
 */
export function cutOut(rgba, w, h, inside) {
  const patch = new Uint8ClampedArray(w * h * 4);
  // an average ground colour of the box, for rows that are the object from edge to edge
  let n = 0; const avg = [0, 0, 0];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (!inside(x, y)) { const i = (y * w + x) * 4; if (rgba[i + 3] > 200) { avg[0] += rgba[i]; avg[1] += rgba[i + 1]; avg[2] += rgba[i + 2]; n++; } }
  if (n) { avg[0] /= n; avg[1] /= n; avg[2] /= n; }
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!inside(x, y)) { rgba[(y * w + x) * 4 + 3] = 0; x++; continue; }
      let end = x;
      while (end < w && inside(end, y)) end++;
      // a run of object pixels x .. end-1: the ground colours just left and right of it
      const left = x > 0 ? (y * w + x - 1) * 4 : -1; const right = end < w ? (y * w + end) * 4 : -1;
      const L = left >= 0 ? [rgba[left], rgba[left + 1], rgba[left + 2]] : null;
      const R = right >= 0 ? [rgba[right], rgba[right + 1], rgba[right + 2]] : null;
      const a = L ?? R ?? avg; const b = R ?? L ?? avg;
      for (let q = x; q < end; q++) {
        const t = end - x > 1 ? (q - x) / (end - x - 1) : 0.5; const i = (y * w + q) * 4;
        // the ground beside the object, mirrored in over it from both sides, so the patch keeps the
        // ground's own texture (grass, sand) instead of flat streaks; plain edge colours where the
        // mirror would land on another object or outside the box
        const lq = x - 1 - (q - x); const rq = end + (end - 1 - q);
        const li = lq >= 0 && !inside(lq, y) ? (y * w + lq) * 4 : -1;
        const ri = rq < w && !inside(rq, y) ? (y * w + rq) * 4 : -1;
        for (let ch = 0; ch < 3; ch++) {
          const from = li >= 0 ? rgba[li + ch] : a[ch]; const to = ri >= 0 ? rgba[ri + ch] : b[ch];
          patch[i + ch] = from + (to - from) * t;
        }
        patch[i + 3] = 255;
      }
      x = end;
    }
  }
  return patch;
}

/**
 * Work out and cut the upright pictures of a view, about 4 ms of work at a time so the game never
 * stalls. The call itself does nothing but queue the first piece, so it is safe to call the moment a
 * picture arrives, also in the middle of a camera turn.
 * @param {object} view  A picture-mode scene view (with depthAt, heightAt, footprints, objects, projection).
 * @param {object} data  The view's name.json.
 * @param {CanvasImageSource|(() => CanvasImageSource)} picture  The view's picture (first frame), or a function that gives it (called later, not in this call).
 * @param {object} o
 * @param {(w:number, h:number) => object} o.createCanvas  Makes a canvas.
 * @param {(fn:() => void) => void} o.schedule  Runs a function a little later.
 * @param {() => boolean} [o.cancelled]  True when the view has been dropped.
 * @param {number} [o.width]   The picture's size in its own pixels (default: data.image.frameWidth and frameHeight; give them for a
 * @param {number} [o.height]  scene kept as text, whose picture is the canvas view.canvasFor(0) drew).
 * @returns {{ready:boolean, parts:Array}}  `parts` fills up as objects are done; `ready` turns true at the end.
 *   A part: { x, y, w, h (the box in picture pixels), ax, ay (where the object stands, picture pixels), picture, patch }.
 */
export function buildUprights(view, data, picture, o) {
  const out = { ready: false, parts: [] };
  const p = view.projection;
  const packed = data.depth?.[0];
  if (!p || !view.hasDepth || !view.objects.length) { out.ready = true; return out; }
  // Nothing is worked out in this call: every piece below runs later, a few milliseconds at a time.
  const BUDGET = 4; // milliseconds of work per turn
  const dCols = packed?.cols ?? data.cols; const dRows = packed?.rows ?? data.rows;
  const step = data.cols / dCols;
  const count = view.objects.length;
  const objects = new Array(count);
  const reachOf = new Map(); // how far a shape's parts reach from where it stands, per shape and parameters
  let pic = null; let picW = 0; let picH = 0; let px = 0; let cellsOf = null;
  let stage = 0; let next = 0; let cells = null;
  const one = () => {
    if (o.cancelled?.()) return;
    const t0 = Date.now();
    const spent = () => Date.now() - t0 >= BUDGET;
    for (;;) {
      if (stage === 0) { // the picture (a scene kept as text draws it here, if it has not been shown yet)
        pic = typeof picture === 'function' ? picture() : picture;
        picW = o.width ?? data.image?.frameWidth ?? pic?.width; picH = o.height ?? data.image?.frameHeight ?? pic?.height;
        if (!(picW > 0 && picH > 0)) throw new Error('buildUprights: give the width and height of the picture (o.width, o.height) for a scene that is not stored as a picture');
        px = picW / data.cols; // picture pixels per character
        stage = 1; next = 0;
      } else if (stage === 1) { // how far each object's parts reach: its whole outline, plus a little
        if (next >= count) {
          cellsOf = standingCells({
            cols: dCols, rows: dRows, step, projection: p, objects, water: data.view?.water ?? null,
            depth: (c, r) => view.depthAt((c + 0.5) * step, (r + 0.5) * step),
            heightAt: (x, y) => view.heightAt(x, y),
          });
          stage = 2; next = 0;
        } else {
          const obj = view.objects[next];
          const key = obj.shape + '|' + (obj.params ? JSON.stringify(obj.params) : '');
          let far = reachOf.get(key);
          if (far === undefined) {
            far = 1;
            try {
              for (const outline of shapeFootprint(obj.shape, obj.params ?? {}, { maxZ: 1e6 })) for (const [fx, fy] of outline) far = Math.max(far, Math.hypot(fx, fy));
            } catch { far = 3; } // a shape this copy of Kiln does not know: a fair guess
            reachOf.set(key, far);
          }
          objects[next] = { at: obj.at, reach: Math.max(1, far * (obj.scale ?? 1)) + 0.6 };
          next++;
        }
      } else if (stage === 2) { // which characters show the next object
        if (next >= count) { out.parts.sort((u, v) => u.ay - v.ay); out.ready = true; return; } // far to near
        cells = cellsOf(next);
        if (cells) stage = 3; else next++;
      } else { // cut that object out
        const index = next++; stage = 2;
        const cell = step * px; // picture pixels per depth cell
        const x = Math.round(cells.c0 * cell); const y = Math.round(cells.r0 * cell);
        const w = Math.min(picW - x, Math.round(cells.cw * cell)); const h = Math.min(picH - y, Math.round(cells.rh * cell));
        if (w >= 1 && h >= 1) {
          const mine = cells;
          const canvas = o.createCanvas(w, h);
          const g = canvas.getContext('2d', { willReadFrequently: true });
          g.drawImage(pic, x, y, w, h, 0, 0, w, h);
          const img = g.getImageData(0, 0, w, h);
          const inside = (qx, qy) => mine.mask[Math.min(mine.rh - 1, Math.floor(qy / cell)) * mine.cw + Math.min(mine.cw - 1, Math.floor(qx / cell))] === 1;
          const patchPixels = cutOut(img.data, w, h, inside);
          g.putImageData(img, 0, 0);
          const patch = o.createCanvas(w, h);
          const pg = patch.getContext('2d');
          const pimg = pg.createImageData(w, h); pimg.data.set(patchPixels); pg.putImageData(pimg, 0, 0);
          const foot = view.toCell(objects[index].at[0], objects[index].at[1]);
          out.parts.push({ index, x, y, w, h, ax: foot.col * px, ay: foot.row * px, picture: canvas, patch });
        }
      }
      if (spent()) break;
    }
    o.schedule(one);
  };
  o.schedule(one);
  return out;
}

/**
 * Draw a view's objects upright over its bent picture. Call with the context as it was when the
 * picture was drawn bent (the bend still applied).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{parts:Array}} uprights  From buildUprights (ready).
 * @param {number} x  Where the picture is drawn: left, top and the scale (screen pixels per picture pixel).
 * @param {number} y
 * @param {number} s
 * @param {number[]} warp  The bend, as the camera gives it: [a, b, c, d, e, f] of a canvas transform.
 */
export function drawUprights(ctx, uprights, x, y, s, warp) {
  // 2: hide the leaning objects under patches of ground, bent like the picture
  for (const part of uprights.parts) ctx.drawImage(part.patch, x + part.x * s, y + part.y * s, part.w * s, part.h * s);
  // 3: each object's own picture, upright, where its foot is now
  const det = warp[0] * warp[3] - warp[1] * warp[2];
  if (!det) return;
  ctx.save();
  // undo the bend for these
  ctx.transform(warp[3] / det, -warp[1] / det, -warp[2] / det, warp[0] / det, (warp[2] * warp[5] - warp[3] * warp[4]) / det, (warp[1] * warp[4] - warp[0] * warp[5]) / det);
  for (const part of uprights.parts) {
    const fx = x + part.ax * s; const fy = y + part.ay * s;
    const bx = warp[0] * fx + warp[2] * fy + warp[4]; const by = warp[1] * fx + warp[3] * fy + warp[5];
    ctx.drawImage(part.picture, Math.round(bx - (part.ax - part.x) * s), Math.round(by - (part.ay - part.y) * s), part.w * s, part.h * s);
  }
  ctx.restore();
}
