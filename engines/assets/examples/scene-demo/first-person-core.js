// The drawing half of the demo's first-person and orbit views: it owns the first-person engine's
// world and view, and turns one request (where the player is, where they look, who stands around)
// into one finished picture. It touches no page, so it runs in a worker (first-person-worker.js),
// which keeps the 10 ms or so a picture costs off the page's own thread; first-person.js runs it
// on the page only when workers are not to be had.
import { createFpWorld, createFirstPerson, createFpCamera, cameraBasis } from './vendor/firstperson/index.js';
import { sceneFirstPersonWorld } from '../../src/scene-first-person.js';

const EYE = 1.62; // metres above the ground: the eyes of a 1.8 m villager
const SKIP = ['villager', 'knight', 'skeleton']; // a scene's own baked figures; the live characters come with each request

/** The look the pictures were built with: the same names build.mjs takes (time, style, fog, haze, clouds). */
function applyLook(scene, look = {}) {
  if (look.time !== undefined) scene.time = Number.isNaN(Number(look.time)) ? look.time : Number(look.time);
  if (look.style !== undefined) scene.style = look.style;
  for (const key of ['fog', 'haze', 'clouds']) if (look[key] !== undefined) scene.atmosphere = { ...scene.atmosphere, [key]: Number(look[key]) };
  return scene;
}

/** Characters across and down, and pixels a character, for a stage size and a detail setting (2 coarse, 3 usual, 5 fine). */
export function pictureSize(W, H, detail = 3, cellPx = null) {
  const want = cellPx ?? Math.min(10, Math.max(3, Math.round(12 / detail))); // 2 -> 6 px, 3 -> 4 px, 5 -> 3 px
  const px = Math.max(want, Math.ceil(Math.sqrt(W * H / (13500 * detail))));
  return { px, cols: Math.floor(W / px), rows: Math.floor(H / px) };
}

/**
 * @param {object} init  { kind: 'hamlet', sceneUrl, look } for one fixed Kiln scene, or { kind: 'world', look } for the
 *   open world, whose land is taken page by page from world-gen.js (a page is 176 m across, so one
 *   first-person world serves a long walk: a new one is built only when the player nears its edge).
 * @returns {Promise<{frame: (request: object) => object}>}
 */
