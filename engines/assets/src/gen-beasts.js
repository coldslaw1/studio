// Creatures that are not two-legged: four-legged beasts (wolf, boar, rat), slimes and bats.
// The puppet engine's ready-made clips are for two legs, so each of these comes with its own
// animator description made of plain keyframes (JSON), with the same parameters, triggers and
// events as the humanoid one: speed, dead, "attack", "hurt", and the events step, hit, thud.
import { POOLS } from './gen-palette.js';

const r4 = (v) => Math.round(v * 10000) / 10000;
const keys = (list) => list.map((k) => k.map((x) => (typeof x === 'number' ? r4(x) : x)));

/** The state machine all three creature plans share. `upperMask` is the bone the attack moves. */
function machine(clips, upperMask) {
  return {
    clips,
    params: { speed: 0, grounded: true, vz: 0, dead: false, rate: 1 },
    initial: 'move',
    states: {
      move: { blend: { param: 'speed', points: [[0, 'idle'], [1, 'walk'], [2.6, 'run']] }, speed: { param: 'rate' } },
      hurt: { clip: 'hurt', next: 'move', fade: 0.1 },
      die: { clip: 'die' },
    },
    transitions: [
      { from: ['move', 'hurt'], to: 'die', when: { param: 'dead' }, fade: 0.1 },
      { from: 'die', to: 'move', when: { param: 'dead', eq: false }, fade: 0.4 },
      { from: 'move', to: 'hurt', when: { trigger: 'hurt' }, fade: 0.05 },
    ],
    layers: [{
      name: 'upper', mask: [upperMask], initial: 'none',
      states: { none: {}, attack: { clip: 'attack', next: 'none', fade: 0.12 }, wave: { clip: 'wave' } },
      transitions: [
        { from: ['attack', 'wave'], to: 'none', when: { param: 'dead' }, fade: 0.1 },
        { from: ['none', 'wave'], to: 'attack', when: { all: [{ trigger: 'attack' }, { not: { param: 'dead' } }] }, fade: 0.05 },
      ],
    }],
  };
}

const BEASTS = {
  wolf: { shoulder: [0.7, 0.9], length: 1.25, bulk: [0.9, 1.05], leg: 0.6, head: 1, snout: 1.1, ears: 1, tail: 1.1, hide: ['stone', 'stone~ink~0.35', 'wood~ink~0.3', 'stone~white~0.4', 'wood'] },
  boar: { shoulder: [0.75, 0.95], length: 1.15, bulk: [1.3, 1.5], leg: 0.42, head: 1.15, snout: 0.9, ears: 0.6, tail: 0.4, tusks: true, mane: true, hide: ['wood~ink~0.35', 'wood', 'stone~wood~0.5', 'wood~ink~0.5'] },
  rat: { shoulder: [0.3, 0.48], length: 1.5, bulk: [1.0, 1.2], leg: 0.38, head: 1.05, snout: 1.2, ears: 0.8, tail: 1.6, round: true, hide: ['stone~wood~0.4', 'stone', 'wood~ink~0.4', 'stone~ink~0.4'] },
};

