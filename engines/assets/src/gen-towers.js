// Building makers, part 2: tall and special buildings. Same scale rules as gen-houses.js.
import { solidList } from './gen-solid.js';
import { buildingColors, door, windowAt, roofOver } from './gen-houses.js';

const STONE_WALLS = ['stone', 'stone~cream~0.45', 'stone~ink~0.2', 'cream~wood~0.35', 'brick'];

/** Battlements around the top of a w x d block at height z. */
function battlements(s, w, d, z, c = 'wall', cx = 0, cy = 0) {
  s.box([cx - w / 2 - 0.3, cy - d / 2 - 0.3, z], [cx + w / 2 + 0.3, cy + d / 2 + 0.3, z + 0.5], c);
  const n = Math.max(2, Math.round((w + 0.6) / 1.5));
  const m = Math.max(2, Math.round((d + 0.6) / 1.5));
  const span = (len, count, i) => -len / 2 - 0.3 + i * (len + 0.6 - 0.7) / (count - 1);
  for (let i = 0; i < n; i++) for (const y of [cy - d / 2 - 0.3, cy + d / 2 - 0.25]) s.box([cx + span(w, n, i), y, z + 0.5], [cx + span(w, n, i) + 0.7, y + 0.55, z + 1.15], c);
  for (let i = 1; i < m - 1; i++) for (const x of [cx - w / 2 - 0.3, cx + w / 2 - 0.25]) s.box([x, cy + span(d, m, i), z + 0.5], [x + 0.55, cy + span(d, m, i) + 0.7, z + 1.15], c);
}

/** Tower: three to five storeys, round or square, with battlements or a cone roof. */
export function tower(ctx) {
  const rng = ctx.rng('layout');
  const s = solidList();
  const colors = buildingColors(ctx, { wall: STONE_WALLS });
  const storeys = ctx.count ? Math.max(2, Math.min(6, ctx.count)) : Math.round(rng.int(3, 5) * Math.min(1.3, ctx.size));
  const h = rng.range(2.9, 3.3);
  const top = storeys * h;
  const round = ctx.has('round') || (!ctx.has('square') && rng.chance(0.45));
  const half = rng.range(2.1, 2.9);
  let doorSize; let peak = top;
  const capped = !ctx.has('ruined') && rng.chance(round ? 0.7 : 0.35);
  if (round) {
    s.prism([0, 0], half + 0.25, [0, 0.6], 'stone', { n: 10 });
    s.prism([0, 0], half, [0, top], 'wall', { n: 10 });
    const face = half * Math.cos(Math.PI / 10);
    doorSize = door(s, 0, -face + 0.02, 1.0);
    for (let f = 1; f < storeys; f++) windowAt(s, 'front', 0, -face + 0.02, f * h + 1.0, 0.35, 1.0);
    if (capped) { peak = top + half * rng.range(1.3, 1.8); s.prism([0, 0], half + 0.55, [top - 0.1, peak], 'roof', { n: 10, r1: 0 }); }
    else { s.prism([0, 0], half + 0.35, [top, top + 0.5], 'wall', { n: 10 }); for (let i = 0; i < 6; i++) { const a = i / 6 * 2 * Math.PI; s.box([Math.cos(a) * (half + 0.05) - 0.35, Math.sin(a) * (half + 0.05) - 0.35, top + 0.5], [Math.cos(a) * (half + 0.05) + 0.35, Math.sin(a) * (half + 0.05) + 0.35, top + 1.15], 'wall'); } peak = top + 1.15; }
  } else {
    const w = half * 2;
    s.box([-half - 0.2, -half - 0.2, 0], [half + 0.2, half + 0.2, 0.6], 'stone');
    s.box([-half, -half, 0], [half, half, top], 'wall');
    doorSize = door(s, 0, -half, 1.0);
    for (let f = 1; f < storeys; f++) { windowAt(s, 'front', 0, -half, f * h + 1.0, 0.35, 1.0); windowAt(s, f % 2 ? 'left' : 'right', 0, (f % 2 ? -1 : 1) * half, f * h + 1.0, 0.35, 1.0); }
    if (capped) peak = roofOver(s, 'hip', w, w, top, rng.range(1.1, 1.5), 0.5);
    else if (ctx.has('ruined')) { s.box([-half, half - 0.5, top], [half * 0.2, half, top + 1.4], 'wall'); peak = top + 1.4; } else { battlements(s, w, w, top); peak = top + 1.15; }
  }
  return { solids: s.list, colors, facts: { storeys, storeyHeight: h, door: doorSize, peak }, features: [round ? 'round' : 'square', capped ? 'cone roof' : 'battlements'] };
}

