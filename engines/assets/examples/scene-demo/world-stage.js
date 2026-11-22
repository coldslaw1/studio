// The open world as a stage a game can stand on. The world engine (vendor/world) generates the
// land, trees and hamlets from a seed and keeps the people in them asleep until you are near. Kiln
// renders the part around the player as a 3D scene (a "page"); when you walk 10 m from its centre
// the next page, 16 m further on, takes over. Pages line up character for character, so the swap
// is a short crossfade over small lighting differences. Every page can be drawn from 8 camera
// angles and at 2 detail levels, each rendered when first needed, so the camera engine
// (vendor/camera) turns and zooms here as it does on a baked scene.
// The stage reads no keys and starts no loop: the game calls update(dt, intent) and draw(), and
// steers stage.camera (rotateSteps, zoomBy, attachCameraMouse...).
// Pictures come from ./pages/<px>_<py>_a<yaw index>_d<detail>.json: rendered on demand by
// world-pages.mjs in serve.mjs, or baked ahead (serve.mjs --bake) for a static site (then the world ends where the
// pages do, and an angle or detail that was not baked is simply not offered).
import { createSceneView } from '../../src/scene-view.js';
import { makeTurnable, workLine } from '../../src/scene-orbit-view.js';
import { createCollisionWorld } from './vendor/collision/index.js';
import { createCharacter, createAsciiSprite, projectionFromScene } from './vendor/puppet/index.js';
import { createCamera, createSceneCamera, screenStep, pickLevel, nearestYawIndex } from './vendor/camera/index.js';
import { createEntities, rand2 } from './vendor/world/index.js';
import { orbit as pageOrbit, START_YAW, VIEW, terrain, createGenWorld, startPoint, SEED, sceneOptions as tidyOptions, sceneOptionsKey, sceneOptionsFromKey, residentLook, residentRig, campMobs } from './world-gen.js';

const CELL = 4; // screen pixels per backdrop character of the coarsest detail at zoom 1
const SCENERY = 1; const CHARACTER = 2;
const IDLE = { dx: 0, dy: 0, run: false, fly: false };
const KEEP = 20; // pictures kept in memory (each is a few megabytes; two times of day may show at once)
/** Run fn under a label on the game's clock when there is one (the demo's stall report then names the work). */
const measure = (label, fn) => { const loop = globalThis.game?.core?.loop; return loop && typeof loop.measure === 'function' ? loop.measure(label, fn) : fn(); };
/**
 * What the player's rig is made with, from the stage's options: { model, options } for the puppet engine's
 * createCharacter(model, options). playerAnimator becomes options.animator.
 */
export function playerRig({ playerModel = 'villager', playerAnimator, playerOptions = {} } = {}) {
  if (playerAnimator !== undefined && (playerAnimator === null || typeof playerAnimator !== 'object' || Array.isArray(playerAnimator))) throw new Error(`createWorldStage: playerAnimator must be an animator description (an object), got ${JSON.stringify(playerAnimator)}`);
  if (playerOptions === null || typeof playerOptions !== 'object') throw new Error('createWorldStage: playerOptions must be an object of createCharacter options');
  if (!(typeof playerModel === 'string' || (playerModel && typeof playerModel === 'object'))) throw new Error(`createWorldStage: playerModel must be a model name or a model object, got ${JSON.stringify(playerModel)}`);
  return { model: playerModel, options: { ...playerOptions, ...(playerAnimator ? { animator: playerAnimator } : {}) } };
}

/**
 * createWorldStage({ canvas, query, width, height, pages }) -> Promise<stage>
 * Resolves once the first picture is on hand; rejects with a clear Error when ./pages/ cannot be
 * fetched (no page server and nothing baked), so the caller can fall back to another scene.
 * @param {HTMLCanvasElement} o.canvas   drawn into through its 2D context
 * @param {URLSearchParams} [o.query]    ?x= &y= start somewhere else, ?outlines shows collision shapes
 * @param {number} [o.width]  logical width the stage draws for (default 960; at most stage.maxWidth, 1120)
 * @param {number} [o.height] logical height (default 640; at most stage.maxHeight, 704)
 * @param {string} [o.pages]  folder URL of the pages (default ./pages/ next to this file)
 * @param {object} [o.playerAnimator]  an animator description for the player's rig, in place of the puppet engine's
 *   own (for example the combat engine's combatAnimator, so attacks, guards and hits play on the hero)
 * @param {string|object} [o.playerModel]  'villager' (default), 'knight', 'skeleton' or a model object
 * @param {object} [o.playerOptions]  other createCharacter options for the player: colors, equipment, height
 * @param {string} [o.draw]   who draws the pages: 'server' (the page server, Asciicker characters), 'browser' (drawn
 *   here by Kiln's own renderer; needs no server and no baked pages, so the world has no edge) or 'auto' (default:
 *   the server when it answers pages/live.json, else the browser). ?draw= in the query sets it too.
 * @param {object} [o.sceneOptions]  { time, atmosphere: { fog, haze, clouds, fireflies }, style } for every page (see sceneOptions in world-gen.js)
 * stage: update(dt, intent), draw(), player, people, residents, extras, camera, sceneCamera,
 *   toScreen, groundAt, biomeAt, collision, page, view, rect, layout, occlude, outlines,
 *   save(), load(data), stats.
 */
