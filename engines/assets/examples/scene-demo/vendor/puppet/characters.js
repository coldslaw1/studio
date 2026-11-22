// The studio's three original characters as rigs, with their equipment. All shapes are built
// here from balls, capsules and boxes; nothing is taken from another game.
import { humanoid } from './humanoid.js';

/** Items: functions of the character height, so they fit any size. Equip with puppet.equip(slot, item). */
export const ITEMS = {
  /** Straw hat with a wide brim. Slot: head. */
  strawHat: (H = 1.8) => ({
    name: 'strawHat',
    hides: ['hair'],
    colors: { hat: '#d6a53c', band: '#8a3b2a' },
    parts: [
      { shape: 'ball', at: [0, 0, 0.052 * H], r: [0.125 * H, 0.125 * H, 0.014 * H], color: 'hat' },
      { shape: 'ball', at: [0, 0, 0.075 * H], r: [0.07 * H, 0.074 * H, 0.05 * H], color: 'hat' },
      { shape: 'ball', at: [0, 0, 0.058 * H], r: [0.074 * H, 0.078 * H, 0.012 * H], color: 'band' },
    ],
  }),
  /** Closed helm with a dark visor slit. Slot: head. Hides hair and face. */
  helm: (H = 1.8) => ({
    name: 'helm',
    hides: ['hair', 'face'],
    colors: { steel: '#a8b4c8', visor: '#1c1c2a' },
    parts: [
      { shape: 'ball', at: [0, 0, 0.004 * H], r: [0.083 * H, 0.09 * H, 0.096 * H], color: 'steel' },
      { shape: 'box', at: [0, -0.082 * H, 0.012 * H], size: [0.1 * H, 0.02 * H, 0.018 * H], color: 'visor', flat: true, bias: 0.03 },
      { shape: 'box', at: [0, -0.086 * H, -0.03 * H], size: [0.014 * H, 0.016 * H, 0.07 * H], color: 'visor', flat: true, bias: 0.03 },
    ],
  }),
  /** Straight sword, held point forward. Slot: handR or handL. */
  sword: (H = 1.8) => ({
    name: 'sword',
    colors: { blade: '#d2dae6', hilt: '#c8a03c', grip: '#5a3a22' },
    parts: [
      { shape: 'capsule', at: [0, 0.05 * H, 0], to: [0, -0.03 * H, 0], r: 0.014 * H, color: 'grip' },
      { shape: 'box', at: [0, -0.04 * H, 0], size: [0.1 * H, 0.02 * H, 0.024 * H], color: 'hilt' },
      { shape: 'capsule', at: [0, -0.05 * H, 0], to: [0, -0.42 * H, 0], r: [0.02 * H, 0.009 * H], color: 'blade' },
    ],
  }),
  /** Notched, rusted blade for the skeleton. Slot: handR or handL. */
  rustyBlade: (H = 1.8) => ({
    name: 'rustyBlade',
    colors: { blade: '#8c7a6a', grip: '#4a3626' },
    parts: [
      { shape: 'capsule', at: [0, 0.04 * H, 0], to: [0, -0.03 * H, 0], r: 0.013 * H, color: 'grip' },
      { shape: 'capsule', at: [0, -0.04 * H, 0], to: [0, -0.34 * H, 0.03 * H], r: [0.022 * H, 0.01 * H], color: 'blade' },
    ],
  }),
  /** Round-topped shield carried on the forearm. Slot: armL (or armR). */
  shield: (H = 1.8) => ({
    name: 'shield',
    colors: { shield: '#c8553d', rim: '#a8b4c8', boss: '#f4c542' },
    parts: [
      { shape: 'ball', at: [0.012 * H, 0, 0], r: [0.016 * H, 0.105 * H, 0.14 * H], color: 'rim' },
      { shape: 'ball', at: [0.02 * H, 0, 0], r: [0.016 * H, 0.09 * H, 0.125 * H], color: 'shield', bias: 0.01 },
      { shape: 'ball', at: [0.034 * H, 0, 0.01 * H], r: 0.026 * H, color: 'boss', bias: 0.02 },
    ],
  }),
  /** Walking staff. Slot: handR or handL. */
  staff: (H = 1.8) => ({
    name: 'staff',
    colors: { wood: '#8a5a33' },
    parts: [{ shape: 'capsule', at: [0, 0, -0.38 * H], to: [0, -0.02 * H, 0.5 * H], r: 0.013 * H, color: 'wood' }],
  }),
};

