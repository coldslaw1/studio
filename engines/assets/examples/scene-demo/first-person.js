// First-person and orbit views for the scene demo: V (or the button) steps from the isometric
// picture to standing in the scene, to a camera that turns and tilts freely around the villager.
// The first-person engine (vendor/firstperson) draws the same scene (same terrain, meshes,
// materials, light and shading settings) live, as character cells.
//
// It works on both of the demo's stages and edits neither: the hamlet stage of main.js
// (window.demo) and the open world stage (world-stage.js), whose land it takes page by page from
// world-gen.js. On a stage it replaces draw while a 3D view is on, and turns the walking keys into
// "forward, back and sideways from where I look" before handing them to the stage's own update, so
// collision, characters, props and the game on top keep working as they do in the isometric view.
//
// A game switches views through any attached stage: stage.setViewMode('iso' | 'first' | 'orbit'),
// stage.viewMode, stage.viewModes, stage.onViewMode(fn), and asks where a ground point is on the
// canvas with stage.toScreen(x, y, metresAboveGround), which answers for the view that is showing.
//
// The pictures are drawn in a worker (first-person-worker.js runs first-person-core.js): this file
// only gathers who stands where, asks for the next picture and puts the newest one on the canvas,
// so a picture costs the page about a millisecond however long it takes to draw.
// A cutscene's camera shot (stage.shot, or stage.firstPerson.setShot) plays in the 3D views too: a camera circling
// the shot's point with the hero in the picture; stage.firstPerson.shotNow() is the shot the view shows now.
// stage.setViewDetail(2 | 3 | 5) makes the 3D views coarser (cheaper) or finer. stage.occluded(x, y, h, point)
// tells whether scenery of the 3D picture hides a point (each picture comes back with its distances).
// Vendor the engine with: node ../vendor.mjs firstperson --into examples/scene-demo
import { createFpCamera, cameraBasis, createMouseLook, walkDirection } from './vendor/firstperson/index.js';
import { createOrbitRig, holdTurn, orbitFromShot, shotFromOrbit } from './vendor/camera/index.js'; // the orbit view turns, tilts and zooms with the camera engine's easing and steps, like the isometric view

const TURN = 120; // degrees a second for the Q and E keys
const ORBIT_PITCH = [-85, 12]; // how far the orbit view tilts: from straight above to just under level
const NEXT = { iso: 'first', first: 'orbit', orbit: 'iso' };
const NAMES = { iso: 'Isometric view', first: 'First person', orbit: 'Orbit view' };
const STILL = Object.freeze({ dx: 0, dy: 0, run: false });
const HEAD = 1.42; // metres above the ground: where the orbit camera and a cutscene shot look at a standing person
const EYE = 1.62;  // metres above the ground: a standing person's eyes

