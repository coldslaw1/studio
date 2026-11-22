// Turns a spec (style + list of sprites) into a sprite sheet, an atlas and a preview page.
import { RECIPES } from './recipes.js';
import { resolveStyle } from './styles.js';
import { createPen } from './pen.js';
import { makeRng, hashSeed } from './rng.js';
import { luminance } from './color.js';
import { resolvePalette } from './palettes.js';
import { xtermPalette } from './ascii.js';

const NAME = /^[a-z][a-z0-9_]*$/;

export function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return ['Spec must be a JSON object.'];
  if (!Array.isArray(spec.sprites) || spec.sprites.length === 0) errors.push('"sprites" must be a non-empty list.');
  const seen = new Set();
  for (const [i, s] of (spec.sprites ?? []).entries()) {
    const where = `sprites[${i}]`;
    if (!s || typeof s.name !== 'string' || !NAME.test(s.name)) { errors.push(`${where}: "name" must be lower_snake_case.`); continue; }
    if (seen.has(s.name)) errors.push(`${where}: duplicate name "${s.name}".`);
    seen.add(s.name);
    if (!RECIPES[s.recipe]) errors.push(`${where} (${s.name}): unknown recipe "${s.recipe}". Known: ${Object.keys(RECIPES).join(', ')}.`);
  }
  const cell = spec.cell ?? 128;
  if (!Number.isInteger(cell) || cell < 16 || cell > 512) errors.push('"cell" must be a whole number from 16 to 512.');
  try { resolveStyle(spec.style, spec.palette); } catch (e) { errors.push(e.message); }
  if (spec.ascii !== undefined) {
    const a = spec.ascii;
    if (spec.pixel !== undefined) errors.push('Use either "pixel" or "ascii", not both.');
    if (!a || typeof a !== 'object') errors.push('"ascii" must be an object like { "cols": 24 }.');
    else {
      if (!Number.isInteger(a.cols) || a.cols < 4 || a.cols > 128) errors.push('"ascii.cols" (characters across one cell) must be a whole number from 4 to 128.');
      else if (cell % (a.cols * 8) !== 0) errors.push(`"cell" (${cell}) must be a multiple of ascii.cols x 8 (${a.cols * 8}) because each character is drawn 8 pixels wide.`);
      if (a.palette !== undefined && a.palette !== 'xterm') { try { resolvePalette(a.palette); } catch (e) { errors.push(e.message.replace('resolvePalette: ', '"ascii.palette": ')); } }
      if (a.text !== undefined && !(a.text >= 0 && a.text <= 1)) errors.push('"ascii.text" must be a number from 0 to 1.');
    }
  }
  if (spec.pixel !== undefined) {
    const px = spec.pixel;
    if (!px || typeof px !== 'object') errors.push('"pixel" must be an object like { "size": 48 }.');
    else {
      if (!Number.isInteger(px.size) || px.size < 8 || px.size > cell) errors.push(`"pixel.size" must be a whole number from 8 to the cell size (${cell}).`);
      else if (cell % px.size !== 0) errors.push(`"cell" (${cell}) must be a multiple of "pixel.size" (${px.size}) so pixels stay square.`);
      if (px.palette !== undefined) { try { resolvePalette(px.palette); } catch (e) { errors.push(e.message.replace('resolvePalette: ', '"pixel.palette": ')); } }
      if (px.grain !== undefined && !(px.grain >= 0 && px.grain <= 1)) errors.push('"pixel.grain" must be a number from 0 to 1.');
      if (px.levels !== undefined && (!Number.isInteger(px.levels) || px.levels < 2 || px.levels > 32)) errors.push('"pixel.levels" must be a whole number from 2 to 32.');
    }
  }
  return errors;
}

/** Inner SVG of one sprite on its 100x100 canvas. */
export function drawSprite(sprite, style, seed = 1) {
  const recipe = RECIPES[sprite.recipe];
  const rng = makeRng(hashSeed(seed, sprite.name, sprite.seed ?? ''));
  const pen = createPen(style, rng, sprite.name);
  recipe.draw(pen, sprite.params ?? {});
  return pen.svg();
}

