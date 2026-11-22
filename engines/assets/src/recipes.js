import { DUNGEON_RECIPES } from './recipes-dungeon.js';
import { GEN_RECIPES } from './gen-sprite.js';

// Recipes: each draws one kind of sprite on a 100x100 canvas (y grows downward, ground near y=88).
// They name colours by palette role and use the pen for finish, so every recipe works in every style.
// To add one: write draw(pen, params) and register it in RECIPES with its params documented.

function drawParcel(p, cx, cy, s, colors = {}) {
  const box = colors.box ?? 'wood';
  const str = colors.string ?? 'white';
  const h = s * 0.8;
  p.fill(p.rect(cx - s / 2, cy - h / 2, s, h, s * 0.08), box, { depth: s * 0.1 });
  p.line(`M${cx} ${cy - h / 2 + 1}L${cx} ${cy + h / 2 - 1}`, str, s * 0.09);
  p.line(`M${cx - s / 2 + 1} ${cy}L${cx + s / 2 - 1} ${cy}`, str, s * 0.09);
  // bow
  const b = s * 0.17;
  p.fill(p.ellipse(cx - b * 0.9, cy - h / 2 - b * 0.35, b, b * 0.62, { rot: 0.5, n: 8 }), str, { depth: 1 });
  p.fill(p.ellipse(cx + b * 0.9, cy - h / 2 - b * 0.35, b, b * 0.62, { rot: -0.5, n: 8 }), str, { depth: 1 });
  p.dot(cx, cy - h / 2 - b * 0.1, b * 0.42, p.tone(str, 'shadow'));
}

