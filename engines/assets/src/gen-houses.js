// Building makers, part 1: places people live and work in. Each maker lays out solids in metres
// around the world scale: a 1.8 m adult, 2.1 m doors, storeys of about 3 m. Buildings face -y.
import { solidList } from './gen-solid.js';
import { POOLS } from './gen-palette.js';

export const DOOR_HEIGHT = 2.1;

/** Colours every building shares. `o.wall` and `o.roof` are pools to draw from. */
export function buildingColors(ctx, o = {}) {
  const rng = ctx.rng('palette');
  const c = ctx.colors;
  const word = (ctx.traits.colors[0] && c.word(rng, ctx.traits.colors[0])) || null;
  const wall = ctx.traits.material ?? c.pick(rng, o.wall ?? POOLS.wall);
  const roof = word ?? c.pick(rng, o.roof ?? POOLS.roof, [wall], 1.35);
  return {
    wall, roof,
    wall2: ctx.has('rich') || rng.chance(0.4) ? c.pick(rng, ['cream', 'white~cream~0.5', 'cream~wood~0.2'], [roof], 1.3) : wall,
    door: c.pick(rng, ['wood~ink~0.3', 'wood', 'night', 'roof~ink~0.2'], [wall], 1.3),
    trim: c.pick(rng, ['white', 'cream', 'wood~ink~0.45', 'stone~white~0.3'], [wall], 1.25),
    window: rng.chance(c.style.name === 'nocturne' ? 0.7 : 0.2) ? 'gold~flame~0.5' : c.pick(rng, ['night', 'sky~night~0.55', 'ink~night~0.5'], [wall], 1.4),
    stone: 'stone', wood: 'wood', beam: 'wood~ink~0.35',
    accent: c.pick(rng, POOLS.cloth, [wall], 1.3),
    sign: 'cream~wood~0.3', ember: 'ember', metal: 'steel~ink~0.3',
  };
}

/** Door on a front wall at y = y0 (the wall faces -y). Returns its size for the scale rules. */
export function door(s, x, y0, w = 1.05, h = DOOR_HEIGHT) {
  s.box([x - w / 2 - 0.12, y0 - 0.06, 0], [x + w / 2 + 0.12, y0, h + 0.14], 'trim');
  s.box([x - w / 2, y0 - 0.1, 0], [x + w / 2, y0, h], 'door');
  return { w, h };
}

/** Window on the wall facing `face` ('front' -y, 'back' +y, 'left' -x, 'right' +x). `u` runs along the wall. */
export function windowAt(s, face, u, wallAt, sill = 1.0, w = 0.9, h = 0.95) {
  const out = face === 'front' || face === 'left' ? -1 : 1;
  const slab = (grow, depth, c) => {
    const a = [u - w / 2 - grow, Math.min(wallAt, wallAt + out * depth), sill - grow];
    const b = [u + w / 2 + grow, Math.max(wallAt, wallAt + out * depth), sill + h + grow];
    if (face === 'front' || face === 'back') s.box(a, b, c);
    else s.box([a[1], a[0], a[2]], [b[1], b[0], b[2]], c);
  };
  slab(0.08, 0.05, 'trim');
  slab(0, 0.08, 'window');
}

/** Hanging sign on a bracket beside the door, clear of heads (its lowest edge is 2.25 m up). */
export function hangingSign(s, x, y0) {
  s.box([x - 0.05, y0 - 0.95, 3.0], [x + 0.05, y0, 3.1], 'beam');
  s.box([x - 0.04, y0 - 0.9, 2.25], [x + 0.04, y0 - 0.2, 2.95], 'sign');
  s.box([x - 0.06, y0 - 0.7, 2.45], [x + 0.06, y0 - 0.4, 2.75], 'accent');
}

/** Roof over a w x d block whose walls end at height z. Returns the height of its top. */
export function roofOver(s, kind, w, d, z, pitch, over = 0.45, c = 'roof') {
  const along = w >= d ? 'x' : 'y';
  const rise = (Math.min(w, d) / 2 + over) * pitch;
  if (kind === 'hip') s.pyramid([-w / 2 - over, -d / 2 - over, z], [w / 2 + over, d / 2 + over, z + rise], c);
  else s.gable([-w / 2 - over, -d / 2 - over, z], [w / 2 + over, d / 2 + over, z + rise], c, along);
  return z + rise;
}