export function build(spec) {
  const errors = validateSpec(spec);
  if (errors.length) throw new Error('Invalid spec:\n- ' + errors.join('\n- '));
  const style = resolveStyle(spec.style, spec.palette);
  const cell = spec.cell ?? 128;
  const seed = spec.seed ?? 1;
  const spans = spec.sprites.map((sp) => RECIPES[sp.recipe].span ?? [1, 1]);
  const totalCells = spans.reduce((n, [w, h]) => n + w * h, 0);
  const cols = Math.max(spec.columns ?? Math.ceil(Math.sqrt(totalCells)), ...spans.map(([w]) => w));
  const taken = []; // rows of booleans
  const free = (c, r, w, h) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (x >= cols || taken[y]?.[x]) return false;
    return true;
  };
  const frames = {};
  const cells = [];
  spec.sprites.forEach((sprite, i) => {
    const [w, h] = spans[i];
    let c = 0;
    let r = 0;
    while (!free(c, r, w, h)) { c++; if (c + w > cols) { c = 0; r++; } }
    for (let y = r; y < r + h; y++) { taken[y] ??= []; for (let x = c; x < c + w; x++) taken[y][x] = true; }
    frames[sprite.name] = { x: c * cell, y: r * cell, w: w * cell, h: h * cell, recipe: sprite.recipe, tile: !!RECIPES[sprite.recipe].tile };
    cells.push(`<svg x="${c * cell}" y="${r * cell}" width="${w * cell}" height="${h * cell}" viewBox="0 0 ${(RECIPES[sprite.recipe].view ?? [w * 100, h * 100]).join(' ')}">${drawSprite(sprite, style, seed)}</svg>`);
  });
  const rows = taken.length;
  const width = cols * cell;
  const height = rows * cell;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${cells.join('')}</svg>\n`;
  const atlas = {
    kiln: 1, style: style.name, seed, cell, width, height,
    image: 'atlas.png', vector: 'atlas.svg', background: spec.background ?? null,
    pixel: spec.pixel ? { size: spec.pixel.size, levels: spec.pixel.levels ?? 6, dither: spec.pixel.dither ?? 0.6, rim: spec.pixel.rim ?? null, grain: spec.pixel.grain ?? 0, palette: spec.pixel.palette ? resolvePalette(spec.pixel.palette) : null } : null,
    ascii: spec.ascii ? { cols: spec.ascii.cols, text: spec.ascii.text ?? 0.5, dither: spec.ascii.dither ?? 0.5, palette: !spec.ascii.palette || spec.ascii.palette === 'xterm' ? xtermPalette() : resolvePalette(spec.ascii.palette), grids: 'ascii.json', ansi: 'atlas.ans' } : null,
    frames,
  };
  return { svg, atlas, style, width, height };
}

/** Stand-alone page showing every sprite on the game's background at three sizes. */
export function previewHtml(spec, built) {
  const bg = spec.background ?? '#1c2430';
  const { atlas } = built;
  const sheet = atlas.pixel || atlas.ascii ? 'atlas.png' : 'atlas.svg';
  const item = (name, fr, size) => {
    const k = size / Math.max(fr.w, fr.h) * (fr.w > atlas.cell || fr.h > atlas.cell ? 2 : 1);
    return `<div class="s" style="width:${fr.w * k}px;height:${fr.h * k}px;background-size:${atlas.width * k}px ${atlas.height * k}px;background-position:${-fr.x * k}px ${-fr.y * k}px"></div>`;
  };
  const cards = Object.entries(atlas.frames).map(([name, fr]) =>
    `<figure>${item(name, fr, 128)}<div class="row">${item(name, fr, 64)}${item(name, fr, 32)}</div><figcaption>${name}</figcaption></figure>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Kiln preview</title><style>
body{margin:0;padding:20px;background:${bg};font:13px system-ui,sans-serif;color:${luminance(bg) > 0.4 ? '#222' : '#fff'}}
h1{font-size:16px;margin:0 0 14px;opacity:.85;font-weight:600}
main{display:flex;flex-wrap:wrap;gap:14px}
figure{margin:0;padding:10px;border-radius:10px;background:rgba(128,128,128,.12);display:flex;flex-direction:column;align-items:center;gap:6px}
.row{display:flex;gap:8px;align-items:flex-end;min-height:64px}
.s{background-image:url("${sheet}");background-repeat:no-repeat${atlas.pixel || atlas.ascii ? ';image-rendering:pixelated' : ''}}
figcaption{opacity:.8}
</style><h1>${atlas.style} style, seed ${atlas.seed}, ${Object.keys(atlas.frames).length} sprites (shown at 128, 64 and 32 px)</h1><main>${cards}</main>`;
}
