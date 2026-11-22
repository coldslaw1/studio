// Quality checks on a rendered sheet. Works on small pixel samples so it runs anywhere.
import { contrast, toHex } from './color.js';

/**
 * @param {object} atlas    atlas.json data.
 * @param {Object<string, number[]>} samples  Per sprite: RGBA values of an NxN downsample (not premultiplied).
 * @param {string} background  Hex colour the game draws behind sprites.
 * @returns {{sprites:object, warnings:string[]}}
 */
export function checkSheet(atlas, samples, background = '#000000') {
  const warnings = [];
  const sprites = {};
  const sig = {};
  for (const [name, fr] of Object.entries(atlas.frames)) {
    const px = samples[name];
    if (!px) throw new Error(`checkSheet: no pixel sample for "${name}"`);
    const total = px.length / 4;
    let visible = 0;
    let readable = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 100) continue;
      visible++;
      if (contrast(toHex([px[i], px[i + 1], px[i + 2]]), background) >= 1.6) readable++;
    }
    const coverage = visible / total;
    const readableShare = visible ? readable / visible : 0;
    sprites[name] = { coverage: +coverage.toFixed(2), readable: +readableShare.toFixed(2) };
    sig[name] = px.map((v, i) => (i % 4 === 3 ? v : (v * px[i - (i % 4) + 3]) / 255));
    if (fr.tile) {
      if (coverage < 0.98) warnings.push(`${name}: tile does not fill its cell (${Math.round(coverage * 100)}% covered); gaps will show between tiles.`);
    } else {
      if (coverage < 0.1) warnings.push(`${name}: only ${Math.round(coverage * 100)}% of the cell is drawn; it will look tiny in game.`);
      if (coverage > 0.93) warnings.push(`${name}: fills ${Math.round(coverage * 100)}% of the cell; edges are probably cut off.`);
      if (readableShare < 0.35) warnings.push(`${name}: only ${Math.round(readableShare * 100)}% of it stands out from the background ${background}; use lighter colours or a rim.`);
    }
  }
  const names = Object.keys(sig);
  for (let a = 0; a < names.length; a++) {
    for (let b = a + 1; b < names.length; b++) {
      if (atlas.frames[names[a]].tile && atlas.frames[names[b]].tile) continue; // tile variants are meant to match
      const [x, y] = [sig[names[a]], sig[names[b]]];
      let diff = 0;
      for (let i = 0; i < x.length; i++) diff += Math.abs(x[i] - y[i]);
      if (diff / x.length < 4) warnings.push(`${names[a]} and ${names[b]} look almost identical; players will not tell them apart.`);
    }
  }
  return { sprites, warnings };
}