function fourLegged(ctx, type) {
  const B = BEASTS[type];
  const body = ctx.rng('body'); const look = ctx.rng('palette'); const c = ctx.colors;
  const sh = r4(body.range(...B.shoulder) * ctx.size); // shoulder height in metres
  const k = body.range(...B.bulk); const L = sh * B.length; const leg = sh * B.leg / 0.6 * 0.62;
  const paw = 0.05 * sh; const hipsZ = 0.02 * sh + 0.95 * leg + paw;
  const w = 0.13 * sh * k; const hl = 0.24 * sh * B.head; const nl = 0.3 * sh;
  const v = (x, y, z) => [r4(x), r4(y), r4(z)];
  const bones = [
    { name: 'hips', at: v(0, L / 2, hipsZ), tip: v(0, -L * 0.34, 0.01 * sh) },
    { name: 'spine', parent: 'hips', at: v(0, -L * 0.34, 0.01 * sh), tip: v(0, -L * 0.33, 0.01 * sh) },
    { name: 'chest', parent: 'spine', at: v(0, -L * 0.33, 0.01 * sh), tip: v(0, -L * 0.28, 0.02 * sh) },
    { name: 'neck', parent: 'chest', at: v(0, -L * 0.28, 0.04 * sh), tip: v(0, -nl * 0.8, nl * 0.55) },
    { name: 'head', parent: 'neck', at: v(0, -nl * 0.8, nl * 0.55), tip: v(0, -hl, -0.12 * hl) },
  ];
  const rb = 0.2 * sh * k;
  const parts = [
    { bone: 'hips', shape: 'ball', at: v(0, -0.06 * L, 0), r: v(rb * 0.95, 0.2 * L, rb), color: 'hide', group: 'torso' },
    { bone: 'spine', shape: 'ball', at: v(0, -0.1 * L, -0.02 * sh), r: v(rb, 0.24 * L, rb * 1.05), color: 'hide', group: 'torso' },
    { bone: 'chest', shape: 'ball', at: v(0, -0.14 * L, 0), r: v(rb * 1.08, 0.2 * L, rb * 1.12), color: 'hide', group: 'torso' },
    { bone: 'spine', shape: 'ball', at: v(0, -0.1 * L, -rb * 0.55), r: v(rb * 0.7, 0.3 * L, rb * 0.5), color: 'belly', group: 'torso' },
    { bone: 'neck', shape: 'capsule', r: [r4(rb * 0.8), r4(rb * 0.62)], color: 'hide', group: 'head' },
    { bone: 'head', shape: 'ball', at: v(0, -hl * 0.2, 0), r: v(hl * 0.5, hl * 0.6, hl * 0.48), color: 'hide', group: 'head' },
    { bone: 'head', shape: 'capsule', at: v(0, -hl * 0.4, -hl * 0.1), to: v(0, -hl * (0.5 + 0.6 * B.snout), -hl * 0.2), r: [r4(hl * 0.3), r4(hl * (B.round ? 0.14 : 0.2))], color: 'hide', group: 'head' },
    { bone: 'head', shape: 'ball', at: v(0, -hl * (0.55 + 0.6 * B.snout), -hl * 0.2), r: r4(hl * 0.1), color: 'nose', group: 'face', bias: 0.01 },
  ];
  for (const s of [1, -1]) {
    parts.push({ bone: 'head', shape: 'ball', at: v(s * hl * 0.3, -hl * 0.52, hl * 0.16), r: r4(hl * 0.085), color: 'eye', flat: true, group: 'face', bias: 0.02 });
    if (B.round) parts.push({ bone: 'head', shape: 'ball', at: v(s * hl * 0.42, 0, hl * 0.42), r: v(hl * 0.3 * B.ears, hl * 0.08, hl * 0.3 * B.ears), color: 'belly', group: 'ears' });
    else parts.push({ bone: 'head', shape: 'capsule', at: v(s * hl * 0.32, hl * 0.05, hl * 0.3), to: v(s * hl * 0.42, hl * 0.1, hl * (0.3 + 0.5 * B.ears)), r: [r4(hl * 0.17), r4(hl * 0.03)], color: 'hide', group: 'ears' });
    if (B.tusks) parts.push({ bone: 'head', shape: 'capsule', at: v(s * hl * 0.22, -hl * 0.85, -hl * 0.25), to: v(s * hl * 0.34, -hl * 0.95, hl * 0.12), r: [r4(hl * 0.07), r4(hl * 0.015)], color: 'horn', group: 'face', bias: 0.02 });
  }
  if (B.mane) for (let i = 0; i < 3; i++) parts.push({ bone: i ? 'spine' : 'chest', shape: 'ball', at: v(0, -(0.05 + (i ? i - 1 : 0.5) * 0.12) * L, rb * 0.95), r: v(rb * 0.25, 0.1 * L, rb * 0.3), color: 'mane', group: 'mane' });
  const limb = (prefix, lower, end, parent, at) => {
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      bones.push(
        { name: `${prefix}${side}`, parent, at: v(at[0] * s, at[1], at[2]), tip: v(0, 0, -leg * 0.5) },
        { name: `${lower}${side}`, parent: `${prefix}${side}`, at: v(0, 0, -leg * 0.5), tip: v(0, 0, -leg * 0.45) },
        { name: `${end}${side}`, parent: `${lower}${side}`, at: v(0, 0, -leg * 0.45), tip: v(0, -paw * 1.2, -paw) },
      );
      parts.push(
        { bone: `${prefix}${side}`, shape: 'capsule', r: [r4(w * 0.62), r4(w * 0.42)], color: 'hide', group: 'legs' },
        { bone: `${lower}${side}`, shape: 'capsule', r: [r4(w * 0.42), r4(w * 0.3)], color: 'hide', group: 'legs' },
        { bone: `${end}${side}`, shape: 'ball', at: v(0, -paw * 0.5, -paw * 0.4), r: v(w * 0.4, paw * 1.3, paw * 0.6), color: 'belly', group: 'legs' },
      );
    }
  };
  limb('thigh', 'shin', 'foot', 'hips', [w * 0.9, -0.04 * L, -0.02 * sh]);
  limb('arm', 'fore', 'hand', 'chest', [w * 0.95, -0.2 * L, -0.03 * sh]);
  const springs = [];
  const tn = B.tail > 1 ? 3 : 2; const tl = 0.3 * sh * B.tail / tn;
  for (let i = 0; i < tn; i++) {
    bones.push({ name: `tail${i + 1}`, parent: i ? `tail${i}` : 'hips', at: i ? v(0, tl, -tl * 0.45) : v(0, 0.02 * L, 0.05 * sh), tip: v(0, tl, -tl * 0.45) });
    parts.push({ bone: `tail${i + 1}`, shape: 'capsule', r: [r4(w * (B.round ? 0.2 : 0.42) * (1 - i * 0.25)), r4(w * (B.round ? 0.12 : 0.3) * (1 - i * 0.25))], color: B.round ? 'belly' : 'hide', group: 'tail' });
  }
  springs.push({ bones: Array.from({ length: tn }, (_, i) => `tail${i + 1}`), stiffness: 50, damping: 5, gravity: 2, maxAngle: 60 });

  // ---- motion: plain keyframes ----
  const T = 0.5 + 0.35 * Math.sqrt(sh); const R = T * 0.6; const a = 24; const g = 36;
  const swing = (t0, amp, d) => keys([[0, amp * t0, 0, 0], [d / 2, -amp * t0, 0, 0], [d, amp * t0, 0, 0]]);
  const bend = (t0, d, deep) => (t0 > 0 ? keys([[0, -6, 0, 0], [d / 2, -6, 0, 0], [d * 0.75, -deep, 0, 0], [d, -6, 0, 0]]) : keys([[0, -6, 0, 0], [d * 0.25, -deep, 0, 0], [d / 2, -6, 0, 0], [d, -6, 0, 0]]));
  const gait = (d, amp, deep, gallop) => {
    const tr = {};
    for (const [bone, lower, ph] of [['thighL', 'shinL', 1], ['thighR', 'shinR', gallop ? 1 : -1], ['armL', 'foreL', gallop ? -1 : -1], ['armR', 'foreR', gallop ? -1 : 1]]) { tr[bone] = swing(ph, amp, d); tr[lower] = bend(ph, d, deep); }
    tr.root = keys([[0, 0, 0, 0], [d / 4, 0, 0, -0.03 * sh * (gallop ? 2 : 1)], [d / 2, 0, 0, 0], [d * 0.75, 0, 0, -0.03 * sh * (gallop ? 2 : 1)], [d, 0, 0, 0]]);
    tr.spine = gallop ? keys([[0, 5, 0, 0], [d / 2, -5, 0, 0], [d, 5, 0, 0]]) : keys([[0, 0, 0, 3], [d / 2, 0, 0, -3], [d, 0, 0, 3]]);
    return tr;
  };
  const drop = hipsZ - rb * 0.9;
  const clips = {
    idle: { duration: 3.2, tracks: { head: keys([[0, 0, 0, 0], [1.6, 4, 0, 5], [3.2, 0, 0, 0]]), neck: keys([[0, 0, 0, 0], [1.6, -3, 0, 0], [3.2, 0, 0, 0]]) } },
    walk: { duration: r4(T), tracks: gait(T, a, 34, false), events: [[r4(T * 0.25), 'step'], [r4(T * 0.75), 'step']], meta: { stride: r4(4 * leg * Math.sin(a * Math.PI / 180)) } },
    run: { duration: r4(R), tracks: gait(R, g, 55, true), events: [[r4(R * 0.5), 'step']], meta: { stride: r4(4 * leg * Math.sin(g * Math.PI / 180) * 1.5) } },
    attack: { duration: 0.5, loop: false, tracks: { neck: keys([[0, 0, 0, 0], [0.15, 22, 0, 0, 'out'], [0.28, -30, 0, 0, 'in'], [0.5, 0, 0, 0]]), head: keys([[0, 0, 0, 0], [0.15, 12, 0, 0], [0.28, -16, 0, 0], [0.5, 0, 0, 0]]) }, events: [[0.28, 'hit']] },
    wave: { duration: 1, tracks: { head: keys([[0, 0, 0, 0], [0.25, 0, 0, 14], [0.75, 0, 0, -14], [1, 0, 0, 0]]) } },
    hurt: { duration: 0.35, loop: false, tracks: { spine: keys([[0, 0, 0, 0], [0.1, -9, 0, 0, 'out'], [0.35, 0, 0, 0]]), root: keys([[0, 0, 0, 0], [0.1, 0, 0.1 * sh, 0, 'out'], [0.35, 0, 0, 0]]) }, events: [[0, 'hurt']] },
    die: { duration: 0.8, loop: false, tracks: { hips: keys([[0, 0, 0, 0], [0.8, 0, 84, 0, 'bounce']]), root: keys([[0, 0, 0, 0], [0.8, 0, 0, -drop, 'in']]), thighL: keys([[0, 0, 0, 0], [0.8, 25, 0, 0]]), armL: keys([[0, 0, 0, 0], [0.8, -20, 0, 0]]) }, events: [[0.62, 'thud']] },
  };

  const hide = c.pick(look, B.hide);
  const colors = { hide, belly: c.shade(hide, 0.3), eye: c.pick(look, ['flame', 'ember', 'gold', 'ink'], [hide], 2.4), nose: 'ink~night~0.4', horn: 'bone', mane: c.shade(hide, -0.4) };
  const top = hipsZ + nl * 0.55 + hl * (0.3 + 0.5 * B.ears) + 0.04 * sh;
  const def = { name: type, bones, parts, colors: {}, slots: { head: { bone: 'head', at: v(0, -hl * 0.2, hl * 0.3) }, back: { bone: 'spine', at: v(0, -0.1 * L, rb) } }, chains: { legL: ['thighL', 'shinL', 'footL'], legR: ['thighR', 'shinR', 'footR'], armL: ['armL', 'foreL', 'handL'], armR: ['armR', 'foreR', 'handR'] }, springs, meta: { height: r4(top), plan: 'fourLegged', shoulder: sh, length: r4(L) } };
  return { model: { def, equipment: {}, animator: machine(clips, 'neck') }, colors, facts: { plan: 'fourLegged', bodyHeight: r4(top), shoulder: sh, range: [B.shoulder[0] * ctx.size, B.shoulder[1] * ctx.size * 1.9] }, features: [B.tusks ? 'tusks' : null, B.mane ? 'mane' : null, 'tail'].filter(Boolean) };
}

