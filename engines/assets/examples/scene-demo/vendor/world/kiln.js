// Kiln 3D scenes for an endless world. Kiln renders one fixed picture per scene, so the world is
// cut into overlapping "pages": scenes centred on a lattice of ground points. The game shows one
// page and swaps to the neighbour when the player walks away from the centre. Page centres are
// spaced so the picture moves by a whole number of characters between neighbours, which makes
// the swap invisible apart from small lighting differences (crossfade over them).
// A page can be rendered from several camera angles and at several detail levels (an "orbit" of
// pictures, for a camera that turns and zooms); every one of them lines up the same way.
// Pure data in, Kiln scene JSON out: nothing here imports Kiln.

const COS30 = Math.cos(Math.PI / 6);

/**
 * createPageOrbit(options) -> orbit
 * options:
 *   view          [cols, rows] characters of the coarsest detail the game shows at zoom 1. Required.
 *   cellsPerUnit  whole characters per ground unit along each ground axis at the coarsest detail,
 *                 for the diagonal camera angles. Default 3.
 *   details       Kiln scene details, coarse to fine, each a multiple of the first. Default [2].
 *   yaws          camera angles in degrees, multiples of 45. Default [45].
 *   step          ground units between page centres; a multiple of 8. Default 16.
 *   slack         extra units the player may stray past half a step before a swap. Default 2.
 *   z0            scene height (Kiln z, 16 per unit) the camera is held at. Default 64.
 *   zRange        how far ground height may differ from z0 (Kiln z). Default 64.
 * orbit:
 *   yaws, details, step, reach (how far from a page centre the player may get, per axis),
 *   half (page ground reaches centre +- half; the same for every picture of a page),
 *   layout(yawIndex, level) -> layout   one picture: { size, cells, detail, camera: { yaw, zoom },
 *                                       projection (exact, page-local) } plus the shared fields
 *   pageAt(x, y) -> { px, py }, centreOf(px, py) -> [x, y], originOf(px, py) -> [x, y]
 * Angles straight along an axis use a zoom a fraction of a percent off the diagonal ones (4.25
 * against 4.243 characters per unit at the defaults); only that makes their pages line up too.
 */
export function createPageOrbit(options = {}) {
  const { view, cellsPerUnit = 3, details = [2], yaws = [45], step = 16, slack = 2, z0 = 64, zRange = 64 } = options;
  if (!Array.isArray(view) || !(view[0] > 0) || !(view[1] > 0)) throw new Error('createPageOrbit: view must be [cols, rows]');
  if (!Number.isInteger(cellsPerUnit) || cellsPerUnit < 1) throw new Error(`createPageOrbit: cellsPerUnit must be a whole number >= 1, got ${cellsPerUnit}`);
  if (!Number.isInteger(step) || step < 8 || step % 8) throw new Error(`createPageOrbit: step must be a multiple of 8, got ${step}`);
  if (!Array.isArray(details) || !details.length || details.some((d, i) => !(d > 0) || (d / details[0]) % 1 !== 0 || (i > 0 && d <= details[i - 1]))) throw new Error(`createPageOrbit: details must rise and each be a multiple of the first, got ${JSON.stringify(details)}`);
  if (!Array.isArray(yaws) || !yaws.length || yaws.some((y) => !Number.isInteger(y / 45))) throw new Error(`createPageOrbit: yaws must be multiples of 45 degrees, got ${JSON.stringify(yaws)}`);
  const reach = step / 2 + slack;
  const even = (n, of = 2) => of * Math.ceil(n / of - 1e-9);
  // characters per ground unit along x and y for a camera angle, without rounding noise: whole
  // numbers on the diagonals (k / sqrt 2 = cellsPerUnit x scale), k or 0 along the axes
  const along = (a, k, s) => [Math.cos(a), Math.sin(a)].map((v) => (Math.abs(v) < 1e-9 ? 0 : Math.abs(Math.abs(v) - Math.SQRT1_2) < 1e-9 ? Math.sign(v) * cellsPerUnit * s : Math.sign(v) * k));
  const layouts = [];
  let half = 0;
  yaws.forEach((yaw, yi) => {
    const a = yaw * Math.PI / 180;
    const diagonal = Math.abs(yaw % 90) === 45;
    // characters per ground unit along the screen at the coarsest detail: a page step must be whole characters and rows
    const unit = 2 / step;
    const kBase = diagonal ? cellsPerUnit * Math.SQRT2 : Math.round(cellsPerUnit * Math.SQRT2 / unit) * unit;
    layouts[yi] = details.map((detail, li) => {
      const s = detail / details[0];
      const k = kBase * s;
      const [ca, sa] = along(a, k, s);
      const kz = -k * COS30 / 16; // rows per Kiln z unit
      const zRows = Math.ceil(Math.abs(kz) * zRange);
      // the camera shows this level from the zoom half way (on a doubling scale) to the level before it
      const zoomFrom = li === 0 ? 1 : Math.sqrt((details[li - 1] / details[0]) * s);
      const lattice = diagonal ? 2 : 1; // diagonal steps move whole characters only on even sizes
      const cols = even(even(view[0] * s / zoomFrom + 2 * reach * (Math.abs(ca) + Math.abs(sa)), detail), 2 * lattice);
      const rows = even(even(view[1] * s / zoomFrom + reach * (Math.abs(ca) + Math.abs(sa)) + 2 * zRows, detail), 2);
      // ground needed so the picture never shows the edge of the page
      const U = cols / 2; const V = rows / 2 + zRows;
      half = Math.max(half, (Math.abs(ca) * U + 2 * Math.abs(sa) * V) / (k * k), (Math.abs(sa) * U + 2 * Math.abs(ca) * V) / (k * k));
      return { yaw, yawIndex: yi, level: li, detail, cells: [cols, rows], size: [cols / detail, rows / detail], camera: { yaw, zoom: k / (1.5 * detail) }, k, kz };
    });
  });
  half = 8 * Math.ceil(half / 8);
  const patches = half / 4;
  if (patches * patches > 1024) throw new Error(`createPageOrbit: a page needs ${patches} x ${patches} ground patches, over Kiln's limit of 1024; use a smaller view or step`);
  const shared = {
    step, half, patches, reach, z0, zRange, cellsPerUnit,
    pageAt: (x, y) => ({ px: Math.round(x / step), py: Math.round(y / step) }),
    centreOf: (px, py) => [px * step, py * step],
    originOf: (px, py) => [px * step - half, py * step - half],
  };
  for (const row of layouts) {
    for (const l of row) {
      const [ca, sa] = along(l.yaw * Math.PI / 180, l.k, l.detail / details[0]);
      // the same numbers as Kiln's cameraProjection(scene)
      l.projection = { origin: [half, half, z0], col: [l.cells[0] / 2, ca, sa, 0], row: [l.cells[1] / 2, sa / 2, -ca / 2, l.kz] };
      Object.assign(l, shared);
    }
  }
  return {
    ...shared, yaws: yaws.slice(), details: details.slice(),
    layout(yawIndex = 0, level = 0) {
      const l = layouts[yawIndex]?.[level];
      if (!l) throw new Error(`page orbit: no picture at angle ${yawIndex}, level ${level} (there are ${yaws.length} angles and ${details.length} levels)`);
      return l;
    },
  };
}