export async function createWorldStage({ canvas, query = new URLSearchParams(), width: askedWidth = 960, height: askedHeight = 640, sceneOptions: firstLook = {}, draw: drawWanted, playerModel, playerAnimator, playerOptions, pages: pagesUrl = new URL('./pages/', import.meta.url).href } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new Error('createWorldStage: canvas must be a canvas element');
  // the pages are rendered to fill this much screen and no more, so a larger window is not drawn into
  const maxWidth = VIEW[0] * CELL; const maxHeight = VIEW[1] * CELL;
  const fit = (v, max, what) => { if (!(v > 0)) throw new Error(`createWorldStage: ${what} must be above 0, got ${v}`); return Math.min(max, Math.round(v)); };
  let width = fit(askedWidth, maxWidth, 'width'); let height = fit(askedHeight, maxHeight, 'height');
  const ctx = canvas.getContext('2d');
  const layout = pageOrbit; // step, reach, half, pageAt, centreOf, originOf: the same for every angle and detail
  const { yaws, details } = pageOrbit;
  // Who draws the pages. With a live page server it does (Asciicker characters). Without one (the demo
  // copied somewhere as plain files) the worker draws each page itself, so new ground never runs out.
  const drawAsked = drawWanted ?? query.get('draw') ?? 'auto';
  if (!['auto', 'server', 'browser'].includes(drawAsked)) throw new Error(`createWorldStage: draw must be 'auto', 'server' or 'browser', got ${JSON.stringify(drawAsked)}`);
  let drawHere = drawAsked === 'browser';
  if (drawAsked === 'auto') {
    try { const r = await fetch(new URL('live.json', pagesUrl), { cache: 'no-store', signal: AbortSignal.timeout(4000) }); drawHere = !(r.ok && (await r.json()).live === true); } catch { drawHere = true; }
  }
  const stats = { swaps: 0, waited: 0, retries: 0, swapMs: [], arrivals: [], turnableMs: [], lastSwap: null };

  // ---- pictures: a worker fetches each one and draws it, so the game never pauses for it.
  // A picture is one page from one angle at one detail; a page is the place, with all its pictures.
  const pics = new Map(); // "px_py_yi_li" -> { view, promise, error, used, page }
  const pages = new Map(); // "px_py" -> page
  const unavailable = new Set(); // "yi_li" angles and details that could not be had (not baked)
  const key = (px, py) => px + '_' + py;
  let headHeight; // how tall a character is: scenery lower than this blocks the way (known once the first rig is made)
  // The look of the pictures: weather and style (base), and the time of day. Two times can show at once,
  // one fading into the other, which is how the world follows a sky through the day (stage.setLook).
  let base = tidyOptions(firstLook);
  let timeA = base.time ?? 'day'; let timeB = null; let mixB = 0;
  const lookKey = (time) => sceneOptionsKey({ ...base, time: time === 'day' ? undefined : time });
  let look = lookKey(timeA); // the key of the main look in page names; '' = plain day
  let lookB = null; // the key of the look fading in over it, or null
  const timeOfView = new WeakMap(); // picture -> the time of day it was made for
  const failedLooks = new Set(); // look keys that could not be had where we stand (not baked)
  const pk = (px, py, yi, li, lk = look) => px + '_' + py + '_' + yi + '_' + li + '_' + lk;
  /** True when a second time of day is being drawn over the first, so both pictures of an angle are needed. */
  const pairWanted = () => lookB !== null && mixB > 0.02 && !failedLooks.has(lookB);
  let fetching = 0; let clock = 0;
  const worker = new Worker(new URL('./world-page-worker.js', import.meta.url), { type: 'module' });
  const jobs = new Map(); let jobId = 0;
  const turnQueue = workLine((fn) => setTimeout(fn, 4)); // one line of small jobs for every picture's upright cut-outs
  // What the camera is given for a picture: the Kiln view, drawing the second time of day over itself
  // when two are showing. One call then paints the whole backdrop, so the camera can bend and fade it.
  const standIns = new WeakMap();
  function standIn(page, yi, li, a) {
    let s = standIns.get(a);
    if (!s) {
      s = Object.create(a);
      s.plain = a;
      s.draw = (g, x, y, w, h, o = {}) => {
        a.draw(g, x, y, w, h, o);
        if (lookB === null || !(mixB > 0) || failedLooks.has(lookB)) return;
        const slot = picture(page, yi, li, lookB); // the next time of day, fading in over this one
        if (slot.error && page === cur) failedLooks.add(lookB);
        if (!slot.view) return;
        slot.used = ++clock;
        if (page === cur) shownB = slot.view;
        slot.view.draw(g, x, y, w, h, { ...o, alpha: (o.alpha ?? 1) * mixB });
      };
      standIns.set(a, s);
    }
    return s;
  }
  let entered = false; // true once the first page has been entered (cur exists)
  /**
   * Have a picture's houses and trees cut out, so they stand upright while the camera turns. The cutting
   * runs on the work line in pieces of about 4 ms. Only pictures of the page the player is on are cut
   * (when they arrive, or when the page is entered): cutting every prefetched neighbour as well kept the
   * line busy for seconds and the page underfoot waited its turn.
   */
  function upright(slot) {
    if (slot.turnable || !slot.view) return;
    slot.turnable = true;
    makeTurnable(slot.view, slot.data, { queue: turnQueue });
  }
  /** The Kiln view behind whatever the camera hands back (its bent stand-in of our stand-in). */
  const rawOf = (v) => { const u = v.unbent ?? v; return u.plain ?? u; };
  worker.onmessage = (message) => measure('page arrival', () => {
    const { id, data, bitmap, error, outlines, missing } = message.data;
    const job = jobs.get(id); jobs.delete(id); fetching--;
    if (error) {
      const e = new Error(error);
      if (missing) job.slot.error = e; // no such page (a static site, past what was baked): the slot stays, so it is not asked for again
      else { // a hiccup (the page server restarting or busy): ask again in a moment, a little longer each time
        job.slot.tries = (job.slot.tries ?? 0) + 1;
        job.slot.retryAt = performance.now() + Math.min(8000, 1000 * 2 ** (job.slot.tries - 1));
        stats.retries++;
      }
      job.reject(e);
      return;
    }
    job.slot.tries = 0;
    const t0 = performance.now();
    const view = createSceneView(data, { image: bitmap }); view.canvasFor(0);
    job.slot.data = data;
    if (entered && job.slot.page === cur) upright(job.slot); // a picture of the page we stand on: wanted at once (mid-turn included)
    job.slot.view = view; job.slot.page.ground ??= view; // the ground is the same from every angle
    timeOfView.set(view, job.slot.time);
    if (outlines) job.slot.page.outlines ??= outlines;
    stats.arrivals.push(performance.now() - t0);
    const loaded = [...pics.entries()].filter(([, s]) => s.view).sort((a, b) => a[1].used - b[1].used);
    while (loaded.length > KEEP) { const [k, s] = loaded.shift(); if (s.page.ground !== s.view || s.page !== cur) { pics.delete(k); if (s.page.ground !== s.view) s.view.release?.(); } }
    job.resolve(view);
  });
  function picture(page, yi, li, lk = look) {
    const k = pk(page.px, page.py, yi, li, lk);
    let slot = pics.get(k);
    if (!slot || (slot.retryAt && performance.now() >= slot.retryAt)) { // new, or one whose request failed and is due again
      if (slot) slot.retryAt = 0;
      else { slot = { view: null, error: null, used: ++clock, page, promise: null, retryAt: 0, tries: 0, time: lk === lookB && lk !== look ? timeB : timeA }; pics.set(k, slot); }
      fetching++;
      slot.promise = new Promise((resolve, reject) => { jobs.set(++jobId, { slot, resolve, reject }); });
      slot.promise.catch(() => {}); // callers that only preload do not have to handle it
      worker.postMessage({ id: jobId, url: new URL(`${page.px}_${page.py}_a${yi}_d${details[li]}${lk ? '__' + lk : ''}.json`, pagesUrl).href, zoom: CELL / 8, maxZ: headHeight, draw: drawHere ? { px: page.px, py: page.py, yi, li, look: lk } : null });
    }
    return slot;
  }
  function pageAt(px, py) {
    const k = key(px, py);
    let page = pages.get(k);
    if (!page) {
      const [ox, oy] = layout.originOf(px, py);
      page = { px, py, ox, oy, ground: null, orbit: null };
      // the shape the camera engine reads: one page's pictures by angle and detail
      page.orbit = {
        yaws, details,
        load(yi, li) { if (pairWanted()) picture(page, yi, li, lookB); return picture(page, yi, li).promise.then((v) => standIn(page, yi, li, v)); },
        // An angle counts as there only when every picture drawn for it is: with two times of day showing,
        // both. Otherwise a turn would show the first one alone for a moment (night in the middle of the day).
        view(yi, li) {
          const s = picture(page, yi, li);
          if (s.view) s.used = ++clock;
          if (pairWanted()) { const b = picture(page, yi, li, lookB); if (b.view) b.used = ++clock; else if (!b.error) return null; }
          return s.view ? standIn(page, yi, li, s.view) : null;
        },
        has(yi, li) {
          if (!pics.get(pk(px, py, yi, li))?.view) return false;
          if (!pairWanted()) return true;
          const b = pics.get(pk(px, py, yi, li, lookB));
          return Boolean(b && (b.view || b.error));
        },
        failed: (yi, li) => Boolean(pics.get(pk(px, py, yi, li))?.error),
        get pending() { let n = 0; for (const s of pics.values()) if (s.page === page && !s.view && !s.error && !s.retryAt) n++; return n; },
      };
      pages.set(k, page);
    }
    return page;
  }
  const forgetFarPages = (px, py) => {
    for (const [k, p] of pages) if (Math.max(Math.abs(p.px - px), Math.abs(p.py - py)) > 2) pages.delete(k);
    for (const [k, s] of pics) if (!pages.has(key(s.page.px, s.page.py))) { pics.delete(k); s.view?.release?.(); }
  };
  async function firstPage(x, y, yi, li) {
    const at = layout.pageAt(x, y);
    const page = pageAt(at.px, at.py);
    if (page.orbit.failed(yi, li)) pics.delete(pk(at.px, at.py, yi, li)); // ask again for one that failed before
    try { await page.orbit.load(yi, li); } catch (e) {
      throw new Error(`createWorldStage: could not get world page ${key(at.px, at.py)} from ${pagesUrl} (${e.message}). Start "node examples/scene-demo/serve.mjs", or bake pages with "node examples/scene-demo/serve.mjs --bake 3".`);
    }
    return page;
  }

  const start = startPoint();
  const at0 = { x: Number(query.get('x') ?? start.x), y: Number(query.get('y') ?? start.y) };
  if (!Number.isFinite(at0.x) || !Number.isFinite(at0.y)) throw new Error('createWorldStage: ?x and ?y must be numbers');
  let cur = await firstPage(at0.x, at0.y, START_YAW, 0);

  // ---- the camera: it looks at the player (in the page's own coordinates) and picks the picture
  const anchor = { x: at0.x - cur.ox, y: at0.y - cur.oy };
  // yawStep -45: E looks right, as in the orbit view (a rising Kiln yaw looks left). zoomStep 2: this stage draws its pages itself, unsmoothed, so the zoom rests only where a page is shown at a whole number of pixels
  const camera = createCamera({ yaws, yaw: yaws[START_YAW], x: anchor.x, y: anchor.y, yawStep: -45, zoomStep: 2, maxZoom: details.at(-1) / details[0], moveTime: 0 });
  camera.follow(anchor);
  const sceneCamera = await createSceneCamera({ camera, orbit: cur.orbit, width, height, cellPx: CELL, clamp: false, dissolve: true, ahead: 0 }).ready(); // dissolve: turns bend and fade between the 8 angles; ahead 0: no pictures are rendered just in case
  let shown = sceneCamera.frame(); // { view, rect, yawIndex, level, cellPx, waiting }: what is on screen

  /** Ground height in metres at a world point (on the page being shown). */
  const groundAt = (x, y) => cur.ground.heightAt(x - cur.ox, y - cur.oy) / 16;
  let seed = 5;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let spriteDetail = 3; // characters are drawn this many times finer than the coarsest backdrop (stage.detail)
  /** A rig's text sprite for the picture on screen (one per angle and detail, made when first needed). */
  function spriteFor(rig, f = shown) {
    const k = f.yawIndex * 8 + f.level;
    let s = rig.sprites.get(k);
    if (!s) rig.sprites.set(k, (s = createAsciiSprite(rig.actor.puppet, { projection: projectionFromScene(rawOf(f.view)), detail: Math.min(f.view.detail * spriteDetail, Math.max(8, spriteDetail * details[0])) / f.view.detail, text: 0.3 })));
    return s;
  }
  function rigged(model, options = {}) {
    const actor = createCharacter({ model, groundAt, rng, wind: [0.8, 0.3, 0], gust: 0.7, ...options });
    actor.update(0);
    const rig = { actor, sprites: new Map(), get view() { return spriteFor(rig); } };
    const size = rawOf(shown.view).spriteExtent(spriteFor(rig), { scale: 1 });
    rig.radius = size.radius; rig.height = size.height;
    return rig;
  }
  const hero = playerRig({ playerModel, playerAnimator, playerOptions });
  const player = Object.assign(rigged(hero.model, hero.options), { body: null, vx: 0, vy: 0, x: at0.x, y: at0.y, events: null });
  headHeight = player.height;

  // ---- the world engine: chunks of 16 m around the player wake and sleep the hamlets' people.
  // Its save store is a plain Map here; save() hands the contents out and load() puts them back.
  let saved = new Map();
  const store = { get: (k, fallback = null) => (saved.has(k) ? JSON.parse(saved.get(k)) : fallback), set: (k, v) => { if (v === undefined) saved.delete(k); else saved.set(k, JSON.stringify(v)); return true; } };
  let genWorld = null; let residents = null; let collision = null;
  const bodied = new Set(); // residents who have a collision body on the current page
  function boot() {
    genWorld = createGenWorld({ loadRadius: 5, maxLoadsPerUpdate: 2, store });
    residents = createEntities({
      world: genWorld, cellSize: 8, activeRadius: 45, nearRadius: 80, nearEvery: 4, farEvery: 30,
      // saved form: plain data only (the rig and the collision body are made again when needed)
      toRecord: (e) => ({ id: e.id, kind: e.kind, persist: true, x: e.x, y: e.y, home: e.home, seed: e.seed, n: e.n, look: e.look }),
      spawn(chunk, info, add) { // a guard and two to four villagers per hamlet, made once, each with its own look
        if (info.spawned) return;
        for (const f of chunk.features) {
          if (f.name !== 'hamlet') continue; // camps have their figures in the picture
          const home = [f.tx + 0.5, f.ty + 0.5];
          add({ kind: 'knight', persist: true, x: f.tx + 3.5, y: f.ty + 3.5, home, seed: f.seed, n: 0, look: residentLook(f.seed, 'knight') });
          const villagers = 2 + f.seed % 3;
          for (let i = 0; i < villagers; i++) {
            const a = i * 2.4 + 1;
            add({ kind: 'villager', persist: true, x: home[0] + Math.cos(a) * 4.5, y: home[1] + Math.sin(a) * 4.5, home, seed: f.seed + 1 + i, n: 0, look: residentLook(f.seed + 1 + i, 'villager') });
          }
        }
      },
      update(e, dt) { // stroll between points around the hamlet green; e.halt stops them (the game sets it while talking)
        e.vx = 0; e.vy = 0;
        if (e.halt) return;
        if (!e.goal || Math.hypot(e.goal[0] - e.x, e.goal[1] - e.y) < 0.4 || (e.stuck ?? 0) > 1.5) {
          const a = rand2(e.seed, e.n++, 0) * 6.283; const r = 3 + rand2(e.seed, e.n++, 1) * 6;
          e.goal = [e.home[0] + Math.cos(a) * r, e.home[1] + Math.sin(a) * r]; e.stuck = 0; e.rest = rand2(e.seed, e.n++, 2) * 3;
        }
        if (e.rest > 0) { e.rest -= dt; return; }
        const d = Math.hypot(e.goal[0] - e.x, e.goal[1] - e.y);
        const step = Math.min(d, 1.3 * dt);
        let mx = (e.goal[0] - e.x) / d * step; let my = (e.goal[1] - e.y) / d * step;
        if (e.body) { const res = collision.move(e.body, mx, my); mx = res.dx; my = res.dy; }
        e.x += mx; e.y += my;
        e.stuck = Math.hypot(mx, my) < step * 0.3 ? (e.stuck ?? 0) + dt : 0;
        e.vx = mx / dt; e.vy = my / dt;
      },
    });
    residents.on('sleep', (e) => { if (e.body && collision) collision.remove(e.body); bodied.delete(e); e.body = null; e.rig = null; });
  }

  // ---- collision: rebuilt for each page from its footprints and its water, in page coordinates
  const enterPage = (page) => measure('page swap', () => enterPageNow(page));
  /**
   * Build a page's collision world a little at a time, before the player gets there, so the swap
   * itself is quick. budgetMs = how long this call may take (Infinity = finish now). True when done.
   */
  function prepare(page, budgetMs) {
    if (!page.ground) return false;
    if (!page.build) {
      // every object's ground outline, worked out once per page and kept (plain data)
      // (they come with the page from the server or the worker; working them out here is the fallback)
      page.outlines ??= measure('page outlines', () => { try { return page.ground.footprints({ maxZ: player.height }); } catch (e) { console.warn(`world stage: no collision outlines for page ${page.px}, ${page.py}: ${e.message}`); return []; } });
      const world = createCollisionWorld({ cellSize: 4, skin: 0.005 });
      const TILE = 0.5; const solid = new Map(); // the sea, as half-metre tiles worked out on demand
      world.addTiles({ tileSize: TILE, isSolid(col, row) {
        const k = col * 4096 + row;
        if (!solid.has(k)) solid.set(k, page.ground.isWater((col + 0.5) * TILE, (row + 0.5) * TILE));
        return solid.get(k);
      } }, { layer: SCENERY });
      page.build = { world, next: 0 };
      if (budgetMs < Infinity) return false; // the outlines were this step's share of the work
    }
    const b = page.build; const list = page.outlines;
    const t0 = performance.now();
    // addOutline splits an outline with a dent (an L-shaped house) into convex pieces
    while (b.next < list.length) { b.world.addOutline({ ...list[b.next++], layer: SCENERY }); if ((b.next & 7) === 0 && performance.now() - t0 > budgetMs) break; }
    return b.next >= list.length;
  }
  function enterPageNow(page) {
    if (cur !== page) cur.build = null; // the page left behind is built afresh if we come back: its bodies were ours
    cur = page; entered = true;
    for (const s of pics.values()) if (s.page === page) upright(s);
    prepare(page, Infinity);
    collision = page.build.world;
    player.body = collision.add({ x: player.x - page.ox, y: player.y - page.oy, r: player.radius, layer: CHARACTER });
    anchor.x = player.body.x; anchor.y = player.body.y;
    for (const c of cast) embody(c);
    for (const e of bodied) e.body = null; // every body belonged to the old page; the ones still near come back in update
    bodied.clear();
    sceneCamera.setOrbit(page.orbit);
    forgetFarPages(page.px, page.py);
    for (const fn of pageListeners) fn(page, collision);
  }
  const pageListeners = [];
  // the game's own characters (a second player, quest people): world coordinates, a body on each page
  const cast = [];
  function embody(c) {
    const lx = c.x - cur.ox; const ly = c.y - cur.oy;
    const inside = lx > 2 && ly > 2 && lx < layout.half * 2 - 2 && ly < layout.half * 2 - 2;
    c.body = inside && !c.ghost ? collision.add({ x: lx, y: ly, r: c.radius, layer: CHARACTER }) : null;
  }
  /**
   * Add a rigged character at a world point. options go to the puppet engine's createCharacter
   * (colors, equipment, height, animator...); options.ghost makes it pass through things.
   * The character has x, y (world), vx, vy, actor, events, hidden, and move(dx, dy), which walks it with
   * collision and returns what happened. Set x and y yourself to place it (a remote player).
   */
  function addCharacter(model, x, y, options = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`stage.addCharacter: x and y must be numbers, got ${x}, ${y}`);
    const { ghost = false, ...rigOptions } = options;
    const c = Object.assign(rigged(model, rigOptions), { x, y, vx: 0, vy: 0, body: null, events: null, hidden: false, ghost });
    c.rig = c;
    c.move = (dx, dy) => {
      if (!c.body) { c.x += dx; c.y += dy; return { dx, dy, hits: [] }; }
      const res = collision.move(c.body, dx, dy);
      c.x = c.body.x + cur.ox; c.y = c.body.y + cur.oy;
      return res;
    };
    embody(c);
    cast.push(c);
    return c;
  }
  function removeCharacter(c) {
    const i = cast.indexOf(c);
    if (i < 0) return;
    cast.splice(i, 1);
    if (c.body) collision.remove(c.body);
    c.body = null;
  }
  const found = [];
  const nearby = (r) => { found.length = 0; return residents.queryRadius(player.x, player.y, r, found); };
  boot();
  enterPage(cur);
  genWorld.loadAll(player);

  let fade = null; // { page, t } the page we just left, fading out
  let waiting = false; let atEdge = false; let busy = false;
  let occlude = true; let outlines = query.has('outlines');
  let shownB = null; // the second look's picture drawn this frame, or null
  let cameraPerFrame = false; // true: the game eases the camera itself, once per drawn frame (stage.camera.update(seconds))
  let people = []; // residents in view this step, each with a rig
  const extras = []; // the game's own things standing in the world: { x, y, draw(ctx, view, rect, localX, localY, occlude) }

  /** One step. intent: { dx, dy } in screen directions (-1..1), run, fly (pass through everything, twice as fast). */
  function update(dt, intent = IDLE) {
    if (busy) return; // load() is fetching the page for the saved place
    const { dx = 0, dy = 0 } = intent;
    player.vx = 0; player.vy = 0;
    const [cx, cy] = layout.centreOf(cur.px, cur.py);
    if ((dx || dy) && dt > 0 && player.actor.state !== 'die') {
      const speed = player.actor.walkSpeed * (intent.run ? 2.6 : 1) * (intent.fly ? 2 : 1) * Math.min(1, Math.hypot(dx, dy));
      let [sx, sy] = screenStep(shown.view, dx, dy, speed * dt); // right is right on screen, whatever the camera angle
      // never walk past what this page shows: wait at the limit until the next page has arrived
      if (Math.abs(player.x + sx - cx) > layout.reach) sx = 0;
      if (Math.abs(player.y + sy - cy) > layout.reach) sy = 0;
      let res = { dx: sx, dy: sy };
      if (intent.fly) collision.teleport(player.body, player.body.x + sx, player.body.y + sy);
      else res = collision.move(player.body, sx, sy); // stops at walls and water and slides along them
      player.vx = res.dx / dt; player.vy = res.dy / dt;
    }
    player.x = player.body.x + cur.ox; player.y = player.body.y + cur.oy;

    // which page should be showing, and which picture to fetch next (one at a time, the likeliest first)
    const { yawIndex: yi, level: li } = shown;
    const off = Math.max(Math.abs(player.x - cx), Math.abs(player.y - cy));
    const want = layout.pageAt(player.x, player.y);
    waiting = false; atEdge = false;
    if (off > layout.step / 2 + 1 && (want.px !== cur.px || want.py !== cur.py)) {
      const next = pageAt(want.px, want.py);
      if (next.orbit.view(yi, li)) { // it has the picture (both, when two times of day show) for the angle and detail on screen
        fade = { page: cur, t: 0.3 }; stats.lastSwap = { from: cur, to: next, x: player.x, y: player.y, yawIndex: yi, level: li };
        const t0 = performance.now(); enterPage(next); stats.swapMs.push(performance.now() - t0); stats.swaps++;
      } else if (next.orbit.failed(yi, li)) atEdge = off > layout.reach - 0.3; // no such page: a static site, past what was baked (never with a page server)
      else waiting = off > layout.reach - 0.3;
      if (waiting) stats.waited += dt; // seconds spent standing at the limit because the next page was not rendered yet
    }
    if (fetching === 0) {
      const ahead = layout.pageAt(player.x + player.vx * 3, player.y + player.vy * 3);
      let best = null;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const px = want.px + i; const py = want.py + j;
        const score = Math.abs(px - ahead.px) + Math.abs(py - ahead.py) + (i && j ? 0.5 : 0);
        if (!pics.has(pk(px, py, yi, li)) && (!best || score < best.score)) best = { px, py, score, lk: look };
        // the look fading in comes second: its pages are fetched once the main look's are there
        if (lookB !== null && !failedLooks.has(lookB) && !pics.has(pk(px, py, yi, li, lookB)) && (!best || score + 3 < best.score)) best = { px, py, score: score + 3, lk: lookB };
      }
      if (best) picture(pageAt(best.px, best.py), yi, li, best.lk);
    }
    // get the collision world of the page we are heading for ready, a millisecond at a time
    const heading = want.px !== cur.px || want.py !== cur.py ? want : layout.pageAt(player.x + player.vx * 4, player.y + player.vy * 4);
    if (heading.px !== cur.px || heading.py !== cur.py) { const ahead = pages.get(key(heading.px, heading.py)); if (ahead && (!ahead.build || ahead.build.next < ahead.outlines.length)) prepare(ahead, 1); }

    genWorld.update(dt, player);
    // residents close enough to matter get a collision body on this page; the rest walk without one
    for (const e of nearby(60)) {
      const lx = e.x - cur.ox; const ly = e.y - cur.oy;
      const inside = lx > 4 && ly > 4 && lx < layout.half * 2 - 4 && ly < layout.half * 2 - 4;
      if (inside && !e.body) { e.body = collision.add({ x: lx, y: ly, r: player.radius, layer: CHARACTER }); bodied.add(e); }
      if (!inside && e.body) { collision.remove(e.body); e.body = null; bodied.delete(e); }
    }
    for (const e of bodied) if (Math.hypot(e.x - player.x, e.y - player.y) > 60) { collision.remove(e.body); e.body = null; bodied.delete(e); } // walked off, or we did
    residents.update(dt, player);
    // the game owns movement; each character is told where it is and how fast it goes, and animates to match
    player.events = player.actor.update(dt, { x: player.x, y: player.y, vx: player.vx, vy: player.vy });
    people = nearby(45).slice(); // rigs are made when someone comes into view and animated only while there
    for (const e of people) {
      e.rig ??= measure('character rig', () => rigged(e.kind, residentRig(e.look)));
      e.events = e.rig.actor.update(dt, { x: e.x, y: e.y, vx: e.vx ?? 0, vy: e.vy ?? 0 });
    }
    for (const c of cast) { // placed by hand since the last step? move its body there
      if (c.body && (Math.abs(c.body.x + cur.ox - c.x) > 1e-6 || Math.abs(c.body.y + cur.oy - c.y) > 1e-6)) { collision.remove(c.body); embody(c); } else if (!c.body && !c.ghost) embody(c);
      c.events = c.actor.update(dt, { x: c.x, y: c.y, vx: c.vx, vy: c.vy });
    }
    if (fade) { fade.t -= dt; if (fade.t <= 0) fade = null; }

    // the camera: follow the player, ease the turn and the zoom, pick the picture
    anchor.x = player.body.x; anchor.y = player.body.y;
    if (!cameraPerFrame) camera.update(dt);
    // an angle or detail that cannot be had here (a static site that baked only some): go back to what is on screen
    const goal = camera.target;
    const gy = nearestYawIndex(yaws, goal.yaw); const gl = pickLevel(details, goal.zoom);
    if (cur.orbit.failed(gy, gl)) unavailable.add(gy * 8 + gl);
    if (unavailable.has(gy * 8 + gl)) { camera.rotateTo(yaws[shown.yawIndex]); camera.zoomTo(details[shown.level] / details[0]); }
    shown = sceneCamera.frame() ?? shown;
  }

  const old = { x: 0, y: 0, w: 0, h: 0 };
  /** Draw the backdrop for the camera's angle and zoom, then everything standing on it, far to near. */
  function draw() {
    // The game may draw between two steps with the player moved part of the way (stage.player.x, y set for
    // the length of this call). Place the backdrop from where the player is drawn, so the two never slip.
    anchor.x = player.x - cur.ox; anchor.y = player.y - cur.oy;
    camera.update(0); // moves the look-at point there; turn and zoom do not advance
    ctx.fillStyle = '#10131f'; ctx.fillRect(0, 0, width, height);
    shownB = null;
    // The camera paints the backdrop: the picture for its angle and zoom, bent to its true angle while it
    // turns (ground exact, houses and trees upright), with the angle it is leaving faded over it.
    shown = sceneCamera.draw(ctx, { seconds: genWorld.time }) ?? shown;
    const { view: v, rect } = shown;
    if (fade && (shown.warp || shown.blend)) fade = null; // mid-turn: the page fade would not sit on the bent ground
    if (fade && fade.page.orbit.has(shown.yawIndex, shown.level)) { // the page just left, in the same place, fading away
      // with two times of day showing, the old page must fade as the same mix, or the light would flash
      if (pairWanted() && mixB > 0.15 && !pics.get(pk(fade.page.px, fade.page.py, shown.yawIndex, shown.level, lookB))?.view) fade = null;
    }
    if (fade && fade.page.orbit.has(shown.yawIndex, shown.level)) {
      const ov = fade.page.orbit.view(shown.yawIndex, shown.level);
      const c = ov.toCell(camera.x + cur.ox - fade.page.ox, camera.y + cur.oy - fade.page.oy);
      old.w = ov.cols * shown.cellPx; old.h = ov.rows * shown.cellPx;
      old.x = Math.round(width / 2 - c.col * shown.cellPx); old.y = Math.round(height / 2 - c.row * shown.cellPx);
      ov.draw(ctx, old.x, old.y, old.w, old.h, { alpha: Math.max(0, fade.t / 0.3) });
    }
    const list = [player];
    for (const e of people) if (e.rig && !e.hidden) list.push(e);
    for (const c of cast) if (!c.hidden) list.push(c);
    for (const x of extras) if (!x.hidden) list.push(x);
    list.sort((p, q) => v.depthOf(p.x - cur.ox, p.y - cur.oy) - v.depthOf(q.x - cur.ox, q.y - cur.oy));
    for (const c of list) {
      const lx = c.x - cur.ox; const ly = c.y - cur.oy;
      if (typeof c.draw === 'function') c.draw(ctx, v, rect, lx, ly, occlude);
      else c.drawn = v.drawSprite(ctx, rect, spriteFor(c === player ? player : c.rig), lx, ly, { scale: 1, occlude });
    }
    if (outlines) {
      ctx.save(); ctx.strokeStyle = '#ff40c0'; ctx.lineWidth = 1.5;
      for (const b of collision.bodies) {
        if (!b.points && !b.r) continue;
        const pts = b.points ? b.points.map(([px, py]) => [b.x + px, b.y + py]) : Array.from({ length: 12 }, (_, i) => [b.x + b.r * Math.cos(i / 6 * Math.PI), b.y + b.r * Math.sin(i / 6 * Math.PI)]);
        ctx.beginPath(); pts.forEach(([x, y], i) => { const p = v.toPoint(x, y, rect); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
    }
  }

  const stage = {
    canvas, query, layout, maxWidth, maxHeight, addCharacter, removeCharacter, cast,
    /** 'browser' when the pages are drawn here (no page server), else 'server'. */
    drawnBy: drawHere ? 'browser' : 'server',
    /** The band of a camp site (a chunk feature with name 'camp'): [{ kind, describe, seed, x, y, yaw }]. See world-gen.js. */
    campMobs,
    get width() { return width; }, get height() { return height; },
    /** The game's canvas changed size. Sizes above maxWidth x maxHeight are cut to that; returns the size in use. */
    resize(w, h) { width = fit(w, maxWidth, 'width'); height = fit(h, maxHeight, 'height'); sceneCamera.resize(width, height); shown = sceneCamera.frame() ?? shown; return { width, height }; },
    /**
     * Call fn(page, collision) now and every time the player moves on to another page. Each page has a
     * NEW collision world in its own coordinates, so a game's own bodies (props, thrown things, quest
     * triggers) are added again here. Returns a function that stops the calls.
     */
    onPage(fn) { pageListeners.push(fn); fn(cur, collision); return () => { const i = pageListeners.indexOf(fn); if (i >= 0) pageListeners.splice(i, 1); }; },
    /** World point -> point on the current page (what collision bodies and the Kiln view use), and back. */
    toLocal: (x, y) => ({ x: x - cur.ox, y: y - cur.oy }),
    toWorld: (x, y) => ({ x: x + cur.ox, y: y + cur.oy }), terrain, pages, pictures: pics, player, extras, stats, bodied, update, draw, groundAt, camera, sceneCamera,
    layers: { SCENERY, CHARACTER },
    /** Residents in view this step (each has rig.actor and events). */
    get people() { return people; },
    /** The world engine's entity store of all residents: queryRadius, stats, on('wake' | 'sleep')... */
    get residents() { return residents; },
    get genWorld() { return genWorld; },
    get collision() { return collision; },
    /** The page the player is on: { px, py, ox, oy, ground }. World point = page-local point + (ox, oy). */
    get page() { return cur; },
    /** What is on screen now: the Kiln view, its rectangle, and which angle and detail it is. */
    get view() { return shown.view; },
    get rect() { return shown.rect; },
    get shown() { return shown; },
    get fetching() { return fetching; },
    /** True while the player stands at the limit because the next page is still being rendered. */
    get waiting() { return waiting; },
    /** True when the player stands where the baked pages end (static sites). */
    get atEdge() { return atEdge; },
    get occlude() { return occlude; }, set occlude(v) { occlude = !!v; },
    /**
     * Set true when the game steps slower than it draws: update() then leaves the camera alone and the game
     * calls stage.camera.update(secondsSinceLastFrame) before each draw(), so turns and zooms ease every frame.
     */
    get cameraPerFrame() { return cameraPerFrame; }, set cameraPerFrame(v) { cameraPerFrame = !!v; },
    /**
     * The game's Detail setting: how fine the characters are drawn (2 coarse, 3 normal, 5 fine; 1 to 8).
     * At 2 or less the backdrop also stays on its coarse level when zoomed in (the camera's levelBias -1),
     * which halves the page rendering work. The fine level is never shown zoomed out: its pages are only
     * big enough for the zoomed-in view. Changing the detail remakes the character sprites.
     */
    get detail() { return spriteDetail; },
    set detail(v) {
      if (!(v >= 1 && v <= 8)) throw new Error(`stage.detail: expected a number from 1 to 8, got ${v}`);
      if (v === spriteDetail) return;
      spriteDetail = v;
      if ('levelBias' in sceneCamera) sceneCamera.levelBias = v <= 2 ? -1 : 0;
      player.sprites.clear();
      for (const c of cast) c.sprites.clear();
      for (const e of residents.queryRadius(player.x, player.y, 200, [])) if (e.rig) e.rig.sprites.clear();
    },
    get outlines() { return outlines; }, set outlines(v) { outlines = !!v; },
    /** The time of day, weather and style in use: { time?, atmosphere?, style? }. */
    get sceneOptions() { return sceneOptionsFromKey(look); },
    /**
     * Change the time of day, weather or style: { time, atmosphere: { fog, haze, clouds, fireflies }, style }.
     * The pictures are fetched again in the new look; the old one stays on screen until the first arrives.
     * Resolves then (rejects, keeping the old look, when the new pictures cannot be had).
     */
    async setSceneOptions(options = {}) {
      const before = { base, timeA, look };
      base = tidyOptions(options); timeA = base.time ?? 'day'; timeB = null; mixB = 0; lookB = null;
      look = lookKey(timeA);
      if (look === before.look) return;
      try { await picture(cur, shown.yawIndex, shown.level).promise; } catch (e) { ({ base, timeA, look } = before); throw new Error(`stage.setSceneOptions: could not get the pictures for ${JSON.stringify(options)} (${e.message})`); }
    },
    /**
     * Follow a sky through the day: show time of day , with  faded over it by mix (0 to 1).
     * a and b are 'day', 'dawn', 'dusk', 'night' or an hour 0 to 24; the sky engine's look.at(sky.now)
     * gives exactly this shape. Call it every frame: it is cheap, and pictures are fetched only when a
     * new time of day comes up (they stay cached). Weather and style stay as setSceneOptions left them.
     * What is really on screen (while pictures load, or where a look was not baked) is stage.lookShowing.
     */
    setLook({ a, b = null, mix = 0 } = {}) {
      if (a === undefined || a === null) throw new Error('stage.setLook: a (the time of day to show) is required');
      const m = Number(mix);
      if (!(m >= 0 && m <= 1)) throw new Error(`stage.setLook: mix must be from 0 to 1, got ${mix}`);
      const ka = lookKey(a); // throws for a time Kiln does not have
      if (ka !== look && !failedLooks.has(ka)) { timeA = a; look = ka; }
      const second = b !== null && b !== a && m > 0 ? b : null;
      timeB = second; mixB = second === null ? 0 : m; lookB = second === null ? null : lookKey(second);
      if (lookB === look) { lookB = null; timeB = null; mixB = 0; }
      // a look that cannot be had here (not baked): stay on what is showing
      if (cur.orbit.failed(shown.yawIndex, shown.level)) { failedLooks.add(look); const was = timeOfView.get(rawOf(shown.view)); if (was !== undefined) { timeA = was; look = lookKey(was); } }
    },
    /** The times of day on screen now: { a, b, mix }. b is null and mix 0 when only one picture is drawn. */
    get lookShowing() { return { a: timeOfView.get(rawOf(shown.view)) ?? timeA, b: shownB ? timeB : null, mix: shownB ? mixB : 0 }; },
    /** Screen point { x, y } of a world point, h metres above the ground there. */
    toScreen(x, y, h = 0) {
      const lx = x - cur.ox; const ly = y - cur.oy;
      const p = shown.view.toPoint(lx, ly, shown.rect, cur.ground.heightAt(lx, ly) + h * 16);
      return { x: p.x, y: p.y };
    },
    /** 'meadow', 'forest', 'taiga', 'steppe', 'fen', 'water', 'shore' or 'rocky hill' at a world point. */
    biomeAt(x, y) {
      const s = terrain.sample(Math.floor(x), Math.floor(y));
      return s.biome ? s.biome.name : s.height < 0.42 ? 'water' : s.height < 0.45 ? 'shore' : 'rocky hill';
    },
    /** Plain JSON: where the player is, how the camera stands, and what the world engine saves (the residents and where they are). */
    save() {
      genWorld.save();
      const goal = camera.target;
      return { version: 1, seed: SEED, x: player.x, y: player.y, yaw: goal.yaw, zoom: goal.zoom, world: Object.fromEntries([...saved].map(([k, v]) => [k, JSON.parse(v)])) };
    },
    /** Go back to a save() result. Resolves when the page for the saved place is showing. */
    async load(data) {
      if (!data || data.version !== 1 || !Number.isFinite(data.x) || !Number.isFinite(data.y)) throw new Error('stage.load: expected what stage.save() returned');
      if (data.seed !== SEED) throw new Error(`stage.load: this save is from world "${data.seed}", not "${SEED}"`);
      busy = true;
      try {
        const yi = nearestYawIndex(yaws, data.yaw ?? yaws[START_YAW]); const li = pickLevel(details, data.zoom ?? 1);
        const page = await firstPage(data.x, data.y, yi, li);
        saved = new Map(Object.entries(data.world ?? {}).map(([k, v]) => [k, JSON.stringify(v)]));
        for (const e of bodied) e.body = null;
        bodied.clear(); people = []; fade = null;
        boot();
        player.x = data.x; player.y = data.y; player.vx = 0; player.vy = 0;
        cur.build = null; page.build = null; // collision worlds hold the old bodies
        enterPage(page);
        camera.rotateTo(yaws[yi]).zoomTo(details[li] / details[0]).snap();
        shown = sceneCamera.frame() ?? shown;
        genWorld.loadAll(player);
      } finally { busy = false; }
    },
  };
  return stage;
}