function slime(ctx) {
  const body = ctx.rng('body'); const look = ctx.rng('palette'); const c = ctx.colors;
  const h = r4(body.range(0.55, 1.0) * ctx.size); const w = h * body.range(0.62, 0.8);
  const v = (x, y, z) => [r4(x), r4(y), r4(z)];
  const bones = [
    { name: 'body', at: v(0, 0, 0), tip: v(0, 0, h * 0.4) },
    { name: 'mid', parent: 'body', at: v(0, 0, h * 0.4), tip: v(0, 0, h * 0.3) },
    { name: 'head', parent: 'mid', at: v(0, 0, h * 0.3), tip: v(0, 0, h * 0.25) },
  ];
  const parts = [
    { bone: 'body', shape: 'ball', at: v(0, 0, h * 0.3), r: v(w, w, h * 0.32), color: 'jelly', group: 'torso' },
    { bone: 'mid', shape: 'ball', at: v(0, 0, h * 0.08), r: v(w * 0.82, w * 0.82, h * 0.3), color: 'jelly', group: 'torso' },
    { bone: 'head', shape: 'ball', at: v(0, 0, h * 0.02), r: v(w * 0.56, w * 0.56, h * 0.24), color: 'jelly', group: 'head' },
    { bone: 'mid', shape: 'ball', at: v(0, w * 0.1, 0), r: v(w * 0.3, w * 0.3, h * 0.14), color: 'core', group: 'core' },
    { bone: 'head', shape: 'ball', at: v(-w * 0.2, -w * 0.38, h * 0.12), r: v(w * 0.16, w * 0.05, h * 0.05), color: 'shine', flat: true, group: 'face', bias: 0.02 },
  ];
  for (const s of [1, -1]) parts.push({ bone: 'mid', shape: 'ball', at: v(s * w * 0.3, -w * 0.72, h * 0.12), r: v(w * 0.09, w * 0.05, h * 0.08), color: 'eye', flat: true, group: 'face', bias: 0.03 });
  const blobs = body.int(0, 3);
  for (let i = 0; i < blobs; i++) { const a = body.range(0, 6.28); parts.push({ bone: 'body', shape: 'ball', at: v(Math.cos(a) * w * 0.95, Math.sin(a) * w * 0.95, h * 0.1), r: v(w * 0.25, w * 0.25, h * 0.1), color: 'jelly', group: 'torso' }); }
  const hop = 0.75;
  const clips = {
    idle: { duration: 3, tracks: { mid: keys([[0, 0, 0, 0], [0.75, 4, 0, 3], [1.5, 0, 0, 0], [2.25, -4, 0, -3], [3, 0, 0, 0]]) } },
    walk: { duration: hop, tracks: { root: keys([[0, 0, 0, 0], [0.22, 0, 0, 0], [0.48, 0, 0, h * 0.4, 'out'], [hop, 0, 0, 0, 'in']]), mid: keys([[0, 0, 0, 0], [0.22, -16, 0, 0], [0.48, 9, 0, 0], [hop, 0, 0, 0]]), head: keys([[0, 0, 0, 0], [0.22, -10, 0, 0], [0.48, 12, 0, 0], [hop, 0, 0, 0]]) }, events: [[r4(hop - 0.02), 'step']], meta: { stride: r4(h * 1.1) } },
    run: { duration: 0.5, tracks: { root: keys([[0, 0, 0, 0], [0.12, 0, 0, 0], [0.3, 0, 0, h * 0.6, 'out'], [0.5, 0, 0, 0, 'in']]), mid: keys([[0, 0, 0, 0], [0.12, -22, 0, 0], [0.3, 12, 0, 0], [0.5, 0, 0, 0]]) }, events: [[0.48, 'step']], meta: { stride: r4(h * 1.9) } },
    attack: { duration: 0.55, loop: false, tracks: { mid: keys([[0, 0, 0, 0], [0.15, 18, 0, 0, 'out'], [0.3, -36, 0, 0, 'in'], [0.55, 0, 0, 0]]), head: keys([[0, 0, 0, 0], [0.15, 12, 0, 0], [0.3, -22, 0, 0], [0.55, 0, 0, 0]]) }, events: [[0.3, 'hit']] },
    wave: { duration: 0.8, tracks: { head: keys([[0, 0, 0, 0], [0.2, 0, 16, 0], [0.6, 0, -16, 0], [0.8, 0, 0, 0]]) } },
    hurt: { duration: 0.3, loop: false, tracks: { mid: keys([[0, 0, 0, 0], [0.08, 20, 0, 0, 'out'], [0.3, 0, 0, 0]]) }, events: [[0, 'hurt']] },
    die: { duration: 0.7, loop: false, tracks: { root: keys([[0, 0, 0, 0], [0.7, 0, 0, -h * 0.22, 'in']]), mid: keys([[0, 0, 0, 0], [0.7, 0, 62, 0]]), head: keys([[0, 0, 0, 0], [0.7, 0, 50, 0]]) }, events: [[0.6, 'thud']] },
  };
  const word = (ctx.traits.colors[0] && c.word(look, ctx.traits.colors[0])) || null;
  const jelly = word ?? c.pick(look, ['slime', 'slime~leaf~0.4', 'sky~slime~0.4', 'pink~plum~0.3', 'ember~gold~0.4', 'plum~sky~0.3']);
  const colors = { jelly, core: c.shade(jelly, -0.3), shine: c.shade(jelly, 0.55), eye: c.pick(look, ['ink', 'ink~night~0.4', 'white'], [jelly], 2.5) };
  const top = r4(h * 0.96);
  const def = { name: 'slime', bones, parts, colors: {}, slots: { head: { bone: 'head', at: v(0, 0, h * 0.2) } }, chains: {}, springs: [{ bones: ['mid', 'head'], stiffness: 55, damping: 4, gravity: 0, maxAngle: 28 }], meta: { height: top, plan: 'blob' } };
  return { model: { def, equipment: {}, animator: machine(clips, 'mid') }, colors, facts: { plan: 'blob', bodyHeight: top, range: [0.5 * ctx.size, 1.05 * ctx.size] }, features: ['jiggle', blobs ? `${blobs} droplets` : null].filter(Boolean) };
}