/**
 * createPageLayout(options) -> layout. One camera angle (45 degrees) and one detail: the same as
 * createPageOrbit({ ...options, details: [detail] }).layout(0, 0). Options: view, cellsPerUnit,
 * detail (default 2), step, slack, z0, zRange.
 * layout: step, half, reach, patches, size, cells, detail, camera { yaw, zoom }, projection,
 *   pageAt(x, y), centreOf(px, py), originOf(px, py).
 */
export function createPageLayout(options = {}) {
  const { detail = 2, ...rest } = options;
  return createPageOrbit({ ...rest, details: [detail], yaws: [45] }).layout(0, 0);
}

/**
 * buildPageScene(layout, px, py, source) -> Kiln scene JSON for one page.
 * source (all positions are WORLD ground units; heights are Kiln z, 16 per unit):
 *   heightAt(x, y) -> number            ground height (level it yourself where buildings stand)
 *   materialAt(x, y) -> string          material name for the 1 x 1 unit at x, y (integers)
 *   materials                           Kiln materials { name: { fg, bg, glyph } }
 *   objectsIn(x0, y0, x1, y1) -> [{ shape, at: [x, y], yaw?, scale?, height?, params? }]
 *   water, sky, light, shading, name    passed to the scene when given
 * Everything a source returns must depend only on world position, so neighbouring pages agree.
 */
export function buildPageScene(layout, px, py, source) {
  if (!Number.isInteger(px) || !Number.isInteger(py)) throw new Error(`buildPageScene: page coordinates must be integers, got ${px}, ${py}`);
  for (const k of ['heightAt', 'materialAt', 'objectsIn']) if (typeof source?.[k] !== 'function') throw new Error(`buildPageScene: source.${k} must be a function`);
  const { half, patches, z0 } = layout;
  const [ox, oy] = layout.originOf(px, py);
  const side = half * 2;
  const n = side / 2 + 1;
  const heights = new Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = Math.max(0, Math.round(source.heightAt(ox + i * 2, oy + j * 2)));
  const names = Object.keys(source.materials);
  const data = new Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = names.indexOf(source.materialAt(ox + i, oy + j));
      if (k < 0) throw new Error(`buildPageScene: materialAt(${ox + i}, ${oy + j}) returned a name that is not in source.materials`);
      data[j * side + i] = k;
    }
  }
  const terrain = { patches: [patches, patches], grid: { step: 2, cols: n, rows: n, heights }, cells: { cols: side, rows: side, materials: names, data } };
  // the camera looks at the page centre from the same height on every page, so pictures line up
  const centreHeight = heights[(half / 2) * n + half / 2];
  const objects = source.objectsIn(ox, oy, ox + side, oy + side)
    .filter((o) => o.at[0] >= ox + 1 && o.at[1] >= oy + 1 && o.at[0] <= ox + side - 1 && o.at[1] <= oy + side - 1)
    .map((o) => ({ ...o, at: [o.at[0] - ox, o.at[1] - oy] }));
  const scene = {
    name: source.name ?? `page_${px}_${py}`, size: layout.size, detail: layout.detail,
    camera: { at: [half, half], lift: z0 - centreHeight, yaw: layout.camera.yaw, zoom: layout.camera.zoom },
    materials: source.materials, terrain, objects,
  };
  for (const k of ['water', 'sky', 'light', 'shading']) if (source[k] !== undefined) scene[k] = source[k];
  return scene;
}
