// The open world of the scene demo (world-stage.js), shared by the page server (Node) and the game (browser) so
// both make exactly the same land from the seed. The world engine decides what is where: height,
// biome, trees and rocks per square metre, and where hamlets stand. This file turns that into
// Kiln scenes: heights in Kiln's z units, a material per metre of ground, and 3D shapes.
import { createTerrain, createWorld, createPageOrbit, buildPageScene, hash2, GROUND } from './vendor/world/index.js';

export const SEED = 'hamlets-1';
/** Kiln z (16 per metre) of the sea surface, and how steep the land is. */
export const WATER = 40;
const RISE = 260; // z units per unit of generator height
const SEA = 0.42;
const T = { tree: 1, pine: 2, oak: 3, rock: 4 };
const BIOMES = [
  { name: 'meadow', temp: 0.5, wet: 0.45, ground: GROUND.grass, scatter: [[T.tree, 0.002], [T.oak, 0.0015], [T.rock, 0.001]] },
  { name: 'forest', temp: 0.45, wet: 0.62, ground: GROUND.moss, scatter: [[T.tree, 0.011], [T.oak, 0.007], [T.rock, 0.001]] },
  { name: 'taiga', temp: 0.3, wet: 0.5, ground: GROUND.snow, scatter: [[T.pine, 0.011], [T.rock, 0.002]] },
  { name: 'steppe', temp: 0.66, wet: 0.36, ground: GROUND.dust, scatter: [[T.rock, 0.003], [T.tree, 0.0006]] },
  { name: 'fen', temp: 0.58, wet: 0.68, ground: GROUND.marsh, scatter: [[T.tree, 0.003], [T.pine, 0.002]] },
];
const HAMLET_RADIUS = 24; // metres kept clear of trees and levelled
const hamlet = {
  name: 'hamlet', spacing: 112, chance: 0.8, radius: 26, biomes: ['meadow', 'steppe', 'forest'],
  stamp(poi, put) { // clear the trees, lay a green and a path out to the east
    for (let dy = -HAMLET_RADIUS; dy <= HAMLET_RADIUS; dy++) {
      for (let dx = -HAMLET_RADIUS; dx <= HAMLET_RADIUS; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > HAMLET_RADIUS) continue;
        put(poi.tx + dx, poi.ty + dy, 'object', 0);
        if (d < 4.5 || (Math.abs(dy) < 1.5 && dx > 0)) put(poi.tx + dx, poi.ty + dy, 'ground', GROUND.path);
      }
    }
  },
};
const camp = {
  name: 'camp', spacing: 144, chance: 0.6, radius: 8,
  stamp(poi, put) { // a small clearing with trodden ground round the fire
    if (!campStands(poi)) return;
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > 7) continue;
      put(poi.tx + dx, poi.ty + dy, 'object', 0);
      if (d < 2.6) put(poi.tx + dx, poi.ty + dy, 'ground', GROUND.path);
    }
  },
};

/** The generator (pure: any tile, loaded or not). */
export const terrain = createTerrain({ seed: SEED, scale: 72, sea: SEA, peak: 0.7, biomes: BIOMES, pois: [hamlet, camp] });
/** The largest view the pages are sure to fill: 280 x 176 characters, which is 1120 x 704 pixels at 4 pixels a character. */
export const VIEW = [280, 176];
/**
 * Pages for that view, centres every 16 m, each rendered from 8 camera angles (0, 45 ... 315
 * degrees) and at two detail levels (2 and 4) so the camera can turn and zoom.
 */
export const orbit = createPageOrbit({ view: VIEW, cellsPerUnit: 3, details: [2, 4], yaws: [0, 45, 90, 135, 180, 225, 270, 315], step: 16, slack: 2, z0: 64, zRange: 80 });
/** The picture the world starts on: 45 degrees at detail 2. */
export const START_YAW = 1;
export const layout = orbit.layout(START_YAW, 0);

