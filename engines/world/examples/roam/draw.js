// Painters for the demo: each turns ONE chunk into a picture on an offscreen canvas. The world
// engine caches the result per chunk (createChunkCache), so a frame is a handful of drawImage calls.
import { GROUND, OBJECT } from '../../src/index.js';

const G = GROUND; const O = OBJECT;
const BASE = { [G.deep]: [27, 58, 99], [G.water]: [42, 93, 143], [G.sand]: [217, 197, 138], [G.grass]: [106, 168, 79], [G.moss]: [63, 127, 63], [G.dust]: [185, 154, 91], [G.snow]: [226, 234, 240], [G.rock]: [125, 127, 136], [G.marsh]: [85, 112, 90], [G.floor]: [138, 117, 96], [G.path]: [165, 141, 106] };
const colors = new Map();
/** Ground colour, a little lighter on high ground. */
function groundColor(id, height) {
  const level = height >> 4;
  const key = id * 16 + level;
  let c = colors.get(key);
  if (!c) { const b = BASE[id] ?? [255, 0, 255]; const f = 0.78 + level * 0.03; colors.set(key, (c = `rgb(${Math.min(255, b[0] * f) | 0},${Math.min(255, b[1] * f) | 0},${Math.min(255, b[2] * f) | 0})`)); }
  return c;
}

/** Draw one object standing with its foot at (x, y). s = size of a tile on screen. */
function drawObject(g, id, x, y, s) {
  switch (id) {
    case O.tree: g.fillStyle = '#5b3d24'; g.fillRect(x - s * 0.08, y - s * 0.5, s * 0.16, s * 0.5); g.fillStyle = '#2f6b2f'; g.beginPath(); g.arc(x, y - s * 0.75, s * 0.42, 0, 7); g.fill(); g.fillStyle = '#438a3d'; g.beginPath(); g.arc(x - s * 0.1, y - s * 0.85, s * 0.22, 0, 7); g.fill(); break;
    case O.pine: g.fillStyle = '#4a3423'; g.fillRect(x - s * 0.06, y - s * 0.3, s * 0.12, s * 0.3); g.fillStyle = '#285846'; g.beginPath(); g.moveTo(x, y - s * 1.3); g.lineTo(x + s * 0.36, y - s * 0.25); g.lineTo(x - s * 0.36, y - s * 0.25); g.fill(); break;
    case O.boulder: g.fillStyle = '#6c6f78'; g.beginPath(); g.ellipse(x, y - s * 0.2, s * 0.36, s * 0.24, 0, 0, 7); g.fill(); g.fillStyle = '#8f939d'; g.beginPath(); g.ellipse(x - s * 0.08, y - s * 0.27, s * 0.18, s * 0.1, 0, 0, 7); g.fill(); break;
    case O.bush: g.fillStyle = '#3d7a3a'; g.beginPath(); g.arc(x, y - s * 0.2, s * 0.26, 0, 7); g.fill(); break;
    case O.reed: g.strokeStyle = '#b8c070'; g.lineWidth = Math.max(1, s * 0.06); g.beginPath(); for (const d of [-0.18, 0, 0.18]) { g.moveTo(x + s * d, y); g.lineTo(x + s * d * 1.6, y - s * 0.6); } g.stroke(); break;
    case O.thornbush: g.strokeStyle = '#7a5a34'; g.lineWidth = Math.max(1, s * 0.07); g.beginPath(); for (let a = 0; a < 5; a++) { g.moveTo(x, y - s * 0.2); g.lineTo(x + Math.cos(a * 1.257) * s * 0.3, y - s * 0.2 + Math.sin(a * 1.257) * s * 0.22); } g.stroke(); break;
    case O.wall: g.fillStyle = '#4b4038'; g.fillRect(x - s * 0.5, y - s * 0.9, s, s * 0.9); g.fillStyle = '#6a5c50'; g.fillRect(x - s * 0.5, y - s * 0.9, s, s * 0.22); break;
    case O.chest: g.fillStyle = '#8a5a22'; g.fillRect(x - s * 0.28, y - s * 0.4, s * 0.56, s * 0.4); g.fillStyle = '#e0b040'; g.fillRect(x - s * 0.05, y - s * 0.3, s * 0.1, s * 0.14); break;
    case O.pillar: g.fillStyle = '#c9c4b8'; g.fillRect(x - s * 0.18, y - s * 1.1, s * 0.36, s * 1.1); g.fillStyle = '#e9e5da'; g.fillRect(x - s * 0.26, y - s * 1.2, s * 0.52, s * 0.14); break;
    case O.fire: g.fillStyle = '#e8641e'; g.beginPath(); g.moveTo(x, y - s * 0.8); g.lineTo(x + s * 0.26, y - s * 0.05); g.lineTo(x - s * 0.26, y - s * 0.05); g.fill(); g.fillStyle = '#ffd24a'; g.beginPath(); g.moveTo(x, y - s * 0.5); g.lineTo(x + s * 0.12, y - s * 0.05); g.lineTo(x - s * 0.12, y - s * 0.05); g.fill(); break;
    default: break;
  }
}

