// Joins a camera to a baked scene orbit (Kiln's loadSceneOrbit, or anything with the same shape):
// each frame it picks the baked angle nearest the camera's yaw and the detail level that keeps the
// characters the same size on screen at the camera's zoom, and works out the rectangle to draw that
// picture in so the camera's look-at point sits in the middle of the canvas.
import { angleDelta, nearestYawIndex } from './ease.js';

/**
 * Which detail level to show at a zoom: the one whose detail, relative to the coarsest, is nearest
 * the zoom (on a doubling scale). Zoom 1 shows details[0], zoom 2 the level twice as fine, and so on.
 * @param {number[]} details  Rising detail values.
 * @param {number} zoom
 * @returns {number} index into details
 */
export function pickLevel(details, zoom) {
  if (!Array.isArray(details) || details.length === 0) throw new Error('pickLevel: "details" must be a list with at least one detail');
  if (!(zoom > 0)) throw new Error(`pickLevel: zoom must be above 0, got ${zoom}`);
  let best = 0;
  let bestGap = Infinity;
  details.forEach((d, i) => {
    const gap = Math.abs(Math.log(d / details[0]) - Math.log(zoom));
    if (gap <= bestGap + 1e-9) { best = i; bestGap = gap; } // on a tie the finer one wins
  });
  return best;
}

/**
 * The ground step that moves `dist` in a screen direction on a view, so "right" on the keyboard
 * is right on the screen whatever angle the camera is at.
 * @param {{toCell:Function}} view  The view being shown.
 * @param {number} dx  Screen direction: 1 right, -1 left.
 * @param {number} dy  1 down, -1 up.
 * @param {number} dist  Length of the step in ground units.
 * @returns {[number, number]} ground [x, y] step
 */
export function screenStep(view, dx, dy, dist) {
  const o = view.toCell(0, 0, 0); const a = view.toCell(1, 0, 0); const b = view.toCell(0, 1, 0);
  const m = [[a.col - o.col, b.col - o.col], [a.row - o.row, b.row - o.row]];
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  if (!det) throw new Error('screenStep: this view looks along the ground, so screen directions have no ground step');
  const gx = (dx * m[1][1] - dy * m[0][1]) / det; const gy = (dy * m[0][0] - dx * m[1][0]) / det;
  const len = Math.hypot(gx, gy) || 1;
  return [gx / len * dist, gy / len * dist];
}

/**
 * @param {object} options
 * @param {object} options.camera  From createCamera. Give it `yaws: orbit.yaws` so it rests on baked angles.
 * @param {object} options.orbit   { yaws, details, view(yawIndex, level), load(yawIndex, level) } as made by Kiln's loadSceneOrbit.
 * @param {number} options.width   Canvas width in pixels.
 * @param {number} options.height
 * @param {number} [options.cellPx]  Pixels per character of the coarsest level at zoom 1 (default 4). Finer levels are shown at the same size when the zoom reaches them.
 * @param {boolean} [options.clamp]  Keep the picture covering the canvas at its edges (default true).
 * @param {number} [options.ahead]  While the camera rests, keep this many angles on each side loaded (default 1), nearest first, so a turn starts at once instead of waiting for a picture. Use the number of angles one key press turns (3 for 45 degree presses on 15 degree angles) when memory allows; the orbit must keep at least 2 x ahead + 2 views.
 * @param {boolean} [options.dissolve]  Turn smoothly between baked angles instead of cutting from one to the next (default: on when the angles are 20 degrees apart or less). Each picture is bent to the camera's true angle (the ground moves exactly as it would; tall things lean a little) and, when the picture changes to the next angle, the old one fades out over it. The frame then carries `warp`, `blend` and `shift`; `sceneCamera.draw` uses them.
 * @param {(width:number, height:number) => object} [options.createCanvas]  Makes the spare canvas the fade between angles is drawn on (default: an OffscreenCanvas, or a canvas from the game canvas's document).
 * @param {number} [options.fadeTime]  Seconds the picture of the last angle takes to fade out over the next one (default 0.16).
 * @param {number} [options.lead]   How far ahead of the easing yaw the picture is chosen while turning, as a share of the gap between angles (default 0.3). The first new picture then shows about a tenth of a second after the key instead of two.
 * @returns {object} sceneCamera
 */
