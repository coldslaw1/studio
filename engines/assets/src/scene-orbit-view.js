// Game side of a baked orbit (see scene-orbit.js): the same scene from several camera angles and
// at several detail levels. Views are loaded when first asked for and the least recently used ones
// are dropped, so memory stays flat however many angles were baked. Browser-safe.
import { loadSceneView, createSceneView } from './scene-view.js';
import { buildUprights, drawUprights } from './scene-orbit-upright.js';

/**
 * @param {object} manifest  Parsed `<name>.orbit.json` written by writeSceneOrbit.
 * @param {object} [opts]
 * @param {(key:string) => Promise<object>} opts.load  Loads the scene view of one key (loadSceneOrbit supplies it).
 * @param {number} [opts.keep]  How many views to keep in memory (default 8).
 * @param {(view:object) => void} [opts.release]  Called with a view when it is dropped from memory.
 * @returns {object} orbit
 */
export function createSceneOrbit(manifest, opts = {}) {
  if (!manifest || manifest.orbit !== 1 || !Array.isArray(manifest.yaws) || !Array.isArray(manifest.details)) throw new Error('createSceneOrbit: expected the name.orbit.json written by writeSceneOrbit');
  if (typeof opts.load !== 'function') throw new Error('createSceneOrbit: "load" must be a function that loads one view');
  const keep = opts.keep ?? 8;
  if (!(keep >= 1)) throw new Error(`createSceneOrbit: "keep" must be at least 1, got ${opts.keep}`);
  const slots = new Map(); // key -> { view, promise, used, error }
  let clock = 0;
  const keyOf = (yawIndex, level) => {
    const row = manifest.views[yawIndex];
    if (!row || !row[level]) throw new Error(`scene orbit: no view at angle ${yawIndex}, level ${level} (there are ${manifest.yaws.length} angles and ${manifest.details.length} levels)`);
    return row[level];
  };
  const trim = () => {
    const loaded = [...slots.entries()].filter(([, s]) => s.view).sort((a, b) => a[1].used - b[1].used);
    while (loaded.length > keep) { const [key, slot] = loaded.shift(); slots.delete(key); opts.release?.(slot.view); }
  };
  const orbit = {
    name: manifest.name,
    /** Camera yaw of each angle, in degrees. */
    yaws: manifest.yaws.slice(),
    /** Detail of each level, coarse to fine. */
    details: manifest.details.slice(),
    /** Start loading a view (if it is not there yet) and resolve with it. */
    load(yawIndex, level) {
      const key = keyOf(yawIndex, level);
      let slot = slots.get(key);
      if (!slot) {
        slot = { view: null, used: ++clock, error: null, promise: null };
        slots.set(key, slot);
        slot.promise = opts.load(key).then((view) => { slot.view = view; trim(); return view; }, (e) => { slot.error = e; slots.delete(key); throw e; });
        slot.promise.catch(() => {}); // callers that only preload do not have to handle it
      }
      return slot.promise;
    },
    /** The view at an angle and level if it is in memory, else null (and it starts loading). */
    view(yawIndex, level) {
      const slot = slots.get(keyOf(yawIndex, level));
      if (slot?.view) { slot.used = ++clock; return slot.view; }
      orbit.load(yawIndex, level);
      return null;
    },
    /** True when the view is in memory. Does not start loading. */
    has(yawIndex, level) { return Boolean(slots.get(keyOf(yawIndex, level))?.view); },
    /** How many views are being loaded right now. */
    get pending() { return [...slots.values()].filter((s) => !s.view).length; },
    /** How many views are in memory now. */
    get loaded() { return [...slots.values()].filter((s) => s.view).length; },
  };
  return orbit;
}

/**
 * Load one picture-mode view with every frame as its own ImageBitmap, cut and decoded off the main
 * thread. A browser draws a bitmap at once; a canvas copied from a big PNG (what a plain scene view
 * keeps) stalls the page for 50 to 200 ms the first time it is drawn, which shows as a hitch every
 * time the camera turns to a new angle. It also holds each picture once instead of twice.
 */
