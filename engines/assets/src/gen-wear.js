// Things a two-legged body can wear or grow: hair, hoods, robes, armour, capes, tails, horns.
// Each piece adds parts (and sometimes spring bones) to a rig description from gen-body.js.
// Sizes are fractions of the body height H, so every piece fits every body. Colour names
// (hair, cloth, metal, trim ...) are filled in by the character maker.

const r4 = (v) => Math.round(v * 10000) / 10000;

function kit(def) {
  const H = def.meta.height; const hd = def.meta.headSize; const k = def.meta.bulk; const t = def.meta.torso;
  const v = (x, y, z) => [r4(x * H), r4(y * H), r4(z * H)];
  const part = (bone, shape, o) => { def.parts.push({ bone, shape, ...o }); };
  return { H, hd, k, t, v, part };
}

/** A chain of spring bones hanging from `parent` (capes, tails, rags). `links` are [dy, dz] steps as fractions of H. */
function chain(def, name, parent, at, links, spring) {
  const H = def.meta.height;
  const names = [];
  let from = at.map((x) => r4(x * H));
  links.forEach(([dy, dz], i) => {
    const tip = [0, r4(dy * H), r4(dz * H)];
    def.bones.push({ name: `${name}${i + 1}`, parent: i ? `${name}${i}` : parent, at: from, tip });
    names.push(`${name}${i + 1}`);
    from = tip;
  });
  def.springs.push({ bones: names, ...spring });
  return names;
}

