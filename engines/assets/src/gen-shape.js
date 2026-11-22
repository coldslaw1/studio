// How a generated asset enters a 3D scene: the scene shape "gen". A scene object such as
//   { "shape": "gen", "at": [30, 40], "params": { "kind": "building", "describe": "stone watchtower", "seed": 7 } }
// is generated on the spot (the same params always give the same asset), so scene files stay
// small. Params may also carry ready-made { solids, colors } to place a hand-written or saved asset.
import { generateAsset } from './gen.js';
import { addSolids } from './gen-solid.js';
import { modelSolids } from './gen-body.js';

/** Like every built-in shape and recipe, "gen" works with no params: it is then a stack of crates. */
export const orCrates = (request) => (request.kind || request.type || request.describe ? request : { ...request, kind: 'prop', type: 'crates' });

const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * The solids and colours a "gen" scene object stands for.
 * @param {object} params  A generateAsset request ({ kind, type, describe, seed, style, size }) or { solids, colors }.
 *   `colors` ({ name: hex }) overrides colours by name in both forms, e.g. { roof: '#336699' }.
 * @returns {{solids:object[], palette:Object<string,string>}}
 */
export function genSolids(params = {}) {
  for (const [k, v] of Object.entries(params.colors ?? {})) if (!isHex(v)) throw new Error(`gen shape: colors.${k} must be a hex colour like "#336699", got ${JSON.stringify(v)}`);
  if (params.solids !== undefined) {
    if (!Array.isArray(params.solids) || params.solids.length === 0) throw new Error('gen shape: "solids" must be a non-empty list of solids');
    return { solids: params.solids, palette: { ...(params.colors ?? {}) } };
  }
  const { colors, ...given } = params;
  const asset = generateAsset(orCrates(given));
  if (asset.model) {
    const model = colors ? { ...asset.model, def: { ...asset.model.def, colors: { ...asset.model.def.colors, ...colors } } } : asset.model;
    return { solids: modelSolids(model), palette: {} };
  }
  return { solids: asset.solids, palette: { ...asset.palette, ...(colors ?? {}) } };
}

/** Build the mesh of a "gen" scene object into a scene mesh builder. Used by scene-shapes.js. */
export function genShape(m, params) {
  const { solids, palette } = genSolids(params);
  return addSolids(m, solids, palette);
}