const MATERIALS = {
  grass: { fg: '#66cc66', bg: '#339933', glyph: ',' }, moss: { fg: '#339933', bg: '#336633', glyph: '"' }, dust: { fg: '#cccc66', bg: '#999933', glyph: '.' },
  snow: { fg: '#ffffff', bg: '#ccccff', glyph: '*' }, stone: { fg: '#ccccff', bg: '#9999aa', glyph: '#' }, marsh: { fg: '#669966', bg: '#336666', glyph: ';' },
  sand: { fg: '#ffff99', bg: '#cccc66', glyph: ':' }, seabed: { fg: '#999966', bg: '#666633', glyph: '.' }, path: { fg: '#cc9966', bg: '#996633', glyph: '.' },
};
const MATERIAL_OF = { [GROUND.deep]: 'seabed', [GROUND.water]: 'seabed', [GROUND.sand]: 'sand', [GROUND.grass]: 'grass', [GROUND.moss]: 'moss', [GROUND.dust]: 'dust', [GROUND.snow]: 'snow', [GROUND.rock]: 'stone', [GROUND.marsh]: 'marsh', [GROUND.path]: 'path' };

const rawZ = (x, y) => Math.max(WATER - 24, WATER + (terrain.sample(x, y).height - SEA) * RISE);
const siteCache = new Map(); // hamlets by 64 m block, so heightAt stays cheap
function hamletsNear(x, y) {
  const bx = Math.floor(x / 64); const by = Math.floor(y / 64);
  const key = bx + ',' + by;
  let list = siteCache.get(key);
  if (!list) {
    list = terrain.poisIn(bx * 64 - 40, by * 64 - 40, bx * 64 + 104, by * 64 + 104).filter((p) => p.name === 'hamlet').map((p) => ({ ...p, z: Math.max(WATER + 10, rawZ(p.tx, p.ty)) }));
    if (siteCache.size > 400) siteCache.clear();
    siteCache.set(key, list);
  }
  return list;
}
/** Ground height in Kiln z at any world point: the generator's land, levelled where a hamlet stands. */
export function heightAt(x, y) {
  let z = rawZ(x, y);
  for (const p of hamletsNear(x, y)) {
    const t = Math.min(1, Math.max(0, (Math.hypot(x - p.tx, y - p.ty) - HAMLET_RADIUS) / 14));
    if (t < 1) z = p.z * (1 - t) + z * t;
  }
  return z;
}

const unit = (seed, x, y, k) => hash2(seed + k * 7919, x, y) / 4294967296;
const gen = (describe, seed, at, yaw = 0) => ({ shape: 'gen', at, yaw, params: { describe, seed } }); // Kiln's asset generator makes it
/**
 * The buildings and props of one hamlet, always the same for the same site: an inn, a smithy and a
 * market stall from Kiln's asset generator (each hamlet gets its own variation), plain houses,
 * a well, and sometimes a shrine, a windmill or a tower.
 */
