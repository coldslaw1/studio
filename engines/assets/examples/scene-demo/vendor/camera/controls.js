// Ways to steer a camera: from core's input actions, and from the mouse on a canvas.
// The canvas (or any event target) is handed in, so nothing here touches the page by itself.

/**
 * Read camera actions from core's input object. Call once per update.
 * Action names (bind them in the game's input map): camera-left, camera-right, zoom-in, zoom-out.
 * A tap turns one step; holding the key keeps turning, one eased step running into the next, and it
 * comes to rest on a step when the key is let go. Works the same for a createOrbitRig.
 * @param {object} camera  From createCamera or createOrbitRig.
 * @param {{pressed:(name:string) => boolean, down?:(name:string) => boolean}} input  Core's input object.
 * @param {{left?:string, right?:string, zoomIn?:string, zoomOut?:string}} [names]  Other action names.
 */
export function updateCameraInput(camera, input, names = {}) {
  if (!input || typeof input.pressed !== 'function') throw new Error('updateCameraInput: "input" must be core\'s input object (with pressed(name))');
  for (const [name, way] of [[names.left ?? 'camera-left', -1], [names.right ?? 'camera-right', 1]]) {
    if (input.pressed(name)) camera.rotateSteps(way);
    else if (holdTurn(camera, typeof input.down === 'function' && input.down(name))) camera.rotateSteps(way);
  }
  if (input.pressed(names.zoomIn ?? 'zoom-in')) camera.zoomBy(1);
  if (input.pressed(names.zoomOut ?? 'zoom-out')) camera.zoomBy(-1);
}

/**
 * True when a held turn key should start the next step: the last step is more than half done, so
 * the turn keeps its speed instead of stopping and starting. Use it with key-repeat events too.
 * @param {object} camera  From createCamera or createOrbitRig.
 * @param {boolean} held   Whether the key is still down.
 */
export function holdTurn(camera, held) {
  return Boolean(held) && camera.turnLeft < Math.abs(camera.yawStep ?? 45) / 2;
}

/**
 * Mouse and touch control on a canvas. The wheel zooms one step per notch (a trackpad's stream of
 * small scrolls is added up, so it does not race through every zoom level). Dragging sideways turns
 * the camera; when the button is let go it eases onto an allowed angle, carrying on in the direction
 * of the drag. A press only becomes a drag after it has moved `threshold` pixels, so plain clicks
 * are left for the game. The drag keeps working when the pointer leaves the canvas (pointer
 * capture) and ends cleanly if the button is released elsewhere or the capture is lost. The right
 * button's menu is switched off on the element while it is one of the drag buttons.
 * @param {object} camera   From createCamera.
 * @param {object} element  The canvas (anything with addEventListener / removeEventListener).
 * @param {object} [opts]
 * @param {boolean} [opts.wheel]  Wheel zooms (default true).
 * @param {'any'|'held'|'plain'} [opts.wheelKeys]  Which wheel turns zoom: 'any' (default), 'held' (only with Shift or Ctrl held, when the plain wheel belongs to the game), 'plain' (only without). A browser reports a Shift + wheel as a sideways scroll; that is read as a wheel too.
 * @param {boolean} [opts.drag]   Dragging turns (default true).
 * @param {number[]} [opts.buttons]  Mouse buttons that drag: 0 left, 1 middle, 2 right (default all three). Touch and pen always count as 0.
 * @param {number} [opts.threshold]  Pixels a press must move before it turns the camera (default 5).
 * @param {number} [opts.degreesPerPixel]  How far a drag turns (default 0.4; negative turns the other way).
 * @param {number} [opts.wheelSteps]  Zoom steps per wheel notch (default 1; negative reverses the wheel).
 * @param {() => boolean} [opts.enabled]  Called on every wheel and press; return false to ignore it (a menu is open, another mode owns the canvas). A drag already under way ends normally.
 * @param {number} [opts.lean]  On release, how far past the drag the camera looks for its resting angle, as a share of the gap between allowed angles (default 0.35; 0 = plain nearest).
 * @returns {(() => void) & {dragging: () => boolean}}  Call it to remove the listeners; `.dragging()` tells whether a drag is turning the camera now (so the game can ignore that pointer).
 */
