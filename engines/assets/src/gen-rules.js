// The rules every generated asset must pass before it is handed out: world scale (doors, storeys,
// people, reach of weapons), on-palette colours, sound rigs. generateAsset runs these and retries
// with the next variation when one fails, so callers only ever see assets that pass.
import { onPalette, createColors } from './gen-palette.js';
import { solidBounds } from './gen-solid.js';
import { modelSolids, TWO_LEGGED_BONES } from './gen-body.js';
import { MAX_REACH } from './gen-gear.js';
import { contrast } from './color.js';

/** The numbers behind the scale rules, in metres. A standing adult is 1.8. */
export const SCALE_RULES = {
  door: { height: [2.0, 2.2], width: [0.9, 1.3] },
  cartDoor: { height: [2.4, 3.0], width: [1.6, 3.2] },
  storey: [2.4, 3.6],
  building: { footprint: [2, 17], height: [2.6, 32] },
  prop: { footprint: [0.2, 5.5], height: [0.15, 4.8] },
  character: { height: [0.25, 3.6] },
};

const within = (v, [lo, hi], slack = 0.011) => v >= lo - slack && v <= hi + slack;

function checkRig(model, problems) {
  const { def } = model;
  const names = new Set();
  for (const b of def.bones) {
    if (names.has(b.name)) problems.push(`bone "${b.name}" is listed twice`);
    if (b.parent !== undefined && !names.has(b.parent)) problems.push(`bone "${b.name}" comes before its parent "${b.parent}"`);
    names.add(b.name);
  }
  for (const p of def.parts) {
    if (!names.has(p.bone)) problems.push(`a part hangs on unknown bone "${p.bone}"`);
    if (!def.colors[p.color]) problems.push(`part colour "${p.color}" is not in the rig's colours`);
  }
  for (const [slot, s] of Object.entries(def.slots)) if (!names.has(s.bone)) problems.push(`slot "${slot}" names unknown bone "${s.bone}"`);
  for (const s of def.springs) for (const b of s.bones) if (!names.has(b)) problems.push(`a spring names unknown bone "${b}"`);
  for (const [slot, item] of Object.entries(model.equipment ?? {})) {
    if (!def.slots[slot]) problems.push(`equipment uses slot "${slot}", which the rig does not have`);
    for (const p of item.parts) if (!item.colors?.[p.color] && !def.colors[p.color]) problems.push(`item "${item.name}" uses colour "${p.color}" without a value`);
  }
  if (def.meta.plan === 'twoLegged') {
    for (const b of TWO_LEGGED_BONES) if (!names.has(b)) problems.push(`a two-legged body must have the bone "${b}"`);
  } else {
    if (!model.animator) problems.push('a creature that is not two-legged needs its own animator');
    for (const [clip, c] of Object.entries(model.animator?.clips ?? {})) for (const bone of Object.keys(c.tracks ?? {})) if (bone !== 'root' && !names.has(bone)) problems.push(`clip "${clip}" moves unknown bone "${bone}"`);
  }
}

/**
 * Check one generated asset against the scale and style rules.
 * @param {object} asset  From generateAsset.
 * @returns {string[]} Problems in plain words; empty when the asset is sound.
 */