/**
 * Give any scene view (also one loaded with loadSceneView, kept as text or as a picture) upright
 * objects for a turning camera: its objects are cut out in the background, and when the camera
 * engine draws the view bent (`turned` in the draw options, or left on the context) they are drawn
 * standing over the bent ground. For worlds that load their own views, such as streamed pages.
 * @param {object} view  From createSceneView / loadSceneView (with depth and a projection).
 * @param {object} data  The view's name.json.
 * @param {{createCanvas?:Function, later?:Function, queue?:Function}} [o]  queue: a shared work line (see workLine) for many views.
 * @returns {object} the same view; `view.uprights.ready` turns true when the cutting is done.
 */
export function makeTurnable(view, data, o = {}) {
  if (!view || typeof view.draw !== 'function' || typeof view.canvasFor !== 'function') throw new Error('makeTurnable: expected a scene view');
  if (view.uprights) return view;
  const makeCanvas = o.createCanvas ?? ((cw, ch) => {
    if (typeof globalThis.OffscreenCanvas === 'function') return new globalThis.OffscreenCanvas(cw, ch);
    const c = globalThis.document.createElement('canvas'); c.width = cw; c.height = ch; return c;
  });
  // nothing heavy happens in this call (safe at the moment a picture arrives, also mid-turn): the
  // picture is fetched and everything is worked out on the work line, about 4 ms at a time
  let picture = null;
  const pictureNow = () => (picture ??= view.canvasFor(0));
  let dropped = false;
  view.uprights = buildUprights(view, data, pictureNow, { createCanvas: makeCanvas, schedule: o.queue ?? workLine(o.later ?? ((fn) => setTimeout(fn, 12))), cancelled: () => dropped });
  const plain = view.draw;
  view.draw = (ctx, x, y, w = view.width, h = view.height, d = {}) => {
    plain(ctx, x, y, w, h, d);
    const bend = d.turned ?? ctx.turned ?? null;
    if (bend?.warp && !d.flipX && view.uprights.ready && view.uprights.parts.length) {
      ctx.save(); ctx.globalAlpha *= d.alpha ?? 1;
      drawUprights(ctx, view.uprights, x, y, w / pictureNow().width, bend.warp);
      ctx.restore();
    }
  };
  const release = view.release;
  view.release = () => { dropped = true; release?.(); };
  return view;
}

/** Make a work line: jobs given to it run one short piece at a time with a breather between (`later`). */
export { workLine };

/**
 * One line of small jobs for a whole orbit: the upright pictures of every view that has just loaded
 * are cut here, one short piece of work per turn of the line with a breather between, so cutting
 * several views at once never crowds out the game or the loading of the next pictures.
 */
function workLine(later) {
  const jobs = []; let running = false;
  const run = () => {
    const job = jobs.shift();
    if (!job) { running = false; return; }
    try { job(); } finally { later(run); }
  };
  return (fn) => { jobs.push(fn); if (!running) { running = true; later(run); } };
}

