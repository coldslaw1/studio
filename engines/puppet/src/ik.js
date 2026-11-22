// Inverse kinematics and aiming, applied after the animation: feet that find the ground on
// slopes and steps, hands that reach a point, a head that looks at something.
// These are "modifiers": objects with step(ctx) that adjust the solved skeleton in place.
import { add, sub, scale, dot, len, norm, cross, apply, mul, fromTo, rotZ, clamp, damp, DEG, euler } from './math.js';

/**
 * Bend a two-bone chain (thigh-shin-foot or arm-forearm-hand) so its end reaches `target`.
 * Works on a solved skeleton in place. The end bone keeps the direction the animation gave it.
 * @param {object} rig
 * @param {object} solved   From rig.solve.
 * @param {string[]} chain  Three bone names: upper, lower, end.
 * @param {number[]} target Point in the character's own space.
 * @param {number[]} [pole] Which way the middle joint bends when the limb is straight (default forward, [0, -1, 0]).
 * @returns {boolean} False when the target was out of reach (the limb then points at it, fully stretched).
 */
export function solveTwoBone(rig, solved, chain, target, pole = [0, -1, 0]) {
  if (!Array.isArray(chain) || chain.length !== 3) throw new Error(`solveTwoBone: chain must be three bone names, got ${JSON.stringify(chain)}`);
  const [ia, ib, ic] = chain.map((b) => rig.boneIndex(b, 'solveTwoBone'));
  const H = solved.pos[ia];
  const l1 = len(sub(solved.pos[ib], H));
  const l2 = len(sub(solved.pos[ic], solved.pos[ib]));
  const d = sub(target, H);
  const raw = len(d);
  if (raw < 1e-6 || l1 < 1e-6 || l2 < 1e-6) return false;
  const dist = clamp(raw, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const dir = scale(d, 1 / raw);
  const T = add(H, scale(dir, dist));
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // keep the knee/elbow on the side the animation already bends it (measured against the limb's own
  // line from start to end); a straight limb uses the pole instead
  const k0 = sub(solved.pos[ib], H);
  const line = norm(sub(solved.pos[ic], H));
  let hint = sub(k0, scale(line, dot(k0, line)));
  if (len(hint) < 0.02 * l1) hint = pole;
  let bend = sub(hint, scale(dir, dot(hint, dir)));
  if (len(bend) < 1e-6) bend = cross(dir, [1, 0, 0]);
  bend = norm(bend);
  const K = add(H, add(scale(dir, a), scale(bend, h)));
  const endMat = solved.mat[ic];
  solved.mat[ia] = mul(fromTo(norm(k0), norm(sub(K, H))), solved.mat[ia]);
  rig.refk(solved, ia);
  solved.mat[ib] = mul(fromTo(norm(sub(solved.pos[ic], solved.pos[ib])), norm(sub(T, solved.pos[ib]))), solved.mat[ib]);
  rig.refk(solved, ib);
  solved.mat[ic] = endMat;
  rig.refk(solved, ic);
  return raw <= l1 + l2;
}

/**
 * Modifier: keeps feet on uneven ground. Each foot is lifted or lowered by the ground height under
 * it, the hips drop so the lower foot can reach, and the legs are re-bent to match.
 * @param {object} rig
 * @param {object} opts
 * @param {(x:number, y:number) => number} opts.groundAt  World ground height at a world position.
 * @param {string[][]} [opts.legs]   Chains of three bones (default: rig.chains.legL and legR).
 * @param {number} [opts.maxStep]    Largest height difference a foot follows (default 0.5).
 * @param {number} [opts.rate]       Smoothing per second (default 14).
 * @returns {{step:Function, weight:number, offsets:number[]}}  Set weight to 0 while airborne.
 */
export function createFootIk(rig, opts = {}) {
  if (typeof opts.groundAt !== 'function') throw new Error('createFootIk: "groundAt" must be a function (x, y) => ground height');
  const legs = opts.legs ?? [rig.chains.legL, rig.chains.legR].filter(Boolean);
  if (!legs.length) throw new Error('createFootIk: the rig has no legL/legR chains; pass "legs" as lists of three bone names');
  const maxStep = opts.maxStep ?? 0.5;
  const rate = opts.rate ?? 14;
  const ends = legs.map((c) => rig.boneIndex(c[2], 'createFootIk'));
  const mod = {
    weight: 1,
    /** Smoothed ground offset under each foot, and (last) the hips. For debugging and tests. */
    offsets: [...legs.map(() => 0), 0],
    step({ solved, puppet, dt }) {
      const turn = rotZ(puppet.yaw);
      const base = puppet.position[2];
      const targets = legs.map((_, i) => {
        const w = add(puppet.position, scale(apply(turn, solved.pos[ends[i]]), puppet.scale));
        const g = (opts.groundAt(w[0], w[1]) - base) / puppet.scale;
        return clamp(Number.isFinite(g) ? g : 0, -maxStep, maxStep) * mod.weight;
      });
      const k = dt > 0 ? 1 - Math.exp(-rate * dt) : 1;
      targets.forEach((g, i) => { mod.offsets[i] += (g - mod.offsets[i]) * k; });
      const hip = legs.length;
      mod.offsets[hip] += (Math.min(0, ...targets) - mod.offsets[hip]) * k;
      const drop = mod.offsets[hip];
      const goals = legs.map((_, i) => add(solved.pos[ends[i]], [0, 0, mod.offsets[i]]));
      if (Math.abs(drop) > 1e-5) for (const p of solved.pos) p[2] += drop;
      legs.forEach((chain, i) => { if (Math.abs(mod.offsets[i] - drop) > 1e-5) solveTwoBone(rig, solved, chain, goals[i], opts.pole); });
    },
  };
  return mod;
}

/**
 * Modifier: pulls the end of a chain to a world point (a hand on a lever, both hands on a pole).
 * Set reach.target to [x, y, z] in world space, or null to switch off; reach.weight blends 0..1.
 * @param {object} rig
 * @param {{chain:string[], pole?:number[], rate?:number}} opts
 */
export function createReach(rig, opts = {}) {
  if (!Array.isArray(opts.chain) || opts.chain.length !== 3) throw new Error('createReach: "chain" must be three bone names');
  const end = rig.boneIndex(opts.chain[2], 'createReach');
  const mod = {
    target: null,
    weight: 1,
    amount: 0,
    step({ solved, puppet, dt }) {
      mod.amount = damp(mod.amount, mod.target ? mod.weight : 0, opts.rate ?? 12, dt);
      if (!mod.target || mod.amount < 1e-3) return;
      const local = scale(apply(rotZ(-puppet.yaw), sub(mod.target, puppet.position)), 1 / puppet.scale);
      const from = solved.pos[end];
      solveTwoBone(rig, solved, opts.chain, add(from, scale(sub(local, from), mod.amount)), opts.pole ?? [0, 1, 0]);
    },
  };
  return mod;
}

/**
 * Modifier: turns a bone (usually the head) toward a world point, within limits, smoothly.
 * Set look.target to [x, y, z] in world space, or null to face forward again.
 * @param {object} rig
 * @param {{bone?:string, maxYaw?:number, maxPitch?:number, rate?:number}} [opts]
 */
export function createLookAt(rig, opts = {}) {
  const bone = rig.boneIndex(opts.bone ?? 'head', 'createLookAt');
  const maxYaw = opts.maxYaw ?? 70;
  const maxPitch = opts.maxPitch ?? 35;
  const mod = {
    target: null,
    yaw: 0,
    pitch: 0,
    step({ solved, puppet, dt }) {
      let wantYaw = 0; let wantPitch = 0;
      if (mod.target) {
        const eye = rig.tipOf(solved, bone);
        const to = sub(scale(apply(rotZ(-puppet.yaw), sub(mod.target, puppet.position)), 1 / puppet.scale), eye);
        wantYaw = clamp(Math.atan2(to[0], -to[1]) / DEG, -maxYaw, maxYaw);
        wantPitch = clamp(Math.atan2(to[2], Math.hypot(to[0], to[1])) / DEG, -maxPitch, maxPitch);
      }
      mod.yaw = damp(mod.yaw, wantYaw, opts.rate ?? 8, dt);
      mod.pitch = damp(mod.pitch, wantPitch, opts.rate ?? 8, dt);
      if (Math.abs(mod.yaw) < 0.01 && Math.abs(mod.pitch) < 0.01) return;
      // turn about the up axis, then tip up or down about the side axis of the new heading
      solved.mat[bone] = mul(mul(rotZ(mod.yaw), euler(mod.pitch, 0, 0)), solved.mat[bone]);
      rig.refk(solved, bone);
    },
  };
  return mod;
}
