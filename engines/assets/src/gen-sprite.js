// Generated assets as 2D vector sprites for `kiln build`: the recipes "gen" (one cell) and
// "gen_tall" (one cell wide, two high). The asset is seen from the front and a little above,
// drawn with the pen so it takes the sheet's style: outlines, tones, glow and palette.
import { generateAsset } from './gen.js';
import { solidFaces, solidColor } from './gen-solid.js';
import { modelSolids } from './gen-body.js';
import { orCrates } from './gen-shape.js';

const RAD = Math.PI / 180;
const f = (n) => (Math.round(n * 100) / 100).toString();
const LIGHT = [-0.45, -0.55, 0.7];

function camera(yaw, pitch) {
  const sa = Math.sin(yaw * RAD); const ca = Math.cos(yaw * RAD); const sp = Math.sin(pitch * RAD); const cp = Math.cos(pitch * RAD);
  const col = [ca, sa, 0]; const row = [sp * sa, -sp * ca, -cp]; const toward = [cp * sa, -cp * ca, sp];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (p) => [dot(col, p), dot(row, p), dot(toward, p)];
}

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => { const h = []; for (const q of list) { while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } h.pop(); return h; };
  return [...half(p), ...half(p.slice().reverse())];
}
const path = (pts) => pts.map((q, i) => `${i ? 'L' : 'M'}${f(q[0])} ${f(q[1])}`).join('') + 'Z';

/**
 * Draw solids with a pen, far ones first.
 * @param {object} p  Kiln pen.
 * @param {object[]} solids  See gen-solid.js.
 * @param {Object<string,string>} palette  Colour name to hex.
 * @param {{width?:number, height?:number, metres?:number, yaw?:number, pitch?:number, glow?:string[]}} [o]
 *   width/height: the canvas (100 x 100 or 100 x 200). metres: how many metres the canvas width shows
 *   (default: fit the asset). glow: colour names that give off light.
 * @returns {{scale:number, ground:number}} Canvas units per metre and the canvas y of the ground.
 */