async function loadBitmapView(url, opts) {
  const { fetch: fetchIt, createImageBitmap: bitmapOf } = opts; // called bare: the browser's own refuse to run as methods of another object
  const res = await fetchIt(url);
  if (!res.ok) throw new Error(`loadSceneOrbit: could not load ${url} (${res.status})`);
  const data = await res.json();
  if (!data.image) return createSceneView(data, opts); // kept as text: nothing to decode
  const src = url.slice(0, url.lastIndexOf('/') + 1) + data.image.file;
  const got = await fetchIt(src);
  if (!got.ok) throw new Error(`loadSceneOrbit: could not load ${src} (${got.status})`);
  const whole = await bitmapOf(await got.blob());
  const count = data.frames ?? 1;
  const across = data.image.columns ?? count;
  const { frameWidth: fw, frameHeight: fh } = data.image;
  const frames = count === 1 && whole.width === fw && whole.height === fh
    ? [whole]
    : await Promise.all(Array.from({ length: count }, (_, i) => bitmapOf(whole, (i % across) * fw, Math.floor(i / across) * fh, fw, fh)));
  if (frames[0] !== whole) whole.close?.();
  const view = createSceneView(data, { ...opts, image: frames[0] });
  const at = (frame) => frames[((Math.floor(frame) % count) + count) % count];
  view.canvasFor = at;
  // The objects of the scene as upright pictures of their own, for a camera turning between two baked
  // angles (see scene-orbit-upright.js). Worked out a little at a time after loading; until it is
  // ready (and for scenes without depth or objects) a turning picture is simply bent.
  let dropped = false;
  const makeCanvas = opts.createCanvas ?? ((cw, ch) => {
    if (typeof globalThis.OffscreenCanvas === 'function') return new globalThis.OffscreenCanvas(cw, ch);
    const c = (opts.document ?? globalThis.document).createElement('canvas'); c.width = cw; c.height = ch; return c;
  });
  view.uprights = opts.uprights === false ? null : buildUprights(view, data, frames[0], { createCanvas: makeCanvas, schedule: opts.schedule ?? opts.queue, cancelled: () => dropped });
  view.draw = (ctx, x, y, w = view.width, h = view.height, { frame = 0, flipX = false, alpha = 1, turned = null } = {}) => {
    const b = at(frame);
    ctx.save();
    // Whole-number enlargements stay sharp pixels. Anything between (a camera easing its zoom, or resting
    // between two detail levels) is smoothed: unsmoothed, every pixel column gets a slightly different
    // width and the picture shimmers as it moves.
    const scale = w / view.width;
    // (a picture drawn turned or sheared, as the camera does between two baked angles, is smoothed too)
    const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    const straight = !t || (Math.abs(t.b) < 1e-6 && Math.abs(t.c) < 1e-6);
    const whole = straight && scale >= 1 && Math.abs(scale - Math.round(scale)) < 0.01;
    ctx.imageSmoothingEnabled = !whole;
    if (!whole) ctx.imageSmoothingQuality = scale < 1 ? 'high' : 'medium';
    ctx.globalAlpha *= alpha;
    if (flipX) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(b, 0, 0, w, h); } else ctx.drawImage(b, x, y, w, h);
    // `turned` comes from the camera engine while it shows this picture bent to an angle between two
    // baked ones: the objects are then drawn upright over it, where they now stand
    // (also read from the context, where the camera leaves it for views drawn through a stand-in)
    const bend = turned ?? ctx.turned ?? null;
    if (bend?.warp && !flipX && view.uprights?.ready && view.uprights.parts.length) drawUprights(ctx, view.uprights, x, y, w / view.width, bend.warp);
    ctx.restore();
  };
  /** Free the pictures (the orbit calls it when it drops the view). */
  view.release = () => { dropped = true; for (const b of frames) b.close?.(); };
  return view;
}

/**
 * Fetch `<name>.orbit.json` and make an orbit whose views load from the same folder.
 * In a browser every frame of a view is held as an ImageBitmap (see loadBitmapView), so a picture
 * shown for the first time does not stall the page. `fetch`, `document` and `loadImage` can be
 * injected for tests (they are passed on to loadSceneView; with `loadImage` given, views are plain
 * scene views).
 * @param {string} url
 * @param {{keep?:number, fetch?:Function, document?:object, loadImage?:Function, createImageBitmap?:Function, uprights?:boolean, later?:Function, createCanvas?:Function}} [opts]
 *   uprights false: do not cut the objects out for upright drawing while the camera turns (see scene-orbit-upright.js).
 *   later(fn): how the cutting waits between its short pieces of work (default: 12 ms on a timer).
 */
export async function loadSceneOrbit(url, opts = {}) {
  const fetchIt = opts.fetch ?? globalThis.fetch;
  const res = await fetchIt(url);
  if (!res.ok) throw new Error(`loadSceneOrbit: could not load ${url} (${res.status})`);
  const manifest = await res.json();
  const dir = url.slice(0, url.lastIndexOf('/') + 1);
  const { keep, ...rest } = opts;
  const bitmap = opts.createImageBitmap ?? (opts.loadImage ? null : globalThis.createImageBitmap);
  if (bitmap) {
    const queue = workLine(opts.later ?? ((fn) => setTimeout(fn, 12)));
    return createSceneOrbit(manifest, {
      keep,
      load: (key) => loadBitmapView(`${dir}${key}.json`, { ...rest, fetch: fetchIt, createImageBitmap: bitmap, queue }),
      release: (view) => view.release?.(),
    });
  }
  return createSceneOrbit(manifest, { keep, load: (key) => loadSceneView(`${dir}${key}.json`, rest) });
}
