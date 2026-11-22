// createFx: the particles and effects engine. Bursts and emitters put particles into one fixed
// pool, update(dt) moves them, draw(ctx, view) paints them as character cells through whatever
// view is showing (baked isometric picture, open world, first person, or a flat 2D game).
import { createPool, createRng, allocSlot, stepPool, POOL_SIZE } from './pool.js';
import { PRESETS, makePreset } from './presets.js';
import { FX_STYLES, makeStyle, hexPacked, packedHex } from './styles.js';
import { GLYPH_LIST, glyphId } from './glyphs.js';
import { createShake } from './shake.js';
import { createCellList, collectCells } from './cells.js';
import { createPainter } from './draw.js';

/** What each Detail level allows: particles alive at once, and how full bursts and emitters are. */
export const FX_DETAIL = Object.freeze({ low: { cap: 160, amount: 0.5 }, medium: { cap: 400, amount: 1 }, high: { cap: POOL_SIZE, amount: 1.5 } });
const detailName = (d) => (typeof d === 'number' ? (d <= 2 ? 'low' : d <= 3 ? 'medium' : 'high') : d);

/**
 * flatView(options) -> view for a flat 2D game (top-down or side-on) with no camera engine.
 *   options.scale    pixels per metre. Default 16.      options.cellPx  pixels per character cell. Default 8.
 *   options.width, options.height   canvas size (default: the canvas being drawn to)
 *   options.camera   { x, y } in metres: the world point at the canvas's top left. May be changed at any time.
 * World x goes right, world y goes down the screen, height lifts a particle up the screen.
 */
export function flatView(options = {}) {
  const view = { scale: options.scale ?? 16, cellPx: options.cellPx ?? 8, width: options.width, height: options.height, camera: options.camera ?? { x: 0, y: 0 }, point: { x: 0, y: 0, scale: 0, visible: true } };
  view.toScreen = (x, y, h = 0) => { const p = view.point; p.x = (x - view.camera.x) * view.scale; p.y = (y - view.camera.y - h) * view.scale; p.scale = view.scale; return p; };
  return view;
}

/**
 * createFx(options) -> fx
 *   options.style    'storybook' (default), 'nocturne', 'papercut' or 'crypt'
 *   options.detail   'low', 'medium' (default) or 'high'; or the base's number 2, 3 or 5
 *   options.rng      () -> float in [0, 1). Default: a seeded generator (options.seed, default 1).
 *   options.shake    { maxPx = 10, snap = 1 }: how far a full shake moves the picture, and its step
 *   options.createCanvas   (w, h) -> canvas for the glyph sheet (default: the browser's)
 * See README.md for every method.
 */