export function drawSolids(p, solids, palette, o = {}) {
  const W = o.width ?? 100; const H = o.height ?? 100;
  const cam = camera(o.yaw ?? 28, o.pitch ?? 20);
  const items = solids.map((s) => {
    const raw = solidFaces(s);
    const faces = raw.map((poly) => poly.map(cam));
    const pts = faces.flat();
    return { s, raw, faces, pts, depth: pts.reduce((n, q) => n + q[2], 0) / pts.length + (s.flat ? 0.03 : 0) };
  }).sort((a, b) => a.depth - b.depth);
  const all = items.flatMap((it) => it.pts);
  const minX = Math.min(...all.map((q) => q[0])); const maxX = Math.max(...all.map((q) => q[0]));
  const minY = Math.min(...all.map((q) => q[1])); const maxY = Math.max(...all.map((q) => q[1]));
  if (o.metres !== undefined && !(o.metres > 0)) throw new Error(`gen sprite: "metres" must be a number above 0, got ${o.metres}`);
  const k = o.metres ? (W - 8) / o.metres : Math.min((W - 12) / (maxX - minX || 1), (H - 14) / (maxY - minY || 1));
  const ox = W / 2 - (minX + maxX) / 2 * k; const oy = H - 7 - maxY * k;
  const to = (q) => [q[0] * k + ox, q[1] * k + oy];
  const style = p.style;
  p.groundShadow(W / 2, H - 6.5, Math.min(W * 0.46, (maxX - minX) * k * 0.5), 3.4);
  const glow = new Set(o.glow ?? []);
  for (const it of items) {
    const hex = solidColor(it.s.c, palette);
    const tones = p.ramp(hex);
    const edge = hull(it.pts.map(to));
    if (edge.length < 3) continue;
    if (glow.has(it.s.c)) {
      const c = edge.reduce((a, q) => [a[0] + q[0] / edge.length, a[1] + q[1] / edge.length], [0, 0]);
      p.halo(c[0], c[1], Math.max(6, Math.hypot(edge[0][0] - c[0], edge[0][1] - c[1]) * 2.4), hex, 0.55);
    }
    if (style.shading === 'paper') p.raw(`<path d="${path(edge.map(([x, y]) => [x + 1.2, y + 2]))}" fill="#1b1b2b" opacity="0.2"/>`);
    const small = Math.max(...edge.map((q) => q[0])) - Math.min(...edge.map((q) => q[0])) < 3.2;
    if (style.outline > 0 && !it.s.flat && !small) p.raw(`<path d="${path(edge)}" fill="${tones.outline}" stroke="${tones.outline}" stroke-width="${f(Math.min(style.outline, 2.2) * 1.4)}" stroke-linejoin="round"/>`);
    it.faces.forEach((face, i) => {
      const [a, b, c] = face;
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0) return; // faces away from the camera
      const r = it.raw[i];
      const u = [r[1][0] - r[0][0], r[1][1] - r[0][1], r[1][2] - r[0][2]]; const v = [r[2][0] - r[0][0], r[2][1] - r[0][1], r[2][2] - r[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const lit = (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / (Math.hypot(...n) || 1);
      let tone = lit > 0.62 ? 'light' : lit > 0.2 ? 'base' : lit > -0.25 ? 'shadow' : 'deep';
      if (glow.has(it.s.c) || it.s.flat) tone = 'base';
      else if (style.shading === 'cel') tone = lit > 0.62 ? 'light' : lit > 0 ? 'base' : 'shadow';
      else if (style.shading === 'paper') tone = lit > 0.62 ? 'light' : lit > -0.25 ? 'base' : 'shadow';
      p.raw(`<path d="${path(face.map(to))}" fill="${tones[tone]}" stroke="${tones[tone]}" stroke-width="0.35" stroke-linejoin="round"/>`);
    });
  }
  return { scale: k, ground: H - 7 };
}

function draw(p, params, height) {
  const { metres, yaw, pitch, facing, colors, ...request } = params;
  const asset = generateAsset({ ...orCrates(request), style: request.style ?? p.style.name });
  p.flip = facing === 'left';
  const model = asset.model && colors ? { ...asset.model, def: { ...asset.model.def, colors: { ...asset.model.def.colors, ...colors } } } : asset.model;
  const solids = model ? modelSolids(model) : asset.solids;
  const palette = model ? {} : { ...asset.palette, ...(colors ?? {}) };
  const glow = Object.entries(asset.colors).filter(([, spec]) => /(^|~)(flame|ember)(~|$)/.test(spec)).map(([name]) => name);
  drawSolids(p, solids, palette, { width: 100, height, metres, yaw: yaw ?? (asset.model ? 18 : 28), pitch: pitch ?? (asset.model ? 12 : 20), glow });
}

const PARAMS = {
  describe: 'short description, e.g. "tall stone watchtower" or "hooded goblin with a spear"',
  kind: 'building, prop, player, npc or mob (needed when the description names no type)',
  type: 'exact type, e.g. tower, crates, goblin (kiln generate --list shows all)',
  seed: 'number: same seed, same asset',
  metres: 'how many metres the cell width shows; give sprites the same value to keep them to scale with each other (default: fit the cell)',
  facing: '"right" (default) or "left"',
  yaw: 'degrees the view is turned (default 28, characters 18)',
  colors: 'override part colours by name with hex values',
};

/** Recipes for build.js: generated assets as sprites. They follow the sheet's style unless params.style is set. */
export const GEN_RECIPES = {
  gen: { description: 'A generated asset (building, prop or character) from a seed or a short description. See README "Generating new assets".', params: PARAMS, draw: (p, params) => draw(p, params, 100) },
  gen_tall: { description: 'The same as "gen" on a tall sprite (1 cell wide, 2 high): use it for standing characters and towers.', span: [1, 2], params: PARAMS, draw: (p, params) => draw(p, params, 200) },
};