// ---- one viewer for the page: the view that is on, the look direction, the mouse and the switch ----
let shared = null;
function viewer(canvas) {
  if (shared) return shared;
  const camera = createFpCamera({ x: 0, y: 0, z: 2, yaw: 90, pitch: -3, fov: 90, near: 0.08 });
  const v = shared = {
    mode: 'iso', camera, orbitDist: 6, detail: 3, turning: { left: false, right: false },
    // The orbit view's camera, eased like the isometric one: Q and E turn it an eighth of a turn (hold to
    // keep turning), Shift + wheel moves it nearer or further, a drag turns and tilts it.
    rig: createOrbitRig({ yaw: 90, pitch: -22, distance: 6, minPitch: ORBIT_PITCH[0], maxPitch: ORBIT_PITCH[1], minDistance: 1.5, maxDistance: 16 }), rigAt: 0,
    active: null, // the attached stage that drew last: keys and the mouse belong to it
    listeners: [], stages: [],
    get on() { return v.mode !== 'iso'; },
  };
  // the mouse and the keys belong to a view only while its stage says so: never under a menu, the bag, a dialogue or a cutscene
  const free = () => !v.active || v.active.free();
  v.look = createMouseLook(camera, canvas, { enabled: free, onChange: () => refresh() });
  const doc = canvas.ownerDocument; const win = doc.defaultView;
  const button = v.button = doc.createElement('button');
  button.type = 'button';
  button.style.cssText = 'position:fixed;left:8px;bottom:26px;z-index:3;font:12px Consolas,monospace;color:#c8c8d8;background:rgba(11,10,18,0.88);border:1px solid #2a2a3a;border-radius:6px;padding:4px 10px;cursor:pointer';
  button.title = 'V steps through the views: isometric, first person, orbit (drag turns and tilts the camera around the villager, Q and E turn it, the wheel moves it nearer or further). In first person: move the mouse to look (click the picture to catch the mouse, Esc lets go), W A S D to walk, Shift to run.';
  function refresh() { button.textContent = `Next view: ${NAMES[NEXT[v.mode]]} (V)${v.mode === 'first' && !v.look.locked ? ' - click the picture to look with the mouse' : v.mode === 'orbit' ? ' - drag to turn and tilt, wheel for distance' : ''}`; }
  let drag = null;
  /** Switch the view: no argument steps to the next one; or 'iso', 'first', 'orbit' (true = 'first', false = 'iso'). */
  v.toggle = (want = NEXT[v.mode]) => {
    const was = v.mode;
    const next = want === true ? 'first' : want === false ? 'iso' : want;
    if (!NAMES[next]) throw new Error(`first-person toggle: unknown view ${JSON.stringify(want)}, expected 'iso', 'first' or 'orbit'`);
    v.mode = next;
    if (v.on) {
      if (was === 'iso') (v.active ?? v.stages[0])?.enter(); // start looking where the villager faces
      camera.pitch = next === 'orbit' ? -22 : -3;
      if (next === 'orbit') v.rig.set({ yaw: camera.yaw, pitch: camera.pitch }); // the rig starts from where the view looks
      if (next === 'first') v.look.lock(); else v.look.unlock(); // the orbit view is dragged, so the mouse stays free
    } else v.look.unlock();
    v.turning.left = false; v.turning.right = false; camera.fov = 90;
    drag = null;
    canvas.style.cursor = next === 'first' ? 'crosshair' : '';
    refresh();
    if (next !== was) for (const fn of v.listeners.slice()) fn(next);
    return v.on;
  };
  button.addEventListener('click', () => { v.toggle(); button.blur(); });
  doc.body.appendChild(button);
  refresh();

  win.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyV' && !e.repeat && free()) v.toggle();
    // Q and E turn the orbit view. In first person only the mouse looks: no turning keys, no zoom.
    // a tap turns an eased eighth of a turn; held (key repeat), the next step starts as the last is half done
    if (v.mode === 'orbit' && free() && (e.code === 'KeyQ' || e.code === 'KeyE') && (!e.repeat || holdTurn(v.rig, true))) v.rig.rotateSteps(e.code === 'KeyQ' ? 1 : -1);
  });
  win.addEventListener('keyup', (e) => { if (e.code === 'KeyQ') v.turning.left = false; if (e.code === 'KeyE') v.turning.right = false; });
  // In first person the mouse looks around: a click catches the mouse. In the orbit view a drag turns
  // and tilts the camera around the villager, with the camera engine's mouse manners: a press only
  // becomes a drag after 5 pixels, it keeps working outside the canvas, no right-click menu, and the
  // wheel moves one step a notch (a trackpad's stream of small scrolls is added up).
  const THRESHOLD = 5; const NOTCH = 100;
  let wheelSum = 0; let wheelAt = -Infinity;
  const endDrag = () => { if (!drag) return; try { canvas.releasePointerCapture?.(drag.id); } catch { /* already released */ } drag = null; };
  function wheelSteps(e) {
    const delta = (e.deltaY || (e.shiftKey ? e.deltaX : 0)) * (e.deltaMode === 1 ? NOTCH / 3 : e.deltaMode === 2 ? NOTCH : 1); // Shift + wheel arrives sideways in Chrome and Edge
    if (!delta) return 0;
    if (e.timeStamp - wheelAt > 250 || Math.sign(delta) !== Math.sign(wheelSum)) wheelSum = 0;
    wheelAt = e.timeStamp; wheelSum += delta;
    return wheelSum === delta ? Math.sign(delta) : Math.trunc(wheelSum / NOTCH) - Math.trunc((wheelSum - delta) / NOTCH);
  }
  for (const type of ['pointerdown', 'mousedown', 'click', 'wheel', 'contextmenu']) {
    win.addEventListener(type, (e) => {
      if (!v.on || e.target !== canvas || !v.active) return;
      if (type === 'contextmenu') { e.preventDefault(); return; }
      if (performance.now() - v.active.playedAt > 300 || !free()) return; // menus, dialogue and cutscenes keep their clicks
      if (type !== 'wheel' && e.button !== 0) return; // the right and middle buttons are the game's (guard)
      if (type === 'wheel' && (v.mode === 'first' || !(e.shiftKey || e.ctrlKey))) return; // first person has no zoom; in the orbit view Shift or Ctrl + wheel zooms, as in the isometric view, and the plain wheel stays the game's (hotbar)
      // The orbit view's wheel is its distance and goes no further. Left clicks do go on to the game, which swings at
      // an enemy near by and never walks on a click in these views; here they also catch the mouse or start a drag.
      if (type === 'wheel') { e.stopPropagation(); e.preventDefault(); }
      if (type === 'pointerdown' && v.mode === 'first') v.look.lock();
      if (type === 'pointerdown' && v.mode === 'orbit' && !drag) {
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, turning: false };
        try { canvas.setPointerCapture?.(e.pointerId); } catch { /* the drag still works over the canvas */ }
      }
      if (type === 'wheel') {
        const steps = wheelSteps(e);
        if (steps) v.rig.zoomBy(-steps); // eased; three notches halve or double the distance
      }
    }, { capture: true, passive: false });
  }
  win.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (v.mode !== 'orbit' || !free() || (e.pointerType === 'mouse' && e.buttons === 0)) { endDrag(); return; } // the release was missed, or a menu came up
    if (!drag.turning) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < THRESHOLD) return;
      drag.turning = true; drag.x = e.clientX; drag.y = e.clientY; // no jump when the drag begins
      return;
    }
    // the scenery follows the mouse, as in the isometric view: both axes, any angle, no steps
    v.rig.turn((e.clientX - drag.x) * 0.35, (e.clientY - drag.y) * 0.3);
    camera.yaw = v.rig.yaw; camera.pitch = v.rig.pitch;
    drag.x = e.clientX; drag.y = e.clientY;
  }, true);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) win.addEventListener(type, (e) => { if (drag && e.pointerId === drag.id) endDrag(); }, true);
  return v;
}