export function attachCameraMouse(camera, element, opts = {}) {
  if (!element || typeof element.addEventListener !== 'function') throw new Error('attachCameraMouse: "element" must be a canvas or another event target');
  const perPixel = opts.degreesPerPixel ?? 0.4;
  const wheelSteps = opts.wheelSteps ?? 1;
  const buttons = opts.buttons ?? [0, 1, 2];
  const threshold = opts.threshold ?? 5;
  const lean = opts.lean ?? 0.35;
  const wheelKeys = opts.wheelKeys ?? 'any';
  if (!['any', 'held', 'plain'].includes(wheelKeys)) throw new Error(`attachCameraMouse: "wheelKeys" must be 'any', 'held' or 'plain', got ${opts.wheelKeys}`);
  const enabled = opts.enabled ?? (() => true);
  if (typeof enabled !== 'function') throw new Error('attachCameraMouse: "enabled" must be a function returning true or false');
  if (!Array.isArray(buttons) || buttons.some((b) => ![0, 1, 2].includes(b))) throw new Error(`attachCameraMouse: "buttons" must list 0, 1 or 2, got ${JSON.stringify(opts.buttons)}`);
  if (!(threshold >= 0)) throw new Error(`attachCameraMouse: "threshold" must be 0 or more pixels, got ${opts.threshold}`);
  const NOTCH = 100; // wheel distance of one mouse-wheel notch, in pixels
  let drag = null; // { id, startX, lastX, turning, direction }
  let wheelSum = 0;
  let wheelAt = -Infinity;
  const handlers = [];
  const on = (type, fn, options) => { element.addEventListener(type, fn, options); handlers.push([type, fn, options]); };

  if (opts.wheel ?? true) {
    on('wheel', (e) => {
      // Shift + wheel arrives as a sideways scroll (deltaX) in Chrome and Edge on Windows and Linux
      const raw = e.deltaY || (e.shiftKey ? e.deltaX : 0);
      const held = Boolean(e.shiftKey || e.ctrlKey);
      if (!raw || !enabled() || (wheelKeys === 'held' && !held) || (wheelKeys === 'plain' && held)) return;
      e.preventDefault?.();
      // deltaMode 1 = lines, 2 = pages; bring everything to pixels
      const delta = raw * (e.deltaMode === 1 ? NOTCH / 3 : e.deltaMode === 2 ? NOTCH : 1);
      const at = e.timeStamp ?? 0;
      if (at - wheelAt > 250 || Math.sign(delta) !== Math.sign(wheelSum)) wheelSum = 0; // a new scroll, or a change of direction
      wheelAt = at;
      wheelSum += delta;
      // the first movement of a scroll counts at once; after that one step per notch of distance
      const steps = wheelSum === delta ? Math.sign(delta) : Math.trunc(wheelSum / NOTCH) - Math.trunc((wheelSum - delta) / NOTCH);
      if (steps) camera.zoomBy(-steps * wheelSteps);
    }, { passive: false });
  }

  if (opts.drag ?? true) {
    const finish = (settle) => {
      if (!drag) return;
      const { id, turning, direction } = drag;
      drag = null;
      try { element.releasePointerCapture?.(id); } catch { /* it was already released */ }
      if (turning && settle) camera.settle(direction * lean * (camera.yawSpacing ?? 0));
    };
    on('pointerdown', (e) => {
      if (drag || !enabled()) return; // one drag at a time; a second finger or button is ignored
      const button = e.pointerType && e.pointerType !== 'mouse' ? 0 : (e.button ?? 0);
      if (!buttons.includes(button)) return;
      drag = { id: e.pointerId, startX: e.clientX, lastX: e.clientX, turning: false, direction: 0 };
      try { element.setPointerCapture?.(e.pointerId); } catch { /* not capturable: the drag still works over the canvas */ }
    });
    on('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) { finish(true); return; } // the release was missed
      if (!drag.turning) {
        if (Math.abs(e.clientX - drag.startX) < threshold) return;
        drag.turning = true;
        drag.lastX = drag.startX + Math.sign(e.clientX - drag.startX) * threshold; // no jump when the drag begins
      }
      const dx = e.clientX - drag.lastX;
      drag.lastX = e.clientX;
      if (!dx) return;
      const degrees = dx * perPixel;
      drag.direction = Math.sign(degrees);
      camera.turn(degrees);
      e.preventDefault?.();
    });
    on('pointerup', (e) => { if (drag && e.pointerId === drag.id) finish(true); });
    on('pointercancel', (e) => { if (drag && e.pointerId === drag.id) finish(true); });
    on('lostpointercapture', (e) => { if (drag && e.pointerId === drag.id) finish(true); });
    if (buttons.includes(2)) on('contextmenu', (e) => { e.preventDefault?.(); });
    // a drag must not select text or start the browser's own image drag
    on('dragstart', (e) => { e.preventDefault?.(); });
    if (element.style && !element.style.touchAction) element.style.touchAction = 'none'; // touch drags reach us instead of scrolling the page
  }
  const detach = () => {
    if (drag) { const { turning } = drag; drag = null; if (turning) camera.settle(); }
    for (const [type, fn, options] of handlers) element.removeEventListener(type, fn, options);
  };
  detach.dragging = () => Boolean(drag?.turning);
  return detach;
}
