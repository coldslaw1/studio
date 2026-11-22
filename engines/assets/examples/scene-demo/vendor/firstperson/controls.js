// Mouse look with pointer lock: while the pointer is locked to the canvas, moving the mouse turns
// the camera. Walking stays with the game (see walkDirection); this only owns the look direction.

/**
 * @param {object} camera   From createFpCamera; its yaw and pitch are changed.
 * @param {object} element  The canvas to lock the pointer to.
 * @param {object} [o]
 * @param {number} [o.sensitivity]  Degrees per pixel of mouse travel (default 0.12).
 * @param {number} [o.pitchLimit]   Furthest up or down, in degrees (default 85).
 * @param {object} [o.document]     Default: the element's own document.
 * @param {() => boolean} [o.enabled]     Asked on every mouse move: false leaves the camera alone (a menu or a cutscene is up).
 * @param {(locked:boolean) => void} [o.onChange]  Called when the lock starts or ends (Esc ends it).
 * @returns {{locked:boolean, lock:Function, unlock:Function, turn:Function, detach:Function}}
 */
export function createMouseLook(camera, element, o = {}) {
  if (!camera || !Number.isFinite(camera.yaw) || !Number.isFinite(camera.pitch)) throw new Error('createMouseLook: "camera" must have yaw and pitch numbers');
  if (!element || typeof element.addEventListener !== 'function') throw new Error('createMouseLook: "element" must be the canvas to lock the pointer to');
  const doc = o.document ?? element.ownerDocument;
  const sensitivity = o.sensitivity ?? 0.12;
  const limit = o.pitchLimit ?? 85;
  const look = {
    /** True while the pointer is locked and the mouse turns the camera. */
    get locked() { return doc.pointerLockElement === element; },
    /** Ask the browser to lock the pointer. Must be called from a key press or click. */
    lock() {
      if (look.locked) return;
      try { const p = element.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* refused: the mouse simply stays free */ }
    },
    unlock() { if (look.locked) doc.exitPointerLock?.(); },
    /** Turn by a mouse movement in pixels (right and down are positive). */
    turn(dx, dy) {
      camera.yaw = ((camera.yaw - dx * sensitivity) % 360 + 360) % 360;
      camera.pitch = Math.min(limit, Math.max(-limit, camera.pitch - dy * sensitivity));
    },
    detach() { doc.removeEventListener('mousemove', onMove); doc.removeEventListener('pointerlockchange', onLock); look.unlock(); },
  };
  const onMove = (e) => { if (look.locked && (!o.enabled || o.enabled())) look.turn(e.movementX || 0, e.movementY || 0); };
  const onLock = () => o.onChange?.(look.locked);
  doc.addEventListener('mousemove', onMove);
  doc.addEventListener('pointerlockchange', onLock);
  return look;
}