export function hamletObjects(p, kit = false) {
  const u = (k) => unit(p.seed, p.tx, p.ty, k);
  const s = (k) => 1 + ((p.seed >>> 3) + k * 131) % 9973; // a seed for each generated thing
  const cx = p.tx + 0.5; const cy = p.ty + 0.5;
  const at = (deg, r) => [cx + Math.cos(deg * Math.PI / 180) * r, cy + Math.sin(deg * Math.PI / 180) * r];
  const quarter = (k) => Math.floor(u(k) * 4) * 90;
  // kit: the green becomes the library's paved square with its fountain (hamletPrefabs), so no well, and the lamps
  // stand at its edge (the kit's own lanterns give no light at night; Kiln's lamps do)
  const out = [
    ...(kit ? [{ shape: 'lamp', at: [cx + 7.4, cy - 3] }] : [{ shape: 'well', at: [cx, cy] }, { shape: 'lamp', at: [cx + 3, cy - 3] }]), { shape: 'signpost', at: [cx + 7.5, cy + 2.5] },
    gen(['timber inn with a hanging sign', 'stone inn with a tiled roof', 'large thatched inn'][Math.floor(u(1) * 3)], s(1), at(180, 15.5), quarter(2)),
    gen(['stone smithy with a chimney', 'timber smithy with an anvil'][Math.floor(u(3) * 2)], s(2), at(270, 12.5), quarter(4)),
    gen(['market stall with a striped awning', 'market stall with fruit'][Math.floor(u(5) * 2)], s(3), [cx - 7.5, cy - 4.5], quarter(6)),
    gen('stack of barrels', s(4), [cx - 7.5, cy + 4.5]),
    { shape: 'lamp', at: at(180, kit ? 7.6 : 6.5) },
  ];
  // plain houses to the south and on both sides of the path east; the corners toward the east are sometimes empty
  houseSpots(p).forEach(([deg, r, i]) => {
    if (!kit) out.push({ shape: u(20 + i) < 0.5 ? 'cottage' : 'house', at: at(deg, r + u(30 + i) * 1.5), yaw: quarter(40 + i) });
    out.push({ shape: ['haystack', 'barrel', 'box'][Math.floor(u(50 + i) * 3)], at: at(deg + 24, r - 4.5) });
  });
  const extra = Math.floor(u(7) * 5); // 0 shrine, 1 windmill, 2 tower, 3 cart, 4 nothing
  if (extra === 0) out.push(gen('small stone shrine', s(5), at(225, 17), quarter(8)));
  if (extra === 1) out.push({ shape: 'windmill', at: at(135, 18), yaw: Math.round(u(8) * 360) });
  if (extra === 2) out.push({ shape: 'roundtower', at: at(225, 18) });
  if (extra === 3) out.push(gen('wooden cart', s(6), at(135, 9), Math.round(u(8) * 360)));
  return out;
}

/** Where a hamlet's plain houses stand: [degrees round the green, metres out, index]. The corners toward the east are sometimes empty. */
function houseSpots(p) {
  return [[90, 12.5, 0], [42, 13, 1], [318, 13, 2]].filter(([, , i]) => i === 0 || unit(p.seed, p.tx, p.ty, 10 + i) < 0.75);
}
const KIT_HOUSES = [['town-house', 5.4, 2.7], ['town-house-small', 2.7, 2.7], ['town-house-timber', 2.7, 2.7], ['town-house-stone', 5.4, 2.7]];
/**
 * The same hamlet built from the studio library's ready-made buildings (kit pieces from outside packs,
 * see library/CREDITS.md): a paved square with a fountain and lanterns, and kit houses where the plain
 * ones stand, with one or two more beside them since they are smaller. [{ name, at: [x, y] }] with the
 * bottom-left corner in world metres; name is a file in library/prefabs. Used when the scene option
 * kit is on; the inn, smithy and stall stay the generated ones.
 */
export function hamletPrefabs(p) {
  const u = (k) => unit(p.seed, p.tx, p.ty, k);
  const cx = p.tx + 0.5; const cy = p.ty + 0.5;
  const out = [{ name: 'town-square', at: [cx - 6.75, cy - 6.75] }];
  for (const [deg, r, i] of houseSpots(p)) {
    const a = deg * Math.PI / 180; const d = r + u(30 + i) * 1.5;
    const [name, w, h] = KIT_HOUSES[Math.floor(u(60 + i) * KIT_HOUSES.length)];
    const x = cx + Math.cos(a) * d; const y = cy + Math.sin(a) * d;
    out.push({ name, at: [Math.round((x - w / 2) * 10) / 10, Math.round((y - h / 2) * 10) / 10] });
    const [n2, w2] = KIT_HOUSES[Math.floor(u(70 + i) * KIT_HOUSES.length)]; // a neighbour along the row
    if (u(80 + i) < 0.7) out.push({ name: n2, at: [Math.round((x + w / 2 + 1.2) * 10) / 10, Math.round((y - 1.35) * 10) / 10] });
    void w2;
  }
  return out;
}

