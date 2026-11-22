// Equipment for generated characters: weapons, tools, shields and packs, as puppet-engine items
// ({ name, parts, colors }). Every item is sized from the height H of the body that carries it,
// with a little seeded variation, and never longer than the scale rules allow (see MAX_REACH).
//
// Hand items sit in the hand's frame: the arm hangs down, -y is forward. Blades and clubs point
// forward; spears, staffs and torches are carried upright.

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Longest a carried item may be, as a fraction of the carrier's height. */
export const MAX_REACH = { sword: 0.62, dagger: 0.26, axe: 0.6, mace: 0.5, club: 0.6, hammer: 0.5, spear: 1.3, staff: 1.1, torch: 0.55, fork: 1.1 };

const forward = (H, from, to, r, color) => ({ shape: 'capsule', at: [0, r4(-from * H), 0], to: [0, r4(-to * H), 0], r: Array.isArray(r) ? r.map((x) => r4(x * H)) : r4(r * H), color });
const upright = (H, from, to, r, color) => ({ shape: 'capsule', at: [0, 0, r4(from * H)], to: [0, r4(-0.02 * H), r4(to * H)], r: Array.isArray(r) ? r.map((x) => r4(x * H)) : r4(r * H), color });

export const GEAR = {
  sword(H, rng, c) {
    const len = rng.range(0.34, 0.5); const wide = rng.range(0.016, 0.024);
    return { name: 'sword', colors: c, reach: len + 0.05, parts: [
      forward(H, -0.05, 0.03, 0.013, 'grip'),
      { shape: 'box', at: [0, r4(-0.04 * H), 0], size: [r4(rng.range(0.075, 0.12) * H), r4(0.02 * H), r4(0.024 * H)], color: 'trim' },
      forward(H, 0.05, 0.05 + len, [wide, 0.008], 'metal'),
      { shape: 'ball', at: [0, r4(0.055 * H), 0], r: r4(0.017 * H), color: 'trim' }] };
  },
  dagger(H, rng, c) {
    const len = rng.range(0.13, 0.19);
    return { name: 'dagger', colors: c, reach: len + 0.04, parts: [forward(H, -0.035, 0.02, 0.011, 'grip'), { shape: 'box', at: [0, r4(-0.026 * H), 0], size: [r4(0.05 * H), r4(0.014 * H), r4(0.018 * H)], color: 'trim' }, forward(H, 0.03, 0.03 + len, [0.014, 0.004], 'metal')] };
  },
  axe(H, rng, c) {
    const len = rng.range(0.4, 0.55); const head = rng.range(0.07, 0.1); const two = rng.chance(0.3);
    const parts = [forward(H, -0.08, len, 0.012, 'grip'), { shape: 'box', at: [0, r4(-(len - 0.04) * H), r4(head * 0.55 * H)], size: [r4(0.014 * H), r4(head * H), r4(head * 1.2 * H)], color: 'metal' }];
    if (two) parts.push({ shape: 'box', at: [0, r4(-(len - 0.04) * H), r4(-head * 0.55 * H)], size: [r4(0.014 * H), r4(head * H), r4(head * 1.2 * H)], color: 'metal' });
    return { name: 'axe', colors: c, reach: len + 0.02, parts };
  },
  mace(H, rng, c) {
    const len = rng.range(0.32, 0.44);
    return { name: 'mace', colors: c, reach: len + 0.05, parts: [forward(H, -0.06, len, 0.012, 'grip'), { shape: 'ball', at: [0, r4(-len * H), 0], r: r4(rng.range(0.036, 0.046) * H), color: 'metal' }, { shape: 'ball', at: [0, r4(-len * H), 0], r: [r4(0.056 * H), r4(0.012 * H), r4(0.012 * H)], color: 'metal' }, { shape: 'ball', at: [0, r4(-len * H), 0], r: [r4(0.012 * H), r4(0.012 * H), r4(0.056 * H)], color: 'metal' }] };
  },
  club(H, rng, c) {
    const len = rng.range(0.38, 0.56);
    return { name: 'club', colors: c, reach: len + 0.03, parts: [forward(H, -0.06, len, [0.014, rng.range(0.034, 0.05)], 'grip')] };
  },
  hammer(H, rng, c) {
    const len = rng.range(0.3, 0.44);
    return { name: 'hammer', colors: c, reach: len + 0.04, parts: [forward(H, -0.07, len, 0.012, 'grip'), { shape: 'box', at: [0, r4(-len * H), 0], size: [r4(0.05 * H), r4(0.055 * H), r4(rng.range(0.1, 0.14) * H)], color: 'metal' }] };
  },
  spear(H, rng, c) {
    const top = rng.range(0.62, 0.78);
    return { name: 'spear', colors: c, reach: top + 0.52, parts: [upright(H, -0.4, top, 0.011, 'grip'), upright(H, top, top + 0.1, [0.026, 0.003], 'metal')] };
  },
  staff(H, rng, c) {
    const top = rng.range(0.46, 0.6); const orb = rng.chance(0.6);
    const parts = [upright(H, -0.38, top, 0.013, 'grip')];
    if (orb) parts.push({ shape: 'ball', at: [0, r4(-0.02 * H), r4((top + 0.03) * H)], r: r4(rng.range(0.03, 0.042) * H), color: 'glow', flat: true });
    else parts.push({ shape: 'ball', at: [0, r4(-0.02 * H), r4(top * H)], r: [r4(0.03 * H), r4(0.022 * H), r4(0.022 * H)], color: 'grip' });
    return { name: 'staff', colors: c, reach: top + 0.45, parts };
  },
  fork(H, rng, c) {
    const top = rng.range(0.5, 0.58);
    return { name: 'pitchfork', colors: c, reach: top + 0.5, parts: [upright(H, -0.38, top, 0.011, 'grip'), { shape: 'box', at: [0, r4(-0.02 * H), r4(top * H)], size: [r4(0.09 * H), r4(0.012 * H), r4(0.012 * H)], color: 'metal' }, ...[-0.04, 0, 0.04].map((x) => ({ shape: 'capsule', at: [r4(x * H), r4(-0.02 * H), r4(top * H)], to: [r4(x * H), r4(-0.02 * H), r4((top + 0.09) * H)], r: [r4(0.006 * H), r4(0.002 * H)], color: 'metal' }))] };
  },
  torch(H, rng, c) {
    const top = rng.range(0.2, 0.28);
    return { name: 'torch', colors: c, reach: top + 0.3, parts: [upright(H, -0.1, top, 0.012, 'grip'), { shape: 'ball', at: [0, r4(-0.02 * H), r4((top + 0.03) * H)], r: [r4(0.03 * H), r4(0.03 * H), r4(0.045 * H)], color: 'glow', flat: true }] };
  },
};