/** Villager: tunic with a skirt, belt, hair, straw hat. Colours: skin, top, sleeve, legs, shoe, hair, belt. */
export function villager(o = {}) {
  const H = o.height ?? 1.8;
  const def = humanoid({ ...o, name: 'villager', colors: { hair: '#5a3a22', belt: '#4a3020', ...(o.colors ?? {}) } });
  def.parts.push(
    { bone: 'hips', shape: 'ball', at: [0, 0, 0.005 * H], r: [0.108 * H, 0.078 * H, 0.085 * H], color: 'top', group: 'torso' },
    { bone: 'spine', shape: 'ball', at: [0, 0, 0.005 * H], r: [0.099 * H, 0.074 * H, 0.014 * H], color: 'belt', group: 'torso' },
    { bone: 'head', shape: 'ball', at: [0, 0.018 * H, 0.09 * H], r: [0.074 * H, 0.074 * H, 0.076 * H], color: 'hair', group: 'hair' },
  );
  return { def, equipment: { head: ITEMS.strawHat(H) } };
}

/**
 * Knight: steel plate, cloth tabard, a cape and a helmet plume that swing on springs, sword and shield.
 * Colours: steel, cloth, cape, plume, skin.
 */
export function knight(o = {}) {
  const H = o.height ?? 1.8;
  const colors = { steel: '#a8b4c8', cloth: '#963c3c', cape: '#6b2737', plume: '#d9483b', top: '#a8b4c8', sleeve: '#a8b4c8', legs: '#8f9bb0', shoe: '#6f7b90', skin: '#8f9bb0', ...(o.colors ?? {}) };
  const def = humanoid({ bulk: 1.12, ...o, name: 'knight', colors });
  def.bones.push(
    { name: 'cape1', parent: 'chest', at: [0, 0.07 * H, 0.1 * H], tip: [0, 0.02 * H, -0.14 * H] },
    { name: 'cape2', parent: 'cape1', at: [0, 0.02 * H, -0.14 * H], tip: [0, 0.012 * H, -0.14 * H] },
    { name: 'cape3', parent: 'cape2', at: [0, 0.012 * H, -0.14 * H], tip: [0, 0.008 * H, -0.13 * H] },
    { name: 'plume1', parent: 'head', at: [0, 0.01 * H, 0.165 * H], tip: [0, 0.05 * H, 0.05 * H] },
    { name: 'plume2', parent: 'plume1', at: [0, 0.05 * H, 0.05 * H], tip: [0, 0.07 * H, -0.02 * H] },
  );
  def.parts.push(
    { bone: 'chest', shape: 'ball', at: [0, -0.03 * H, 0.03 * H], r: [0.09 * H, 0.062 * H, 0.1 * H], color: 'cloth', group: 'torso' },
    { bone: 'hips', shape: 'ball', at: [0, -0.02 * H, -0.03 * H], r: [0.075 * H, 0.06 * H, 0.08 * H], color: 'cloth', group: 'torso' },
    { bone: 'armL', shape: 'ball', at: [0.012 * H, 0, 0], r: [0.058 * H, 0.055 * H, 0.05 * H], color: 'steel', group: 'arms' },
    { bone: 'armR', shape: 'ball', at: [-0.012 * H, 0, 0], r: [0.058 * H, 0.055 * H, 0.05 * H], color: 'steel', group: 'arms' },
    { bone: 'cape1', shape: 'ball', at: [0, 0.01 * H, -0.07 * H], r: [0.12 * H, 0.018 * H, 0.085 * H], color: 'cape', group: 'cape' },
    { bone: 'cape2', shape: 'ball', at: [0, 0.006 * H, -0.07 * H], r: [0.135 * H, 0.018 * H, 0.085 * H], color: 'cape', group: 'cape' },
    { bone: 'cape3', shape: 'ball', at: [0, 0.004 * H, -0.065 * H], r: [0.145 * H, 0.018 * H, 0.08 * H], color: 'cape', group: 'cape' },
    { bone: 'plume1', shape: 'capsule', r: [0.018 * H, 0.026 * H], color: 'plume', group: 'plume' },
    { bone: 'plume2', shape: 'capsule', r: [0.026 * H, 0.012 * H], color: 'plume', group: 'plume' },
  );
  def.springs.push(
    { bones: ['cape1', 'cape2', 'cape3'], stiffness: 26, damping: 5, gravity: 3.5, maxAngle: 70 },
    { bones: ['plume1', 'plume2'], stiffness: 90, damping: 7, gravity: 1.2, maxAngle: 50 },
  );
  const steel = { steel: colors.steel };
  return { def, equipment: { head: { ...ITEMS.helm(H), colors: { ...ITEMS.helm(H).colors, ...steel } }, handR: ITEMS.sword(H), armL: ITEMS.shield(H) } };
}