const MOBS = ['hooded goblin with a spear', 'bandit with a club', 'skeleton warrior with a shield', 'wolf'];
/** True when a camp site is far enough from every hamlet to exist. */
function campStands(p) {
  return !terrain.poisIn(p.tx - 46, p.ty - 46, p.tx + 46, p.ty + 46).some((q) => q.name === 'hamlet');
}
/** A camp in the wilds, as scenery: a fire, a tent or two, a rack or a cart. Its band is not in the picture: see campMobs. */
export function campObjects(p) {
  if (!campStands(p)) return [];
  const u = (k) => unit(p.seed, p.tx, p.ty, k);
  const s = (k) => 1 + ((p.seed >>> 3) + k * 131) % 9973;
  const cx = p.tx + 0.5; const cy = p.ty + 0.5;
  const turn = u(1) * 360;
  const at = (deg, r) => [cx + Math.cos((turn + deg) * Math.PI / 180) * r, cy + Math.sin((turn + deg) * Math.PI / 180) * r];
  const out = [gen('campfire', s(1), [cx, cy]), { shape: 'tent', at: at(0, 4.5), yaw: Math.round(turn) }];
  if (u(2) < 0.5) out.push({ shape: 'tent', at: at(80, 4.8), yaw: Math.round(turn + 80) });
  out.push(u(3) < 0.5 ? gen('weapon rack', s(2), at(200, 4), Math.round(turn)) : gen('wooden cart', s(2), at(200, 5), Math.round(turn + 30)));
  return out;
}

const MOB_KINDS = ['goblin', 'bandit', 'skeleton', 'wolf']; // the same order as MOBS
/**
 * The band living at a camp site (a chunk feature or poisIn entry with name 'camp'): 2 or 3 mobs of
 * one kind, always the same for the same site. [] for a camp that does not stand (too near a hamlet).
 * Each: { kind, describe, seed, x, y, yaw } in world metres and degrees. describe and seed go to Kiln's
 * generateAsset({ describe, seed }) to get the character; x, y is where it stands by the fire.
 * The game makes them live (they are not drawn into the page).
 */
export function campMobs(p) {
  if (p.name !== 'camp' || !campStands(p)) return [];
  const u = (k) => unit(p.seed, p.tx, p.ty, k);
  const s = (k) => 1 + ((p.seed >>> 3) + k * 131) % 9973;
  const cx = p.tx + 0.5; const cy = p.ty + 0.5;
  const turn = u(1) * 360;
  const which = Math.floor(u(4) * MOBS.length); // one band per camp
  const n = 2 + Math.floor(u(5) * 2);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (turn + 120 + i * 70) * Math.PI / 180; const r = 2.4 + u(20 + i);
    out.push({ kind: MOB_KINDS[which], describe: MOBS[which], seed: s(10 + i), x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, yaw: Math.round(u(30 + i) * 360) });
  }
  return out;
}

const SHIRTS = ['#3a6ea5', '#a5533a', '#4f8a4b', '#8a6a2f', '#7a4a8a', '#b08d3c', '#5a7a86'];
const HAIR = ['#5a3a22', '#2a211c', '#a8743a', '#c9b38a', '#7a7a7a'];
const CLOAKS = ['#963c3c', '#2f5f8a', '#3f7a4a', '#7a5a2a', '#5a3f7a'];
/**
 * How one resident looks, from its seed: plain data { height, colors, bare } that is saved with
 * the resident. residentRig(look) turns it into options for the puppet engine's createCharacter.
 */