/** Shield for the forearm slot (armL or armR). */
export function shield(H, rng, c) {
  const kite = rng.chance(0.45); const size = rng.range(0.9, 1.12);
  const parts = [
    { shape: 'ball', at: [r4(0.012 * H), 0, r4(kite ? -0.02 * H : 0)], r: [r4(0.016 * H), r4(0.1 * size * H), r4((kite ? 0.16 : 0.105) * size * H)], color: 'trim' },
    { shape: 'ball', at: [r4(0.02 * H), 0, r4(kite ? -0.02 * H : 0)], r: [r4(0.016 * H), r4(0.086 * size * H), r4((kite ? 0.145 : 0.09) * size * H)], color: 'face', bias: 0.01 },
    { shape: 'ball', at: [r4(0.034 * H), 0, r4(0.01 * H)], r: r4(0.024 * H), color: 'trim', bias: 0.02 },
  ];
  return { name: kite ? 'kiteShield' : 'roundShield', colors: c, parts };
}

/** Pack for the back slot. */
export function pack(H, rng, c) {
  const roll = rng.chance(0.5);
  const parts = [{ shape: 'box', at: [0, r4(0.05 * H), r4(-0.01 * H)], size: [r4(0.16 * H), r4(0.09 * H), r4(0.19 * H)], color: 'bag' }, { shape: 'box', at: [0, r4(0.1 * H), r4(-0.04 * H)], size: [r4(0.11 * H), r4(0.02 * H), r4(0.08 * H)], color: 'strap' }];
  if (roll) parts.push({ shape: 'capsule', at: [r4(-0.09 * H), r4(0.05 * H), r4(0.105 * H)], to: [r4(0.09 * H), r4(0.05 * H), r4(0.105 * H)], r: r4(0.03 * H), color: 'roll' });
  return { name: 'pack', colors: c, parts };
}