export function createFx(options = {}) {
  const rng = options.rng ?? createRng(options.seed ?? 1);
  if (typeof rng !== 'function') throw new Error(`createFx: rng must be a function, got ${typeof rng}`);
  const pool = createPool(POOL_SIZE);
  const presets = []; const presetIndex = new Map();
  const styles = new Map(Object.entries(FX_STYLES).map(([n, s]) => [n, makeStyle(n, s, s)]));
  const shake = createShake(options.shake);
  const list = createCellList();
  const painter = createPainter({ createCanvas: options.createCanvas });
  const emitters = [];
  const wind = { x: 0, y: 0 };
  const light = [1, 1, 1];
  const palette = { packed: [], css: [], version: 0 };
  const stats = { alive: 0, spawned: 0, dropped: 0, cells: 0, emitters: 0 };
  const view = { toScreen: null, cellPx: 8, originX: 0, originY: 0, width: 0, height: 0, occluded: null };
  let looks = []; let style = null; let detail = 'medium'; let amount = 1; let dirty = true; let lastDt = 1 / 42; let time = 0; let veilCss = 'rgba(0,0,0,0.2)'; let serial = 0;

  for (const [name, def] of Object.entries(PRESETS)) { presetIndex.set(name, presets.length); presets.push(makePreset(name, def)); }

  function presetOf(name, who) {
    const i = presetIndex.get(name);
    if (i === undefined) throw new Error(`${who}: no effect named ${JSON.stringify(name)} (there are: ${[...presetIndex.keys()].join(', ')})`);
    return i;
  }
  function point(o, who) {
    if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y)) throw new Error(`${who}: needs numbers for x and y, got ${JSON.stringify(o && { x: o.x, y: o.y })}`);
    if (o.z !== undefined && !Number.isFinite(o.z)) throw new Error(`${who}: z must be a number, got ${JSON.stringify(o.z)}`);
  }

  // glyph and colour indexes for every preset in the style that is on
  function rebuild() {
    dirty = false;
    const slot = new Map(); palette.packed = []; palette.css = [];
    const tinted = (hex, glow) => {
      let c = hexPacked(hex);
      if (!glow) c = (Math.min(255, Math.round((c >>> 16) * light[0])) << 16) | (Math.min(255, Math.round(((c >>> 8) & 255) * light[1])) << 8) | Math.min(255, Math.round((c & 255) * light[2]));
      if (!slot.has(c)) { if (palette.packed.length >= 255) return 0; slot.set(c, palette.packed.length); palette.packed.push(c); palette.css.push(packedHex(c)); }
      return slot.get(c);
    };
    looks = presets.map((p) => {
      const look = style.looks[p.look] ?? style.looks.spark;
      return {
        glyphIds: Uint8Array.from([...look.glyphs], (ch) => glyphId(ch, `fx style '${style.name}' look '${p.look}'`)),
        colorIds: Uint8Array.from(look.colors, (c) => tinted(c, look.glow)),
        veil: look.veil > 0 ? 1 : 0, streak: p.streak, twinkle: p.twinkle, layer: p.layer,
      };
    });
    const v = hexPacked(style.veilColor); const strength = Math.max(0, ...presets.map((p) => style.looks[p.look]?.veil ?? 0));
    veilCss = `rgba(${v >>> 16},${(v >>> 8) & 255},${v & 255},${strength})`;
    palette.version++;
  }

  function spawn(pi, x, y, z, dx, dy, dz, power, radius) {
    const d = presets[pi];
    const i = allocSlot(pool, d.important);
    if (i < 0) { stats.dropped++; return false; }
    const cosT = 1 - rng() * (1 - Math.cos(d.spread)); const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT)); const phi = rng() * Math.PI * 2;
    let ax = 1; let ay = 0;
    const flat = Math.hypot(dx, dy);
    if (flat > 1e-4) { ax = dy / flat; ay = -dx / flat; }
    const bx = -dz * ay; const by = dz * ax; const bz = dx * ay - dy * ax; // d x a
    const ca = Math.cos(phi) * sinT; const sb = Math.sin(phi) * sinT;
    const speed = (d.speed[0] + rng() * (d.speed[1] - d.speed[0])) * power;
    pool.vx[i] = (dx * cosT + ax * ca + bx * sb) * speed; pool.vy[i] = (dy * cosT + ay * ca + by * sb) * speed; pool.vz[i] = (dz * cosT + bz * sb) * speed;
    const r = radius > 0 ? radius * Math.sqrt(rng()) : 0; const ra = rng() * Math.PI * 2;
    pool.x[i] = x + Math.cos(ra) * r; pool.y[i] = y + Math.sin(ra) * r; pool.z[i] = Math.max(0, z + (radius > 0 ? (rng() - 0.5) * radius : 0));
    pool.age[i] = 0; pool.life[i] = d.life[0] + rng() * (d.life[1] - d.life[0]);
    pool.size_[i] = d.size; pool.seed[i] = rng(); pool.sx[i] = NaN; pool.sy[i] = NaN; pool.def[i] = pi;
    stats.spawned++;
    return true;
  }
  function aim(o, d, who) {
    const dir = o.dir ?? d.dir;
    if (!Array.isArray(dir) || dir.length !== 3 || !dir.every(Number.isFinite)) throw new Error(`${who}: dir must be [x, y, z], got ${JSON.stringify(dir)}`);
    const l = Math.hypot(dir[0], dir[1], dir[2]);
    if (l === 0) throw new Error(`${who}: dir must not be all zero`);
    return l;
  }

  const fx = {
    shakeState: shake, stats,
    /** The style that is on (its name). */
    get style() { return style.name; },
    get detail() { return detail; },
    /** Particles alive now. */
    get count() { return pool.n; },
    get reducedMotion() { return shake.reduced; },
    presets: () => [...presetIndex.keys()],
    styles: () => [...styles.keys()],
    hasStyle: (name) => styles.has(name),

    burst(name, o = {}) {
      const pi = presetOf(name, 'fx.burst'); const d = presets[pi];
      point(o, `fx.burst('${name}')`);
      const l = aim(o, d, `fx.burst('${name}')`); const dir = o.dir ?? d.dir;
      if (o.count !== undefined && !(o.count >= 0)) throw new Error(`fx.burst('${name}'): count must be 0 or more, got ${JSON.stringify(o.count)}`);
      const want = (o.count ?? d.count) * amount;
      let n = Math.floor(want); if (rng() < want - n) n++;
      if (want > 0 && n === 0) n = 1;
      let made = 0;
      for (let k = 0; k < n; k++) if (spawn(pi, o.x, o.y, o.z ?? 0, dir[0] / l, dir[1] / l, dir[2] / l, o.power ?? 1, o.radius ?? d.radius)) made++;
      return made;
    },

    emitter(name, o = {}) {
      const pi = presetOf(name, 'fx.emitter'); const d = presets[pi];
      if (o.follow) point(o.follow, `fx.emitter('${name}') follow`); else point(o, `fx.emitter('${name}')`);
      const l = aim(o, d, `fx.emitter('${name}')`); const dir = o.dir ?? d.dir;
      if (o.rate !== undefined && !(o.rate >= 0)) throw new Error(`fx.emitter('${name}'): rate must be 0 or more, got ${JSON.stringify(o.rate)}`);
      if (o.id !== undefined && emitters.some((e) => e.id === o.id)) throw new Error(`fx.emitter('${name}'): an emitter with id ${JSON.stringify(o.id)} is already there`);
      const start = o.follow ?? o;
      const e = {
        id: o.id ?? `e${++serial}`, saved: o.id !== undefined && !o.follow, preset: name, pi,
        x: start.x, y: start.y, z: (start.z ?? 0) + (o.follow ? o.lift ?? 0 : 0), px: 0, py: 0, pz: 0,
        rate: o.rate ?? d.rate, on: o.on !== false, power: o.power ?? 1, radius: o.radius ?? d.radius,
        dx: dir[0] / l, dy: dir[1] / l, dz: dir[2] / l, dir: [dir[0], dir[1], dir[2]],
        follow: o.follow ?? null, lift: o.lift ?? 0, left: o.seconds ?? Infinity, acc: 0, done: false,
        moveTo(x, y, z = e.z) { if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`emitter.moveTo: needs numbers, got ${x}, ${y}, ${z}`); e.x = x; e.y = y; e.z = z; },
        stop() { e.done = true; const i = emitters.indexOf(e); if (i >= 0) emitters.splice(i, 1); stats.emitters = emitters.length; },
      };
      e.px = e.x; e.py = e.y; e.pz = e.z;
      emitters.push(e); stats.emitters = emitters.length;
      return e;
    },
    /** trail(name, follow, options): an emitter that stays on a moving thing ({ x, y, z }), filling the gaps along its path. */
    trail(name, follow, o = {}) { return fx.emitter(name, { ...o, follow }); },
    emitters: () => emitters.slice(),
    getEmitter: (id) => emitters.find((e) => e.id === id) ?? null,

    shake(amountOf, seconds) { shake.add(amountOf, seconds); },
    kick(dx, dy, seconds) { shake.kick(dx, dy, seconds); },
    flash(color, seconds, strength) { shake.flash(color, seconds, strength); },

    update(dt) {
      if (!(dt >= 0)) throw new Error(`fx.update: dt must be seconds, 0 or more, got ${dt}`);
      lastDt = dt; time += dt;
      for (let k = emitters.length - 1; k >= 0; k--) {
        const e = emitters[k];
        if (e.follow) { e.x = e.follow.x; e.y = e.follow.y; e.z = (e.follow.z ?? 0) + e.lift; }
        const live = e.on && !(e.follow && e.follow.hidden);
        if (live) {
          e.acc += e.rate * amount * dt;
          const n = Math.floor(e.acc); e.acc -= n;
          for (let j = 0; j < n; j++) { const t = (j + 1) / n; spawn(e.pi, e.px + (e.x - e.px) * t, e.py + (e.y - e.py) * t, e.pz + (e.z - e.pz) * t, e.dx, e.dy, e.dz, e.power, e.radius); }
          e.left -= dt;
        }
        e.px = e.x; e.py = e.y; e.pz = e.z;
        if (e.left <= 0) e.stop();
      }
      stats.alive = stepPool(pool, presets, dt, wind);
      shake.update(dt);
    },

    draw(ctx, v, alpha = 1) {
      if (!v || typeof v.toScreen !== 'function') throw new Error('fx.draw: the view needs a toScreen(x, y, h) function (use flatView() for a flat 2D game)');
      if (dirty) rebuild();
      view.toScreen = v.toScreen; view.cellPx = v.cellPx ?? 8; view.originX = v.originX ?? 0; view.originY = v.originY ?? 0;
      view.width = v.width ?? ctx.canvas?.width ?? 0; view.height = v.height ?? ctx.canvas?.height ?? 0; view.occluded = v.occluded ?? null;
      if (!(view.cellPx > 0)) throw new Error(`fx.draw: view.cellPx must be above 0, got ${v.cellPx}`);
      if (pool.n === 0) { stats.cells = 0; return 0; }
      collectCells(list, pool, looks, view, (1 - Math.min(1, Math.max(0, alpha))) * lastDt, time, style.streaks);
      stats.cells = painter.paint(ctx, list, view, palette, veilCss);
      return stats.cells;
    },

    /** cells(view) -> [{ col, row, ch, color }] of the picture draw() would paint. For tests and custom renderers. */
    cells(v) {
      if (dirty) rebuild();
      const w = { toScreen: v.toScreen, cellPx: v.cellPx ?? 8, originX: v.originX ?? 0, originY: v.originY ?? 0, width: v.width ?? 0, height: v.height ?? 0, occluded: v.occluded ?? null };
      collectCells(list, pool, looks, w, 0, time, style.streaks);
      const out = [];
      for (let i = 0; i < list.n; i++) { const k = list.cell[i]; out.push({ col: k % list.cols, row: Math.floor(k / list.cols), ch: GLYPH_LIST[list.glyph[k]], color: palette.css[list.color[k]] }); }
      return out;
    },

    /**
     * stamp(frame, toCell) -> cells written. Writes the effects straight into a character frame
     * { cols, rows, ch (codes), fg (0xRRGGBB) } such as the first-person view's, before it is painted.
     * toCell(x, y, h) -> { x: column, y: row, visible } (fractions allowed).
     */
    stamp(frame, toCell, occluded = null) {
      if (!frame || !frame.ch || !frame.fg || !(frame.cols > 0)) throw new Error('fx.stamp: frame must be { cols, rows, ch, fg }');
      if (typeof toCell !== 'function') throw new Error('fx.stamp: toCell must be a function (x, y, h) -> { x, y, visible }');
      if (dirty) rebuild();
      collectCells(list, pool, looks, { toScreen: toCell, cellPx: 1, originX: 0, originY: 0, width: frame.cols, height: frame.rows, occluded }, 0, time, style.streaks);
      for (let i = 0; i < list.n; i++) { const k = list.cell[i]; frame.ch[k] = GLYPH_LIST[list.glyph[k]].charCodeAt(0); frame.fg[k] = palette.packed[list.color[k]]; }
      return list.n;
    },

    /**
     * applyShake(ctx, options) -> true when the picture was moved. Call right after the world is
     * drawn and before the HUD: it slides what is on the canvas by the shake offset.
     *   options.background  colour for the strip the slide uncovers. Default '#000'.
     */
    applyShake(ctx, o = {}) {
      const dx = shake.x; const dy = shake.y;
      if (dx === 0 && dy === 0) return false;
      const canvas = ctx.canvas; const w = o.width ?? canvas.width; const h = o.height ?? canvas.height;
      const fill = ctx.fillStyle;
      ctx.drawImage(canvas, dx, dy);
      ctx.fillStyle = o.background ?? '#000';
      if (dx > 0) ctx.fillRect(0, 0, dx, h); else if (dx < 0) ctx.fillRect(w + dx, 0, -dx, h);
      if (dy > 0) ctx.fillRect(0, 0, w, dy); else if (dy < 0) ctx.fillRect(0, h + dy, w, -dy);
      ctx.fillStyle = fill;
      return true;
    },
    /** The shake offset in pixels, for games that move their own camera instead of calling applyShake. */
    get shakeX() { return shake.x; },
    get shakeY() { return shake.y; },
    /** drawFlash(ctx, width, height) -> true when a flash was drawn. Call after the world, before the HUD. */
    drawFlash(ctx, width = ctx.canvas.width, height = ctx.canvas.height) {
      if (shake.flashAlpha <= 0.004) return false;
      const fill = ctx.fillStyle; const a = ctx.globalAlpha;
      ctx.globalAlpha = shake.flashAlpha; ctx.fillStyle = shake.flashColor;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = a; ctx.fillStyle = fill;
      return true;
    },

    setStyle(name) {
      if (!styles.has(name)) throw new Error(`fx.setStyle: unknown style ${JSON.stringify(name)} (known: ${[...styles.keys()].join(', ')})`);
      if (style !== styles.get(name)) { style = styles.get(name); dirty = true; }
    },
    /** defineStyle(name, { extends, streaks, veilColor, looks: { spark: { glyphs, colors, glow, veil }, ... } }) */
    defineStyle(name, def = {}) {
      const from = def.extends ?? (styles.has(name) ? name : 'storybook');
      if (!styles.has(from)) throw new Error(`fx.defineStyle: '${name}' extends unknown style ${JSON.stringify(from)} (known: ${[...styles.keys()].join(', ')})`);
      const made = makeStyle(name, def, styles.get(from));
      for (const look of Object.values(made.looks)) [...look.glyphs].forEach((ch) => glyphId(ch, `fx.defineStyle('${name}')`));
      const on = style && style.name === name;
      styles.set(name, made);
      if (on) { style = made; dirty = true; }
    },
    /** define(name, preset): a new effect, or a changed one. preset.extends names the effect it starts from. */
    define(name, def = {}) {
      const from = def.extends !== undefined ? presets[presetOf(def.extends, `fx.define('${name}') extends`)] : presetIndex.has(name) ? presets[presetIndex.get(name)] : null;
      const made = makePreset(name, def, from);
      if (def.extends !== undefined && def.look === undefined) made.look = from.look;
      if (presetIndex.has(name)) presets[presetIndex.get(name)] = made; else {
        if (presets.length >= 255) throw new Error('fx.define: at most 255 effects');
        presetIndex.set(name, presets.length); presets.push(made);
      }
      dirty = true;
    },
    setDetail(d) {
      const name = detailName(d);
      if (!FX_DETAIL[name]) throw new Error(`fx.setDetail: detail must be 'low', 'medium', 'high' or a number, got ${JSON.stringify(d)}`);
      detail = name; amount = FX_DETAIL[name].amount; pool.cap = FX_DETAIL[name].cap;
      if (pool.n > pool.cap) pool.n = pool.cap;
      pool.cursor = 0;
    },
    setReducedMotion(on) { shake.reduced = !!on; },
    /** setShakeStrength(0..1): the player's screen shake setting. */
    setShakeStrength(s) { if (!(s >= 0)) throw new Error(`fx.setShakeStrength: must be 0 or more, got ${s}`); shake.strength = Math.min(1, s); },
    /** setWind(x, y): metres per second along the ground. Smoke, dust and embers drift with it. */
    setWind(x, y) { if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`fx.setWind: needs two numbers, got ${x}, ${y}`); wind.x = x; wind.y = y; },
    /** setLight([r, g, b]): the light on the scene, 1 = full day. Smoke and dust dim with it; sparks and magic glow on. */
    setLight(rgb) {
      if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every((v) => v >= 0)) throw new Error(`fx.setLight: needs [r, g, b] of 0 or more, got ${JSON.stringify(rgb)}`);
      const q = rgb.map((v) => Math.round(Math.min(2, v) * 16) / 16); // steps of 1/16, so a slow dusk does not rebuild the glyph sheet every tick
      if (q[0] !== light[0] || q[1] !== light[1] || q[2] !== light[2]) { light[0] = q[0]; light[1] = q[1]; light[2] = q[2]; dirty = true; }
    },
    /** clear(): remove every particle (emitters stay). clear(true) removes emitters and shakes too. */
    clear(all = false) { pool.n = 0; stats.alive = 0; if (all) { emitters.length = 0; stats.emitters = 0; shake.clear(); } },
    /** save() -> plain data: the emitters that were given an id (a campfire's smoke). Particles in flight are not saved. */
    save() {
      return { emitters: emitters.filter((e) => e.saved).map((e) => ({ id: e.id, preset: e.preset, x: e.x, y: e.y, z: e.z, rate: e.rate, on: e.on, power: e.power, radius: e.radius, dir: e.dir })) };
    },
    load(data) {
      if (!data || !Array.isArray(data.emitters)) throw new Error(`fx.load: expected { emitters: [...] } from fx.save(), got ${JSON.stringify(data)}`);
      for (const e of emitters.filter((x) => x.saved)) e.stop();
      pool.n = 0; stats.alive = 0;
      for (const e of data.emitters) if (presetIndex.has(e.preset)) fx.emitter(e.preset, e);
    },
  };
  fx.setStyle(options.style ?? 'storybook');
  fx.setDetail(options.detail ?? 'medium');
  return fx;
}