function bat(ctx) {
  const body = ctx.rng('body'); const look = ctx.rng('palette'); const c = ctx.colors;
  const b = r4(body.range(0.2, 0.34) * ctx.size); const wl = b * body.range(1.5, 2.1); const fly = r4(body.range(1.2, 1.7));
  const v = (x, y, z) => [r4(x), r4(y), r4(z)];
  const bones = [{ name: 'body', at: v(0, 0, fly), tip: v(0, 0, -b) }, { name: 'head', parent: 'body', at: v(0, -b * 0.15, b * 0.45), tip: v(0, -b * 0.4, 0) }];
  const parts = [
    { bone: 'body', shape: 'ball', at: v(0, 0, -b * 0.2), r: v(b * 0.42, b * 0.4, b * 0.62), color: 'hide', group: 'torso' },
    { bone: 'head', shape: 'ball', at: v(0, -b * 0.05, b * 0.05), r: r4(b * 0.36), color: 'hide', group: 'head' },
  ];
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    bones.push({ name: `wing${side}1`, parent: 'body', at: v(s * b * 0.3, 0, 0), tip: v(s * wl * 0.55, 0, 0) }, { name: `wing${side}2`, parent: `wing${side}1`, at: v(s * wl * 0.55, 0, 0), tip: v(s * wl * 0.45, 0, 0) });
    parts.push(
      { bone: `wing${side}1`, shape: 'ball', at: v(s * wl * 0.27, 0, -b * 0.18), r: v(wl * 0.3, b * 0.03, b * 0.5), color: 'wing', group: 'wings' },
      { bone: `wing${side}2`, shape: 'ball', at: v(s * wl * 0.2, 0, -b * 0.12), r: v(wl * 0.25, b * 0.03, b * 0.38), color: 'wing', group: 'wings' },
      { bone: `wing${side}1`, shape: 'capsule', r: [r4(b * 0.07), r4(b * 0.04)], color: 'hide', group: 'wings' },
      { bone: 'head', shape: 'capsule', at: v(s * b * 0.2, 0, b * 0.28), to: v(s * b * 0.32, 0, b * 0.72), r: [r4(b * 0.14), r4(b * 0.02)], color: 'hide', group: 'ears' },
      { bone: 'head', shape: 'ball', at: v(s * b * 0.15, -b * 0.33, b * 0.1), r: r4(b * 0.075), color: 'eye', flat: true, group: 'face', bias: 0.02 },
    );
  }
  const flap = (d, up, down) => {
    const tr = { root: keys([[0, 0, 0, 0], [d / 2, 0, 0, b * 0.25], [d, 0, 0, 0]]) };
    for (const [side, s] of [['L', 1], ['R', -1]]) { tr[`wing${side}1`] = keys([[0, 0, s * up, 0], [d / 2, 0, -s * down, 0], [d, 0, s * up, 0]]); tr[`wing${side}2`] = keys([[0, 0, s * up * 0.5, 0], [d * 0.6, 0, -s * down * 0.8, 0], [d, 0, s * up * 0.5, 0]]); }
    return tr;
  };
  const clips = {
    idle: { duration: 0.34, tracks: flap(0.34, 32, 38) },
    walk: { duration: 0.28, tracks: flap(0.28, 36, 42), meta: { stride: r4(wl * 0.5) } },
    run: { duration: 0.2, tracks: flap(0.2, 40, 46), meta: { stride: r4(wl * 0.9) } },
    attack: { duration: 0.45, loop: false, tracks: { head: keys([[0, 0, 0, 0], [0.12, 20, 0, 0, 'out'], [0.25, -28, 0, 0, 'in'], [0.45, 0, 0, 0]]) }, events: [[0.25, 'hit']] },
    wave: { duration: 0.6, tracks: { head: keys([[0, 0, 0, 0], [0.15, 0, 0, 18], [0.45, 0, 0, -18], [0.6, 0, 0, 0]]) } },
    hurt: { duration: 0.3, loop: false, tracks: { body: keys([[0, 0, 0, 0], [0.08, 25, 0, 0, 'out'], [0.3, 0, 0, 0]]) }, events: [[0, 'hurt']] },
    die: { duration: 0.7, loop: false, tracks: { root: keys([[0, 0, 0, 0], [0.7, 0, 0, -(fly - b * 0.4), 'in']]), body: keys([[0, 0, 0, 0], [0.7, 80, 0, 0]]), wingL1: keys([[0, 0, 0, 0], [0.7, 0, -60, 0]]), wingR1: keys([[0, 0, 0, 0], [0.7, 0, 60, 0]]) }, events: [[0.68, 'thud']] },
  };
  const hide = c.pick(look, ['night', 'ink~night~0.4', 'plum~ink~0.4', 'wood~ink~0.45', 'stone~ink~0.4']);
  const colors = { hide, wing: c.pick(look, [c.shade(hide, 0.25), 'plum', 'roof', 'night~plum~0.5'], [hide], 1.15), eye: c.pick(look, ['flame', 'ember', 'red', 'gold'], [hide], 3) };
  const top = r4(fly + b * 1.2);
  const def = { name: 'bat', bones, parts, colors: {}, slots: { head: { bone: 'head', at: v(0, 0, b * 0.3) } }, chains: {}, springs: [], meta: { height: top, plan: 'flyer', wingspan: r4(wl * 2 + b * 0.6), flyHeight: fly } };
  return { model: { def, equipment: {}, animator: machine(clips, 'head') }, colors, facts: { plan: 'flyer', bodyHeight: top, wingspan: def.meta.wingspan, range: [1.3, 2.4] }, features: ['flies', `wingspan ${def.meta.wingspan} m`] };
}

export const BEAST_TYPES = [...Object.keys(BEASTS), 'slime', 'bat'];

/** Make a creature that is not two-legged. Returns { model: { def, equipment, animator }, colors, facts, features }. */
export function makeBeast(ctx, type) {
  if (BEASTS[type]) return fourLegged(ctx, type);
  if (type === 'slime') return slime(ctx);
  if (type === 'bat') return bat(ctx);
  throw new Error(`makeBeast: unknown type "${type}". Known: ${BEAST_TYPES.join(', ')}`);
}
