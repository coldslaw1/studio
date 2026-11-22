// Where everything of the drawn inventory panel goes. Pure geometry: no
// drawing, no input, so it is tested under Node. All numbers are logical pixels.
//
// A "target" is anything the cursor can be on. Its id says what it is:
//   'bag:3'  'other:0' (chest slot or shop line)  'equip:head'  'hot:2'  'btn:sort'

const rect = (x, y, w, h) => ({ x, y, w, h });

/** contains(rect, x, y) -> true when the point is inside. */
export function contains(r, x, y) {
  return !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}


/**
 * layoutPanel(spec) -> layout
 *   spec: {
 *     width, height, unit        the screen and the ui unit
 *     bag: { size, columns }     the player's bag
 *     equipSlots: [names]        equipment slots ([] hides the doll)
 *     other: { size, columns } | null   a chest or shop shown beside the bag (replaces the doll)
 *     hotbar: number             quick slots (0 = none)
 *     buttons: [{ id, label }]   footer buttons, left to right
 *     scroll: { bag, other }     first visible row of each grid
 *     cellSize                   wanted cell size in units; shrinks to fit. Default: 2.6, growing up to 3.9 on roomy screens
 *   }
 * layout: { panel, header, title, purse, cell, gap, doll, hint, targets: [{ id, rect, zone, index | slot }],
 *           grids: { bag, other }: { rect, cols, rows, visibleRows, maxScroll, scroll }, labels: [{ text, x, y }] }
 */
