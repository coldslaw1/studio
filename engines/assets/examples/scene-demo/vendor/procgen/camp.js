// Camps and points of interest for the open world: a bandit camp, a wolf den, a shrine, a ruin,
// the way down into a dungeon. Positions are METRES from the camp's centre (x right, y down),
// so one camp can be put anywhere: see placeAt in adapters.js and poi.js for the world engine.
import { createRng, seedOf, round2 } from './rng.js';
import { CAMP_TYPES, DUNGEON_THEMES, SOLID_PROPS } from './themes.js';

const need = (ok, message) => { if (!ok) throw new Error(message); };
const hex = (n) => (n >>> 0).toString(16).padStart(8, '0').slice(0, 6);
const LABEL = { bandit_camp: 'Camp', goblin_camp: 'Camp', hunter_camp: 'Camp', merchant_camp: 'Camp', wolf_den: 'Den', ruin: 'Ruin', shrine: 'Shrine', graveyard: 'Graveyard', dungeon_entrance: '' };
/** How much room a prop takes, metres from its middle. */
const REACH = { tent: 1.8, ruin: 3, cart: 1.3, stall: 1.4, rock: 1, statue: 0.8, campfire: 0.8, fence: 0.4 };

/**
 * generateCamp(options) -> camp
 *   seed      required
 *   type      a name in CAMP_TYPES or a type object. Default 'bandit_camp'.
 *   level     1..10: bigger bands and better loot. Default 1.
 *   id        prefix of every id inside. Default '<type>_' + 6 hex digits of the seed.
 * camp: { kind: 'camp', type, id, name, seed, level, radius, clear, hostile, faction,
 *   fire: { x, y } | null,
 *   props:  [{ id, prop, x, y, yaw, solid, reach, length? }],
 *   spawns: [{ id, kind, x, y, squad, faction, seed, leader?, guard?, size?, patrol?: [[x, y], ...] }],
 *   loot:   [{ id, x, y, container, table, tier, seed }],
 *   entrance: null | { x, y, dungeon: { seed, theme, level } } }   pass entrance.dungeon to generateDungeon
 * `clear` is the radius to keep free of trees. yaw is degrees, 0 = facing -y (Kiln's convention).
 */