export function residentLook(seed, kind) {
  const u = (k) => unit(seed, k, 0, 3);
  const pick = (list, k) => list[Math.floor(u(k) * list.length)];
  if (kind === 'knight') { const c = pick(CLOAKS, 1); return { height: Math.round((1.78 + u(2) * 0.2) * 100) / 100, colors: { cloth: c, cape: c, plume: pick(SHIRTS, 3) } }; }
  return { height: Math.round((1.55 + u(2) * 0.35) * 100) / 100, colors: { top: pick(SHIRTS, 1), sleeve: pick(SHIRTS, 1), legs: pick(['#4a4a5a', '#5a4630', '#3f4f3a', '#6a5a4a'], 3), hair: pick(HAIR, 4) }, bare: u(5) < 0.35 };
}
/** createCharacter options for a look (bare = no hat). */
export function residentRig(look) {
  if (!look) return {};
  return { height: look.height, colors: look.colors, ...(look.bare ? { equipment: { head: null } } : {}) };
}

/**
 * The Kiln scene for one page. `world` is a world-engine world of 16 m chunks that is loaded
 * around the page (see createGenWorld): its tile layers say which ground and which object each metre has.
 * options: see sceneOptions (time, atmosphere, style, kit).
 */
export function pageScene(world, px, py, yawIndex = START_YAW, level = 0, options = {}) {
  const [cx, cy] = layout.centreOf(px, py);
  world.loadAll({ x: cx, y: cy });
  const look = sceneOptions(options);
  const scene = buildPageScene(orbit.layout(yawIndex, level), px, py, {
    name: `page_${px}_${py}_a${yawIndex}_d${orbit.details[level]}`, materials: MATERIALS, water: WATER,
    sky: { bg: '#10131f', fg: '#2a3350', glyph: '.' }, light: [1, 0.4, 1, 0.55],
    heightAt,
    materialAt: (x, y) => MATERIAL_OF[world.getTile('ground', x, y, GROUND.grass)] ?? 'grass',
    objectsIn(x0, y0, x1, y1) {
      const list = [];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const id = world.getTile('object', x, y);
          if (!id || heightAt(x + 0.5, y + 0.5) < WATER + 6) continue; // nothing grows in the sea or on the waterline
          const shape = id === T.tree ? 'tree' : id === T.pine ? 'pine' : id === T.oak ? 'oak' : 'rock';
          list.push({ shape, at: [x + 0.5, y + 0.5], yaw: Math.floor(unit(7, x, y, 1) * 360), scale: Math.round((0.55 + unit(7, x, y, 2) * 0.35) * 100) / 100, ...(shape === 'rock' ? { params: { seed: 1 + Math.floor(unit(7, x, y, 3) * 9) } } : {}) });
        }
      }
      for (const p of terrain.poisIn(x0 - 28, y0 - 28, x1 + 28, y1 + 28)) list.push(...(p.name === 'hamlet' ? hamletObjects(p, look.kit === true) : campObjects(p)));
      return list;
    },
  });
  const { kit, ...kiln } = look;
  if (kit) { // library prefabs, by name: the page server opens the files and the models they need (world-pages.mjs)
    const [ox, oy] = layout.originOf(px, py); const side = layout.half * 2;
    scene.prefabs = terrain.poisIn(ox - 28, oy - 28, ox + side + 28, oy + side + 28).filter((p) => p.name === 'hamlet').flatMap(hamletPrefabs)
      .filter((f) => f.at[0] >= ox + 1 && f.at[1] >= oy + 1 && f.at[0] <= ox + side - 15 && f.at[1] <= oy + side - 15)
      .map((f) => ({ file: f.name, at: [Math.round((f.at[0] - ox) * 10) / 10, Math.round((f.at[1] - oy) * 10) / 10] }));
  }
  return Object.assign(scene, kiln); // time of day, weather and style, when asked for
}

/** A world-engine world sized so a whole page fits in its loaded chunks (tile = 1 m, chunk = 16 m). */
export function createGenWorld(options = {}) {
  return createWorld({ generate: terrain.generate, chunkSize: 16, tileSize: 1, loadRadius: 8, maxLoadsPerUpdate: 4, seed: SEED, ...options });
}