export function layoutPanel(spec) {
  const { width, height, unit } = spec;
  if (!(width > 0) || !(height > 0) || !(unit > 0)) throw new Error(`layoutPanel: width, height and unit must be positive, got ${width}, ${height}, ${unit}`);
  const slots = spec.other ? [] : (spec.equipSlots || []);
  const hot = spec.hotbar || 0;
  const pad = 0.8 * unit;
  const headH = 2.2 * unit;
  const footH = 2.3 * unit;
  const labelH = 1.3 * unit;
  const scroll = spec.scroll || {};
  const stacked = height > width * 1.1;

  // Size everything for a wanted cell, then shrink the cell until the panel fits the screen.
  function build(cell) {
    const gap = Math.max(2, Math.round(cell * 0.1));
    const availH = height - 2 * pad - headH - footH - 2 * pad - (hot ? cell + labelH + gap : 0);
    const availW = width - 4 * pad;
    const grid = (g, maxW, maxH) => {
      if (!g) return null;
      let cols = Math.min(g.columns ?? 5, g.size);
      while (cols > 1 && cols * cell + (cols - 1) * gap > maxW) cols -= 1;
      const rows = Math.ceil(g.size / cols);
      const fit = Math.max(1, Math.floor((maxH + gap) / (cell + gap)));
      const visibleRows = Math.min(rows, fit);
      const w = cols * cell + (cols - 1) * gap;
      // `outer` also holds the two scroll buttons beside a grid that scrolls.
      return { cols, rows, visibleRows, maxScroll: rows - visibleRows, size: g.size, w, outer: w + (rows > visibleRows ? gap + cell * 0.6 : 0), h: visibleRows * cell + (visibleRows - 1) * gap };
    };
    const dollRows = Math.ceil(slots.length / 2);
    const side = slots.length
      ? { w: 4 * cell + 3 * gap, h: Math.max(3, dollRows) * cell + (Math.max(3, dollRows) - 1) * gap }
      : null;
    const sideW = spec.other ? null : (side ? side.w : 0);
    const colGap = 1.4 * pad;
    let other = null;
    let bag;
    if (stacked) {
      const topH = spec.other ? (availH - labelH * 2 - colGap) / 2 : (side ? side.h : 0);
      other = grid(spec.other, availW - cell, topH);
      const used = (other ? other.h + labelH : (side ? side.h : 0)) + (other || side ? colGap : 0);
      bag = grid(spec.bag, availW - cell, availH - used - labelH);
    } else {
      other = grid(spec.other, (availW - colGap) / 2 - cell, availH - labelH);
      const left = other ? other.outer : sideW;
      bag = grid(spec.bag, availW - left - (left ? colGap : 0) - cell, availH - labelH);
    }
    const leftW = other ? other.outer : (side ? side.w : 0);
    const leftH = other ? other.h + labelH : (side ? side.h + labelH : 0);
    const hotW = hot ? hot * cell + (hot - 1) * gap : 0;
    const bodyW = stacked ? Math.max(leftW, bag.outer, hotW) : Math.max(leftW + (leftW ? colGap : 0) + bag.outer, hotW);
    const bodyH = (stacked ? leftH + (leftH ? colGap : 0) + bag.h + labelH : Math.max(leftH, bag.h + labelH)) + (hot ? cell + labelH + gap : 0);
    const w = Math.max(bodyW, 16 * unit) + 2 * pad;
    const h = headH + bodyH + footH + pad;
    return { cell, gap, bag, other, side, colGap, leftW, leftH, hotW, bodyW, bodyH, w, h };
  }
  let cell = (spec.cellSize ?? 2.6) * unit;
  let b = build(cell);
  // On a big screen with a small ui unit (a desktop game) the cells grow so the panel is not lost in the middle.
  if (spec.cellSize === undefined) {
    for (let i = 0; i < 10 && cell < 3.9 * unit && b.h < 0.56 * height && b.w < 0.7 * width; i++) {
      cell *= 1.07;
      b = build(cell);
    }
  }
  // Smaller cells are better than a bag that scrolls, down to a size a finger can still hit.
  const scrolls = (x) => (x.bag.maxScroll > 0 || (x.other && x.other.maxScroll > 0));
  for (let i = 0; i < 14 && cell > 1.5 * unit && (b.w > width - 2 * pad || b.h > height - 2 * pad || (scrolls(b) && cell > 1.9 * unit)); i++) {
    cell *= 0.92;
    b = build(cell);
  }
  const { gap } = b;
  const panel = rect(Math.round((width - b.w) / 2), Math.round((height - b.h) / 2), Math.round(b.w), Math.round(b.h));
  const targets = [];
  const labels = [];
  const grids = {};
  const inner = { x: panel.x + pad, y: panel.y + headH, w: panel.w - 2 * pad };

  function placeGrid(zone, g, x, y, label) {
    const first = Math.max(0, Math.min(g.maxScroll, scroll[zone] || 0));
    labels.push({ text: label, x, y: y + labelH / 2 });
    const top = y + labelH;
    grids[zone] = { rect: rect(x, top, g.w, g.h), cols: g.cols, rows: g.rows, visibleRows: g.visibleRows, maxScroll: g.maxScroll, scroll: first };
    for (let row = 0; row < g.visibleRows; row++) {
      for (let col = 0; col < g.cols; col++) {
        const index = (first + row) * g.cols + col;
        if (index >= g.size) break;
        targets.push({ id: `${zone}:${index}`, zone, index, rect: rect(x + col * (cell + gap), top + row * (cell + gap), cell, cell) });
      }
    }
    if (g.maxScroll > 0) {
      const bx = x + g.w + gap;
      const half = Math.min(cell, g.h / 2 - gap / 2);
      targets.push({ id: `btn:${zone}-up`, zone: 'btn', scrolls: zone, dir: -1, rect: rect(bx, top, cell * 0.6, half) });
      targets.push({ id: `btn:${zone}-down`, zone: 'btn', scrolls: zone, dir: 1, rect: rect(bx, top + g.h - half, cell * 0.6, half) });
    }
  }

  let doll = null;
  const bagLabel = spec.bag.label ?? 'Bag';
  const bodyX = inner.x + (inner.w - b.bodyW) / 2;
  let bagX = bodyX;
  let bagY = inner.y;
  if (b.other) {
    placeGrid('other', b.other, stacked ? bodyX + (b.bodyW - b.other.outer) / 2 : bodyX, inner.y, spec.other.label ?? 'Chest');
  } else if (b.side) {
    const x = stacked ? bodyX + (b.bodyW - b.side.w) / 2 : bodyX;
    const top = inner.y + labelH;
    labels.push({ text: spec.equipLabel ?? 'Equipped', x, y: inner.y + labelH / 2 });
    doll = rect(x + cell + gap, top, 2 * cell + gap, b.side.h);
    // Familiar places for the usual slots (head on top, hands in the middle); other slots fill what is free.
    const PLACE = { head: 0, body: 1, mainHand: 2, offHand: 3, back: 4 };
    const taken = new Set(slots.filter((s) => s in PLACE).map((s) => PLACE[s]));
    let free = 0;
    slots.forEach((slot) => {
      let spot = PLACE[slot];
      if (spot === undefined) { while (taken.has(free)) free += 1; spot = free; taken.add(spot); }
      const col = spot % 2;
      const row = Math.floor(spot / 2);
      targets.push({ id: `equip:${slot}`, zone: 'equip', slot, rect: rect(col === 0 ? x : x + 3 * (cell + gap), top + row * (cell + gap), cell, cell) });
    });
  }
  if (stacked) {
    bagY = inner.y + b.leftH + (b.leftH ? b.colGap : 0);
    bagX = bodyX + (b.bodyW - b.bag.outer) / 2;
  } else bagX = bodyX + b.leftW + (b.leftW ? b.colGap : 0);
  placeGrid('bag', b.bag, bagX, bagY, bagLabel);

  if (hot) {
    const y = panel.y + headH + b.bodyH - cell;
    const x = inner.x + (inner.w - b.hotW) / 2;
    labels.push({ text: spec.hotbarLabel ?? 'Quick slots', x, y: y - labelH / 2 });
    for (let i = 0; i < hot; i++) targets.push({ id: `hot:${i}`, zone: 'hot', index: i, rect: rect(x + i * (cell + gap), y, cell, cell) });
  }

  const buttons = spec.buttons || [];
  const bw = Math.min(5.2 * unit, (inner.w - (buttons.length - 1) * gap) / Math.max(1, buttons.length));
  const by = panel.y + panel.h - footH - pad * 0.2;
  buttons.forEach((btn, i) => {
    const x = inner.x + inner.w - (buttons.length - i) * bw - (buttons.length - 1 - i) * gap;
    targets.push({ id: `btn:${btn.id}`, zone: 'btn', button: btn.id, label: btn.label, rect: rect(x, by + 0.2 * unit, bw, footH - 0.6 * unit) });
  });

  return {
    panel, cell, gap, unit, pad, doll, targets, grids, labels, stacked,
    header: rect(panel.x, panel.y, panel.w, headH),
    hint: { x: inner.x, y: by + footH / 2 - 0.1 * unit, w: Math.max(0, inner.w - buttons.length * (bw + gap)) },
  };
}

