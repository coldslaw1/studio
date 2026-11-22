// Built-in item icons, drawn with canvas paths so a game needs no image files.
// Each icon fills a square of `size` pixels whose top-left corner is (x, y).
// A game with its own art (a Kiln atlas) passes an `icons` function to the
// panel instead; these are the fallback.

const TAU = Math.PI * 2;
const C = { metal: '#cfd6e2', dark: '#5b6475', wood: '#a8743c', woodDark: '#6e4a26', gold: '#f2c14e', red: '#d9534f',
  green: '#6fbf73', leaf: '#4f9d5d', blue: '#5aa7e8', glass: '#bfe3f2', cloth: '#8d6bb8', paper: '#efe2c0', straw: '#e0b84f', skin: '#2a2f3a' };

// Draw a polygon from points given in 0..1 icon space.
function poly(g, pts, fill, stroke) {
  g.ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? g.ctx.lineTo(g.x + px * g.s, g.y + py * g.s) : g.ctx.moveTo(g.x + px * g.s, g.y + py * g.s)));
  g.ctx.closePath();
  if (fill) { g.ctx.fillStyle = fill; g.ctx.fill(); }
  if (stroke) { g.ctx.strokeStyle = stroke; g.ctx.lineWidth = Math.max(1, g.s * 0.045); g.ctx.lineJoin = 'round'; g.ctx.stroke(); }
}
function oval(g, cx, cy, rx, ry, fill, stroke) {
  g.ctx.beginPath();
  g.ctx.ellipse(g.x + cx * g.s, g.y + cy * g.s, rx * g.s, ry * g.s, 0, 0, TAU);
  if (fill) { g.ctx.fillStyle = fill; g.ctx.fill(); }
  if (stroke) { g.ctx.strokeStyle = stroke; g.ctx.lineWidth = Math.max(1, g.s * 0.045); g.ctx.stroke(); }
}
function line(g, pts, color, width) {
  g.ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? g.ctx.lineTo(g.x + px * g.s, g.y + py * g.s) : g.ctx.moveTo(g.x + px * g.s, g.y + py * g.s)));
  g.ctx.strokeStyle = color;
  g.ctx.lineWidth = width * g.s;
  g.ctx.lineCap = 'round';
  g.ctx.lineJoin = 'round';
  g.ctx.stroke();
}