// ---- what the two stages do differently: where the player is, who stands around, how high the ground is ----
/** The hamlet stage of main.js: positions on collision bodies, everything in stage.actors. */
function hamletSource(stage, o) {
  return {
    name: 'hamlet',
    init: { kind: 'hamlet', sceneUrl: new URL(String(o.sceneUrl ?? stage.sceneUrl ?? new URL('../hamlet.scene.json', import.meta.url)), globalThis.location?.href ?? import.meta.url).href }, // stage.sceneUrl: the stage says which scene it shows (the whole scene, prefabs inlined); made absolute for the worker
    player: () => stage.player.body,
    groundAt: (x, y) => stage.groundAt(x, y),
    * things() {
      for (const c of stage.actors) {
        if (c.hidden || !c.body) continue;
        const puppet = c.actor?.puppet ?? c.puppet;
        if (puppet) yield { x: c.body.x, y: c.body.y, z: c.z ?? 0, r: c.body.r ?? 0.3, puppet, person: !!c.actor, me: c === stage.player };
      }
    },
  };
}
/** The open world stage (world-stage.js): the land comes page by page; the renderer takes the same pages from world-gen.js. */
function openWorldSource(stage) {
  return {
    name: 'open world',
    init: { kind: 'world' },
    player: () => stage.player,
    groundAt: (x, y) => stage.groundAt(x, y),
    * things() {
      const p = stage.player;
      yield { x: p.x, y: p.y, z: 0, r: p.radius ?? 0.3, puppet: p.actor.puppet, person: true, me: true };
      for (const e of stage.people) if (e.rig && !e.hidden) yield { x: e.x, y: e.y, z: 0, r: 0.3, puppet: e.rig.actor.puppet, person: true, me: false };
      for (const x of stage.extras) if (x.puppet && !x.hidden) yield { x: x.x, y: x.y, z: x.z ?? 0, r: x.r ?? 0.25, puppet: x.puppet, person: false, me: false };
    },
  };
}

/**
 * The renderer for a stage: in a worker when the browser can, else on the page. Either way
 * `request(req)` asks for one picture and `latest` is the newest one that came back.
 */
async function startRenderer(init, useWorker) {
  const r = { latest: null, busy: false, inWorker: false, error: null, request: null };
  const take = (out) => {
    if (out.warn) { console.warn('first-person views:', out.warn); return; } // a note from the worker, not a picture
    r.busy = false;
    if (out.error) { r.error = out.error; return; }
    if (r.latest && r.latest.picture !== out.picture) r.latest.picture.close?.();
    r.latest = out;
  };
  if (useWorker && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      const worker = new Worker(new URL('./first-person-worker.js', import.meta.url), { type: 'module' });
      await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => (data.ready ? resolve() : reject(new Error(data.error ?? 'the worker did not start')));
        worker.onerror = (e) => reject(new Error(e.message || 'the worker could not be loaded'));
        worker.postMessage({ init });
      });
      worker.onmessage = ({ data }) => take(data);
      worker.onerror = (e) => { r.busy = false; r.error = e.message; };
      r.inWorker = true;
      let plainWeather = true;
      r.request = (req) => {
        if (r.busy) return false;
        if (!plainWeather) delete req.weather;
        r.busy = true;
        try { worker.postMessage(req); } catch (e) {
          // something in the request could not be copied to the worker: the weather sample is the only part not made here
          plainWeather = false; delete req.weather;
          console.warn('first-person views: the weather sample could not be sent to the worker, so the 3D views show no rain or fog (' + e.message + ')');
          worker.postMessage(req);
        }
        return true;
      };
      return r;
    } catch (e) { console.warn('first-person views: drawing on the page instead of in a worker:', e.message); }
  }
  const { createFpRenderer } = await import('./first-person-core.js');
  const local = await createFpRenderer(init);
  // the sky and weather engines are taken up the first time a request brings a sample of them (once each)
  let noSky = false; let noWeather = false;
  r.request = (req) => {
    const wants = [];
    if (req.sky && !local.skyReady && !noSky) wants.push(local.useSky().catch((e) => { noSky = true; console.warn('first-person views: the sky engine is not vendored here, so the 3D views keep the look they were built with (' + e.message + ')'); }));
    if (req.weather && !local.weatherReady && !noWeather) wants.push(local.useWeather().catch((e) => { noWeather = true; console.warn('first-person views: the weather engine is not vendored here, so the 3D views show no rain or fog (' + e.message + ')'); }));
    if (wants.length) { r.busy = true; Promise.all(wants).then(() => take(local.frame(req))); return true; }
    take(local.frame(req)); return true;
  };
  return r;
}

