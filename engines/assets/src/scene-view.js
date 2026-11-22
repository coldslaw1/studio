// Game side of 3D scenes: draw a rendered scene (name.json from `kiln scene`) on a canvas as a
// backdrop or an animated sprite, convert ground positions to places on it, and draw sprites that
// pass behind the scenery (drawSprite, using the per-cell depth the renderer wrote). Browser-safe.
import { drawGrid } from './scene-draw.js';
import { terrainHeight } from './scene3d.js';
import { RAMP } from './ascii.js';
import { shapeFootprint } from './scene-shapes.js';

/**
 * @param {object} data  Parsed name.json written by `kiln scene`.
 * @param {{document?: Document, zoom?: number, image?: CanvasImageSource}} [opts]  zoom = pixels per glyph pixel of the cached picture (default 2 / detail, so 16 / detail pixels per character).
 *   image: the scene's name.png, needed for very fine scenes, which are stored as a picture
 *   instead of characters (data.image is set; loadSceneView fetches it for you).
 */
export function createSceneView(data, opts = {}) {
  if (!data || data.renderer !== 'asciicker' || !(data.sprites || data.image)) throw new Error('createSceneView: expected the name.json written by "kiln scene"');
  const doc = opts.document ?? globalThis.document;
  // keep the cached picture about the same pixel size whatever the scene's detail
  const zoom = opts.zoom ?? Math.max(0.25, 2 / (data.detail ?? 1));
  const img = data.image ?? null; // picture mode: frames side by side in one PNG
  if (img && !opts.image) throw new Error(`createSceneView: this scene is stored as a picture; pass { image } with ${img.file} loaded (loadSceneView does it)`);
  const count = img ? data.frames ?? 1 : Object.keys(data.sprites).length;
  const keys = img ? Array.from({ length: count }, (_, i) => i) : Object.keys(data.sprites);
  // where a frame sits in the picture: side by side, in rows of image.columns when given
  const across = img?.columns ?? count;
  const frameX = (i) => (i % across) * img.frameWidth;
  const frameY = (i) => Math.floor(i / across) * img.frameHeight;
  const cache = new Map();
  const canvasFor = (frame) => {
    const i = ((Math.floor(frame) % keys.length) + keys.length) % keys.length;
    if (!cache.has(i)) {
      const c = doc.createElement('canvas');
      if (img) {
        c.width = img.frameWidth;
        c.height = img.frameHeight;
        c.getContext('2d').drawImage(opts.image, frameX(i), frameY(i), img.frameWidth, img.frameHeight, 0, 0, img.frameWidth, img.frameHeight);
      } else {
        c.width = data.cols * 8 * zoom;
        c.height = data.rows * 8 * zoom;
        drawGrid(c.getContext('2d'), data.sprites[keys[i]], data.palette, zoom, 0, RAMP);
      }
      cache.set(i, c);
    }
    return cache.get(i);
  };
  const proj = data.view?.projection ?? null;
  // depth per frame: a plain array, or the packed { scale, data } form `kiln scene` writes (see packDepth)
  const unpack = (d) => {
    if (!d || Array.isArray(d)) return d ?? null;
    const bin = atob(d.data);
    const out = new Array(bin.length / 2);
    for (let i = 0; i < out.length; i++) {
      const v = ((bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16) >> 16;
      out[i] = v === -32768 ? null : v / d.scale;
    }
    return out;
  };
  // the depth grid is one value per character, or coarser for picture-mode scenes (its own cols x rows)
  const packed = img ? data.depth ?? [] : keys.map((k) => data.sprites[k].depth);
  const dCols = packed[0]?.cols ?? data.cols;
  const dRows = packed[0]?.rows ?? data.rows;
  const depths = proj ? packed.map(unpack) : [];
  // one depth entry per frame, or a single one that all frames share (only light and weather move)
  const hasDepth = (depths.length === keys.length || depths.length === 1) && depths.every((d) => d && d.length === dCols * dRows);
  const depthCell = (c, r, frame) => depths[depths.length === 1 ? 0 : ((Math.floor(frame) % keys.length) + keys.length) % keys.length][r * dCols + c] ?? null;
  let scratch = null;
  // finished sprite pictures kept by drawSprite: a few per sprite (or per o.slot), least recently used replaced
  const KEEP = 6;
  const keeps = new WeakMap();
  let keepClock = 0;
  const keepFor = (owner) => { if (owner === null || (typeof owner !== 'object' && typeof owner !== 'function')) return null; let k = keeps.get(owner); if (!k) { k = []; keeps.set(owner, k); } return k; };
  const view = {
    cols: data.cols,
    rows: data.rows,
    frames: keys.length,
    /** How ground positions map to characters (null for perspective scenes); see measureProjection. */
    projection: proj,
    /** Character rows that one metre of height covers in this picture. */
    rowsPerMetre: proj ? Math.abs(proj.row[3]) * 16 : null,
    /** The scene's detail (characters per unit of its size). */
    detail: data.detail ?? 1,
    fps: data.fps ?? 8,
    /** Natural size in pixels: 8 per character, or the stored picture's size for picture-mode scenes. */
    width: img ? img.frameWidth : data.cols * 8,
    height: img ? img.frameHeight : data.rows * 8,
    canvasFor,
    /** Frame number for a time in seconds (loops). */
    frameAt(seconds) { return Math.floor(seconds * view.fps) % keys.length; },
    /** Draw a frame into the rectangle x, y, w, h (TOP-LEFT corner, like atlas.draw). */
    draw(ctx, x, y, w = view.width, h = view.height, { frame = 0, flipX = false, alpha = 1 } = {}) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha *= alpha;
      if (img && keys.length > 1) {
        // an animated picture is drawn straight from the loaded image, so its frames are not held twice
        const i = ((Math.floor(frame) % keys.length) + keys.length) % keys.length;
        if (flipX) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(opts.image, frameX(i), frameY(i), img.frameWidth, img.frameHeight, 0, 0, w, h); } else ctx.drawImage(opts.image, frameX(i), frameY(i), img.frameWidth, img.frameHeight, x, y, w, h);
        ctx.restore();
        return;
      }
      const c = canvasFor(frame);
      if (flipX) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(c, 0, 0, w, h); } else ctx.drawImage(c, x, y, w, h);
      ctx.restore();
    },
    /** Ground height at x, y (0 when the scene has no terrain). */
    heightAt(x, y) { return terrainHeight(data.view?.terrain ?? null, x, y); },
    /** Character position (fractional column and row) of a ground point; z defaults to the ground height. */
    toCell(x, y, z = view.heightAt(x, y)) {
      if (!proj) throw new Error('scene view: this scene has no projection (perspective camera), so toCell is not available');
      const [ox, oy, oz] = proj.origin;
      return {
        col: proj.col[0] + proj.col[1] * (x - ox) + proj.col[2] * (y - oy) + proj.col[3] * (z - oz),
        row: proj.row[0] + proj.row[1] * (x - ox) + proj.row[2] * (y - oy) + proj.row[3] * (z - oz),
      };
    },
    /** Canvas point of a ground point when the scene is drawn into rect { x, y, w, h }. */
    toPoint(x, y, rect, z) {
      const c = view.toCell(x, y, z);
      return { x: rect.x + c.col / data.cols * rect.w, y: rect.y + c.row / data.rows * rect.h };
    },
    /** True when the scene carries a depth buffer, so drawSprite can hide sprites behind scenery. */
    hasDepth,
    /** Objects of the scene as written by `kiln scene`: [{ shape, at, yaw, scale, params? }]. */
    objects: data.view?.objects ?? [],
    /**
     * The filled part of this view's own picture, in its character cells, measured from its
     * ground point 0, 0 (bottom centre when it has no projection) over all frames.
     * @returns {{left:number, right:number, up:number, down:number}}
     */
    cellBounds() {
      let anchor;
      try { anchor = view.toCell(0, 0, 0); } catch { anchor = { col: data.cols / 2, row: data.rows }; }
      const b = { left: 0, right: 0, up: 0, down: 0 };
      for (const key of keys) {
        const g = data.sprites[key];
        for (let r = 0; r < data.rows; r++) {
          for (let c = 0; c < data.cols; c++) {
            const i = r * data.cols + c;
            if (g.bg[i] === -1 && (g.fg[i] === -1 || g.ch[r][c] === ' ')) continue;
            b.left = Math.max(b.left, anchor.col - c); b.right = Math.max(b.right, c + 1 - anchor.col);
            b.up = Math.max(b.up, anchor.row - r); b.down = Math.max(b.down, r + 1 - anchor.row);
          }
        }
      }
      return b;
    },
    /**
     * How many of this scene's characters one character of a sprite view covers when the sprite is
     * drawn true to life: both pictures know how many rows a metre of height takes, so the answer
     * does not depend on the camera zoom or detail either was rendered at.
     */
    lifeScale(sprite) {
      const here = proj?.row[3]; const there = sprite.projection?.row[3];
      return here && there ? here / there : view.detail / (sprite.detail ?? view.detail);
    },
    /**
     * How big a sprite (another scene view) is when drawn on this scene with drawSprite, in this
     * scene's units. Use it to size collision so the picture never cuts into scenery:
     * a circle of `radius` at the sprite's ground position covers its width, and
     * footprints({ maxZ: height }) blocks everything lower than its head.
     * @param {object} sprite  A scene view.
     * @param {{scale?: number}} [o]  The same scale you give drawSprite (default 1).
     * @returns {{radius:number, height:number}}  radius in ground units, height in height units (16 per ground unit).
     */
    spriteExtent(sprite, o = {}) {
      if (!proj) throw new Error('scene view: this scene has no projection (perspective camera), so spriteExtent is not available');
      if (!((o.scale ?? 1) > 0)) throw new Error(`spriteExtent: scale must be > 0, got ${o.scale}`);
      const scale = (o.scale ?? 1) * view.lifeScale(sprite); // the same size drawSprite uses
      const b = sprite.cellBounds();
      // columns per ground unit along the direction that runs straight across the screen
      const colsPerUnit = Math.abs(proj.col[1] * proj.row[2] - proj.col[2] * proj.row[1]) / Math.hypot(proj.row[1], proj.row[2]);
      return { radius: Math.max(b.left, b.right) * scale / colsPerUnit, height: b.up * scale / Math.abs(proj.row[3]) };
    },
    /**
     * Ground outlines of the scene's objects, ready for collision: convex polygons in ground
     * units with each object's position, yaw and scale applied. Only the parts that reach the
     * ground count, so characters can walk under roof edges and tree tops and through a gate.
     * Give each one to the collision engine's world.add() to block characters from buildings.
     * @param {{maxZ?: number, skip?: string[]}} [o]  maxZ: ignore parts starting above this height
     *   (sixteenths of a unit, default 12). skip: shape names to leave out, e.g. ['bridge'].
     * @returns {Array<{x:number, y:number, points:Array<[number, number]>, shape:string, object:number}>}
     *   x, y = the object's position, points relative to it, object = index into view.objects.
     */
    footprints(o = {}) {
      const out = [];
      view.objects.forEach((obj, index) => {
        if ((o.skip ?? []).includes(obj.shape)) return;
        const a = (obj.yaw ?? 0) * Math.PI / 180;
        const c = Math.cos(a) * (obj.scale ?? 1);
        const s = Math.sin(a) * (obj.scale ?? 1);
        for (const outline of shapeFootprint(obj.shape, obj.params ?? {}, { maxZ: o.maxZ })) {
          out.push({ x: obj.at[0], y: obj.at[1], points: outline.map(([px, py]) => [px * c - py * s, px * s + py * c]), shape: obj.shape, object: index });
        }
      });
      return out;
    },
    /** Depth of the scenery in one character cell (larger = nearer the camera), or null where nothing can hide a sprite. */
    depthAt(col, row, frame = 0) {
      if (!hasDepth || col < 0 || row < 0 || col >= data.cols || row >= data.rows) return null;
      return depthCell(Math.min(dCols - 1, Math.floor(col * dCols / data.cols)), Math.min(dRows - 1, Math.floor(row * dRows / data.rows)), frame);
    },
    /** Depth of something standing at ground x, y, on the same scale as depthAt. Sort sprites by it (small first). */
    depthOf(x, y) {
      if (!proj) throw new Error('scene view: this scene has no projection (perspective camera), so depthOf is not available');
      return proj.row[0] + proj.row[1] * (x - proj.origin[0]) + proj.row[2] * (y - proj.origin[1]);
    },
    /**
     * True when scenery hides the point at ground x, y and height z above the ground there
     * (z in height units, 16 per ground unit). Handy for "is the player behind something".
     */
    isHidden(x, y, z = 0, { frame = 0, bias = 0.5 } = {}) {
      if (!hasDepth) return false;
      const c = view.toCell(x, y, view.heightAt(x, y) + z);
      const d = view.depthAt(c.col, c.row, frame);
      return d !== null && d > view.depthOf(x, y) + bias;
    },
    /**
     * Draw another scene view (a character sprite made by `kiln scene`) standing at ground x, y of
     * this scene, which is drawn into rect { x, y, w, h }. Parts of the sprite behind houses, trees
     * or hills are cut away, using this scene's depth buffer. Draw the backdrop first, then every
     * sprite; order between sprites is up to the caller (sort by depthOf, small first).
     * @param {object} sprite  A scene view. Its ground point 0, 0 is placed on x, y (bottom centre when it has no projection).
     * @param {{frame?:number, flipX?:boolean, alpha?:number, scale?:number, z?:number, sceneFrame?:number, bias?:number, occlude?:boolean, version?:number|string, slot?:object, cache?:boolean}} [o]
     *   scale: 1 (default) draws the sprite true to life, in proportion to this scene's buildings, whatever zoom or detail either was rendered at; 1.5 draws it half as big again. z: height above the ground.
     *   bias: how many rows nearer the scenery must be before it hides the sprite (default 0.5).
     *   occlude false draws it on top, as before.
     *   The finished, cut-out picture is kept and reused while nothing it depends on changes, so a
     *   sprite that stands still costs one image copy a frame. A live sprite reports a new picture
     *   through its `version` (any value that changes), or pass `version`; text sprites from the
     *   puppet engine are noticed by themselves. `slot`: an object of yours per thing on screen,
     *   when one sprite is drawn in many places at once. `cache: false` paints every time.
     *   Sprites wholly outside the canvas are skipped (`offscreen: true` in the result).
     * @returns {{x:number, y:number, w:number, h:number, cells:number, hidden:number}}  Where it was drawn, and how many backdrop cells of it were checked and hidden.
     */
    drawSprite(ctx, rect, sprite, x, y, o = {}) {
      const { frame = 0, flipX = false, alpha = 1, z = 0, sceneFrame = 0, occlude = true } = o;
      // True to life: both pictures know how many character rows one unit of height covers, so the
      // sprite is sized by that ratio, whatever camera zoom or detail each was rendered at.
      const scale = (o.scale ?? 1) * view.lifeScale(sprite);
      let cw = rect.w / data.cols;
      let chh = rect.h / data.rows;
      const feet = view.toPoint(x, y, rect, view.heightAt(x, y) + z);
      let anchor;
      try { anchor = sprite.toCell(0, 0, 0); } catch { anchor = { col: sprite.cols / 2, row: sprite.rows }; }
      const w = Math.max(1, Math.round(sprite.cols * cw * scale));
      const h = Math.max(1, Math.round(sprite.rows * chh * scale));
      const left = Math.round(feet.x - (flipX ? sprite.cols - anchor.col : anchor.col) * cw * scale);
      const top = Math.round(feet.y - anchor.row * chh * scale);
      const out = { x: left, y: top, w, h, cells: 0, hidden: 0 };
      // nothing to do for a sprite that is wholly outside the canvas
      const cv = ctx.canvas;
      if (cv && cv.width > 0 && cv.height > 0 && (left >= cv.width || top >= cv.height || left + w <= 0 || top + h <= 0)) { out.offscreen = true; return out; }
      // The finished picture (painted and cut out behind scenery) is kept, and painted again only
      // when something it depends on changes: where the sprite stands on this scene, its size, its
      // frame, or its own picture. A live sprite says its picture changed through `version` (or
      // o.version); a text sprite hands out a new grid when its puppet moved, which counts too.
      const kept = o.cache === false ? null : keepFor(o.slot ?? sprite);
      let entry = null; let key = '';
      if (kept) {
        const token = o.version ?? sprite.version ?? sprite.grid ?? 0;
        key = `${left - rect.x},${top - rect.y},${w},${h},${Math.floor(frame)},${flipX ? 1 : 0},${occlude && hasDepth ? Math.floor(sceneFrame) + ':' + (o.bias ?? 0.5) + ':' + Math.round(view.depthOf(x, y) * 64) : 'top'},${rect.w},${rect.h},${typeof token === 'object' ? '' : token}`;
        entry = kept.find((e) => e.key === key && e.token === token && e.sprite === sprite);
        if (entry) {
          entry.used = ++keepClock;
          if (entry.out.cells === 0 || entry.out.hidden < entry.out.cells) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha *= alpha; ctx.drawImage(entry.canvas, left, top); ctx.restore(); }
          return { ...entry.out, x: left, y: top, cached: true };
        }
        // not kept yet: take a free place, or the one not used for the longest time
        entry = kept.length < KEEP ? null : kept.reduce((a, b) => (a.used < b.used ? a : b));
        if (!entry) { entry = { canvas: doc.createElement('canvas'), key: '', token: null, sprite: null, out: null, used: 0 }; kept.push(entry); }
        entry.key = key; entry.token = token; entry.sprite = sprite; entry.used = ++keepClock;
        if (entry.canvas.width !== w || entry.canvas.height !== h) { entry.canvas.width = w; entry.canvas.height = h; }
      }
      // paint into the kept canvas (or straight to the screen with cache: false)
      const paintTo = (runs) => {
        const c = entry ? entry.canvas : (scratch ??= doc.createElement('canvas'));
        if (!entry && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
        const g = c.getContext('2d');
        g.clearRect(0, 0, w, h);
        sprite.draw(g, 0, 0, w, h, { frame, flipX });
        for (const [cc, r, n] of runs) {
          const x0 = Math.floor(rect.x + cc * cw) - left; const y0 = Math.floor(rect.y + r * chh) - top;
          g.clearRect(x0, y0, Math.ceil(rect.x + (cc + n) * cw) - left - x0, Math.ceil(rect.y + (r + 1) * chh) - top - y0);
        }
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha *= alpha;
        ctx.drawImage(c, left, top);
        ctx.restore();
      };
      if (!occlude || !hasDepth) {
        if (entry) { paintTo([]); entry.out = out; } else sprite.draw(ctx, left, top, w, h, { frame, flipX, alpha });
        return out;
      }
      const base = view.depthOf(x, y) + (o.bias ?? 0.5);
      const feetRow = (feet.y - rect.y) / chh; // in character rows, like the depth values
      // from here on work in depth-grid cells, which are several characters wide for picture-mode scenes
      const rowStep = data.rows / dRows;
      cw = rect.w / dCols; chh = rect.h / dRows;
      const c0 = Math.max(0, Math.floor((left - rect.x) / cw)); const c1 = Math.min(dCols - 1, Math.floor((left + w - 1 - rect.x) / cw));
      const r0 = Math.max(0, Math.floor((top - rect.y) / chh)); const r1 = Math.min(dRows - 1, Math.floor((top + h - 1 - rect.y) / chh));
      const runs = []; // [col, row, length] of backdrop cells that are in front of the sprite
      for (let r = r0; r <= r1; r++) {
        // rows of the sprite below its feet point are the parts nearest the camera (toes, a shadow):
        // count them as that much nearer, so the ground the sprite stands on never cuts them
        const mine = base + Math.max(0, (r + 0.5) * rowStep - feetRow);
        let start = -1;
        for (let c = c0; c <= c1 + 1; c++) {
          const d = c <= c1 ? depthCell(c, r, sceneFrame) : null;
          const hide = d !== null && d > mine;
          if (c <= c1) { out.cells++; if (hide) out.hidden++; }
          if (hide && start < 0) start = c;
          if (!hide && start >= 0) { runs.push([start, r, c - start]); start = -1; }
        }
      }
      if (entry) entry.out = out;
      if (out.cells > 0 && out.hidden === out.cells) return out; // fully behind something
      if (!runs.length && !entry) { sprite.draw(ctx, left, top, w, h, { frame, flipX, alpha }); return out; }
      paintTo(runs);
      return out;
    },
    /** True when the ground at x, y is below the scene's water level. */
    isWater(x, y) { return typeof data.view?.water === 'number' && view.heightAt(x, y) < data.view.water; },
  };
  return view;
}

/** Fetch name.json (and its picture, for very fine scenes) and make a view. `fetch`, `document` and `loadImage` can be injected for tests. */
export async function loadSceneView(url, opts = {}) {
  const res = await (opts.fetch ?? globalThis.fetch)(url);
  if (!res.ok) throw new Error(`loadSceneView: could not load ${url} (${res.status})`);
  const data = await res.json();
  if (!data.image || opts.image) return createSceneView(data, opts);
  // picture-mode scene: its PNG sits next to the json
  const src = new URL(data.image.file, new URL(url, globalThis.location?.href ?? 'file:///')).href;
  const image = await (opts.loadImage ?? ((u) => new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error(`loadSceneView: could not load ${u}`));
    im.src = u;
  })))(src);
  return createSceneView(data, { ...opts, image });
}
