// A tiny stand-in for core's input object, so this demo runs without core.
// In a real game use core's input instead; the UI kit only needs
// pressed(name), down(name) and pointer.

const KEYS = {
  ArrowUp: ['up'], w: ['up'], ArrowDown: ['down'], s: ['down'],
  ArrowLeft: ['left'], a: ['left'], ArrowRight: ['right'], d: ['right'],
  Enter: ['confirm'], ' ': ['confirm'], Escape: ['cancel', 'pause'], p: ['pause'],
};

export function createMiniInput(target, canvas) {
  const held = new Set();
  let pressedNow = new Set();
  const pointer = { x: -1, y: -1, down: false, pressed: false, released: false };

  target.addEventListener('keydown', (e) => {
    const names = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!names) return;
    e.preventDefault();
    for (const n of names) {
      if (!held.has(n)) pressedNow.add(n);
      held.add(n);
    }
  });
  target.addEventListener('keyup', (e) => {
    const names = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    for (const n of names || []) held.delete(n);
  });
  function place(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - r.left) * (canvas.width / r.width);
    pointer.y = (e.clientY - r.top) * (canvas.height / r.height);
  }
  canvas.addEventListener('pointerdown', (e) => { place(e); pointer.down = true; pointer.pressed = true; });
  canvas.addEventListener('pointermove', place);
  target.addEventListener('pointerup', (e) => { place(e); pointer.down = false; pointer.released = true; });
  target.addEventListener('pointercancel', () => { pointer.down = false; pointer.released = true; });

  return {
    pointer,
    down: (name) => held.has(name),
    pressed: (name) => pressedNow.has(name),
    /** Call at the end of every update. */
    endFrame() {
      pressedNow = new Set();
      pointer.pressed = false;
      pointer.released = false;
    },
  };
}
