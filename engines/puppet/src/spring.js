// Secondary motion: chains of bones that trail behind the body on springs (capes, hair, tails,
// plumes, a lantern on a chain). The simulation runs in world space, so walking, turning and
// stopping all drag the chain around; gravity and optional wind do the rest.
import { add, sub, scale, len, norm, apply, unapply, mul, fromTo, rotZ, dot, clamp, DEG } from './math.js';

/**
 * Modifier that simulates spring chains on a rig.
 * @param {object} rig
 * @param {object} [opts]
 * @param {object[]} [opts.chains]  Default rig.springs. Each: { bones: [names, parent first], stiffness?: 60,
 *   damping?: 7, gravity?: 2, maxAngle?: 75, wind?: 1 }. stiffness pulls back to the animated pose (higher =
 *   stiffer), damping stops the swinging, gravity is how hard the tip is pulled down, maxAngle limits the bend
 *   in degrees, wind scales how much the chain feels the wind.
 * @param {number[]} [opts.wind]    Steady wind as a world vector [x, y, z] (default none). Can be changed later via springs.wind.
 * @param {number} [opts.gust]      0..1: how much the wind strength wanders (needs rng).
 * @param {() => number} [opts.rng] Random source for gusts. Required when gust > 0.
 * @returns {{step:Function, reset:Function, wind:number[]}}
 */
export function createSprings(rig, opts = {}) {
  const defs = opts.chains ?? rig.springs;
  if (!Array.isArray(defs) || !defs.length) throw new Error('createSprings: no chains given and the rig has no "springs"');
  if ((opts.gust ?? 0) > 0 && typeof opts.rng !== 'function') throw new Error('createSprings: "gust" needs an "rng" function (never Math.random)');
  const chains = defs.map((c, i) => {
    if (!Array.isArray(c.bones) || !c.bones.length) throw new Error(`createSprings: chains[${i}] needs "bones"`);
    return {
      bones: c.bones.map((b) => rig.boneIndex(b, 'createSprings')),
      stiffness: c.stiffness ?? 60, damping: c.damping ?? 7, gravity: c.gravity ?? 2, maxAngle: c.maxAngle ?? 75, wind: c.wind ?? 1,
      p: null, v: null,
    };
  });
  for (const c of chains) for (const b of c.bones) if (len(rig.bones[b].tip) < 1e-6) throw new Error(`createSprings: bone "${rig.bones[b].name}" has no "tip", so it cannot swing`);
  let gust = 1; let gustTarget = 1; let gustClock = 0;

  function substep(ctx, h, first) {
    const { solved, puppet } = ctx;
    const turn = rotZ(puppet.yaw);
    const toWorld = (p) => add(puppet.position, scale(apply(turn, p), puppet.scale));
    const wind = scale(mod.wind, gust);
    for (const c of chains) {
      if (!c.p) { c.p = c.bones.map(() => null); c.v = c.bones.map(() => [0, 0, 0]); }
      c.bones.forEach((b, j) => {
        const bone = rig.bones[b];
        const length = len(bone.tip) * puppet.scale;
        const origin = toWorld(solved.pos[b]);
        const rest = toWorld(rig.tipOf(solved, b)); // where the animation alone would put the tip
        let p = c.p[j];
        // start (or restart after a teleport) hanging at the animated position
        if (!p || len(sub(p, rest)) > length * 6) { p = rest.slice(); c.v[j] = [0, 0, 0]; }
        if (first) {
          const v = c.v[j];
          for (let k = 0; k < 3; k++) {
            const force = c.stiffness * (rest[k] - p[k]) - c.damping * v[k] + wind[k] * c.wind - (k === 2 ? c.gravity : 0);
            v[k] += force * h;
            p[k] += v[k] * h;
          }
          // cloth does not sink into the ground the character stands on
          const floor = puppet.position[2] + 0.03 * puppet.scale;
          if (p[2] < floor && rest[2] >= floor - length) { p[2] = floor; if (v[2] < 0) v[2] = 0; }
        }
        // keep the bone its own length, and inside the bend limit
        const restDir = norm(sub(rest, origin));
        let dir = norm(sub(p, origin));
        const cosMax = Math.cos(c.maxAngle * DEG);
        const d = dot(dir, restDir);
        if (d < cosMax) {
          const side = norm(sub(dir, scale(restDir, d)));
          dir = add(scale(restDir, cosMax), scale(side, Math.sqrt(1 - cosMax * cosMax)));
        }
        p = add(origin, scale(dir, length));
        c.p[j] = p;
        // aim the bone at the particle (in the character's own space) and carry its children along
        const local = unapply(turn, dir);
        solved.mat[b] = mul(fromTo(norm(apply(solved.mat[b], bone.tip)), local), solved.mat[b]);
        rig.refk(solved, b);
      });
    }
  }

  const mod = {
    wind: (opts.wind ?? [0, 0, 0]).slice(),
    /** Forget all motion; chains snap back to the animated pose on the next step. */
    reset() { for (const c of chains) { c.p = null; c.v = null; } },
    step(ctx) {
      const dt = clamp(ctx.dt ?? 0, 0, 0.1);
      if ((opts.gust ?? 0) > 0 && dt > 0) {
        gustClock -= dt;
        if (gustClock <= 0) { gustClock = 0.4 + opts.rng() * 0.8; gustTarget = 1 + (opts.rng() * 2 - 1) * opts.gust; }
        gust += (gustTarget - gust) * (1 - Math.exp(-3 * dt));
      }
      // small fixed steps keep stiff springs stable; the pose is re-aimed once with the final state
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const saved = { pos: ctx.solved.pos.map((p) => p.slice()), mat: ctx.solved.mat.map((m) => m.slice()) };
      for (let i = 0; i < n; i++) {
        if (i > 0) { ctx.solved.pos = saved.pos.map((p) => p.slice()); ctx.solved.mat = saved.mat.map((m) => m.slice()); }
        substep(ctx, dt / n, dt > 0);
      }
    },
  };
  return mod;
}