/** Keep: a broad battlemented block with a turret on every corner and a double door. */
export function keep(ctx) {
  const rng = ctx.rng('layout');
  const s = solidList();
  const colors = buildingColors(ctx, { wall: STONE_WALLS });
  const w = rng.range(9, 12) * ctx.size; const d = rng.range(8, 10) * Math.sqrt(ctx.size);
  const storeys = ctx.count ? Math.max(2, Math.min(4, ctx.count)) : rng.int(2, 3);
  const h = rng.range(3.1, 3.4); const top = storeys * h;
  s.box([-w / 2 - 0.25, -d / 2 - 0.25, 0], [w / 2 + 0.25, d / 2 + 0.25, 0.7], 'stone');
  s.box([-w / 2, -d / 2, 0], [w / 2, d / 2, top], 'wall');
  battlements(s, w, d, top);
  const dw = rng.range(1.8, 2.2); const dh = 2.6;
  s.box([-dw / 2 - 0.2, -d / 2 - 0.08, 0], [dw / 2 + 0.2, -d / 2, dh + 0.25], 'trim');
  s.box([-dw / 2, -d / 2 - 0.12, 0], [dw / 2, -d / 2, dh], 'door');
  s.box([-0.04, -d / 2 - 0.15, 0], [0.04, -d / 2 - 0.12, dh], 'trim');
  for (let f = 1; f < storeys; f++) for (const x of [-w / 4, w / 4]) windowAt(s, 'front', x, -d / 2, f * h + 1.0, 0.4, 1.1);
  const round = rng.chance(0.5); const tr = rng.range(1.3, 1.7); const th = top + rng.range(2.4, 3.4);
  const cones = rng.chance(0.5);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = sx * w / 2; const cy = sy * d / 2;
    if (round) s.prism([cx, cy], tr, [0, th], 'wall', { n: 8 }); else s.box([cx - tr, cy - tr, 0], [cx + tr, cy + tr, th], 'wall');
    if (cones) s.prism([cx, cy], tr + 0.4, [th, th + tr * 1.7], 'roof', { n: 8, r1: 0 });
    else if (round) s.prism([cx, cy], tr + 0.25, [th, th + 0.6], 'wall', { n: 8 });
    else battlements(s, tr * 2, tr * 2, th, 'wall', cx, cy);
  }
  if (rng.chance(0.6)) { s.box([-0.06, -0.06, top], [0.06, 0.06, top + 4], 'beam'); s.box([0.06, -0.03, top + 2.9], [1.5, 0.03, top + 3.9], 'accent'); }
  return { solids: s.list, colors, facts: { storeys, storeyHeight: h, door: { w: dw, h: dh, cart: true }, peak: th + (cones ? tr * 1.7 : 1.15) }, features: ['turrets', cones ? 'cone roofs' : 'battlements'] };
}

/** Chapel: a long nave entered from its gable end, tall side windows and a steeple. */
export function chapel(ctx) {
  const rng = ctx.rng('layout');
  const s = solidList();
  const colors = buildingColors(ctx, { wall: ['stone~cream~0.45', 'white~cream~0.5', 'stone', 'cream'] });
  const w = rng.range(5.2, 6.4) * ctx.size; const d = rng.range(9, 12); const h = rng.range(3.3, 3.6);
  s.box([-w / 2 - 0.15, -d / 2 - 0.15, 0], [w / 2 + 0.15, d / 2 + 0.15, 0.5], 'stone');
  s.box([-w / 2, -d / 2, 0], [w / 2, d / 2, h], 'wall');
  const doorSize = door(s, 0, -d / 2, 1.25);
  s.prism([0, -d / 2 - 0.42], 0.5, [h + 0.69, h + 0.81], 'window', { n: 8 }, { pivot: [0, -d / 2 - 0.42, h + 0.75], rx: 90 });
  const bays = Math.max(3, Math.round(d / 2.6));
  for (let i = 0; i < bays; i++) for (const side of ['left', 'right']) windowAt(s, side, -d / 2 + (i + 0.5) * d / bays, (side === 'left' ? -1 : 1) * w / 2, 1.1, 0.6, 1.7);
  const pitch = rng.range(1.0, 1.25);
  const ruined = ctx.has('ruined');
  const ridge = ruined ? h + (w / 2 + 0.35) * pitch : roofOver(s, 'gable', w, d, h, pitch, 0.35);
  const tw = rng.range(2.6, 3.2); const th = ruined ? h + rng.range(1, 2.5) : ridge + rng.range(2.5, 4.5);
  const ty = d / 2 - tw / 2;
  s.box([-tw / 2, ty - tw / 2, 0], [tw / 2, ty + tw / 2, th], 'wall');
  if (ruined) {
    s.box([-tw / 2, ty + tw / 2 - 0.4, th], [0, ty + tw / 2, th + rng.range(0.8, 1.8)], 'wall');
    return { solids: s.list, colors, facts: { storeys: 1, storeyHeight: h, door: doorSize, peak: th }, features: ['roofless', 'broken tower'] };
  }
  for (const side of ['left', 'right']) windowAt(s, side, ty, (side === 'left' ? -1 : 1) * tw / 2, th - 1.9, 0.5, 1.2);
  const spire = rng.range(3, 5);
  s.pyramid([-tw / 2 - 0.25, ty - tw / 2 - 0.25, th], [tw / 2 + 0.25, ty + tw / 2 + 0.25, th + spire], 'roof');
  s.box([-0.04, ty - 0.04, th + spire - 0.1], [0.04, ty + 0.04, th + spire + 0.7], 'accent');
  return { solids: s.list, colors, facts: { storeys: 1, storeyHeight: h, door: doorSize, peak: th + spire + 0.7 }, features: ['steeple', 'rose window'] };
}

