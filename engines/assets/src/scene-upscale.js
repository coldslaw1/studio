// Enlarges a rendered character grid 2, 4 or 8 times before lighting, for detail levels finer than the
// renderer itself can draw. Edges are refined rather than copied: half-block characters are split
// into their halves, diagonal edges are smoothed (the EPX / Scale2x rule) and surface heights are
// interpolated, so the lighting pass works on a smooth surface at the full size. Pure, browser-safe.

// which quarters of a cell the foreground covers: bits 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right
const QUARTERS = { '█': 15, '▀': 3, '▄': 12, '▌': 5, '▐': 10 };

function double(grid, split, tolerance) {
  const { cols, rows } = grid;
  const C = cols * 2; const R = rows * 2;
  const n = C * R;
  const chars = grid.chars ?? grid.ch.flatMap((line) => (line.length === cols ? line.split('') : [...line]));
  const { fg, bg, hit, height } = grid;
  const same = (a, b) => fg[a] === fg[b] && bg[a] === bg[b] && (hit[a] > 0) === (hit[b] > 0);
  const out = { cols: C, rows: R, chars: new Array(n), fg: new Array(n), bg: new Array(n), hit: new Array(n), height: new Array(n) };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = r * cols + c;
      const a = r > 0 ? p - cols : p; const d = r + 1 < rows ? p + cols : p;
      const l = c > 0 ? p - 1 : p; const b = c + 1 < cols ? p + 1 : p;
      const q = split ? QUARTERS[chars[p]] : undefined;
      for (let k = 0; k < 4; k++) {
        const sx = k & 1; const sy = k >> 1;
        const o = (r * 2 + sy) * C + c * 2 + sx;
        // EPX: a corner takes its two outer neighbours' cell when they agree and the others differ
        let s = p;
        if (q === undefined) {
          const v = sy ? d : a; const h = sx ? b : l; const v2 = sy ? a : d; const h2 = sx ? l : b;
          if (same(v, h) && !same(v, h2) && !same(h, v2) && !same(v, p)) s = h;
        }
        let ch = chars[s]; let f = fg[s]; let g = bg[s]; let ht = hit[s];
        if (s === p && q !== undefined && f >= 0) {
          // a half-block cell becomes solid cells of its two colours
          const col = q & (1 << k) ? f : g;
          if (col < 0) { ch = ' '; f = -1; g = -1; ht = 0; } else { ch = ' '; f = col; g = col; }
        }
        out.chars[o] = ch; out.fg[o] = f; out.bg[o] = g; out.hit[o] = ht;
        // height: blend the four nearest source cells that lie on the same surface as the chosen one
        const hs = height[s];
        if (!ht || hs === null || hs === undefined) { out.height[o] = ht ? hs ?? null : null; continue; }
        const c1 = Math.min(cols - 1, Math.max(0, c + (sx ? 1 : -1))); const r1 = Math.min(rows - 1, Math.max(0, r + (sy ? 1 : -1)));
        let sum = 0; let w = 0;
        for (let m = 0; m < 4; m++) {
          const i = (m & 2 ? r1 : r) * cols + (m & 1 ? c1 : c);
          const hv = height[i];
          if (hv === null || hv === undefined || Math.abs(hv - hs) > tolerance) continue;
          const wt = (m & 1 ? 0.25 : 0.75) * (m & 2 ? 0.25 : 0.75);
          sum += hv * wt; w += wt;
        }
        out.height[o] = w > 0 ? sum / w : hs;
      }
    }
  }
  return out;
}

/**
 * Enlarge a grid from parseCells `scale` times (1, 2, 4 or 8) each way.
 * @param {{cols:number, rows:number, ch:string[], fg:number[], bg:number[], hit:number[], height:(number|null)[]}} grid
 * @param {number} scale
 * @param {number} [tolerance]  Largest height step between neighbouring cells still treated as one surface.
 */
export function refineGrid(grid, scale, tolerance = 8) {
  if (scale === 1) return grid;
  if (![2, 4, 8].includes(scale)) throw new Error('refineGrid: scale must be 1, 2, 4 or 8');
  let g = grid;
  for (let k = 1, t = tolerance; k < scale; k *= 2, t /= 2) g = double(g, k === 1, t);
  const ch = new Array(g.rows);
  for (let r = 0; r < g.rows; r++) ch[r] = g.chars.slice(r * g.cols, (r + 1) * g.cols).join('');
  return { ...grid, cols: g.cols, rows: g.rows, ch, fg: g.fg, bg: g.bg, hit: g.hit, height: g.height };
}
