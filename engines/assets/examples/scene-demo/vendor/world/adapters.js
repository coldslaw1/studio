// Small bridges to other engines. Nothing here imports them: each adapter produces the plain
// shape the other engine reads, so this engine still works alone.

/**
 * createChunkCache(world, { build, dispose }) -> { get(chunk), peek(chunk), clear(), size() }
 * Keeps one built thing per loaded chunk (usually an offscreen canvas with the chunk drawn on
 * it). get(chunk) rebuilds only when a tile in the chunk changed; unloading a chunk drops its
 * entry and calls dispose(value). This is what keeps drawing cheap in a big world.
 * @param {function(object): any} build     (chunk) => value
 * @param {function(any): void} [dispose]   (value) => void
 */
export function createChunkCache(world, { build, dispose = null } = {}) {
  if (typeof build !== 'function') throw new Error('createChunkCache: build must be a function (chunk) => value');
  const entries = new Map(); // chunk key -> { version, value }
  world.on('unload', (chunk) => {
    const e = entries.get(chunk.key);
    if (!e) return;
    entries.delete(chunk.key);
    if (dispose) dispose(e.value);
  });
  return {
    get(chunk) {
      let e = entries.get(chunk.key);
      if (e && e.version === chunk.version) return e.value;
      if (e && dispose) dispose(e.value);
      e = { version: chunk.version, value: build(chunk) };
      entries.set(chunk.key, e);
      return e.value;
    },
    /** The up-to-date value or null, without building. Lets a renderer build only one or two chunks per frame. */
    peek(chunk) {
      const e = entries.get(chunk.key);
      return e && e.version === chunk.version ? e.value : null;
    },
    /** Drop everything (for example after switching art style). */
    clear() { if (dispose) for (const e of entries.values()) dispose(e.value); entries.clear(); },
    size: () => entries.size,
  };
}

/**
 * createTileMap(world, { solid, unloadedSolid }) -> { tileSize, isSolid(col, row) }
 * The tile-map shape the collision engine reads (PROVISIONAL: that engine is still being
 * built; this matches its `body.tiles` as of 2026-11). col and row are world tile coordinates,
 * any integer, so one map covers the whole endless world.
 * @param {Object<string, number[]>} solid  layer name -> tile ids that block, e.g. { ground: [1, 2], object: [1, 3] }
 * @param {boolean} [unloadedSolid]  what tiles in unloaded chunks count as. Default true (nothing walks off the loaded world).
 */
export function createTileMap(world, { solid, unloadedSolid = true } = {}) {
  if (!solid || typeof solid !== 'object') throw new Error('createTileMap: solid must be { layerName: [tile ids] }');
  const tables = Object.entries(solid).map(([layer, ids]) => {
    if (!Array.isArray(ids)) throw new Error(`createTileMap: solid.${layer} must be an array of tile ids`);
    const table = new Uint8Array(65536);
    for (const id of ids) table[id] = 1;
    return { layer, table };
  });
  const n = world.chunkSize;
  return {
    tileSize: world.tileSize,
    isSolid(col, row) {
      const chunk = world.chunkAtTile(col, row);
      if (!chunk) return unloadedSolid;
      const i = (row - chunk.y0) * n + (col - chunk.x0);
      for (const t of tables) { const arr = chunk.layers[t.layer]; if (arr && t.table[arr[i]]) return true; }
      return false;
    },
  };
}

/**
 * createGridMapper(legend) -> { palette, toGrid(chunk) }
 * Turns a chunk into a character grid { cols, rows, ch: string[], fg: number[], bg: number[] }
 * with colours as indexes into `palette` (-1 = transparent). That is the grid Kiln's
 * drawGrid(ctx, grid, palette, zoom) draws, and it is easy to print or draw yourself.
 * @param {{ground: Object<number,{ch:string, fg:string, bg:string}>, object?: Object<number,{ch:string, fg:string}>}} legend
 *   tile id -> one character and hex colours. An object on a tile replaces the ground's character and fg.
 */
export function createGridMapper(legend) {
  if (!legend || !legend.ground) throw new Error('createGridMapper: legend needs a ground table { id: { ch, fg, bg } }');
  const palette = [];
  const colorIndex = (hex) => {
    if (hex === undefined || hex === null) return -1;
    let i = palette.indexOf(hex);
    if (i < 0) i = palette.push(hex) - 1;
    return i;
  };
  const compile = (table) => {
    const out = [];
    for (const id in table ?? {}) {
      const t = table[id];
      if (typeof t.ch !== 'string' || [...t.ch].length !== 1) throw new Error(`createGridMapper: legend entry ${id} needs ch of exactly one character`);
      out[id] = { ch: t.ch, fg: colorIndex(t.fg), bg: colorIndex(t.bg) };
    }
    return out;
  };
  const ground = compile(legend.ground);
  const object = compile(legend.object);
  return {
    palette,
    toGrid(chunk) {
      const n = chunk.size;
      const g = chunk.layers.ground;
      const o = chunk.layers.object;
      const ch = new Array(n);
      const fg = new Array(n * n);
      const bg = new Array(n * n);
      for (let y = 0; y < n; y++) {
        let row = '';
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const a = ground[g[i]];
          const b = o ? object[o[i]] : undefined;
          row += b ? b.ch : a ? a.ch : ' ';
          fg[i] = b ? b.fg : a ? a.fg : -1;
          bg[i] = a ? a.bg : -1;
        }
        ch[y] = row;
      }
      return { cols: n, rows: n, ch, fg, bg };
    },
  };
}
