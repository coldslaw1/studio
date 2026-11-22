// The standard two-legged rig. Every humanoid character shares these bone names, so clips,
// state machines, IK and equipment made for one work on all of them.
//
// Bones: hips (root) > spine > chest > neck > head; chest > armL > foreL > handL (and R);
// hips > thighL > shinL > footL (and R). L is the character's left, which is +x.

/**
 * Description of a humanoid rig, ready for createRig or to extend with more bones and parts.
 * @param {object} [o]
 * @param {number} [o.height]  Total height in world units (default 1.8).
 * @param {number} [o.bulk]    Limb and body thickness, 1 = average, 0.45 = bare bones, 1.25 = heavy (default 1).
 * @param {number} [o.head]    Head size multiplier (default 1.1, slightly large so faces read at small sizes).
 * @param {boolean} [o.face]   Draw eyes (default true).
 * @param {Object<string,string>} [o.colors]  Overrides for skin, top, sleeve, legs, shoe, eye.
 * @returns {object} A rig description: { name, bones, parts, colors, slots, chains, springs, meta }.
 */
export function humanoid(o = {}) {
  const H = o.height ?? 1.8;
  if (!(H > 0)) throw new Error(`humanoid: "height" must be a positive number, got ${o.height}`);
  const k = o.bulk ?? 1;
  const hd = o.head ?? 1.1;
  const sw = 0.115 * H * (0.8 + 0.2 * k); // shoulder half-width
  const hw = 0.055 * H; // hip half-width
  const v = (x, y, z) => [x * H, y * H, z * H];
  const bones = [
    { name: 'hips', at: v(0, 0, 0.52), tip: v(0, 0, 0.06) },
    { name: 'spine', parent: 'hips', at: v(0, 0, 0.06), tip: v(0, 0, 0.1) },
    { name: 'chest', parent: 'spine', at: v(0, 0, 0.1), tip: v(0, 0, 0.13) },
    { name: 'neck', parent: 'chest', at: v(0, 0, 0.13), tip: v(0, 0, 0.04) },
    { name: 'head', parent: 'neck', at: v(0, 0, 0.04), tip: v(0, 0, 0.15 * hd) },
  ];
  const parts = [
    { bone: 'hips', shape: 'ball', at: v(0, 0, 0.015), r: v(0.088 * k + 0.012, 0.062 * k + 0.006, 0.062), color: 'legs', group: 'torso' },
    { bone: 'spine', shape: 'ball', at: v(0, 0, 0.045), r: v(0.092 * k, 0.066 * k, 0.085), color: 'top', group: 'torso' },
    { bone: 'chest', shape: 'ball', at: v(0, 0, 0.055), r: v(0.122 * k, 0.076 * k, 0.095), color: 'top', group: 'torso' },
    { bone: 'neck', shape: 'capsule', at: v(0, 0, -0.01), r: [0.03 * H * k, 0.028 * H * k], color: 'skin', group: 'head' },
    { bone: 'head', shape: 'ball', at: v(0, 0, 0.072 * hd), r: v(0.068 * hd, 0.074 * hd, 0.08 * hd), color: 'skin', group: 'head' },
  ];
  if (o.face ?? true) {
    for (const s of [1, -1]) parts.push({ bone: 'head', shape: 'ball', at: v(0.028 * hd * s, -0.066 * hd, 0.082 * hd), r: 0.0125 * hd * H, color: 'eye', flat: true, group: 'face', bias: 0.02 });
  }
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    bones.push(
      { name: `arm${side}`, parent: 'chest', at: [sw * s, 0, 0.105 * H], tip: v(0, 0, -0.16) },
      { name: `fore${side}`, parent: `arm${side}`, at: v(0, 0, -0.16), tip: v(0, 0, -0.15) },
      { name: `hand${side}`, parent: `fore${side}`, at: v(0, 0, -0.15), tip: v(0, 0, -0.05) },
      { name: `thigh${side}`, parent: 'hips', at: [hw * s, 0, -0.02 * H], tip: v(0, 0, -0.23) },
      { name: `shin${side}`, parent: `thigh${side}`, at: v(0, 0, -0.23), tip: v(0, 0, -0.225) },
      { name: `foot${side}`, parent: `shin${side}`, at: v(0, 0, -0.225), tip: v(0, -0.085, -0.027) },
    );
    parts.push(
      { bone: `arm${side}`, shape: 'capsule', r: [0.038 * H * k, 0.031 * H * k], color: 'sleeve', group: 'arms' },
      { bone: `fore${side}`, shape: 'capsule', r: [0.031 * H * k, 0.025 * H * k], color: 'sleeve', group: 'arms' },
      { bone: `hand${side}`, shape: 'ball', at: v(0, 0, -0.022), r: 0.03 * H * (0.6 + 0.4 * k), color: 'skin', group: 'arms' },
      { bone: `thigh${side}`, shape: 'capsule', r: [0.05 * H * k, 0.039 * H * k], color: 'legs', group: 'legs' },
      { bone: `shin${side}`, shape: 'capsule', r: [0.039 * H * k, 0.029 * H * k], color: 'legs', group: 'legs' },
      { bone: `foot${side}`, shape: 'capsule', at: v(0, 0.012, -0.02), r: [0.027 * H * (0.6 + 0.4 * k), 0.022 * H * (0.6 + 0.4 * k)], color: 'shoe', group: 'legs' },
    );
  }
  return {
    name: o.name ?? 'humanoid',
    bones,
    parts,
    colors: { skin: '#f0c090', top: '#3366cc', sleeve: '#3366cc', legs: '#8a5a33', shoe: '#4a3020', eye: '#1e1a28', ...(o.colors ?? {}) },
    slots: {
      handR: { bone: 'handR', at: v(0, 0, -0.025) },
      handL: { bone: 'handL', at: v(0, 0, -0.025) },
      armL: { bone: 'foreL', at: v(0.04, 0, -0.08) },
      armR: { bone: 'foreR', at: v(-0.04, 0, -0.08) },
      head: { bone: 'head', at: v(0, 0, 0.072 * hd) },
      back: { bone: 'chest', at: v(0, 0.085 * k, 0.05) },
      body: { bone: 'chest', at: v(0, 0, 0) },
    },
    chains: {
      legL: ['thighL', 'shinL', 'footL'], legR: ['thighR', 'shinR', 'footR'],
      armL: ['armL', 'foreL', 'handL'], armR: ['armR', 'foreR', 'handR'],
    },
    springs: [],
    meta: { height: H, legLength: 0.455 * H, headSize: hd },
  };
}
