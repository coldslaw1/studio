// Browser side: load a built sprite sheet and draw sprites from it by name.

/**
 * Wrap atlas data and a loaded image.
 * @param {object} data   Parsed atlas.json from `kiln build`.
 * @param {CanvasImageSource} image  The loaded atlas.png (or atlas.svg).
 * @returns {{names:Function, has:Function, frame:Function, draw:Function, drawTile:Function}}
 */
export function createAtlas(data, image) {
  if (!data || typeof data.frames !== 'object') throw new Error('createAtlas: data must be a parsed atlas.json with "frames"');
  if (!image) throw new Error('createAtlas: image is required');
  const frame = (name) => {
    const fr = data.frames[name];
    if (!fr) throw new Error(`atlas.frame: no sprite named "${name}". Known: ${Object.keys(data.frames).join(', ')}`);
    return fr;
  };
  /** Draw sprite `name` into the box x, y, w, h. Options: flipX, alpha, rotation (radians, about the centre). */
  function draw(ctx, name, x, y, w, h = w, opts = {}) {
    const fr = frame(name);
    const { flipX = false, alpha = 1, rotation = 0 } = opts;
    if (!flipX && alpha === 1 && rotation === 0 && !data.pixel && !data.ascii) {
      ctx.drawImage(image, fr.x, fr.y, fr.w, fr.h, x, y, w, h);
      return;
    }
    ctx.save();
    if (data.pixel || data.ascii) ctx.imageSmoothingEnabled = false; // keep pixel art crisp when scaled
    ctx.globalAlpha *= alpha;
    ctx.translate(x + w / 2, y + h / 2);
    if (rotation) ctx.rotate(rotation);
    if (flipX) ctx.scale(-1, 1);
    ctx.drawImage(image, fr.x, fr.y, fr.w, fr.h, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  /** Pick one of several tile variants by grid position, so the same cell always gets the same tile. */
  function drawTile(ctx, names, col, row, x, y, size) {
    if (!Array.isArray(names) || names.length === 0) throw new Error('atlas.drawTile: names must be a non-empty list');
    const i = Math.abs((col * 73856093) ^ (row * 19349663)) % names.length;
    draw(ctx, names[i], x, y, size, size);
  }
  return { data, image, names: () => Object.keys(data.frames), has: (name) => name in data.frames, frame, draw, drawTile };
}

/**
 * Fetch atlas.json and its image from a folder URL.
 * @param {string} baseUrl  Folder holding atlas.json, e.g. "assets/".
 * @param {{fetch?:Function, Image?:Function, vector?:boolean}} [env]  Injectable for tests; vector loads atlas.svg.
 */
export async function loadAtlas(baseUrl, env = {}) {
  const doFetch = env.fetch ?? globalThis.fetch;
  const ImageCtor = env.Image ?? globalThis.Image;
  if (!doFetch || !ImageCtor) throw new Error('loadAtlas: needs fetch and Image (pass them in env outside a browser)');
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const res = await doFetch(base + 'atlas.json');
  if (!res.ok) throw new Error(`loadAtlas: could not load ${base}atlas.json (HTTP ${res.status})`);
  const data = await res.json();
  const src = base + (env.vector ? data.vector : data.image);
  const image = new ImageCtor();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`loadAtlas: could not load image ${src}`));
    image.src = src;
  });
  return createAtlas(data, image);
}
