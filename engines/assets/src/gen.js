// The asset generator: makes new buildings, props, players, NPCs and mobs from a seed or a short
// description by mixing body plans, parts, palettes and equipment under rules that keep every
// result on-style and to scale. The same request always gives the same asset.
//
//   const tower = generateAsset({ describe: 'tall stone watchtower', seed: 7, style: 'storybook' });
//   const goblin = generateAsset('hooded goblin with a spear');
//
// Buildings and props come out as solids in metres (see gen-solid.js) and go into a scene as
// { shape: 'gen', params: asset.scene.params }. Characters come out as a puppet-engine model
// ({ def, equipment, height, animator? }): createCharacter({ model: asset.model }).
import { makeRng, hashSeed } from './rng.js';
import { STYLES } from './styles.js';
import { parseDescription, vocabulary, TYPES, KINDS } from './gen-words.js';
import { createColors } from './gen-palette.js';
import { solidSize } from './gen-solid.js';
import { houseLike, hut, barn, smithy } from './gen-houses.js';
import { tower, keep, chapel, shrine, lighthouse } from './gen-towers.js';
import { makeProp } from './gen-props.js';
import { makePerson, PEOPLE_TYPES } from './gen-people.js';
import { makeBeast, BEAST_TYPES } from './gen-beasts.js';
import { modelSolids } from './gen-body.js';
import { checkAsset } from './gen-rules.js';

const BUILDINGS = { house: (c) => houseLike(c, 'house'), cottage: (c) => houseLike(c, 'cottage'), shop: (c) => houseLike(c, 'shop'), inn: (c) => houseLike(c, 'inn'), hut, barn, smithy, tower, keep, chapel, shrine, lighthouse };
const CHARACTER_KINDS = ['player', 'npc', 'mob'];
const CHARACTER_TYPES = [...PEOPLE_TYPES, ...BEAST_TYPES];
const HUMAN_HEIGHT = 1.8;
const MAX_TRIES = 12;

const kindOfType = (type) => KINDS.find((k) => TYPES[k].includes(type));
const snake = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'n$1') || 'asset';

/** Work out what a request asks for. Throws with a clear message when it cannot be made. */
function plan(request) {
  const req = typeof request === 'string' ? { describe: request } : request;
  if (!req || typeof req !== 'object') throw new Error(`generateAsset: the request must be a description or an object such as { kind: 'building', seed: 3 }, got ${JSON.stringify(request)}`);
  const describe = req.describe ?? '';
  const traits = parseDescription(describe);
  const style = req.style ?? 'storybook';
  if (!STYLES[style]) throw new Error(`generateAsset: unknown style "${style}". Styles: ${Object.keys(STYLES).join(', ')}`);
  if (req.kind !== undefined && !KINDS.includes(req.kind)) throw new Error(`generateAsset: unknown kind "${req.kind}". Kinds: ${KINDS.join(', ')}`);
  let type = req.type ?? traits.type;
  if (type !== undefined && !kindOfType(type)) throw new Error(`generateAsset: unknown type "${type}". Run "kiln generate --list" to see every type`);
  let kind = req.kind ?? traits.kind ?? (type ? kindOfType(type) : undefined);
  if (!kind) throw new Error(`generateAsset: nothing in "${describe}" says what to make. Name a kind (${KINDS.join(', ')}) or a type such as "tower", "crates" or "goblin"`);
  const isChar = CHARACTER_KINDS.includes(kind);
  if (type && (isChar ? !CHARACTER_TYPES.includes(type) : kindOfType(type) !== kind)) {
    if (req.kind) throw new Error(`generateAsset: "${type}" is a ${kindOfType(type)}, not a ${kind}`);
    kind = kindOfType(type);
  }
  if (req.seed !== undefined && !(typeof req.seed === 'number' || typeof req.seed === 'string')) throw new Error(`generateAsset: "seed" must be a number or text, got ${JSON.stringify(req.seed)}`);
  if (req.size !== undefined && !(req.size >= 0.5 && req.size <= 1.6)) throw new Error(`generateAsset: "size" must be a multiplier from 0.5 to 1.6, got ${req.size}`);
  const seed = req.seed ?? hashSeed('describe', describe.toLowerCase().trim(), kind);
  if (!type) type = makeRng(hashSeed(seed, kind, 'type')).pick(TYPES[kind]);
  return { kind, type, seed, style, describe, traits, name: req.name, palette: req.palette ?? {}, size: Math.max(0.5, Math.min(1.6, traits.size * (req.size ?? 1))) };
}