export const WEAR = {
  hair(def, style) {
    const { hd, v, part } = kit(def);
    if (style === 'bald') return;
    part('head', 'ball', { at: v(0, 0.016 * hd, 0.088 * hd), r: v(0.072 * hd, 0.072 * hd, 0.072 * hd), color: 'hair', group: 'hair' });
    if (style === 'long') part('head', 'ball', { at: v(0, 0.05 * hd, 0.03 * hd), r: v(0.068 * hd, 0.04 * hd, 0.095 * hd), color: 'hair', group: 'hair' });
    if (style === 'bun') part('head', 'ball', { at: v(0, 0.045 * hd, 0.15 * hd), r: r4(0.032 * hd * def.meta.height), color: 'hair', group: 'hair' });
    if (style === 'tail') {
      const names = chain(def, 'pony', 'head', [0, 0.07 * hd, 0.11 * hd], [[0.03, -0.07], [0.01, -0.07]], { stiffness: 60, damping: 6, gravity: 2.5, maxAngle: 60 });
      names.forEach((n, i) => part(n, 'capsule', { r: [r4((0.026 - i * 0.006) * hd * def.meta.height), r4((0.02 - i * 0.008) * hd * def.meta.height)], color: 'hair', group: 'hair' }));
    }
    if (style === 'mohawk') part('head', 'ball', { at: v(0, 0.01 * hd, 0.15 * hd), r: v(0.014 * hd, 0.07 * hd, 0.04 * hd), color: 'hair', group: 'hair' });
  },
  beard(def) { const { hd, v, part } = kit(def); part('head', 'ball', { at: v(0, -0.05 * hd, 0.022 * hd), r: v(0.05 * hd, 0.034 * hd, 0.058 * hd), color: 'hair', group: 'beard' }); },
  hood(def) {
    const { hd, v, part } = kit(def);
    part('head', 'ball', { at: v(0, 0.014 * hd, 0.08 * hd), r: v(0.082 * hd, 0.086 * hd, 0.092 * hd), color: 'cloth', group: 'hood' });
    part('neck', 'ball', { at: v(0, 0.01, 0.005), r: v(0.105, 0.075, 0.045), color: 'cloth', group: 'hood' });
  },
  skirt(def) { const { k, t, v, part } = kit(def); part('hips', 'ball', { at: v(0, 0, 0.005), r: v(0.108 * k, 0.078 * k, 0.085 * t), color: 'top', group: 'torso' }); },
  robe(def) {
    const { H, k, v, part } = kit(def);
    part('hips', 'capsule', { at: v(0, 0, 0.03), to: v(0, 0, -0.27), r: [r4(0.092 * k * H), r4(0.128 * k * H)], color: 'top', group: 'torso' });
    part('chest', 'ball', { at: v(0, -0.02, 0.01), r: v(0.03, 0.062 * k, 0.11), color: 'trim', group: 'torso' });
  },
  apron(def) { const { k, v, part } = kit(def); part('spine', 'ball', { at: v(0, -0.045 * k, -0.02), r: v(0.078 * k, 0.03, 0.13), color: 'apron', group: 'torso' }); },
  belt(def) { const { k, v, part } = kit(def); part('spine', 'ball', { at: v(0, 0, 0.005), r: v(0.099 * k, 0.074 * k, 0.014), color: 'belt', group: 'torso' }); part('spine', 'box', { at: v(0, -0.072 * k, 0.005), size: v(0.028, 0.012, 0.026), color: 'trim', group: 'torso' }); },
  tabard(def) { const { k, t, v, part } = kit(def); part('chest', 'ball', { at: v(0, -0.032 * k, 0.03 * t), r: v(0.085 * k, 0.058 * k, 0.1 * t), color: 'cloth', group: 'torso' }); part('hips', 'ball', { at: v(0, -0.022 * k, -0.03), r: v(0.07 * k, 0.056 * k, 0.08), color: 'cloth', group: 'torso' }); },
  plate(def) {
    const { k, t, v, part } = kit(def);
    part('chest', 'ball', { at: v(0, -0.012 * k, 0.055 * t), r: v(0.128 * k, 0.086 * k, 0.1 * t), color: 'metal', group: 'torso' });
    for (const [side, s] of [['L', 1], ['R', -1]]) part(`arm${side}`, 'ball', { at: v(0.012 * s, 0, 0), r: v(0.058 * k, 0.055 * k, 0.05), color: 'metal', group: 'arms' });
  },
  greaves(def) {
    const { H, k, part } = kit(def);
    for (const side of ['L', 'R']) { part(`shin${side}`, 'capsule', { r: [r4(0.044 * k * H), r4(0.034 * k * H)], color: 'metal', group: 'legs' }); part(`fore${side}`, 'capsule', { r: [r4(0.036 * k * H), r4(0.03 * k * H)], color: 'metal', group: 'arms' }); }
  },
  cape(def, length = 1) {
    const { k, part, v } = kit(def);
    const names = chain(def, 'cape', 'chest', [0, 0.07 * k, 0.1 * def.meta.torso], [[0.02, -0.14 * length], [0.012, -0.14 * length], [0.008, -0.13 * length]], { stiffness: 26, damping: 5, gravity: 3.5, maxAngle: 70 });
    names.forEach((n, i) => part(n, 'ball', { at: v(0, 0.008, -0.07 * length), r: v((0.12 + i * 0.013) * k, 0.018, 0.085 * length), color: 'cape', group: 'cape' }));
  },
  rag(def) {
    const { k, part, v } = kit(def);
    const names = chain(def, 'rag', 'hips', [0, -0.045 * k, -0.01], [[-0.008, -0.1], [0, -0.1]], { stiffness: 40, damping: 5, gravity: 3, maxAngle: 60 });
    names.forEach((n, i) => part(n, 'ball', { at: v(0, 0, -0.05), r: v((0.07 - i * 0.015) * k, 0.014, 0.06), color: 'cloth', group: 'rag' }));
  },
  tail(def, length = 1) {
    const { H, part } = kit(def);
    const names = chain(def, 'tail', 'hips', [0, 0.05 * def.meta.bulk, 0], [[0.09 * length, -0.06 * length], [0.1 * length, -0.02 * length], [0.09 * length, 0.03 * length]], { stiffness: 45, damping: 5, gravity: 1.5, maxAngle: 55 });
    names.forEach((n, i) => part(n, 'capsule', { r: [r4((0.03 - i * 0.008) * H), r4((0.022 - i * 0.008) * H)], color: 'skin', group: 'tail' }));
  },
  horns(def, size = 1) {
    const { H, hd, v, part } = kit(def);
    for (const s of [1, -1]) part('head', 'capsule', { at: v(0.045 * hd * s, -0.01, 0.13 * hd), to: v(0.085 * hd * s * size, -0.03, (0.13 + 0.085 * size) * hd), r: [r4(0.02 * hd * H), r4(0.004 * H)], color: 'horn', group: 'horns' });
  },
  ears(def, size = 1) {
    const { H, hd, v, part } = kit(def);
    for (const s of [1, -1]) part('head', 'capsule', { at: v(0.06 * hd * s, 0, 0.08 * hd), to: v((0.06 + 0.075 * size) * hd * s, 0.02, 0.115 * hd), r: [r4(0.022 * hd * H), r4(0.004 * H)], color: 'skin', group: 'ears' });
  },
  tusks(def) {
    const { H, hd, v, part } = kit(def);
    part('head', 'box', { at: v(0, -0.062 * hd, 0.03 * hd), size: v(0.085 * hd, 0.04 * hd, 0.04 * hd), color: 'skin', group: 'head' });
    for (const s of [1, -1]) part('head', 'capsule', { at: v(0.03 * hd * s, -0.075 * hd, 0.035 * hd), to: v(0.034 * hd * s, -0.08 * hd, 0.075 * hd), r: [r4(0.01 * hd * H), r4(0.003 * H)], color: 'horn', group: 'face', bias: 0.02 });
  },
  mask(def) { const { hd, v, part } = kit(def); part('head', 'ball', { at: v(0, -0.03 * hd, 0.045 * hd), r: v(0.07 * hd, 0.058 * hd, 0.036 * hd), color: 'cloth', group: 'mask', bias: 0.01 }); },
  /** Skeleton torso: a spine, a ribcage with dark gaps, and a pelvis in place of the solid body. */
  ribs(def) {
    const { H, v, part } = kit(def);
    def.parts = def.parts.filter((p) => p.group !== 'torso');
    part('hips', 'ball', { at: v(0, 0, 0.005), r: v(0.082, 0.04, 0.04), color: 'skin', group: 'torso' });
    part('hips', 'capsule', { at: v(0, 0, 0.02), to: v(0, 0, 0.075), r: r4(0.02 * H), color: 'skin', group: 'torso' });
    part('spine', 'capsule', { r: r4(0.02 * H), color: 'skin', group: 'torso' });
    part('chest', 'ball', { at: v(0, 0, 0.05), r: v(0.095, 0.06, 0.085), color: 'skin', group: 'torso' });
    for (const [z, w] of [[0.078, 0.12], [0.047, 0.13], [0.016, 0.11]]) part('chest', 'box', { at: v(0, -0.058, z), size: v(w, 0.012, 0.012), color: 'eye', flat: true, group: 'torso', bias: 0.02 });
    part('head', 'box', { at: v(0, -0.07, 0.03), size: v(0.07, 0.03, 0.03), color: 'skin', group: 'head' });
  },
  /** Golem body: stone slabs over the chest, shoulders and fists, and a glowing core. */
  slabs(def) {
    const { k, v, part } = kit(def);
    part('chest', 'box', { at: v(0, 0, 0.06), size: v(0.27 * k, 0.17 * k, 0.17), color: 'top', group: 'torso' });
    part('spine', 'box', { at: v(0, 0, 0.03), size: v(0.2 * k, 0.14 * k, 0.1), color: 'legs', group: 'torso' });
    part('chest', 'ball', { at: v(0, -0.088 * k, 0.06), r: v(0.03, 0.012, 0.03), color: 'eye', flat: true, group: 'torso', bias: 0.03 });
    for (const [side, s] of [['L', 1], ['R', -1]]) { part(`arm${side}`, 'box', { at: v(0.01 * s, 0, -0.01), size: v(0.1 * k, 0.11 * k, 0.1), color: 'top', group: 'arms' }); part(`hand${side}`, 'box', { at: v(0, 0, -0.03), size: v(0.07 * k, 0.07 * k, 0.08), color: 'top', group: 'arms' }); }
    part('head', 'box', { at: v(0, 0, 0.075 * def.meta.headSize), size: v(0.15 * def.meta.headSize, 0.155 * def.meta.headSize, 0.15 * def.meta.headSize), color: 'top', group: 'head' });
  },
};