/** Top-down: canvas is (size * tile) square; objects may poke one tile above their own. */
export function paintOrtho(chunk, g, tile) {
  const n = chunk.size; const { ground, object, height } = chunk.layers;
  for (let i = 0; i < n * n; i++) { g.fillStyle = groundColor(ground[i], height[i]); g.fillRect((i % n) * tile, Math.floor(i / n) * tile, tile, tile); }
  for (let i = 0; i < n * n; i++) if (object[i]) drawObject(g, object[i], (i % n) * tile + tile / 2, Math.floor(i / n) * tile + tile * 0.95, tile);
}

/** Head room above an isometric chunk picture for tall objects. */
export const ISO_HEAD = 40;
/** Isometric: canvas is (size * tileW) wide and (size * tileH + ISO_HEAD) tall; tile (0, 0)'s top corner is at (width / 2, ISO_HEAD). */
export function paintIso(chunk, g, tileW, tileH) {
  const n = chunk.size; const { ground, object, height } = chunk.layers;
  const hw = tileW / 2; const hh = tileH / 2; const ox = n * hw;
  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = ly * n + lx; const x = ox + (lx - ly) * hw; const y = ISO_HEAD + (lx + ly) * hh;
      g.fillStyle = groundColor(ground[i], height[i]);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + hw + 0.5, y + hh); g.lineTo(x, y + tileH + 0.5); g.lineTo(x - hw - 0.5, y + hh); g.fill();
      if (object[i]) drawObject(g, object[i], x, y + tileH * 0.8, tileW * 0.6);
    }
  }
}

/** Characters and colours for the character-grid view (the shape Kiln's drawGrid reads). */
export const LEGEND = {
  ground: {
    [G.deep]: { ch: '~', fg: '#2f5f96', bg: '#14294a' }, [G.water]: { ch: '~', fg: '#5a9bd6', bg: '#1f4a78' }, [G.sand]: { ch: ':', fg: '#f0e0a8', bg: '#b8a468' },
    [G.grass]: { ch: ',', fg: '#8fd070', bg: '#3f7a34' }, [G.moss]: { ch: '"', fg: '#5fa85a', bg: '#28542a' }, [G.dust]: { ch: '.', fg: '#d8ba78', bg: '#8f743f' },
    [G.snow]: { ch: '*', fg: '#ffffff', bg: '#b9c6cf' }, [G.rock]: { ch: '^', fg: '#b4b7c2', bg: '#55575f' }, [G.marsh]: { ch: ';', fg: '#86a88c', bg: '#34493a' },
    [G.floor]: { ch: '.', fg: '#b8a48c', bg: '#5c4d3f' }, [G.path]: { ch: '=', fg: '#cdb48c', bg: '#7d6848' },
  },
  object: {
    [O.tree]: { ch: 'T', fg: '#1f4f1f' }, [O.pine]: { ch: 'A', fg: '#173f30' }, [O.boulder]: { ch: 'o', fg: '#3e4048' }, [O.bush]: { ch: '%', fg: '#2a5a28' }, [O.reed]: { ch: '|', fg: '#d6dc8a' },
    [O.thornbush]: { ch: 'x', fg: '#5a4020' }, [O.wall]: { ch: '#', fg: '#2c2420' }, [O.chest]: { ch: '$', fg: '#ffd24a' }, [O.pillar]: { ch: 'I', fg: '#f4f0e6' }, [O.fire]: { ch: '&', fg: '#ff8a2a' },
  },
};

/** Fallback when Kiln is not next door: draw a character grid with the browser's own font. */
export function drawGridPlain(g, grid, palette, cell) {
  g.font = `${cell}px Consolas, "Cascadia Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const i = y * grid.cols + x;
      if (grid.bg[i] >= 0) { g.fillStyle = palette[grid.bg[i]]; g.fillRect(x * cell, y * cell, cell, cell); }
      if (grid.fg[i] >= 0) { g.fillStyle = palette[grid.fg[i]]; g.fillText(grid.ch[y][x], x * cell + cell / 2, y * cell + cell / 2 + 1); }
    }
  }
}