const PRESETS = {
  house: { w: [6, 9], d: [5, 6.5], storeys: [1, 2], pitch: [0.7, 0.95], chimney: 0.6, annex: 0.3, porch: 0.25 },
  cottage: { w: [5, 7], d: [4, 5.2], storeys: [1, 1], pitch: [0.9, 1.15], chimney: 0.85, annex: 0.15, porch: 0.2, over: 0.6, roof: ['gold~wood~0.45', 'wood', 'wood~ink~0.3', 'leafDark'] },
  shop: { w: [6, 8], d: [5, 6], storeys: [1, 2], pitch: [0.7, 0.9], chimney: 0.3, annex: 0.1, porch: 0, sign: true, awning: true },
  inn: { w: [9.5, 12], d: [6, 7.5], storeys: [2, 2], pitch: [0.75, 0.95], chimney: 1, chimneys: 2, annex: 0.7, porch: 0.4, sign: true },
};

/** House, cottage, shop and inn: a walled block with storeys, bays of windows, a roof and extras. */
export function houseLike(ctx, type) {
  const P = PRESETS[type];
  const rng = ctx.rng('layout');
  const s = solidList();
  const colors = buildingColors(ctx, { roof: P.roof });
  const w = rng.range(...P.w) * ctx.size;
  const d = rng.range(...P.d) * Math.sqrt(ctx.size);
  const storeys = ctx.count ? Math.min(3, ctx.count) : ctx.has('storeys2') ? Math.max(2, P.storeys[0]) : rng.int(...P.storeys);
  const h = rng.range(2.85, 3.2);
  const ruined = ctx.has('ruined');
  const y0 = -d / 2;
  if (rng.chance(0.6)) s.box([-w / 2 - 0.1, y0 - 0.1, 0], [w / 2 + 0.1, d / 2 + 0.1, 0.45], 'stone');
  const jetty = storeys > 1 ? rng.range(0.15, 0.3) : 0;
  s.box([-w / 2, y0, 0], [w / 2, d / 2, h], 'wall');
  for (let i = 1; i < storeys; i++) {
    s.box([-w / 2 - jetty, y0 - jetty, h * i], [w / 2 + jetty, d / 2 + jetty, h * (i + 1)], 'wall2');
    s.box([-w / 2 - jetty - 0.04, y0 - jetty - 0.04, h * i - 0.12], [w / 2 + jetty + 0.04, d / 2 + jetty + 0.04, h * i + 0.1], 'beam');
  }
  // bays along the front: one holds the door, the rest hold windows
  const bays = Math.max(2, Math.round(w / 2.3));
  const bayX = (i) => -w / 2 + (i + 0.5) * w / bays;
  const doorBay = rng.int(0, bays - 1);
  const doorSize = door(s, bayX(doorBay), y0, rng.range(1.0, 1.2));
  for (let i = 0; i < bays; i++) {
    if (i !== doorBay) windowAt(s, 'front', bayX(i), y0, 1.0, P.awning && i === (doorBay + 1) % bays ? 1.6 : 0.9);
    for (let f = 1; f < storeys; f++) windowAt(s, 'front', bayX(i), y0 - jetty, h * f + 0.95);
  }
  const sideBays = Math.max(1, Math.round(d / 3));
  for (let f = 0; f < storeys; f++) {
    for (let i = 0; i < sideBays; i++) {
      const y = -d / 2 + (i + 0.5) * d / sideBays;
      const j = f ? jetty : 0;
      windowAt(s, 'left', y, -w / 2 - j, h * f + 1.0);
      if (rng.chance(0.7)) windowAt(s, 'right', y, w / 2 + j, h * f + 1.0);
    }
  }
  const top = h * storeys;
  const tw = w + jetty * 2; const td = d + jetty * 2;
  let peak = top;
  if (ruined) {
    for (let i = 0; i < 5; i++) { const x = rng.range(-tw / 2, tw / 2 - 1); s.box([x, d / 2 - 0.3 + jetty, top], [x + rng.range(0.6, 1.4), d / 2 + jetty, top + rng.range(0.3, 1.1)], storeys > 1 ? 'wall2' : 'wall'); }
  } else {
    const kind = Math.abs(tw - td) < 1.2 && rng.chance(0.5) ? 'hip' : 'gable';
    peak = roofOver(s, kind, tw, td, top, rng.range(...P.pitch), P.over ?? rng.range(0.35, 0.55));
    const n = rng.chance(P.chimney) || ctx.has('chimney') ? P.chimneys ?? 1 : 0;
    for (let i = 0; i < n; i++) {
      const cx = (i ? -1 : 1) * (tw / 2 - rng.range(0.9, 1.6));
      const cy = tw >= td ? rng.range(-0.3, 0.3) : (i ? -1 : 1) * td * 0.2;
      s.box([cx - 0.4, cy - 0.4, top - 0.2], [cx + 0.4, cy + 0.4, peak + rng.range(0.4, 0.8)], 'stone');
    }
  }
  const features = [];
  if (rng.chance(P.porch) || ctx.has('porch')) {
    const x = bayX(doorBay);
    for (const dx of [-0.95, 0.95]) s.box([x + dx - 0.09, y0 - 1.35, 0], [x + dx + 0.09, y0 - 1.17, 2.45], 'beam');
    s.gable([x - 1.25, y0 - 1.5, 2.45], [x + 1.25, y0, 3.05], 'roof', 'y');
    features.push('porch');
  }
  if (P.awning || ctx.has('awning')) {
    const x = bayX((doorBay + 1) % bays);
    for (let i = 0; i < 4; i++) s.box([x - 1 + i * 0.5, y0 - 1.1, 2.5], [x - 0.5 + i * 0.5, y0, 2.58], i % 2 ? 'trim' : 'accent', { pivot: [x, y0, 2.58], rx: 18 });
    features.push('awning');
  }
  if (P.sign) { hangingSign(s, bayX(doorBay) + (doorBay === bays - 1 ? -1 : 1) * 0.95, y0 - jetty); features.push('sign'); }
  if ((rng.chance(P.annex) || ctx.has('annex')) && !ruined) {
    const side = rng.chance(0.5) ? 1 : -1;
    const aw = rng.range(2.4, 3.4); const ad = d * rng.range(0.55, 0.8); const ah = 2.5;
    const x0 = side * w / 2; const x1 = side * (w / 2 + aw);
    s.box([Math.min(x0, x1), d / 2 - ad, 0], [Math.max(x0, x1), d / 2, ah], 'wall');
    s.gable([Math.min(x0, x1) - (side < 0 ? 0.3 : 0), d / 2 - ad - 0.3, ah], [Math.max(x0, x1) + (side > 0 ? 0.3 : 0), d / 2 + 0.3, ah + ad * 0.32], 'roof');
    features.push('annex');
  }
  return { solids: s.list, colors, facts: { storeys, storeyHeight: h, door: doorSize, peak }, features };
}

