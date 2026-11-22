// Body plans for generated characters. A body is a rig description for the puppet engine: plain
// data with bones, solid parts, colour names, equipment slots and chains. Two-legged bodies use
// the puppet engine's standard bone names (hips spine chest neck head, armL foreL handL,
// thighL shinL footL and the R side), so its walk, run, jump and attack clips, foot IK and
// equipment all work on them. Kiln does not import the puppet engine; it only writes its format.
//
// Space: metres, z up, the character faces -y, L is the character's left (+x).

const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * A two-legged rig description.
 * @param {object} o
 * @param {number} o.height   Metres to the top of the head.
 * @param {number} [o.bulk]   Thickness: 0.46 bare bones, 1 average, 1.5 massive.
 * @param {number} [o.head]   Head size, 1.1 = an adult drawn slightly large so faces read.
 * @param {number} [o.leg]    Leg length against a standard adult (0.8 to 1.05); the torso takes up the difference.
 * @param {number} [o.shoulder]  Shoulder width multiplier.
 * @param {number} [o.arm]    Arm length multiplier.
 * @param {number} [o.hunch]  0 upright to 1 stooped: the chest and head sit forward.
 * @param {number} [o.belly]  0 to 1: a rounder middle.
 * @param {string} [o.face]   'eyes' (default), 'glow' (larger flat eyes), 'sockets' or 'none'.
 */
export function twoLegged(o) {
  const H = o.height;
  if (!(H > 0)) throw new Error(`twoLegged: "height" must be a positive number of metres, got ${o.height}`);
  const k = o.bulk ?? 1; const hd = o.head ?? 1.1; const leg = o.leg ?? 1; const arm = o.arm ?? 1;
  const hunch = o.hunch ?? 0; const belly = o.belly ?? 0;
  const legLen = 0.455 * leg;
  const hipsZ = 0.065 + legLen;
  const t = Math.max(0.8, Math.min(1.5, (1 - 0.152 * hd - hipsZ) / 0.33)); // torso stretch so the head tops out at H
  const sw = 0.115 * (0.8 + 0.2 * k) * (o.shoulder ?? 1);
  const hw = 0.055 * (0.9 + 0.1 * k);
  const v = (x, y, z) => [r4(x * H), r4(y * H), r4(z * H)];
  const bones = [
    { name: 'hips', at: v(0, 0, hipsZ), tip: v(0, 0, 0.06 * t) },
    { name: 'spine', parent: 'hips', at: v(0, 0, 0.06 * t), tip: v(0, 0, 0.1 * t) },
    { name: 'chest', parent: 'spine', at: v(0, -0.03 * hunch, 0.1 * t), tip: v(0, 0, 0.13 * t) },
    { name: 'neck', parent: 'chest', at: v(0, -0.04 * hunch, 0.13 * t), tip: v(0, 0, 0.04) },
    { name: 'head', parent: 'neck', at: v(0, -0.025 * hunch, 0.04), tip: v(0, 0, 0.15 * hd) },
  ];
  const parts = [
    { bone: 'hips', shape: 'ball', at: v(0, 0, 0.015), r: v(0.088 * k + 0.012, 0.062 * k + 0.006, 0.062 * t), color: 'legs', group: 'torso' },
    { bone: 'spine', shape: 'ball', at: v(0, -0.02 * belly, 0.045 * t), r: v(0.092 * k + 0.03 * belly, 0.066 * k + 0.045 * belly, 0.085 * t), color: 'top', group: 'torso' },
    { bone: 'chest', shape: 'ball', at: v(0, 0, 0.055 * t), r: v(0.122 * k * (o.shoulder ?? 1), 0.076 * k, 0.095 * t), color: 'top', group: 'torso' },
    { bone: 'neck', shape: 'capsule', at: v(0, 0, -0.01), r: [r4(0.03 * H * k), r4(0.028 * H * k)], color: 'skin', group: 'head' },
    { bone: 'head', shape: 'ball', at: v(0, 0, 0.072 * hd), r: v(0.068 * hd, 0.074 * hd, 0.08 * hd), color: 'skin', group: 'head' },
  ];
  const face = o.face ?? 'eyes';
  for (const s of [1, -1]) {
    if (face === 'eyes') parts.push({ bone: 'head', shape: 'ball', at: v(0.028 * hd * s, -0.066 * hd, 0.082 * hd), r: r4(0.0125 * hd * H), color: 'eye', flat: true, group: 'face', bias: 0.02 });
    else if (face === 'glow') parts.push({ bone: 'head', shape: 'ball', at: v(0.03 * hd * s, -0.067 * hd, 0.084 * hd), r: v(0.019 * hd, 0.012 * hd, 0.013 * hd), color: 'eye', flat: true, group: 'face', bias: 0.02 });
    else if (face === 'sockets') parts.push({ bone: 'head', shape: 'ball', at: v(0.03 * hd * s, -0.066 * hd, 0.086 * hd), r: v(0.021 * hd, 0.014 * hd, 0.023 * hd), color: 'eye', flat: true, group: 'face', bias: 0.02 });
  }
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    bones.push(
      { name: `arm${side}`, parent: 'chest', at: v(sw * s, 0, 0.105 * t), tip: v(0, 0, -0.16 * arm) },
      { name: `fore${side}`, parent: `arm${side}`, at: v(0, 0, -0.16 * arm), tip: v(0, 0, -0.15 * arm) },
      { name: `hand${side}`, parent: `fore${side}`, at: v(0, 0, -0.15 * arm), tip: v(0, 0, -0.05) },
      { name: `thigh${side}`, parent: 'hips', at: v(hw * s, 0, -0.02), tip: v(0, 0, -0.23 * leg) },
      { name: `shin${side}`, parent: `thigh${side}`, at: v(0, 0, -0.23 * leg), tip: v(0, 0, -0.225 * leg) },
      { name: `foot${side}`, parent: `shin${side}`, at: v(0, 0, -0.225 * leg), tip: v(0, -0.085, -0.027) },
    );
    const hand = 0.03 * (0.6 + 0.4 * k) * (o.hands ?? 1);
    parts.push(
      { bone: `arm${side}`, shape: 'capsule', r: [r4(0.038 * H * k), r4(0.031 * H * k)], color: 'sleeve', group: 'arms' },
      { bone: `fore${side}`, shape: 'capsule', r: [r4(0.031 * H * k), r4(0.025 * H * k)], color: o.bareArms ? 'skin' : 'sleeve', group: 'arms' },
      { bone: `hand${side}`, shape: 'ball', at: v(0, 0, -0.022), r: r4(hand * H), color: 'skin', group: 'arms' },
      { bone: `thigh${side}`, shape: 'capsule', r: [r4(0.05 * H * k), r4(0.039 * H * k)], color: 'legs', group: 'legs' },
      { bone: `shin${side}`, shape: 'capsule', r: [r4(0.039 * H * k), r4(0.029 * H * k)], color: o.bareLegs ? 'skin' : 'legs', group: 'legs' },
      { bone: `foot${side}`, shape: 'capsule', at: v(0, 0.012, -0.02), r: [r4(0.027 * H * (0.6 + 0.4 * k)), r4(0.022 * H * (0.6 + 0.4 * k))], color: 'shoe', group: 'legs' },
    );
  }
  return {
    name: o.name ?? 'generated',
    bones, parts,
    colors: {},
    slots: {
      handR: { bone: 'handR', at: v(0, 0, -0.025) },
      handL: { bone: 'handL', at: v(0, 0, -0.025) },
      armL: { bone: 'foreL', at: v(0.04, 0, -0.08 * arm) },
      armR: { bone: 'foreR', at: v(-0.04, 0, -0.08 * arm) },
      head: { bone: 'head', at: v(0, 0, 0.072 * hd) },
      back: { bone: 'chest', at: v(0, 0.085 * k, 0.05 * t) },
      body: { bone: 'chest', at: v(0, 0, 0) },
    },
    chains: { legL: ['thighL', 'shinL', 'footL'], legR: ['thighR', 'shinR', 'footR'], armL: ['armL', 'foreL', 'handL'], armR: ['armR', 'foreR', 'handR'] },
    springs: [],
    meta: { height: H, legLength: r4(legLen * H), headSize: hd, bulk: k, torso: r4(t), plan: 'twoLegged' },
  };
}