/** A good place to start: beside the hamlet nearest the origin. */
export function startPoint() {
  const sites = terrain.poisIn(-400, -400, 400, 400).filter((p) => p.name === 'hamlet').sort((a, b) => Math.hypot(a.tx, a.ty) - Math.hypot(b.tx, b.ty));
  return sites.length ? { x: sites[0].tx + 6.5, y: sites[0].ty + 0.5, hamlet: sites[0] } : { x: 0.5, y: 0.5, hamlet: null };
}

// ---- look of the day: time, weather and style can be chosen per page request
const TIME_NAMES = ['dawn', 'day', 'dusk', 'night'];
const STYLE_NAMES = ['storybook', 'nocturne', 'papercut', 'crypt'];
const AIR = ['fog', 'haze', 'clouds', 'fireflies'];
/**
 * Check and tidy scene options: { time?: 'dawn' | 'day' | 'dusk' | 'night' | hour 0..24,
 * atmosphere?: { fog, haze, clouds, fireflies } each 0..1, style?, kit?: true to build hamlets from
 * the studio library's kit houses and paved square }. fog, haze, clouds and fireflies
 * may also be given at the top level. Returns { time?, atmosphere?, style? } with only what was set.
 * Note: Kiln ties fog and cloud shadows to the picture, not the ground, so they shift a little
 * when the page changes; time, haze, fireflies and style do not.
 */
export function sceneOptions(options = {}) {
  const out = {};
  const air = { ...(options.atmosphere ?? {}) };
  for (const [k, v] of Object.entries(options ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'atmosphere') continue;
    if (k === 'time') {
      const hour = typeof v === 'number' ? v : TIME_NAMES.includes(v) ? null : Number(v);
      if (hour !== null && !(hour >= 0 && hour <= 24)) throw new Error(`scene options: time must be ${TIME_NAMES.join(', ')} or an hour from 0 to 24, got ${JSON.stringify(v)}`);
      out.time = hour === null ? v : hour;
    } else if (k === 'style') {
      if (!STYLE_NAMES.includes(v)) throw new Error(`scene options: style must be one of ${STYLE_NAMES.join(', ')}, got ${JSON.stringify(v)}`);
      out.style = v;
    } else if (k === 'kit') { if (v === true || v === 1 || v === '1' || v === 'true') out.kit = true; else if (!(v === false || v === 0 || v === '0' || v === 'false')) throw new Error(`scene options: kit must be true or false, got ${JSON.stringify(v)}`); }
    else if (AIR.includes(k)) air[k] = v;
    else throw new Error(`scene options: unknown option "${k}" (use time, style, kit, ${AIR.join(', ')})`);
  }
  for (const k of AIR) {
    if (air[k] === undefined || air[k] === null || air[k] === '') continue;
    const n = Number(air[k]);
    if (!(n >= 0 && n <= 1)) throw new Error(`scene options: ${k} must be a number from 0 to 1, got ${JSON.stringify(air[k])}`);
    if (n > 0) (out.atmosphere ??= {})[k] = Math.round(n * 100) / 100;
  }
  return out;
}
/** A short name for a set of scene options, used in page file names: '' or for example 'time-dusk_fog-0.3'. */
export function sceneOptionsKey(options = {}) {
  const o = sceneOptions(options);
  const parts = [];
  if (o.time !== undefined) parts.push(`time-${o.time}`);
  for (const k of AIR) if (o.atmosphere?.[k] !== undefined) parts.push(`${k}-${o.atmosphere[k]}`);
  if (o.style) parts.push(`style-${o.style}`);
  if (o.kit) parts.push('kit-1');
  return parts.join('_');
}
/** The options a sceneOptionsKey stands for. */
export function sceneOptionsFromKey(key) {
  const flat = {};
  for (const part of String(key ?? '').split('_')) { if (!part) continue; const i = part.indexOf('-'); if (i < 1) throw new Error(`scene options: cannot read "${part}"`); flat[part.slice(0, i)] = part.slice(i + 1); }
  return sceneOptions(flat);
}