/** Hut: one small room, round or square, under a thatch cone or a steep roof. */
export function hut(ctx) {
  const rng = ctx.rng('layout');
  const s = solidList();
  const colors = buildingColors(ctx, { wall: ['cream~wood~0.35', 'wood', 'stone', 'cream'], roof: ['gold~wood~0.45', 'wood~ink~0.3', 'gold~wood~0.65', 'leafDark'] });
  const h = rng.range(2.45, 2.75);
  const round = ctx.has('round') || (!ctx.has('square') && rng.chance(0.6));
  let doorSize; let peak;
  if (round) {
    const r = rng.range(2.1, 2.9) * ctx.size;
    s.prism([0, 0], r, [0, h], 'wall', { n: 10 });
    doorSize = door(s, 0, -r * Math.cos(Math.PI / 10) + 0.02, 0.95);
    peak = h + r * rng.range(0.8, 1.15);
    if (!ctx.has('ruined')) s.prism([0, 0], r + 0.5, [h - 0.15, peak], 'roof', { n: 10, r1: 0 });
  } else {
    const w = rng.range(3.6, 4.8) * ctx.size; const d = rng.range(3.2, 4.2);
    s.box([-w / 2, -d / 2, 0], [w / 2, d / 2, h], 'wall');
    doorSize = door(s, rng.range(-0.6, 0.6), -d / 2, 0.95);
    windowAt(s, 'left', 0, -w / 2, 1.05, 0.7, 0.7);
    peak = ctx.has('ruined') ? h : roofOver(s, 'gable', w, d, h, rng.range(0.95, 1.25), 0.5);
  }
  return { solids: s.list, colors, facts: { storeys: 1, storeyHeight: h, door: doorSize, peak }, features: [round ? 'round' : 'square'] };
}

