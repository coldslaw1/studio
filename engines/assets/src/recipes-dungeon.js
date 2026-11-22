// Dungeon-crawler recipes: fighters, monsters, item icons, inventory slots and a first-person corridor.
// All designs are original and built from the same pen primitives as the other recipes.

import { FIGURE_RECIPES } from './recipes-figures.js';

const RARITY = { common: '#2a3448', uncommon: '#2f5438', rare: '#1e3a6a', epic: '#3a2358', legendary: '#8f5231' };

export const DUNGEON_RECIPES = {
  ...FIGURE_RECIPES,

  sword: {
    description: 'Sword item icon, drawn on the diagonal.',
    params: { colors: 'blade, guard, grip, gem' },
    draw(p, { colors = {} }) {
      p.fill(p.poly([[84, 10], [90, 16], [44, 66], [34, 56]], 1.5, 0.2), colors.blade ?? 'steel', { depth: 3 });
      p.line('M84 17L42 59', p.tone(colors.blade ?? 'steel', 'deep'), 1.1, { opacity: 0.8 });
      p.fill(p.poly([[24, 50], [30, 44], [56, 70], [50, 76]], 2.5), colors.guard ?? 'gold', { depth: 2.5 });
      p.fill(p.poly([[30, 66], [34, 70], [20, 84], [16, 80]], 1.5), colors.grip ?? 'wood', { depth: 2 });
      p.fill(p.ellipse(15, 85, 5.5, 5.5, { n: 8 }), colors.gem ?? 'red', { depth: 2 });
    },
  },

  shield: {
    description: 'Heater shield item icon.',
    params: { colors: 'face, rim, emblem' },
    draw(p, { colors = {} }) {
      p.fill(p.curve([[16, 16], [50, 10], [84, 16], [82, 56], [50, 92], [18, 56]], 0.4), colors.rim ?? 'steel', { depth: 5 });
      p.fill(p.curve([[25, 23], [50, 18], [75, 23], [73, 53], [50, 80], [27, 53]], 0.4), colors.face ?? 'cloth', { depth: 5 });
      p.line('M50 22L50 76M28 44L72 44', colors.emblem ?? 'gold', 4);
      p.dot(50, 44, 5.5, colors.emblem ?? 'gold');
    },
  },

  potion: {
    description: 'Round flask with a cork. Colour the liquid per potion type.',
    params: { colors: 'liquid, glass, cork' },
    draw(p, { colors = {} }) {
      const liquid = colors.liquid ?? 'red';
      p.fill(p.rect(41, 10, 18, 10, 3), colors.cork ?? 'wood', { depth: 2 });
      p.fill(p.curve([[42, 20], [58, 20], [59, 36], [78, 54], [78, 74], [62, 90], [38, 90], [22, 74], [22, 54], [41, 36]], 0.3), colors.glass ?? 'steel', { depth: 5 });
      p.fill(p.curve([[27, 56], [50, 52], [73, 56], [74, 73], [61, 86], [39, 86], [26, 73]], 0.3), liquid, { depth: 4, outline: false });
      p.line('M31 60Q29 68 33 76', p.tone(liquid, 'light'), 2, { opacity: 0.8 });
    },
  },

  helmet: {
    description: 'Closed helm item icon with a crest.',
    params: { colors: 'metal, crest' },
    draw(p, { colors = {} }) {
      const metal = colors.metal ?? 'steel';
      p.fill(p.curve([[50, 20], [62, 6], [82, 10], [70, 22], [60, 28]]), colors.crest ?? 'roof', { depth: 3 });
      p.fill(p.curve([[20, 56], [24, 28], [50, 16], [76, 28], [80, 56], [76, 84], [50, 90], [24, 84]]), metal, { depth: 7 });
      p.flat('M28 48H72V56H28Z', 'ink');
      p.flat('M46 56H54V80H46Z', 'ink');
      p.line('M24 40Q50 30 76 40', p.tone(metal, 'deep'), 1.8);
      for (const x of [34, 40, 60, 66]) p.dot(x, 68, 1.5, 'ink');
    },
  },

  staff: {
    description: 'Wizard staff item icon with a glowing orb.',
    params: { colors: 'shaft, orb' },
    draw(p, { colors = {} }) {
      const orb = colors.orb ?? 'sky';
      p.halo(72, 26, 26, orb, 0.7);
      p.line('M16 88L64 34', colors.shaft ?? 'wood', 5, { outlined: true });
      p.line('M60 40Q54 24 68 14M66 42Q84 40 86 26', 'gold', 3.4, { outlined: true });
      p.fill(p.ellipse(72, 26, 10, 10, { n: 10 }), orb, { depth: 4 });
      p.dot(69, 23, 2, p.tone(orb, 'light'));
    },
  },

  ring: {
    description: 'Ring item icon with a gem.',
    params: { colors: 'band, gem' },
    draw(p, { colors = {} }) {
      const band = colors.band ?? 'gold';
      const gem = colors.gem ?? 'slime';
      p.line(p.ellipse(50, 60, 24, 24, { n: 14, wobble: 0.2 }), band, 9, { outlined: true });
      p.line(p.ellipse(48.5, 58.5, 24, 24, { n: 14, wobble: 0 }), p.tone(band, 'light'), 2, { opacity: 0.8 });
      p.fill(p.poly([[50, 12], [62, 24], [50, 38], [38, 24]], 2), gem, { depth: 3.5 });
      p.line('M50 14L50 36M40 24L60 24', p.tone(gem, 'deep'), 0.9, { opacity: 0.7 });
    },
  },

  key: {
    description: 'Old key item icon.',
    params: { colors: 'metal' },
    draw(p, { colors = {} }) {
      const metal = colors.metal ?? 'gold';
      p.line('M40 60L80 20M68 32L78 42M76 24L84 32', metal, 6.5, { outlined: true });
      p.line(p.ellipse(28, 72, 13, 13, { n: 12, wobble: 0.2 }), metal, 7.5, { outlined: true });
      p.line('M42 58L78 22', p.tone(metal, 'light'), 1.6, { opacity: 0.8 });
    },
  },

  slot: {
    description: 'Inventory grid cell, tinted by rarity. Fills the whole cell.',
    tile: true,
    params: { rarity: '"common" (default), "uncommon", "rare", "epic" or "legendary"', colors: 'fill (overrides rarity)' },
    draw(p, { rarity = 'common', colors = {} }) {
      const fill = colors.fill ?? RARITY[rarity];
      if (!fill) throw new Error(`slot: unknown rarity "${rarity}". Known: ${Object.keys(RARITY).join(', ')}`);
      p.flat('M0 0H100V100H0Z', 'ink');
      p.flat('M5 5H95V95H5Z', p.tone(fill, 'deep'));
      p.flat('M9 9H91V91H9Z', fill);
      p.line('M10.5 90L10.5 10.5L90 10.5', p.tone(fill, 'light'), 3, { opacity: 0.8 });
      p.line('M89.5 12L89.5 89.5L12 89.5', p.tone(fill, 'shadow'), 3);
    },
  },

  corridor: {
    description: 'First-person torch-lit brick corridor backdrop, 3 cells wide and 2 tall. Fills its whole area.',
    tile: true,
    span: [3, 2],
    view: [150, 100],
    params: { torch: '"left" (default), "right" or "none"', colors: 'wall, floor, light' },
    draw(p, { torch = 'left', colors = {} }) {
      const wall = colors.wall ?? 'brick';
      const floor = colors.floor ?? 'stone';
      const lightCol = colors.light ?? 'ember';
      const [vx, vy] = [75, 47];
      const back = { x0: 55, x1: 95, y0: 31, y1: 64 };
      p.flat('M0 0H150V100H0Z', 'ink');
      p.flat(`M0 0H150L${back.x1} ${back.y0}H${back.x0}Z`, p.tone(wall, 'deep'));
      p.flat(`M0 100H150L${back.x1} ${back.y1}H${back.x0}Z`, p.tone(floor, 'shadow'));
      p.flat(`M0 0L${back.x0} ${back.y0}V${back.y1}L0 100Z`, wall);
      p.flat(`M150 0L${back.x1} ${back.y0}V${back.y1}L150 100Z`, p.tone(wall, 'shadow'));
      p.flat(`M${back.x0} ${back.y0}H${back.x1}V${back.y1}H${back.x0}Z`, p.tone(wall, 'shadow'));
      const mortar = p.tone(wall, 'outline');
      // side walls: courses converge on the vanishing point, joints bunch up with distance
      for (const side of [0, 1]) {
        const edge = side ? 150 : 0;
        const bx = side ? back.x1 : back.x0;
        for (let i = 0; i <= 10; i++) {
          const y = i * 10;
          const t = (bx - edge) / (vx - edge);
          p.line(`M${edge} ${y}L${bx} ${(y + (vy - y) * t).toFixed(2)}`, mortar, 0.7, { opacity: 0.85 });
        }
        for (let k = 0; k < 9; k++) {
          const u = 1 - 0.74 ** k;
          const x = edge + (bx - edge) * u;
          const t = (x - edge) / (vx - edge);
          for (let i = 0; i < 10; i++) {
            if ((i + k) % 2) continue;
            const ya = i * 10 + (vy - i * 10) * t;
            const yb = (i + 1) * 10 + (vy - (i + 1) * 10) * t;
            p.line(`M${x.toFixed(2)} ${ya.toFixed(2)}L${x.toFixed(2)} ${yb.toFixed(2)}`, mortar, 0.6, { opacity: 0.8 });
          }
        }
      }
      // back wall bricks and a dark archway
      for (let r = 0; r <= 6; r++) {
        const y = back.y0 + r * 5.5;
        p.line(`M${back.x0} ${y}H${back.x1}`, mortar, 0.5, { opacity: 0.8 });
        for (let c = 0; c < 8 && r < 6; c++) {
          const x = back.x0 + c * 5 + (r % 2 ? 2.5 : 0);
          p.line(`M${x} ${y}V${y + 5.5}`, mortar, 0.5, { opacity: 0.8 });
        }
      }
      p.flat(`M67 ${back.y1}V46Q75 37 83 46V${back.y1}Z`, 'ink');
      p.line(`M67 ${back.y1}V46Q75 37 83 46V${back.y1}`, p.tone(floor, 'base'), 1.4);
      // floor flagstones
      for (let k = 1; k < 7; k++) {
        const y = back.y1 + (100 - back.y1) * (1 - 0.66 ** k) * 1.09;
        const t = (y - back.y1) / (100 - back.y1);
        p.line(`M${(back.x0 * (1 - t)).toFixed(2)} ${y.toFixed(2)}H${(back.x1 + (150 - back.x1) * t).toFixed(2)}`, p.tone(floor, 'outline'), 0.7, { opacity: 0.8 });
      }
      for (const fx of [-60, -25, 5, 35, 70]) {
        p.line(`M${vx + fx * 0.27} ${back.y1}L${vx + fx * 1.6} 100`, p.tone(floor, 'outline'), 0.7, { opacity: 0.7 });
      }
      // wear: uneven patches so the walls do not look freshly painted
      for (let i = 0; i < 26; i++) {
        p.flat(p.blob(p.rng.range(0, 150), p.rng.range(0, 100), p.rng.range(3, 9), { n: 7, bumpy: 0.3 }), i % 3 ? 'ink' : p.tone(wall, 'light'), { opacity: i % 3 ? 0.22 : 0.12 });
      }
      // darkness, then torch light on top
      const tx = torch === 'right' ? 118 : 32;
      const id = p.uid('dark');
      const cx = torch === 'none' ? 75 : tx;
      p.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="44" r="${torch === 'none' ? 90 : 125}"><stop offset="0" stop-color="#05040a" stop-opacity="0"/><stop offset="0.25" stop-color="#05040a" stop-opacity="0.2"/><stop offset="0.6" stop-color="#05040a" stop-opacity="0.62"/><stop offset="1" stop-color="#05040a" stop-opacity="0.93"/></radialGradient>`);
      p.raw(`<rect width="150" height="100" fill="url(#${id})"/>`);
      if (torch !== 'none') {
        p.halo(tx, 40, 46, lightCol, 0.75);
        p.fill(p.poly([[tx - 2, 46], [tx + 2, 46], [tx + 1.2, 60], [tx - 1.2, 60]], 0.6), 'wood', { depth: 1 });
        p.fill(p.rect(tx - 4, 44, 8, 3.4, 1), 'steel', { depth: 1 });
        p.flat(p.curve([[tx, 26], [tx + 5.5, 37], [tx + 3.5, 44], [tx - 3.5, 44], [tx - 5.5, 37]]), lightCol);
        p.flat(p.curve([[tx, 32], [tx + 3, 39], [tx + 1.8, 43.5], [tx - 1.8, 43.5], [tx - 3, 39]]), 'flame');
      }
    },
  },
};