export function generateCamp(options = {}) {
  need(options.seed !== undefined && options.seed !== null, 'generateCamp: options.seed is required');
  const typeName = typeof options.type === 'object' ? (options.type.name ?? 'custom') : (options.type ?? 'bandit_camp');
  const type = typeof options.type === 'object' ? options.type : CAMP_TYPES[typeName];
  need(type && Array.isArray(type.band), `generateCamp: unknown type ${JSON.stringify(options.type)} (known: ${Object.keys(CAMP_TYPES).join(', ')})`);
  const level = options.level ?? 1;
  need(Number.isFinite(level) && level >= 1 && level <= 10, `generateCamp: level must be 1..10, got ${level}`);
  const rng = createRng(options.seed, 'camp', typeName);
  const R = type.radius ?? 8;
  const id = options.id ?? `${typeName}_${hex(rng.seed)}`;
  const label = LABEL[typeName] ?? '';
  const camp = {
    kind: 'camp', type: typeName, id, name: `${rng.pick(type.names ?? ['Nameless'])}${label ? ` ${label}` : ''}`, seed: rng.seed, level,
    radius: R, clear: R + 1, hostile: type.hostile !== false, faction: type.faction ?? 'monsters',
    fire: null, props: [], spawns: [], loot: [], entrance: null,
  };
  const things = []; // { x, y, reach } of everything standing, to keep gaps
  const fits = (x, y, reach) => things.every((t) => Math.hypot(t.x - x, t.y - y) >= t.reach + reach + 0.3);
  const addProp = (prop, x, y, yaw, extra = {}) => {
    const reach = REACH[prop] ?? 0.6;
    const item = { id: `${id}_prop${camp.props.length}`, prop, x: round2(x), y: round2(y), yaw: Math.round(yaw), solid: SOLID_PROPS.has(prop) || prop === 'fence', reach, ...extra };
    camp.props.push(item); things.push({ x, y, reach });
    return item;
  };
  const toCentre = (x, y) => (Math.atan2(-x, y) * 180) / Math.PI; // yaw that faces the middle

  const propRng = rng.fork('props');
  const ring = [];
  for (const [prop, min, max] of type.ring ?? []) for (let n = propRng.int(min, max); n > 0; n--) ring.push(prop);
  if (type.fire) { camp.fire = { x: 0, y: 0 }; addProp('campfire', 0, 0, 0); }
  if (!type.fire && ring.length === 1) addProp(ring.pop(), 0, 0, propRng.int(0, 3) * 90);
  const turn = propRng.range(0, Math.PI * 2);
  ring.forEach((prop, i) => {
    const a = turn + (i / ring.length) * Math.PI * 2 + propRng.range(-0.25, 0.25);
    const d = R * propRng.range(0.42, 0.56);
    addProp(prop, Math.cos(a) * d, Math.sin(a) * d, toCentre(Math.cos(a) * d, Math.sin(a) * d) + (prop === 'rock' || prop === 'gravestones' ? propRng.int(-40, 40) : 0));
  });
  for (const [prop, min, max] of type.scatter ?? []) {
    for (let n = propRng.int(min, max); n > 0; n--) {
      for (let tries = 0; tries < 24; tries++) {
        const a = propRng.range(0, Math.PI * 2); const d = R * propRng.range(0.5, 0.88);
        const x = Math.cos(a) * d; const y = Math.sin(a) * d;
        if (!fits(x, y, REACH[prop] ?? 0.6)) continue;
        addProp(prop, x, y, propRng.int(0, 359));
        break;
      }
    }
  }
  if (type.palisade || type.fence) { // a fence all the way round, with one gap to walk in by
    const length = 4; const count = Math.max(4, Math.floor((2 * Math.PI * R) / (length + 0.2)));
    const gate = propRng.int(0, count - 1);
    for (let i = 0; i < count; i++) {
      if (i === gate) continue;
      const a = (i / count) * Math.PI * 2;
      addProp('fence', Math.cos(a) * R, Math.sin(a) * R, (a * 180) / Math.PI + 90, { length });
    }
    camp.gate = { x: round2(Math.cos((gate / count) * Math.PI * 2) * R), y: round2(Math.sin((gate / count) * Math.PI * 2) * R) };
  }

  const mobRng = rng.fork('band');
  const sentries = [];
  for (const [kind, min, max] of type.band) {
    const count = mobRng.int(min, max) + (level >= 4 && max > 1 ? 1 : 0) + (level >= 8 && max > 1 ? 1 : 0);
    for (let n = 0; n < count; n++) {
      let x = 0; let y = 0; let found = false;
      for (let tries = 0; tries < 60; tries++) {
        const a = mobRng.range(0, Math.PI * 2); const d = mobRng.range(1.6, Math.max(2.4, R * Math.min(0.9, 0.45 + tries * 0.015))); // look further out when it is crowded
        x = Math.cos(a) * d; y = Math.sin(a) * d;
        if (fits(x, y, 0.45)) { found = true; break; }
      }
      if (!found) continue; // no room left: a smaller band
      things.push({ x, y, reach: 0.45 });
      const mob = { id: `${id}_mob${camp.spawns.length}`, kind, x: round2(x), y: round2(y), squad: id, faction: camp.faction, seed: mobRng.int(1, 0x7fffffff) };
      if (!camp.spawns.length) { mob.leader = true; if (camp.hostile) mob.size = 1.15; }
      camp.spawns.push(mob);
      if (camp.spawns.length > 1) sentries.push(mob);
    }
  }
  if (camp.hostile && sentries.length >= 2) { // one of the band walks the edge
    const start = mobRng.range(0, Math.PI * 2);
    sentries[sentries.length - 1].patrol = [0, 1, 2, 3].map((k) => [round2(Math.cos(start + k * Math.PI / 2) * R * 0.8), round2(Math.sin(start + k * Math.PI / 2) * R * 0.8)]);
  }
  for (const mob of camp.spawns) if (camp.hostile && !mob.patrol && !mob.leader && mobRng.chance(0.4)) mob.guard = true;

  const lootRng = rng.fork('loot');
  const tier = Math.max(1, Math.min(4, 1 + Math.floor((level - 1) / 3)));
  if (camp.hostile && camp.spawns.length) {
    for (let tries = 0; tries < 40; tries++) {
      const a = lootRng.range(0, Math.PI * 2); const d = lootRng.range(1.5, R * 0.6);
      const x = Math.cos(a) * d; const y = Math.sin(a) * d;
      if (!fits(x, y, 0.5)) continue;
      things.push({ x, y, reach: 0.5 });
      camp.loot.push({ id: `${id}_loot0`, x: round2(x), y: round2(y), container: 'chest', table: `${typeName}_chest`, tier, seed: lootRng.int(1, 0x7fffffff) });
      break;
    }
  }
  if (type.entrance) {
    const themes = options.themes ?? Object.keys(DUNGEON_THEMES);
    camp.entrance = { x: 0, y: round2(REACH.ruin + 0.6), dungeon: { seed: seedOf(rng.seed, 'below'), theme: lootRng.pick(themes), level } };
  }
  return camp;
}
