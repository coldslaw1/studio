// A rig is the reusable description of a character: bones in a tree, the solid parts hung on
// them, equipment slots, and named chains for IK and springs. It is plain data plus the
// functions that turn a pose (angles per bone) into positions in space.
import { add, apply, mul, euler, lerp } from './math.js';

const SHAPES = ['capsule', 'ball', 'box'];
const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Check one part (of a rig or of an item). `needBone` is false for item parts, which default to their slot. */
export function checkPart(part, where, hasBone, needBone = true) {
  if (!part || typeof part !== 'object') throw new Error(`${where}: a part must be an object, got ${JSON.stringify(part)}`);
  if (!SHAPES.includes(part.shape)) throw new Error(`${where}: unknown shape "${part.shape}". Use one of ${SHAPES.join(', ')}`);
  if (part.bone !== undefined ? !hasBone(part.bone) : needBone) throw new Error(`${where}: unknown bone "${part.bone}"`);
  if (typeof part.color !== 'string') throw new Error(`${where}: "color" must be a colour name or hex string`);
  for (const k of ['at', 'to', 'rot']) if (part[k] !== undefined && !isVec(part[k])) throw new Error(`${where}: "${k}" must be [x, y, z], got ${JSON.stringify(part[k])}`);
  if (part.shape === 'capsule' && !(typeof part.r === 'number' || (Array.isArray(part.r) && part.r.length === 2))) throw new Error(`${where}: a capsule needs "r" as a number or [start, end]`);
  if (part.shape === 'ball' && !(typeof part.r === 'number' || isVec(part.r))) throw new Error(`${where}: a ball needs "r" as a number or [rx, ry, rz]`);
  if (part.shape === 'box' && !isVec(part.size)) throw new Error(`${where}: a box needs "size" as [x, y, z]`);
}

/**
 * Build a rig from its description.
 * @param {object} def
 * @param {string} def.name
 * @param {{name:string, parent?:string, at:number[], tip?:number[]}[]} def.bones  First bone is the root. `at` is where
 *   the bone starts, measured from its parent's start in the parent's frame (from the ground origin for the root).
 *   `tip` is where it ends in its own frame (default [0, 0, 0]).
 * @param {object[]} [def.parts]   Solid shapes: { bone, shape: 'capsule'|'ball'|'box', color, ... }. See README "Parts".
 * @param {Object<string,string>} [def.colors]  Colour name to hex.
 * @param {Object<string,{bone:string, at?:number[], rot?:number[]}>} [def.slots]  Equipment slots.
 * @param {Object<string,string[]>} [def.chains]  Named bone chains, e.g. legL: ['thighL', 'shinL', 'footL'].
 * @param {object[]} [def.springs]  Spring chains for createSprings: { bones, stiffness, damping, gravity }.
 * @returns {object} rig
 */