export function createSceneCamera(options) {
  const { camera } = options ?? {};
  let { orbit } = options ?? {};
  if (!camera || typeof camera.update !== 'function') throw new Error('createSceneCamera: "camera" must come from createCamera');
  if (!orbit || !Array.isArray(orbit.yaws) || !Array.isArray(orbit.details) || typeof orbit.view !== 'function') throw new Error('createSceneCamera: "orbit" must have yaws, details and view(yawIndex, level)');
  let { width, height } = options;
  if (!(width > 0 && height > 0)) throw new Error(`createSceneCamera: width and height must be above 0, got ${width} x ${height}`);
  const cellPx = options.cellPx ?? 4;
  if (!(cellPx > 0)) throw new Error(`createSceneCamera: "cellPx" must be above 0, got ${cellPx}`);
  const clamp = options.clamp ?? true;
  const ahead = options.ahead ?? 1;
  const dissolve = options.dissolve ?? (360 / orbit.yaws.length <= 20);
  const lead = options.lead ?? 0.3;
  if (!(Number.isInteger(ahead) && ahead >= 0)) throw new Error(`createSceneCamera: "ahead" must be a whole number, 0 or more, got ${options.ahead}`);
  if (!(lead >= 0 && lead < 0.5)) throw new Error(`createSceneCamera: "lead" must be from 0 to under 0.5, got ${options.lead}`);
  let rested = ''; // the angle and level the resting look-ahead was last worked out for
  let queue = []; // [yawIndex, level] still to ask for at this resting place
  let n = orbit.yaws.length;
  let shown = null; // { view, yawIndex, level }
  let current = null; // the orbit `shown` came from; a picture of another orbit is only kept on screen, never asked for again

  const fit = (size, room, middle) => {
    if (!clamp) return middle;
    if (size <= room) return (room - size) / 2;
    return Math.min(0, Math.max(room - size, middle));
  };

  // Turning the camera about the point it looks at moves every point of the GROUND the same way a
  // plain 2D transform of the picture does (a turn of the ground, seen through the tilted view). So a
  // baked picture can be shown as if the camera stood a few degrees further round: the ground, paths
  // and shores land exactly where the next baked angle has them, and only tall things lean a little.
  // Both pictures of a dissolve are bent to the camera's true angle, so they agree instead of ghosting.
  let groundTurn = 0; // which way the ground turns on screen when the yaw rises: found from two views, -1 until then
  const basis = (v) => {
    const o = v.toCell(0, 0, 0); const a = v.toCell(1, 0, 0); const b = v.toCell(0, 1, 0);
    return [a.col - o.col, b.col - o.col, a.row - o.row, b.row - o.row]; // [m00, m01, m10, m11]
  };
  const findGroundTurn = () => {
    if (groundTurn || n < 2 || typeof orbit.has !== 'function') return groundTurn || -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const li = orbit.details.findIndex((_, l) => orbit.has(i, l) && orbit.has(j, l));
      if (li < 0) continue;
      const A = basis(orbit.view(i, li)); const B = basis(orbit.view(j, li));
      const d = angleDelta(orbit.yaws[i], orbit.yaws[j]) * Math.PI / 180;
      const err = (sign) => { const c = Math.cos(sign * d); const t = Math.sin(sign * d); return Math.abs(A[0] * c + A[1] * t - B[0]) + Math.abs(-A[0] * t + A[1] * c - B[1]) + Math.abs(A[2] * c + A[3] * t - B[2]) + Math.abs(-A[2] * t + A[3] * c - B[3]); };
      groundTurn = err(1) <= err(-1) ? 1 : -1;
      return groundTurn;
    }
    return -1;
  };
  /** The canvas transform [a, b, c, d, e, f] that shows view `v` (drawn in `rect`) as if the camera had turned `degrees` further. */
  const warpOf = (v, rect, px, degrees) => {
    if (Math.abs(degrees) < 0.01) return null;
    const P = basis(v);
    const det = P[0] * P[3] - P[1] * P[2];
    if (!det) return null;
    const g = findGroundTurn() * degrees * Math.PI / 180; const c = Math.cos(g); const t = Math.sin(g);
    // M = P * turn(g) * inverse(P)
    const q = [P[0] * c + P[1] * t, -P[0] * t + P[1] * c, P[2] * c + P[3] * t, -P[2] * t + P[3] * c];
    const m00 = (q[0] * P[3] - q[1] * P[2]) / det; const m01 = (-q[0] * P[1] + q[1] * P[0]) / det;
    const m10 = (q[2] * P[3] - q[3] * P[2]) / det; const m11 = (-q[2] * P[1] + q[3] * P[0]) / det;
    const f = v.toCell(camera.x, camera.y);
    const fx = rect.x + f.col * px; const fy = rect.y + f.row * px; // the point looked at stays put
    return [m00, m10, m01, m11, fx - (m00 * fx + m01 * fy), fy - (m10 * fx + m11 * fy)];
  };
  // a spare canvas the size of the game's, for laying one whole picture over another
  let spare = null;
  const spareFor = (ctx) => {
    const make = options.createCanvas ?? ((w, h) => {
      if (typeof globalThis.OffscreenCanvas === 'function') return new globalThis.OffscreenCanvas(w, h);
      const doc = ctx.canvas?.ownerDocument;
      if (!doc) return null;
      const c = doc.createElement('canvas'); c.width = w; c.height = h; return c;
    });
    if (!spare || spare.width !== width || spare.height !== height) spare = make(width, height);
    return spare;
  };
  // Views handed out in a frame place things on the picture as it is drawn, bent or not: toPoint
  // answers for the bent picture and drawSprite moves the sprite with the ground under it, so
  // characters, markers and health bars stay where they stand through a turn. The move is worked
  // out from the point looked at, so it is the same whatever rectangle the caller draws into (a
  // game that draws a sprite into a small canvas of its own first gets the same answer).
  const bentViews = new WeakMap();
  let bending = null; // { view, warp }: the main picture's bend this frame
  const moveOf = (v, p, r) => {
    const m = bending && bending.view === v ? bending.warp : null;
    if (!m) return null;
    const f = v.toPoint(camera.x, camera.y, r);
    const px = p.x - f.x; const py = p.y - f.y;
    return { dx: (m[0] - 1) * px + m[2] * py, dy: m[1] * px + (m[3] - 1) * py };
  };
  const bentView = (v) => {
    let b = bentViews.get(v);
    if (!b) {
      b = Object.create(v);
      b.unbent = v;
      b.toPoint = (x, y, r, z) => {
        const p = v.toPoint(x, y, r, z);
        const d = moveOf(v, p, r);
        return d ? { x: p.x + d.dx, y: p.y + d.dy } : p;
      };
      if (typeof v.drawSprite === 'function') {
        b.drawSprite = (ctx, r, sprite, x, y, o) => {
          const d = moveOf(v, v.toPoint(x, y, r), r);
          const dx = d ? Math.round(d.dx) : 0; const dy = d ? Math.round(d.dy) : 0;
          if (!dx && !dy) return v.drawSprite(ctx, r, sprite, x, y, o);
          ctx.save(); ctx.translate(dx, dy);
          let out;
          try { out = v.drawSprite(ctx, r, sprite, x, y, o); } finally { ctx.restore(); }
          return out && typeof out.x === 'number' ? { ...out, x: out.x + dx, y: out.y + dy } : out;
        };
      }
      bentViews.set(v, b);
    }
    return b;
  };
  const KEEP = 0.56; // share of the gap between angles that the picture on screen is kept for
  const fadeTime = options.fadeTime ?? 0.16;
  if (!(fadeTime > 0)) throw new Error(`createSceneCamera: "fadeTime" must be above 0 seconds, got ${options.fadeTime}`);
  let fade = null; // { view, yawIndex, level, at }: the picture just replaced, fading out
  let beforeOrbit = null;
  let levelBias = 0;
  const levelAt = (zoom) => Math.min(orbit.details.length - 1, Math.max(0, pickLevel(orbit.details, zoom) + levelBias));
  const sceneCamera = {
    camera,
    /**
     * A quality setting: -1 shows one picture level coarser than the zoom asks for, 1 one finer, 0 (the
     * default) the matching one. The picture is drawn at the same size either way, so only its
     * fineness (and the memory and loading it costs) changes. Kept within the levels the orbit has.
     */
    get levelBias() { return levelBias; },
    set levelBias(v) {
      if (!Number.isInteger(v)) throw new Error(`sceneCamera.levelBias: expected a whole number such as -1, 0 or 1, got ${v}`);
      levelBias = v; rested = '';
    },
    get orbit() { return orbit; },
    /**
     * Swap to another orbit with the same yaws and details, for worlds made of pages that each have
     * their own pictures. The picture on screen stays until the new orbit has one to show.
     */
    setOrbit(next) {
      if (!next || !Array.isArray(next.yaws) || !Array.isArray(next.details) || typeof next.view !== 'function') throw new Error('sceneCamera.setOrbit: "orbit" must have yaws, details and view(yawIndex, level)');
      if (next.yaws.length !== orbit.yaws.length || next.details.length !== orbit.details.length) throw new Error('sceneCamera.setOrbit: the new orbit must have as many yaws and details as the old one');
      orbit = next; n = orbit.yaws.length; current = null; groundTurn = 0;
      return sceneCamera;
    },
    /**
     * Draw this frame's backdrop: the picture frame() chose, bent to the camera's true angle while it
     * turns, with the next angle faded over it. Returns what frame() returned, for drawing sprites with
     * its `view` and `rect`: that view's toPoint and drawSprite follow the bend, so they stay on the ground.
     * @param {CanvasRenderingContext2D} ctx
     * @param {{seconds?: number}} [o]  seconds: the game clock, for animated pictures.
     */
    draw(ctx, o = {}) {
      const f = sceneCamera.frame();
      if (!f) return null;
      const at = (v) => (typeof v.frameAt === 'function' ? v.frameAt(o.seconds ?? 0) : 0);
      const paint = (g, v, r, warp, alpha) => {
        if (warp) { g.save(); g.transform(...warp); }
        // `turned` tells a view that it is being shown bent, and how: Kiln's orbit views then draw their
        // objects upright over the bent ground instead of leaning with it
        // It is given in the draw options and also left on the context for the length of the call,
        // because a view may be a stand-in that draws several pictures (two times of day fading into
        // each other) and hands only some of the options on to each.
        if (warp) g.turned = { warp };
        try { v.draw(g, r.x, r.y, r.w, r.h, warp ? { frame: at(v), alpha, turned: { warp } } : { frame: at(v), alpha }); } finally { if (warp) delete g.turned; }
        if (warp) g.restore();
      };
      const plain = f.view.unbent ?? f.view;
      // A bent picture leaves thin wedges uncovered where it reaches the edge of the canvas: the same
      // picture, not bent, goes underneath so they show ground and sea, not the background colour.
      if (f.warp) paint(ctx, plain, f.rect, null, 1);
      paint(ctx, plain, f.rect, f.warp, 1);
      if (f.blend) {
        // The next angle is drawn whole on a spare canvas and laid over at its share. Drawn straight
        // on with an alpha, anything a view paints after its picture (a time-of-day tint, a grade)
        // would fall on the first picture a second time and the light would pulse at every angle.
        const spare = spareFor(ctx);
        if (spare) {
          const g = spare.getContext('2d');
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.clearRect(0, 0, spare.width, spare.height);
          paint(g, f.blend.view, f.blend.rect, null, 1);
          paint(g, f.blend.view, f.blend.rect, f.blend.warp, 1);
          ctx.save(); ctx.globalAlpha *= f.blend.alpha; ctx.drawImage(spare, 0, 0); ctx.restore();
        } else paint(ctx, f.blend.view, f.blend.rect, f.blend.warp, f.blend.alpha);
      }
      return f;
    },
    /** Tell the camera the canvas changed size (in the canvas's own pixels). */
    resize(w, h) {
      if (!(w > 0 && h > 0)) throw new Error(`sceneCamera.resize: width and height must be above 0, got ${w} x ${h}`);
      width = w; height = h;
      return sceneCamera;
    },
    /** Zoom at which the whole baked picture fits the canvas (smaller than 1 when the picture is bigger than the canvas). */
    fitZoom(view) {
      const scale = cellPx * orbit.details[0] / view.detail;
      return Math.min(width / (view.cols * scale), height / (view.rows * scale));
    },
    /** Load the view the camera starts on, so the first frame has a picture. */
    async ready() {
      const yawIndex = nearestYawIndex(orbit.yaws, camera.yaw);
      const level = levelAt(camera.zoom);
      shown = { view: await orbit.load(yawIndex, level), yawIndex, level };
      current = orbit;
      return sceneCamera;
    },
    /**
     * What to draw this frame. Call it after camera.update(dt).
     * @returns {{view:object, rect:{x:number,y:number,w:number,h:number}, yawIndex:number, level:number, cellPx:number, waiting:boolean}|null}
     *   view: the scene view to draw; rect: pass it to view.draw, view.drawSprite and view.toPoint;
     *   cellPx: pixels per character of that view on screen; waiting: true while the wanted picture
     *   is still loading and an earlier one is shown instead. null before anything has loaded.
     */
    frame() {
      // while easing, look a little ahead of the yaw, so the picture answers a key press promptly
      // (with a dissolve the fade itself answers at once, and the nearest angle is the main picture)
      let yawIndex = nearestYawIndex(orbit.yaws, camera.yaw + (dissolve ? 0 : (camera.turning || 0) * lead * 360 / n));
      // with a dissolve the picture on screen is kept a little past half way to the next angle, so a
      // camera held right between two angles does not flick back and forth between them
      if (dissolve && shown && current === orbit && yawIndex !== shown.yawIndex && Math.abs(angleDelta(orbit.yaws[shown.yawIndex], camera.yaw)) <= KEEP * 360 / n) yawIndex = shown.yawIndex;
      const before = shown;
      const level = levelAt(camera.zoom);
      // During a fast spin angles go by quicker than pictures load. Starting a load for every one
      // would queue dozens of big pictures and stall the game, so while a few are on their way
      // and the camera is still moving, nothing new is asked for; it catches up when it slows.
      const busy = (orbit.pending ?? 0) >= 3 && camera.moving;
      const wanted = busy && typeof orbit.has === 'function' && !orbit.has(yawIndex, level) ? null : orbit.view(yawIndex, level);
      if (wanted) { shown = { view: wanted, yawIndex, level }; current = orbit; }
      else {
        // Not loaded yet. The right angle matters more than the right detail (a wrong angle makes the
        // turn stick), so show another level of this angle if one is in memory, and ask for the
        // coarsest one, which is small and arrives quickly.
        const others = orbit.details.map((_, i) => i).filter((i) => i !== level).sort((a, b) => Math.abs(a - level) - Math.abs(b - level));
        const have = typeof orbit.has === 'function' ? others.find((i) => orbit.has(yawIndex, i)) : undefined;
        if (have !== undefined) { shown = { view: orbit.view(yawIndex, have), yawIndex, level: have }; current = orbit; }
        else {
          if (level !== 0 && camera.turning && !busy) orbit.load(yawIndex, 0);
          if (shown && current === orbit) orbit.view(shown.yawIndex, shown.level); // keep the one on screen in memory
        }
      }
      // get the pictures the camera is about to need
      const goal = camera.target;
      const way = camera.turning < 0 ? -1 : 1; // the way it is really turning, which may be the long way round
      const goalYaw = nearestYawIndex(orbit.yaws, goal.yaw);
      const goalLevel = levelAt(goal.zoom);
      if (goalLevel !== level && !busy) orbit.load(yawIndex, goalLevel);
      if (goalYaw !== yawIndex && !busy) {
        const steps = Math.min(2, way > 0 ? (goalYaw - yawIndex + n) % n : (yawIndex - goalYaw + n) % n);
        for (let k = 1; k <= steps; k++) orbit.load((yawIndex + way * k + n) % n, level); // the next two on the way
        orbit.load(goalYaw, goalLevel);
      }
      // At rest: get the neighbouring angles ready, nearest first, two loads at a time. Each is asked
      // for once per resting place, so an orbit that keeps few views is not made to reload for ever.
      // ("at rest" here means on the picture it is heading for: the last part of an eased turn is slow, and
      // waiting for it to stop entirely would leave the next key press without its pictures)
      const arrived = goalYaw === yawIndex && goalLevel === level;
      if (arrived && wanted && ahead > 0) {
        const place = `${yawIndex}:${level}`;
        if (place !== rested) {
          rested = place; queue = [];
          // first the next zoom levels of this angle (a wheel notch away), then the angles either side
          for (const li of [level + 1, level - 1]) if (li >= 0 && li < orbit.details.length) queue.push([yawIndex, li]);
          for (let k = 1; k <= Math.min(ahead, Math.floor((n - 1) / 2)); k++) queue.push([(yawIndex + k) % n, level], [(yawIndex - k + n) % n, level]);
        }
        while (queue.length && (orbit.pending ?? 0) < 2) { const [yi, li] = queue.shift(); if (typeof orbit.has !== 'function' || !orbit.has(yi, li)) orbit.load(yi, li); }
      } else if (!arrived) rested = '';
      if (!shown) return null;
      const view = shown.view;
      const px = cellPx * camera.zoom * orbit.details[0] / orbit.details[shown.level];
      const place = (v) => {
        const w = v.cols * px; const h = v.rows * px;
        const c = v.toCell(camera.x, camera.y);
        return { x: Math.round(fit(w, width, width / 2 - c.col * px)), y: Math.round(fit(h, height, height / 2 - c.row * px)), w, h };
      };
      // Between two baked angles: the next one, faded in by how far the camera has turned toward it
      // (half way = half and half, where the two swap roles, so nothing jumps).
      let blend = null;
      const rect = place(view);
      let warp = null;
      if (dissolve && n > 1 && current === orbit) {
        const turned = angleDelta(orbit.yaws[shown.yawIndex], camera.yaw);
        const off = turned / (360 / n);
        if (Math.abs(off) > 0.005 && Math.abs(off) <= 0.75) warp = warpOf(view, rect, px, turned);
        // When the picture changes to the next angle, the one it replaces stays on top for a moment and
        // fades out. Both are bent to the camera's true angle, so the ground under them is the same and
        // only tall things (which the two show leaning opposite ways) cross over. A short fade in time,
        // not in angle: a slow drag shows one sharp picture nearly all the way, a quick turn runs the
        // fades into each other.
        if (before && before.view !== view && before.yawIndex !== shown.yawIndex && beforeOrbit === orbit) fade = { view: before.view, yawIndex: before.yawIndex, level: before.level, at: camera.time ?? 0 };
        if (fade) {
          const t = ((camera.time ?? 0) - fade.at) / fadeTime;
          const gone = angleDelta(orbit.yaws[fade.yawIndex], camera.yaw);
          if (!(t >= 0 && t < 1) || Math.abs(gone) > 1.5 * 360 / n || fade.view === view) fade = null;
          else {
            const oldRect = place(fade.view);
            blend = { view: fade.view, rect: oldRect, alpha: 1 - t * t * (3 - 2 * t), yawIndex: fade.yawIndex, level: fade.level, warp: warpOf(fade.view, oldRect, px, gone) };
          }
        }
      } else fade = null;
      beforeOrbit = current;
      /** How far the ground at x, y moved on screen in the bent picture: { dx, dy }. frame.view's toPoint and drawSprite already include it; this is for things drawn another way. */
      const shift = (x, y) => {
        if (!warp) return { dx: 0, dy: 0 };
        const p = view.toPoint(x, y, rect);
        return { dx: warp[0] * p.x + warp[2] * p.y + warp[4] - p.x, dy: warp[1] * p.x + warp[3] * p.y + warp[5] - p.y };
      };
      bending = warp ? { view, warp } : null;
      // without a bend the view itself is handed out; with one, its stand-in whose toPoint follows the bend
      return { view: dissolve && typeof view.toPoint === 'function' ? bentView(view) : view, rect, yawIndex: shown.yawIndex, level: shown.level, cellPx: px, waiting: !wanted, blend, warp, shift };
    },
  };
  return sceneCamera;
}
