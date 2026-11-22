// Dungeon figures. Drawn tall (1 cell wide, 2 cells high, on a 100x200 canvas) so they can have
// realistic proportions: head about one seventh of the height, long limbs, weight on the feet.
// Light comes from the upper left on every figure. No gloss, no cute features.

function dimEyes(p, pts, color, rx = 2.4, ry = 1.1) {
  for (const [x, y] of pts) {
    p.halo(x, y, rx * 2.4, color, 0.7);
    p.flat(p.ellipse(x, y, rx, ry, { n: 8, wobble: 0 }), color);
  }
}

/** A limb bone: outlined stroke with knuckle ends. */
function bone(p, color, a, b, w = 3.6) {
  p.line(`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`, color, w, { outlined: true });
  p.dot(a[0], a[1], w * 0.62, color);
  p.dot(b[0], b[1], w * 0.62, color);
}

export const FIGURE_RECIPES = {
  knight: {
    description: 'Armoured knight standing guard: closed helm, cuirass, tabard, heater shield, sword at rest. Tall sprite (1x2 cells).',
    span: [1, 2],
    params: { plume: 'true adds a crest plume', colors: 'tabard, cape, shield, metal, trim' },
    draw(p, { plume = false, colors = {} }) {
      const metal = colors.metal ?? 'steel';
      const cloth = colors.tabard ?? 'cloth';
      const trim = colors.trim ?? 'gold';
      const dark = p.tone(metal, 'deep');
      p.groundShadow(50, 191, 34, 5);
      p.fill(p.curve([[31, 54], [69, 54], [81, 150], [67, 178], [33, 178], [19, 150]], 0.4), colors.cape ?? 'roof', { depth: 8 });
      // legs
      p.fill(p.poly([[36, 120], [49, 120], [48, 182], [38, 182]], 2), metal, { depth: 3 });
      p.fill(p.poly([[51, 120], [64, 120], [62, 182], [52, 182]], 2), metal, { depth: 3 });
      p.fill(p.ellipse(43, 144, 6, 5, { n: 8 }), metal, { depth: 2 });
      p.fill(p.ellipse(57.5, 144, 6, 5, { n: 8 }), metal, { depth: 2 });
      p.fill(p.poly([[35, 180], [49, 180], [49, 190], [30, 190]], 2), metal, { depth: 2 });
      p.fill(p.poly([[51, 180], [65, 180], [70, 190], [51, 190]], 2), metal, { depth: 2 });
      // sword at rest, point down, behind the gauntlet
      p.fill(p.poly([[77.2, 108], [82.8, 108], [81.6, 180], [80, 187], [78.4, 180]], 0.6, 0.1), metal, { depth: 1.8 });
      p.line('M80 110L80 176', dark, 0.9, { opacity: 0.8 });
      p.fill(p.rect(70, 104, 20, 4.2, 1.2), trim, { depth: 1.4 });
      // torso
      p.fill(p.poly([[32, 56], [68, 56], [66, 104], [34, 104]], 5), metal, { depth: 5 });
      p.fill(p.poly([[40, 58], [60, 58], [63, 128], [50, 134], [37, 128]], 2), cloth, { depth: 4 });
      p.line('M50 64L50 96M43 76L57 76', trim, 2.2);
      p.line('M34 104L66 104', 'wood', 4, { outlined: true });
      p.fill(p.rect(47, 101.5, 6, 5.5, 1), trim, { depth: 1 });
      // arms
      p.fill(p.poly([[69, 62], [80, 64], [84, 98], [74, 99]], 3), metal, { depth: 3 });
      p.fill(p.ellipse(79.5, 101, 6.2, 6, { n: 8 }), metal, { depth: 2.2 });
      p.fill(p.ellipse(28.5, 60, 10.5, 8.5, { n: 9 }), metal, { depth: 3.5 });
      p.fill(p.ellipse(71.5, 60, 10.5, 8.5, { n: 9 }), metal, { depth: 3.5 });
      // helm
      p.fill(p.rect(43, 46, 14, 11, 2), dark, { depth: 1.5 });
      if (plume) p.fill(p.curve([[50, 14], [58, 2], [72, 8], [64, 16], [58, 20]]), colors.plume ?? 'red', { depth: 3 });
      p.fill(p.curve([[38, 34], [40, 18], [50, 11], [60, 18], [62, 34], [59, 50], [50, 55], [41, 50]], 0.3), metal, { depth: 5 });
      p.flat('M42 30.5H58V34H42Z', 'ink');
      p.line('M50 12L50 30M50 34L50 54', dark, 1.3);
      for (const [x, y] of [[45, 40], [45, 45], [55, 40], [55, 45]]) p.dot(x, y, 0.9, 'ink');
      // shield
      p.fill(p.curve([[5, 72], [21, 65], [38, 72], [37, 112], [21, 136], [6, 112]], 0.3), colors.shield ?? 'brick', { depth: 6 });
      p.line(p.curve([[8.5, 74.5], [21, 69], [34.5, 74.5], [33.5, 110], [21, 130], [9.5, 110]], 0.2), metal, 2);
      p.line('M21 71L21 128', trim, 3);
    },
  },

  skeleton: {
    description: 'Gaunt skeleton warrior, hunched, with a rusted blade and a rag at the hips. Tall sprite (1x2 cells).',
    span: [1, 2],
    params: { colors: 'bone, eyes, blade, rag' },
    draw(p, { colors = {} }) {
      const b = colors.bone ?? 'bone';
      const dark = p.tone(b, 'deep');
      p.groundShadow(50, 191, 30, 4.5);
      // blade, held low across the body
      p.fill(p.poly([[72, 112], [76.5, 110], [93, 44], [90, 38], [86, 42]], 0.8, 0.2), colors.blade ?? 'stone', { depth: 2 });
      p.line('M68 116L80 108', 'wood', 3.4, { outlined: true });
      // far arm and legs
      bone(p, b, [35, 56], [25, 90]);
      bone(p, b, [25, 90], [31, 122], 3.2);
      bone(p, b, [43, 116], [39, 152], 4.2);
      bone(p, b, [39, 152], [42, 184], 3.6);
      bone(p, b, [57, 116], [63, 150], 4.2);
      bone(p, b, [63, 150], [59, 184], 3.6);
      p.fill(p.poly([[33, 184], [45, 183], [45, 190], [29, 190]], 1.5), b, { depth: 1.5 });
      p.fill(p.poly([[55, 183], [66, 184], [71, 190], [55, 190]], 1.5), b, { depth: 1.5 });
      // spine, pelvis, rag
      p.line('M50 40L51 108', b, 4.2, { outlined: true });
      for (let y = 92; y <= 104; y += 4) p.line(`M48 ${y}L54 ${y}`, dark, 1);
      p.fill(p.curve([[37, 106], [50, 102], [63, 106], [60, 118], [50, 114], [40, 118]], 0.3), b, { depth: 3 });
      p.fill(p.poly([[36, 108], [64, 108], [66, 126], [58, 138], [52, 124], [46, 142], [40, 126], [34, 132]], 1.2, 0.6), colors.rag ?? 'roof', { depth: 4 });
      // ribcage
      p.fill(p.curve([[35, 52], [50, 47], [65, 52], [63, 82], [50, 90], [37, 82]], 0.3), b, { depth: 5 });
      for (let i = 0; i < 5; i++) {
        const y = 57 + i * 6;
        p.line(`M${38 + i * 0.4} ${y}Q50 ${y + 4} ${62 - i * 0.4} ${y}`, dark, 1.5);
      }
      p.line('M50 50L50 86', dark, 1.6);
      p.line('M34 53L66 53', b, 3.2, { outlined: true });
      // near arm, gripping the hilt
      bone(p, b, [66, 56], [77, 86]);
      bone(p, b, [77, 86], [72, 112], 3.2);
      // skull, tilted forward
      p.fill(p.poly([[44, 34], [56, 34], [55, 45], [45, 45]], 2), b, { depth: 2 });
      p.line('M47 39L47 44M50 39L50 44.5M53 39L53 44', dark, 1);
      p.fill(p.curve([[39, 26], [41, 14], [50, 9], [59, 14], [61, 26], [57, 36], [50, 38], [43, 36]], 0.3), b, { depth: 4.5 });
      p.flat(p.ellipse(45, 25.5, 3.4, 3.9, { n: 8, wobble: 0 }), 'ink');
      p.flat(p.ellipse(55, 25.5, 3.4, 3.9, { n: 8, wobble: 0 }), 'ink');
      p.flat('M50 29.5L48.3 34H51.7Z', 'ink');
      dimEyes(p, [[45, 26], [55, 26]], colors.eyes ?? 'ember', 1.2, 1.2);
    },
  },

  wraith: {
    description: 'Tall hooded wraith in a ragged shroud, holding a ghost-lantern on a chain. Tall sprite (1x2 cells).',
    span: [1, 2],
    params: { colors: 'cloak, eyes, light' },
    draw(p, { colors = {} }) {
      const cloak = colors.cloak ?? 'plum';
      const light = colors.light ?? 'slime';
      const fold = p.tone(cloak, 'deep');
      p.groundShadow(48, 193, 22, 3.5);
      p.halo(85, 134, 30, light, 0.8);
      p.fill(p.curve([[30, 62], [35, 26], [50, 10], [65, 26], [70, 62], [80, 128], [75, 180], [67, 160], [59, 190], [50, 166], [42, 192], [34, 162], [26, 182], [20, 128]], 0.5), cloak, { depth: 9 });
      p.line('M38 74Q34 120 40 160M52 80Q56 124 50 162M64 76Q70 118 66 156', fold, 1.8);
      p.fill(p.curve([[62, 70], [80, 88], [90, 108], [82, 114], [60, 94]], 0.4), cloak, { depth: 4 });
      p.line('M83 111L86 116M85 110L88.5 114', 'bone', 1.6);
      p.line('M85 114L85 126', 'steel', 1.1);
      p.fill(p.rect(79.5, 126, 11, 15, 1.5), 'stone', { depth: 2 });
      p.flat('M82 129H88V138H82Z', light);
      p.flat('M83.8 131.5H86.2V136H83.8Z', 'flame');
      p.flat(p.curve([[41, 40], [44, 26], [50, 21], [56, 26], [59, 40], [56, 54], [50, 58], [44, 54]], 0.2), 'ink');
      dimEyes(p, [[46, 38], [54, 38]], colors.eyes ?? light, 2.5, 0.95);
    },
  },

  bat: {
    description: 'Cave bat in flight, wings spread, seen from the front.',
    params: { colors: 'body, eyes' },
    draw(p, { colors = {} }) {
      const body = colors.body ?? 'stone';
      const dark = p.tone(body, 'deep');
      for (const s of [1, -1]) {
        const x = (v) => 50 + s * v;
        p.fill(p.poly([[x(6), 44], [x(20), 30], [x(34), 20], [x(48), 26], [x(45), 40], [x(47), 56], [x(36), 49], [x(30), 62], [x(21), 52], [x(12), 62], [x(7), 54]], 1.6, 0.4), body, { depth: 4 });
        p.line(`M${x(7)} 45L${x(34)} 21M${x(20)} 31L${x(36)} 49M${x(20)} 31L${x(21)} 52M${x(34)} 21L${x(46)} 54`, dark, 1.1);
        p.fill(p.poly([[x(2.5), 34], [x(8), 22], [x(10.5), 36]], 1.2), body, { depth: 1.5 });
      }
      p.fill(p.ellipse(50, 47, 8.5, 13, { n: 10 }), body, { depth: 4 });
      p.fill(p.ellipse(50, 37, 6.5, 6, { n: 8 }), body, { depth: 2.5 });
      dimEyes(p, [[47.3, 36.5], [52.7, 36.5]], colors.eyes ?? 'red', 1.1, 1.1);
      p.line('M47 63L46 68M53 63L54 68', dark, 1.2);
    },
  },
};
