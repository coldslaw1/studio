// Chunks: square blocks of tiles stored in typed arrays, and the pool that recycles them so a
// long walk does not keep allocating memory.

const OFF = 1 << 20; // chunk coordinates may run from -1048575 to 1048575
const SPAN = OFF * 2;
const TYPES = { u8: Uint8Array, u16: Uint16Array, i16: Int16Array, f32: Float32Array };

/** chunkKey(cx, cy) -> one number that names the chunk (used as a Map key). */
export function chunkKey(cx, cy) {
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx <= -OFF || cx >= OFF || cy <= -OFF || cy >= OFF) {
    throw new Error(`chunkKey: chunk coordinates must be integers within +-${OFF - 1}, got ${cx}, ${cy}`);
  }
  return (cx + OFF) * SPAN + (cy + OFF);
}

/** keyToChunk(key) -> { cx, cy }, the reverse of chunkKey. */
export function keyToChunk(key) {
  return { cx: Math.floor(key / SPAN) - OFF, cy: (key % SPAN) - OFF };
}

/**
 * createChunkPool(chunkSize, layers) -> { take(cx, cy), give(chunk), size() }
 * @param {number} chunkSize  tiles along one side of a chunk
 * @param {Object<string,string>} layers  layer name -> 'u8' | 'u16' | 'i16' | 'f32'
 *
 * A chunk is { cx, cy, key, size, x0, y0, layers: { name: TypedArray }, features: [],
 * edits: null | { layer: Map(index -> value) }, base, dirty, saved, spawned, version, cache }.
 * x0, y0 are the tile coordinates of its top-left tile. Index of a tile = localY * size + localX.
 */
export function createChunkPool(chunkSize, layers) {
  if (!Number.isInteger(chunkSize) || chunkSize < 4 || chunkSize > 256) throw new Error(`createChunkPool: chunkSize must be an integer from 4 to 256, got ${chunkSize}`);
  const names = Object.keys(layers);
  if (!names.length) throw new Error('createChunkPool: need at least one layer');
  for (const n of names) if (!TYPES[layers[n]]) throw new Error(`createChunkPool: layer "${n}" has unknown type "${layers[n]}" (use u8, u16, i16 or f32)`);
  const free = [];
  const cells = chunkSize * chunkSize;

  function take(cx, cy) {
    let chunk = free.pop();
    if (chunk) {
      for (const n of names) chunk.layers[n].fill(0);
    } else {
      chunk = { layers: {}, size: chunkSize };
      for (const n of names) chunk.layers[n] = new TYPES[layers[n]](cells);
    }
    chunk.cx = cx;
    chunk.cy = cy;
    chunk.key = chunkKey(cx, cy);
    chunk.x0 = cx * chunkSize;
    chunk.y0 = cy * chunkSize;
    chunk.features = [];
    chunk.edits = null;
    chunk.base = null;
    chunk.dirty = false;
    chunk.saved = false;
    chunk.savedEntities = false;
    chunk.spawned = false;
    chunk.version = 0;
    chunk.cache = null;
    return chunk;
  }

  function give(chunk) {
    chunk.features = null;
    chunk.edits = null;
    chunk.base = null;
    chunk.cache = null;
    free.push(chunk);
  }

  return { take, give, size: () => free.length, names };
}