export function checkAsset(asset) {
  const problems = [];
  if (!asset || typeof asset !== 'object' || !asset.kind) return ['not a generated asset'];
  const style = createColors(asset.style, asset.paletteOverrides ?? {}).style;
  const hexes = { ...asset.palette };
  if (asset.model) for (const item of Object.values(asset.model.equipment ?? {})) Object.entries(item.colors ?? {}).forEach(([k, v]) => { hexes[`${item.name}.${k}`] = v; });
  for (const [name, hex] of Object.entries(hexes)) if (!onPalette(hex, style)) problems.push(`colour "${name}" (${hex}) is not from the ${style.name} palette`);
  const { width, depth, height } = asset.size;
  if (![width, depth, height].every((n) => Number.isFinite(n) && n > 0)) problems.push(`size is not a set of positive numbers: ${JSON.stringify(asset.size)}`);

  if (asset.kind === 'building' || asset.kind === 'prop') {
    const R = SCALE_RULES[asset.kind];
    if (!Array.isArray(asset.solids) || asset.solids.length === 0) return [...problems, 'no solids'];
    if (asset.solids.length > 400) problems.push(`${asset.solids.length} solids is too many (400 at most)`);
    const b = solidBounds(asset.solids);
    if (b.min[2] < -0.01) problems.push(`part of it is ${(-b.min[2]).toFixed(2)} m below the ground`);
    if (!within(Math.max(width, depth), R.footprint, 0.5)) problems.push(`footprint ${width} x ${depth} m is outside ${R.footprint[0]} to ${R.footprint[1]} m for a ${asset.kind}`);
    if (!within(height, R.height)) problems.push(`height ${height} m is outside ${R.height[0]} to ${R.height[1]} m for a ${asset.kind}`);
    for (const s of asset.solids) if (!asset.palette[s.c]) problems.push(`solid colour "${s.c}" has no palette entry`);
  }
  if (asset.kind === 'building') {
    const f = asset.facts;
    if (f.door) {
      const rule = f.door.cart ? SCALE_RULES.cartDoor : SCALE_RULES.door;
      if (!within(f.door.h, rule.height)) problems.push(`door is ${f.door.h.toFixed(2)} m high; it must be ${rule.height[0]} to ${rule.height[1]} m so a 1.8 m person fits`);
      if (!within(f.door.w, rule.width)) problems.push(`door is ${f.door.w.toFixed(2)} m wide; it must be ${rule.width[0]} to ${rule.width[1]} m`);
    } else if (!f.open) problems.push('a closed building needs a door');
    if (!within(f.storeyHeight, SCALE_RULES.storey)) problems.push(`a storey is ${f.storeyHeight.toFixed(2)} m; it must be ${SCALE_RULES.storey[0]} to ${SCALE_RULES.storey[1]} m`);
    if (height + 0.011 < f.storeys * f.storeyHeight) problems.push(`it is ${height} m tall, lower than its ${f.storeys} storeys`);
    if (asset.palette.roof && asset.palette.wall && contrast(asset.palette.roof, asset.palette.wall) < 1.15) problems.push('the roof and the walls are nearly the same colour');
  }
  if (asset.model) {
    checkRig(asset.model, problems);
    const f = asset.facts;
    if (!within(f.bodyHeight, SCALE_RULES.character.height)) problems.push(`body height ${f.bodyHeight} m is outside ${SCALE_RULES.character.height.join(' to ')} m`);
    if (f.range && !within(f.bodyHeight, f.range, 0.02)) problems.push(`a ${asset.type} should stand ${f.range[0].toFixed(2)} to ${f.range[1].toFixed(2)} m; this one is ${f.bodyHeight} m`);
    if (f.weapon && f.reach > (MAX_REACH[f.weapon] ?? 1) + 1e-6) problems.push(`the ${f.weapon} is ${(f.reach * 100).toFixed(0)}% of the body height; the limit is ${MAX_REACH[f.weapon] * 100}%`);
    if (problems.length === 0) {
      const b = solidBounds(modelSolids(asset.model));
      if (b.min[2] < -0.05 * f.bodyHeight - 0.01) problems.push(`part of it is ${(-b.min[2]).toFixed(2)} m below the ground at rest`);
      if (b.max[2] > f.bodyHeight * 1.75 + 0.05) problems.push(`with its equipment it reaches ${b.max[2].toFixed(2)} m, far above its ${f.bodyHeight} m body`);
    }
    const { skin, eye } = asset.model.def.colors;
    if (skin && eye && contrast(skin, eye) < 1.5) problems.push('the eyes do not stand out from the face');
  }
  return problems;
}
