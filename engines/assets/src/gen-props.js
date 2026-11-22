// Prop makers: street furniture, goods and landmarks. Sizes follow the world scale: a seat is
// 0.45 m high, a table 0.75, a counter 0.95, a crate fits in two arms, a lamp clears a head.
import { solidList } from './gen-solid.js';
import { POOLS } from './gen-palette.js';

function propColors(ctx) {
  const rng = ctx.rng('palette');
  const c = ctx.colors;
  const word = (ctx.traits.colors[0] && c.word(rng, ctx.traits.colors[0])) || null;
  const wood = ctx.traits.material === 'stone' ? 'stone' : c.pick(rng, ['wood', 'wood~ink~0.25', 'wood~cream~0.3', 'cream~wood~0.6']);
  return {
    wood, dark: c.shade(wood, -0.35), stone: ctx.traits.material === 'wood' ? 'wood' : c.pick(rng, ['stone', 'stone~cream~0.4', 'stone~ink~0.2', 'stone~white~0.3']),
    metal: c.pick(rng, POOLS.metal), cloth: word ?? c.pick(rng, POOLS.cloth, [wood], 1.3), trim: c.pick(rng, ['cream', 'white', 'gold'], [wood], 1.3),
    ember: 'ember', flame: 'flame', gold: 'gold', water: 'sky', leaf: 'leaf', ink: 'ink~night~0.5',
  };
}