function spiral(cx, cy, r, turns = 1.8, start = 0.3) {
  let d = '';
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + t * turns * Math.PI * 2;
    const rr = r * (0.06 + 0.94 * t);
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`;
  }
  return d;
}

function eye(p, x, y, r, look = 0.3) {
  p.dot(x, y, r, 'white');
  p.dot(x + r * look, y + r * 0.1, r * 0.55, 'ink');
  p.dot(x + r * look - r * 0.2, y - r * 0.2, r * 0.2, 'white');
}

function starPath(cx, cy, outer, inner, points, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const r = i % 2 === 0 ? outer : inner;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

export const RECIPES = {
  snail: {
    description: 'Side-view snail courier with a spiral shell.',
    params: { facing: '"right" (default) or "left"', carrying: 'true to put a parcel on the shell', colors: 'body, shell' },
    draw(p, { facing = 'right', carrying = false, colors = {} }) {
      p.flip = facing === 'left';
      const body = colors.body ?? 'cream';
      const shell = colors.shell ?? 'plum';
      p.groundShadow(50, 88, 38, 6);
      // eye stalks behind the head
      p.line('M80 50Q77 40 75 31', body, 3.4, { outlined: true });
      p.line('M87 50Q90 41 91 33', body, 3.4, { outlined: true });
      p.fill(p.curve([[7, 85], [30, 88], [60, 88], [82, 87], [92, 78], [94, 62], [90, 50], [80, 47], [73, 54], [71, 66], [62, 73], [40, 75], [20, 77]]), body, { depth: 5 });
      eye(p, 75, 30, 5, p.flip ? 0.3 : 0.3);
      eye(p, 91, 32, 5);
      p.dot(84, 66, 3.6, 'pink', { opacity: 0.7 });
      p.line('M86 71Q89.5 73.5 92 70', p.tone(body, 'outline'), 1.6);
      // shell
      p.fill(p.ellipse(41, 50, 27, 26, { n: 12 }), shell, { depth: 6 });
      p.line(spiral(41, 51, 19, 1.7, 0.6), p.tone(shell, 'deep'), 3.2);
      p.line(spiral(41, 51, 19, 1.7, 0.6), p.tone(shell, 'light'), 1, { opacity: 0.5 });
      p.dot(30, 37, 3.2, 'white', { opacity: 0.55 });
      if (carrying) drawParcel(p, 41, 17, 24, colors);
    },
  },

  house: {
    description: 'Small cottage with a pitched roof, door, round windows and a chimney.',
    params: { delivered: 'true lights the windows and adds chimney smoke', colors: 'wall, roof, door' },
    draw(p, { delivered = false, colors = {} }) {
      const wall = colors.wall ?? 'cream';
      const roof = colors.roof ?? 'brick';
      const door = colors.door ?? 'wood';
      p.groundShadow(50, 89, 36, 5);
      if (delivered) {
        p.dot(73, 13, 5, 'white', { opacity: 0.85 });
        p.dot(80, 6, 3.6, 'white', { opacity: 0.6 });
      }
      p.fill(p.rect(63, 20, 12, 22, 2), 'stone', { depth: 2.5 });
      p.fill(p.rect(21, 46, 58, 43, 4), wall, { depth: 5 });
      p.fill(p.poly([[9, 52], [50, 14], [91, 52], [84, 56], [16, 56]], 5), roof, { depth: 5 });
      p.fill(p.poly([[43, 89], [43, 70], [50, 64], [57, 70], [57, 89]], 3), door, { depth: 2.5 });
      p.dot(54, 79, 1.5, 'gold');
      for (const x of [31, 69]) {
        if (delivered) p.halo(x, 70, 15, 'gold', 0.7);
        p.fill(p.ellipse(x, 70, 6.5, 6.5, { n: 8 }), delivered ? 'gold' : 'night', { depth: 2 });
        p.line(`M${x} 64L${x} 76M${x - 6} 70L${x + 6} 70`, p.tone(wall, 'outline'), 1.3, { opacity: 0.8 });
      }
    },
  },

  parcel: {
    description: 'Wrapped parcel tied with string and a bow.',
    params: { colors: 'box, string' },
    draw(p, { colors = {} }) {
      p.groundShadow(50, 86, 30, 5);
      drawParcel(p, 50, 60, 56, colors);
    },
  },

  grass: {
    description: 'Ground tile with tufts and the odd flower. Fills the whole cell.',
    tile: true,
    params: { alt: 'true uses the alternate shade (for checkerboards)', flowers: 'chance of flowers, 0 to 1 (default 0.35)', colors: 'ground' },
    draw(p, { alt = false, flowers = 0.35, colors = {} }) {
      const ground = colors.ground ?? (alt ? 'grassAlt' : 'grass');
      p.flat('M0 0H100V100H0Z', ground);
      const light = p.tone(ground, 'light');
      const dark = p.tone(ground, 'shadow');
      for (let i = 0; i < 4; i++) {
        p.flat(p.blob(p.rng.range(10, 90), p.rng.range(10, 90), p.rng.range(9, 16)), i % 2 ? light : dark, { opacity: 0.22 });
      }
      for (let i = 0; i < 7; i++) {
        const [x, y] = [p.rng.range(10, 90), p.rng.range(16, 92)];
        const h = p.rng.range(5, 9);
        p.line(`M${x - 3} ${y - h * 0.7}L${x} ${y}L${x} ${y - h}M${x} ${y}L${x + 3.5} ${y - h * 0.75}`, i % 3 ? light : dark, 1.5, { opacity: 0.8 });
      }
      if (p.rng.chance(flowers)) {
        const [x, y] = [p.rng.range(18, 82), p.rng.range(18, 82)];
        const petal = p.rng.pick(['white', 'pink', 'gold']);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          p.dot(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.3, petal);
        }
        p.dot(x, y, 1.9, petal === 'gold' ? 'white' : 'gold');
      }
    },
  },

  hedge: {
    description: 'Leafy hedge wall tile with berries. Fills the whole cell.',
    tile: true,
    params: { berries: 'chance of berries, 0 to 1 (default 0.6)', colors: 'leaf, base' },
    draw(p, { berries = 0.6, colors = {} }) {
      const leaf = colors.leaf ?? 'leaf';
      const base = colors.base ?? 'leafDark';
      p.flat('M0 0H100V100H0Z', base);
      const spots = [[26, 28, 24], [72, 26, 23], [50, 52, 25], [24, 74, 22], [76, 74, 23]];
      for (const [x, y, r] of spots) {
        p.fill(p.blob(x + p.rng.range(-3, 3), y + p.rng.range(-3, 3), r, { n: 10, bumpy: 0.16 }), leaf, { depth: 5 });
      }
      for (let i = 0; i < 9; i++) {
        const [x, y] = [p.rng.range(12, 88), p.rng.range(12, 88)];
        p.line(`M${x} ${y}q3 -4 6 0q-3 3 -6 0`, p.tone(leaf, 'light'), 1.2, { opacity: 0.7 });
      }
      if (p.rng.chance(berries)) {
        for (let i = 0; i < 3; i++) {
          const [x, y] = [p.rng.range(18, 82), p.rng.range(18, 82)];
          p.fill(p.ellipse(x, y, 3.4, 3.4, { n: 8, wobble: 0 }), 'red', { depth: 1.2 });
          p.dot(x - 1, y - 1, 0.9, 'white', { opacity: 0.8 });
        }
      }
    },
  },

  slime: {
    description: 'Glossy translucent trail patch to overlay on a ground tile.',
    params: { colors: 'slime' },
    draw(p, { colors = {} }) {
      const c = colors.slime ?? 'slime';
      const d = p.blob(50, 52, 30, { n: 9, bumpy: 0.2 });
      p.flat(d, c, { opacity: 0.5 });
      p.line(d, p.tone(c, 'light'), 2, { opacity: 0.75 });
      p.flat(p.ellipse(40, 41, 9, 4.5, { rot: -0.5, n: 8 }), 'white', { opacity: 0.6 });
      p.dot(60, 62, 2.6, 'white', { opacity: 0.5 });
      p.flat(p.blob(78, 24, 5), c, { opacity: 0.5 });
      p.flat(p.blob(20, 80, 4), c, { opacity: 0.5 });
    },
  },

  mushroom: {
    description: 'Spotted toadstool.',
    params: { colors: 'cap, stem' },
    draw(p, { colors = {} }) {
      p.groundShadow(50, 88, 22, 4);
      p.fill(p.curve([[41, 56], [59, 56], [62, 84], [50, 88], [38, 84]]), colors.stem ?? 'cream', { depth: 3 });
      p.fill(p.curve([[14, 56], [22, 30], [50, 16], [78, 30], [86, 56], [68, 62], [50, 60], [32, 62]]), colors.cap ?? 'red', { depth: 6 });
      for (const [x, y, r] of [[36, 34, 5.5], [58, 28, 4.2], [68, 46, 4.8], [26, 50, 3.4], [48, 46, 3]]) {
        p.flat(p.ellipse(x, y, r, r * 0.85, { n: 8 }), 'white', { opacity: 0.95 });
      }
    },
  },

  flower: {
    description: 'Flower on a stem with two leaves.',
    params: { petals: 'number of petals (default 6)', colors: 'petal, center, stem' },
    draw(p, { petals = 6, colors = {} }) {
      const stem = colors.stem ?? 'leaf';
      p.groundShadow(50, 90, 14, 3);
      p.line('M50 90Q46 70 50 46', stem, 4, { outlined: true });
      p.fill(p.curve([[49, 76], [34, 66], [26, 70], [36, 80]]), stem, { depth: 2 });
      p.fill(p.curve([[50, 68], [64, 58], [73, 62], [62, 72]]), stem, { depth: 2 });
      for (let k = 0; k < petals; k++) {
        const a = (k / petals) * Math.PI * 2 - Math.PI / 2;
        p.fill(p.ellipse(50 + Math.cos(a) * 15, 36 + Math.sin(a) * 15, 10, 7.5, { rot: a, n: 8 }), colors.petal ?? 'pink', { depth: 2.5 });
      }
      p.fill(p.ellipse(50, 36, 8.5, 8.5, { n: 8 }), colors.center ?? 'gold', { depth: 2.5 });
    },
  },

  rock: {
    description: 'Boulder with a crack.',
    params: { colors: 'rock' },
    draw(p, { colors = {} }) {
      const c = colors.rock ?? 'stone';
      p.groundShadow(50, 86, 36, 6);
      p.fill(p.poly([[14, 84], [18, 54], [36, 32], [62, 28], [84, 50], [88, 84]], 10, 3), c, { depth: 7 });
      p.line('M48 34L52 48L46 58', p.tone(c, 'deep'), 1.8, { opacity: 0.8 });
      p.fill(p.poly([[58, 86], [62, 68], [76, 64], [90, 74], [92, 86]], 5, 2), c, { depth: 4 });
    },
  },

  tree: {
    description: 'Round leafy tree.',
    params: { fruit: 'true adds fruit', colors: 'leaf, trunk, fruit' },
    draw(p, { fruit = false, colors = {} }) {
      const leaf = colors.leaf ?? 'leaf';
      p.groundShadow(50, 90, 28, 5);
      p.fill(p.poly([[43, 90], [45, 56], [55, 56], [57, 90]], 3), colors.trunk ?? 'wood', { depth: 3 });
      p.fill(p.blob(30, 50, 19, { n: 9 }), leaf, { depth: 5 });
      p.fill(p.blob(70, 50, 19, { n: 9 }), leaf, { depth: 5 });
      p.fill(p.blob(50, 34, 25, { n: 10 }), leaf, { depth: 7 });
      if (fruit) {
        for (const [x, y] of [[38, 30], [60, 40], [50, 22], [70, 54], [28, 52]]) {
          p.fill(p.ellipse(x, y, 4, 4, { n: 8, wobble: 0 }), colors.fruit ?? 'red', { depth: 1.5 });
        }
      }
    },
  },

  lantern: {
    description: 'Hand lantern with a glowing flame.',
    params: { lit: 'false for an unlit lantern (default true)', colors: 'frame, glow' },
    draw(p, { lit = true, colors = {} }) {
      const frame = colors.frame ?? 'wood';
      const glow = colors.glow ?? 'gold';
      if (lit) p.halo(50, 56, 48, glow, 0.75);
      p.line('M36 30Q50 2 64 30', frame, 3.2, { outlined: true });
      p.fill(p.poly([[32, 36], [38, 26], [62, 26], [68, 36]], 3), frame, { depth: 3 });
      p.fill(p.poly([[35, 36], [65, 36], [69, 78], [31, 78]], 5), lit ? glow : 'night', { depth: 5 });
      if (lit) {
        p.flat(p.curve([[50, 44], [58, 60], [50, 72], [42, 60]]), 'ember', { opacity: 0.95 });
        p.flat(p.curve([[50, 54], [54, 63], [50, 70], [46, 63]]), 'white', { opacity: 0.9 });
      }
      p.line('M50 36L50 78', p.tone(frame, 'outline'), 1.4, { opacity: 0.45 });
      p.fill(p.rect(28, 76, 44, 10, 3), frame, { depth: 3 });
    },
  },

  spark: {
    description: 'Glowing four-point spark to collect.',
    params: { points: 'number of points (default 4)', colors: 'spark' },
    draw(p, { points = 4, colors = {} }) {
      const c = colors.spark ?? 'gold';
      p.halo(50, 50, 48, c, 0.8);
      p.fill(p.poly(starPath(50, 50, 36, 11, points), 2.5, 0), c, { depth: 4 });
      p.flat(p.poly(starPath(50, 50, 18, 5.5, points), 1.5, 0), 'white', { opacity: 0.85 });
      p.dot(76, 26, 2.6, 'white', { opacity: 0.8 });
      p.dot(24, 72, 1.8, 'white', { opacity: 0.7 });
    },
  },

  wisp: {
    description: 'Shadow creature with glowing eyes and a ragged hem.',
    params: { mood: '"angry" (default) or "sleepy"', colors: 'body, eyes' },
    draw(p, { mood = 'angry', colors = {} }) {
      const body = colors.body ?? 'night';
      const eyes = colors.eyes ?? 'red';
      p.halo(50, 52, 50, 'plum', 0.55);
      const d = p.curve([[18, 80], [16, 44], [32, 18], [50, 12], [68, 18], [84, 44], [82, 80], [72, 90], [62, 78], [50, 90], [38, 78], [28, 90]]);
      p.fill(d, body, { depth: 6 });
      // rim light so the creature still reads on a dark background
      p.line(d, p.tone('plum', 'light'), 1.8, { opacity: 0.85 });
      for (const x of [37, 63]) {
        p.halo(x, 46, 15, eyes, 0.9);
        p.flat(p.ellipse(x, 46, 6.5, mood === 'sleepy' ? 2.2 : 5.5, { n: 8, wobble: 0 }), eyes);
        p.dot(x - 1.5, 44.5, 1.6, 'white', { opacity: 0.9 });
      }
      if (mood === 'angry') {
        p.line('M27 35L44 41M73 35L56 41', p.tone(body, 'light'), 3);
        p.line('M42 64Q50 58 58 64', p.tone(body, 'light'), 2.4);
      }
    },
  },

  heart: {
    description: 'Heart icon (lives, likes).',
    params: { colors: 'heart' },
    draw(p, { colors = {} }) {
      p.fill(p.curve([[50, 86], [20, 58], [12, 36], [26, 20], [42, 22], [50, 34], [58, 22], [74, 20], [88, 36], [80, 58]], 0.5), colors.heart ?? 'red', { depth: 6 });
      p.flat(p.ellipse(30, 34, 7, 4.5, { rot: -0.7, n: 8 }), 'white', { opacity: 0.6 });
    },
  },

  star: {
    description: 'Five-point star icon (score, rating).',
    params: { colors: 'star' },
    draw(p, { colors = {} }) {
      p.fill(p.poly(starPath(50, 53, 42, 19, 5), 5, 0.5), colors.star ?? 'gold', { depth: 6 });
      p.flat(p.ellipse(40, 40, 6, 3.5, { rot: -0.6, n: 8 }), 'white', { opacity: 0.6 });
    },
  },

  coin: {
    description: 'Coin icon with a raised rim.',
    params: { colors: 'coin' },
    draw(p, { colors = {} }) {
      const c = colors.coin ?? 'gold';
      p.groundShadow(50, 90, 26, 4);
      p.fill(p.ellipse(50, 50, 36, 36, { n: 12, wobble: 0.3 }), c, { depth: 6 });
      p.line(p.ellipse(50, 50, 27, 27, { n: 12, wobble: 0.3 }), p.tone(c, 'shadow'), 2.6);
      p.fill(p.poly(starPath(50, 51, 15, 7, 5), 2, 0), p.tone(c, 'light'), { depth: 1.5, outline: false });
      p.flat(p.ellipse(32, 30, 7, 3.5, { rot: -0.8, n: 8 }), 'white', { opacity: 0.6 });
    },
  },

  envelope: {
    description: 'Sealed letter icon.',
    params: { colors: 'paper, seal' },
    draw(p, { colors = {} }) {
      const paper = colors.paper ?? 'white';
      p.groundShadow(50, 84, 36, 4);
      p.fill(p.rect(12, 28, 76, 52, 5), paper, { depth: 5 });
      p.line('M14 31L50 58L86 31', p.tone(paper, 'outline'), 2.4, { opacity: 0.85 });
      p.line('M14 78L38 54M86 78L62 54', p.tone(paper, 'shadow'), 1.6);
      p.fill(p.ellipse(50, 58, 7.5, 7.5, { n: 8 }), colors.seal ?? 'red', { depth: 2 });
    },
  },
  ...DUNGEON_RECIPES,
  ...GEN_RECIPES,
};

export function describeRecipes() {
  return Object.fromEntries(Object.entries(RECIPES).map(([name, r]) => [name, { description: r.description, tile: !!r.tile, span: r.span ?? [1, 1], params: r.params }]));
}