const ICONS = {
  sword(g, c) {
    poly(g, [[0.78, 0.1], [0.9, 0.22], [0.42, 0.7], [0.3, 0.58]], c ?? C.metal, C.skin);
    line(g, [[0.2, 0.52], [0.48, 0.8]], C.gold, 0.09);
    line(g, [[0.3, 0.7], [0.16, 0.84]], C.woodDark, 0.1);
  },
  dagger(g, c) {
    poly(g, [[0.7, 0.2], [0.8, 0.3], [0.48, 0.66], [0.36, 0.54]], c ?? C.metal, C.skin);
    line(g, [[0.28, 0.5], [0.5, 0.72]], C.dark, 0.08);
    line(g, [[0.36, 0.64], [0.24, 0.78]], C.woodDark, 0.1);
  },
  staff(g, c) {
    line(g, [[0.2, 0.88], [0.74, 0.2]], c ?? C.wood, 0.09);
    oval(g, 0.78, 0.16, 0.1, 0.1, C.blue, C.skin);
  },
  bow(g, c) {
    g.ctx.beginPath();
    g.ctx.arc(g.x + 0.34 * g.s, g.y + 0.5 * g.s, 0.42 * g.s, -1.15, 1.15);
    g.ctx.strokeStyle = c ?? C.wood; g.ctx.lineWidth = 0.08 * g.s; g.ctx.lineCap = 'round'; g.ctx.stroke();
    line(g, [[0.51, 0.12], [0.51, 0.88]], C.paper, 0.025);
  },
  arrow(g, c) {
    line(g, [[0.18, 0.82], [0.74, 0.26]], c ?? C.wood, 0.06);
    poly(g, [[0.88, 0.12], [0.84, 0.36], [0.64, 0.16]], C.metal, C.skin);
    line(g, [[0.14, 0.72], [0.28, 0.86]], C.red, 0.07);
  },
  shield(g, c) {
    poly(g, [[0.5, 0.1], [0.84, 0.2], [0.8, 0.58], [0.5, 0.9], [0.2, 0.58], [0.16, 0.2]], c ?? C.red, C.skin);
    poly(g, [[0.5, 0.2], [0.72, 0.27], [0.7, 0.54], [0.5, 0.76]], 'rgba(255,255,255,0.22)');
    oval(g, 0.5, 0.45, 0.08, 0.08, C.gold);
  },
  helm(g, c) {
    g.ctx.beginPath();
    g.ctx.arc(g.x + 0.5 * g.s, g.y + 0.5 * g.s, 0.34 * g.s, Math.PI, 0);
    g.ctx.lineTo(g.x + 0.84 * g.s, g.y + 0.82 * g.s); g.ctx.lineTo(g.x + 0.16 * g.s, g.y + 0.82 * g.s); g.ctx.closePath();
    g.ctx.fillStyle = c ?? C.metal; g.ctx.fill();
    g.ctx.strokeStyle = C.skin; g.ctx.lineWidth = Math.max(1, g.s * 0.045); g.ctx.stroke();
    poly(g, [[0.3, 0.5], [0.7, 0.5], [0.7, 0.58], [0.55, 0.58], [0.55, 0.78], [0.45, 0.78], [0.45, 0.58], [0.3, 0.58]], C.skin);
  },
  hat(g, c) {
    oval(g, 0.5, 0.66, 0.42, 0.14, c ?? C.straw, C.skin);
    poly(g, [[0.3, 0.64], [0.36, 0.32], [0.64, 0.32], [0.7, 0.64]], c ?? C.straw, C.skin);
    line(g, [[0.32, 0.58], [0.68, 0.58]], C.red, 0.06);
  },
  armor(g, c) {
    poly(g, [[0.28, 0.16], [0.42, 0.24], [0.58, 0.24], [0.72, 0.16], [0.9, 0.34], [0.76, 0.46], [0.72, 0.86], [0.28, 0.86], [0.24, 0.46], [0.1, 0.34]], c ?? C.metal, C.skin);
    line(g, [[0.5, 0.3], [0.5, 0.8]], C.dark, 0.03);
  },
  cloak(g, c) {
    poly(g, [[0.36, 0.14], [0.64, 0.14], [0.86, 0.86], [0.62, 0.78], [0.5, 0.9], [0.38, 0.78], [0.14, 0.86]], c ?? C.cloth, C.skin);
    oval(g, 0.5, 0.2, 0.06, 0.06, C.gold);
  },
  ring(g, c) {
    oval(g, 0.5, 0.58, 0.24, 0.24, null, c ?? C.gold);
    oval(g, 0.5, 0.58, 0.19, 0.19, null, c ?? C.gold);
    poly(g, [[0.5, 0.14], [0.62, 0.26], [0.5, 0.38], [0.38, 0.26]], C.blue, C.skin);
  },
  potion(g, c) {
    poly(g, [[0.42, 0.14], [0.58, 0.14], [0.58, 0.36], [0.78, 0.66], [0.7, 0.88], [0.3, 0.88], [0.22, 0.66], [0.42, 0.36]], C.glass, C.skin);
    poly(g, [[0.31, 0.58], [0.69, 0.58], [0.76, 0.68], [0.69, 0.85], [0.31, 0.85], [0.24, 0.68]], c ?? C.red);
    line(g, [[0.4, 0.12], [0.6, 0.12]], C.woodDark, 0.07);
  },
  food(g, c) {
    oval(g, 0.5, 0.58, 0.3, 0.3, c ?? C.red, C.skin);
    line(g, [[0.5, 0.3], [0.56, 0.14]], C.woodDark, 0.05);
    oval(g, 0.66, 0.2, 0.11, 0.06, C.leaf);
  },
  leaf(g, c) {
    g.ctx.beginPath();
    g.ctx.moveTo(g.x + 0.2 * g.s, g.y + 0.82 * g.s);
    g.ctx.quadraticCurveTo(g.x + 0.16 * g.s, g.y + 0.24 * g.s, g.x + 0.82 * g.s, g.y + 0.16 * g.s);
    g.ctx.quadraticCurveTo(g.x + 0.8 * g.s, g.y + 0.8 * g.s, g.x + 0.2 * g.s, g.y + 0.82 * g.s);
    g.ctx.fillStyle = c ?? C.leaf; g.ctx.fill();
    g.ctx.strokeStyle = C.skin; g.ctx.lineWidth = Math.max(1, g.s * 0.045); g.ctx.stroke();
    line(g, [[0.22, 0.8], [0.7, 0.28]], 'rgba(255,255,255,0.35)', 0.03);
  },
  coin(g, c) {
    oval(g, 0.5, 0.5, 0.32, 0.32, c ?? C.gold, C.skin);
    oval(g, 0.5, 0.5, 0.2, 0.2, null, 'rgba(0,0,0,0.3)');
  },
  gem(g, c) {
    poly(g, [[0.3, 0.2], [0.7, 0.2], [0.88, 0.42], [0.5, 0.86], [0.12, 0.42]], c ?? C.blue, C.skin);
    poly(g, [[0.3, 0.2], [0.7, 0.2], [0.6, 0.42], [0.4, 0.42]], 'rgba(255,255,255,0.4)');
  },
  ingot(g, c) {
    poly(g, [[0.2, 0.62], [0.32, 0.36], [0.8, 0.36], [0.9, 0.62], [0.9, 0.72], [0.2, 0.72]], c ?? C.metal, C.skin);
    poly(g, [[0.32, 0.36], [0.8, 0.36], [0.72, 0.5], [0.26, 0.5]], 'rgba(255,255,255,0.3)');
  },
  plank(g, c) {
    poly(g, [[0.12, 0.62], [0.74, 0.2], [0.88, 0.38], [0.26, 0.8]], c ?? C.wood, C.skin);
    line(g, [[0.3, 0.6], [0.7, 0.34]], C.woodDark, 0.025);
  },
  key(g, c) {
    oval(g, 0.32, 0.34, 0.16, 0.16, null, c ?? C.gold);
    line(g, [[0.44, 0.46], [0.82, 0.84]], c ?? C.gold, 0.08);
    line(g, [[0.66, 0.68], [0.76, 0.58]], c ?? C.gold, 0.07);
  },
  scroll(g, c) {
    poly(g, [[0.24, 0.2], [0.76, 0.2], [0.76, 0.8], [0.24, 0.8]], c ?? C.paper, C.skin);
    line(g, [[0.34, 0.38], [0.66, 0.38]], C.woodDark, 0.03);
    line(g, [[0.34, 0.5], [0.66, 0.5]], C.woodDark, 0.03);
    line(g, [[0.34, 0.62], [0.56, 0.62]], C.woodDark, 0.03);
  },
  tool(g, c) {
    line(g, [[0.24, 0.84], [0.62, 0.4]], C.wood, 0.09);
    poly(g, [[0.44, 0.22], [0.62, 0.12], [0.88, 0.4], [0.72, 0.52]], c ?? C.metal, C.skin);
  },
  bag(g, c) {
    poly(g, [[0.38, 0.26], [0.62, 0.26], [0.84, 0.62], [0.72, 0.86], [0.28, 0.86], [0.16, 0.62]], c ?? C.wood, C.skin);
    line(g, [[0.36, 0.28], [0.64, 0.28]], C.paper, 0.06);
    poly(g, [[0.4, 0.14], [0.6, 0.14], [0.62, 0.24], [0.38, 0.24]], c ?? C.wood, C.skin);
  },
  item(g, c) {
    poly(g, [[0.5, 0.14], [0.86, 0.5], [0.5, 0.86], [0.14, 0.5]], c ?? C.metal, C.skin);
  },
};