const MAKERS = {
  /** A stack of one to six crates. */
  crates(ctx, s, rng) {
    const n = ctx.count ?? rng.int(1, 5);
    const a = rng.range(0.6, 0.85) * ctx.size;
    const spots = [[0, 0, 0], [a * 1.08, 0.1, 0], [0.5 * a, 0.05, a], [-a * 1.1, -0.1, 0], [0.4 * a, a * 1.1, 0], [-0.4 * a, 0, a]];
    for (let i = 0; i < n; i++) {
      const [x, y, z] = spots[i]; const k = i ? rng.range(0.8, 1) : 1; const h = a * k / 2;
      const turn = { pivot: [x, y, z], rz: rng.range(-14, 14) };
      s.box([x - h, y - h, z], [x + h, y + h, z + a * k], 'wood', turn);
      s.box([x - h - 0.02, y - h - 0.02, z + a * k * 0.42], [x + h + 0.02, y + h + 0.02, z + a * k * 0.58], 'dark', turn);
    }
    return ['stack of ' + n];
  },
  /** One to five barrels, about 1 m tall, with hoops. */
  barrels(ctx, s, rng) {
    const n = ctx.count ?? rng.int(1, 4);
    const spots = [[0, 0], [0.95, 0.15], [-0.9, 0.2], [0.45, 0.9], [-0.5, 0.95]];
    for (let i = 0; i < n; i++) {
      const [x, y] = spots[i]; const h = rng.range(0.9, 1.05) * ctx.size; const r = h * 0.38;
      s.prism([x, y], r, [0, h / 2], 'wood', { n: 8, r1: r * 1.2 });
      s.prism([x, y], r * 1.2, [h / 2, h], 'wood', { n: 8, r1: r });
      for (const z of [h * 0.2, h * 0.76]) s.prism([x, y], r * 1.14, [z, z + 0.05], 'metal', { n: 8 });
    }
    return [n + ' barrel' + (n > 1 ? 's' : '')];
  },
  /** Hand cart: a bed on two wheels with shafts, sometimes loaded. */
  cart(ctx, s, rng) {
    const len = rng.range(1.9, 2.5) * ctx.size; const w = rng.range(1.1, 1.35); const bed = 0.75;
    s.box([-len / 2, -w / 2, bed], [len / 2, w / 2, bed + 0.08], 'wood');
    for (const y of [-w / 2, w / 2 - 0.06]) s.box([-len / 2, y, bed + 0.08], [len / 2, y + 0.06, bed + 0.45], 'wood');
    s.box([len / 2 - 0.06, -w / 2, bed + 0.08], [len / 2, w / 2, bed + 0.45], 'wood');
    const wr = 0.55;
    for (const y of [-w / 2 - 0.1, w / 2 + 0.1]) {
      s.prism([0, y], wr, [wr - 0.04, wr + 0.04], 'dark', { n: 10 }, { pivot: [0, y, wr], rx: 90 });
      s.prism([0, y], 0.12, [wr - 0.07, wr + 0.07], 'metal', { n: 6 }, { pivot: [0, y, wr], rx: 90 });
    }
    for (const y of [-w / 2 + 0.05, w / 2 - 0.11]) s.box([-len / 2 - 1.1, y, bed - 0.02], [-len / 2, y + 0.06, bed + 0.06], 'wood');
    s.box([-len / 2 + 0.1, -0.04, 0], [-len / 2 + 0.18, 0.04, bed], 'wood');
    const load = rng.chance(0.65);
    if (load) { s.box([-0.6, -0.35, bed + 0.08], [0.05, 0.3, bed + 0.6], 'cloth'); s.prism([0.5, 0], 0.3, [bed + 0.08, bed + 0.75], 'trim', { n: 8 }); }
    return [load ? 'loaded' : 'empty'];
  },
  /** Market stall: counter, goods and a striped cloth roof on four posts. */
  stall(ctx, s, rng) {
    const w = rng.range(2.4, 3.2) * ctx.size; const d = rng.range(1.5, 1.9); const top = rng.range(2.3, 2.6);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.box([sx * w / 2 - 0.05, sy * d / 2 - 0.05, 0], [sx * w / 2 + 0.05, sy * d / 2 + 0.05, top + (sy > 0 ? 0.35 : 0)], 'wood');
    s.box([-w / 2, -d / 2, 0.87], [w / 2, -d / 2 + 0.7, 0.95], 'wood');
    s.box([-w / 2, -d / 2, 0], [w / 2, -d / 2 + 0.06, 0.87], 'dark');
    const stripes = Math.max(4, Math.round(w / 0.45));
    for (let i = 0; i < stripes; i++) s.box([-w / 2 - 0.15 + i * (w + 0.3) / stripes, -d / 2 - 0.35, top + 0.33], [-w / 2 - 0.15 + (i + 1) * (w + 0.3) / stripes, d / 2 + 0.1, top + 0.39], i % 2 ? 'trim' : 'cloth', { pivot: [0, d / 2, top + 0.39], rx: 11 });
    const goods = rng.int(2, 4);
    for (let i = 0; i < goods; i++) { const x = -w / 2 + (i + 0.5) * w / goods; if (i % 2) s.box([x - 0.25, -d / 2 + 0.12, 0.95], [x + 0.25, -d / 2 + 0.58, 1.15], 'dark'); else s.prism([x, -d / 2 + 0.35], 0.2, [0.95, 1.2], i % 4 ? 'gold' : 'leaf', { n: 6, r1: 0.12 }); }
    return ['counter', 'striped roof'];
  },
  /** Bench: a 0.45 m seat, with or without a back. */
  bench(ctx, s, rng) {
    const len = rng.range(1.4, 2.1) * ctx.size; const back = rng.chance(0.6);
    const leg = ctx.traits.material === 'stone' ? 'stone' : 'dark';
    for (const x of [-len / 2 + 0.12, len / 2 - 0.2]) s.box([x, -0.2, 0], [x + 0.08, 0.2, 0.41], leg);
    s.box([-len / 2, -0.22, 0.41], [len / 2, 0.22, 0.47], 'wood');
    if (back) { for (const x of [-len / 2 + 0.12, len / 2 - 0.2]) s.box([x, 0.16, 0.47], [x + 0.08, 0.22, 0.95], leg); s.box([-len / 2, 0.17, 0.7], [len / 2, 0.21, 0.93], 'wood'); }
    return [back ? 'with a back' : 'no back'];
  },
  /** Table 0.75 m high with stools, sometimes laid. */
  table(ctx, s, rng) {
    const w = rng.range(1.3, 2) * ctx.size; const d = rng.range(0.8, 1);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.box([sx * (w / 2 - 0.1) - 0.04, sy * (d / 2 - 0.1) - 0.04, 0], [sx * (w / 2 - 0.1) + 0.04, sy * (d / 2 - 0.1) + 0.04, 0.7], 'dark');
    s.box([-w / 2, -d / 2, 0.7], [w / 2, d / 2, 0.76], 'wood');
    const stools = rng.int(0, 3);
    for (let i = 0; i < stools; i++) { const x = -w / 2 + (i + 0.5) * w / Math.max(1, stools); s.prism([x, (i % 2 ? 1 : -1) * (d / 2 + 0.4)], 0.19, [0, 0.45], 'wood', { n: 8 }); }
    if (rng.chance(0.6)) { s.prism([w * 0.2, 0], 0.09, [0.76, 0.98], 'metal', { n: 6, r1: 0.06 }); s.box([-w * 0.3, -0.12, 0.76], [-w * 0.05, 0.12, 0.8], 'trim'); }
    return [stools + ' stools'];
  },
  /** Fountain: a low round basin of water around a column and bowl. */
  fountain(ctx, s, rng) {
    const r = rng.range(1.5, 2.3) * ctx.size; const col = rng.range(1.5, 2.2);
    s.prism([0, 0], r + 0.15, [0, 0.15], 'stone', { n: 12 });
    s.prism([0, 0], r, [0.15, 0.6], 'stone', { n: 12 });
    s.prism([0, 0], r - 0.22, [0.6, 0.62], 'water', { n: 12 });
    s.prism([0, 0], 0.26, [0.15, col], 'stone', { n: 8, r1: 0.18 });
    s.prism([0, 0], 0.3, [col, col + 0.22], 'stone', { n: 10, r1: 0.75 });
    s.prism([0, 0], 0.62, [col + 0.22, col + 0.24], 'water', { n: 10 });
    if (rng.chance(0.5)) s.prism([0, 0], 0.1, [col + 0.22, col + 0.7], 'stone', { n: 6, r1: 0.03 });
    return ['two tiers'];
  },
  /** Statue: a plinth with a simple standing figure a little larger than life. */
  statue(ctx, s, rng) {
    const plinth = rng.range(0.7, 1.2); const k = rng.range(1.05, 1.3) * ctx.size; const z = plinth;
    const body = rng.chance(0.3) ? 'metal' : 'stone';
    s.box([-0.6, -0.6, 0], [0.6, 0.6, 0.18], 'stone'); s.box([-0.48, -0.48, 0.18], [0.48, 0.48, plinth], 'stone');
    for (const x of [-0.13, 0.13]) s.limb([x * k, 0, z], [x * k, 0, z + 0.85 * k], [0.09 * k, 0.11 * k], body);
    s.limb([0, 0, z + 0.8 * k], [0, 0, z + 1.42 * k], [0.2 * k, 0.24 * k], body);
    s.ball([0, 0, z + 1.63 * k], [0.13 * k, 0.14 * k, 0.15 * k], body);
    const raised = rng.chance(0.5);
    s.limb([-0.26 * k, 0, z + 1.38 * k], [-0.34 * k, -0.05, z + 0.85 * k], [0.07 * k, 0.06 * k], body);
    if (raised) { s.limb([0.26 * k, 0, z + 1.38 * k], [0.42 * k, -0.1, z + 1.9 * k], [0.07 * k, 0.06 * k], body); s.limb([0.42 * k, -0.1, z + 1.85 * k], [0.42 * k, -0.1, z + 2.5 * k], [0.03, 0.02], body); } else s.limb([0.26 * k, 0, z + 1.38 * k], [0.34 * k, -0.05, z + 0.85 * k], [0.07 * k, 0.06 * k], body);
    return [raised ? 'arm raised' : 'arms at rest'];
  },
  /** Campfire: a ring of stones, crossed logs and a flame. */
  campfire(ctx, s, rng) {
    const r = rng.range(0.5, 0.7) * ctx.size; const n = rng.int(6, 9);
    for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; const sz = rng.range(0.08, 0.12); s.ball([Math.cos(a) * r, Math.sin(a) * r, sz * 0.8], [rng.range(0.11, 0.16), rng.range(0.11, 0.16), sz * 0.8], 'stone'); }
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI + rng.range(0, 0.4); s.limb([Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75, 0.07], [-Math.cos(a) * r * 0.5, -Math.sin(a) * r * 0.5, 0.26], 0.06, 'dark'); }
    const lit = !ctx.has('ruined');
    if (lit) { s.prism([0, 0], r * 0.42, [0.12, 0.6], 'ember', { n: 6, r1: 0 }); s.prism([0, 0], r * 0.24, [0.14, 0.82], 'flame', { n: 6, r1: 0 }); }
    return [lit ? 'lit' : 'cold'];
  },
  /** Chest: a banded box with a rounded lid and a lock. */
  chest(ctx, s, rng) {
    const w = rng.range(0.8, 1.1) * ctx.size; const d = w * 0.6; const h = w * 0.42;
    s.box([-w / 2, -d / 2, 0], [w / 2, d / 2, h], 'wood');
    s.gable([-w / 2, -d / 2, h], [w / 2, d / 2, h + d * 0.36], 'wood');
    for (const x of [-w / 2 + 0.08, w / 2 - 0.16]) { s.box([x, -d / 2 - 0.015, 0], [x + 0.08, d / 2 + 0.015, h + 0.01], 'metal'); }
    s.box([-0.06, -d / 2 - 0.04, h - 0.14], [0.06, -d / 2, h + 0.02], ctx.has('rich') || rng.chance(0.5) ? 'gold' : 'metal');
    return ['banded'];
  },
  /** One to three gravestones, waist to chest high. */
  tombstone(ctx, s, rng) {
    const n = ctx.count ?? rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 1.2; const h = rng.range(0.85, 1.2) * ctx.size; const w = rng.range(0.5, 0.65);
      const turn = { pivot: [x, 0, 0], rx: rng.range(-7, 7), rz: rng.range(-8, 8) };
      const kind = rng.int(0, 2);
      s.box([x - w / 2, -0.08, 0], [x + w / 2, 0.08, h * (kind === 2 ? 0.55 : 0.8)], 'stone', turn);
      if (kind === 0) s.gable([x - w / 2, -0.08, h * 0.8], [x + w / 2, 0.08, h], 'stone', 'y');
      else if (kind === 1) s.box([x - w / 2 + 0.07, -0.08, h * 0.8], [x + w / 2 - 0.07, 0.08, h], 'stone', turn);
      else { s.box([x - 0.07, -0.07, h * 0.55], [x + 0.07, 0.07, h * 1.25], 'stone', turn); s.box([x - 0.24, -0.07, h * 0.9], [x + 0.24, 0.07, h * 1.03], 'stone', turn); }
      s.box([x - w / 2 - 0.1, -0.35, 0], [x + w / 2 + 0.1, -0.08, 0.06], 'leaf');
    }
    return [n + ' stone' + (n > 1 ? 's' : '')];
  },
  /** Signpost with one to three pointing boards. */
  signpost(ctx, s, rng) {
    const h = rng.range(2.2, 2.7) * ctx.size; const n = ctx.count ? Math.min(3, ctx.count) : rng.int(1, 3);
    s.box([-0.06, -0.06, 0], [0.06, 0.06, h], 'dark');
    for (let i = 0; i < n; i++) { const z = h - 0.35 - i * 0.34; const dir = i % 2 ? -1 : 1; s.box([dir > 0 ? -0.15 : -0.95, -0.09, z], [dir > 0 ? 0.95 : 0.15, -0.06, z + 0.24], 'wood', { pivot: [0, 0, z], rz: rng.range(-25, 25) }); }
    return [n + ' board' + (n > 1 ? 's' : '')];
  },
  /** Street lamp: a post whose lantern hangs above head height. */
  lamp(ctx, s, rng) {
    const h = rng.range(2.5, 3.1) * ctx.size; const arm = rng.chance(0.5);
    s.prism([0, 0], 0.16, [0, 0.25], 'metal', { n: 6 }); s.prism([0, 0], 0.06, [0.25, h], 'metal', { n: 6 });
    const x = arm ? 0.5 : 0; const z = arm ? h - 0.55 : h;
    if (arm) s.box([0, -0.03, h - 0.08], [0.55, 0.03, h - 0.02], 'metal');
    s.box([x - 0.14, -0.14, z], [x + 0.14, 0.14, z + 0.34], 'flame');
    s.pyramid([x - 0.2, -0.2, z + 0.34], [x + 0.2, 0.2, z + 0.52], 'metal');
    return [arm ? 'hanging lantern' : 'top lantern'];
  },
  /** Weapon rack: a frame holding spears and a shield. */
  rack(ctx, s, rng) {
    const w = rng.range(1.4, 1.9) * ctx.size;
    for (const x of [-w / 2, w / 2 - 0.08]) s.box([x, -0.25, 0], [x + 0.08, 0.25, 1.25], 'dark');
    for (const z of [0.35, 1.1]) s.box([-w / 2, -0.04, z], [w / 2, 0.04, z + 0.08], 'wood');
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) { const x = -w / 2 + (i + 1) * w / (n + 1); const len = rng.range(1.5, 2.1); s.limb([x, -0.12, 0.02], [x, 0.02, len], 0.022, 'wood'); s.limb([x, 0.02, len], [x, 0.03, len + 0.26], [0.045, 0.006], 'metal'); }
    if (rng.chance(0.6)) s.ball([0, -0.2, 0.62], [0.3, 0.05, 0.34], 'cloth');
    return [n + ' spears'];
  },
  /** Anvil on a tree stump, at working height. */
  anvil(ctx, s, rng) {
    const k = ctx.size; const st = rng.range(0.5, 0.6) * k;
    s.prism([0, 0], 0.3 * k, [0, st], 'wood', { n: 8 });
    s.box([-0.2 * k, -0.12 * k, st], [0.2 * k, 0.12 * k, st + 0.1 * k], 'metal');
    s.box([-0.12 * k, -0.08 * k, st + 0.1 * k], [0.12 * k, 0.08 * k, st + 0.2 * k], 'metal');
    s.box([-0.34 * k, -0.13 * k, st + 0.2 * k], [0.28 * k, 0.13 * k, st + 0.32 * k], 'metal');
    s.limb([0.28 * k, 0, st + 0.27 * k], [0.52 * k, 0, st + 0.29 * k], [0.06 * k, 0.015], 'metal');
    return ['on a stump'];
  },
  /** Woodpile: stacked split logs between two stakes. */
  woodpile(ctx, s, rng) {
    const w = rng.range(1.4, 2.2) * ctx.size; const rows = rng.int(3, 5); const r = 0.1;
    for (let j = 0; j < rows; j++) { const n = Math.floor((w - j * 0.12) / (r * 2)); for (let i = 0; i < n; i++) { const x = -n * r + r + i * r * 2; s.prism([x, 0], r * rng.range(0.82, 1), [r + j * r * 1.8 - r, r + j * r * 1.8 + r], (i + j) % 3 ? 'wood' : 'dark', { n: 6 }, { pivot: [x, 0, r + j * r * 1.8], rx: 90 }); } }
    for (const x of [-w / 2 - 0.05, w / 2 + 0.05]) s.box([x - 0.04, -0.04, 0], [x + 0.04, 0.04, rows * r * 1.8 + 0.3], 'dark');
    return [rows + ' rows'];
  },
  /** Cauldron on three legs over embers. */
  cauldron(ctx, s, rng) {
    const r = rng.range(0.38, 0.52) * ctx.size;
    for (let i = 0; i < 3; i++) { const a = i / 3 * 2 * Math.PI + 0.5; s.limb([Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8, 0.04], [Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, 0.3], 0.035, 'metal'); }
    s.ball([0, 0, 0.28 + r * 0.8], [r, r, r * 0.85], 'metal');
    s.prism([0, 0], r * 0.9, [0.28 + r * 1.35, 0.28 + r * 1.5], 'metal', { n: 10, r1: r * 0.98 });
    s.prism([0, 0], r * 0.8, [0.28 + r * 1.5, 0.28 + r * 1.52], rng.chance(0.5) ? 'leaf' : 'cloth', { n: 10 });
    s.prism([0, 0], r * 0.5, [0, 0.16], 'ember', { n: 6, r1: 0.05 });
    return ['bubbling'];
  },
  /** Banner on a tall pole. */
  banner(ctx, s, rng) {
    const h = rng.range(3.2, 4.2) * ctx.size; const w = rng.range(0.7, 0.95); const len = rng.range(1.3, 1.9);
    s.prism([0, 0], 0.2, [0, 0.12], 'stone', { n: 6 }); s.prism([0, 0], 0.04, [0.12, h], 'dark', { n: 6 });
    s.box([-0.05, -0.02, h - 0.12], [w + 0.05, 0.02, h - 0.06], 'dark');
    s.box([0.03, -0.015, h - 0.12 - len], [w, 0.015, h - 0.12], 'cloth');
    s.box([0.03 + w * 0.3, -0.03, h - 0.12 - len * 0.62], [w * 0.72, 0.03, h - 0.12 - len * 0.3], 'trim');
    s.pyramid([0.03, -0.015, h - 0.4 - len], [w, 0.015, h - 0.12 - len], 'cloth');
    return ['hanging cloth'];
  },
  /** Obelisk or standing pillar on a base. */
  obelisk(ctx, s, rng) {
    const h = rng.range(2.6, 4.2) * ctx.size; const w = rng.range(0.5, 0.75); const round = ctx.has('round') || rng.chance(0.35);
    s.box([-w * 0.9, -w * 0.9, 0], [w * 0.9, w * 0.9, 0.3], 'stone');
    if (round) { s.prism([0, 0], w / 2, [0.3, h], 'stone', { n: 8, r1: w * 0.42 }); s.box([-w * 0.6, -w * 0.6, h], [w * 0.6, w * 0.6, h + 0.2], 'stone'); } else if (ctx.has('ruined')) s.prism([0, 0], w * 0.6, [0.3, h * 0.6], 'stone', { n: 4, r1: w * 0.5 }); else { s.prism([0, 0], w * 0.7, [0.3, h * 0.88], 'stone', { n: 4, r1: w * 0.42 }); s.prism([0, 0], w * 0.42, [h * 0.88, h], 'gold', { n: 4, r1: 0 }); }
    return [round ? 'column' : 'obelisk'];
  },
  /** Altar: a stone table on steps with offerings. */
  altar(ctx, s, rng) {
    const w = rng.range(1.5, 2.1) * ctx.size; const d = rng.range(0.8, 1);
    s.box([-w / 2 - 0.4, -d / 2 - 0.4, 0], [w / 2 + 0.4, d / 2 + 0.4, 0.15], 'stone');
    s.box([-w / 2 + 0.12, -d / 2 + 0.1, 0.15], [w / 2 - 0.12, d / 2 - 0.1, 0.95], 'stone');
    s.box([-w / 2, -d / 2, 0.95], [w / 2, d / 2, 1.07], 'stone');
    s.box([-w * 0.22, -d / 2 - 0.01, 0.55], [w * 0.22, d / 2 + 0.01, 1.08], 'cloth');
    for (const x of [-w * 0.36, w * 0.36]) { s.prism([x, 0], 0.035, [1.07, 1.35], 'trim', { n: 6 }); s.prism([x, 0], 0.04, [1.35, 1.45], 'flame', { n: 6, r1: 0 }); }
    s.prism([0, 0], 0.14, [1.08, 1.2], 'gold', { n: 8, r1: 0.2 });
    return ['candles', 'offering bowl'];
  },
  /** Water trough on trestles. */
  trough(ctx, s, rng) {
    const len = rng.range(1.6, 2.4) * ctx.size;
    for (const x of [-len / 2 + 0.2, len / 2 - 0.3]) s.box([x, -0.3, 0], [x + 0.1, 0.3, 0.3], 'dark');
    s.box([-len / 2, -0.32, 0.3], [len / 2, 0.32, 0.38], 'wood');
    for (const y of [-0.32, 0.26]) s.box([-len / 2, y, 0.38], [len / 2, y + 0.06, 0.7], 'wood');
    for (const x of [-len / 2, len / 2 - 0.06]) s.box([x, -0.32, 0.38], [x + 0.06, 0.32, 0.7], 'wood');
    s.box([-len / 2 + 0.06, -0.26, 0.6], [len / 2 - 0.06, 0.26, 0.62], 'water');
    return ['full of water'];
  },
};

export const PROP_TYPES = Object.keys(MAKERS);

/** Make one prop. Returns { solids, colors, facts, features }. */
export function makeProp(ctx, type) {
  if (!MAKERS[type]) throw new Error(`makeProp: unknown prop type "${type}". Known: ${PROP_TYPES.join(', ')}`);
  const s = solidList();
  const colors = propColors(ctx);
  const features = MAKERS[type](ctx, s, ctx.rng('layout'));
  const used = new Set(s.list.map((x) => x.c));
  return { solids: s.list, colors: Object.fromEntries(Object.entries(colors).filter(([k]) => used.has(k))), facts: {}, features };
}