/**
 * Add the first-person and orbit views to a stage.
 * @param {object} stage  The hamlet stage from main.js, or the open world stage from world-stage.js.
 * @param {object} [o]
 * @param {string} [o.sceneUrl]  Hamlet stage: the Kiln scene it shows (default stage.sceneUrl, else the hamlet).
 * @param {number} [o.cellPx]    Pixels per character (default: from the detail setting).
 * @param {object} [o.look]      { time, style, fog, haze, clouds } instead of the address's.
 * @param {boolean} [o.worker]   false draws on the page's own thread (default: in a worker; ?fpworker=0 in the address also turns it off).
 * @param {() => boolean} [o.autoPlay]  True while a bot holds the keys (they then mean isometric directions).
 * @returns {Promise<object>} { mode, modes, setMode(name), onChange(fn), toggle(), camera, eye, timing, stats, button }
 */
export async function attachFirstPerson(stage, o = {}) {
  if (!stage || typeof stage.update !== 'function' || typeof stage.draw !== 'function' || !stage.canvas) throw new Error('attachFirstPerson: expected a stage with canvas, update(dt, intent) and draw()');
  if (stage.firstPerson) return stage.firstPerson;
  const query = new URLSearchParams(globalThis.location?.search ?? '');
  const look = { ...Object.fromEntries(query), ...(o.look ?? {}) };
  const src = stage.page && stage.layout ? openWorldSource(stage) : hamletSource(stage, o);
  const renderer = await startRenderer({ ...src.init, look: { time: look.time, style: look.style, fog: look.fog, haze: look.haze, clouds: look.clouds } }, o.worker !== false && query.get('fpworker') !== '0');
  const canvas = stage.canvas;
  const ctx = canvas.getContext('2d');
  const v = viewer(canvas);
  const { camera } = v;
  const stats = canvas.ownerDocument.getElementById('stats');
  // page: milliseconds a picture costs on the page's own thread; picture: what drawing it took (in the worker, when there is one)
  const timing = { page: 0, picture: 0, total: 0, worst: 0, frames: 0, render: 0, paint: 0 };
  const autoPlay = o.autoPlay ?? (() => !!window.showcase?.shared?.bot?.on);
  let W = stage.width; let H = stage.height;
  let reset = true; let shownSince = 0;
  // Whether the view may take the mouse and the keys now: the stage's own answer (the demo says no under a menu,
  // the bag or a dialogue, and when another scene is showing), and never while the events engine runs a cutscene.
  const game = () => window.showcase?.shared;
  const busy = () => { const ev = game()?.events; const b = ev?.busy; return typeof b === 'function' ? !!b.call(ev) : !!b; };
  const stageFree = () => (typeof stage.mouseOn === 'function' ? !!stage.mouseOn() : game()?.world === stage && typeof game().worldMouseOn === 'function' ? !!game().worldMouseOn() : true);
  // A cutscene shot (stage.shot, or one given with setShot): while it is active the picture is drawn by a camera
  // circling the shot's point, in first person and in the orbit view alike, and the view takes no input.
  let givenShot; // undefined: read stage.shot; null or a shot: what setShot said
  const shotOf = () => { const s = givenShot === undefined ? stage.shot : givenShot; return s && s.active && Number.isFinite(s.x) && Number.isFinite(s.y) ? s : null; };
  const shotRig = createOrbitRig({ yaw: 90, pitch: -32, distance: 9, minPitch: -89, maxPitch: 89, minDistance: 0.05, maxDistance: 40 });
  let shooting = false; let shotAt = { x: 0, y: 0, h: HEAD }; let shotPov = false;
  const given = (n) => typeof n === 'number' && Number.isFinite(n); // a shot's pitch, height and distance: null leaves it to the view
  // Where the actor with an id stands, when the game can say: a resolver given with setActorResolver, else the game's
  // shared.actorOf(id). It answers a body or anything with x and y in stage coordinates; null when unknown.
  let actorOf = null;
  function povPlace(id) {
    const fn = actorOf ?? game()?.actorOf;
    if (typeof fn !== 'function') return null;
    let a = null;
    try { a = fn(id); } catch { a = null; }
    const p = a?.body ?? a;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  }
  /** Whoever of the stage's characters stands nearest a point, within each metres (for looking through their eyes). */
  function nearest(x, y, reach) {
    let best = null; let bestD = reach;
    for (const c of src.things()) { const d = Math.hypot(c.x - x, c.y - y); if (d < bestD && c.person) { bestD = d; best = c; } }
    return best;
  }
  const me = { free: () => stageFree() && !busy() && !shooting, playedAt: -1e9, enter() { const puppet = stage.player.actor?.puppet; if (puppet) camera.yaw = ((puppet.yaw - 90) % 360 + 360) % 360; reset = true; timing.frames = 0; timing.worst = 0; } };
  v.stages.push(me);

  // ---- the stage's update: walking keys follow the look direction ----
  const baseUpdate = stage.update; const baseDraw = stage.draw;
  const out3 = { dx: 0, dy: 0, run: false };
  stage.update = (dt, intent) => {
    if (!v.on) return baseUpdate(dt, intent);
    if (intent) me.playedAt = performance.now(); // the game is asking the player to walk: the mouse belongs to the view
    if (shooting) return baseUpdate(dt, intent ? { ...intent, dx: 0, dy: 0, run: false } : intent); // a cutscene shot: the player stands still, whoever set the shot
    if (intent && autoPlay()) {
      // auto-play steers by the isometric picture: leave its keys alone and look where it walks
      const res = baseUpdate(dt, intent);
      const p = stage.player;
      if (Math.hypot(p.vx, p.vy) > 0.3) {
        const want = Math.atan2(p.vy, p.vx) * 180 / Math.PI;
        camera.yaw = (camera.yaw + (((want - camera.yaw) % 360 + 540) % 360 - 180) * Math.min(1, dt * 4) + 360) % 360;
        if (v.mode === 'orbit') v.rig.set({ yaw: camera.yaw });
      }
      return res;
    }
    const inp = intent ?? STILL; // no intent (someone is talking): stand still
    // up is forward, right is a step to the right; the stage expects screen directions of its isometric
    // picture, so the ground direction is turned into the screen direction that means the same
    const [gx, gy] = walkDirection(camera.yaw, -(inp.dy || 0), inp.dx || 0);
    const size = Math.hypot(gx, gy);
    out3.dx = 0; out3.dy = 0; out3.run = !!inp.run;
    if (size > 1e-6) {
      const iso = baseView(); const p0 = iso.toCell(0, 0, 0); const px = iso.toCell(1, 0, 0); const py = iso.toCell(0, 1, 0);
      const sx = (px.col - p0.col) * gx + (py.col - p0.col) * gy; const sy = (px.row - p0.row) * gx + (py.row - p0.row) * gy;
      const l = Math.hypot(sx, sy) || 1;
      out3.dx = sx / l * size; out3.dy = sy / l * size;
    }
    const res = baseUpdate(dt, { ...inp, ...out3 });
    // in first person the body faces where the eyes look, so a swing or a throw goes that way (rigs face -y at yaw 0)
    const puppet = stage.player.actor?.puppet;
    if (v.mode === 'first' && puppet && stage.player.actor.state !== 'die') puppet.yaw = camera.yaw + 90;
    return res;
  };

  // The isometric camera stays as it was left while a 3D view is on: its turn and zoom keys and drags do nothing
  // then (the stage still eases and follows with it, and a load still puts it where the save says).
  for (const name of ['rotateSteps', 'zoomBy', 'turn']) {
    const cam = stage.camera; const was = cam?.[name];
    if (typeof was === 'function') cam[name] = (...a) => (v.on ? cam : was.apply(cam, a));
  }

  // ---- where a point is on the canvas ----
  /** Canvas point of a stage point `up` metres above the ground there (or at height z metres when given), for the 3D views. */
  function project(x, y, up = 0, z) {
    const shot = renderer.latest;
    if (!shot) return { x: -1e5, y: -1e5, visible: false };
    const b = cameraBasis(shot.eye, shot.cols, shot.rows); // the eye of the picture that is on screen
    const h = z === undefined ? src.groundAt(x, y) + up : z;
    const dx = x - b.eye[0]; const dy = y - b.eye[1]; const dz = h - b.eye[2];
    const depth = dx * b.F[0] + dy * b.F[1] + dz * b.F[2];
    if (depth < 0.2) return { x: -1e5, y: -1e5, visible: false }; // behind the eye: nowhere on the canvas
    const sx = b.cx + b.fx * (dx * b.R[0] + dy * b.R[1] + dz * b.R[2]) / depth; const sy = b.cy - b.fy * (dx * b.U[0] + dy * b.U[1] + dz * b.U[2]) / depth;
    const p = { x: sx / b.w * W, y: sy / b.h * H, depth, visible: true }; // depth: metres from the eye along its look direction
    p.visible = p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
    return p;
  }
  // The stage's own view: a game that still asks it with view.toPoint (ground point in the view's own
  // coordinates, height in sixteenths) gets the answer for the view that is showing.
  const viewGetter = Object.getOwnPropertyDescriptor(stage, 'view')?.get;
  const baseView = () => (viewGetter ? viewGetter.call(stage) : stage.view);
  const faces = new WeakMap();
  if (viewGetter) {
    const pageOrigin = () => (stage.page ? [stage.page.ox, stage.page.oy] : [0, 0]);
    Object.defineProperty(stage, 'view', {
      configurable: true, enumerable: true,
      get() {
        const base = viewGetter.call(stage);
        if (!v.on) return base;
        if (!faces.has(base)) faces.set(base, Object.assign(Object.create(base), { toPoint: (x, y, _rect, z) => { const [ox, oy] = pageOrigin(); return project(x + ox, y + oy, 0, z === undefined ? undefined : z / 16); } }));
        return faces.get(base);
      },
    });
  }
  const baseToScreen = typeof stage.toScreen === 'function' ? stage.toScreen.bind(stage) : (x, y, h = 0) => { const iso = baseView(); const p = iso.toPoint(x, y, stage.rect, iso.heightAt(x, y) + h * 16); return { x: p.x, y: p.y }; };
  /**
   * True when scenery in the 3D picture on screen is nearer than a point (so effects and markers can hide behind
   * houses and trees). `point` is what stage.toScreen returned for it; `bias` metres it may sit behind a surface and
   * still show. In the isometric view the stage's own answer is given (false when it has none).
   */
  const baseOccluded = typeof stage.occluded === 'function' ? stage.occluded.bind(stage) : () => false;
  stage.occluded = (x, y, h, point, bias = 0.15) => {
    if (!v.on) return baseOccluded(x, y, h, point);
    const shot = renderer.latest;
    if (!shot || !shot.depth || !point || !(point.depth > 0)) return false;
    const col = Math.floor(point.x / W * shot.cols); const row = Math.floor(point.y / H * shot.rows);
    if (col < 0 || row < 0 || col >= shot.cols || row >= shot.rows) return false;
    const d = shot.depth[row * shot.cols + col];
    return d > 0 && d < point.depth - bias; // sky (Infinity) hides nothing
  };
  /** Canvas point { x, y, depth, visible } of a stage point, h metres above the ground there, in whichever view is showing (depth only in the 3D views). */
  stage.toScreen = (x, y, h = 0) => (v.on ? project(x, y, h) : { visible: true, ...baseToScreen(x, y, h) });

  // The hour, when the demo has a sky engine (stage.sky, or the game's shared.sky): the parts of its sample the
  // 3D views are lit by, copied as plain numbers so they can be posted to the worker.
  function skySample() {
    const g = game();
    const sky = stage.sky ?? g?.sky;
    // with a weather engine the sky is asked through it (clouds dim the sun, a storm darkens the day)
    const n = (typeof g?.skyNow === 'function' ? g.skyNow() : null) ?? sky?.now;
    if (!n || !n.light || !n.fill) return null;
    return { light: { dir: [...n.light.dir], color: [...n.light.color], power: n.light.power }, fill: { color: [...n.fill.color], power: n.fill.power }, skyTop: [...n.skyTop], skyBottom: [...n.skyBottom], fogColor: [...n.fogColor], stars: n.stars, lamps: n.lamps };
  }
  /** The weather for a request, when the demo has a weather engine: its sample, how bright drops are, and the effects setting. */
  function weatherParts(req) {
    const g = game();
    const w = (stage.weather ?? g?.weather)?.now;
    if (!w || !w.wind) return;
    req.weather = w;
    req.weatherAmount = typeof g?.weatherAmount === 'number' ? g.weatherAmount : 1;
    // as bright as the weather engine's precipLight makes them: 0.12 on a dark night to 1 by day
    const s = req.sky;
    req.weatherLight = s ? Math.min(1, Math.max(0.12, 0.12 + 0.75 * s.fill.power + 0.3 * s.light.power)) : 1;
  }
  // ---- the stage's draw: ask for the next picture, show the newest one ----
  function draw3d() {
    const t0 = performance.now();
    const dtFrame = Math.min(0.1, Math.max(0, (t0 - (v.rigAt || t0)) / 1000));
    // a cutscene shot: its own eased camera, starting from what the view shows and ending there again
    const sh = shotOf();
    if (sh) {
      // The events engine may say more than the point, the side and the zoom: pitch (degrees down from level, 89 is
      // straight down), distance (metres to the eye) and height (metres above the ground of the point looked at).
      // Null leaves each to the view. The camera engine's orbitFromShot and shotFromOrbit turn the pitch into the
      // rig's terms (negative looks down) and back.
      let goal; let height;
      shotPov = sh.pov !== null && sh.pov !== undefined && sh.pov !== false;
      if (shotPov) {
        // Through an actor's eyes: the shot's point follows the actor, yaw and pitch are where they look (null: the
        // way they face, and level). The camera closes in on the actor's eyes from behind the head and ends up in
        // them; the actor's own body is left out once the camera is inside it, and comes back on the way out.
        let yaw = given(sh.yaw) ? sh.yaw + 90 : camera.yaw;
        // who it is: by the id when the game can say where that actor stands, else whoever is at the shot's point
        const at = povPlace(sh.pov) ?? sh;
        if (!given(sh.yaw)) { const who = nearest(at.x, at.y, 0.8); if (who) yaw = who.puppet.yaw - 90; }
        goal = { x: sh.x + (sh.shakeX ?? 0), y: sh.y + (sh.shakeY ?? 0), yaw: ((yaw % 360) + 360) % 360, pitch: given(sh.pitch) ? -Math.min(89, Math.max(-89, sh.pitch)) : 0, distance: 0.05 }; // a look direction in the shot's terms (degrees down), set on the rig (negative looks down)
        height = EYE;
      } else {
        goal = orbitFromShot({ x: sh.x, y: sh.y, zoom: sh.zoom, yaw: sh.yaw, pitch: given(sh.pitch) ? Math.min(89, Math.max(-89, sh.pitch)) : null, distance: given(sh.distance) && sh.distance > 0 ? Math.max(0.5, sh.distance) : null, height: given(sh.height) ? sh.height : null, shakeX: sh.shakeX, shakeY: sh.shakeY }, { yaw: camera.yaw, pitch: v.mode === 'orbit' ? v.rig.pitch : -32, height: HEAD });
        height = goal.height ?? HEAD;
      }
      // the height looked at moves over with the camera, so going into and out of someone's eyes does not jump
      if (shooting) height = shotAt.h + (height - shotAt.h) * Math.min(1, dtFrame * 6);
      if (!shooting) { // begin where the view is: the orbit rig as it stands, or just behind the eyes
        shooting = true; v.look.unlock();
        if (v.mode === 'orbit') shotRig.set({ yaw: v.rig.yaw, pitch: v.rig.pitch, distance: v.rig.distance }); else shotRig.set({ yaw: camera.yaw, pitch: -8, distance: 2 });
      }
      shotRig.goTo({ yaw: goal.yaw, pitch: goal.pitch, distance: goal.distance });
      shotRig.update(dtFrame);
      shotAt = { x: goal.x, y: goal.y, h: height };
    } else if (shooting) { // released: the orbit view carries on from where the shot ended, first person cuts to the eyes
      shooting = false; reset = true;
      if (v.mode === 'orbit') { v.rig.set({ yaw: shotRig.yaw, pitch: shotRig.pitch, distance: shotRig.distance }); camera.yaw = v.rig.yaw; camera.pitch = v.rig.pitch; }
    }
    // the orbit rig eases once per drawn frame (not per game tick), so turns and zooms are as smooth as the screen
    if (v.mode === 'orbit' && !shooting) { v.rig.update(dtFrame); camera.yaw = v.rig.yaw; camera.pitch = v.rig.pitch; v.orbitDist = v.rig.distance; }
    v.rigAt = t0;
    W = stage.width; H = stage.height;
    if (!renderer.busy) {
      const p = src.player();
      const things = [];
      // what this picture is drawn with: the view's own camera, or the shot's
      const eff = shooting ? { mode: 'orbit', yaw: shotRig.yaw, pitch: shotRig.pitch, dist: shotRig.distance, target: shotAt } : { mode: v.mode, yaw: camera.yaw, pitch: camera.pitch, dist: v.orbitDist, target: null };
      const fwdX = Math.cos(eff.yaw * Math.PI / 180); const fwdY = Math.sin(eff.yaw * Math.PI / 180);
      const back = eff.mode === 'orbit' ? eff.dist + 4 + (eff.target ? Math.hypot(eff.target.x - p.x, eff.target.y - p.y) : 0) : 3;
      for (const c of src.things()) {
        const dx = c.x - p.x; const dy = c.y - p.y;
        if (dx * dx + dy * dy > 100 * 100) continue;
        // shapes are only sent for what can be in the picture; the rest still throws its shadow
        // in a shot the hero's own body shows; looking through someone's eyes, their body does not
        const inHead = shooting && shotPov && shotRig.distance < 0.9 && Math.hypot(c.x - shotAt.x, c.y - shotAt.y) < 0.45;
        const seen = !(c.me && eff.mode === 'first') && !inHead && dx * fwdX + dy * fwdY > -back;
        things.push({ x: c.x, y: c.y, z: c.z, r: c.r, person: c.person, me: c.me, shapes: seen ? c.puppet.shapes() : null });
      }
      const req = { W, H, detail: v.detail, cellPx: o.cellPx ?? null, mode: eff.mode, yaw: eff.yaw, pitch: eff.pitch, fov: shooting ? 90 : camera.fov, orbitDist: eff.dist, target: eff.target, time: t0 / 1000, reset, player: { x: p.x, y: p.y }, things, sky: skySample() };
      weatherParts(req);
      renderer.request(req);
      reset = false;
    }
    const shot = renderer.latest;
    if (!shot) { baseDraw(); return; } // the first picture is still being drawn: the isometric one stays for a moment
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(shot.picture, 0, 0, W, H);
    ctx.imageSmoothingEnabled = smooth;
    if (v.mode === 'first' && !shooting) { // a small cross in the middle, to aim swings and throws
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(W / 2 - 5, H / 2 - 1, 10, 2); ctx.fillRect(W / 2 - 1, H / 2 - 5, 2, 10);
    }
    const t1 = performance.now();
    const k = timing.frames < 20 ? 0.5 : 0.05;
    timing.page += (t1 - t0 - timing.page) * k; timing.picture += (shot.ms - timing.picture) * k;
    timing.total = timing.page; timing.render = timing.picture;
    timing.worst = Math.max(timing.worst * 0.995, t1 - t0); timing.frames++;
    if (stats && t1 - shownSince > 250) {
      shownSince = t1;
      stats.textContent = `${v.mode === 'orbit' ? 'orbit view' : 'first person'}, ${src.name}, ${shot.cols} x ${shot.rows} characters, ${timing.page.toFixed(1)} ms a frame on the page${renderer.inWorker ? `, pictures drawn in the background in ${timing.picture.toFixed(1)} ms` : ' (drawn on the page: no worker)'}, ${shot.stats.solids} characters and props in view`;
    }
  }
  stage.draw = () => { v.active = me; return v.on ? draw3d() : baseDraw(); };

  const api = {
    /** The views, in the order V steps through them. */
    modes: ['iso', 'first', 'orbit'],
    /** Switch to a view by name ('iso', 'first' or 'orbit'). Returns the view now showing. */
    setMode(name) { v.toggle(name); return v.mode; },
    /** Call fn(mode) whenever the view changes. Returns a function that stops it. */
    onChange(fn) { v.listeners.push(fn); return () => { const i = v.listeners.indexOf(fn); if (i >= 0) v.listeners.splice(i, 1); }; },
    /** The switch button this file adds to the page; hide it (button.hidden = true) when the game has its own. */
    button: v.button,
    get orbitDistance() { return v.orbitDist; }, set orbitDistance(d) { v.rig.set({ distance: Number(d) || v.orbitDist }); v.orbitDist = v.rig.distance; },
    get on() { return v.on; }, get mode() { return v.mode; }, toggle: v.toggle, camera, look: v.look, timing, source: src, renderer,
    /**
     * Give the cutscene shot to draw ({ active, x, y, zoom, yaw | null, pitch?, height?, distance?, shakeX, shakeY }), or null for none.
     * pitch: degrees down from level; height: metres above the ground of the point looked at; distance: metres to the
     * eye. Each may be null: the view then decides (its own tilt, a person's head, 9 metres over the zoom).
     * pov (an actor's id): the shot looks through the eyes of whoever stands at its point; yaw and pitch are where they
     * look (null: the way they face, and level), and their own body is not drawn. Without a
     * call the stage's own stage.shot is read every drawn frame; setShot(undefined) goes back to that.
     */
    setShot(shot) { givenShot = shot; },
    /**
     * Tell the view how to find an actor by the id a pov shot names: fn(id) -> its body (or anything with x and y in
     * stage coordinates), or null. Without one the game's shared.actorOf is asked, and failing that the actor is
     * whoever stands at the shot's point.
     */
    setActorResolver(fn) { if (fn !== null && typeof fn !== 'function') throw new Error('firstPerson.setActorResolver: expected a function (id) => body, or null'); actorOf = fn; },
    /** True while a cutscene shot is being drawn. */
    get shooting() { return shooting; },
    /**
     * The shot that frames what the 3D view shows now, for a cutscene to start from and ease back to: in the orbit
     * view the hero with the camera's yaw and distance, in first person the hero with the look direction at 2 m.
     * It carries pitch, height and distance too, so a cutscene can ease all of them. Null in the isometric view (its own camera answers there).
     */
    shotNow() {
      if (!v.on) return null;
      // with everything a 3D shot can carry, in the events engine's terms: pitch in degrees down, height in metres
      // above the ground of the point looked at, distance in metres to the eye
      const full = (point, rig) => shotFromOrbit({ x: point.x, y: point.y, height: point.h ?? HEAD }, rig);
      if (shooting) return full(shotAt, { yaw: shotRig.yaw, distance: shotRig.distance, pitch: shotRig.pitch });
      const p = src.player();
      return full({ x: p.x, y: p.y }, v.mode === 'orbit' ? { yaw: v.rig.yaw, distance: v.rig.distance, pitch: v.rig.pitch } : { yaw: camera.yaw, distance: 2, pitch: -8 });
    },
    /** The eye of the picture on screen ({ x, y, z, yaw, pitch, fov } in stage coordinates), or null before the first one. */
    get eye() { return renderer.latest?.eye ?? null; },
    /** Distances of the picture on screen, for a depth mask: { data (Float32Array, cols * rows, top row first, Infinity = sky), cols, rows, rect }, or null. */
    get depth() { const s = renderer.latest; return s?.depth ? { data: s.depth, cols: s.cols, rows: s.rows, rect: { x: 0, y: 0, w: W, h: H } } : null; },
    /** Counts from the picture on screen: { triangles, shapes, blades, solids }, plus how many worlds were built and how long the last took. */
    get stats() { const s = renderer.latest; return s ? { ...s.stats, cols: s.cols, rows: s.rows, built: s.built, buildMs: s.buildMs, inWorker: renderer.inWorker } : null; },
  };
  // the game on top of the stage switches views through the stage
  stage.firstPerson = api;
  stage.viewModes = api.modes; stage.setViewMode = api.setMode; stage.onViewMode = api.onChange;
  /** How fine the 3D views are drawn: 2 (coarse and cheapest), 3 (usual) or 5 (fine); other numbers from 1 to 6 work too. Returns the detail now set. */
  stage.setViewDetail = (n) => { if (!(Number.isFinite(n) && n >= 1 && n <= 6)) throw new Error(`stage.setViewDetail: expected a number from 1 to 6 (2 coarse, 3 usual, 5 fine), got ${n}`); v.detail = n; return v.detail; };
  Object.defineProperty(stage, 'viewDetail', { configurable: true, enumerable: true, get: () => v.detail });
  Object.defineProperty(stage, 'viewMode', { configurable: true, enumerable: true, get: () => v.mode, set: (m) => { v.toggle(m); } });
  if (v.on) me.enter();
  return api;
}

// The page loads this file next to main.js: wait for the hamlet stage and add the views to it, then
// do the same for the open world stage when the game first makes it (shared.world in game/world.js).
if (typeof window !== 'undefined' && !window.firstPerson) {
  window.firstPerson = (async () => {
    while (!window.demo) await new Promise((r) => setTimeout(r, 50));
    const fp = await attachFirstPerson(window.demo);
    window.firstPerson = fp;
    const q = new URLSearchParams(location.search);
    if (q.has('fp')) fp.toggle('first'); else if (q.has('orbit')) fp.toggle('orbit'); // ?fp opens in first person, ?orbit in the orbit view
    setInterval(() => {
      const ws = window.showcase?.shared?.world;
      if (ws && !ws.firstPerson && !ws.attachingViews) { ws.attachingViews = true; attachFirstPerson(ws).catch((e) => console.warn('first-person views are not available in the open world:', e.message)); }
    }, 500);
    return fp;
  })();
}