/** Skeleton: bare bones, dark eye sockets, a ribcage, a rag at the hips that swings, a rusted blade. Colours: bone, socket, rag. */
export function skeleton(o = {}) {
  const H = o.height ?? 1.8;
  const bone = o.colors?.bone ?? '#e6e0c8';
  const colors = { bone, skin: bone, top: bone, sleeve: bone, legs: bone, shoe: bone, socket: '#1e1a28', rag: '#6b3a3a', ...(o.colors ?? {}) };
  const def = humanoid({ bulk: 0.46, head: 1.12, ...o, name: 'skeleton', face: false, colors });
  // swap the solid torso for a spine, ribcage and pelvis
  def.parts = def.parts.filter((p) => p.group !== 'torso');
  def.bones.push(
    { name: 'rag1', parent: 'hips', at: [0, -0.045 * H, -0.01 * H], tip: [0, -0.008 * H, -0.1 * H] },
    { name: 'rag2', parent: 'rag1', at: [0, -0.008 * H, -0.1 * H], tip: [0, 0, -0.1 * H] },
  );
  def.parts.push(
    { bone: 'hips', shape: 'ball', at: [0, 0, 0.005 * H], r: [0.082 * H, 0.04 * H, 0.04 * H], color: 'bone', group: 'torso' },
    { bone: 'hips', shape: 'capsule', at: [0, 0, 0.02 * H], to: [0, 0, 0.075 * H], r: 0.02 * H, color: 'bone', group: 'torso' },
    { bone: 'spine', shape: 'capsule', r: 0.02 * H, color: 'bone', group: 'torso' },
    { bone: 'chest', shape: 'ball', at: [0, 0, 0.05 * H], r: [0.095 * H, 0.06 * H, 0.085 * H], color: 'bone', group: 'torso' },
    { bone: 'chest', shape: 'box', at: [0, -0.058 * H, 0.075 * H], size: [0.12 * H, 0.012 * H, 0.012 * H], color: 'socket', flat: true, group: 'torso', bias: 0.02 },
    { bone: 'chest', shape: 'box', at: [0, -0.06 * H, 0.045 * H], size: [0.13 * H, 0.012 * H, 0.012 * H], color: 'socket', flat: true, group: 'torso', bias: 0.02 },
    { bone: 'chest', shape: 'box', at: [0, -0.056 * H, 0.015 * H], size: [0.11 * H, 0.012 * H, 0.012 * H], color: 'socket', flat: true, group: 'torso', bias: 0.02 },
    { bone: 'head', shape: 'ball', at: [0.03 * H, -0.068 * H, 0.09 * H], r: [0.021 * H, 0.014 * H, 0.024 * H], color: 'socket', flat: true, group: 'face', bias: 0.02 },
    { bone: 'head', shape: 'ball', at: [-0.03 * H, -0.068 * H, 0.09 * H], r: [0.021 * H, 0.014 * H, 0.024 * H], color: 'socket', flat: true, group: 'face', bias: 0.02 },
    { bone: 'head', shape: 'box', at: [0, -0.07 * H, 0.03 * H], size: [0.07 * H, 0.03 * H, 0.03 * H], color: 'bone', group: 'head' },
    { bone: 'rag1', shape: 'ball', at: [0, 0, -0.05 * H], r: [0.07 * H, 0.014 * H, 0.06 * H], color: 'rag', group: 'rag' },
    { bone: 'rag2', shape: 'ball', at: [0, 0, -0.05 * H], r: [0.055 * H, 0.014 * H, 0.06 * H], color: 'rag', group: 'rag' },
  );
  def.springs.push({ bones: ['rag1', 'rag2'], stiffness: 40, damping: 5, gravity: 3, maxAngle: 60 });
  return { def, equipment: { handR: ITEMS.rustyBlade(H) } };
}

/** The built-in characters by name: each is (options) => { def, equipment }. */
export const MODELS = { villager, knight, skeleton };
