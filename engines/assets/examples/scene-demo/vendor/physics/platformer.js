// A ready-made platformer character that walks and jumps on a tile map.
import { moveRect } from './tilemap.js';

const DEFAULTS = {
  speed: 200, // top run speed, pixels per second
  accel: 1800, // how fast it reaches top speed on the ground
  airAccel: 1000, // same, in the air
  gravity: 1800, // pixels per second squared
  jumpSpeed: 620, // upward speed at the start of a jump
  maxFall: 900, // fastest falling speed
  coyoteTime: 0.1, // seconds after walking off a ledge when a jump still works
  jumpBuffer: 0.1, // seconds a jump press is remembered before landing
  jumpCut: 0.45, // releasing jump early keeps this share of the upward speed
};

/**
 * Create a platformer character.
 * @param {object} options { x, y, w, h } (x,y = top-left) plus any of: speed, accel, airAccel,
 *   gravity, jumpSpeed, maxFall, coyoteTime, jumpBuffer, jumpCut
 * @returns {object} character with x, y, w, h, vx, vy, onGround, hitWall, hitCeiling, jumped, facing
 */
export function createPlatformer(options) {
  const o = options || {};
  for (const k of ['x', 'y', 'w', 'h']) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) {
      throw new Error(`createPlatformer: ${k} must be a number, got ${o[k]}`);
    }
  }
  if (!(o.w > 0 && o.h > 0)) throw new Error('createPlatformer: w and h must be > 0');
  return {
    ...DEFAULTS, ...o,
    vx: 0, vy: 0, onGround: false, hitWall: false, hitCeiling: false, jumped: false, facing: 1,
    coyoteLeft: 0, bufferLeft: 0, jumpHeld: false,
  };
}

function approach(v, target, amount) {
  return v < target ? Math.min(v + amount, target) : Math.max(v - amount, target);
}

/**
 * Move the character for one step.
 * @param {object} p      from createPlatformer
 * @param {object} map    from createTileMap
 * @param {object} input  { moveX: -1..1, jump: boolean (held), down: boolean (drop through one-way platforms) }
 * @param {number} dt     seconds
 * @returns {object} p, with onGround, hitWall, hitCeiling and jumped updated (jumped is true only on the step a jump starts)
 */
export function updatePlatformer(p, map, input, dt) {
  if (typeof dt !== 'number' || !(dt > 0)) throw new Error(`updatePlatformer: dt must be a number > 0 (seconds), got ${dt}`);
  const moveX = Math.max(-1, Math.min(1, Number(input && input.moveX) || 0));
  const jump = !!(input && input.jump);
  if (moveX !== 0) p.facing = moveX < 0 ? -1 : 1;
  p.vx = approach(p.vx, moveX * p.speed, (p.onGround ? p.accel : p.airAccel) * dt);

  p.coyoteLeft = p.onGround ? p.coyoteTime : p.coyoteLeft - dt;
  p.bufferLeft = jump && !p.jumpHeld ? p.jumpBuffer : p.bufferLeft - dt;
  p.jumpHeld = jump;
  p.jumped = false;
  if (p.bufferLeft > 0 && p.coyoteLeft > 0) {
    p.vy = -p.jumpSpeed;
    p.bufferLeft = 0;
    p.coyoteLeft = 0;
    p.jumped = true;
  }
  if (!jump && p.vy < -p.jumpSpeed * p.jumpCut) p.vy = -p.jumpSpeed * p.jumpCut;
  p.vy = Math.min(p.vy + p.gravity * dt, p.maxFall);

  const hit = moveRect(map, p, p.vx * dt, p.vy * dt, { dropThrough: !!(input && input.down) });
  p.onGround = hit.hitDown;
  p.hitCeiling = hit.hitUp;
  p.hitWall = hit.hitLeft || hit.hitRight;
  if (hit.hitDown || hit.hitUp) p.vy = 0;
  if (p.hitWall) p.vx = 0;
  return p;
}
