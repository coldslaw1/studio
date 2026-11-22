// A puppet is one character on screen: a rig plus its own pose, place in the world, facing,
// colours, equipment and modifiers (IK, springs). Renderers ask it for its shapes.
import { createRig, copyPose, checkPart } from './rig.js';
import { add, apply, mul, euler, rotZ, scale as scaleV } from './math.js';

/**
 * @param {object} rigOrDef  A rig from createRig, or a rig description.
 * @param {object} [opts]
 * @param {Object<string,string>} [opts.colors]    Colour overrides by name, e.g. { tunic: '#aa3333' }.
 * @param {Object<string,object>} [opts.equipment] Items to equip at once: { slotName: item }.
 * @param {string[]} [opts.hidden]                 Part groups to hide at the start.
 * @param {number[]} [opts.position]               World position of the ground point between the feet.
 * @param {number} [opts.yaw]                      Facing in degrees: 0 faces -y, positive turns left (see yawFromVelocity).
 * @param {number} [opts.scale]                    Size multiplier (default 1).
 * @returns {object} puppet
 */
export function createPuppet(rigOrDef, opts = {}) {
  const rig = rigOrDef && typeof rigOrDef.solve === 'function' ? rigOrDef : createRig(rigOrDef);
  const colors = { ...rig.colors, ...(opts.colors ?? {}) };
  const equipment = {};
  const hidden = new Set(opts.hidden ?? []);
  const modifiers = [];
  const pose = rig.createPose();
  const puppet = {
    rig,
    /** The pose shown by the last update. Write to it directly (or pass a pose to update) when not using an animator. */
    pose,
    /** Bone positions and rotations after the last update, in the character's own space. */
    solved: rig.solve(pose),
    position: (opts.position ?? [0, 0, 0]).slice(),
    yaw: opts.yaw ?? 0,
    scale: opts.scale ?? 1,
    colors,
    /** Counts updates and changes, so renderers know when to redraw. */
    version: 0,
    /**
     * Put an item in a slot (replacing what was there). An item is
     * { name, parts: [...], hides?: [groups], colors?: {name: hex} }. Item parts are placed in the
     * slot's frame unless they name their own "bone" (armour pieces).
     */
    equip(slot, item) {
      if (!rig.slots[slot]) throw new Error(`puppet.equip: no slot "${slot}". Slots: ${Object.keys(rig.slots).join(', ') || 'none'}`);
      if (!item || !Array.isArray(item.parts)) throw new Error(`puppet.equip("${slot}"): an item needs a "parts" list`);
      item.parts.forEach((p, i) => checkPart(p, `puppet.equip("${slot}"): item "${item.name ?? '?'}" parts[${i}]`, rig.has, false));
      equipment[slot] = item;
      puppet.version++;
      return puppet;
    },
    /** Empty a slot. Returns the item that was in it, or null. */
    unequip(slot) {
      if (!rig.slots[slot]) throw new Error(`puppet.unequip: no slot "${slot}"`);
      const was = equipment[slot] ?? null;
      delete equipment[slot];
      puppet.version++;
      return was;
    },
    /** The item in a slot, or null. */
    equipped(slot) { return equipment[slot] ?? null; },
    /** Show or hide every part in a group (parts carry an optional "group" name). */
    show(group, visible = true) { if (visible) hidden.delete(group); else hidden.add(group); puppet.version++; return puppet; },
    setColor(name, hex) { colors[name] = hex; puppet.version++; return puppet; },
    /** Add a modifier (createFootIk, createSprings, createLookAt, createReach, or any { step(ctx) }). They run in the order added. */
    use(modifier) {
      if (!modifier || typeof modifier.step !== 'function') throw new Error('puppet.use: a modifier must have a step(ctx) function');
      modifiers.push(modifier);
      return puppet;
    },
    /**
     * Take a pose (default: puppet.pose as it is), work out where every bone is, then run the modifiers.
     * Call once per frame after the animator: puppet.update(dt, animator.pose).
     */
    update(dt = 0, newPose = null) {
      if (!(dt >= 0)) throw new Error(`puppet.update: dt must be seconds >= 0, got ${dt}`);
      if (newPose) copyPose(pose, newPose);
      rig.solve(pose, puppet.solved);
      const ctx = { rig, puppet, pose, solved: puppet.solved, dt };
      for (const m of modifiers) m.step(ctx);
      puppet.version++;
      return puppet;
    },
    /** World position of a bone's start (or its tip with `tip` true). Handy for effects: sparks at the sword, dust at a foot. */
    worldOf(bone, tip = false) {
      const i = rig.boneIndex(bone, 'puppet.worldOf');
      const p = tip ? rig.tipOf(puppet.solved, i) : puppet.solved.pos[i];
      return add(puppet.position, scaleV(apply(rotZ(puppet.yaw), p), puppet.scale));
    },
    /** Resolve a colour name to a hex string: puppet colours first, then the given palette, else the name itself if it is a hex. */
    colorOf(name, palette = null, itemColors = null) {
      const c = itemColors?.[name] ?? colors[name] ?? palette?.[name] ?? name;
      if (typeof c !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) throw new Error(`puppet: unknown colour "${name}". Known: ${Object.keys(colors).join(', ')}`);
      return c;
    },
    /**
     * Every visible solid as a flat list, already turned to the puppet's facing and scaled, with the
     * ground point between the feet at [0, 0, 0]. Renderers project these.
     * capsule: { shape, a, b, r0, r1 }; ball: { shape, c, m, r: [x, y, z] }; box: { shape, c, m, half: [x, y, z] }.
     * All carry { color (hex), flat, bias, group }.
     */
    shapes(palette = null) {
      const turn = rotZ(puppet.yaw);
      const s = puppet.scale;
      const out = [];
      const emit = (part, origin, frame, itemColors, defaultTo) => {
        if (part.group && hidden.has(part.group)) return;
        const base = { shape: part.shape, color: puppet.colorOf(part.color, palette, itemColors), flat: Boolean(part.flat), bias: (part.bias ?? 0) * s, group: part.group ?? null };
        const place = (v) => scaleV(apply(turn, add(origin, apply(frame, v))), s);
        if (part.shape === 'capsule') {
          const r = Array.isArray(part.r) ? part.r : [part.r, part.r];
          out.push({ ...base, a: place(part.at ?? [0, 0, 0]), b: place(part.to ?? defaultTo), r0: r[0] * s, r1: r[1] * s });
          return;
        }
        const m = mul(turn, part.rot ? mul(frame, euler(...part.rot)) : frame);
        if (part.shape === 'ball') {
          const r = Array.isArray(part.r) ? part.r : [part.r, part.r, part.r];
          out.push({ ...base, c: place(part.at ?? [0, 0, 0]), m, r: r.map((v) => v * s) });
        } else out.push({ ...base, c: place(part.at ?? [0, 0, 0]), m, half: part.size.map((v) => v * s / 2) });
      };
      const solved = puppet.solved;
      for (const part of rig.parts) { const i = rig.index[part.bone]; emit(part, solved.pos[i], solved.mat[i], null, rig.bones[i].tip); }
      const hides = new Set();
      for (const item of Object.values(equipment)) for (const g of item.hides ?? []) hides.add(g);
      for (const [slotName, item] of Object.entries(equipment)) {
        const slot = rig.slots[slotName];
        const si = rig.index[slot.bone];
        const sOrigin = add(solved.pos[si], apply(solved.mat[si], slot.at));
        const sFrame = mul(solved.mat[si], euler(...slot.rot));
        for (const part of item.parts) {
          if (part.bone) { const i = rig.index[part.bone]; emit(part, solved.pos[i], solved.mat[i], item.colors, rig.bones[i].tip); }
          else emit(part, sOrigin, sFrame, item.colors, [0, 0, 0]);
        }
      }
      return hides.size ? out.filter((p) => !p.group || !hides.has(p.group)) : out;
    },
    /**
     * Room the character needs in any pose (running, a raised weapon, lying down), in world units:
     * [radius, top] = how far from the ground point it can reach sideways, and how high.
     */
    extent() {
      const rest = rig.solve(rig.createPose());
      let top = 0;
      rig.bones.forEach((b, i) => { top = Math.max(top, rig.tipOf(rest, i)[2], rest.pos[i][2]); });
      return [top * 0.86 * puppet.scale, top * 1.42 * puppet.scale];
    },
  };
  for (const [slot, item] of Object.entries(opts.equipment ?? {})) puppet.equip(slot, item);
  return puppet;
}
