// Contact sheets: lay generated assets out in rows on flat ground, each row starting with the
// built-in villager (1.9 m, 2.1 m with the hat) for scale, as a scene for `kiln scene`. One picture then shows whether a batch is on-style and to scale.

/**
 * A scene that shows a list of generated assets in rows, each row starting with the built-in villager.
 * @param {object[]} assets  From generateAsset. Buildings, props and characters get rows of their own.
 * @param {object} [o]
 * @param {string} [o.name]     Scene name (default "gen-sheet").
 * @param {number} [o.width]    Longest row in metres before a new one starts (default: a roughly square sheet).
 * @param {number} [o.detail]   Scene detail (default 6).
 * @param {number[]} [o.size]   Picture size in characters at detail 1 (default worked out from the layout).
 * @param {number} [o.yaw]      Camera yaw (default 35).
 * @param {boolean} [o.person]  Put the built-in villager (1.9 m, 2.1 m with hat) at the start of each row (default true).
 * @returns {object} A scene description for writeScene / `kiln scene`.
 */
export function sheetScene(assets, o = {}) {
  if (!Array.isArray(assets) || assets.length === 0) throw new Error('sheetScene: expected a non-empty list of generated assets');
  const area = assets.reduce((n, a) => n + (a.size.width + 2) * (a.size.depth + 2), 0);
  const maxWidth = o.width ?? Math.max(14, Math.sqrt(area) * 1.5, ...assets.map((a) => a.size.width + 10));
  const groups = [assets.filter((a) => a.kind === 'building'), assets.filter((a) => a.kind === 'prop'), assets.filter((a) => a.model)].filter((g) => g.length);
  const objects = [];
  const margin = 4;
  let y = margin; let right = 0;
  for (const group of groups.reverse()) { // characters nearest the camera, buildings at the back
    const gap = group[0].kind === 'building' ? 3 : group[0].kind === 'prop' ? 1.2 : 0.7;
    const person = o.person ?? true;
    const rows = [[]];
    let used = person ? 1.6 : 0;
    for (const a of group) {
      if (used + a.size.width > maxWidth - margin * 2 && rows[rows.length - 1].length) { rows.push([]); used = person ? 1.6 : 0; }
      rows[rows.length - 1].push(a);
      used += a.size.width + gap;
    }
    for (const row of rows) {
      const depth = Math.max(...row.map((a) => a.size.depth));
      y += depth / 2;
      let x = margin;
      if (person) { objects.push({ shape: 'villager', at: [x + 0.5, Math.round((y - depth / 2 + 0.3) * 100) / 100] }); x += 1.6; }
      for (const a of row) {
        objects.push({ shape: 'gen', at: [Math.round((x + a.size.width / 2) * 100) / 100, Math.round(y * 100) / 100], params: a.scene.params });
        x += a.size.width + gap;
      }
      right = Math.max(right, x - gap);
      y += depth / 2 + gap;
    }
    y += gap;
  }
  const w = right + margin; const d = y + margin;
  const patches = [Math.ceil(w / 8), Math.ceil(d / 8)];
  const zoom = o.zoom ?? Math.max(0.6, Math.min(6, 170 / (w + d)));
  return {
    name: o.name ?? 'gen-sheet',
    size: o.size ?? [Math.round(Math.min(400, (w + d) * 1.05 * zoom)), Math.round(Math.min(300, ((w + d) * 0.55 + 12) * zoom))],
    detail: o.detail ?? 6,
    zoom: o.detail ?? 6,
    camera: { at: [patches[0] * 4, patches[1] * 4], yaw: o.yaw ?? 35, zoom, lift: 30 },
    light: [-0.4, -1, 1.1, 0.6],
    sky: { bg: '#141826', fg: '#232a40', glyph: '.' },
    materials: { ground: { fg: '#669966', bg: '#336633', glyph: ',' } },
    terrain: { patches, hills: { base: 16, amp: 0, scale: 14, seed: 1 } },
    objects,
  };
}
