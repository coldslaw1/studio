// Camps as points of interest of the world engine. createPoiKinds gives the list that goes into
// the world's createTerrain({ pois }); campAt turns one of the world's sites back into the full
// camp (props, band, loot) whenever the game needs it. Nothing is stored: the site's seed is enough.
import { generateCamp } from './camp.js';
import { CAMP_TYPES } from './themes.js';

const need = (ok, message) => { if (!ok) throw new Error(message); };
/** The world engine's default ids (world/src/generate.js GROUND and OBJECT). Pass your own tables when yours differ. */
export const WORLD_IDS = { ground: { path: 11, floor: 10 }, object: { none: 0, boulder: 3, wall: 7, chest: 8, pillar: 9, fire: 10 } };
const AS_OBJECT = { campfire: 'fire', rock: 'boulder', rubble: 'boulder', pillar: 'pillar', statue: 'pillar', ruin: 'wall', fence: 'wall' };

/**
 * createPoiKinds(options) -> [poiKind, ...] for the world engine's createTerrain({ seed, pois })
 *   types     camp type names to use. Default: every name in CAMP_TYPES.
 *   level     1..10 for every camp, or a function (site) -> level (for example by distance from home). Default 1.
 *   ground, object   id tables: ground.path, object.none / fire / boulder / wall / chest / pillar. Default WORLD_IDS.
 *   campTypes extra or replacement camp types { name: type }
 *   spacing   multiplies every type's spacing (2 = camps twice as far apart). Default 1.
 * Each kind is { name, spacing, chance, radius, biomes?, stamp(poi, put) }. The stamp clears the
 * trees, treads a path round the middle and puts the fire, rocks, walls and chest on the object layer.
 */
export function createPoiKinds(options = {}) {
  const table = { ...CAMP_TYPES, ...(options.campTypes ?? {}) };
  const names = options.types ?? Object.keys(table);
  const ground = { ...WORLD_IDS.ground, ...(options.ground ?? {}) }; const object = { ...WORLD_IDS.object, ...(options.object ?? {}) };
  return names.map((name) => {
    const type = table[name];
    need(type, `createPoiKinds: unknown camp type ${JSON.stringify(name)} (known: ${Object.keys(table).join(', ')})`);
    const reach = Math.ceil((type.radius ?? 8) + 1);
    const spacing = Math.round((type.spacing ?? 144) * (options.spacing ?? 1));
    need(reach < spacing / 2, `createPoiKinds: camp type '${name}' reaches ${reach} tiles, which must be under half its spacing (${spacing})`);
    const kind = {
      name, spacing, chance: type.chance ?? 0.5, radius: reach,
      stamp(poi, put) {
        const camp = generateCamp({ seed: poi.seed, type: options.campTypes?.[name] ? { name, ...type } : name, level: levelOf(options.level, poi) });
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > camp.clear) continue;
          put(poi.tx + dx, poi.ty + dy, 'object', object.none);
          if (d < 2.6) put(poi.tx + dx, poi.ty + dy, 'ground', ground.path);
        }
        for (const prop of camp.props) {
          const as = object[AS_OBJECT[prop.prop]];
          if (as !== undefined && Math.hypot(prop.x, prop.y) <= reach) put(poi.tx + Math.round(prop.x), poi.ty + Math.round(prop.y), 'object', as);
        }
        for (const chest of camp.loot) if (object.chest !== undefined) put(poi.tx + Math.round(chest.x), poi.ty + Math.round(chest.y), 'object', object.chest);
      },
    };
    if (type.biomes) kind.biomes = type.biomes.slice();
    return kind;
  });
}

const levelOf = (level, site) => {
  const n = typeof level === 'function' ? level(site) : (level ?? 1);
  return Math.max(1, Math.min(10, Math.round(n)));
};

/**
 * campAt(site, options) -> camp in world positions, or null when the site is not a camp type.
 *   site      a world feature or terrain.poisIn(...) entry: { name, tx, ty, seed }
 *   options.tileSize   world units per tile (the world's tileSize, or 1 when a tile is a metre). Default 1.
 *   options.level, options.campTypes   as in createPoiKinds (use the same values, or the band will not match the stamp)
 * Positions (props, spawns, loot, fire, patrol, entrance) are world units; `at` is the centre.
 */
export function campAt(site, options = {}) {
  need(site && Number.isFinite(site.tx) && Number.isFinite(site.ty) && site.seed !== undefined, `campAt: site must be { name, tx, ty, seed }, got ${JSON.stringify(site)}`);
  const table = { ...CAMP_TYPES, ...(options.campTypes ?? {}) };
  if (!table[site.name]) return null;
  const unit = options.tileSize ?? 1;
  const camp = generateCamp({ seed: site.seed, type: options.campTypes?.[site.name] ? { name: site.name, ...table[site.name] } : site.name, level: levelOf(options.level, site) });
  return placeAt(camp, { x: (site.tx + 0.5) * unit, y: (site.ty + 0.5) * unit, unit });
}

/**
 * placeAt(camp, { x, y, unit = 1 }) -> a copy of the camp with every position moved to world
 * units: centre at x, y and `unit` world units per metre. Sets camp.at = { x, y } and camp.unit.
 */
export function placeAt(camp, where = {}) {
  need(camp && camp.kind === 'camp', 'placeAt: the first argument must be a camp from generateCamp');
  const { x = 0, y = 0, unit = 1 } = where;
  need(Number.isFinite(x) && Number.isFinite(y) && unit > 0, `placeAt: need numbers x, y and unit > 0, got ${JSON.stringify(where)}`);
  const q = (n) => Math.round(n * 100) / 100;
  const move = (p) => ({ ...p, x: q(x + p.x * unit), y: q(y + p.y * unit) });
  return {
    ...camp, at: { x, y }, unit, radius: camp.radius * unit, clear: camp.clear * unit,
    fire: camp.fire ? move(camp.fire) : null,
    ...(camp.gate ? { gate: move(camp.gate) } : {}),
    props: camp.props.map((p) => ({ ...move(p), reach: p.reach * unit, ...(p.length ? { length: p.length * unit } : {}) })),
    spawns: camp.spawns.map((s) => ({ ...move(s), ...(s.patrol ? { patrol: s.patrol.map(([px, py]) => [q(x + px * unit), q(y + py * unit)]) } : {}) })),
    loot: camp.loot.map(move),
    entrance: camp.entrance ? { ...move(camp.entrance), dungeon: { ...camp.entrance.dungeon } } : null,
  };
}
