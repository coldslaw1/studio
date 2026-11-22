// Screen shake and screen flash. Both are numbers only: the game (or the base plugin) asks for the
// offset and the flash strength when it draws. Reduced motion switches the shake off and softens the flash.

/**
 * createShake(options) -> shake
 *   options.maxPx   how far a full-strength shake moves the picture, in pixels. Default 10.
 *   options.snap    offsets are rounded to whole steps of this many pixels (set it to the cell size
 *                   and the picture jumps by whole characters). Default 1.
 * shake:
 *   add(amount, seconds)   amount 0..1. A weaker shake never cuts a stronger one short.
 *   kick(dx, dy, seconds)  a shake that starts in a direction (a hit from the left pushes right)
 *   flash(color, seconds, strength)   colour '#rrggbb', strength 0..1 (default 0.6)
 *   update(dt)
 *   x, y        the offset now, in pixels        active    true while there is any offset
 *   flashColor, flashAlpha   what to lay over the picture now (alpha 0 = nothing)
 *   strength    0..1 multiplier from the player's setting      reduced   reduced motion on or off
 *   clear()
 */
export function createShake(options = {}) {
  const maxPx = options.maxPx ?? 10; const snap = options.snap ?? 1;
  if (!(maxPx >= 0)) throw new Error(`createFx: shake.maxPx must be 0 or more, got ${maxPx}`);
  if (!(snap >= 1)) throw new Error(`createFx: shake.snap must be 1 or more, got ${snap}`);
  let power = 0; let left = 0; let total = 1; let t = 0; let t0 = 0; let kx = 0; let ky = 0;
  let fColor = '#ffffff'; let fLeft = 0; let fTotal = 1; let fPeak = 0;
  const shake = {
    strength: 1, reduced: false, maxPx, snap, x: 0, y: 0, flashColor: '#ffffff', flashAlpha: 0,
    get active() { return shake.x !== 0 || shake.y !== 0; },
    get level() { return left > 0 ? power * (left / total) ** 2 : 0; },
    add(amount, seconds = 0.3) {
      if (!(amount >= 0) || !(seconds > 0)) throw new Error(`fx.shake: amount must be 0 or more and seconds above 0, got ${amount}, ${seconds}`);
      const a = Math.min(1, amount);
      if (a >= shake.level) { power = a; left = total = seconds; kx = ky = 0; }
    },
    kick(dx, dy, seconds = 0.2) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || !(seconds > 0)) throw new Error(`fx.kick: dx, dy must be numbers and seconds above 0, got ${dx}, ${dy}, ${seconds}`);
      const a = Math.min(1, Math.hypot(dx, dy));
      if (a === 0 || a < shake.level) return;
      power = a; left = total = seconds; t0 = t; kx = dx / Math.hypot(dx, dy); ky = dy / Math.hypot(dx, dy);
    },
    flash(color = '#ffffff', seconds = 0.12, strength = 0.6) {
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) throw new Error(`fx.flash: color must be '#rgb' or '#rrggbb', got ${JSON.stringify(color)}`);
      if (!(seconds > 0) || !(strength >= 0)) throw new Error(`fx.flash: seconds must be above 0 and strength 0 or more, got ${seconds}, ${strength}`);
      fColor = color; fLeft = fTotal = seconds; fPeak = Math.min(1, strength);
    },
    update(dt) {
      t += dt;
      if (left > 0) left = Math.max(0, left - dt);
      const level = shake.reduced ? 0 : shake.level * shake.strength * maxPx;
      let x = 0; let y = 0;
      if (level > 0) {
        if (kx || ky) { const swing = Math.cos((t - t0) * 55); x = kx * level * swing; y = ky * level * swing; } else {
          x = level * (Math.sin(t * 61.3) + Math.sin(t * 37.9 + 1.3)) / 2;
          y = level * (Math.sin(t * 53.1 + 2.1) + Math.sin(t * 43.7 + 0.4)) / 2;
        }
      }
      shake.x = Math.round(x / snap) * snap || 0; shake.y = Math.round(y / snap) * snap || 0;
      if (fLeft > 0) fLeft = Math.max(0, fLeft - dt);
      shake.flashColor = fColor;
      shake.flashAlpha = fLeft > 0 ? fPeak * (fLeft / fTotal) * (shake.reduced ? 0.25 : 1) : 0;
    },
    clear() { power = left = fLeft = 0; shake.x = shake.y = 0; shake.flashAlpha = 0; },
  };
  return shake;
}