/** Names of the built-in icons. */
export const ITEM_ICONS = Object.keys(ICONS);

const WORDS = [
  ['dagger', /dagger|knife/], ['sword', /sword|blade|sabre|axe|mace/], ['staff', /staff|wand|rod|spear/], ['bow', /\bbow\b/],
  ['arrow', /arrow|bolt|ammo/], ['shield', /shield|buckler/], ['helm', /helm|helmet/], ['hat', /hat|hood|cap\b|crown/],
  ['armor', /armor|armour|mail|tunic|robe|shirt/], ['cloak', /cloak|cape/], ['ring', /ring|amulet|necklace/],
  ['potion', /potion|flask|tea|elixir|drink|bottle|water|milk/], ['leaf', /leaf|herb|flower|plant|seed/],
  ['food', /apple|food|bread|meat|berry|fruit|cheese|fish|egg/], ['coin', /coin|gold|pouch|money/], ['gem', /gem|jewel|crystal|ruby|diamond|stone/],
  ['ingot', /ingot|iron|ore|metal|bar\b/], ['plank', /plank|wood|log|stick/], ['key', /key/], ['scroll', /scroll|map|book|letter|note/],
  ['tool', /hammer|pick|tool|shovel/], ['bag', /bag|sack|pack/],
];
const BY_PUPPET = { sword: 'sword', rustyBlade: 'sword', shield: 'shield', helm: 'helm', strawHat: 'hat', staff: 'staff' };
const BY_SLOT = { mainHand: 'sword', offHand: 'shield', head: 'helm', body: 'armor', back: 'cloak' };

/**
 * iconKind(def) -> name of the built-in icon for an item definition.
 * Order: def.icon when it names a built-in icon, the item's puppet look, words
 * in its id, name and tags, its equipment slot, "potion" for usable things, else "item".
 */
export function iconKind(def) {
  if (typeof def.icon === 'string' && ICONS[def.icon]) return def.icon;
  if (typeof def.puppet === 'string' && BY_PUPPET[def.puppet]) return BY_PUPPET[def.puppet];
  const text = `${def.id} ${def.name} ${(def.tags || []).join(' ')}`.toLowerCase();
  for (const [kind, re] of WORDS) if (re.test(text)) return kind;
  if (def.equip) for (const slot of def.equip) if (BY_SLOT[slot]) return BY_SLOT[slot];
  return def.use !== undefined ? 'potion' : 'item';
}

/** slotIconKind(slot) -> the built-in icon that hints what an empty equipment slot is for. */
export function slotIconKind(slot) {
  return BY_SLOT[slot] ?? (/ring/i.test(slot) ? 'ring' : 'item');
}

/**
 * drawItemIcon(ctx, kind, x, y, size, color) draws a built-in icon in the
 * square at (x, y). `color` replaces the icon's main colour. Unknown kinds
 * draw the plain "item" icon. Leaves the context state as it found it.
 */
export function drawItemIcon(ctx, kind, x, y, size, color) {
  ctx.save();
  (ICONS[kind] ?? ICONS.item)({ ctx, x, y, s: size }, color || undefined);
  ctx.restore();
}