/** The standard bone names every two-legged body must have, for tests and for checkAsset. */
export const TWO_LEGGED_BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'thighL', 'shinL', 'footL', 'armR', 'foreR', 'handR', 'thighR', 'shinR', 'footR'];

/** Where every bone starts with the rig at rest (no rotation): { boneName: [x, y, z] }. */
export function restPositions(def) {
  const pos = {};
  for (const b of def.bones) {
    const p = b.parent ? pos[b.parent] : [0, 0, 0];
    if (!p) throw new Error(`restPositions: bone "${b.name}" has parent "${b.parent}", which must come before it`);
    pos[b.name] = [p[0] + b.at[0], p[1] + b.at[1], p[2] + b.at[2]];
  }
  return pos;
}

/**
 * A rig (with its equipment) standing at rest, as solids for the scene renderer and for measuring.
 * Colours are returned as hex, so the solids need no palette.
 * @param {{def:object, equipment?:Object<string,object>}} model
 * @returns {object[]} Solids as described in gen-solid.js (limb, ball, box).
 */
export function modelSolids(model) {
  const { def } = model;
  const pos = restPositions(def);
  const tips = Object.fromEntries(def.bones.map((b) => [b.name, b.tip ?? [0, 0, 0]]));
  const out = [];
  const hidden = new Set(Object.values(model.equipment ?? {}).flatMap((it) => it?.hides ?? []));
  const emit = (part, origin, defaultTo, colors) => {
    if (part.group && hidden.has(part.group)) return;
    const c = colors[part.color] ?? def.colors[part.color] ?? part.color;
    const flat = part.flat ? { flat: true } : {};
    const at = part.at ?? [0, 0, 0];
    const p = (q) => [origin[0] + q[0], origin[1] + q[1], origin[2] + q[2]];
    if (part.shape === 'capsule') out.push({ p: 'limb', a: p(at), b: p(part.to ?? defaultTo), r: Array.isArray(part.r) ? part.r : [part.r, part.r], c, ...flat });
    else if (part.shape === 'ball') out.push({ p: 'ball', at: p(at), r: Array.isArray(part.r) ? part.r : [part.r, part.r, part.r], c, ...flat });
    else out.push({ p: 'box', min: p(at).map((x, i) => x - part.size[i] / 2), max: p(at).map((x, i) => x + part.size[i] / 2), c, ...flat });
  };
  for (const part of def.parts) emit(part, pos[part.bone], tips[part.bone], {});
  for (const [slotName, item] of Object.entries(model.equipment ?? {})) {
    if (!item) continue;
    const slot = def.slots[slotName];
    if (!slot) throw new Error(`modelSolids: the rig has no slot "${slotName}"`);
    const origin = pos[slot.bone].map((x, i) => x + (slot.at?.[i] ?? 0));
    for (const part of item.parts) {
      if (part.bone) emit(part, pos[part.bone], tips[part.bone], item.colors ?? {});
      else emit(part, origin, [0, 0, 0], item.colors ?? {});
    }
  }
  return out;
}