/** Head-slot items. `H` is the body height, `hd` its head size, `c` maps colour names to hex. */
export const HATS = {
  straw: (H, hd, c) => ({ name: 'strawHat', hides: ['hair'], colors: c, parts: [
    { shape: 'ball', at: [0, 0, r4(0.047 * hd * H)], r: [r4(0.114 * hd * H), r4(0.114 * hd * H), r4(0.013 * hd * H)], color: 'hat' },
    { shape: 'ball', at: [0, 0, r4(0.068 * hd * H)], r: [r4(0.064 * hd * H), r4(0.067 * hd * H), r4(0.045 * hd * H)], color: 'hat' },
    { shape: 'ball', at: [0, 0, r4(0.053 * hd * H)], r: [r4(0.067 * hd * H), r4(0.07 * hd * H), r4(0.011 * hd * H)], color: 'band' }] }),
  cap: (H, hd, c) => ({ name: 'cap', hides: ['hair'], colors: c, parts: [
    { shape: 'ball', at: [0, r4(0.004 * H), r4(0.05 * hd * H)], r: [r4(0.07 * hd * H), r4(0.074 * hd * H), r4(0.042 * hd * H)], color: 'hat' },
    { shape: 'ball', at: [0, r4(-0.06 * hd * H), r4(0.036 * hd * H)], r: [r4(0.05 * hd * H), r4(0.04 * hd * H), r4(0.008 * hd * H)], color: 'band' }] }),
  pointed: (H, hd, c) => ({ name: 'pointedHat', hides: ['hair'], colors: c, parts: [
    { shape: 'ball', at: [0, 0, r4(0.045 * hd * H)], r: [r4(0.105 * hd * H), r4(0.105 * hd * H), r4(0.012 * hd * H)], color: 'hat' },
    { shape: 'capsule', at: [0, 0, r4(0.05 * hd * H)], to: [0, r4(0.03 * hd * H), r4(0.2 * hd * H)], r: [r4(0.062 * hd * H), r4(0.006 * H)], color: 'hat' },
    { shape: 'ball', at: [0, 0, r4(0.056 * hd * H)], r: [r4(0.066 * hd * H), r4(0.068 * hd * H), r4(0.012 * hd * H)], color: 'band' }] }),
  helm: (H, hd, c) => ({ name: 'helm', hides: ['hair', 'face', 'ears', 'beard', 'mask'], colors: c, parts: [
    { shape: 'ball', at: [0, 0, r4(0.004 * hd * H)], r: [r4(0.076 * hd * H), r4(0.082 * hd * H), r4(0.088 * hd * H)], color: 'hat' },
    { shape: 'box', at: [0, r4(-0.075 * hd * H), r4(0.011 * hd * H)], size: [r4(0.092 * hd * H), r4(0.02 * hd * H), r4(0.017 * hd * H)], color: 'visor', flat: true, bias: 0.03 },
    { shape: 'box', at: [0, r4(-0.079 * hd * H), r4(-0.027 * hd * H)], size: [r4(0.013 * hd * H), r4(0.016 * hd * H), r4(0.064 * hd * H)], color: 'visor', flat: true, bias: 0.03 }] }),
  kettle: (H, hd, c) => ({ name: 'kettleHelm', hides: ['hair'], colors: c, parts: [
    { shape: 'ball', at: [0, 0, r4(0.04 * hd * H)], r: [r4(0.074 * hd * H), r4(0.078 * hd * H), r4(0.05 * hd * H)], color: 'hat' },
    { shape: 'ball', at: [0, 0, r4(0.035 * hd * H)], r: [r4(0.095 * hd * H), r4(0.098 * hd * H), r4(0.01 * hd * H)], color: 'hat' }] }),
  crown: (H, hd, c) => ({ name: 'crown', colors: c, parts: [
    { shape: 'ball', at: [0, r4(0.01 * H), r4(0.062 * hd * H)], r: [r4(0.062 * hd * H), r4(0.064 * hd * H), r4(0.014 * hd * H)], color: 'band' },
    ...[[-0.04, -0.035], [0, -0.055], [0.04, -0.035], [-0.05, 0.03], [0.05, 0.03]].map(([x, y]) => ({ shape: 'capsule', at: [r4(x * hd * H), r4((y + 0.01) * hd * H), r4(0.064 * hd * H)], to: [r4(x * hd * H), r4((y + 0.01) * hd * H), r4(0.1 * hd * H)], r: [r4(0.011 * hd * H), r4(0.003 * H)], color: 'band' }))] }),
  feather: (H, hd, c) => ({ name: 'featherCap', hides: ['hair'], colors: c, parts: [
    { shape: 'ball', at: [0, r4(0.006 * H), r4(0.052 * hd * H)], r: [r4(0.076 * hd * H), r4(0.08 * hd * H), r4(0.034 * hd * H)], color: 'hat' },
    { shape: 'capsule', at: [r4(0.05 * hd * H), 0, r4(0.06 * hd * H)], to: [r4(0.075 * hd * H), r4(0.06 * hd * H), r4(0.15 * hd * H)], r: [r4(0.012 * hd * H), r4(0.003 * H)], color: 'band' }] }),
};
