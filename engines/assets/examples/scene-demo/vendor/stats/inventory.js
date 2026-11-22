// Bridge to the inventory engine. Nothing is imported: you pass the inventory object in.
//   - what is equipped becomes stat modifiers on the sheet (source 'equipment')
//   - a used item's `use` data becomes healing, resources, buffs, cures, XP
//   - rolled loot goes into the bag
import { need, own, isObject } from './util.js';

/**
 * equipmentMods(stats, inventory) -> { mods, unknown }
 * Turns inventory.stats() (every equipped item's stats added up, for example { attack: 5, 'resist.fire': 0.2 })
 * into modifiers. Names that are not stats in this game are listed in `unknown` and left out.
 */
export function equipmentMods(stats, inventory) {
  need(inventory && typeof inventory.stats === 'function', 'equipmentMods: pass an inventory (createInventory(...)) as the second argument');
  const mods = []; const unknown = [];
  for (const [name, v] of Object.entries(inventory.stats({}))) {
    if (!Number.isFinite(v) || v === 0) continue;
    if (own(stats.rules.stats, name)) mods.push({ stat: name, add: v }); else unknown.push(name);
  }
  return { mods, unknown };
}

/**
 * bindInventory(stats, id, inventory, options) -> link { sync(), stop(), unknown }
 * Keeps the sheet's 'equipment' modifiers equal to what is equipped: now, on every inventory change, and when
 * the sheet is added or loaded later. options: source ('equipment'), strict (true throws on an item stat that is
 * not a stat in this game; default false lists it in link.unknown).
 */
export function bindInventory(stats, id, inventory, options = {}) {
  need(inventory && typeof inventory.on === 'function', 'bindInventory: pass an inventory (createInventory(...)) as the third argument');
  const source = options.source ?? 'equipment';
  const link = {
    unknown: [],
    sync() {
      if (!stats.has(id)) return false;
      const { mods, unknown } = equipmentMods(stats, inventory);
      need(!options.strict || unknown.length === 0, `bindInventory: equipped items carry stats this game does not have: ${unknown.join(', ')} (stats: ${Object.keys(stats.rules.stats).join(', ')})`);
      link.unknown = unknown;
      stats.setMods(id, source, mods);
      return true;
    },
    stop() { for (const off of offs.splice(0)) off(); },
  };
  const offs = [inventory.on('change', () => link.sync()), stats.on('add', (e) => { if (e.id === id) link.sync(); }), stats.on('load', () => link.sync())];
  link.sync();
  return link;
}

const list = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/**
 * applyItemEffect(stats, id, effect) -> { changed, applied }
 * Applies the `use` data of an item (what inventory.use() hands back as result.effect). Understood keys:
 *   heal: 5                         health
 *   restore: { mana: 10 }           any resources
 *   effect: 'might' | { id, duration, stacks } | [ ... ]     buffs (or debuffs: a cursed potion)
 *   cure: 'poison' | 'debuff' | [ ... ]   removes an effect by id, every effect with that tag, or every debuff / buff
 *   xp: 50, unlock: 'fireball', fill: true
 * `changed` is false when nothing happened (full health, nothing to cure), so the game can give the item back.
 * Keys it does not know are ignored and listed in applied.ignored.
 */
export function applyItemEffect(stats, id, effect, options = {}) {
  need(isObject(effect), `applyItemEffect: effect must be an object like { heal: 5 }, got ${JSON.stringify(effect)}`);
  const hp = options.hp ?? 'hp'; const applied = { ignored: [] }; let changed = false;
  for (const [key, v] of Object.entries(effect)) {
    if (key === 'heal') { applied.heal = stats.restore(id, hp, v, 'item'); changed ||= applied.heal > 0; }
    else if (key === 'restore') { applied.restore = {}; for (const [res, n] of Object.entries(v)) { applied.restore[res] = stats.restore(id, res, n, 'item'); changed ||= applied.restore[res] > 0; } }
    else if (key === 'fill') { if (v) { const before = JSON.stringify(stats.sheet(id).res); stats.fill(id); applied.fill = true; changed ||= JSON.stringify(stats.sheet(id).res) !== before; } }
    else if (key === 'effect') { applied.effects = list(v).map((e) => { const o = typeof e === 'string' ? { id: e } : e; const r = stats.applyEffect(id, o.id, { duration: o.duration, stacks: o.stacks, source: 'item' }); changed ||= r.ok; return { id: o.id, ...r }; }); }
    else if (key === 'cure') {
      applied.cured = [];
      for (const what of list(v)) {
        if (what === 'buff' || what === 'debuff') applied.cured.push(...stats.dispel(id, { kind: what }));
        else if (own(stats.rules.effects, what)) { if (stats.removeEffect(id, what)) applied.cured.push(what); }
        else applied.cured.push(...stats.dispel(id, { tag: what }));
      }
      changed ||= applied.cured.length > 0;
    }
    else if (key === 'xp') { applied.xp = stats.addXp(id, v, { source: 'item' }).gained; changed ||= applied.xp > 0; }
    else if (key === 'unlock') { applied.unlocked = list(v).filter((name) => stats.unlock(id, name)); changed ||= applied.unlocked.length > 0; }
    else applied.ignored.push(key);
  }
  return { changed, applied };
}

/**
 * giveLoot(inventory, drop, { stats, id }) -> { taken: [stacks], left: [stacks that did not fit], coins, xp }
 * Puts rolled loot (stats.rollLoot or a 'defeat' event's loot) into the bag. With stats and id the drop's XP is
 * added too: use that for chests; stats.defeat has already added the XP of a kill.
 */
export function giveLoot(inventory, drop, options = {}) {
  need(inventory && typeof inventory.give === 'function', 'giveLoot: pass an inventory (createInventory(...)) as the first argument');
  need(isObject(drop) && Array.isArray(drop.items), `giveLoot: drop must be { items, coins, xp } from stats.rollLoot, got ${JSON.stringify(drop)}`);
  const taken = []; const left = [];
  for (const stack of drop.items) {
    const r = inventory.give({ ...stack });
    const added = r?.added ?? stack.n;
    if (added > 0) taken.push({ ...stack, n: added });
    if (added < stack.n) left.push({ ...stack, n: stack.n - added });
  }
  if (drop.coins > 0 && typeof inventory.addCoins === 'function') inventory.addCoins(drop.coins);
  const xp = options.stats && options.id && drop.xp > 0 ? options.stats.addXp(options.id, drop.xp, { source: 'loot' }).gained : 0;
  return { taken, left, coins: drop.coins ?? 0, xp };
}