export async function createFpRenderer(init) {
  let world = null; let origin = [0, 0]; let built = 0; let buildMs = 0;
  // The sky engine (vendor/sky), once a request brings a sample of it: worlds are then built with every lamp in
  // them (as at night) and lit each picture for the hour; steady is how many lamps burn day and night.
  let link = null; let steady = 0; let adopted = null;
  // The weather engine (vendor/weather), once a request brings a sample of it: fog and wind for the world, and rain
  // and snow written into the picture's cells (more drops, further out, for the orbit view's wider look).
  let weather = null; let lastTime = null;
  const night = (scene) => { if (link) { scene.time = 'night'; steady = (scene.lights ?? []).length; } return scene; };
  let pick; // (player) => makes sure `world` and `origin` fit where the player is
  if (init.kind === 'world') {
    const gen = await import('./world-gen.js');
    const land = gen.createGenWorld(); // its own copy of the generated land
    const half = gen.layout.half;
    pick = (p) => {
      if (world && Math.max(Math.abs(p.x - origin[0] - half), Math.abs(p.y - origin[1] - half)) < half - 40) return;
      const t0 = performance.now();
      const at = gen.layout.pageAt(p.x, p.y);
      const def = sceneFirstPersonWorld(night(applyLook(gen.pageScene(land, at.px, at.py), init.look)), { skip: SKIP });
      def.light.cellsPerMetre = 2; // a page is large: coarser light maps build in a quarter of the time
      world = createFpWorld(def); origin = gen.layout.originOf(at.px, at.py);
      built++; buildMs = performance.now() - t0;
    };
  } else {
    const json = await (await fetch(init.sceneUrl)).text();
    pick = () => {
      if (world) return;
      const t0 = performance.now();
      world = createFpWorld(sceneFirstPersonWorld(night(applyLook(JSON.parse(json), init.look)), { skip: SKIP }));
      built++; buildMs = performance.now() - t0;
    };
    pick();
  }

  const eye = createFpCamera({ x: 0, y: 0, z: 2 });
  let view = null; let viewWorld = null; let key = '';
  let eyeZ = null; let lift = 0; // lift: degrees a shot's camera is tilted further down to see over scenery
  let canvas = null; let cctx = null; let image = null; let pixels = null;
  const solids = []; const casters = [];

  /** Put the eye: at the player's eyes in first person; in orbit, behind and above them along the look direction. */
  function placeEye(req, lx, ly) {
    eye.yaw = req.yaw; eye.pitch = req.pitch; eye.fov = req.fov;
    if (req.mode !== 'orbit') { eye.x = lx; eye.y = ly; eye.z = eyeZ; return; }
    const cy = Math.cos(req.yaw * Math.PI / 180); const sy = Math.sin(req.yaw * Math.PI / 180);
    // what the camera circles: the player's head, or the point a cutscene shot asks for (at head height above its ground)
    if (req.target) { lx = req.target.x - origin[0]; ly = req.target.y - origin[1]; }
    const tz = req.target ? world.heightAt(lx, ly) + (req.target.h ?? EYE - 0.2) : eyeZ - 0.2;
    const m = world.maps;
    // whether a point is inside something that stands on the ground (the light maps know how high things stand)
    const blocked = (x, y, z) => {
      const i = Math.min(m.gw - 1, Math.max(0, Math.round((x - m.x0) * m.g))); const j = Math.min(m.gh - 1, Math.max(0, Math.round((y - m.y0) * m.g)));
      const top = m.hm[j * m.gw + i];
      return top > world.heightAt(x, y) + 0.5 && z < top + 0.2;
    };
    let reach = req.orbitDist; let pitch = req.pitch;
    if (req.target && req.orbitDist > 1.5) {
      // A cutscene shot keeps its distance. When a wall or a roof stands between the eye and the point, the camera
      // lifts (tilts further down, ten degrees at a time) until the way is clear. What stands right at the point
      // itself, such as the roof of a well it looks at, is not counted: the first metre and a half is left out.
      let want = 0;
      for (; want < 60; want += 10) {
        const p = Math.max(-85, req.pitch - want) * Math.PI / 180; const c = Math.cos(p); const s0 = Math.sin(p);
        let clear = true;
        for (let s = 1.5; s <= reach && clear; s += 0.25) clear = !blocked(lx - cy * c * s, ly - sy * c * s, tz - s0 * s);
        if (clear || req.pitch - want <= -85) break;
      }
      lift += (want - lift) * 0.18; // eased, so the camera rises rather than jumps
      pitch = Math.max(-85, req.pitch - lift);
      eye.pitch = pitch;
    } else {
      lift = 0;
      // around the player: walk back from the head and stop short of walls and roofs
      const cp0 = Math.cos(pitch * Math.PI / 180); const sp0 = Math.sin(pitch * Math.PI / 180);
      for (let s = 0.4; s <= req.orbitDist; s += 0.2) {
        if (blocked(lx - cy * cp0 * s, ly - sy * cp0 * s, tz - sp0 * s)) { reach = Math.max(0.4, s - 0.3); break; }
      }
    }
    const cp = Math.cos(pitch * Math.PI / 180); const sp = Math.sin(pitch * Math.PI / 180);
    eye.x = lx - cy * cp * reach; eye.y = ly - sy * cp * reach;
    // never under the ground, the sea, or a roof it has ended up beneath
    const i = Math.min(m.gw - 1, Math.max(0, Math.round((eye.x - m.x0) * m.g))); const j = Math.min(m.gh - 1, Math.max(0, Math.round((eye.y - m.y0) * m.g)));
    const over = req.target && req.orbitDist > 1.5 ? m.hm[j * m.gw + i] + 0.4 : -Infinity;
    eye.z = Math.max(tz - sp * reach, over, world.heightAt(eye.x, eye.y) + 0.25, world.water ? world.water.level + 0.25 : -Infinity);
  }
  return {
    /** True once the sky engine lights the worlds. */
    get skyReady() { return link !== null; },
    /**
     * Start following the sky engine: call once, before the first request that carries a sky sample.
     * Worlds are built again with every lamp in them. Rejects when vendor/sky is not there.
     */
    async useSky() {
      if (link) return;
      const { createFirstPersonLink } = await import('./vendor/sky/index.js');
      link = createFirstPersonLink({ fog: Number(init.look?.fog) || 0 });
      world = null; // built again, as at night, by the next request
    },
    /** True once the weather engine is in use. */
    get weatherReady() { return weather !== null; },
    /** Start showing the weather: call once, before the first request that carries a `weather` sample. Rejects when vendor/weather is not there. */
    async useWeather() {
      if (weather) return;
      const { createFirstPersonWeather, createCellWeather } = await import('./vendor/weather/index.js');
      weather = { world: createFirstPersonWeather(), near: createCellWeather(), wide: createCellWeather({ max: 2400 }) };
    },
    /**
     * One picture.
     * @param {object} req  { W, H, detail, cellPx?, mode ('first' | 'orbit'), yaw, pitch, fov, orbitDist, target? ({ x, y, h? }: what an orbit circles instead of the player, h metres above the ground there), time, reset?,
     *   player: { x, y }, things: [{ x, y, z, r, person, me, shapes }], sky? } with positions in stage coordinates.
     *   weather: weather.now of the weather engine, with weatherLight (0..1, how bright drops are) and weatherAmount (the effects setting); needs useWeather() first.
     *   sky: a sample of the sky engine (sky.now: light, fill, skyTop, skyBottom, fogColor, stars, lamps); needs useSky() first.
     * @returns {object} { picture (an ImageBitmap, or a canvas when run on the page), depth (Float32Array, one distance a cell), cols, rows, eye (in stage
     *   coordinates), ms, stats, built, buildMs }
     */
    frame(req) {
      const t0 = performance.now();
      pick(req.player);
      const size = pictureSize(req.W, req.H, req.detail, req.cellPx);
      const k = size.cols + 'x' + size.rows + 'x' + size.px;
      if (world !== viewWorld || k !== key) {
        view = createFirstPerson({ world, cols: size.cols, rows: size.rows, cellPx: size.px });
        viewWorld = world; key = k; eyeZ = null;
        const w = size.cols * size.px; const h = size.rows * size.px;
        canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
        cctx = canvas.getContext('2d');
        pixels = new Uint32Array(w * h);
        image = new ImageData(new Uint8ClampedArray(pixels.buffer), w, h);
      }
      if (req.reset) eyeZ = null;
      if (link && req.sky) { // the hour: light, sky, haze and lamps, and shadows again when the sun or moon has moved enough
        if (adopted !== world) { link.adopt(world, { steady }); adopted = world; }
        link.apply(world, req.sky);
      }
      if (weather && req.weather) weather.world.apply(world, req.weather); // how far one sees, and how the grass blows
      const lx = req.player.x - origin[0]; const ly = req.player.y - origin[1];
      const z = world.heightAt(lx, ly) + EYE;
      eyeZ = eyeZ === null ? z : eyeZ + (z - eyeZ) * 0.35; // ease over the creases of the ground
      placeEye(req, lx, ly);
      solids.length = 0; casters.length = 0;
      const fwdX = Math.cos(eye.yaw * Math.PI / 180); const fwdY = Math.sin(eye.yaw * Math.PI / 180);
      for (const c of req.things) {
        const x = c.x - origin[0]; const y = c.y - origin[1];
        const dx = x - eye.x; const dy = y - eye.y;
        if (dx * dx + dy * dy > 90 * 90) continue;
        casters.push({ x, y, r: c.r * (c.z > 0.3 ? 0.6 : 1), h: c.person ? 1.7 : c.r * 2 });
        if ((c.me && req.mode === 'first') || !c.shapes || dx * fwdX + dy * fwdY < -3) continue; // in first person your own body is not drawn; nor what is well behind the eye
        solids.push({ at: [x, y, world.heightAt(x, y) + c.z], shapes: c.shapes });
      }
      view.render(eye, { solids, casters, time: req.time });
      const dt = lastTime === null ? 0 : Math.min(0.1, Math.max(0, req.time - lastTime)); lastTime = req.time;
      let drops = 0;
      if (weather && req.weather && (req.weatherAmount ?? 1) > 0) {
        // rain and snow: real points around the eye (around the villager in the orbit view), behind what is nearer
        const o = { basis: cameraBasis(eye, size.cols, size.rows), depthAt: view.depthAt, dt, light: req.weatherLight ?? 1, amount: req.weatherAmount ?? 1 };
        if (req.mode === 'orbit') { o.center = [lx, ly, eyeZ - 0.2]; o.reach = Math.max(6, Math.hypot(eye.x - lx, eye.y - ly, eye.z - eyeZ) * 0.7 + 4); }
        drops = (req.mode === 'orbit' ? weather.wide : weather.near).apply(view.frame, req.weather, o);
      }
      // how far away each cell's surface is (metres along the look direction, Infinity for sky), so what is drawn
      // over the picture on the page (effects, markers) can hide behind scenery
      const depth = new Float32Array(size.cols * size.rows);
      for (let r = 0, i = 0; r < size.rows; r++) for (let c = 0; c < size.cols; c++, i++) depth[i] = view.depthAt(c, r);
      view.paint(pixels);
      cctx.putImageData(image, 0, 0);
      const picture = typeof canvas.transferToImageBitmap === 'function' ? canvas.transferToImageBitmap() : canvas;
      return {
        picture, depth, cols: size.cols, rows: size.rows,
        eye: { x: eye.x + origin[0], y: eye.y + origin[1], z: eye.z, yaw: eye.yaw, pitch: eye.pitch, fov: eye.fov, near: eye.near, far: eye.far },
        ms: performance.now() - t0, stats: { ...view.stats, solids: solids.length, relights: link ? link.stats.relights : 0, lamps: world.lamps.length, drops, haze: Math.round(world.haze) }, built, buildMs,
      };
    },
  };
}