/** Barn: tall plank walls, a cart door wide and high enough for a wagon, a loft hatch above it. */
export function barn(ctx) {
  const rng = ctx.rng('layout');
  const s = solidList();
  const colors = buildingColors(ctx, { wall: ['brick', 'wood', 'wood~ink~0.25', 'red~wood~0.4'], roof: ['wood~ink~0.35', 'stone~ink~0.35', 'night', 'roof'] });
  const w = rng.range(7.5, 10) * ctx.size; const d = rng.range(9, 12); const h = rng.range(3.2, 3.5);
  s.box([-w / 2, -d / 2, 0], [w / 2, d / 2, h], 'wall');
  const dw = rng.range(2.6, 3.0); const dh = 2.8;
  s.box([-dw / 2 - 0.15, -d / 2 - 0.06, 0], [dw / 2 + 0.15, -d / 2, dh + 0.18], 'trim');
  s.box([-dw / 2, -d / 2 - 0.1, 0], [dw / 2, -d / 2, dh], 'door');
  s.box([-0.04, -d / 2 - 0.13, 0], [0.04, -d / 2 - 0.1, dh], 'trim');
  const peak = ctx.has('ruined') ? h : roofOver(s, 'gable', w, d, h, rng.range(0.85, 1.05), 0.4);
  s.box([-0.5, -d / 2 - 0.08, h + 0.3], [0.5, -d / 2 + 0.3, h + 1.3], 'door');
  for (let i = 0; i < 3; i++) windowAt(s, i % 2 ? 'left' : 'right', -d / 2 + (i + 0.5) * d / 3, (i % 2 ? -1 : 1) * w / 2, 1.6, 0.7, 0.6);
  return { solids: s.list, colors, facts: { storeys: 1, storeyHeight: h, door: { w: dw, h: dh, cart: true }, peak }, features: ['cart door', 'loft'] };
}

/** Smithy: a closed back room, an open shelter on posts in front, a heavy forge chimney and an anvil. */
export function smithy(ctx) {
  const rng = ctx.rng('layout');
  const s = solidList();
  const colors = buildingColors(ctx, { wall: ['stone', 'stone~cream~0.4', 'brick', 'wood'] });
  const w = rng.range(5.5, 7) * ctx.size; const back = rng.range(3, 3.8); const front = rng.range(2.6, 3.2); const h = rng.range(2.85, 3.1);
  const d = back + front;
  s.box([-w / 2, d / 2 - back, 0], [w / 2, d / 2, h], 'wall');
  const doorSize = door(s, -w / 4, d / 2 - back, 1.0);
  for (const x of [-w / 2 + 0.15, 0, w / 2 - 0.15]) s.box([x - 0.12, -d / 2, 0], [x + 0.12, -d / 2 + 0.24, h], 'beam');
  s.box([-w / 2, -d / 2, h - 0.2], [w / 2, -d / 2 + 0.2, h], 'beam');
  const peak = roofOver(s, 'gable', w, d, h, rng.range(0.6, 0.8), 0.35);
  // forge and chimney on the right, glowing at working height
  const fx = w / 2 - 1.0; const fy = d / 2 - back - 0.9;
  s.box([fx - 0.7, fy - 0.6, 0], [fx + 0.7, fy + 0.6, 0.9], 'stone');
  s.box([fx - 0.45, fy - 0.62, 0.9], [fx + 0.45, fy + 0.3, 1.15], 'ember');
  s.box([fx - 0.55, fy + 0.1, 0.9], [fx + 0.55, fy + 0.9, peak + 0.7], 'stone');
  // anvil on a stump under the shelter
  const ax = -w / 6; const ay = -d / 2 + front / 2;
  s.prism([ax, ay], 0.28, [0, 0.55], 'wood', { n: 8 });
  s.box([ax - 0.32, ay - 0.12, 0.55], [ax + 0.32, ay + 0.12, 0.8], 'metal');
  s.box([ax - 0.16, ay - 0.1, 0.8], [ax + 0.42, ay + 0.1, 0.9], 'metal');
  return { solids: s.list, colors, facts: { storeys: 1, storeyHeight: h, door: doorSize, peak }, features: ['forge', 'anvil', 'open front'] };
}