export function createRig(def) {
  if (!def || !Array.isArray(def.bones) || def.bones.length === 0) throw new Error('createRig: "bones" must be a non-empty list');
  const index = {};
  const bones = def.bones.map((b, i) => {
    if (!b || typeof b.name !== 'string') throw new Error(`createRig: bones[${i}] needs a "name"`);
    if (b.name in index) throw new Error(`createRig: bone "${b.name}" is listed twice`);
    if (!isVec(b.at)) throw new Error(`createRig: bone "${b.name}" needs "at" as [x, y, z], got ${JSON.stringify(b.at)}`);
    if (b.tip !== undefined && !isVec(b.tip)) throw new Error(`createRig: bone "${b.name}": "tip" must be [x, y, z]`);
    let parent = -1;
    if (i === 0) { if (b.parent) throw new Error(`createRig: the first bone ("${b.name}") is the root and cannot have a parent`); }
    else {
      parent = index[b.parent];
      if (parent === undefined) throw new Error(`createRig: bone "${b.name}" has parent "${b.parent}", which must be listed before it`);
    }
    index[b.name] = i;
    return { name: b.name, index: i, parent, at: b.at.slice(), tip: (b.tip ?? [0, 0, 0]).slice() };
  });
  const n = bones.length;
  const has = (name) => name in index;
  const boneIndex = (name, who = 'rig') => {
    if (!has(name)) throw new Error(`${who}: unknown bone "${name}". Bones: ${Object.keys(index).join(', ')}`);
    return index[name];
  };
  const descendants = bones.map(() => []);
  bones.forEach((b) => { for (let p = b.parent; p >= 0; p = bones[p].parent) descendants[p].push(b.index); });

  const parts = (def.parts ?? []).map((p, i) => { checkPart(p, `createRig: parts[${i}]`, has); return { ...p }; });
  const slots = {};
  for (const [name, s] of Object.entries(def.slots ?? {})) {
    if (!s || !has(s.bone)) throw new Error(`createRig: slot "${name}" names unknown bone "${s?.bone}"`);
    slots[name] = { bone: s.bone, at: s.at ?? [0, 0, 0], rot: s.rot ?? [0, 0, 0] };
  }
  const chains = {};
  for (const [name, list] of Object.entries(def.chains ?? {})) {
    if (!Array.isArray(list)) throw new Error(`createRig: chain "${name}" must be a list of bone names`);
    list.forEach((b) => boneIndex(b, `createRig: chain "${name}"`));
    chains[name] = list.slice();
  }
  (def.springs ?? []).forEach((s, i) => (s.bones ?? []).forEach((b) => boneIndex(b, `createRig: springs[${i}]`)));

  const rig = {
    name: def.name ?? 'rig',
    bones, index, parts, slots, chains,
    springs: def.springs ?? [],
    colors: { ...(def.colors ?? {}) },
    meta: { ...(def.meta ?? {}) },
    has,
    boneIndex,
    /** Indexes of every bone below the named one (not including it), parents first. */
    descendants(name) { return descendants[boneIndex(name, 'rig.descendants')]; },
    /** A fresh pose: every angle 0 (the rest pose). pose.rot holds rx, ry, rz per bone; pose.root moves the root bone. */
    createPose() { return { rot: new Float64Array(n * 3), root: [0, 0, 0] }; },
    /** Per-bone flags for a list of bone names, each including everything below it. For layers and partial blends. */
    mask(names) {
      const m = new Uint8Array(n);
      for (const name of names) { const i = boneIndex(name, 'rig.mask'); m[i] = 1; for (const d of descendants[i]) m[d] = 1; }
      return m;
    },
    /**
     * Forward kinematics: where every bone is for a pose, in the character's own space
     * (origin on the ground between the feet, facing -y).
     * @returns {{pos:number[][], mat:number[][], local:number[][]}}  Start point and rotation matrix of each bone.
     */
    solve(pose, out = { pos: new Array(n), mat: new Array(n), local: new Array(n) }) {
      for (let i = 0; i < n; i++) {
        const b = bones[i];
        const local = euler(pose.rot[i * 3], pose.rot[i * 3 + 1], pose.rot[i * 3 + 2]);
        out.local[i] = local;
        if (b.parent < 0) { out.pos[i] = add(b.at, pose.root); out.mat[i] = local; }
        else { out.pos[i] = add(out.pos[b.parent], apply(out.mat[b.parent], b.at)); out.mat[i] = mul(out.mat[b.parent], local); }
      }
      return out;
    },
    /** After changing solved.mat[i] or solved.pos[i] by hand, recompute everything below bone i. */
    refk(solved, i) {
      for (const d of descendants[i]) {
        const b = bones[d];
        solved.pos[d] = add(solved.pos[b.parent], apply(solved.mat[b.parent], b.at));
        solved.mat[d] = mul(solved.mat[b.parent], solved.local[d]);
      }
    },
    /** End point of a bone in a solved skeleton. */
    tipOf(solved, i) { return add(solved.pos[i], apply(solved.mat[i], bones[i].tip)); },
  };
  return rig;
}

/** Copy pose `src` into `dst`. */
export function copyPose(dst, src) {
  dst.rot.set(src.rot);
  dst.root[0] = src.root[0]; dst.root[1] = src.root[1]; dst.root[2] = src.root[2];
  return dst;
}

/**
 * dst = a blended toward b by t (0 = a, 1 = b). With a mask, only flagged bones move toward b.
 * dst may be the same object as a or b.
 */
export function blendPose(dst, a, b, t, mask = null) {
  const n = a.rot.length / 3;
  for (let i = 0; i < n; i++) {
    const k = mask && !mask[i] ? 0 : t;
    for (let j = i * 3; j < i * 3 + 3; j++) dst.rot[j] = lerp(a.rot[j], b.rot[j], k);
  }
  const k = mask && !mask[0] ? 0 : t;
  for (let j = 0; j < 3; j++) dst.root[j] = lerp(a.root[j], b.root[j], k);
  return dst;
}

/** dst = base + extra * weight (an additive layer such as breathing or a recoil). */
export function addPose(dst, base, extra, weight = 1, mask = null) {
  const n = base.rot.length / 3;
  for (let i = 0; i < n; i++) {
    const k = mask && !mask[i] ? 0 : weight;
    for (let j = i * 3; j < i * 3 + 3; j++) dst.rot[j] = base.rot[j] + extra.rot[j] * k;
  }
  const k = mask && !mask[0] ? 0 : weight;
  for (let j = 0; j < 3; j++) dst.root[j] = base.root[j] + extra.root[j] * k;
  return dst;
}