/**
 * placeTip(layout, targetId, width, height, view, filled) -> { x, y, w, h }
 * Where a tooltip of that size goes for a target. It never covers its own
 * cell, and it is put where it hides the fewest items: beside, below or above
 * the cell, under or over that cell's grid, or outside the panel. Hiding an
 * empty cell costs little, hiding a cell with an item costs a lot.
 *   view: { width, height }.  filled(id) -> true when that cell holds an item.
 */
export function placeTip(layout, targetId, width, height, view, filled = () => true) {
  const target = layout.targets.find((t) => t.id === targetId);
  if (!target) throw new Error(`placeTip: no target "${String(targetId)}"`);
  const c = target.rect;
  const off = 0.4 * layout.unit;
  const edge = 0.6 * layout.unit;
  const p = layout.panel;
  const g = (layout.grids[target.zone] || {}).rect || c;
  const spots = [
    [c.x + c.w + off, c.y], [c.x, c.y + c.h + off], [c.x, c.y - off - height], [c.x - off - width, c.y],
    [c.x, g.y + g.h + off], [c.x, g.y - off - height],
    // under or over the cell but kept inside its own grid's columns, so the grid next door stays clear
    [g.x + g.w - width, c.y + c.h + off], [g.x, c.y + c.h + off], [g.x + g.w - width, c.y - off - height], [g.x, c.y - off - height],
    [p.x + p.w + off, c.y], [p.x - off - width, c.y], [c.x, p.y + p.h + off], [c.x, p.y - off - height],
  ];
  const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const cellArea = c.w * c.h;
  let best = null;
  let bestKey = null;
  spots.forEach(([sx, sy], i) => {
    const r = {
      x: Math.round(Math.max(edge, Math.min(view.width - width - edge, sx))),
      y: Math.round(Math.max(edge, Math.min(view.height - height - edge, sy))), w: width, h: height,
    };
    let cost = i * 0.02;
    let items = 0; // how many cells with an item it hides (any part of them)
    for (const t of layout.targets) {
      if (t === target) continue;
      const a = area(r, t.rect);
      const full = t.zone !== 'btn' && filled(t.id);
      if (a > 0 && full) items += 1;
      cost += a / cellArea * (t.zone === 'btn' ? 0.1 : (full ? 1 : 0.15));
    }
    // the header holds the title, the purse and the carried weight: keep off it when another spot is as good
    if (layout.header) cost += Math.min(1, area(r, layout.header) / cellArea) * 0.6;
    // first never its own cell, then the fewest hidden items, then the cheapest spot
    const key = [area(r, c) > 0 ? 1 : 0, items, cost];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) { bestKey = key; best = r; }
  });
  return best;
}

/** targetAt(layout, x, y) -> the target under a point, or null. */
export function targetAt(layout, x, y) {
  return layout.targets.find((t) => contains(t.rect, x, y)) ?? null;
}

/**
 * nextTarget(layout, fromId, dir) -> id of the nearest target in a direction
 * ('up' 'down' 'left' 'right'), or fromId when there is none that way.
 */
export function nextTarget(layout, fromId, dir) {
  const from = layout.targets.find((t) => t.id === fromId);
  if (!from) return layout.targets[0] ? layout.targets[0].id : null;
  const c = (t) => ({ x: t.rect.x + t.rect.w / 2, y: t.rect.y + t.rect.h / 2 });
  const a = c(from);
  const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  let best = null;
  let bestScore = Infinity;
  for (const t of layout.targets) {
    if (t === from) continue;
    const p = c(t);
    const along = (p.x - a.x) * dx + (p.y - a.y) * dy;
    const across = Math.abs((p.x - a.x) * dy) + Math.abs((p.y - a.y) * dx);
    if (along <= 1) continue;
    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best ? best.id : fromId;
}