/** Shrine: an open roof on pillars over a small altar, on a stepped base. No door to scale; pillars clear 2.4 m. */
export function shrine(ctx) {
  const rng = ctx.rng('layout');
  const s = solidList();
  const colors = buildingColors(ctx, { wall: ['stone~white~0.3', 'stone', 'cream', 'stone~cream~0.5'] });
  const w = rng.range(3.2, 4.4) * ctx.size; const d = rng.range(3.2, 4.4);
  s.box([-w / 2 - 0.5, -d / 2 - 0.5, 0], [w / 2 + 0.5, d / 2 + 0.5, 0.2], 'stone');
  s.box([-w / 2, -d / 2, 0.2], [w / 2, d / 2, 0.4], 'wall');
  const clear = rng.range(2.4, 2.8); const top = 0.4 + clear;
  const round = rng.chance(0.6);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (w / 2 - 0.35); const y = sy * (d / 2 - 0.35);
    if (round) s.prism([x, y], 0.2, [0.4, top], 'wall', { n: 6 }); else s.box([x - 0.18, y - 0.18, 0.4], [x + 0.18, y + 0.18, top], 'wall');
  }
  let peak = top;
  if (!ctx.has('ruined')) { s.box([-w / 2 - 0.1, -d / 2 - 0.1, top], [w / 2 + 0.1, d / 2 + 0.1, top + 0.25], 'wall'); peak = roofOver(s, rng.chance(0.5) ? 'hip' : 'gable', w, d, top + 0.25, rng.range(0.6, 0.9), 0.4); }
  s.box([-0.45, -0.3, 0.4], [0.45, 0.3, 1.25], 'stone');
  s.prism([0, 0], 0.16, [1.25, 1.6], 'accent', { n: 6, r1: 0.08 });
  s.prism([0, 0], 0.13, [1.6, 1.85], 'gold', { n: 6, r1: 0 });
  colors.gold = 'gold';
  return { solids: s.list, colors, facts: { storeys: 1, storeyHeight: clear, peak, open: true }, features: ['pillars', 'altar'] };
}

/** Lighthouse: a tall tapering round tower in bands, a gallery, a lit lantern room and a cap. */
export function lighthouse(ctx) {
  const rng = ctx.rng('layout');
  const s = solidList();
  const colors = buildingColors(ctx, { wall: ['white', 'white~cream~0.5', 'cream'] });
  colors.band = ctx.colors.pick(ctx.rng('palette'), ['red', 'brick', 'cloth', 'night'], [colors.wall], 1.6);
  colors.light = 'flame';
  const storeys = ctx.count ? Math.max(3, Math.min(7, ctx.count)) : Math.round(rng.int(4, 6) * Math.min(1.25, ctx.size));
  const h = 3.0; const top = storeys * h;
  const r0 = rng.range(2.4, 3.0); const r1 = r0 * rng.range(0.62, 0.75);
  const rAt = (z) => r0 + (r1 - r0) * z / top;
  s.prism([0, 0], r0 + 0.3, [0, 0.5], 'stone', { n: 12 });
  for (let i = 0; i < storeys; i++) s.prism([0, 0], rAt(i * h), [i * h, (i + 1) * h], i % 2 ? 'band' : 'wall', { n: 12, r1: rAt((i + 1) * h) });
  const doorSize = door(s, 0, -r0 * Math.cos(Math.PI / 12) + 0.03, 1.0);
  s.prism([0, 0], r1 + 0.6, [top, top + 0.2], 'stone', { n: 12 });
  s.prism([0, 0], r1 * 0.72, [top + 0.2, top + 1.9], 'light', { n: 8 });
  s.prism([0, 0], r1 * 0.95, [top + 1.9, top + 3.1], 'roof', { n: 8, r1: 0 });
  return { solids: s.list, colors, facts: { storeys, storeyHeight: h, door: doorSize, peak: top + 3.1 }, features: ['lantern room', 'gallery'] };
}