function attempt(p, tries) {
  const streams = {};
  const used = new Set(['size']);
  const note = (key, value) => { used.add(key); return value; };
  // makers read traits through this view, so words the chosen type has no use for can be reported
  const traits = { get material() { return note('material', p.traits.material); }, get colors() { return note('colors', p.traits.colors); }, get gear() { return note('gear', p.traits.gear); }, tags: p.traits.tags };
  const ctx = {
    /** One random stream per aspect, so adding a choice to one aspect never reshuffles the others. */
    rng(name) { return (streams[name] ??= makeRng(hashSeed(p.seed, p.type, name, tries || ''))); },
    colors: createColors(p.style, p.palette),
    traits,
    has: (tag) => note(`tag:${tag}`, p.traits.tags.includes(tag)),
    size: p.size,
    get count() { return note('count', p.traits.count); },
  };
  const isChar = CHARACTER_KINDS.includes(p.kind);
  const made = isChar ? (BEAST_TYPES.includes(p.type) ? makeBeast(ctx, p.type) : makePerson(ctx, p.type)) : p.kind === 'building' ? BUILDINGS[p.type](ctx) : makeProp(ctx, p.type);
  const palette = ctx.colors.resolve(made.colors);
  const params = { kind: p.kind, type: p.type, seed: p.seed, ...(p.style !== 'storybook' ? { style: p.style } : {}), ...(p.describe ? { describe: p.describe } : {}), ...(Object.keys(p.palette).length ? { palette: p.palette } : {}), ...(p.size !== p.traits.size ? { size: Math.round(p.size / p.traits.size * 1000) / 1000 } : {}) };
  const asset = {
    kiln: 1, generated: 1, kind: p.kind, type: p.type,
    name: snake(p.name ?? `${p.type}_${p.seed}`),
    seed: p.seed, style: p.style, describe: p.describe,
    understood: p.traits.understood, ignored: p.traits.ignored,
    unused: p.traits.effects.filter((e) => !(used.has(e.key) || (e.key.startsWith('gear:') && used.has('gear') && (made.features.includes(e.key.slice(5)) || made.facts.weapon === e.key.slice(5))))).map((e) => e.word),
    features: made.features, facts: made.facts,
    colors: made.colors, palette,
  };
  if (Object.keys(p.palette).length) asset.paletteOverrides = p.palette;
  let solids;
  if (isChar) {
    made.model.def.colors = palette;
    made.model.height = made.facts.bodyHeight;
    asset.model = made.model;
    asset.height = made.facts.bodyHeight;
    solids = modelSolids(made.model);
  } else {
    const used = new Set(made.solids.map((s) => s.c));
    for (const k of Object.keys(asset.palette)) if (!used.has(k)) { delete asset.palette[k]; delete asset.colors[k]; }
    asset.solids = solids = made.solids;
  }
  const size = solidSize(solids);
  asset.size = { ...size, people: Math.round(size.height / HUMAN_HEIGHT * 100) / 100 };
  asset.scene = { shape: 'gen', params };
  if (tries) asset.variation = tries;
  return asset;
}

/**
 * Generate one asset.
 * @param {string|object} request  A description, or:
 * @param {string} [request.describe]  Short description: "tall stone watchtower", "hooded goblin with a spear".
 * @param {string} [request.kind]   building, prop, player, npc or mob. Needed when the description names no type.
 * @param {string} [request.type]   Exact type, e.g. "tower", "crates", "goblin" (see vocabulary()).
 * @param {number|string} [request.seed]  Same seed, same asset. Default: derived from the description.
 * @param {string} [request.style]  storybook (default), nocturne, papercut or crypt.
 * @param {Object<string,string>} [request.palette]  Palette overrides, as in a kiln spec.
 * @param {number} [request.size]   Extra size multiplier, 0.5 to 1.6.
 * @param {string} [request.name]   Name for files and sprites (default: type_seed).
 * @returns {object} The asset: { kind, type, name, seed, style, size: { width, depth, height, people },
 *   features, understood, ignored, unused, colors, palette, scene: { shape: 'gen', params } } plus `solids`
 *   (`ignored`: words the generator does not know; `unused`: known words this type has no use for)
 *   for buildings and props, or `model` ({ def, equipment, animator? }) and `height` for characters.
 */
export function generateAsset(request) {
  const p = plan(request);
  let last = [];
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const asset = attempt(p, tries);
    last = checkAsset(asset);
    if (last.length === 0) return asset;
  }
  throw new Error(`generateAsset: could not make a ${p.type} that passes the scale and style rules (seed ${p.seed}):\n- ${last.join('\n- ')}`);
}

/**
 * A generator with defaults, for making many assets in one style.
 * @param {{style?:string, seed?:number|string, palette?:Object<string,string>}} [defaults]
 * @returns {{generate:Function, variants:Function, set:Function, check:Function, vocabulary:Function, style:string, seed:number|string}}
 */
export function createGenerator(defaults = {}) {
  const style = defaults.style ?? 'storybook';
  if (!STYLES[style]) throw new Error(`createGenerator: unknown style "${style}". Styles: ${Object.keys(STYLES).join(', ')}`);
  const base = defaults.seed ?? 1;
  const fill = (request, salt) => {
    const req = typeof request === 'string' ? { describe: request } : { ...request };
    if (!req || typeof req !== 'object') throw new Error('generator.generate: the request must be a description or an object');
    const key = [req.describe ?? '', req.kind ?? '', req.type ?? ''].join('|').toLowerCase();
    return { style, ...(defaults.palette ? { palette: defaults.palette } : {}), ...req, seed: req.seed ?? hashSeed(base, key, salt) };
  };
  return {
    style, seed: base,
    /** One asset. Without a seed in the request, the generator's seed and the request text decide it. */
    generate: (request) => generateAsset(fill(request, '')),
    /** `count` different takes on one request, named name_1, name_2 ... */
    variants(request, count = 4) {
      if (!(Number.isInteger(count) && count >= 1 && count <= 64)) throw new Error(`generator.variants: "count" must be a whole number from 1 to 64, got ${count}`);
      return Array.from({ length: count }, (_, i) => { const req = fill(request, `v${i}`); return generateAsset({ ...req, name: req.name ? `${req.name}_${i + 1}` : undefined }); });
    },
    /** One asset per request in a list. */
    set: (requests) => requests.map((r) => generateAsset(fill(r, ''))),
    check: checkAsset,
    vocabulary,
  };
}

export { checkAsset, vocabulary, parseDescription };
